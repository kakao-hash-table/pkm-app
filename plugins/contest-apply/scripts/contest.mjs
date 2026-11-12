#!/usr/bin/env node
// 공모전 신청 — 공모전 사이트에서 네이밍·슬로건 공모전을 모아 AI가 요강을 정리하고 안을 만들고, 제출·발표를 기록한다. 결과는 JSON 한 줄.
// 목록(피드)
//   find-list --sites=켬,켬,켬,켬 · open-list · sent-list · out-list
// 워크플로우
//   find --sites [--limit]                 사이트 목록·상세 → 새 공모전 저장, AI에게 줄 요강(_pages)
//   sort-out --keys --fit --seen --left --sites --failed   AI 정리 → 상금·낼 것·조건·발표일, 낼 것/뺀 것으로 나누기
//   prep --cid [--answer=regen]            양식 문서(.hwp·.hwpx) 받아 두기, AI 안이 있으면 건너뛰게(need_ai)
//   papers --cid --draft · info --cid --plan --me [--answer] · fill --cid --me   양식 읽기 → (AI 계획) → 모자란 내용 묻기 → 채우기
//   fill --cid --draft --me                신청서(.hwp) 칸 채우기 — 파일은 프로필 데이터의 files/(프로필과 함께 동기화)
//   submit --cid --draft --me --auto [--answer=mail|yes|later|no] · picked --cid --value [--answer] · finish --cid --choice
//   drop --cid · force --cid · result --cid [--answer=won|lost|undo] · award --cid [--answer]
//   mail-list · mail-test                  네이버 메일 계정 시험 — 내 주소로 한 통 보내 본다
// 공통: [--profile=폴더] [--now=ISO]
// 저장: <프로필>/_플러그인/.data/contest-apply/db.json (프로필과 함께 동기화, 앱 화면에는 안 보임)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from './engine.mjs';
import * as S from './sources.mjs';
import * as M from './mail.mjs';
import * as F from './forms.mjs';
import os from 'node:os';
import crypto from 'node:crypto';

let argLost = false;
const argValue = v => { const m = /^@file:(\/.+)$/.exec(v); if (!m) return v; try { return fs.readFileSync(m[1], 'utf8'); } catch { argLost = true; return ''; } };
const args = Object.fromEntries(process.argv.slice(3).map(a => a.match(/^--([^=]+)=([\s\S]*)$/)).filter(Boolean).map(m => [m[1], argValue(m[2])]));
const NOW = args.now && !Number.isNaN(Date.parse(args.now)) ? new Date(args.now) : new Date();
const AT = NOW.toISOString();
const TODAY = new Date(NOW.getTime() + 9 * 3600000).toISOString().slice(0, 10);   // 한국 날짜
const FIND_DAY = new Date(NOW.getTime() + (9 - 8) * 3600000).toISOString().slice(0, 10);   // 찾기 항목의 하루는 아침 8시에 바뀐다 — 자동 찾기가 새벽에 돌지 않게
const fail = msg => { throw Object.assign(new Error(msg), { user: true }); };
const blank = v => v == null || !String(v).trim();
const json = (v, what) => { if (blank(v)) fail(`${what}이 비어 있어요. 앞 단계를 다시 해 주세요`); try { return JSON.parse(v); } catch { fail(`${what}을 읽지 못했어요. 앞 단계를 다시 해 주세요`); } };

const here = path.dirname(fileURLToPath(import.meta.url));
const profile = args.profile ? path.resolve(args.profile) : path.resolve(here, '..', '..', '..');   // <프로필>/_플러그인/contest-apply/scripts
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
function writeAtomic(f, t){
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = path.join(path.dirname(f), `.${path.basename(f)}.${process.pid}.tmp`);
  try { fs.writeFileSync(tmp, t); fs.renameSync(tmp, f); } finally { fs.rmSync(tmp, { force: true }); }
}
const DB = path.join(profile, '_플러그인', '.data', 'contest-apply', 'db.json');
const load = () => { const t = read(DB); if (!t) return { contests: {} }; try { const db = { contests: {}, ...JSON.parse(t) }; for (const x of Object.values(db.contests)) if (x.fit) E.fixMethod(x.fit.submit); return db; } catch { fail('저장된 기록(db.json)을 읽지 못했어요. 동기화 충돌이 있는지 봐 주세요'); } };   // 전에 읽은 기록의 '구글 폼' 오표기는 읽을 때 바로잡는다
const save = db => writeAtomic(DB, JSON.stringify(db, null, 1) + '\n');
const contest = (db, key) => db.contests[key] || fail('공모전을 찾지 못했어요. 다른 기기에서 아직 동기화되지 않았을 수 있어요');
const st = c => E.statusOf(c, TODAY);
const all = db => Object.values(db.contests);
const byDate = k => (a, b) => (a[k] || '9999').localeCompare(b[k] || '9999');

// 설정의 사이트 토글 넷(위비티·씽굿·콘테스트코리아·링커리어 순서)을 쉼표로 받는다
const SITE_ORDER = ['wevity', 'thinkcontest', 'contestkorea', 'linkareer'];
const sitesOn = v => { const on = String(v ?? '').split(','); return SITE_ORDER.filter((k, i) => on[i] == null || on[i].trim() !== 'false'); };
const eun = w => (w.charCodeAt(w.length - 1) - 0xAC00) % 28 ? '은' : '는';   // 받침에 따라 은·는
const titleOf = t => E.cut(String(t || '').replace(/\s*(\(~?\s*\d{1,2}[./]\d{1,2}\s*\)|\[D-?\d+\])\s*$/i, ''), 60);
const host = c => c.organizer ? `주최 ${E.cut(c.organizer, 15)}` : '';
// 생성형 AI 규칙 — 숨기면 AI 안을 그대로 냈다가 실격될 수 있다. 막지는 않고 늘 보인다
const aiLine = f => !f.ai || f.ai.rule === 'none' ? '' : f.ai.rule === 'banned' ? '생성형 AI로만 만든 작품은 안 받아요' : 'AI를 썼으면 밝혀야 해요';
const SEND = { email: '이메일로 내요', form: '구글 폼으로 내요', nform: '네이버 폼으로 내요', oform: '온라인 폼으로 내요', site: '홈페이지에서 내요', post: '우편으로 내요', youtube: '유튜브로 내요', sns: 'SNS로 내요', visit: '방문해서 내요' };

/* ---------- 목록 ---------- */
const item = c => ({ id: c.key, title: titleOf(c.title), url: c.url, at: c.added, vars: { cid: c.key }, sort: E.sortOf(c),
  version: `${c.fit ? 'f' : ''}${c.draft ? `d${c.draft.at}` : ''}${c.submitted ? 's' : ''}${c.result || ''}` });
