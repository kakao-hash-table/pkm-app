#!/usr/bin/env node
// 프로젝트 파일럿 — 목표 한 줄을 서브 프로젝트(카드)·자동 루프·숫자 기록으로 나눠 만들고, 정한 때마다 AI가 돌린다. 결과는 JSON 한 줄.
// 목록(피드)
//   node pilot.mjs new-list | cards-list | projects-list | loops-list | checkins-list
// 설계 워크플로우
//   init --goal=… | --card=<id> [--work-root=~/pkm-projects]   프로젝트를 만든다
//   reopen --pid                                                 고치기 전에 작업 폴더를 다시 잡는다
//   brief --pid --brief=<json> [--answer]                        목표 구체화 저장(거절·꼭 물을 것 하나)
//   context --pid                                                AI에게 줄 맥락(_ctx)·플레이북(_playbook)
//   review --pid --plan=<json> [--auto=true] [--confirm=yes] [--answer]   설계 확인(이대로 만들기·고칠 점)
//   revise --pid --request=…                                     설계 고치기 요청을 반영 단계에 넘긴다
//   build --pid [--plan=<json>]                                  카드·장기·루틴·설계 노트를 만든다(이미 있는 카드는 그대로)
//   kickoff-done --pid                                           AI가 먼저 해 둔 것을 카드에 체크하고 보인다
// 운영 워크플로우
//   loop-prep --pid --loop --period [--work-root]  ·  loop-done --pid --loop --period [--answer=apply|keep|done|skip]
//   checkin --pid --key [--period --date] [--answer | --value]  ·  toggle --pid --to=on|off
// 내가 할 일
//   me-list  ·  me-done --pid --kind=ask|decision|todo --ref   AI가 부탁한 일·정할 것·카드의 🙋 할 일을 한 목록으로
//   me-reject --pid --kind --ref --reason [--answer]   다르게 할래요 — ask는 사유만 남기고 내린다. decision·todo는 사유를 채운 고칠 요청을 받아 설계 고치기로
// 공통: [--profile=폴더] [--now=ISO]
// 같은 단계를 다시 해도(실행기의 [다시 하기]) 카드·기록이 두 번 쓰이지 않게, 쓰는 일은 한 번만 하고 결과는 다시 보여 준다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as E from './engine.mjs';
import * as S from './store.mjs';

// 실행기는 1,800자가 넘는 인자(설계 JSON 등)를 임시 파일에 쓰고 @file:<경로>로 넘긴다 — 그 파일을 읽는다
let argLost = false;
const argValue = v => { const m = /^@file:(\/.+)$/.exec(v); if (!m) return v; try { return fs.readFileSync(m[1], 'utf8'); } catch { argLost = true; return ''; } };
const args = Object.fromEntries(process.argv.slice(3).map(a => a.match(/^--([^=]+)=([\s\S]*)$/)).filter(Boolean).map(m => [m[1], argValue(m[2])]));
const NOW = args.now && !Number.isNaN(Date.parse(args.now)) ? new Date(args.now) : new Date();
const today = E.ymd(NOW);
const fail = msg => { throw Object.assign(new Error(msg), { user: true }); };
const blank = v => v == null || !String(v).trim();
const json = (v, what) => { if (blank(v)) return null; try { return JSON.parse(v); } catch { fail(`${what}을 읽지 못했어요. 앞 단계를 다시 해 주세요`); } };
const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
const ON = v => v === true || /^(true|1|yes|on)$/i.test(String(v || ''));

const profile = S.profileDir(args.profile);
const F = S.folders(profile);
const project = pid => S.loadProject(profile, pid) || fail('프로젝트를 찾지 못했어요. 지워졌거나 다른 기기에서 아직 동기화되지 않았을 수 있어요');
const planned = pid => { const pr = project(pid); if (!pr.plan) fail('아직 설계가 끝나지 않은 프로젝트예요. 새 프로젝트에서 다시 맡겨 주세요'); return pr; };
const loopsOf = pr => pr.loops || [];
const playbook = () => S.readText(path.join(S.pluginDir, 'prompts', '플레이북.md')) || '';
const areaRecords = pr => pr.area ? S.areaRecords(profile, F, pr.area) : [];
const cardsOf = pr => Object.values(pr.cards || {}).map(c => S.readCard(profile, F, c)).filter(Boolean);
const budgetOf = pr => (pr.brief && pr.brief.minutes) || (pr.plan && pr.plan.me_minutes) || 10;
const AFFILIATE = /제휴|쉐어링크|수수료|파트너스|어필리에이트|affiliate|광고비|협찬/i;
const affiliate = pr => AFFILIATE.test(`${pr.goal} ${pr.plan ? pr.plan.strategy + pr.plan.one_liner : ''}`);

// AI에게 줄 맥락 — 작업 폴더의 .pilot/brief.md 로도 남긴다(에이전트가 읽는다)
function writeContext(pr, work){
  const research = work ? S.readText(S.pilotFile(work, 'research.md')) || '' : '';
  const ctx = E.contextMarkdown(pr, { cards: cardsOf(pr), records: areaRecords(pr), now: NOW, research });
  if (work){ S.writeAtomic(S.pilotFile(work, 'brief.md'), ctx + '\n'); S.writeAtomic(S.pilotFile(work, 'playbook.md'), playbook()); }
  return ctx;
}
const workOf = pr => { pr.work = S.workDir(pr, args['work-root'] || '~/pkm-projects'); S.guardWork(pr.work, profile); return pr.work; };
const pubWork = pr => ({ work: pr.work, brief: '.pilot/brief.md', playbook: '.pilot/playbook.md' });

/* ---------- 목록 ---------- */
function newList(){
  const n = S.listProjects(profile).length;
  return { items: [{ id: `new-${n + 1}`, title: '목표 한 줄로 시작하기', meta: ['조사·설계·카드 만들기까지 AI가 해요 · 10~30분'], vars: {} }] };
}
function cardsList(){
  const taken = new Set(S.listProjects(profile).filter(p => p.plan).map(p => p.source && p.source.card).filter(Boolean));   // 그만둔 설계는 카드를 붙잡지 않는다
  return { items: S.flaggedCards(profile, F, taken).map(c => ({ id: c.id, title: c.title, meta: [c.text ? E.str(c.text, 60) : '메모에 #설계'], vars: { card: c.id }, version: sha(c.title + c.text) })) };
}
const STATUS = { running: '운영 중', paused: '멈춤', done: '끝' };
function projectsList(){
  const items = S.listProjects(profile).filter(p => p.plan).map(pr => {
    const cards = cardsOf(pr), todos = cards.flatMap(c => c.todos), m = pr.plan.metric, pg = E.progress(m, areaRecords(pr), NOW);
    return { id: pr.id, title: pr.plan.name, tags: [STATUS[pr.status] || pr.status], vars: { pid: pr.id }, version: pr.updated,
      meta: [`이번 ${E.periodWord(m.period)} ${E.money(pg.sum, m.unit)} / ${E.money(m.target, m.unit)}`, `카드 ${cards.filter(c => c.status === 'done').length}/${cards.length} · 할 일 ${todos.filter(t => t.done).length}/${todos.length}`,
        `루프 ${loopsOf(pr).filter(l => l.on).length}개 · 내 시간 하루 ${E.meMinutes({ loops: loopsOf(pr) })}분`] };
  });
  return { items };
}
// 피로 규칙(플레이북 4-4) — 사람 몫이 있는 루프를 7번 이어서 확인하지 않으면 그 루프를 쉰다. 죄책감 문구 없이 한 줄만 남긴다
const TIRED = 7;
function loopsList(){
  const items = [];
  for (const pr of S.listProjects(profile)){
    if (pr.status !== 'running' || !pr.plan) continue;
    let rested = false;
    for (const l of loopsOf(pr)){
      if (l.on && l.me_minutes && ((pr.unseen || {})[l.key] || 0) >= TIRED){ Object.assign(l, { on: false, auto_off: true, off_why: `${TIRED}번 이어서 확인하지 않아 쉬어요` }); S.logTo(pr, '운영', `${l.title} — 쉬어요(루프 다시 켜기로 켜요)`); rested = true; }
      if (!l.on) continue;
      const d = E.due(l, NOW, F.offdays); if (!d) continue;
      if (pr.started && d.at < new Date(pr.started) && !['daily', 'weekdays'].includes(l.every)) continue;   // 만들기 전에 지난 주·달 회차는 건너뛴다
      items.push({ id: `${pr.id}|${l.key}|${d.period}`, title: l.title, at: d.at.toISOString(),
        meta: [pr.plan.name, E.whenText(l), l.me_minutes ? `내 몫 ${l.me_minutes}분` : 'AI만'], vars: { pid: pr.id, loop: l.key, period: d.period } });
    }
    if (rested) S.saveProject(profile, pr);
  }
  return { items };
}
function checkinsList(){
  const items = [];
  for (const pr of S.listProjects(profile)){
    if (pr.status !== 'running' || !pr.plan) continue;
    for (const c of pr.plan.checkins){
      // 이번 회차가 아직이면 지난 회차를 본다 — 일요일 숫자를 월요일에 적어도 사라지지 않게(다음 회차가 열리면 그쪽으로)
      const sch = { every: c.every, dow: c.dow, day: c.day, at: c.at }, back = new Date(NOW);
      back.setHours(0, 0, 0, 0);
      if (c.every === 'monthly') back.setDate(1); else back.setDate(back.getDate() - ((back.getDay() + 6) % 7));   // 이번 달 1일·이번 주 월요일 0시
      back.setTime(back.getTime() - 1);   // 그 직전 = 지난 회차의 끝
      const d = E.due(sch, NOW) || (E.due(sch, back) && Date.parse(E.due(sch, back).at) >= Date.parse(pr.started || 0) ? E.due(sch, back) : null);
      if (!d || (pr.checked || {})[`${c.key}|${d.period}`]) continue;
      items.push({ id: `${pr.id}|${c.key}|${d.period}`, title: c.question, at: d.at.toISOString(), meta: [pr.plan.name, c.unit ? `단위 ${c.unit}` : ''].filter(Boolean), vars: { pid: pr.id, ck: c.key, period: d.period, date: E.ymd(d.at) } });
    }
  }
  return { items };
}

/* ---------- 내가 할 일 — AI가 부탁한 일, 내가 정할 것, 카드의 🙋 할 일 ---------- */
// 할 일과 볼 파일은 항목 글의 sha(항목 id에 쓰는 값과 같다)로 잇는다 — pr.see[sha] = [작업 폴더 기준 경로]
const meKey = text => sha(E.str(text, 200).replace(/^🙋\s*/u, '').replace(/\s*\(\d+분\)$/, ''));
const SEE_MISS = { missing: '파일이 아직 없어요', outside: '작업 폴더 밖이라 읽지 않았어요', 'not-text': '글 파일이 아니라 여기서 보이지 않아요', linked: '다른 곳과 이어진 파일이라 여기서 보이지 않아요' };
const seeName = f => f.length > 110 ? `…${f.slice(-109)}` : f;   // 피드는 who를 120자로 자른다 — 확장자가 남게 앞을 줄인다
const seeDetail = (work, files) => files.map(f => { const r = S.readWorkFile(work, f); return r.status === 'ok' ? { kind: 'file', who: seeName(f), text: r.text } : { kind: r.status, who: seeName(f), text: SEE_MISS[r.status] }; });
// 아직 열린 내 몫 — ask(AI 요청)·decision(정할 것)·todo(카드 🙋). files는 이어 둔 파일
function openMe(pr){
  const out = [], see = pr.see || {};
  for (const r of (pr.requests || []).filter(r => !r.done && !r.rejected)) out.push({ kind: 'ask', ref: r.id, text: r.text, r, files: see[r.id] || [] });
  for (const d of pr.plan.decisions || []){
    const ref = sha(d); if ((pr.accepted || []).includes(ref) || (pr.rejected_decisions || []).includes(ref)) continue;
    out.push({ kind: 'decision', ref, text: d, files: see[ref] || [] });
  }
  for (const s of pr.plan.subprojects){
    const c = pr.cards[s.key]; if (!c) continue;
    const card = S.readCard(profile, F, c); if (!card || card.status === 'done') continue;
    for (const t of S.openMine(profile, F, c)){
      const h = sha(t.text), planned = s.todos.find(x => x.who === 'me' && x.text === t.text);
      out.push({ kind: 'todo', ref: `${s.key}|${h}`, text: t.text, t, s, files: see[h] || (planned && planned.see) || [] });
    }
  }
  return out;
}
const SEE_HINT = '아래 내용을 보고 끝냈으면 [했어요], 바꾸려면 [다르게 할래요]';
function meList(){
  const items = [];
  for (const pr of S.listProjects(profile)){
    if (!pr.plan || pr.status === 'done') continue;
    const name = pr.plan.name, work = S.workPath(pr, args['work-root']);
    for (const m of openMe(pr)){
      const detail = seeDetail(work, m.files), base = { id: `${pr.id}|${m.kind}|${m.ref}`, title: m.text, vars: { pid: pr.id, kind: m.kind, ref: m.ref }, ...(detail.length ? { detail } : {}) };
      if (m.kind === 'ask'){
        const later = m.r.after && m.r.after > today;
        items.push({ ...base, tags: ['AI 요청'], at: m.r.at, version: m.ref, meta: [name, later ? `${m.r.after.slice(5).replace('-', '/')}부터 할 수 있어요` : '', m.r.why, detail.length ? SEE_HINT : ''].filter(Boolean), _o: later ? 3 : 0 });
      } else if (m.kind === 'decision'){
        items.push({ ...base, tags: ['정할 것'], version: m.ref, meta: [name, `AI가 임시로 정했어요. ${detail.length ? '아래 내용을 보고 ' : ''}이대로 두려면 [했어요], 다르게 하려면 [다르게 할래요]`], _o: 1 });
      } else {
        items.push({ ...base, tags: m.t.minutes ? [`${m.t.minutes}분`] : [], version: sha(m.t.line), meta: [name, detail.length ? SEE_HINT : ''].filter(Boolean), _o: 2 + m.s.wave / 10 });
      }
    }
  }
  return { items: items.sort((a, b) => a._o - b._o).map(({ _o, ...it }) => it) };
}
function meDone(){
  const pr = planned(args.pid), kind = args.kind, ref = String(args.ref || '');
  let what = '';
  if (kind === 'ask'){
    const r = (pr.requests || []).find(x => x.id === ref) || fail('이 요청을 찾지 못했어요. 이미 끝냈을 수 있어요');
    r.done = today; what = r.text;
  } else if (kind === 'decision'){
    const d = (pr.plan.decisions || []).find(x => sha(x) === ref) || fail('이 결정을 찾지 못했어요. 설계가 바뀌었을 수 있어요');
    if (!(pr.accepted ||= []).includes(ref)) pr.accepted.push(ref); what = d;
  } else if (kind === 'todo'){
    const [key, h] = ref.split('|'), c = pr.cards[key] || fail('카드를 찾지 못했어요');
    const t = S.openMine(profile, F, c).find(x => sha(x.text) === h);
    if (!t) return { summary: '이미 끝났어요', verdict: { tone: 'ok', title: '이미 체크돼 있어요', text: '' }, outcome: { title: '했어요', text: '' } };
    if (!S.checkTodo(profile, F, c, t.line, '🙋')) fail('카드에서 이 할 일을 찾지 못했어요');
    what = t.text;
  } else fail('모르는 종류예요');
  S.logTo(pr, '내 일', `했어요: ${E.str(what, 120)}`); S.saveProject(profile, pr);
  return { summary: '했어요', verdict: { tone: 'ok', title: '했어요', text: E.str(what, 200) }, outcome: { title: '했어요', text: '' } };
}
// AI가 결과에 남긴 부탁(me_asks) — 내가 할 일 목록에 올린다. 같은 글은 한 번만
function takeAsks(pr, out, from){
  for (const a of Array.isArray(out && out.me_asks) ? out.me_asks.slice(0, 8) : []){
    const text = E.str(a && (a.text || a), 200); if (text.length < 4) continue;
    const id = sha(text), files = E.seeList(a.files);
    if ((pr.requests ||= []).some(r => r.id === id)){ if (files.length && !(pr.see || {})[id]) linkSee(pr, id, files); continue; }   // 같은 부탁이 다시 와도 비어 있던 파일은 채운다
    pr.requests.push({ id, text, why: E.str(a.why, 160), after: /^\d{4}-\d{2}-\d{2}$/.test(String(a.after || '')) ? a.after : '', from, at: NOW.toISOString(), done: '' });
    if (files.length) linkSee(pr, id, files);
  }
  // 거절한 부탁은 오래돼도 남긴다 — 같은 부탁을 다시 올리지 않게(중복 판정이 이 목록을 본다)
  const reqs = pr.requests || [], keep = reqs.filter(r => r.rejected), rest = reqs.filter(r => !r.rejected).slice(-60);
  pr.requests = reqs.filter(r => keep.includes(r) || rest.includes(r));
}
// AI가 결과에 남긴 이음(me_see) — 🙋 할 일·정할 것·AI 요청 글과 볼 파일. 나중 결과가 앞의 것을 바꾼다
function linkSee(pr, key, files){
  const see = pr.see ||= {}; delete see[key]; see[key] = files;
  for (const k of Object.keys(see).slice(0, -100)) delete see[k];
}
function takeSee(pr, out){
  for (const x of Array.isArray(out && out.me_see) ? out.me_see.slice(0, 12) : []){
    const files = E.seeList(x && x.files); if (x && E.str(x.text) && files.length) linkSee(pr, meKey(x.text), files);
  }
}
// 다르게 할래요 — 사유는 필수. ask는 사유를 남기고 내린다(AI가 다음 루프·설계 고치기에서 대안을 찾는다).
// decision·todo는 "'<내용>' 바꿔 줘. 이유: <사유>"를 채운 고칠 요청을 보여 주고, 사람이 고쳐 보내면 설계 고치기로 넘긴다
const rejectionOf = (pr, kind, ref) => {
  if (kind === 'ask'){ const r = (pr.requests || []).find(x => x.id === ref) || fail('이 요청을 찾지 못했어요. 이미 끝냈을 수 있어요'); return { text: r.text, r }; }
  if (kind === 'decision'){ const d = (pr.plan.decisions || []).find(x => sha(x) === ref) || fail('이 결정을 찾지 못했어요. 설계가 바뀌었을 수 있어요'); return { text: d }; }
  if (kind === 'todo'){
    const [key, h] = ref.split('|'), c = pr.cards[key] || fail('카드를 찾지 못했어요');
    const t = S.openMine(profile, F, c).find(x => sha(x.text) === h) || fail('이 할 일을 찾지 못했어요. 이미 체크했을 수 있어요');
    return { text: t.text, key, line: t.line };
  }
  fail('모르는 종류예요');
};
function meReject(){
  const pr = planned(args.pid), kind = args.kind, ref = String(args.ref || ''), reason = E.str(args.reason, 600);
  if (!reason) fail('바꾸는 이유를 적어 주세요');
  const it = rejectionOf(pr, kind, ref), when = today;
  if (kind === 'ask'){
    it.r.rejected = { reason, at: when };
    (pr.rejections ||= []).push({ kind, text: it.text, reason, at: when });
    S.logTo(pr, '내 일', `안 하기로 함: ${E.str(it.text, 100)} — 이유: ${E.str(reason, 160)}`); S.saveProject(profile, pr);
    return { request: '', summary: '목록에서 뺐어요', verdict: { tone: 'ok', title: '이 부탁은 목록에서 뺐어요', text: `이유: ${reason}\nAI가 다음 작업에서 이 이유를 보고 다른 방법을 찾아요.` }, outcome: { title: '뺐어요', text: '' } };
  }
  const draft = `'${it.text}' 바꿔 줘. 이유: ${reason}`;   // 조사를 빼야 항목 글이 어떻게 끝나도 맞다
  if (blank(args.answer)) return { summary: '고칠 요청을 확인해 주세요', request: '',
    ask: { question: '이렇게 고쳐 달라고 할까요?', hint: '글을 고쳐서 보내도 돼요. AI가 고친 안을 내가 확인해야 반영돼요', free: true, value: draft, placeholder: draft } };
  pr.pending_reject = { kind, ref, text: it.text, reason, key: it.key || '', at: when };
  S.logTo(pr, '내 일', `바꿔 달라고 함: ${E.str(it.text, 100)} — 이유: ${E.str(reason, 160)}`);
  const pass = revisePass(pr, E.str(args.answer, 1500));
  return { ...pass, summary: '고칠 요청을 넘겨요' };
}