// 제출 화면이 달라지는 값만 — 날짜(D-day)·접수 방법·접수처·메일 계정. 이 값이 바뀌면 기다리던 '냈나요?'를 새로 묻는다(reask). AI 안처럼 실행이 스스로 바꾸는 값은 넣지 않는다
const ver = (c, db) => crypto.createHash('sha1').update(['8', TODAY, c.fit.submit.method, c.fit.submit.to, mailReady(c.fit) ? 'm' : '', c.refit_at || '', FULL ? 'auto' : '', ...Object.keys(FORM).filter(k => tested(db, k))].join('|')).digest('hex').slice(0, 12);
const aiTop = c => c.draft ? c.draft.items.slice(0, Math.min(c.fit ? c.fit.submit.allow : 1, c.draft.items.length)) : [];   // AI가 추천한 안(응모 건수만큼)
// 낼 안 — 내가 골랐으면 그것, 아니면 AI 추천
const top = c => { const it = c.draft ? c.draft.items : [], p = (c.picks || []).filter(i => it[i]); return p.length ? p.map(i => it[i]) : aiTop(c); };
function findList(){
  const on = sitesOn(args.sites);
  if (!on.length) return { items: [] };
  const db = load(), cs = all(db), sent = cs.filter(c => c.submitted).length, won = cs.filter(c => c.result === 'won').length, stats = E.methodStats(cs);
  const off = SITE_ORDER.filter(k => !on.includes(k)).map(k => S.SITES[k].name);
  return { items: [{ id: `find-${FIND_DAY}`, title: `${E.kday(FIND_DAY)} 찾기`, vars: {},
    meta: [...(stats ? [`제출 방식 · ${stats}`] : []), sent ? `낸 것 ${sent} · 당선 ${won}` : '아직 낸 것 없음', ...(off.length ? [`${off.join('·')} 꺼 둠`] : [])] }] };
}
function openList(){
  const db = load();
  if (E.mergeDups(all(db).filter(c => !c.deadline || c.deadline >= TODAY))) save(db);   // 전에 가져온 기록의 중복도 여기서 하나로
  const list = all(db).filter(c => st(c) === 'ready').sort(byDate('deadline'));
  return { items: list.map(c => {
    const f = c.fit, n = E.ddays(c.deadline, TODAY), d = [];
    if (f.unreadable) d.push({ who: '요강', text: '요강이 그림이라 읽지 못했어요. 원문에서 낼 것과 조건을 확인해 주세요' });
    else d.push({ who: '요강', text: [
      `낼 것 · ${f.submit.what || '요강 확인'}${f.submit.allow > 1 ? ` · 1인 ${f.submit.allow}건까지` : ''}`,
      `조건 · ${f.eligibility.text || '요강에 없음'} → ${E.verdictWord(f.eligibility.ok)}${f.eligibility.why && !(f.eligibility.ok === 'yes' && /제한\s*없|누구나|전\s*국민|국민 누구/.test(f.eligibility.why)) ? `(${f.eligibility.why})` : ''}`,
      ...(aiLine(f) ? [`AI · ${aiLine(f)}`] : []), ...(f.submit.note ? [`양식 · ${f.submit.note}`] : []), ...(f.doubt ? [`확인 · ${f.doubt} — 원문을 봐 주세요`] : [])].join('\n') });
    if (c.draft) d.push({ who: `AI 안 ${c.draft.items.length}개 · 추천 ${aiTop(c).length}`, text: E.cut(E.names(c.draft), 120) });
    const flag = n === 0 ? '오늘 마감' : f.ai && f.ai.rule === 'banned' ? 'AI 작품 제한' : f.eligibility.ok === 'unsure' ? '조건 확인' : f.unreadable || f.doubt ? '요강 확인' : '';
    return { ...item(c), version: ver(c, db), tags: [E.kindLabel(f), mailReady(f) ? '메일로 바로 보내기' : SEND[f.submit.method] ? E.METHODS[f.submit.method] : '방식 확인', c.draft ? '' : 'AI 안 없음', flag, c.mail_sending || (c.formed && !c.formed.sure) ? '제출 확인 필요' : c.sited && c.sited.sent !== 'yes' ? (c.sited.sent === 'unknown' ? '제출 확인 필요' : '브라우저 제출 멈춤') : ''].filter(Boolean),
      meta: [...(c.sited && c.sited.sent !== 'yes' && c.sited.reason ? [`멈춘 이유 · ${E.cut(c.sited.reason, 90)}`] : []), E.prizeLine(f), E.deadlineLine(c.deadline, TODAY), E.announceLine(f, TODAY), host(c)].filter(Boolean), detail: d };
  }) };
}
// 낸 증거 — '냈어요'라고만 하지 않고 무엇으로 확인했는지(A4)
const kst = at => new Date(Date.parse(at) + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/');
function proofOf(c){
  if (c.mailed) return [{ who: '증거 · 메일', text: `${kst(c.mailed.at)}에 ${c.mailed.to}로 보냄${c.mailed.id ? ` · 메일 번호 ${E.cut(c.mailed.id, 40)}` : ''}${(c.filled || []).length ? ` · 첨부 ${c.filled.filter(o => o.file).length}개` : ''}` }];
  if (c.formed) return [{ who: `증거 · ${FORM[c.formed.kind] || '폼'}`, text: `${kst(c.formed.at)}에 제출 · ${c.formed.sure ? '접수 완료 응답을 받음' : '제출 요청은 받아들여졌지만 확인 화면은 못 봄 — 폼에서 확인해 주세요'}${c.formed.id ? ` · 응답 번호 ${c.formed.id}` : ''}` }];
  if (c.sited && c.sited.sent === 'yes') return [{ who: '증거 · 접수 화면', text: `${kst(c.sited.at)} · ${c.sited.proof || '완료 화면을 봄'}` }];
  return [{ who: '증거', text: '직접 냈다고 적은 것이에요(프로그램이 확인한 증거는 없어요)' }];
}
function sentList(){
  const db = load(), list = all(db).filter(c => st(c) === 'submitted').sort((a, b) => (E.sortOf(a).announce || '9999').localeCompare(E.sortOf(b).announce || '9999'));
  return { items: list.map(c => {
    const f = c.fit, past = f && f.announce && f.announce < TODAY, sent = c.sent_names && c.sent_names.length ? c.sent_names : top(c).map(x => x.text);
    return { ...item(c), tags: [f ? E.kindLabel(f) : '', past ? '발표 지남' : ''].filter(Boolean),
      meta: [E.announceLine(f, TODAY, true), E.prizeLine(f), `${E.kday(c.submitted.slice(0, 10))}에 냄`, host(c)].filter(Boolean),
      detail: [...(sent.length ? [{ who: '낸 안', text: sent.join(' · ') }] : []), ...proofOf(c)] };
  }) };
}
function outList(){
  const db = load(), list = all(db).filter(c => ['out', 'dropped'].includes(st(c)) && (!c.deadline || c.deadline >= TODAY)).sort(byDate('deadline'));
  return { items: list.slice(0, 60).map(c => {
    const f = c.fit, mine = !!c.dropped;
    const why = mine || !f ? [] : !f.target ? [{ who: '뺀 이유', text: f.target_why || `받는 작품: ${f.kinds.join('·') || '모름'}` }]
      : [{ who: '뺀 이유', text: `${f.eligibility.text || '응모 자격'} → ${f.eligibility.why || '안 돼요'}` }];
    return { ...item(c), tags: [mine ? '내가 뺌' : f && !f.target ? '분야 다름' : '조건 안 맞음'], meta: [E.prizeLine(f), E.deadlineLine(c.deadline, TODAY), host(c)].filter(Boolean), detail: why };
  }) };
}

/* ---------- 찾기: 사이트 → AI 요강 정리 → 나누기 ---------- */
const ALT = ['thinkcontest', 'contestkorea', 'linkareer', 'wevity'];   // 접수 방법 칸이 있는 사이트부터
async function altDetail(c){
  const site = a => a.key.split(':')[0];
  for (const a of [...c.also].sort((x, y) => ALT.indexOf(site(x)) - ALT.indexOf(site(y))).slice(0, 2)){
    try { return { source: a.source, d: await S.fetchDetail({ site: site(a), url: a.url }) }; } catch { /* 다음 사이트로 */ }
  }
  return null;
}
async function find(){
  const keys = sitesOn(args.sites), limit = Math.max(1, Math.min(30, Number(args.limit) || 20));
  if (!keys.length) fail('찾을 사이트가 없어요. 설정에서 사이트를 하나 이상 켜 주세요');
  const db = load(), failed = [], found = [];
  for (const k of keys){
    try { found.push(...(await S.fetchList(k, { now: NOW })).filter(c => !c.deadline || c.deadline >= TODAY)); }
    catch { failed.push(S.SITES[k].name); }
  }
  if (failed.length === keys.length) fail('사이트에 닿지 않아요. 인터넷 연결을 확인하고 다시 해 주세요');
  const known = all(db), before = new Set(known.filter(c => c.fit).map(c => c.key)), twin = c => known.find(x => !x.dup_of && E.sameListing(x, c));   // 다른 사이트에 올라온 같은 공모전은 요강을 받지 않는다
  const seen = new Set();   // 이번 찾기 전부터 있던 공모전(다른 사이트에 같이 올라온 것은 하나로)
  for (const c of found){
    if (db.contests[c.key]){ if (before.has(c.key)) seen.add(c.key); continue; }
    const t = twin(c);
    if (t){ if (before.has(t.key)) seen.add(t.key); if (!(t.also ||= []).some(a => a.key === c.key)) t.also.push({ key: c.key, source: c.source, url: c.url }); continue; }
    db.contests[c.key] = { key: c.key, site: c.site, source: c.source, title: E.str(c.title, 200), url: c.url, organizer: E.str(c.organizer, 60), deadline: c.deadline || '', added: AT, fit: null };
    known.push(db.contests[c.key]);
  }
  // 요강을 아직 정리하지 못한 것(새것 + 지난번 AI가 멈춘 것)을 마감이 가까운 순으로 limit개.
  // 자리가 남으면 접수 방법·접수처를 모르는 낼 공모전도 다른 사이트 요강과 함께 한 번 더 읽힌다(이메일 접수인지 알아내려고)
  const wait = known.filter(c => !c.fit && (!c.deadline || c.deadline >= TODAY)).sort(byDate('deadline'));
  const again = known.filter(c => c.fit && !c.refit_at && !c.dup_of && st(c) === 'ready' && E.weak(c.fit) && (c.also || []).length).sort(byDate('deadline'));
  const todo = [...wait, ...again].slice(0, limit), pages = [];
  for (const c of todo){
    try {
      const d = await S.fetchDetail(c);
      // 같이 올라온 다른 사이트의 요강 — 위비티는 접수 방법 칸이 없어서, 그 칸이 있는 사이트 것을 함께 읽힌다
      const alt = (c.also || []).length && (c.fit || c.site === 'wevity' || !d.method) ? await altDetail(c) : null, o = alt ? alt.d : {};
      if (!c.deadline && d.deadline) c.deadline = E.day(d.deadline);
      if (d.organizer && !c.organizer) c.organizer = E.str(d.organizer, 60);
      if (c.fit) c.refit = true;
      else { c.homepage = d.homepage || o.homepage || ''; c.attachments = (d.attachments || []).filter(a => a.name).slice(0, 5); c.brief = E.text(d.text, 3500); }
      const table = [['접수', [d.start, d.deadline].filter(Boolean).join(' ~ ')], ['발표', d.announce || o.announce], ['시상', d.prize || o.prize], ['응모 대상', d.eligibility || o.eligibility], ['접수 방법', d.method || o.method], ['홈페이지', d.homepage || o.homepage], ['주최', d.organizer || c.organizer],
        ['첨부', (c.attachments || []).map(a => a.name).join(', ')]].filter(([, v]) => v).map(([k, v]) => `${k}: ${E.str(v, 300)}`).join('\n');
      pages.push({ key: c.key, text: `[${pages.length}] (${c.source}) ${c.title}\n${table}\n${c.brief || E.text(d.text, 3500)}${alt ? `\n같은 공모전의 ${alt.source} 요강:\n${E.text(o.text, 1200)}` : ''}` });
    } catch { /* 요강을 못 받은 것은 다음 찾기 때 다시 */ }
  }
  save(db);
  return { summary: `읽을 요강 ${pages.length}개 · 있던 것 ${seen.size}개${failed.length ? ` · 못 읽은 사이트 ${failed.join('·')}` : ''}`,
    has: pages.length > 0, today: TODAY, keys: JSON.stringify(pages.map(p => p.key)), seen: seen.size, left: Math.max(0, wait.length - limit), sites: keys.length, failed: failed.join('·'), _pages: pages.map(p => p.text).join('\n\n') };
}
function sortOut(){
  const keys = blank(args.keys) ? [] : json(args.keys, '공모전 목록'), a = blank(args.fit) ? { contests: [], note: '' } : E.normalizeFit(json(args.fit, 'AI가 정리한 것')), db = load();
  let fixed = 0;
  for (const f of a.contests){
    const c = db.contests[keys[f.i]];
    if (!c) continue;
    if (c.fit){   // 다시 읽힌 것 — 접수 방법·접수처·발표일만 고친다(낼 수 있는지 판정과 AI 안은 그대로)
      if (!c.refit) continue;
      delete c.refit; c.refit_at = AT;
      if (E.weak(c.fit) && (!E.weak(f) || (f.submit.to && !c.fit.submit.to))){ Object.assign(c.fit.submit, { method: f.submit.method, to: f.submit.to, how: f.submit.how || c.fit.submit.how, subject: f.submit.subject || c.fit.submit.subject }); fixed++; }
      if (!c.fit.announce && f.announce) Object.assign(c.fit, { announce: f.announce, announce_text: '' });
      continue;
    }
    // 마감일은 사이트 목록 값을 믿는다(요강 본문이 다른 해 글일 수 있다). 다르면 '요강 확인'으로 알린다
    if (!c.deadline && f.deadline) c.deadline = f.deadline;
    else if (f.deadline && c.deadline && f.deadline !== c.deadline && !f.doubt) f.doubt = `요강의 마감일(${E.kday(f.deadline)})이 사이트와 달라요`;
    if (!f.submit.to && f.submit.method === 'site' && c.homepage) f.submit.to = c.homepage;
    c.fit = f; c.fitted = AT;
  }
  E.mergeDups(all(db).filter(c => c.fit && (!c.deadline || c.deadline >= TODAY)));
  save(db);
  const now = keys.map(k => db.contests[k]).filter(c => c && c.fitted === AT && !c.dup_of);
  const ready = now.filter(c => st(c) === 'ready').length, out = now.filter(c => st(c) === 'out').length, unread = now.filter(c => c.fit.unreadable).length;
  const n = ready + out, failed = args.failed || '', seen = Number(args.seen) || 0, left = Number(args.left) || 0;
  const title = n ? `새 공모전 ${n}개를 찾았어요${failed ? ` · ${failed}${eun(failed)} 못 읽었어요` : ''}` : `새 공모전이 없어요${failed ? ` · ${failed}${eun(failed)} 못 읽었어요` : ''}`;
  const text = [n ? `낼 공모전 ${ready} · 조건이 안 맞아 뺀 것 ${out}${seen ? ` · 이미 있던 것 ${seen}` : ''}` : `${Number(args.sites) - (failed ? failed.split('·').length : 0)}개 사이트를 모두 읽었어요`,
    unread ? `요강을 못 읽은 것 ${unread}개('요강 확인' 표시)` : '', fixed ? `접수 방법을 새로 알아낸 공모전 ${fixed}개` : '', left ? `아직 못 읽은 ${left}개는 다음 찾기 때 읽어요` : '', failed ? `${failed} 화면이 바뀐 것 같아요. 다음 찾기 때 다시 해요. 계속 안 되면 플러그인을 업데이트해 주세요` : '', a.note].filter(Boolean).join(' · ');
  return { summary: n ? `낼 것 ${ready} · 뺀 것 ${out}` : '새 공모전 없음', outcome: { title: '찾음', text: '' }, verdict: { tone: 'ok', title, text } };
}

/* ---------- 제출 준비: 양식 문서(.hwp·.hwpx) 채우기 · 네이버 메일 ---------- */
const STORE = path.dirname(DB);   // <프로필>/_플러그인/.data/contest-apply — 내 정보·서류도 여기에 둔다(프로필 데이터와 함께 동기화. 공개 저장소에는 올라가지 않는다)
const FILES = path.join(STORE, 'files');   // 받아 둔 양식·채운 서류·도장. 앱이 …/plugins/contest-apply/file로 보인다
const base = c => c.key.replace(/[^\w-]/g, '-');
const safe = t => String(t || '').replace(/[\\/:*?"<>|\s.]+/g, '_').slice(0, 30);
const fileName = t => String(t || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const PERSONAL = /이름|성명|연락|전화|휴대|핸드폰|이메일|e-?mail|메일|주소|생년|생일|나이|소속|직업|직장|학교|학과|성별/i;   // 다음 공모전에도 쓸 내 정보
const BANK = /계좌|은행|예금주/;   // 상금 계좌는 민감해서 그 공모전의 답으로만 기억하고, 요강이 요구할 때만 메일에 넣는다
const keepMine = k => PERSONAL.test(k) && !BANK.test(k);
// 받은 날 — 내정보.json·답 파일의 꼴은 그대로 두고 같은 폴더의 받은날.json에 { 제출용: {항목: 날}, 답: {공모전: {항목: 날}} }로 적는다
const GOT = () => path.join(STORE, '받은날.json');
function noteGot(mine = [], c = null, own = []){
  if (!mine.length && !own.length) return;
  const g = readJSON(GOT(), {}); g.제출용 ||= {}; g.답 ||= {};
  for (const k of mine) g.제출용[k] = TODAY;
  if (c && own.length){ const b = base(c); g.답[b] ||= {}; for (const k of own) g.답[b][k] = TODAY; }
  writeLocal(GOT(), g);
}
// 내 정보 — 프로필 데이터의 내정보.json { 조건: 생년·성별·사는 곳…, 제출용: 이름·연락처… }. 설정에 적은 것이 먼저이고, 설정과 서로 맞춘다(syncMe)
const KEPT = path.join(STORE, '내정보.json');
const readKept = () => { const k = readJSON(KEPT, {}), flat = !k.조건 && !k.제출용; return { 조건: { ...(k.조건 || {}) }, 제출용: { ...(flat ? k : k.제출용 || {}) } }; };   // 예전 꼴(항목: 값)은 제출용으로 읽는다
const WHO = ['birth', 'gender', 'home', 'work', 'status'];
// 설정 ↔ 데이터: 설정에 적은 값은 데이터에 옮겨 다른 기기와 맞추고, 설정이 빈 기기에서는 데이터의 값으로 설정을 채운다
function syncMe(){
  const k = readKept(), patch = {}; let dirty = false;
  for (const key of WHO.filter(x => x in args)){
    const v = String(args[key] ?? '').trim();
    if (v){ if (k.조건[key] !== v){ k.조건[key] = v; dirty = true; } } else if (k.조건[key]) patch[key] = k.조건[key];
  }
  if ('me' in args){
    const set = String(args.me || '').split('\n').map(l => l.split('\t').map(x => x.trim())).filter(([a, b]) => a && b);
    const got = [];
    for (const [a, b] of set) if (k.제출용[a] !== b){ k.제출용[a] = b; dirty = true; got.push(a); }
    noteGot(got);
    if (!set.length && Object.keys(k.제출용).length) patch.me = Object.entries(k.제출용).map(([a, b]) => `${a}\t${b}`).join('\n');
  }
  if (dirty) writeLocal(KEPT, k);
  return Object.keys(patch).length ? { settings_patch: patch } : {};
}
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeLocal = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 }); };
const meOf = () => { const set = String(args.me || '').split('\n').map(l => l.split('\t').map(x => x.trim())).filter(([a, b]) => a && b);
  return [...set, ...Object.entries(readKept().제출용).filter(([k, v]) => v && !set.some(([a]) => a === k))]; };
// 같은 뜻 칸 — 양식의 '응모자 성명'도 설정의 '이름'으로 채운다
const KIND = [['이름', /이름|성명|서명|응모자/], ['연락처', /연락처|전화|휴대|핸드폰|폰/i], ['이메일', /이메일|e-?mail|메일/i], ['주소', /주소/], ['생년월일', /생년|생일/], ['소속', /소속|직장|학교|기관/]];
const kindOf = t => (KIND.find(([, re]) => re.test(t)) || [])[0];
const mine = (me, label) => (me.find(([a]) => a === label || label.includes(a) || a.includes(label)) || me.find(([a]) => kindOf(a) && kindOf(a) === kindOf(label)) || [])[1];
// 문서(.hwp·.hwpx) 모듈은 쓸 때만 불러온다 — Java가 없는 컴퓨터에서도 나머지는 돌게
const docsLib = () => import('./docs.mjs').catch(() => fail('문서 모듈(docs.mjs)이 없어요. 플러그인을 업데이트해 주세요'));
const hasAccount = () => !!(process.env.NAVER_ID && process.env.NAVER_APP_PASSWORD);
const mailReady = f => f.submit.method === 'email' && M.checkAddress(E.firstEmail(f.submit.to)) && hasAccount();
// 손으로 만든 파일(서명 스캔·PDF)을 넣어 두는 폴더 — 여기 있는 파일은 메일에 함께 붙인다
const extraDir = c => path.join(FILES, `${base(c)}-보탤 파일`);
const extraFiles = c => { try { return fs.readdirSync(extraDir(c)).filter(n => !n.startsWith('.')).map(n => path.join(extraDir(c), n)).filter(f => fs.statSync(f).isFile()).slice(0, 10); } catch { return []; } };
// 도장 이미지 — 이 파일이 있으면 서명·날인 자리({{도장}})에 넣는다
const STAMP = path.join(FILES, '도장.png');
// Finder에서 보이는 길 — 문서 폴더에 '공모전 서류' 바로가기를 만들어 둔다(이미 다른 것이 있으면 그대로 두고 원래 경로를 보인다)
const LINK = path.join(os.homedir(), 'Documents', '공모전 서류');
function shown(f){
  try { if (!process.env.PKM_HOME && !FILES.startsWith(os.tmpdir()) && !FILES.startsWith('/private/') && !FILES.startsWith('/tmp/') && !fs.existsSync(LINK) && fs.existsSync(path.dirname(LINK))) fs.symlinkSync(FILES, LINK); if (fs.realpathSync(LINK) === fs.realpathSync(FILES)) return path.join(LINK, path.relative(FILES, f)); } catch { /* 원래 경로로 */ }
  return f;
}
const ANSWERS = c => path.join(STORE, '답', `${base(c)}.json`);   // 이 공모전에만 쓰는 답(예: AI를 썼나요)
const FULL = args.full === 'true';   // 완전 자동화 — 동의 문항·보낼 안·제출을 묻지 않는다(걸리는 것이 있을 때만 묻는다)
/* 온라인 폼(구글 폼·네이버 폼) — 문항을 읽어 두고, AI가 문항마다 답을 계획하고, 내가 확인한 뒤에 제출한다 */
const FORM = { google: '구글 폼', naver: '네이버 폼' };
const QTYPE = { short: '단답', long: '장문', choice: '하나 고르기', multi: '여러 개 고르기', dropdown: '목록에서 고르기', scale: '점수', grid: '표에서 고르기', date: '날짜', time: '시간', datetime: '날짜와 시간', duration: '걸린 시간', number: '숫자', address: '주소', category: '단계별 고르기', agree: '동의', file: '파일 올리기', other: '기타' };
const LINES = new Set(['multi', 'grid']);   // 답이 여러 줄인 유형
const formUrl = f => { const u = ['form', 'nform', 'oform'].includes(f.submit.method) ? E.urlOf(f.submit.to) : ''; return u && F.kindOf(u) ? u : ''; };
const FORMV = 2;   // 받아 둔 폼의 꼴 — 올리면 다음 제출 준비 때 다시 읽는다
const tested = (db, kind) => !!((db.form_test || {})[kind] || {}).ok;   // 내 시험 폼으로 보내 보고 답이 제대로 들어간 걸 확인했다
const planned = c => !!(c.form && !c.form.error && c.form.v === FORMV && c.draft && c.fplan && c.fplan.sig === c.form.sig && c.fplan.made === c.draft.made);
// 폼 문항 — 제출 준비 때 하루 한 번 다시 읽는다(마감·문항이 바뀌었을 수 있다). 문항이 바뀌면 답 계획과 동의 답을 버린다
// 요강에 폼 주소가 없으면 원문·같이 올라온 사이트·주최 페이지에 걸린 폼 링크에서 찾는다 — 제목이 이 공모전과 닮은, 받는 중인 폼이 하나일 때만 쓴다(하루 한 번)
// 이 공모전의 폼인가 — 제목이 닮았거나, 제목·주최의 고유한 낱말(KUSF, 기관 이름)을 폼 제목이 같이 쓰고 응모를 받는 폼일 때
const STOPW = /^(공모전?|슬로건|네이밍|명칭|표어|이름|브랜드|대국민|전국민|이벤트|모집|신청서?|접수|참가|온라인|제\d+회|및|위한|공식|주제)$/;
const words = t => new Set(String(t || '').replace(/[^\w가-힣]+/g, ' ').split(' ').filter(w => w.length >= 2 && !/^\d+$/.test(w) && !STOPW.test(w)));
function related(c, fm){
  if (E.similar(titleOf(c.title), fm.title)) return true;
  const mine = words(`${c.title} ${c.organizer || ''}`), both = [...words(fm.title)].filter(w => mine.has(w));
  return (both.some(w => w.length >= 3) || both.length >= 2) && /공모|슬로건|네이밍|명칭|표어|응모|작품/.test(`${fm.title} ${fm.description}`);
}
async function findForm(c){
  const f = c.fit, u = E.urlOf(f.submit.to);
  if (!['form', 'nform', 'oform'].includes(f.submit.method) || (u && F.kindOf(u))) return;
  if (c.form_found && String(c.form_found.at).slice(0, 10) === AT.slice(0, 10)) return;
  const home = E.urlOf(String(c.homepage || '').split('#')[0]), seen = new Set(), hit = [];
  for (const [page, robots] of [[c.url, false], ...(c.also || []).slice(0, 3).map(a => [a.url, false]), ...(home ? [[home, true]] : [])])
    for (const l of await S.fetchFormLinks(page, { robots }).catch(() => [])){
      if (seen.has(l) || seen.size >= 8) continue;
      seen.add(l);
      const fm = await F.readForm(l).catch(() => null);
      if (fm && !fm.error && fm.open && related(c, fm) && !hit.some(h => h.id === fm.id)) hit.push({ id: fm.id, url: fm.url });
    }
  c.form_found = { at: AT, url: hit.length === 1 ? hit[0].url : '', others: hit.length > 1 ? hit.map(h => h.url).slice(0, 4) : [] };
  if (c.form_found.url){ f.submit.to = c.form_found.url; E.fixMethod(f.submit); }
}
async function formOf(c, again){
  await findForm(c);
  const url = formUrl(c.fit);
  if (!url){ delete c.form; delete c.fplan; return null; }
  if (c.form && !again && c.form.v === FORMV && c.form.src === url && String(c.form.at).slice(0, 10) === AT.slice(0, 10)) return c.form;
  const r = await F.readForm(url).catch(e => ({ error: e.message }));
  if (r.error) return c.form = { src: url, at: AT, v: FORMV, error: E.str(r.error, 200) };
  if (c.fplan && c.fplan.sig !== r.sig){ delete c.fplan; delete c.fconsent; }
  return c.form = { ...r, src: url, at: AT, v: FORMV };
}
// AI에게 보일 폼 글 — 문항마다 [id] (유형 · 필수) 제목, 아래에 설명과 보기
const formText = fm => [`폼: ${fm.title} (${FORM[fm.kind]})`, E.str(fm.description, 1500), '',
  ...fm.questions.flatMap(q => [`[${q.id}] (${[QTYPE[q.type] || q.type, q.required ? '필수' : '선택', q.limit ? `${q.limit}자 이내` : '', q.field ? `${{ name: '이름', phone: '전화번호', email: '이메일' }[q.field]} 칸` : ''].filter(Boolean).join(' · ')}) ${E.str(q.title, 200)}`,
    ...(q.desc ? [`    설명: ${E.str(q.desc, 600)}`] : []), ...(q.rule ? [`    규칙: ${E.str(q.rule, 200)}`] : []), ...((q.rows || []).length ? [`    행${q.many ? '(행마다 여러 개 고를 수 있음)' : ''}: ${q.rows.map(o => E.str(o, 80)).join(' | ')}`] : []),
    ...(q.options.length ? [`    보기: ${q.options.map(o => E.str(o, 120)).join(' | ')}${q.other ? ' | (직접 입력)' : ''}`] : [])])].join('\n').slice(0, 24000);
// 유형에 맞는 꼴로 — 날짜는 2026-11-10(내 정보에 '1990.1.5'로 적혀 있어도), 숫자는 숫자만
const shapeOf = (q, v) => q.type === 'date' ? ((v.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/) || v.match(/^(\d{4})(\d{2})(\d{2})$/) || []).slice(1).map((x, i) => i ? x.padStart(2, '0') : x).join('-') || v) : q.type === 'number' ? v.replace(/[^\d.-]/g, '') : v;
// 보기 가운데 하나로 — '남'이라 적어도 보기 '남성'을 고른다(하나로 정해질 때만)
const snap = (q, v) => { if (!q.options.length || q.options.includes(v) || !v) return v; const near = q.options.filter(o => loose(o).includes(loose(v)) || loose(v).includes(loose(o))); return near.length === 1 ? near[0] : v; };
// 폼에 넣을 답 — 고른 안 하나로. 동의 문항은 내가 동의로 답하라고 했을 때만 채운다. 내 정보가 들어 있어 저장하지 않고 그때그때 만든다
function formSheet(c, me, ans){
  const cand = pickIdx(c)[0], missing = new Set(), answers = {}, rows = [];
  for (const q of c.form.questions){
    const a = c.fplan.answers.find(x => x.id === q.id), on = a && (!a.consent || c.fconsent === 'yes');
    let v = on ? resolve(a.text, { c, cand, me, ans, missing, extras: c.fplan.extras }).trim() : '';
    if (a && a.format === 'digits') v = v.replace(/\D/g, '');
    const many = LINES.has(q.type) ? v.split('\n').map(x => q.type === 'multi' ? snap(q, x.trim()) : x.trim()).filter(Boolean) : null;
    if (!many) v = snap(q, shapeOf(q, v));
    answers[q.id] = many || v;
    rows.push({ q, value: many ? many.join('\n') : v, consent: !!(a && a.consent) });
  }
  // 답에 따라 건너뛰는 문항은 보내지 않는다
  const on = new Set(F.visible(c.form, answers));
  for (const r of rows) if (!on.has(r.q.id)){ r.off = true; r.value = ''; delete answers[r.q.id]; }
  return { answers, rows, missing: [...missing] };
}
// 여기서 바로 제출하지 못하는 이유 — 비어 있으면 [폼 제출하기]를 둔다
function formGate(db, c, sheet){
  const fm = c.form, why = [...(fm.blockers || [])];
  if (sheet.rows.some(r => r.consent) && c.fconsent !== 'yes') why.push('동의 문항에 답하지 않기로 해서, 폼을 열어 직접 내야 해요');
  if (!why.length) why.push(...F.checkAnswers(fm, sheet.answers).map(t => String(t).replace(/\bq(\d+)\b/g, '폼 $1')));
  if (c.deadline && c.deadline < TODAY) why.push('마감이 지났어요');
  if (!why.length && !tested(db, fm.kind)) why.push(`아직 ${FORM[fm.kind]} 제출을 시험하지 않았어요. 맨 아래 '폼 제출 시험'에서 내가 만든 시험 폼으로 한 번 보내 보면 [폼 제출하기]가 켜져요(제출은 되돌릴 수 없어서 먼저 확인해요)`);
  return why;
}
// 확인 없이 제출해도 되는 경우 — 시험을 통과한 종류의 폼이고, 막는 이유·AI 제한·조건 의문이 없고, 지난 제출이 불확실하지 않을 때만
const formAutoOk = (db, c, me) => { const f = c.fit; return !c.form_doubt && !c.formed &&(!f.ai || f.ai.rule === 'none') && f.eligibility.ok === 'yes' && !f.doubt && !f.unreadable && !formGate(db, c, formSheet(c, me, readJSON(ANSWERS(c), {}))).length; };
/* 브라우저로 내기 — 홈페이지 접수, 그리고 로그인·파일 올리기 때문에 여기서 바로 못 내는 폼. AI 에이전트가 pkm 전용 브라우저로 접수 화면을 읽고 채워 제출한다 */
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
function browsable(c){
  const f = c.fit, s = f.submit, u = E.urlOf(s.to);
  if (f.unreadable || (c.deadline && c.deadline < TODAY)) return null;
  if (s.method === 'site' && u && S.isPublicUrl(u)) return { url: u, kind: 'site' };
  if (c.form && !c.form.error && c.form.url && ((c.form.blockers || []).length || c.form.login) && !(c.form.kind === 'google' && c.form.login)) return { url: c.form.url, kind: 'form' };   // 구글 로그인이 필요한 폼은 이 브라우저에서 로그인이 막힌다 — 직접 낸다
  return null;
}
// 자리표시 가운데 응모작·AI가 쓴 글·날짜만 값으로 바꾸고 내 정보는 {{이름}} 그대로 둔다 — 에이전트에게 보이는 글
const forAgent = (text, c, cand, extras) => String(text).replace(/\{\{([^{}]+)\}\}/g, (m, raw) => {
  const k = raw.trim(), x = c.draft.items[cand], e = ((extras || []).find(v => v.cand === cand) || { values: [] }).values.find(v => loose(v.name) === loose(k));
  return DATE[k] ? DATE[k] : /^(작품|작품명|응모작)$/.test(k) ? x.text : /^(뜻풀이|의미|설명)$/.test(k) ? x.why : e ? e.value : `{{${k}}}`;
});
// 에이전트가 쓸 자리표시 — 내 정보 그대로, 그리고 칸의 꼴에 맞춘 것(연락처 숫자만·세 칸, 이메일 아이디·도메인, 생년월일 8자리…). 값은 프로그램만 안다
function meVars(me){
  const v = Object.fromEntries(me), two = x => String(x).padStart(2, '0');
  for (const [a, b] of me){
    if (/연락처|전화|휴대|핸드폰/.test(a)){
      const d = b.replace(/\D/g, ''), m = d.match(/^(\d{2,3})(\d{3,4})(\d{4})$/);
      if (d.length >= 9) v[`${a} 숫자만`] = d;
      if (m) Object.assign(v, { [`${a} 하이픈`]: m.slice(1).join('-'), [`${a} 앞`]: m[1], [`${a} 가운데`]: m[2], [`${a} 끝`]: m[3] });
    }
    if (/이메일|e-?mail|메일/i.test(a) && /^[^@\s]+@[^@\s]+$/.test(b)) Object.assign(v, { [`${a} 아이디`]: b.split('@')[0], [`${a} 도메인`]: b.split('@')[1] });
    const day = /생년|생일/.test(a) && b.match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
    if (day) Object.assign(v, { [`${a} 8자리`]: `${day[1]}${two(day[2])}${two(day[3])}`, [`${a} 하이픈`]: `${day[1]}-${two(day[2])}-${two(day[3])}`, '태어난 해': day[1], '태어난 달': String(+day[2]), '태어난 날': String(+day[3]) });
  }
  return v;
}
// 이 공모전에 대해 받은 답 — 내 정보(이름·주소 같은)는 자리표시로 숨기고, 고르는 답(조합원 여부 같은)은 화면의 보기와 맞춰야 하니 글 그대로 준다
const answered = c => { const a = readJSON(ANSWERS(c), {}), mine = {}, open = {}; for (const [k, v] of Object.entries(a)) (PERSONAL.test(k) || BANK.test(k) ? mine : open)[k] = v; return { mine, open }; };   // 계좌는 이 공모전의 답이지만 AI에게는 자리표시로만
function browseTask(c, bro, me){
  const f = c.fit, cand = pickIdx(c)[0], x = c.draft.items[cand], files = attachOf(c);
  const plan = bro.kind === 'form' && c.fplan && c.fplan.sig === c.form.sig ? c.form.questions.map((q, i) => { const a = c.fplan.answers.find(v => v.id === q.id);
    return `${i + 1}. ${E.str(q.title, 120)} → ${a && a.text.trim() ? forAgent(a.text, c, cand, c.fplan.extras).replace(/\n/g, ' / ') : '(비워 둠)'}`; }) : [];
  return [`접수 주소: ${bro.url}`, `공모전: ${c.title}`, `주최: ${c.organizer || '-'}`, `마감: ${c.deadline || '요강 확인'} · 오늘: ${TODAY}`, `받는 작품: ${f.kinds.join(', ') || '-'}`, `낼 것: ${f.submit.what || '-'}`,
    `요강의 접수 방법: ${f.submit.how || '-'}`, `양식·주의: ${f.submit.note || '-'}`, `뜻풀이 글자 제한: ${f.submit.desc_limit ? `${f.submit.desc_limit}자` : '요강에 없음(칸의 제한을 따름)'}`, '',
    `응모작: ${x.text}`, `뜻풀이: ${x.why}`, '',
    ...(plan.length ? ['문항별 답 계획(폼을 미리 읽어 세운 것 — 화면의 문항과 맞춰 넣기)', ...plan, ''] : []),
    `쓸 수 있는 자리표시: ${Object.keys({ ...meVars(me), ...answered(c).mine }).map(a => `{{${a}}}`).join(' ') || '(없음)'}`, ...Object.entries(answered(c).open).map(([k, v]) => `사용자가 정한 답 — ${k}: ${v}`), `올릴 수 있는 파일: ${files.map(a => a.filename).join(', ') || '(없음)'}`, '', `요강 원문 일부:\n${E.text(c.brief || '', 1500) || '(없음)'}`].join('\n');
}
const browseOpts = (c, bro, me) => ({ vars: { ...meVars(me), ...answered(c).mine }, files: attachOf(c).map(a => ({ name: a.filename, path: a.path })),
  allow: [...new Set([hostOf(bro.url), hostOf(E.urlOf(String(c.homepage || ''))), ...(bro.kind === 'form' ? ['docs.google.com', 'form.naver.com'] : [])].filter(Boolean))] });