/* ---------- 설계 ---------- */
function init(){
  let goal = E.str(args.goal, 2000), source = null, cardText = '';
  if (args.card){
    const c = S.flaggedCards(profile, F).find(x => x.id === args.card) || fail('#설계를 적은 카드를 찾지 못했어요. 카드가 지워졌거나 #설계를 뺐을 수 있어요');
    goal = c.title; cardText = c.text; source = { card: c.id, title: c.title, path: c.path };
  }
  if (!goal) fail('목표가 비어 있어요');
  const pid = 'p' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const pr = { v: 1, id: pid, goal: cardText ? `${goal}\n${cardText}` : goal, source, status: 'designing', created: NOW.toISOString(),
    work_name: `${today.replace(/-/g, '')}-${E.slug(goal, 24)}-${pid.slice(-4)}`, cards: {}, loops: [], log: [] };
  workOf(pr);
  S.logTo(pr, '설계', '목표를 받았어요');
  S.saveProject(profile, pr);
  return { pid, goal: pr.goal, today, ...pubWork(pr), summary: `${E.str(goal, 50)} — 작업 폴더 ${pr.work}` };
}
function reopen(){
  const pr = planned(args.pid);
  workOf(pr); writeContext(pr, pr.work); S.saveProject(profile, pr);
  return { pid: pr.id, goal: pr.goal, today, ...pubWork(pr), summary: '이어서 해요' };
}
function brief(){
  const pr = project(args.pid), b = json(args.brief, '목표 구체화 결과') || {};
  if (b.verdict === 'refuse') return { error: `이 목표는 설계하지 않아요. ${E.str(b.verdict_why, 300) || '플랫폼 규칙이나 법을 어기는 방법밖에 없어 보여요'}` };
  const q = (Array.isArray(b.questions) ? b.questions : []).find(x => x && x.blocking && x.question);   // 꼭 물을 것 하나만. 나머지는 가정으로 채워 설계 확인에서 보인다
  const answers = (pr.brief && pr.brief.answers) || [];
  pr.brief = { goal: E.str(b.goal || pr.goal, 300), metric: E.str(b.metric, 60), target: E.str(b.target, 60), deadline: E.str(b.deadline, 40),
    minutes: Math.max(0, Math.round(Number(b.minutes) || 0)) || null, budget: E.str(b.budget, 60), assets: (b.assets || []).map(x => E.str(x, 120)).slice(0, 8),
    exclude: (b.exclude || []).map(x => E.str(x, 120)).slice(0, 8), assumptions: (b.assumptions || []).map(x => E.str(x, 160)).slice(0, 8),
    verdict: ['ok', 'hard'].includes(b.verdict) ? b.verdict : 'ok', verdict_why: E.str(b.verdict_why, 300), answers };
  if (q && blank(args.answer)){
    S.saveProject(profile, pr);
    return { summary: '확인할 것 하나', ask: { question: E.str(q.question, 200), hint: q.assume ? `모르면 이렇게 가정해요: ${E.str(q.assume, 160)}` : '', choices: [{ value: 'assume', label: '가정대로 진행하기', recommended: true }], free: true, placeholder: q.assume ? `예: ${E.str(q.assume, 60)}` : '' } };
  }
  const a = E.str(args.answer, 600), line = q ? `${E.str(q.question, 200)} → ${a}` : a;
  if (a && a !== 'assume' && !answers.includes(line)) answers.push(line);
  workOf(pr); writeContext(pr, pr.work); S.logTo(pr, '설계', '목표를 다듬었어요'); S.saveProject(profile, pr);
  return { summary: `${pr.brief.goal}${pr.brief.minutes ? ` · 하루 ${pr.brief.minutes}분` : ''}${pr.brief.verdict === 'hard' ? ' · 닿기 어려움' : ''}`, minutes: pr.brief.minutes || 10 };
}
function context(){
  const pr = project(args.pid); workOf(pr);
  const ctx = writeContext(pr, pr.work);
  return { summary: '맥락을 모았어요', minutes: budgetOf(pr), _ctx: ctx, _playbook: playbook() };
}
// 루프 합치기 — 같은 키의 켜고 끔은 사람이 정한 대로 두고, 주간 점검 루프는 늘 붙인다
function mergeLoops(pr, plan){
  const old = Object.fromEntries(loopsOf(pr).map(l => [l.key, l]));
  const keep = l => old[l.key] && old[l.key].user_set ? { ...l, on: old[l.key].on, user_set: true } : l;
  const loops = plan.loops.map(keep);
  if (!loops.some(l => l.kind === 'review')) loops.push(keep({ ...E.REVIEW_LOOP }));
  return loops;
}
// 카드와 이어진 서브 프로젝트는 AI가 빠뜨려도 설계에 남긴다(카드를 고아로 만들지 않게)
function keepCarded(pr, plan){
  for (const s of (pr.plan && pr.plan.subprojects) || []) if (pr.cards[s.key] && !plan.subprojects.some(x => x.key === s.key)) plan.subprojects.push(s);
  return plan;
}
// 설계 확인 — AI가 낸 설계를 다듬어 초안(draft)으로 두고 보인다. 만들기 전에는 카드를 건드리지 않는다
function review(){
  const pr = project(args.pid), raw = json(args.plan, '설계 결과');
  workOf(pr);
  if (raw && Object.keys(raw).length){
    const plan = E.normalizePlan(raw, { minutes: budgetOf(pr) });
    if (!plan.subprojects.length) fail('설계에 서브 프로젝트가 없어요. 앞 단계를 다시 해 주세요');
    pr.draft = keepCarded(pr, plan); S.saveProject(profile, pr);
  }
  if (!pr.draft) fail('확인할 설계가 없어요');
  const view = E.reviewView({ ...pr, plan: pr.draft, loops: mergeLoops(pr, pr.draft) });
  const pass = { _plan: pr.draft, _ctx: writeContext({ ...pr, plan: pr.draft }, pr.work), _playbook: playbook() };
  const confirm = args.confirm === 'yes';
  // 바로 만들기 설정이어도 예산을 넘는 설계는 멈춰서 묻는다
  if (ON(args.auto) && blank(args.answer) && view.verdict.tone !== 'bad') return { ...view, request: '', ...pass, summary: '확인 없이 바로 만들어요' };
  if (blank(args.answer)){
    return { ...view, summary: '설계를 확인해 주세요',
      ask: { question: confirm ? '고친 설계로 바꿀까요?' : '이 설계로 카드를 만들까요?', hint: confirm ? '이미 만든 카드는 그대로 두고, 새 서브 프로젝트만 카드로 더해요. 루프와 설계 노트는 새 설계를 따라요' : '만들면 AI가 첫 작업을 바로 시작해요. 고칠 게 있으면 적어 주세요',
        choices: [{ value: 'build', label: confirm ? '이대로 바꾸기' : '이대로 만들기', recommended: true }], free: !confirm, placeholder: '예: 블로그는 빼고 스레드만, 하루 5분으로' } };
  }
  const build = args.answer === 'build';
  return { ...view, request: build ? '' : E.str(args.answer, 1500), ...pass, summary: build ? '이대로 만들어요' : '고칠 점을 반영해요' };
}
// 이미 있는 카드의 할 일 — 새 설계에 새로 생긴 할 일만 줄로 더한다(사람이 고친 줄·지운 줄은 건드리지 않는다)
function syncTodos(pr, before, after){
  for (const s of after.subprojects){
    const c = pr.cards[s.key], old = before && before.subprojects.find(x => x.key === s.key);
    if (!c || !old) continue;
    const had = new Set(old.todos.map(t => t.text)), add = s.todos.filter(t => !had.has(t.text));
    if (add.length) S.addTodos(profile, F, c, add.map(t => E.todoLine(t)));
  }
}
function revise(){ return { ...revisePass(planned(args.pid), E.str(args.request, 1500)), summary: '고칠 점을 넘겨요' }; }
function revisePass(pr, request){
  // 점검에서 바꾼 루프(pr.loops)를 설계에 담아 넘긴다 — 고치기가 점검 결과를 지우지 않게
  const plan = { ...pr.plan, loops: loopsOf(pr).filter(l => l.kind !== 'review') };
  pr.draft = plan; S.saveProject(profile, pr);
  return { request, _plan: plan, _ctx: writeContext(pr, workOf(pr)), _playbook: playbook() };
}

function build(){
  const pr = project(args.pid), raw = json(args.plan, '고친 설계');
  if (raw && Object.keys(raw).length){
    const next = E.normalizePlan(raw, { minutes: budgetOf(pr) });
    if (!next.subprojects.length) fail('고친 설계가 비어 있어요. [고칠 점 반영]을 다시 해 주세요');
    pr.draft = keepCarded(pr, next);
  }
  const plan = pr.draft || pr.plan || fail('만들 설계가 없어요');
  const first = !pr.plan, made = [], name = plan.name;
  workOf(pr);
  if (!pr.area){   // 장기 — 숫자가 쌓이는 곳(처음 한 번)
    pr.area = S.createArea(profile, F, { title: name, metric: plan.metric.name, unit: plan.metric.unit, why: `${plan.one_liner || pr.goal}\n\n목표: 한 ${E.periodWord(plan.metric.period)} ${E.money(plan.metric.target, plan.metric.unit)}. 프로젝트 파일럿이 숫자를 여기에 쌓아요.` });
    S.saveProject(profile, pr);
    made.push({ where: '장기', title: pr.area.title, text: `${plan.metric.name}(${plan.metric.unit})을 쌓아요` });
  }
  S.findById(profile, F.area, pr.area);   // 이름을 바꿨으면 새 이름으로 잇는다
  const areaTitle = pr.area.title;
  for (const s of plan.subprojects){   // 서브 프로젝트 카드 — 새 것만
    if (pr.cards[s.key]) continue;
    pr.cards[s.key] = S.createCard(profile, F, { title: `${name} · ${s.lens} — ${s.title}`, status: s.wave <= 1 ? 'doing' : 'todo', area: areaTitle, created: today,
      todos: s.todos.map(t => E.todoLine(t)), done: s.done,
      memo: [s.why && `왜: ${s.why}`, s.outcome && `나올 것: ${s.outcome}`, `${E.waveName(s.wave)} · 🤖는 AI가, 🙋는 내가 하는 일이에요. 프로젝트 파일럿 ${pr.id}/${s.key}`].filter(Boolean).join('\n') });
    S.saveProject(profile, pr);   // 카드 하나마다 기록 — 중간에 멈춰도 다시 하면 이어서 만든다
    made.push({ where: `단기 · ${E.waveName(s.wave)}`, title: pr.cards[s.key].title, text: `할 일 ${s.todos.length}개` });
  }
  pr.loops = mergeLoops(pr, plan);
  const mins = E.meMinutes({ loops: pr.loops });
  if (!pr.routine && mins > 0){   // 내 몫 루틴 — 하루 한 번, 루프에서 사람이 할 것을 모아 본다(처음 한 번)
    const [h, m] = plan.routine_at.split(':').map(Number);
    pr.routine = S.createRoutine(profile, F, { title: `${name} ${mins}분`, cron: `${m} ${h} * * *`, duration: Math.max(5, mins), area: areaTitle,
      content: `플러그인 › 프로젝트 파일럿 › 오늘 할 것에서 AI가 준비한 것을 확인해요.\n${pr.loops.filter(l => l.me_minutes).map(l => `- ${E.whenText(l)} ${l.title}: ${l.me} (${l.me_minutes}분)`).join('\n')}` });
    made.push({ where: '루틴', title: pr.routine.title, text: `매일 ${plan.routine_at}, ${Math.max(5, mins)}분` });
  }
  if (!first) syncTodos(pr, pr.plan, plan);
  pr.plan = plan; delete pr.draft;
  const pj = pr.pending_reject;   // 다르게 할래요로 넘어온 것 — 만들기까지 왔을 때만 반영한다(중간에 그만두면 목록에 그대로)
  if (pj){
    if (pj.kind === 'decision') (pr.rejected_decisions ||= []).includes(pj.ref) || pr.rejected_decisions.push(pj.ref);
    if (pj.kind === 'todo' && pr.cards[pj.key]) S.markTodo(profile, F, pr.cards[pj.key], pj.text, `바꿈: ${pj.reason}`);
    (pr.rejections ||= []).push({ kind: pj.kind, text: pj.text, reason: pj.reason, at: pj.at });
    delete pr.pending_reject;
  }
  pr.hub = S.upsertContext(profile, F, { ref: pr.hub, title: `${name} 설계`, summary: plan.one_liner || E.str(pr.goal, 150), body: E.planMarkdown(pr), today, what: first ? '처음 설계' : '설계 고침', why: first ? E.str(pr.goal, 80) : E.str(args.why || '', 80) });
  if (pr.hub.kept) S.writeAtomic(S.pilotFile(pr.work, 'plan.md'), E.planMarkdown(pr) + '\n');
  if (!pr.journal) pr.journal = S.upsertContext(profile, F, { title: `${name} 운영 일지`, summary: '자동 루프가 한 일과 숫자를 날짜별로 남겨요', body: '', today, what: '일지 시작', why: '' });
  if (first){
    made.push({ where: '맥락노트', title: pr.hub.title, text: '전체 설계 · 목표 숫자 역산 · 루프 표' });
    if (pr.source && pr.source.card) S.appendMemo(profile, F, { id: pr.source.card, path: pr.source.path }, `- 프로젝트 파일럿이 설계했어요 → [[${pr.hub.title}]] · 장기 [[${areaTitle}]]`);
    fs.rmSync(S.pilotFile(pr.work, path.join('out', 'kickoff.json')), { force: true });   // 다시 만들 때 지난 시동 결과를 읽지 않게
  }
  pr.status = pr.status === 'paused' ? 'paused' : 'running'; pr.started ||= NOW.toISOString();
  S.logTo(pr, '설계', first ? `만들었어요: 카드 ${Object.keys(pr.cards).length}장, 루프 ${pr.loops.length}개` : `설계를 고쳤어요: 새로 만든 것 ${made.length}개`);
  writeContext(pr, pr.work); S.saveProject(profile, pr);
  const cardsN = made.filter(m => m.where.startsWith('단기')).length;
  return { summary: `만든 것 ${made.length}개`, findings: made,
    verdict: { tone: 'ok', title: first ? `카드 ${cardsN}개를 만들었어요` : '설계를 바꿨어요', text: first ? 'AI가 첫 작업을 시작해요.' : `이미 있던 카드는 그대로 두고 새 것 ${made.length}개만 더했어요. 루프는 새 설계를 따라요.${pr.hub.kept ? '\n설계 노트는 직접 고친 내용이 있어 그대로 뒀어요. 새 설계는 작업 폴더의 .pilot/plan.md에 있어요.' : ''}` },
    outcome: first ? undefined : { title: '바꿨어요', text: '' } };
}