// 확인 없이 브라우저로 내도 되는 경우(완전 자동화) — 조건·AI 제한·요강 의문이 없고, 지난 시도가 불확실하게 끝나지 않았을 때
const browseAutoOk = c => { const f = c.fit; return !(c.sited && c.sited.sent === 'unknown') && !c.formed && !c.mail_sending &&(!f.ai || f.ai.rule === 'none') && f.eligibility.ok === 'yes' && !f.doubt && !f.unreadable; };
async function sendForm(db, c, me){
  if (c.formed) return c.formed;
  const sheet = formSheet(c, me, readJSON(ANSWERS(c), {})), why = formGate(db, c, sheet);
  if (why.length) fail(`폼을 제출하지 않았어요 — ${why[0]}`);
  const r = await F.submitForm(c.form, sheet.answers).catch(e => ({ ok: false, sent: 'unknown', message: e.message }));
  if (r.ok){ c.formed = { at: AT, kind: c.form.kind, id: E.str(r.id || '', 60), sure: r.sure !== false }; delete c.form_doubt; save(db); return c.formed; }
  if (r.sent === 'unknown'){ c.form_doubt = AT; save(db); fail(`${r.message || '보내는 중에 연결이 끊겼어요'} — 제출됐는지 알 수 없어요. 다시 보내면 두 번 들어갈 수 있으니, 폼의 확인 화면이나 주최 쪽 안내를 먼저 확인해 주세요`); }
  fail(`폼을 제출하지 못했어요 — ${r.message || '이유를 알 수 없어요'}`);
}
function saveDraft(db, c){
  if (blank(args.draft)) return;
  const d = E.normalizeDraft(json(args.draft, 'AI 안'));
  if (!d.items.length) fail('AI 답을 읽지 못했어요. 다시 하면 대부분 돼요');
  const made = `${args.draft.length}:${d.items[0].text}`;
  if (!c.draft || c.draft.made !== made){ c.draft = { ...d, at: AT, made }; delete c.filled; delete c.picks; delete c.plan; delete c.fplan; }
  save(db);
}
// 양식 문서 — 모음 사이트의 첨부, 같이 올라온 다른 사이트의 첨부, 주최 홈페이지 공고의 첨부에서 .hwp·.hwpx를 받아 둔다(제출 준비 때 한 번). 읽지 못하는 파일은 뺀다
async function docsOf(c, again){
  if (c.docs && !again && c.docs.every(d => fs.existsSync(path.join(FILES, d.file)))) return c.docs;
  const D = await docsLib(), site = a => a.key.split(':')[0], home = E.urlOf(String(c.homepage || '').split('#')[0]), names = new Set(), hashes = new Set(), list = [], blocked = [];
  const pools = [async () => c.attachments || [], ...(c.also || []).slice(0, 3).map(a => async () => (await S.fetchDetail({ site: site(a), url: a.url })).attachments || []),
    ...(home ? [async () => S.fetchHomeAttachments(home)] : [])];
  for (const pool of pools) for (const a of await pool().catch(() => [])){
    const key = String(a.name || '').replace(/[\s\[\]()]/g, '').toLowerCase();
    if (list.length >= 5 || a.kind === 'image' || !/\.hwpx?$/i.test(a.name || '') || names.has(key)) continue;
    names.add(key);
    if (a.blocked){ blocked.push({ name: a.name, url: a.url }); continue; }
    try {
      const got = await S.fetchFile(a), hash = crypto.createHash('sha1').update(got.bytes).digest('hex');
      if (hashes.has(hash)) continue;
      hashes.add(hash);
      const name = got.name || a.name, file = `${base(c)}-원본-${list.length + 1}${(path.extname(name) || '.hwp').toLowerCase()}`;
      fs.mkdirSync(FILES, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(FILES, file), got.bytes);
      const m = await D.readDoc(path.join(FILES, file));
      list.push({ name, file, format: m.format });
    } catch { /* 못 받거나 못 읽는 파일은 건너뛴다 */ }
  }
  delete c.plan; delete c.filled; c.blocked = blocked.slice(0, 5);
  return c.docs = list;
}
// AI에게 보일 문서 글 — 고칠 수 있는 자리마다 [id]. 표는 한 행을 ' | '로, 문단이 여럿인 칸은 문단마다 한 줄 더
function docText(m, max = 9000){
  const out = [];
  for (const b of m.blocks){
    if (b.kind !== 'table'){ if (String(b.text || '').trim()) out.push(`[${b.id}] ${E.str(b.text, 600)}`); continue; }
    out.push(`[${b.id}] (표)`);
    for (const row of b.rows){
      out.push(`  ${row.map(cell => `[${cell.id}] ${E.str(cell.text, 200) || '(빈칸)'}`).join(' | ')}`);
      for (const cell of row){ const ps = (cell.paras || []).filter(p => String(p.text || '').trim()); if (ps.length > 1) for (const p of ps) out.push(`    [${p.id}] ${E.str(p.text, 400)}`); }
    }
  }
  return out.join('\n').slice(0, max);
}
async function prep(){
  const db = load(), c = contest(db, args.cid), f = c.fit || fail('요강을 아직 읽지 못했어요. [지금 찾기]를 먼저 해 주세요');
  const docs = await docsOf(c, args.answer === 'regen' && !(c.docs || []).length);
  const fm = await formOf(c, args.answer === 'regen'); save(db);
  const out = c.submitted ? {} : { change: { label: 'AI 안 다시 만들기', value: 'regen', note: 'AI가 안을 새로 만들어요(AI 한 번). 지금 안과 채운 서류는 새 안으로 바뀌어요.' } };   // 이미 낸 공모전은 다시 만들지 않는다
  const found = `${docs.length ? ` · 양식 ${docs.length}개` : ''}${fm ? (fm.error ? ' · 폼을 읽지 못함' : ` · 폼 문항 ${fm.questions.length}개`) : ''}`;
  if (c.draft && args.answer !== 'regen') return { summary: `AI 안 ${c.draft.items.length}개 있음${found}`, need_ai: false, ...out };
  const ctx = [`공모전: ${c.title}`, `주최: ${c.organizer || '-'}`, `받는 작품: ${f.kinds.join(', ') || '-'}`, `낼 것: ${f.unreadable ? '요강을 읽지 못함 — 이름 + 뜻풀이 200자 꼴로' : f.submit.what || '-'}`,
    `1인 응모 건수: ${f.submit.allow}`, `의미 설명 글자 제한: ${f.submit.desc_limit ? `${f.submit.desc_limit}자` : '없음(200자 안팎)'}`, `양식·주의: ${f.submit.note || '-'}`, `시상: ${f.prize.text || '-'}`,
    '신청서 칸(후보마다 채울 것): (없음)', `요강 원문 일부:\n${c.brief || '(없음)'}`].join('\n');
  return { summary: `${args.answer === 'regen' ? 'AI 안 다시 만들기' : 'AI 안 만들기'}${found}`, need_ai: true, ...out, _ctx: ctx };
}
// 서류: 받아 둔 양식을 읽어 AI가 '어느 자리에 무엇을' 계획하게 한다 — 계획이 없거나 응모작 후보가 바뀌었을 때만
async function papers(){
  const db = load(), c = contest(db, args.cid), f = c.fit;
  saveDraft(db, c);
  const docs = c.docs || [], fm = c.form && !c.form.error ? c.form : null;
  if (!c.draft || (!docs.length && !fm)) return { summary: '양식 문서·폼 없음', need_plan: false, need_fplan: false };
  const need_plan = docs.length > 0 && !(c.plan && c.plan.made === c.draft.made), need_fplan = !!fm && !planned(c);
  const have = [docs.length ? `양식 ${docs.length}개` : '', fm ? `폼 문항 ${fm.questions.length}개` : ''].filter(Boolean).join(' · ');
  if (!need_plan && !need_fplan) return { summary: `${have} · 채울 계획 있음`, need_plan, need_fplan };
  const D = need_plan ? await docsLib() : null, parts = [];
  for (const [i, d] of need_plan ? docs.entries() : []){
    const body = await D.readDoc(path.join(FILES, d.file)).then(m => docText(m), e => `(읽지 못함: ${E.str(e.message, 80)})`);
    parts.push(`### 문서 ${i}: ${d.name}\n${body}`);
  }
  const ctx = [`공모전: ${c.title}`, `주최: ${c.organizer || '-'}`, `찾는 분야의 작품: ${f.kinds.join(', ') || '-'}`, `낼 것: ${f.submit.what || '-'}`, `양식·주의: ${f.submit.note || '-'}`, `오늘 날짜: ${TODAY}`, `찾은 곳: ${[c.source, ...(c.also || []).map(a => a.source)].filter(Boolean).join(', ') || '-'}(공모전 모음 사이트)`,
    `접수 방식: ${E.METHODS[f.submit.method] || '모름'} — ${f.submit.how || '-'}`, `의미 설명 글자 제한: ${f.submit.desc_limit ? `${f.submit.desc_limit}자` : '없음'}`, `요강 원문 일부:\n${E.text(c.brief || '', 2000) || '(없음)'}`].join('\n');
  return { summary: `${have} 읽음`, need_plan, need_fplan, _ctx: ctx, _cands: c.draft.items.map((x, i) => `[${i}] ${x.text} — ${E.str(x.why, 400)}`).join('\n'), _docs: parts.join('\n\n').slice(0, 26000), _form: need_fplan ? formText(fm) : '' };
}
const used = c => c.plan ? c.plan.docs.filter(d => d.use !== 'skip' && (c.docs || [])[d.doc]) : [];
const pickIdx = c => top(c).map(x => c.draft.items.indexOf(x));
const DATE = { 오늘날짜: TODAY, 년: TODAY.slice(0, 4), 월: String(Number(TODAY.slice(5, 7))), 일: String(Number(TODAY.slice(8, 10))), 오늘: `${TODAY.slice(0, 4)}년 ${E.kday(TODAY)}` };
const loose = t => String(t).replace(/[\s()·:,.]/g, '');
// 자리표시({{…}})를 값으로 — 동의 표시·오늘 날짜 → 응모작·뜻풀이 → 후보마다 AI가 쓴 글 → 이 공모전에만 쓴 답 → 제출용 내 정보. 못 채운 이름은 missing에 모으고 빈 글로 둔다
function resolve(text, { c, cand, me, ans, missing, extras }){
  const x = cand == null ? null : c.draft.items[cand], ex = cand == null ? [] : ((extras || (c.plan && c.plan.extras) || []).find(e => e.cand === cand) || { values: [] }).values;
  return String(text).replace(/\{\{([^{}]+)\}\}/g, (m, raw) => {
    const k = raw.trim(), agree = k.match(/^동의\s*:([\s\S]*)\|([\s\S]*)$/);
    if (agree) return c.consent === 'yes' ? agree[1] : agree[2];
    if (DATE[k]) return DATE[k];
    if (/^(도장|날인|인)$/.test(k)) return fs.existsSync(STAMP) ? '[[img:도장]]' : '';
    if (x && /^(작품|작품명|응모작)$/.test(k)) return x.text;
    if (x && /^(뜻풀이|의미|설명)$/.test(k)) return x.why;
    const e = ex.find(v => loose(v.name) === loose(k)); if (e) return e.value;
    if (ans[k]) return ans[k];
    const v = mine(me, k); if (v) return v;
    missing.add(k); return '';
  });
}
function missingOf(c, me, ans){
  const missing = new Set();
  for (const d of used(c)) for (const cand of d.use === 'per_pick' ? pickIdx(c) : [null]) for (const x of d.fills) resolve(x.text, { c, cand, me, ans, missing });
  if (planned(c)) for (const k of formSheet(c, me, ans).missing) missing.add(k);
  return [...missing];
}
// 정보: 양식을 채우는 데 모자란 것을 묻는다 — 동의 표시(내가 고른다) → 양식에 필요한데 없는 내용. 답은 프로필 데이터에 둔다
async function info(){
  const db = load(), c = contest(db, args.cid);
  if (!blank(args.plan) && c.draft){ c.plan = { ...E.normalizePlan(json(args.plan, '양식을 채울 계획'), (c.docs || []).length, c.draft.items.length), made: c.draft.made, at: AT }; delete c.filled; delete c.skipped; save(db); }
  if (!blank(args.fplan) && c.draft && c.form && !c.form.error){ c.fplan = { ...E.normalizeFormPlan(json(args.fplan, '폼 답 계획'), c.form, c.draft.items.length), made: c.draft.made, sig: c.form.sig, at: AT }; save(db); }
  if (!used(c).length && !planned(c)) return { summary: '채울 양식·폼 없음' };
  let answer = blank(args.answer) ? '' : String(args.answer).trim();
  if (/^consent:(yes|no)$/.test(answer)){ c.consent = answer.slice(8); delete c.filled; save(db); answer = ''; }
  if (/^fconsent:(yes|no)$/.test(answer)){ c.fconsent = answer.slice(9); save(db); answer = ''; }
  const agree = used(c).filter(d => d.fills.some(x => /\{\{\s*동의\s*:/.test(x.text)));
  // '동의 문항은 묻지 않고 동의로' 설정 — 내가 켜 둔 대로 답하고, 그렇게 했다는 걸 남긴다
  if ((args.consent_auto !== 'false' || FULL) && !answer){
    if (agree.length && !c.consent){ c.consent = 'yes'; c.consent_auto = AT; delete c.filled; }
    if (planned(c) && c.fplan.answers.some(a => a.consent && a.text.trim()) && !c.fconsent){ c.fconsent = 'yes'; c.consent_auto = AT; }
    save(db);
  }
  if (agree.length && !c.consent && !answer) return { summary: '동의 표시 묻기', verdict: { tone: 'ok', title: `${agree.map(d => d.title).join(' · ')}에 동의 표시가 있어요`, text: '내용을 읽어 보고 정해 주세요. 동의 표시는 내가 고른 대로만 해요' },
    findings: agree.map(d => ({ where: d.title, title: c.docs[d.doc].name, text: '주최가 준 원본이에요. 미리 보기로 무엇에 동의하는지 읽어 보세요', file: c.docs[d.doc].file })),
    ask: { question: "동의서에 '동의함'으로 표시할까요?", hint: "표시하기 → 채운 서류의 '동의함' 칸에 표시해요\n표시하지 않기 → 동의 칸은 비워 두고 나머지만 채워요. 내려받아 직접 표시할 수 있어요",
      choices: [{ value: 'consent:yes', label: '동의함으로 표시하기' }, { value: 'consent:no', label: '표시하지 않기' }] } };
  // 폼의 동의·서약 문항 — 무엇에 어떻게 답할지 보여 주고 내가 정한다
  const fcons = planned(c) ? c.fplan.answers.filter(a => a.consent && a.text.trim()) : [];
  if (fcons.length && !c.fconsent && !answer) return { summary: '폼 동의 문항 묻기', verdict: { tone: 'ok', title: `${FORM[c.form.kind]}에 동의·서약 문항이 ${fcons.length}개 있어요`, text: '내용을 읽어 보고 정해 주세요. 동의 문항은 내가 정한 대로만 답해요' },
    findings: [...fcons.map((a, i) => { const q = c.form.questions.find(q => q.id === a.id);
      return { where: `동의 문항 ${i + 1}`, title: E.cut(q.title, 80), text: [E.str(q.desc, 600), `넣을 답: ${a.text.replace(/\{\{([^{}]+)\}\}/g, '($1)').replace(/\n/g, ' · ')}`].filter(Boolean).join('\n') }; }),
      { where: '폼에서 전체 읽기', title: E.cut(c.form.title, 60), url: c.form.url }].slice(0, 30),
    ask: { question: '위 문항에 동의하는 것으로 답할까요?', hint: '동의로 답하기 → 폼 답에 위 내용을 넣어요. 제출하기 전에 답 전체를 한 번 더 확인해요\n답하지 않기 → 동의 문항은 비워 둬요. 이 폼은 여기서 제출하지 않고, 폼을 열어 직접 내요',
      choices: [{ value: 'fconsent:yes', label: '동의로 답하기' }, { value: 'fconsent:no', label: '답하지 않기' }] } };
  const me = meOf(), ans = readJSON(ANSWERS(c), {});
  if (answer){   // '항목: 값' 줄들 — 내 정보는 다음 공모전에도 쓰게 기억하고, 그 밖의 답은 이 공모전에만. 비워 둔 항목은 다시 묻지 않는다
    const kept = readKept(), asked = missingOf(c, me, ans), skipped = new Set(c.skipped || []), gm = [], go = [];
    for (const line of answer.split(/\r?\n/)){
      const i = line.search(/[:：]/); if (i < 0) continue;
      const k = asked.find(a => loose(a) === loose(line.slice(0, i))), v = line.slice(i + 1).trim();
      if (!k) continue;
      if (!v) skipped.add(k); else { ans[k] = v; go.push(k); if (keepMine(k)){ kept.제출용[k] = v; gm.push(k); } }
    }
    for (const k of asked) if (!ans[k]) skipped.add(k);
    writeLocal(ANSWERS(c), ans); writeLocal(KEPT, kept); noteGot(gm, c, go);
    c.skipped = [...skipped]; delete c.filled; save(db);
    return { summary: `적은 내용 ${Object.keys(ans).length}개${c.skipped.length ? ` · 비워 둔 것 ${c.skipped.length}개` : ''}` };
  }
  const miss = missingOf(c, me, ans).filter(k => !(c.skipped || []).includes(k));
  if (!miss.length) return { summary: '모자란 내용 없음' };
  // 고르는 문항에 들어갈 내용이면 보기를 알려 준다
  const opts = planned(c) ? miss.map(k => { const a = c.fplan.answers.find(a => a.text.includes(`{{${k}}}`)), q = a && c.form.questions.find(q => q.id === a.id); return q && q.options.length ? `${k} 보기: ${q.options.map(o => E.cut(o, 30)).join(' / ')}` : ''; }).filter(Boolean) : [];
  const what = used(c).length && planned(c) ? '양식·폼' : planned(c) ? '폼' : '양식';
  return { summary: '모자란 내용 묻기', verdict: { tone: 'ok', title: `${what}에 들어갈 내용 ${miss.length}개가 모자라요`, text: miss.join(' · ') },
    ask: { question: `${what}에 넣을 내용을 적어 주세요`, free: true, value: miss.map(k => `${k}: `).join('\n'),
      hint: [...opts, ''].join('\n') + "줄마다 ':' 뒤에 적어요. 비워 두면 그 자리는 빈칸으로 남아요(다시 묻지 않아요)\n이름·연락처 같은 내 정보는 내 데이터에 기억해서 다음 공모전과 다른 기기에서도 써요. AI에게 보내지 않아요" } };
}
// 채우기: 계획대로 문서를 채워 프로필 데이터의 files/에 둔다 — 응모작마다 내는 문서는 고른 안마다 한 부씩
async function fill(){
  const db = load(), c = contest(db, args.cid);
  return { summary: await fillDocs(db, c), forget: ['정보'] };   // 앞 단계에서 적은 내 정보를 실행 기록에서 지운다
}
async function fillDocs(db, c){
  if (!used(c).length || !c.draft){ c.filled = []; save(db); return '채울 양식 없음'; }
  const D = await docsLib(), me = meOf(), ans = readJSON(ANSWERS(c), {}), out = [];
  for (const d of used(c)) for (const cand of d.use === 'per_pick' ? pickIdx(c) : [null]){
    const src = c.docs[d.doc], missing = new Set(), name = cand == null ? '' : c.draft.items[cand].text, o = { title: d.title, cand: name, hand: d.hand, manual: d.manual };
    const set = Object.fromEntries(d.fills.map(x => [x.id, resolve(x.text, { c, cand, me, ans, missing })]));
    const file = `${base(c)}-${safe(name ? `${d.title}_${name}` : d.title)}${path.extname(src.file)}`;
    const stamped = Object.values(set).some(v => v.includes('[[img:도장]]'));
    try { const r = await D.writeDoc(path.join(FILES, src.file), path.join(FILES, file), { set, drop: d.drop, images: stamped ? { 도장: { file: STAMP, mm: 14 } } : {} }); out.push({ ...o, file, stamped, missing: [...missing], skipped: r.skipped.length }); }
    catch (e) { out.push({ ...o, file: '', missing: [], skipped: 0, error: E.str(e.message, 200) }); }
  }
  c.filled = out; save(db);
  const bad = out.filter(o => o.error).length, gap = out.filter(o => o.missing.length).length;
  return `서류 ${out.length - bad}개${bad ? ` · 못 채운 것 ${bad}개` : ''}${gap ? ' · 빈칸 있음' : ''}`;
}
// 메일에 붙일 파일 — 채운 서류(자필 서명이 필요한 것은 빼고)와 보탤 파일 폴더의 파일
const attachOf = c => [...(c.filled || []).filter(o => o.file && (!o.hand || o.stamped)).map(o => ({ path: path.join(FILES, o.file), filename: `${fileName(o.cand ? `${o.title}_${o.cand}` : o.title)}${path.extname(o.file)}` })),
  ...extraFiles(c).map(f => ({ path: f, filename: path.basename(f) }))];
// 요강·양식이 계좌를 요구하는가 — 아니면 메일에 계좌·은행을 넣지 않는다(이름·연락처 같은 나머지는 그대로)
const wantsBank = c => BANK.test([JSON.stringify((c.fit || {}).submit || {}), ...used(c).flatMap(d => [d.title, ...(d.fills || []).map(x => x.text)]), ...(c.fplan && c.form ? c.form.questions.map(q => q.title) : [])].join('\n'));
function mailOf(c, me){
  if (!wantsBank(c)) me = me.filter(([a]) => !BANK.test(a));
  const f = c.fit, picks = top(c), name = mine(me, '이름') || mine(me, '성명') || '';
  const fillT = t => t.replace(/<([^<>]+)>/g, (m, w) => (w === '작품명' ? picks[0] && picks[0].text : mine(me, w)) || m);
  return { to: E.firstEmail(f.submit.to), subject: f.submit.subject ? fillT(f.submit.subject) : `${titleOf(c.title)} 응모${name ? ` - ${name}` : ''}`,
    text: [`안녕하세요. '${c.title}'에 응모합니다.`, '', '응모작', ...picks.flatMap((x, i) => [`${i + 1}. ${x.text}`, ...(x.why ? [`   ${x.why}`] : [])]), '', ...me.map(([a, b]) => `${a}: ${b}`), '',
      ...(attachOf(c).length ? [`첨부: ${attachOf(c).map(a => a.filename).join(', ')}`, ''] : []), '감사합니다.'].join('\n'),
    attachments: attachOf(c) };
}
// 확인 없이 보내도 되는 경우 — 하나라도 걸리면 켜 두어도 묻는다(보낸 메일은 되돌릴 수 없다). 확인창으로 한 번 보내 본 뒤에만(계정 설정이 맞는지 본 뒤)
const autoOk = (db, c) => { const f = c.fit; return !c.mail_sending && all(db).some(x => x.mailed) &&(!f.ai || f.ai.rule === 'none') && f.eligibility.ok === 'yes' && !f.doubt && !f.unreadable && (c.filled || []).every(o => !o.error && !o.hand && !o.manual.length && !o.missing.length && !o.skipped) && !(c.deadline && c.deadline < TODAY)
  && top(c).every(x => !f.submit.desc_limit || x.why.length <= f.submit.desc_limit); };   // 뜻풀이가 글자 제한을 넘으면 실격될 수 있다
// 자동 메일을 보내도 되는 시각 — 한국 시각 08:00~21:00(사람이 직접 누른 것은 시각과 상관없이 보낸다)
const mailHour = () => { const h = new Date(NOW.getTime() + 9 * 3600000).getUTCHours(); return h >= 8 && h < 21; };
// 보내기 전에 '보내는 중'을 먼저 적는다 — 보낸 뒤 꺼지거나 끊겨도 다음 실행이 다시 보내지 않게(A2)
async function mail(db, c, me){
  if (c.mailed) return c.mailed;
  if (c.mail_sending) fail(`지난번 메일이 보내졌는지 확인하지 못했어요(${kst(c.mail_sending.at)}, ${c.mail_sending.to}). 네이버 메일 보낸메일함을 먼저 봐 주세요. 보내졌으면 [직접 냈어요], 안 보내졌으면 [제출 준비]에서 '안 보내졌어요 · 다시 보내기'를 눌러요`);
  const m = mailOf(c, me);
  c.mail_sending = { at: AT, to: m.to }; save(db);
  try { const r = await M.send({ user: process.env.NAVER_ID, pass: process.env.NAVER_APP_PASSWORD, to: m.to, subject: m.subject, text: m.text, attachments: m.attachments }); c.mailed = { at: AT, to: m.to, id: r.messageId }; delete c.mail_sending; save(db); }
  catch (e) { if (!e.unknown){ delete c.mail_sending; save(db); } fail(e.user ? e.message : `메일을 보내지 못했어요(${e.message})`); }
  return c.mailed;
}
// 기억해 둔 값(설정에 적은 것 말고 예전에 받아 둔 내 정보와 이 공모전의 답) — '항목(받은 날)'
function remembered(c){
  const g = readJSON(GOT(), {}), set = new Set(String(args.me || '').split('\n').map(l => l.split('\t')[0].trim()).filter(Boolean));
  const day = d => d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : '받은 날 모름';
  const mineK = Object.keys(readKept().제출용).filter(k => !set.has(k)).map(k => `${k}(${day((g.제출용 || {})[k])})`);
  const own = Object.keys(readJSON(ANSWERS(c), {})).filter(k => !Object.keys(readKept().제출용).includes(k)).map(k => `${k}(${day(((g.답 || {})[base(c)] || {})[k])})`);
  return [...mineK, ...own].slice(0, 12).join(' · ');
}
async function submit(){
  const db = load(), c = contest(db, args.cid), f = c.fit || fail('요강을 아직 읽지 못했어요. [지금 찾기]를 먼저 해 주세요');
  saveDraft(db, c);
  const items = c.draft ? c.draft.items : [], allow = f.submit.allow;
  let answer = blank(args.answer) ? '' : String(args.answer).trim(), pickErr = '';
  // 보낼 안 고르기의 답 — 'pick:0,2'(선택지) 또는 '1, 3'(번호를 적음). 고르면 그 안으로 신청서·메일을 다시 만들어 보인다
  const pm = answer.match(/^pick:([\d,]+)$/), nums = !pm && /^[\d\s,.]+$/.test(answer) ? (answer.match(/\d+/g) || []).map(v => Number(v) - 1) : null;
  if (pm || nums){
    const idx = [...new Set(pm ? pm[1].split(',').map(Number) : nums)];
    const max = planned(c) || (!mailReady(f) && browsable(c)) ? 1 : allow;   // 폼·홈페이지는 한 번에 한 안만 낸다
    if (idx.length && idx.length <= max && idx.every(i => items[i])){ c.picks = idx; delete c.filled; save(db); answer = ''; }
    else { pickErr = `번호를 읽지 못했어요. 1부터 ${items.length}까지에서 ${max}개까지 골라 주세요`; answer = 'repick'; }
  }
  // 준비한 뒤에 메일 접수로 밝혀졌거나 보낼 안을 바꾼 공모전 — 받아 둔 신청서가 있으면 여기서 채운다
  if (!answer && c.plan && !c.filled) await fillDocs(db, c);
  const k = aiTop(c).length, n = E.ddays(c.deadline, TODAY), me = meOf(), ready = mailReady(f), fmode = !ready && planned(c), fname = fmode ? FORM[c.form.kind] : '', bro = !ready && c.draft ? browsable(c) : null, sendable = ready || fmode || !!bro;
  const done = (choice, extra = {}) => {
    if (choice === 'browse'){ c.picks ||= [c.draft.items.indexOf(top(c)[0])]; save(db);   // 다시 낼 때 같은 안으로(다시 묻지 않는다)
      return { summary: '브라우저로 내기', choice, browse: true, ask_names: false, names: top(c)[0].text, ...extra, _task: browseTask(c, bro, me), _browser: browseOpts(c, bro, me) }; }
    if (['mail', 'form', 'yes'].includes(choice)){   // 폼이 확인 화면 없이 끝났으면 '냈어요'로 적지 않는다(A4) — 내가 확인하고 [제출된 걸 확인했어요]를 눌러야 옮긴다
      if (!(choice === 'form' && c.formed && !c.formed.sure)) c.submitted ||= AT;
      if (choice === 'yes') delete c.mail_sending; else c.sent_names = top(c).slice(0, choice === 'form' ? 1 : 99).map(x => x.text); }
    if (choice === 'no') c.dropped = AT;
    save(db);
    return { summary: { mail: '메일 보냄', form: '폼 제출함', yes: '냈어요', later: '나중에', no: '안 내요' }[choice], choice, ask_names: choice === 'yes', names: top(c).map(x => x.text).join('\n'), ...extra };
  };
  if (!answer && (args.auto === 'true' || FULL) && ready && autoOk(db, c)){
    if (!mailHour()){ c.mail_wait = AT; save(db); return { ...done('later'), summary: '아침 8시 이후에 보내요', auto: true, verdict: { tone: 'ok', title: '아침 8시 이후에 보내요', text: '자동 메일은 한국 시각 오전 8시~오후 9시에만 보내요. 그 전에 보내려면 [제출 준비]에서 [메일 보내기]를 눌러요' } }; }
    delete c.mail_wait;
    return done('mail', { auto: true, to: (await mail(db, c, me)).to });
  }
  if (!answer && (args.fauto === 'true' || FULL) && fmode && formAutoOk(db, c, me)){ const sent = await sendForm(db, c, me); return done('form', { auto: true, to: fname, sure: sent.sure }); }
  if (!answer && FULL && bro && browseAutoOk(c) && !(fmode && !formGate(db, c, formSheet(c, me, readJSON(ANSWERS(c), {}))).length)) return done('browse', { auto: true });
  const limits = [`1인 ${allow}건까지`, f.submit.desc_limit && `뜻풀이 ${f.submit.desc_limit}자 이내`].filter(Boolean);
  const cand = (x, i, where) => ({ where, title: x.read ? `${x.text} · ${x.read}` : x.text, note: f.submit.desc_limit ? `뜻 ${x.why.length}/${f.submit.desc_limit}자${x.why.length > f.submit.desc_limit ? ' · 줄여야 해요' : ''}` : `뜻 ${x.why.length}자` });
  const aiRule = f.ai && f.ai.rule !== 'none' ? [{ where: '응모 규칙', ...(f.ai.rule === 'banned' ? { tag: 'AI 작품 제한' } : {}), title: f.ai.rule === 'banned' ? aiLine(f) : 'AI를 썼으면 신청서에 밝혀요',
    text: `${f.ai.text ? `${f.ai.text} — ` : ''}AI 안은 출발점으로 쓰고, 내 손으로 고쳐서 내요` }] : [];
  // 메일로 보낼 공모전은 보낼 안부터 고른다 — 고른 안으로 만든 메일을 확인한 뒤에 보낸다. 고른 적이 없으면 [메일 보내기]를 눌러도 고르는 것부터
  if (sendable && items.length > 1 && answer === 'repick'){
    const web = !fmode && !!bro, one = allow === 1 || fmode || web, ai = aiTop(c), cur = top(c)[0];
    return { summary: '보낼 안 고르기', verdict: { tone: 'ok', title: fmode ? `${fname}에 낼 안을 골라 주세요` : web ? '브라우저로 낼 안을 골라 주세요' : '메일로 보낼 안을 골라 주세요', text: [web ? `고른 안으로 접수 화면을 채워요${allow > 1 ? ' · 한 번에 한 안만 내요' : ''}` : fmode ? `고른 안으로 ${fname} 문항의 답을 만들어요${allow > 1 ? ' · 폼은 한 번에 한 안만 내요' : ''}` : `${E.firstEmail(f.submit.to)}로 보낼 메일을 만들어요`, ...limits].join(' · ') },
      findings: [...aiRule, ...items.map((x, i) => ({ ...cand(x, i, `안 ${i + 1}`), text: x.why }))],
      ask: { question: one ? '어떤 안을 보낼까요?' : `어떤 안을 보낼까요? (${allow}개까지)`,
        hint: [pickErr, web ? '고른 안을 다음 화면에서 보여 줘요. [AI가 브라우저로 내기]를 눌러야 접수 화면을 열어요' : fmode ? '고른 안으로 문항마다 넣을 답을 보여 줘요. 제출하기 전에 한 번 더 확인해요' : `고른 안으로 ${used(c).length ? '메일 본문과 서류를' : '메일 본문을'} 만들어 보여 줘요. 보내기 전에 한 번 더 확인해요`, one ? '' : "여러 개를 고르려면 아래 칸에 번호를 적어요(예: 1, 3). 번호는 위 '안 1', '안 2' 순서예요"].filter(Boolean).join('\n'),
        choices: [...(one ? [] : [{ value: `pick:${ai.map(x => items.indexOf(x)).join(',')}`, label: `AI 추천 ${ai.length}개 · ${ai.map(x => x.text).join(' · ')}`, recommended: true }]),
          ...items.map((x, i) => ({ value: `pick:${i}`, label: one ? x.text : `${x.text}만`, hint: E.cut(x.why, 60), recommended: one && x === cur }))],
        ...(one ? {} : { free: true, placeholder: '여러 개면 번호로: 1, 3' }) } };
  }
  if (answer === 'repick') answer = '';   // 고를 것이 없으면(안이 하나·계정 없음) 그대로 제출 화면으로
  if (!answer){
    const s = f.submit, findings = [...aiRule], split = ['form', 'nform', 'oform', 'site'].includes(s.method), mine = new Set(top(c));
    // 메일로 보낼 수 있으면 고른 안을 '보낼 안'으로, 아니면 AI 추천을 '추천'으로 표시한다
    const sheet = fmode ? formSheet(c, me, readJSON(ANSWERS(c), {})) : null, gate = fmode ? formGate(db, c, sheet) : ['폼 아님'], fcan = !gate.length && !c.formed;   // 이미 보낸 폼은 다시 보내는 선택지를 두지 않는다
    if (fmode || bro) mine.clear(), mine.add(top(c)[0]);
    const canBrowse = !!bro && !fcan && !c.formed, unsureForm = !!(c.formed && !c.formed.sure);
    items.forEach((x, i) => findings.push({ ...cand(x, i, sendable ? (mine.has(x) ? `보낼 안 ${i + 1}` : `안 ${i + 1}`) : i < k ? `추천 ${i + 1}` : `안 ${i + 1}`), ...(fmode ? {} : { copy: split ? x.why || x.text : `${x.text}\n${x.why}`.trim() }) }));   // 폼 답을 보일 때는 아래 '폼 n'에 들어 있다
    // 채운 서류 — 미리 보기로 확인하게. 자필 서명이 필요한데 도장도 없으면 메일에 붙이지 않는다
    if (c.plan && c.plan.note && (c.filled || []).length) findings.push({ where: '서류 메모', text: c.plan.note });
    for (const o of c.filled || []) findings.push({ where: o.title, title: o.cand, ...(o.file ? { file: o.file } : {}),
      text: [o.error ? `채우지 못했어요: ${o.error}` : o.missing.length ? `빈칸으로 둔 것: ${o.missing.join(', ')}` : '채웠어요. 미리 보기로 확인해 주세요',
        o.skipped ? `자리 ${o.skipped}곳은 문서 구조 때문에 채우지 못했어요. 내려받아 직접 채워 주세요` : '',
        o.hand && o.stamped ? '도장 이미지를 넣었어요. 이 문서는 자필 서명 후 스캔을 요구하니, 이대로 낼지 확인해 주세요' : o.hand ? '자필 서명이 필요해서 메일에 붙이지 않아요. 내려받아 서명한 뒤 스캔 파일을 보탤 파일 폴더에 넣어 주세요' : o.stamped ? '도장 이미지를 넣었어요' : '',
        o.manual.length ? `직접 할 일: ${o.manual.join(' · ')}` : ''].filter(Boolean).join('\n') });
    if ((c.docs || []).length && !c.plan) for (const d of c.docs) findings.push({ where: '양식', title: d.name, text: '받아 뒀지만 채우지는 못했어요. 내려받아 직접 채워 주세요', file: d.file });
    for (const a of c.blocked || []) findings.push({ where: '직접 받을 양식', title: a.name, text: '주최 홈페이지가 자동 내려받기를 막아 두었어요. 직접 받아 주세요', ...(E.urlOf(a.url) ? { url: a.url } : {}) });
    const web = E.urlOf(s.to), m = s.method === 'email' ? mailOf(c, me) : null;
    if (m && m.to){
      findings.push({ where: '받는 사람', title: m.to, copy: m.to }, { where: '메일 제목', copy: m.subject, private: true }, { where: '메일 본문', copy: m.text, private: true });
    } else if (s.method === 'email') findings.push({ where: '이메일 주소는 원문에서', title: '이메일로 내요', text: s.how });
    else if (SEND[s.method]) findings.push({ where: s.method === 'form' ? '구글 폼 열기' : s.method === 'nform' ? '네이버 폼 열기' : s.method === 'oform' ? '접수 폼 열기' : '접수 페이지', title: SEND[s.method], text: s.how, ...(web ? { url: web } : {}) });
    else findings.push({ where: '접수 방법', title: '원문에서 확인해 주세요', text: s.how || '요강에 접수 방법이 따로 적혀 있지 않았어요', url: c.url });
    if (ready){   // 메일에 붙일 파일과, 손으로 만든 파일을 더할 폴더(메일을 여기서 보낼 수 있을 때만)
      const at = attachOf(c); fs.mkdirSync(extraDir(c), { recursive: true, mode: 0o700 });
      findings.push({ where: '메일에 붙일 파일', title: at.length ? `${at.length}개` : '없음', text: [at.map(a => a.filename).join('\n'), '서명한 스캔·PDF처럼 직접 만든 파일은 아래 폴더에 넣으면 함께 붙여요'].filter(Boolean).join('\n'), copy: shown(extraDir(c)) });
    }
    if (fmode){   // 폼 문항마다 넣을 답 — 내 정보가 들어 있어 실행이 끝나면 지운다. 동의 문항은 고른 보기만 보인다
      sheet.rows.forEach((r, i) => findings.push({ where: `폼 ${i + 1}${r.q.required ? ' · 필수' : ''}`, title: E.cut(r.q.title, 60),
        ...(r.value ? (r.consent ? { text: `→ ${r.value.replace(/\n/g, ' · ')}` } : { copy: r.value, private: true }) : { text: r.off ? '위 답에서는 건너뛰는 문항이에요' : r.consent && c.fconsent !== 'yes' ? '답하지 않아요(동의 문항)' : r.q.type === 'file' ? '파일은 폼에서 직접 올려요' : r.q.required ? '답이 비었어요' : '비워 둬요(선택 문항)' }) }));
      if (c.consent_auto && c.fconsent === 'yes') findings.push({ where: '동의 문항', text: "설정(완전 자동화 또는 '동의 문항은 묻지 않고 동의로 답하기')에 따라 묻지 않고 동의로 답했어요. 위 '→' 표시가 넣을 답이에요" });
      if (c.fplan.note) findings.push({ where: '폼 메모', text: c.fplan.note });
      if (!fcan){
        findings.push({ where: '폼 제출', title: '여기서 바로 제출하지 않아요', text: gate.join('\n') });
        const safeQ = c.fplan.answers.filter(a => !a.consent && !a.text.replace(/\{\{\s*(작품|작품명|응모작|뜻풀이|의미|설명)\s*\}\}/g, '').replace(/\{\{([^{}]+)\}\}/g, (t, k) => c.fplan.extras.some(e => e.values.some(v => loose(v.name) === loose(k))) ? '' : t).includes('{{')).map(a => a.id);
        const pre = F.prefillUrl(c.form, sheet.answers, { skip: c.form.questions.map(q => q.id).filter(id => !safeQ.includes(id)) });
        if (pre) findings.push({ where: '작품 칸을 채워서 열기', title: `${fname}에 작품과 설명을 미리 넣어 열어요`, text: '이름·연락처 같은 내 정보와 동의 문항은 주소에 남지 않게 뺐어요. 폼에서 직접 넣어 주세요', url: pre });
      }
    } else if (c.form && c.form.error) findings.push({ where: '폼 읽기', title: '폼 문항을 읽지 못했어요', text: `${c.form.error}\n폼을 열어 직접 내 주세요` });
    if (canBrowse){
      const at = attachOf(c);
      findings.push({ where: '브라우저로 내기', title: bro.kind === 'form' ? '로그인한 브라우저로 폼을 채워 제출해요' : 'AI가 접수 화면을 읽고 채워 제출해요',
        text: ['pkm 전용 브라우저에서 접수 화면을 열어 칸을 읽고, 위 안과 내 정보로 채운 뒤 제출해요. 필수 동의 항목에는 동의로 표시해요(홍보·마케팅 수신 같은 선택 동의는 하지 않아요)',
          '로그인·회원가입·본인 인증·캡차가 나오면 멈추고 이 화면의 브라우저에서 직접 하게 넘겨요. 내 정보는 AI에게 보이지 않고 프로그램이 넣어요',
          at.length ? `올릴 수 있는 파일: ${at.map(a => a.filename).join(', ')}` : ''].filter(Boolean).join('\n'), url: bro.url });
      if (c.sited && c.sited.sent !== 'yes') findings.push({ where: '지난 시도', title: c.sited.sent === 'unknown' ? '제출됐는지 확인하지 못했어요' : '내지 못했어요', text: [c.sited.reason, c.sited.proof].filter(Boolean).join('\n') });
    }
    if (c.mail_sending) findings.push({ where: '지난 시도', title: '메일이 보내졌는지 확인하지 못했어요', text: `${kst(c.mail_sending.at)}에 ${c.mail_sending.to}로 보내다가 연결이 끊겼어요. 네이버 메일 보낸메일함을 먼저 봐 주세요\n있으면 [직접 냈어요], 없으면 [안 보내졌어요 · 다시 보내기]` });
    if (unsureForm) findings.push({ where: '지난 시도', title: '제출 요청은 받아들여졌지만 확인 화면은 못 봤어요', text: `${kst(c.formed.at)}에 ${FORM[c.formed.kind] || '폼'}에 보냈어요. 폼 응답이나 주최 안내에서 들어갔는지 확인해 주세요. 다시 보내지는 않아요` });
    for (const u of (c.form_found || {}).others || []) findings.push({ where: '접수 폼 후보', text: '원문에서 이 공모전 폼으로 보이는 것이 여럿이라 고르지 못했어요. 맞는 폼을 열어 직접 내 주세요', url: u });
    if (!m && !fmode){   // 폼·홈페이지 접수는 칸마다 복사해 붙인다(메일이면 본문에 들어 있다)
      const asked = me.filter(([a]) => !s.fields.length || s.fields.some(x => x.includes(a) || a.includes(x)));
      for (const [a, b] of asked.length ? asked : me) findings.push({ where: a, copy: b, private: true });   // 실행이 끝나거나 그만두면 실행기가 지운다
    }
    const rem = remembered(c);
    if (rem) findings.push({ where: '기억한 값', text: `기억한 값으로 채움: ${rem}` });
    findings.push({ where: '공모전 원문', url: c.url });
    const how = SEND[s.method] && !f.unreadable;
    const verdict = n != null && n < 0 ? { tone: 'bad', title: `마감이 지났어요 · ${E.kday(c.deadline)}`, text: '그래도 냈다면 [직접 냈어요]를 눌러요' }
      : { tone: 'ok', title: `${sendable ? `보낼 안 · ${E.cut(top(c).slice(0, fmode ? 1 : 99).map(x => x.text).join(' · '), 40)}` : `AI 안 ${items.length}개`}${c.filled && c.filled.length ? ` · 서류 ${c.filled.length}개` : ''} · ${how ? SEND[s.method] : '낼 방식은 원문에서 확인해 주세요'}`,
        text: f.unreadable ? "요강을 다 읽지 못해서 '이름 + 뜻풀이 200자' 꼴로 만들었어요" : [c.deadline && `마감 ${E.kday(c.deadline)}`, ...limits].filter(Boolean).join(' · ') };
    const repick = sendable && items.length > 1;
    const hint = [ready ? (c.mail_sending ? `안 보내졌어요 · 다시 보내기 → 보낸메일함에 없을 때만 눌러요. ${m.to}에 다시 보내요` : `메일 보내기 → 내 네이버 메일로 ${m.to}에 보내고 '결과 기다리는 공모전'으로 옮겨요`) : '', unsureForm ? "제출된 걸 확인했어요 → 폼 응답에서 확인했으면 '결과 기다리는 공모전'으로 옮겨요" : '',fcan ? `폼 제출하기 → 위 '폼 1, 2…'의 답 그대로 ${fname}에 제출하고 '결과 기다리는 공모전'으로 옮겨요` : '',
      canBrowse ? `AI가 브라우저로 내기 → 접수 화면을 열어 채우고 제출까지 해요. 낸 것이 확인되면 '결과 기다리는 공모전'으로 옮겨요` : '',
      repick ? `보낼 안 다시 고르기 → 다른 안으로 ${fmode ? '폼 답을' : c.filled && c.filled.length ? '메일과 서류를' : '메일을'} 다시 만들어요` : '', `${sendable ? '직접 냈어요' : '냈어요'} → '결과 기다리는 공모전'으로 옮겨요`, '나중에 낼게요 → 그대로 둬요. 만든 안도 남아요',
      "안 낼래요 → '뺀 공모전'으로 옮겨요. 다시 넣을 수 있어요", s.method === 'email' && !ready && m && m.to ? '네이버 아이디·애플리케이션 비밀번호를 플러그인 준비 화면의 비밀값에 넣으면 여기서 바로 보낼 수 있어요' : '',
      hasAccount() && s.method !== 'email' && !fmode ? `[메일 보내기]는 이메일로 받는 공모전에만 나와요 · 이 공모전은 ${SEND[s.method] ? `${E.METHODS[s.method]} 접수예요` : '접수 방법을 요강에서 확인해야 해요'}` : '',
      hasAccount() && s.method === 'email' && !(m && m.to) ? '접수 메일 주소를 요강에서 찾지 못해 [메일 보내기]를 둘 수 없어요. 원문에서 주소를 확인해 직접 보내 주세요' : ''].filter(Boolean).join('\n');
    // 내가 할 일만 남기고, 이미 자동으로 채운 것은 접어 둔다(펼치면 그대로 보인다). 여기서 못 내는 접수(직접 복사해 내야 함)는 고른 안과 복사할 것을 그대로 보인다
    const NEED = new Set(['응모 규칙', '폼 제출', '폼 읽기', '지난 시도', '접수 폼 후보', '직접 받을 양식', '양식', '접수 방법', '이메일 주소는 원문에서']);
    const mineNow = top(c).slice(0, fmode || bro ? 1 : 99);
    for (const [i, x] of findings.entries()){
      const cand = i >= aiRule.length && i < aiRule.length + items.length ? items[i - aiRule.length] : null;
      const todo = NEED.has(x.where) || /답이 비었어요|채우지 못했어요|빈칸으로 둔|직접 할 일|자필 서명|직접 채워/.test(x.text || '');
      if (cand ? !mineNow.includes(cand) : sendable && !todo) x.fold = true;
    }
    return { summary: '냈는지 묻기', verdict, fold_label: '자동으로 채운 것', findings: findings.slice(0, 45), ask: { question: `냈나요? · ${n == null ? '마감일 요강 확인' : n < 0 ? `마감 지남 (${E.kday(c.deadline)})` : `마감 ${n === 0 ? '오늘' : `D-${n}`} (${E.kday(c.deadline)})`}`, hint,
      choices: [...(ready ? [c.mail_sending ? { value: 'mailretry', label: '안 보내졌어요 · 다시 보내기' } : { value: 'mail', label: '메일 보내기', recommended: true }] : []),
        ...(fcan ? [{ value: 'form', label: '폼 제출하기', recommended: true, ...(c.form_doubt ? { confirm: '지난번 제출이 됐는지 확인하지 못했어요. 이미 들어갔다면 두 번 내게 돼요' } : {}) }] : []),
        ...(canBrowse ? [{ value: 'browse', label: 'AI가 브라우저로 내기', recommended: true, ...(c.sited && c.sited.sent === 'unknown' ? { confirm: '지난번에 제출됐는지 확인하지 못했어요. 이미 들어갔다면 두 번 내게 돼요' } : {}) }] : []),
        ...(repick ? [{ value: 'repick', label: '보낼 안 다시 고르기' }] : []), unsureForm ? { value: 'yes', label: '제출된 걸 확인했어요', recommended: true } : { value: 'yes', label: sendable ? '직접 냈어요' : '냈어요', recommended: !ready && !fcan && !canBrowse },{ value: 'later', label: '나중에 낼게요' }, { value: 'no', label: '안 낼래요' }] } };
  }
  if (!['mail', 'mailretry', 'form', 'browse', 'yes', 'later', 'no'].includes(answer)) fail('모르는 답이에요');
  if (answer === 'browse'){ if (!bro) fail('이 공모전은 브라우저로 낼 접수 주소가 없어요. 원문에서 접수 방법을 확인해 주세요'); return done('browse'); }
  if (answer === 'form'){
    if (!fmode) fail('이 공모전은 여기서 폼을 제출할 수 없어요. 폼을 열어 직접 내 주세요');
    const sent = await sendForm(db, c, me);
    return done('form', { to: fname, sure: sent.sure });
  }
  if (answer === 'mail' || answer === 'mailretry'){
    if (!ready) fail('네이버 아이디와 애플리케이션 비밀번호를 비밀값에 넣어야 메일을 보낼 수 있어요');
    if (answer === 'mailretry') delete c.mail_sending;   // 보낸메일함에 없다고 확인했다
    return done('mail', { to: (await mail(db, c, me)).to });
  }
  return done(answer);
}
// 브라우저 에이전트의 결과를 적는다 — 낸 것이 확실할 때만 '냈어요'. 아니면 이유를 보이고 어떻게 할지 묻는다
function browsed(){
  const db = load(), c = contest(db, args.cid), a = blank(args.answer) ? '' : String(args.answer);
  const mark = () => { c.submitted ||= AT; c.sent_names = top(c).slice(0, 1).map(x => x.text); };
  // 브라우저에서 내다가 물어서 받은 값(이름 → 값) — 내 정보는 다음 공모전에도, 그 밖의 답(조합원 여부·계좌 같은)은 이 공모전에만
  if (!blank(args.given)){ const g = json(args.given, '받은 내용'), kept = readKept(), ans = readJSON(ANSWERS(c), {}), gm = [], go = [];
    for (const [k0, v] of Object.entries(g && typeof g === 'object' ? g : {})){ const k = String(k0).slice(0, 40);
      if (k && typeof v === 'string' && v.trim()){ if (keepMine(k)){ kept.제출용[k] = v.trim().slice(0, 400); gm.push(k); } else { ans[k] = v.trim().slice(0, 400); go.push(k); } } }
    if (gm.length) writeLocal(KEPT, kept);
    if (go.length) writeLocal(ANSWERS(c), ans);
    noteGot(gm, c, go); }
  const again = { step: '제출', value: 'browse' };   // 제출 단계부터 다시 — 새로 적은 내 정보를 넣어 브라우저로 다시 낸다
  if (a === 'yes'){ mark(); save(db); return { summary: '냈어요', sent: true }; }
  if (a === 'later') return { summary: '나중에', sent: false };
  if (c.sited && (a === 'retry' || (a && a !== 'yes' && a !== 'later'))){ c.sited.tries = 0; save(db); }   // 사람이 막힌 것을 풀었다 — 스스로 다시 해 보는 횟수를 새로 센다
  if (a === 'retry') return { summary: '브라우저로 다시 내기', sent: false, again };
  if (a){   // 적은 내용('항목: 값' 줄) — 내 데이터에 기억하고 다시 낸다
    const kept = readKept(), ans = readJSON(ANSWERS(c), {}), gm = [], go = []; let n = 0;
    for (const line of a.split(/\r?\n/)){ const i = line.search(/[:：]/), k = i < 0 ? '' : line.slice(0, i).trim().slice(0, 40), v = i < 0 ? '' : line.slice(i + 1).trim().slice(0, 400); if (k && v){ if (keepMine(k)){ kept.제출용[k] = v; gm.push(k); } else { ans[k] = v; go.push(k); } n++; } }   // 내 정보는 다음 공모전에도, 그 밖의 답(계좌 포함)은 이 공모전에만
    if (!n) fail("줄마다 '항목: 값' 꼴로 적어 주세요. 직접 냈거나 나중에 하려면 아래에서 골라요");
    writeLocal(KEPT, kept); writeLocal(ANSWERS(c), ans); noteGot(gm, c, go);
    return { summary: `적은 내용 ${n}개 · 브라우저로 다시 내기`, sent: false, again };
  }
  const raw = json(args.result, '브라우저 제출 결과'), r = E.normalizeBrowse(raw);
  // 러너가 넘긴 마지막 화면 원문(_screen)이 있으면 모델이 고른 proof 대신 그것으로 판정하고, 증거 글도 거기서 완료 문구가 든 줄을 뽑는다
  const screen = [args.screen, raw && raw._screen, raw && raw._result && raw._result._screen].find(s => typeof s === 'string' && s.trim());
  if (screen){ const lines = E.proofLines(screen); if (lines) r.proof = lines; else if (r.sent === 'yes') r.proof = E.text(screen, 300); }
  if (r.sent === 'yes' && !E.proofDone(screen || r.proof)) Object.assign(r, { sent: 'unknown', reason: 'AI는 냈다고 했지만 완료 문구·접수 번호를 확인하지 못했어요' });   // A4 — 증거 없이 '냈어요'로 적지 않는다
  const did =r.did.length ? [{ where: 'AI가 한 일', text: r.did.map((x, i) => `${i + 1}. ${x}`).join('\n') }] : [];
  const tries = (c.sited && c.sited.sent === 'no' ? c.sited.tries ?? 1 : 0) + (r.sent === 'no' && !r.need.length ? 1 : 0);   // 모자란 정보 때문에 멈춘 것은 실패로 세지 않는다
  c.sited = { at: AT, sent: r.sent, reason: r.reason, proof: E.str(r.proof, 300), tries };
  if (r.sent === 'yes'){ mark(); save(db); return { summary: '홈페이지에 냈어요', sent: true, findings: [...(r.proof ? [{ where: '완료 화면', text: r.proof }] : []), ...did] }; }
  save(db);
  if (r.sent === 'no' && !r.need.length && tries < 2) return { summary: `내지 못함 · 스스로 한 번 더 해요(${r.reason ? E.cut(r.reason, 60) : '이유 모름'})`, sent: false, again: { step: '제출', value: 'browse' } };   // A1 — 방법을 되묻지 않고 먼저 다시 해 본다
  const unsure = r.sent === 'unknown';
  return { summary: unsure ? '제출 확인 못 함' : '내지 못함', sent: false, verdict: { tone: 'bad', title: unsure ? '제출됐는지 확인하지 못했어요' : '브라우저로 내지 못했어요', text: r.reason || '이유를 알 수 없어요' },
    findings: [...(r.proof ? [{ where: '마지막 화면', text: r.proof }] : []), ...did, { where: '접수 화면', url: (browsable(c) || {}).url || c.url }],
    ask: unsure ? { question: '접수 화면에서 제출된 것을 확인했나요?', hint: '다시 내면 두 번 들어갈 수 있어요. 접수 화면이나 주최의 확인 메일·문자를 먼저 봐 주세요',
        choices: [{ value: 'yes', label: '제출된 걸 확인했어요' }, { value: 'later', label: '나중에 다시 할게요' }] }
      : r.need.length ? { question: `접수 양식에 넣을 내용 ${r.need.length}개를 한 번에 적어 주세요. 보내면 바로 다시 내요`, free: true, value: r.need.map(k => `${k.name}: `).join('\n'),
        hint: [...r.need.map(k => `${k.name} — ${k.question || '알려 주세요'}${k.options.length ? ` (보기: ${k.options.join(' / ')})` : ''}`), "줄마다 ':' 뒤에 적고 보내요. 이름·주소 같은 내 정보는 내 데이터에 기억해서 다음에는 묻지 않아요. AI에게는 값이 아니라 자리표시만 가요"].join('\n'),
        choices: [{ value: 'yes', label: '직접 냈어요' }, { value: 'later', label: '나중에 다시 할게요' }] }
      : { question: '두 번 해 봤지만 내지 못했어요. 위 이유를 보고 골라 주세요', hint: '직접 냈다면 → 결과 기다리는 쪽으로 옮겨요\n다시 내기 → 막힌 것을 풀었을 때(예: 사이트 회원가입을 해 뒀다)',
        choices: [{ value: 'retry', label: '브라우저로 다시 내기', recommended: true }, { value: 'yes', label: '직접 냈어요' }, { value: 'later', label: '나중에 다시 할게요' }] } };
}
function picked(){
  const db = load(), c = contest(db, args.cid);
  if (blank(args.answer)) return { summary: '낸 안 묻기', ask: { question: '어떤 안을 냈나요?', hint: '고쳐서 냈다면 낸 대로 고쳐 주세요. 발표 뒤 어떤 안이 붙었는지 볼 수 있어요', free: true, value: args.value || '' } };
  c.sent_names = E.lines(String(args.answer).replace(/,/g, '\n')).slice(0, 20); save(db);
  return { summary: `낸 안 ${c.sent_names.length}개` };
}
function finish(){
  const db = load(), c = contest(db, args.cid), ch = args.choice;
  const wait = ch === 'later' && c.mail_wait && !c.submitted; if (c.mail_wait){ delete c.mail_wait; save(db); }
  const v = wait ? { tone: 'ok', title: '아침 8시 이후에 보내요', text: '자동 메일은 한국 시각 오전 8시~오후 9시에만 보내요. 그 전에 보내려면 [제출 준비]에서 [메일 보내기]를 눌러요' }
    : ch === 'mail' ? { tone: 'ok', title: `메일을 보냈어요 · ${E.announceLine(c.fit, TODAY)}`, text: `${proofOf(c)[0].text}\n'결과 기다리는 공모전'에서 발표일 순으로 보여요` }
    : ch === 'form' && c.formed && !c.formed.sure && !c.submitted ? { tone: 'bad', title: '제출됐는지 확인하지 못했어요', text: "폼 응답이나 주최 안내에서 확인한 뒤 [제출 준비]에서 '제출된 걸 확인했어요'를 눌러 주세요. 다시 보내지는 않아요" }
    : ch === 'form' ? { tone: 'ok', title: `폼을 제출했어요 · ${E.announceLine(c.fit, TODAY)}`, text: `${FORM[(c.formed || {}).kind] || '폼'}에 냈어요. '결과 기다리는 공모전'에서 발표일 순으로 보여요` }
    : ch === 'browse' && c.submitted ? { tone: 'ok', title: `냈어요 · ${E.announceLine(c.fit, TODAY)}`, text: `${proofOf(c)[0].text}\n'결과 기다리는 공모전'에서 발표일 순으로 보여요` }
    : ch === 'yes' ? { tone: 'ok', title: `냈어요 · ${E.announceLine(c.fit, TODAY)}`, text: "'결과 기다리는 공모전'에서 발표일 순으로 보여요" }
    : ch === 'no' ? { tone: 'ok', title: '뺐어요', text: "'뺀 공모전'에서 다시 넣을 수 있어요" }
    : { tone: 'ok', title: `그대로 둘게요 · ${E.deadlineLine(c.deadline, TODAY).replace(/ · .*$/, '')}`, text: '다시 [제출 준비]를 누르면 만든 안을 바로 보여요' };
  return { summary: v.title, verdict: v, outcome: { title: wait ? '아침에 보낼 것' : ch === 'browse' ? (c.submitted ? '제출함' : '나중에') : ch === 'form' && !c.submitted ? '확인 필요' : { mail: '보냄', form: '제출함', yes: '냄', no: '뺌' }[ch] || '나중에', text: '' } };
}

/* ---------- 빼기·다시 넣기·결과 ---------- */
function drop(){
  const db = load(), c = contest(db, args.cid);
  c.dropped = AT; save(db);
  return { summary: '뺐어요', outcome: { title: '뺌', text: '' }, verdict: { tone: 'ok', title: '뺐어요', text: "'뺀 공모전'에서 다시 넣을 수 있어요" } };
}
function force(){
  const db = load(), c = contest(db, args.cid);
  delete c.dropped; c.forced = AT; save(db);
  return { summary: '다시 넣었어요', outcome: { title: '넣음', text: '' }, verdict: { tone: 'ok', title: '다시 넣었어요', text: "'낼 공모전'에서 보여요" } };
}
function result(){
  const db = load(), c = contest(db, args.cid);
  if (blank(args.answer)){
    const sent = c.sent_names && c.sent_names.length ? c.sent_names : top(c).map(x => x.text);
    return { summary: '결과 묻기', verdict: { tone: 'ok', title: `${E.announceLine(c.fit, TODAY)} · 낸 안 ${sent.length}개`, text: sent.join(' · ') },
      ask: { question: '결과가 나왔나요?', choices: [{ value: 'won', label: '당선됐어요' }, { value: 'lost', label: '떨어졌어요' }, { value: 'undo', label: '안 낸 걸로 되돌리기' }] } };
  }
  if (args.answer === 'undo'){ delete c.submitted; delete c.result; save(db);
    return { summary: '되돌림', won: false, outcome: { title: '되돌림', text: '' }, verdict: { tone: 'ok', title: '낸 걸 되돌렸어요', text: "'낼 공모전'으로 옮겼어요(마감이 지났으면 목록에 안 보여요)" } }; }
  if (!['won', 'lost'].includes(args.answer)) fail('모르는 결과예요');
  c.result = args.answer; c.result_at = AT; save(db);
  return args.answer === 'won' ? { summary: '당선', won: true }
    : { summary: '낙선', won: false, outcome: { title: '떨어짐', text: '' }, verdict: { tone: 'ok', title: '결과를 적었어요', text: '목록에서 뺐어요' } };
}
function award(){
  const db = load(), c = contest(db, args.cid);
  if (blank(args.answer)) return { summary: '받은 상 묻기', verdict: { tone: 'ok', title: '당선 축하해요!', text: '받은 상을 골라 주세요' }, ask: { question: '어떤 상을 받았나요?', choices: (c.fit ? c.fit.prize.awards : []).slice(0, 8), free: true, placeholder: '예: 장려상 10만원' } };
  c.award = E.str(args.answer, 60); save(db);
  return { summary: c.award, outcome: { title: '당선', text: c.award }, verdict: { tone: 'ok', title: `축하해요! ${c.award}`, text: "'낸 것 · 당선' 기록에 더했어요" } };
}

/* ---------- 메일 계정 시험: 비밀값의 네이버 계정으로 내 주소에 한 통 ---------- */
const selfAddr = () => { const id = String(process.env.NAVER_ID || '').trim(); return id.includes('@') ? id : id ? `${id}@naver.com` : ''; };
function mailList(){
  const db = load(), t = db.mail_test, n = all(db).filter(c => st(c) === 'ready' && mailReady(c.fit)).length;
  return { items: [{ id: 'mail-test', title: '네이버 메일 계정 시험', version: `${t ? t.at : ''}-${n}`, vars: {},
    meta: [t ? `${E.kday(new Date(Date.parse(t.at) + 9 * 3600000).toISOString().slice(0, 10))} ${t.ok ? '보냄' : '실패'}` : '아직 시험하지 않았어요',
      ...(hasAccount() ? [`메일로 바로 보낼 수 있는 낼 공모전 ${n}개${n ? " — '메일로 바로 보내기' 표시가 붙어요" : ''}`] : [])],
    detail: t && !t.ok ? [{ who: '지난 실패', text: t.error }] : [] }] };
}
async function mailTest(){
  const to = selfAddr(), db = load();
  try {
    await M.send({ user: process.env.NAVER_ID, pass: process.env.NAVER_APP_PASSWORD, to,
      subject: '[공모전 신청] 메일 계정 시험', text: ['공모전 신청 플러그인이 보낸 시험 메일이에요.', '', `보낸 때: ${TODAY} ${new Date(NOW.getTime() + 9 * 3600000).toISOString().slice(11, 16)}`, '이 메일이 왔으면 메일 접수 공모전도 이 계정으로 보낼 수 있어요.'].join('\n') });
  } catch (e) {
    const msg = e.user ? e.message : `메일을 보내지 못했어요(${e.message})`;
    db.mail_test = { at: AT, ok: false, error: E.str(msg, 300) }; save(db);
    fail(msg);
  }
  db.mail_test = { at: AT, ok: true }; save(db);
  return { summary: '내 네이버 메일 주소로 보냈어요', verdict: { tone: 'ok', title: '시험 메일을 보냈어요', text: '내 네이버 메일 받은편지함을 확인해 주세요. 안 보이면 스팸함도 봐 주세요' }, outcome: { title: '보냈어요', text: '' } };   // 아이디는 비밀값이라 기록에서 가려진다 — 문구에 넣지 않는다
}

/* ---------- 폼 제출 시험: 내가 만든 시험 폼에 한 번 보내 보고, 답이 제대로 들어갔는지 내가 확인한다 ---------- */
function formTestList(){
  const db = load(), t = db.form_test || {};
  return { items: Object.keys(FORM).map(k => ({ id: `form-test-${k}`, title: `${FORM[k]} 제출 시험`, version: t[k] ? `${t[k].at}${t[k].ok}` : '', vars: { kind: k },
    meta: [!t[k] ? `아직 시험하지 않았어요 — 시험해야 ${FORM[k]} 공모전에 [폼 제출하기]가 나와요` : t[k].ok ? `${E.kday(t[k].at.slice(0, 10))} 확인함 — ${FORM[k]} 공모전에 [폼 제출하기]가 나와요` : `${E.kday(t[k].at.slice(0, 10))} ${t[k].sent ? '보냈지만 답을 확인하지 못했어요' : '보내지 못했어요'}`],
    detail: t[k] && t[k].error ? [{ who: '지난 실패', text: t[k].error }] : [] })) };
}
const testAnswer = q => q.type === 'grid' ? q.rows.map(r => `${r} :: ${q.options[0]}`) : q.type === 'multi' ? q.options.slice(0, 1) : q.options.length ? q.options[0] : q.type === 'date' ? TODAY : q.type === 'time' ? '09:00' : q.type === 'datetime' ? `${TODAY} 09:00` : q.type === 'duration' ? '0:01:00' : q.type === 'number' ? '1' : q.type === 'address' ? '서울특별시 중구 세종대로 110 | 1층' : q.field === 'email' || /이메일|e-?mail/i.test(q.title) ? 'test@example.com' : q.field === 'phone' || /연락처|전화|휴대/.test(q.title) ? '01000000000' : 'pkm 시험';
async function formTest(){
  const kind = args.kind, name = FORM[kind] || fail('모르는 폼 종류예요'), db = load();
  if (blank(args.answer)) return { summary: '시험 폼 주소 묻기', verdict: { tone: 'ok', title: `내가 만든 ${name}에 시험으로 한 번 보내 봐요`, text: '폼 제출은 되돌릴 수 없어요. 공모전에 쓰기 전에, 내 폼으로 답이 제대로 들어가는지 먼저 확인해요' },
    ask: { question: `시험용 ${name} 주소를 붙여 넣어 주세요`, free: true, placeholder: kind === 'google' ? 'https://forms.gle/…' : 'https://form.naver.com/response/…',
      hint: [`1. 내 계정으로 ${name}을 하나 만들어요. 제목에 '시험'이나 '테스트'를 꼭 넣어 주세요(남의 폼에 잘못 보내지 않게 제목을 확인해요)`, '2. 문항은 단답·장문·객관식·동의(체크)를 하나씩 넣으면 충분해요. 로그인 필수와 파일 올리기는 꺼 주세요(이 둘은 여기서 제출하지 못해요)',
        "3. 주소를 붙여 넣으면 글 문항은 'pkm 시험', 고르는 문항은 첫 보기(표는 행마다 첫 열)로 채워 바로 제출해요", '4. 확인하고 싶은 문항 유형(표·점수·날짜·숫자 등)을 넣어 두면 그 유형까지 한 번에 확인돼요'].join('\n') } };
  const url = E.urlOf(String(args.answer).trim());
  if (!url || F.kindOf(url) !== kind) fail(`${name} 주소가 아니에요. 응답용 주소를 붙여 넣어 주세요`);
  const fm = await F.readForm(url).catch(e => ({ error: e.message }));
  if (fm.error) fail(`폼을 읽지 못했어요 — ${fm.error}`);
  if (all(db).some(c => (c.form && c.form.id === fm.id) || (c.fit && c.fit.submit.to && c.fit.submit.to.includes(fm.id)))) fail('공모전 접수 폼이에요. 시험은 내가 만든 폼으로만 해요');
  if (!/시험|테스트|test/i.test(fm.title)) fail(`폼 제목이 "${E.cut(fm.title, 40)}"이에요. 제목에 '시험'이나 '테스트'가 들어간 내 폼으로만 시험해요`);
  if (fm.blockers.length) fail(`이 폼은 바로 제출할 수 없어요 — ${fm.blockers.join(' · ')}`);
  const answers = Object.fromEntries(fm.questions.map(q => [q.id, testAnswer(q)])), bad = F.checkAnswers(fm, answers);
  if (bad.length) fail(`시험 답을 만들지 못했어요 — ${bad.join(' · ')}`);
  const r = await F.submitForm(fm, answers).catch(e => ({ ok: false, sent: 'unknown', message: e.message }));
  db.form_test = { ...db.form_test, [kind]: { at: AT, ok: false, sent: !!r.ok, title: E.cut(fm.title, 60), ...(r.ok ? {} : { error: E.str(r.message || '이유를 알 수 없어요', 300) }) } }; save(db);
  if (!r.ok) fail(`시험 폼에 제출하지 못했어요 — ${r.message || '이유를 알 수 없어요'}`);
  return { summary: '시험 답을 보냈어요', sent: true, verdict: { tone: 'ok', title: `"${E.cut(fm.title, 30)}"에 시험 답을 보냈어요`, text: r.sure === false ? '서버가 받았다고는 했지만 확인 화면은 보지 못했어요. 폼의 응답에서 꼭 확인해 주세요' : '폼의 응답 화면에서 아래 답이 그대로 들어왔는지 확인해 주세요' },
    findings: fm.questions.map((q, i) => ({ where: `문항 ${i + 1}`, title: E.cut(q.title, 60), text: `보낸 답: ${[].concat(answers[q.id]).join(' · ')}` })).slice(0, 40) };
}
function formTestOk(){
  const kind = args.kind, name = FORM[kind] || fail('모르는 폼 종류예요'), db = load(), t = (db.form_test || {})[kind] || fail('먼저 시험 폼에 보내 주세요');
  if (blank(args.answer)) return { summary: '응답 확인 묻기', ask: { question: '내 폼의 응답에 답이 제대로 들어왔나요?', hint: `${kind === 'google' ? "구글 폼 편집 화면의 '응답' 탭" : "네이버 폼의 '결과 보기'"}에서 방금 보낸 답을 확인해 주세요\n한글이 깨지지 않았는지, 고르는 문항과 동의 문항이 맞게 들어갔는지 봐요`,
    choices: [{ value: 'ok', label: '제대로 들어왔어요' }, { value: 'bad', label: '안 들어왔거나 달라요' }] } };
  if (!['ok', 'bad'].includes(args.answer)) fail('모르는 답이에요');
  db.form_test = { ...db.form_test, [kind]: { ...t, ok: args.answer === 'ok', checked_at: AT, ...(args.answer === 'ok' ? {} : { error: '보낸 답이 폼의 응답에 제대로 들어오지 않았어요' }) } }; save(db);
  return args.answer === 'ok' ? { summary: '확인함', outcome: { title: '확인함', text: '' }, verdict: { tone: 'ok', title: `${name} 제출을 확인했어요`, text: `이제 ${name}으로 받는 공모전의 제출 화면에 [폼 제출하기]가 나와요` } }
    : { summary: '확인 못 함', outcome: { title: '안 됨', text: '' }, verdict: { tone: 'bad', title: `${name}은 아직 여기서 제출하지 않을게요`, text: '공모전은 폼을 열어 직접 내 주세요. 어떤 문항이 어떻게 달랐는지 알려 주면 고칠 수 있어요' } };
}

/* ---------- 완전 자동화: 한 번에 켜고 끈다(설정의 '완전 자동화'와 같은 값) ---------- */
// 지금 여기서 바로 낼 수 있는 낼 공모전 — 메일 접수(계정 있음)이거나, 시험을 통과한 종류의 폼이고 막는 이유가 없는 것
const byForm = (db, c) => !!(c.form && !c.form.error && !(c.form.blockers || []).length && tested(db, c.form.kind));
const sendableNow = db => all(db).filter(c => st(c) === 'ready' && (mailReady(c.fit) || byForm(db, c) || browsable(c)));
const viaOf = (db, c) => mailReady(c.fit) ? '메일' : byForm(db, c) ? FORM[c.form.kind] : '브라우저';
function autoList(){
  const db = load(), n = sendableNow(db);
  return { items: [{ id: 'full-auto', title: FULL ? '완전 자동화 켜짐' : '완전 자동화 꺼짐', version: `${FULL}-${n.length}`, vars: {},
    meta: [FULL ? '새 공모전을 찾으면 AI 안 → 서류·폼 답 → 제출까지 묻지 않고 해요' : '지금은 동의 문항·보낼 안·제출을 하나씩 확인받아요',
      `여기서 바로 낼 수 있는 낼 공모전 ${n.length}건${n.length ? ` — ${E.cut(n.map(c => titleOf(c.title)).join(' · '), 90)}` : ''}`] }] };
}
function autoToggle(){
  const db = load(), n = sendableNow(db), a = blank(args.answer) ? '' : String(args.answer);
  if (!a) return { summary: '완전 자동화 묻기', verdict: { tone: 'ok', title: FULL ? '완전 자동화가 켜져 있어요' : '완전 자동화가 꺼져 있어요', text: FULL ? '끄면 다시 동의 문항·보낼 안·제출을 하나씩 확인받아요' : '켜면 아래를 묻지 않고 해요' },
    findings: [{ where: '동의', text: '양식의 동의 표시와 폼의 필수 동의·서약 문항(유의사항 확인, 개인정보 수집·이용, 저작권, 참가 서약)에 동의로 답해요. 필수가 아닌 홍보·마케팅 수신 동의에는 답하지 않아요' },
      { where: '보낼 안', text: 'AI가 첫째로 추천한 안으로 내요(1인 응모 건수만큼)' },
      { where: '제출', text: '메일 접수는 내 네이버 메일로, 구글 폼·네이버 폼 접수는 폼에 바로, 홈페이지 접수와 로그인이 필요한 폼은 AI가 브라우저로 제출해요. 제출은 되돌릴 수 없어요' },
      { where: '그래도 묻는 경우', text: ['양식·폼에 넣을 내 정보가 모자랄 때', 'AI 작품 제한·조건 확인·요강 확인이 붙은 공모전', '자필 서명이나 직접 만들 파일이 필요한 서류', '폼의 필수 문항이 비었거나 글자 수를 넘을 때', '브라우저로 내다가 로그인·회원가입·본인 인증·캡차가 나올 때(그 화면만 직접 해요)', '우편·방문·SNS 접수(직접 내야 해요)'].join('\n') },
      { where: '지금 바로 낼 수 있는 공모전', title: `${n.length}건`, text: n.map(c => `${titleOf(c.title)} · ${viaOf(db, c)}`).join('\n') || '없어요' }],
    ask: { question: FULL ? '완전 자동화를 끌까요?' : '완전 자동화를 켤까요?',
      hint: FULL ? '끄기 → 지금 기다리는 공모전은 그대로 두고, 앞으로는 하나씩 확인받아요' : `켜기 → 기다리고 있는 공모전부터 조건이 맞으면 바로 제출해요(위 ${n.length}건). 새로 찾는 공모전도 같아요\n언제든 여기서 다시 끌 수 있어요`,
      choices: FULL ? [{ value: 'off', label: '완전 자동화 끄기' }, { value: 'keep', label: '켜 둔 채로 두기' }]
        : [{ value: 'on', label: '완전 자동화 켜기', confirm: `켜면 동의 문항에 동의로 답하고, AI가 추천한 안으로 묻지 않고 제출해요. 지금 기다리는 공모전 ${n.length}건부터 바로 나갈 수 있어요. 제출은 되돌릴 수 없어요` }, { value: 'keep', label: '지금처럼 확인하며 하기', recommended: true }] } };
  if (a === 'on') return { summary: '켰어요', settings_patch: { full_auto: true }, outcome: { title: '켬', text: '' }, verdict: { tone: 'ok', title: '완전 자동화를 켰어요', text: "기다리던 공모전을 다시 살펴보고, 조건이 맞는 것부터 제출해요. 낸 것은 '결과 기다리는 공모전'에 보여요" } };
  if (a === 'off') return { summary: '껐어요', settings_patch: { full_auto: false }, outcome: { title: '끔', text: '' }, verdict: { tone: 'ok', title: '완전 자동화를 껐어요', text: '이제 동의 문항·보낼 안·제출을 하나씩 확인받아요' } };
  return { summary: '그대로', outcome: { title: '그대로', text: '' }, verdict: { tone: 'ok', title: FULL ? '켜 둔 채로 둘게요' : '지금처럼 확인하며 할게요', text: '' } };
}

const CMD = { 'auto-list': autoList, 'auto-toggle': autoToggle, 'form-test-list': formTestList, 'form-test': formTest, 'form-test-ok': formTestOk, 'mail-list': mailList, 'mail-test': mailTest, 'find-list': findList, 'open-list': openList, 'sent-list': sentList, 'out-list': outList, find, 'sort-out': sortOut, prep, papers, info, fill, submit, browsed, picked, finish, drop, force, result, award };
async function main(){
  if (argLost) return { error: '앞 단계 결과 파일을 찾지 못했어요(하루가 지나 지워졌을 수 있어요). 앞 단계부터 다시 해 주세요' };
  if (!fs.existsSync(path.join(profile, '_설정.md'))) return { error: `프로필 폴더를 찾지 못했어요: ${profile}` };
  const f = CMD[process.argv[2]];
  if (!f) return { error: `모르는 명령이에요: ${process.argv[2]}` };
  const r = await f();
  return ['find', 'prep'].includes(process.argv[2]) && r && !r.error ? { ...r, ...syncMe() } : r;   // 찾을 때·준비할 때 내 정보를 설정과 데이터 사이에 맞춘다
}
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))){
  let r; try { r = await main(); } catch (e) { r = { error: e.user ? e.message : `처리하다 문제가 생겼어요(${e.message}). 이 단계를 다시 해 주세요` }; }
  process.stdout.write(JSON.stringify(r) + '\n');
}