/* ---------- AI 결과 읽기와 검사 ---------- */
function readOut(pr, name){
  const t = S.readText(S.pilotFile(pr.work, path.join('out', name)));
  if (t == null) return { missing: true };
  try { return { out: JSON.parse(t) }; } catch {}
  const m = t.match(/\{[\s\S]*\}/); try { if (m) return { out: JSON.parse(m[0]) }; } catch {}
  return { broken: t.slice(0, 300) };
}
// 사람에게 갈 글 검사 — 표기 없음·출처 없는 가격·과장 표현을 표시한다(막지는 않는다. 사람이 고쳐 올린다)
const HYPE = /보장|확실히|무조건|누구나|100\s*%\s*(수익|성공)|월\s*\d+\s*만\s*원\s*(가능|벌)/;
const DISCLOSE = /광고|수수료를\s*(지급\s*)?받|협찬|제휴/;
function outItems(pr, out){
  const aff = affiliate(pr);
  return (Array.isArray(out && out.items) ? out.items : []).slice(0, 12).map(it => {
    const url = /^https?:\/\//.test(String(it.url || '')) ? String(it.url) : '', copy = it.copy ? String(it.copy).slice(0, 4000) : '';
    const flags = [];
    const post = /[가-힣]{2,}\s+[가-힣]{2,}/.test(copy) && !/^\s*(\$|node |npm |npx |python|bash |sh |cd |git )/m.test(copy);   // 명령어·경로 말고 사람에게 갈 글
    if (post && aff && !DISCLOSE.test(copy.split('\n').slice(0, 2).join(' '))) flags.push('표기 없음');
    if (copy && HYPE.test(copy)) flags.push('과장 표현');
    const priced = copy && /\d[\d,]*\s*(원|%)/.test(copy) && !url;
    return { where: E.str(it.where, 60), url, title: E.str(it.title, 120), text: E.str(it.note || it.text, 500), copy, ...(flags.length ? { tag: flags.join(' · ') } : {}), ...(priced ? { note: '가격 확인 필요' } : {}) };
  }).filter(f => f.title || f.copy);
}
const realFiles = (pr, out) => (Array.isArray(out && out.files) ? out.files : []).map(x => E.str(x, 200)).filter(x => x && !x.split(/[\\/]/).includes('..') && fs.existsSync(path.join(pr.work, x))).slice(0, 20);
function checkDone(pr, list){
  let n = 0;
  for (const d of Array.isArray(list) ? list.slice(0, 30) : []){
    if (!d) continue;
    // 키가 틀려도(렌즈 이름 등) 이 프로젝트 카드의 🤖 줄 중 글이 정확히 같은 것만 체크한다
    const cards = pr.cards[d.sub] ? [pr.cards[d.sub]] : Object.values(pr.cards);
    if (cards.some(c => S.checkTodo(profile, F, c, E.str(d.text, 200)))) n++;
  }
  return n;
}
function journal(pr, title, out, items, files){
  if (!pr.journal) return;
  S.appendContextBody(profile, F, pr.journal, ['', `## ${today} ${title}`, E.str(out && out.summary, 400) || '결과 요약 없음',
    ...items.map(f => `- ${f.title}${f.copy ? `\n  > ${f.copy.split('\n').slice(0, 6).join('\n  > ')}` : ''}${f.text ? ` — ${f.text}` : ''}`),
    ...files.map(x => `- 파일: ${pr.work}/${x}`)], today);
}
const AUTO_HINT = "마지막으로 자동 시작을 켜 주세요. 프로젝트 파일럿 화면 맨 위의 '새로 들어오면 자동 시작 · 켜기'를 누르면, 정한 때마다 AI가 준비해 '오늘 할 것'에 올려요.";
function kickoffDone(){
  const pr = planned(args.pid); workOf(pr);
  const r = readOut(pr, 'kickoff.json'), out = r.out;
  const items = outItems(pr, out), files = realFiles(pr, out);
  const me = (out && Array.isArray(out.me_next) ? out.me_next : pr.plan.first_week).slice(0, 6).map(x => E.str(x, 200)).filter(Boolean);
  if (out && !pr.kickoff_done){   // 일지·체크는 한 번만
    pr.kickoff = { checked: checkDone(pr, out.done_todos), files: files.length };
    takeAsks(pr, out, '첫 작업'); takeSee(pr, out);
    journal(pr, '첫 작업 — AI가 먼저 한 일', out, items, files);
    S.logTo(pr, '시동', E.str(out.summary, 200)); pr.kickoff_done = true; S.saveProject(profile, pr);
  }
  const checked = (pr.kickoff || {}).checked || 0;
  const findings = [...items, ...files.map(f => ({ where: '만든 파일', title: f, text: `${pr.work}/${f}` })),
    ...(me.length ? [{ where: '내가 할 첫 일', title: '이번 주에 내가 할 것', text: me.map(x => `· ${x}`).join('\n') }] : [])];
  if (!out) return { summary: 'AI 첫 작업 결과를 받지 못했어요', findings,
    verdict: { tone: 'bad', title: '카드는 다 만들었어요', text: `AI 첫 작업 결과를 받지 못했어요. 할 일은 카드에 그대로 있어요.\n${AUTO_HINT}` }, outcome: { title: '만들었어요', text: '' } };
  return { summary: `AI가 ${checked}개를 해 뒀어요`, findings,
    verdict: { tone: 'ok', title: checked ? `AI가 할 일 ${checked}개를 먼저 해 뒀어요` : '카드를 다 만들었어요', text: `${E.str(out.summary, 400)}\n${AUTO_HINT}` },
    outcome: { title: '만들었어요', text: '' } };
}

/* ---------- 운영: 루프 ---------- */
const OUT_RULE = `결과는 아래 JSON 하나로 {out} 파일에 써요(다른 말 없이, UTF-8). 쓴 뒤 node -e "JSON.parse(require('fs').readFileSync('{out}','utf8'))" 로 깨지지 않았는지 확인해요.
{"summary":"한 줄 요약","items":[{"title":"무엇","copy":"사람이 그대로 복사해 쓸 글(없으면 빈 문자열)","where":"어디에 쓰나(예: 스레드)","url":"가격·사실을 확인한 페이지","note":"짧은 설명(예: 10:20 확인)"}],"files":["작업 폴더 기준 만든 파일 경로"],"done_todos":[{"sub":"서브 프로젝트 키","text":"체크할 🤖 할 일 원문 그대로(🤖 빼고)"}],"me_asks":[{"text":"사람에게 부탁할 일 한 줄(동사로 끝나게)","why":"왜 필요한지","after":"이 날짜 전엔 못 하면 YYYY-MM-DD, 아니면 빈 문자열","files":["사람이 보고 할 파일(작업 폴더 기준 경로, 없으면 빈 배열)"]}],"me_see":[{"text":"🙋 할 일·정할 것 원문 그대로(🙋·(N분) 빼고)","files":["사람이 보고 판단할 파일(작업 폴더 기준 경로)"]}]}
me_asks에는 사람만 할 수 있어서 막힌 일(확인·결정·가입·자료 받기)을 적어요. 카드의 🙋 할 일에 이미 있는 것은 빼요. 없으면 빈 배열.
사람이 무엇을 보고 판단하거나 옮겨 쓰는 일이면, 그 내용이 든 파일을 files·me_see에 이어요(사람이 파일을 찾지 않고 '내가 할 일'에서 바로 보게). 파일은 이 폴더 안에 있어야 하고, 사람이 볼 핵심(예: 이름·소개 문구)을 파일 맨 앞에 둬요. 이을 게 없으면 빈 배열.{unlinked}`;
const REVIEW_RULE = `점검 결과에는 "changes" 배열을 더해요. 쓸 수 있는 것:
{"type":"todo_add","sub":"키","text":"할 일","who":"ai|me","minutes":0,"see":["사람이 보고 할 파일(me일 때, 없으면 빈 배열)"]} · {"type":"sub_add","sub":{"key":"","lens":"","title":"","why":"","outcome":"","wave":1,"done":[],"todos":[{"text":"","who":"ai","minutes":0}]}}
{"type":"loop_off","loop":"키","why":""} · {"type":"loop_on","loop":"키"} · {"type":"loop_edit","loop":"키","patch":{"task":"","at":"08:00","every":"daily","me":"","me_minutes":0}}
{"type":"loop_add","loop":{"key":"","title":"","sub":"키","every":"daily|weekdays|weekly|monthly","dow":1,"day":1,"at":"08:00","task":"","me":"","me_minutes":0,"metric":""}}
바꿀 게 없으면 "changes": []. 바꾸는 이유는 items의 note에. 사람 몫 합계가 하루 예산({minutes}분)을 넘으면 그 제안은 적용되지 않아요. 목표 숫자를 바꿔야 한다고 보면 changes가 아니라 items에 이유와 함께 적어요(사람이 [설계 고치기]로 정해요).`;
const loopOf = (pr, key) => key === 'review' ? loopsOf(pr).find(x => x.kind === 'review') || E.REVIEW_LOOP : loopsOf(pr).find(x => x.key === key);
const outName = (l, period) => `${E.slug(l.key, 20)}-${E.slug(period, 30)}.json`;
function loopPrep(){
  const pr = planned(args.pid), l = loopOf(pr, args.loop) || fail('루프를 찾지 못했어요. 설계에서 빠졌을 수 있어요');
  const period = args.period === 'now' ? `수동-${today.replace(/-/g, '')}-${String(NOW.getHours()).padStart(2, '0')}${String(NOW.getMinutes()).padStart(2, '0')}` : E.str(args.period, 40);
  workOf(pr); writeContext(pr, pr.work); S.saveProject(profile, pr);
  const out = `.pilot/out/${outName(l, period)}`;
  if (!(pr.done_periods || []).includes(`${l.key}|${period}`)) fs.rmSync(path.join(pr.work, out), { force: true });   // 끝난 회차를 다시 하면 결과는 그대로 둔다
  const sub = l.sub && pr.plan.subprojects.find(s => s.key === l.sub);
  const seen = ((pr.seen || {})[l.key] || []).slice(-20);   // 이미 낸 것 — 되풀이하지 않게
  const unlinked = openMe(pr).filter(m => !m.files.length).slice(0, 10).map(m => m.text);
  const recent = (pr.log || []).filter(x => x.kind === l.title).slice(-5).map(x => `- ${x.at.slice(0, 10)} ${x.text}`).join('\n');
  const task = [`루프: ${l.title} (${E.whenText(l)}, 회차 ${period})`, sub ? `서브 프로젝트: ${sub.title} (키 ${sub.key})` : '', `할 일: ${l.task}`,
    l.me ? `사람 몫(${l.me_minutes}분): ${l.me} — 사람이 이 시간 안에 끝낼 수 있게 준비해요. 사람이 고를 것(초안·후보 합쳐)은 3개까지` : '사람 몫 없음 — 끝까지 AI가 해요',
    l.metric ? `겨누는 지표: ${l.metric}` : '', recent ? `지난 회차:\n${recent}` : '', seen.length ? `이미 낸 것(같은 상품·같은 첫 문장을 다시 쓰지 마요):\n${seen.map(x => `- ${x}`).join('\n')}` : '',
    (pr.rejections || []).length ? `사람이 거절하거나 바꾼 것(같은 부탁을 다시 하지 말고, 이유를 보고 다른 방법을 찾아요):\n${pr.rejections.slice(-10).map(x => `- ${x.text} — 이유: ${x.reason}`).join('\n')}` : '',
    affiliate(pr) ? '사람에게 갈 글은 첫 줄에 대가성 표기(예: "[광고] … 링크로 구매하면 수수료를 받아요")를 넣어요.' : '',
    OUT_RULE.replaceAll('{out}', out).replace('{unlinked}', unlinked.length ? `\n아직 볼 파일이 이어지지 않은 내 몫이에요. 이 폴더에 그 판단에 쓸 파일이 이미 있으면 me_see에 이어요(글은 그대로 옮겨요):\n${unlinked.map(x => `- ${x}`).join('\n')}` : ''), l.kind === 'review' ? REVIEW_RULE.replace('{minutes}', budgetOf(pr)) : ''].filter(Boolean).join('\n\n');
  return { ...pubWork(pr), period, out, title: l.title, kind: l.kind, task, summary: `${l.title} · ${period}` };
}
function applyChanges(pr, changes){
  const done = [], before = E.meMinutes({ loops: loopsOf(pr) }), snapshot = JSON.stringify(pr.loops), budget = budgetOf(pr);
  const subKeys = () => new Set(pr.plan.subprojects.map(s => s.key));
  for (const c of Array.isArray(changes) ? changes.slice(0, 15) : []){
    if (c.type === 'todo_add' && pr.cards[c.sub] && E.str(c.text)){
      const t = { text: E.str(c.text, 200), who: c.who === 'me' ? 'me' : 'ai', minutes: Math.min(120, Math.max(0, Number(c.minutes) || 0)) }, see = t.who === 'me' ? E.seeList(c.see) : [];
      if (see.length) t.see = see;
      if (S.addTodos(profile, F, pr.cards[c.sub], [E.todoLine(t)])){ pr.plan.subprojects.find(s => s.key === c.sub)?.todos.push(t); done.push(`할 일 더함: ${t.text}`); }
    } else if (c.type === 'sub_add' && c.sub){
      const p = E.normalizePlan({ ...pr.plan, subprojects: [c.sub], loops: [] }).subprojects[0];
      if (p && !pr.cards[p.key]){
        pr.plan.subprojects.push(p);
        pr.cards[p.key] = S.createCard(profile, F, { title: `${pr.plan.name} · ${p.lens} — ${p.title}`, status: 'todo', area: pr.area && pr.area.title, created: today, todos: p.todos.map(t => E.todoLine(t)), done: p.done, memo: [p.why && `왜: ${p.why}`, `점검에서 더했어요. 프로젝트 파일럿 ${pr.id}/${p.key}`].filter(Boolean).join('\n') });
        done.push(`카드 더함: ${p.title}`);
      }
    } else if (['loop_off', 'loop_on'].includes(c.type)){
      const l = loopsOf(pr).find(x => x.key === c.loop);
      if (l){ Object.assign(l, { on: c.type === 'loop_on', user_set: true, auto_off: false, off_why: c.type === 'loop_off' ? E.str(c.why, 120) : '' }); done.push(`${l.title} ${l.on ? '켬' : '끔'}`); }
    } else if (c.type === 'loop_edit'){
      const i = loopsOf(pr).findIndex(x => x.key === c.loop);
      if (i >= 0){ const n = E.normalizeLoop({ ...pr.loops[i], ...(c.patch || {}), key: pr.loops[i].key }, i, subKeys()); if (n){ pr.loops[i] = { ...n, key: pr.loops[i].key, kind: pr.loops[i].kind, user_set: pr.loops[i].user_set }; done.push(`${n.title} 바꿈`); } }
    } else if (c.type === 'loop_add' && loopsOf(pr).length < 8){
      const n = E.normalizeLoop(c.loop, pr.loops.length, subKeys(), new Set(pr.loops.map(l => l.key)));
      if (n){ pr.loops.push(n); done.push(`루프 더함: ${n.title}`); }
    }
  }
  const after = E.meMinutes({ loops: pr.loops });
  if (after > budget && after > before){   // 사람 몫이 예산을 넘게 늘면 루프 바꾼 것은 되돌린다
    pr.loops = JSON.parse(snapshot);
    const kept = done.filter(d => /^(할 일|카드) 더함/.test(d));
    done.length = 0; done.push(...kept, `루프 변경은 되돌렸어요(내 시간 하루 ${after}분 > 예산 ${budget}분)`);
  }
  pr.plan.loops = pr.loops.filter(l => l.kind !== 'review');   // 설계 고치기가 점검 결과를 보게
  if (done.length){ pr.hub = S.upsertContext(profile, F, { ref: pr.hub, title: `${pr.plan.name} 설계`, summary: pr.plan.one_liner, body: E.planMarkdown(pr), today, what: done.join(', ').slice(0, 200), why: '주간 점검' }); writeContext(pr, pr.work); }
  return done;
}
const changeText = c => ({ todo_add: `할 일 더하기 — ${c.text}`, sub_add: `서브 프로젝트 더하기 — ${c.sub && c.sub.title}`, loop_off: `루프 끄기 — ${c.loop}`, loop_on: `루프 켜기 — ${c.loop}`, loop_edit: `루프 바꾸기 — ${c.loop}`, loop_add: `루프 더하기 — ${c.loop && c.loop.title}` })[c.type] || c.type;
function loopDone(){
  const pr = planned(args.pid), l = loopOf(pr, args.loop) || fail('루프를 찾지 못했어요. 설계에서 빠졌을 수 있어요');
  workOf(pr);
  const key = `${l.key}|${args.period}`, r = readOut(pr, outName(l, args.period)), out = r.out;
  if (r.missing) return { error: '[AI 작업] 결과 파일이 없어요. AI가 중간에 멈췄을 수 있어요. [AI 작업]을 다시 해 주세요' };
  if (r.broken != null) return { error: `[AI 작업] 결과를 읽지 못했어요(JSON이 깨짐). [AI 작업]을 다시 해 주세요. 앞부분: ${E.str(r.broken, 120)}` };
  const items = outItems(pr, out), files = realFiles(pr, out), changes = Array.isArray(out.changes) ? out.changes.filter(c => c && c.type && c.type !== 'target').slice(0, 15) : [];
  if (!(pr.done_periods || []).includes(key)){   // 일지·체크·이미 낸 것은 회차마다 한 번
    pr.done_periods = [...(pr.done_periods || []), key].slice(-300);
    const n = checkDone(pr, out.done_todos);
    journal(pr, l.title, out, items, files);
    takeAsks(pr, out, l.title); takeSee(pr, out);
    ((pr.seen ||= {})[l.key] ||= []).push(...items.map(f => `${f.title}${f.copy ? ` — ${E.str(f.copy.split('\n').find(x => x.trim() && !/광고|수수료/.test(x)) || '', 60)}` : ''}`));
    pr.seen[l.key] = pr.seen[l.key].slice(-40);
    if (l.me_minutes && l.kind !== 'review') (pr.unseen ||= {})[l.key] = ((pr.unseen || {})[l.key] || 0) + 1;
    S.logTo(pr, l.title, `${E.str(out.summary, 200)}${n ? ` · 할 일 ${n}개 체크` : ''}`);
    S.saveProject(profile, pr);
  }
  const empty = !items.length && !changes.length && !files.length;
  const verdict = { tone: empty ? 'bad' : 'ok', title: empty ? `${l.title} — 준비한 게 없어요` : l.title, text: `${E.str(out.summary, 300) || '요약이 없어요'}${l.me_minutes && !empty ? `\n내 몫: ${l.me} (${l.me_minutes}분)` : ''}` };
  const findings = [...items, ...files.map(f => ({ where: '만든 파일', title: f, text: `${pr.work}/${f}` })), ...changes.map(c => ({ where: '제안', note: '바꿀 것', title: changeText(c), text: E.str(c.why || c.text || '', 200) }))];
  if (l.kind === 'review' && changes.length){
    const applied = (pr.applied || {})[key];
    if (applied) return { summary: '이미 정했어요', verdict, findings, outcome: { title: applied.title, text: applied.text || '' } };
    if (args.answer === 'apply' || args.answer === 'keep'){
      const d = args.answer === 'apply' ? applyChanges(pr, changes) : [];
      const oc = args.answer === 'apply' ? { title: `바꿨어요 · ${d.length}개`, text: d.join(', ') } : { title: '그대로 뒀어요', text: '' };
      (pr.applied ||= {})[key] = oc; S.logTo(pr, '점검', args.answer === 'apply' ? `제안대로 바꿈: ${d.join(', ')}` : '제안을 그대로 둠'); S.saveProject(profile, pr);
      return { summary: oc.title, verdict, findings, outcome: oc };
    }
    return { summary: `제안 ${changes.length}개`, verdict, findings, ask: { question: '제안대로 바꿀까요?', inline: true, choices: [{ value: 'apply', label: '제안대로 바꾸기', recommended: true }, { value: 'keep', label: '그대로 좋아요' }] } };
  }
  // 사람 몫이 있는 루프 — 했는지 한 번 누르면 끝(내 차례 수에 잡히고, 피로 규칙이 이 답을 본다)
  if (l.me_minutes && l.kind !== 'review' && !empty){
    if (args.answer === 'done' || args.answer === 'skip'){
      if (pr.unseen) pr.unseen[l.key] = 0;
      S.logTo(pr, l.title, args.answer === 'done' ? '했어요' : '건너뜀'); S.saveProject(profile, pr);
      return { summary: args.answer === 'done' ? '했어요' : '건너뛰었어요', verdict, findings, outcome: { title: args.answer === 'done' ? '했어요' : '건너뛰었어요', text: '' } };
    }
    return { summary: '내 차례예요', verdict, findings, ask: { question: l.me || '했나요?', inline: true, choices: [{ value: 'done', label: '했어요', recommended: true }, { value: 'skip', label: '오늘은 건너뛰기' }] } };
  }
  return { summary: E.str(out.summary, 120), verdict, findings, outcome: { title: empty ? '준비한 게 없어요' : '끝', text: '' } };
}

/* ---------- 운영: 숫자 ---------- */
// "3.2만원", "3만 2천원", "12,000", "1억" → 숫자. 메모는 숫자를 뺀 나머지
export function parseAmount(s){
  const t = String(s || '').trim().replace(/(\d),(?=\d{3})/g, '$1');
  const m = (t.match(/[+-]?(?:\d+(?:\.\d+)?\s*억\s*)?(?:\d+(?:\.\d+)?\s*만\s*)?(?:\d+(?:\.\d+)?\s*천\s*)?(?:\d+(?:\.\d+)?)?/g) || []).find(x => /\d/.test(x));
  if (!m) return null;
  let n = 0, rest = m.replace(/\s+/g, '');
  const neg = rest.startsWith('-'); rest = rest.replace(/^[+-]/, '');
  for (const [u, k] of [['억', 1e8], ['만', 1e4], ['천', 1e3]]){ const x = rest.match(new RegExp(`(\\d+(?:\\.\\d+)?)${u}`)); if (x){ n += Number(x[1]) * k; rest = rest.replace(x[0], ''); } }
  if (/^\d+(\.\d+)?$/.test(rest)) n += Number(rest);
  return { amt: Math.round((neg ? -n : n) * 100) / 100, memo: E.str(t.replace(m.trim(), '').replace(/^\s*(원|회|명|개|건|번)\s*/, ''), 120) };
}
function checkin(){
  const pr = planned(args.pid);
  if (!pr.area) fail('숫자를 쌓을 장기가 없어요');
  const c = pr.plan.checkins.find(x => x.key === args.key) || { key: 'manual', question: `${pr.plan.metric.name}을 적어 주세요`, unit: pr.plan.metric.unit, to_metric: true };
  const m = pr.plan.metric, pg = () => E.progress(m, areaRecords(pr), NOW), slot = args.period ? `${c.key}|${args.period}` : null;
  const ok = (v, note) => { const p = pg(); return { summary: `${v}${c.unit || ''} 적었어요`, verdict: { tone: 'ok', title: `이번 ${E.periodWord(m.period)} ${E.money(p.sum, m.unit)} / ${E.money(m.target, m.unit)}${p.pct == null ? '' : ` (${p.pct}%)`}`, text: note }, outcome: { title: '적었어요', text: '' } }; };
  if (slot && (pr.checked || {})[slot]) return ok(pr.checked[slot].amt ?? '', '이 회차는 이미 적었어요');   // 다시 해도 두 번 쌓지 않는다
  const given = args.value ?? args.answer;
  if (blank(given)){
    const p = pg();
    return { summary: c.question, ask: { question: c.question, hint: `이번 ${E.periodWord(m.period)} ${E.money(p.sum, m.unit)} / ${E.money(m.target, m.unit)}. 없으면 0을 적어요(메모는 숫자 뒤에)`, free: true, placeholder: '예: 12000 정산 2건' } };
  }
  const v = parseAmount(given);
  if (!v) return { summary: '숫자를 못 읽었어요', ask: { question: '숫자로 적어 주세요', hint: '예: 12000, 3.2만, 3만 2천', free: true, placeholder: '예: 12000 정산 2건' } };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(args.date || '') ? args.date : today;   // 회차 날짜로 쌓는다(월말 숫자를 다음 날 적어도 그 달로)
  if (c.to_metric !== false && !S.addAreaRecord(profile, F, pr.area, { date, amt: v.amt, memo: [c.key === 'manual' ? '' : c.question, v.memo].filter(Boolean).join(' · ') }))
    fail(`장기 '${pr.area.title}'를 찾지 못했어요. 지웠다면 숫자를 쌓을 수 없어요`);
  if (slot) (pr.checked ||= {})[slot] = { at: today, amt: v.amt };
  S.logTo(pr, '숫자', `${c.question}: ${v.amt}${v.memo ? ` (${v.memo})` : ''}`);
  S.saveProject(profile, pr);
  return ok(v.amt, c.to_metric !== false ? `장기 '${pr.area.title}'에 쌓았어요` : '주간 점검이 참고해요');
}
function toggle(){
  const pr = planned(args.pid), to = args.to === 'on' ? 'running' : args.to === 'off' ? 'paused' : pr.status === 'paused' ? 'running' : 'paused';
  const woke = to === 'running' ? loopsOf(pr).filter(l => l.auto_off) : [];
  for (const l of woke) Object.assign(l, { on: true, auto_off: false, off_why: '' });   // 쉬던 루프도 다시
  if (pr.unseen) for (const l of woke) pr.unseen[l.key] = 0;
  const same = pr.status === to && !woke.length;
  pr.status = to; if (!same) S.logTo(pr, '운영', to === 'paused' ? '루프를 멈춤' : '루프를 다시 켬'); S.saveProject(profile, pr);
  const off = to === 'paused';
  return { summary: off ? '멈췄어요' : '다시 켰어요', verdict: { tone: 'ok', title: same ? (off ? '이미 멈춰 있어요' : '이미 켜져 있어요') : off ? '루프를 멈췄어요' : '루프를 다시 켰어요',
    text: off ? '카드와 기록은 그대로예요. 다시 켜면 다음 차례부터 준비해요.' : `다음 차례부터 '오늘 할 것'에 올라와요.${woke.length ? ` 쉬던 루프 ${woke.length}개도 켰어요.` : ''}` }, outcome: { title: off ? '멈춤' : '켬', text: '' } };
}

const CMD = { 'me-list': meList, 'me-done': meDone, 'me-reject': meReject, 'new-list': newList, 'cards-list': cardsList, 'projects-list': projectsList, 'loops-list': loopsList, 'checkins-list': checkinsList,
  init, reopen, brief, context, review, revise, build, 'kickoff-done': kickoffDone, 'loop-prep': loopPrep, 'loop-done': loopDone, checkin, toggle };
function main(){
  if (argLost) return { error: '앞 단계 결과 파일을 찾지 못했어요(하루가 지나 지워졌을 수 있어요). 앞 단계부터 다시 해 주세요' };
  if (!fs.existsSync(path.join(profile, '_설정.md'))) return { error: `프로필 폴더를 찾지 못했어요: ${profile}` };
  const f = CMD[process.argv[2]];
  return f ? f() : { error: `모르는 명령이에요: ${process.argv[2]}` };
}
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))){
  let r; try { r = main(); } catch (e) { r = { error: e.user ? e.message : `처리하다 문제가 생겼어요(${e.message}). 이 단계를 다시 해 주세요` }; }
  process.stdout.write(JSON.stringify(r) + '\n');
}
