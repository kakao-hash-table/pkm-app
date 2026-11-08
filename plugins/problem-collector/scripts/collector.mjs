#!/usr/bin/env node
// 문제 수집기 — 붙여 넣은 글(나중에는 자동 수집한 글)에서 문제를 골라 분야·점수·묶음을 붙이고, 해결 카드와 검증 결과로 '디지털 건물'까지 키운다. 결과는 JSON 한 줄.
// 목록(피드)
//   collect-list --rss --subs · paste-list · clusters-list --filter · top-list · verify-list · building-list · filter-list --filter
// 워크플로우
//   collect --rss --subs --limit          RSS(robots.txt 확인)·Reddit 공식 API에서 새 글 → _posts · collect-save --meta --analysis
//   intake-prep --text                     붙여 넣은 글 → AI에게 줄 글(_text)·지금 묶음(_clusters)
//   intake-save --url --source --analysis  AI 분석 → 묶음에 넣기(원문은 저장하지 않는다)
//   solve-prep --cid · solve-save --cid --solution     해결 카드
//   result --cid [--answer=none|ask|paid]  검증 결과 · contact --cid  연락 문구
//   log --cid --value="52000 1.5"          월 순이익·손 쓴 시간 · handoff --cid [--answer]  project-pilot으로 넘기기(#설계 카드)
//   filter-pick [--answer]                 보기 바꾸기
// 공통: [--profile=폴더] [--now=ISO] [--weights=35,20,20,15,10] [--week-hours=10]
// 저장: <프로필>/_플러그인/.data/problem-collector/db.json (프로필과 함께 동기화, 앱 화면에는 안 보임)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as E from './engine.mjs';

let argLost = false;
const argValue = v => { const m = /^@file:(\/.+)$/.exec(v); if (!m) return v; try { return fs.readFileSync(m[1], 'utf8'); } catch { argLost = true; return ''; } };
const args = Object.fromEntries(process.argv.slice(3).map(a => a.match(/^--([^=]+)=([\s\S]*)$/)).filter(Boolean).map(m => [m[1], argValue(m[2])]));
const NOW = args.now && !Number.isNaN(Date.parse(args.now)) ? new Date(args.now) : new Date();
const AT = NOW.toISOString();
const MONTH = AT.slice(0, 7);
const fail = msg => { throw Object.assign(new Error(msg), { user: true }); };
const blank = v => v == null || !String(v).trim();
const json = (v, what) => { if (blank(v)) fail(`${what}이 비어 있어요. 앞 단계를 다시 해 주세요`); try { return JSON.parse(v); } catch { fail(`${what}을 읽지 못했어요. 앞 단계를 다시 해 주세요`); } };
const W = E.weights(args.weights);
const WEEK = Math.max(1, Number(args['week-hours']) || 10);
const TIRED = 7;   // 해결 카드를 7번 만들 동안 검증 결과가 한 번도 없으면 자동 해결을 쉰다

const here = path.dirname(fileURLToPath(import.meta.url));
const profile = args.profile ? path.resolve(args.profile) : path.resolve(here, '..', '..', '..');   // <프로필>/_플러그인/problem-collector/scripts
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
function writeAtomic(f, t){
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = path.join(path.dirname(f), `.${path.basename(f)}.${process.pid}.tmp`);
  try { fs.writeFileSync(tmp, t); fs.renameSync(tmp, f); } finally { fs.rmSync(tmp, { force: true }); }
}
const DB = path.join(profile, '_플러그인', '.data', 'problem-collector', 'db.json');
const load = () => { const t = read(DB); if (!t) return { clusters: {}, rejected: [], unseen: 0 }; try { return { clusters: {}, rejected: [], unseen: 0, ...JSON.parse(t) }; } catch { fail('저장된 기록(db.json)을 읽지 못했어요. 동기화 충돌이 있는지 봐 주세요'); } };
const save = db => writeAtomic(DB, JSON.stringify(db, null, 1) + '\n');
const rid = (pre, n = 7) => pre + crypto.randomBytes(8).toString('hex').slice(0, n);
const all = db => Object.values(db.clusters).map(c => { c.score = E.score(c, W, { weekHours: WEEK }); c.stage = E.stageOf(c); return c; }).sort((a, b) => b.score - a.score || String(b.updated).localeCompare(String(a.updated)));
const cluster = (db, cid) => db.clusters[cid] || fail('묶음을 찾지 못했어요. 다른 기기에서 아직 동기화되지 않았을 수 있어요');

/* ---------- 목록 ---------- */
const sources = c => [...new Set(c.posts.map(p => p.source))].join('·');
function item(c, extra = {}){
  const d = [{ kind: '문제', text: `${c.who} — ${c.loss}. 지금은 ${c.workaround}` }];
  if (c.money_why) d.push({ kind: '돈 신호', text: c.money_why });
  if (c.out_of_scope && c.scope_why) d.push({ kind: '범위 밖', text: c.scope_why });
  for (const p of c.posts.slice(-3)) d.push({ kind: '출처', who: p.source, at: p.at, text: p.summary, ...(p.url ? { url: p.url } : {}) });
  const link = c.posts.map(p => p.url).find(Boolean);
  return { id: c.id, title: c.title, ...(link ? { url: link } : {}), tags: [`${E.STAGE_ICON[c.stage]} ${c.stage}`, c.domain], meta: [`점수 ${c.score}`, `글 ${c.posts.length}개 · ${sources(c)}`],
    at: c.updated, version: `${c.posts.length}-${c.solution ? 's' : ''}${c.results.length}-${c.logs.length}`, detail: d.slice(0, 8), vars: { cid: c.id }, ...extra };
}
const pasteList = () => ({ items: [{ id: 'paste', title: '글 붙여 넣기', meta: ['크몽·숨고·커뮤니티·리뷰 글을 주소와 함께 붙여 넣어요 · 원문은 저장하지 않아요'], vars: {} }] });
function clustersList(){
  const db = load(), f = E.parseFilter(args.filter), list = E.applyFilter(all(db), f);
  save(db);
  return { items: list.slice(0, 60).map(c => item(c)), note: `보기: ${E.filterLabel(f)} · ${list.length}묶음${db.rejected.length ? ` · 걸러진 글 ${db.rejected.length}개` : ''}` };
}
function topList(){
  const db = load();
  if ((db.unseen || 0) >= TIRED) return { items: [], note: `해결 카드 ${TIRED}개 동안 검증 결과가 없어 자동 해결을 쉬어요. '이번 주 검증'에서 결과를 하나 적으면 다시 만들어요` };
  return { items: all(db).filter(c => !c.out_of_scope && !c.solution).slice(0, 3).map(c => item(c)) };
}
function verifyList(){
  const db = load();
  return { items: all(db).filter(c => c.stage === '검증').map(c => item(c, { detail: [{ kind: '이번 주 한 걸음', text: c.solution.step || '-' }, ...item(c).detail].slice(0, 8), meta: [`점수 ${c.score}`, c.results.length ? `결과 ${c.results.map(r => E.RESULTS[r.kind]).join(', ')}` : '아직 결과 없음'] })) };
}
function buildingList(){
  const db = load(), list = all(db).filter(c => c.stage === '공사' || c.stage === '건물');
  const done = list.filter(c => c.stage === '건물'), last = c => c.logs.at(-1);
  const profit = done.reduce((a, c) => a + (last(c)?.profit || 0), 0), hours = list.reduce((a, c) => a + (last(c)?.hours || 0), 0);
  return { items: list.map(c => item(c, { meta: [last(c) ? `월 순이익 ${E.money(last(c).profit)} · 손 ${last(c).hours}시간 (${last(c).month})` : '아직 기록 없음', c.handoff ? `카드: ${c.handoff.title}` : '카드 없음'] })),
    note: `건물 ${done.length}채 · 월 합계 ${E.money(profit)} · 내 손 ${hours}시간` };
}
function filterList(){
  const f = E.parseFilter(args.filter);
  return { items: [{ id: 'filter', title: `지금 보기: ${E.filterLabel(f)}`, meta: ['분야·출처·단계로 문제 묶음을 골라 봐요'], vars: {}, version: E.filterLabel(f) }] };
}

/* ---------- 붙여 넣기 → 분석 → 묶기 ---------- */
function intakePrep(){
  const text = String(args.text || '').trim();
  if (text.length < 20) fail('글이 너무 짧아요. 불만이나 요청이 담긴 본문을 붙여 넣어 주세요');
  const url = E.firstUrl(text), db = load();
  const clusters = all(db).slice(0, 60).map(c => ({ id: c.id, title: c.title, domain: c.domain, who: c.who }));
  // forget: 붙여 넣은 원문(글 단계의 답)을 실행 기록에서 지운다. 다음 단계에는 _text로만 넘기고, _ 값은 실행이 끝나면 실행기가 버린다
  return { summary: `${E.sourceOf(url)} 글 ${text.length.toLocaleString()}자`, url: url || '-', source: E.sourceOf(url), today: AT.slice(0, 10), _text: text.slice(0, 12000), _clusters: JSON.stringify(clusters), forget: ['글'] };
}
// 분석된 문제들을 묶음에 넣는다. where(p) → { url, source } (없으면 건너뜀)
function saveProblems(db, problems, where){
  const made = [], merged = [], rejected = [];
  for (const p of problems){
    const w = where(p); if (!w) continue;
    if (!p.qualifies){ rejected.push(p); db.rejected.push({ at: AT, url: w.url, source: w.source, title: p.title, why: p.reject_why }); continue; }
    const { cluster: c, added } = E.mergeProblem(db, p, { url: w.url, source: w.source, at: AT, id: rid('c') });
    if (!added) continue;
    (c.posts.length > 1 ? merged : made).push(c);
  }
  db.rejected = db.rejected.slice(-300);
  all(db);
  const findings = [...made.map(c => ({ tag: '새 묶음', title: c.title, text: `${c.domain} · 점수 ${c.score}${c.out_of_scope ? ' · 범위 밖' : ''}` })),
    ...merged.map(c => ({ tag: '합침', title: c.title, text: `글 ${c.posts.length}개 · 점수 ${c.score}` })),
    ...rejected.map(p => ({ tag: '걸러짐', title: p.title, text: p.reject_why }))].slice(0, 30);
  return { n: made.length + merged.length, rejected: rejected.length, findings };
}
const once = (db, key, make) => {   // [다시 하기]로 같은 글을 두 번 넣지 않는다
  if ((db.intakes ||= {})[key]) return { ...db.intakes[key], summary: `이미 넣은 글이에요 · ${db.intakes[key].summary}` };
  const out = make(); db.intakes[key] = out;
  const keys = Object.keys(db.intakes); for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete db.intakes[k];
  save(db); return out;
};
function intakeSave(){
  const a = E.normalizeAnalysis(json(args.analysis, '분석 결과')), db = load();
  const url = args.url && args.url !== '-' ? args.url : '', source = args.source || E.sourceOf(url);
  const key = crypto.createHash('sha1').update(url || JSON.stringify(a.problems.map(p => p.title))).digest('hex').slice(0, 12);
  return once(db, key, () => {
    const r = saveProblems(db, a.problems, () => ({ url, source }));
    return { summary: `문제 ${r.n}개 · 걸러짐 ${r.rejected}개`, verdict: { tone: r.n ? 'ok' : 'bad', title: r.n ? `문제 ${r.n}개를 넣었어요` : '문제로 볼 만한 게 없었어요', text: a.note || (r.n ? '문제 묶음에서 점수 순으로 볼 수 있어요' : '누가·잃는 것·지금 버티는 방법이 다 보이는 글이면 문제로 넣어요') }, findings: r.findings };
  });
}

/* ---------- 자동 수집: RSS(국내 커뮤니티 등, robots.txt 확인)와 Reddit 공식 API. 원문은 _posts로 다음 단계에만 넘기고 저장하지 않는다 ---------- */
const UA = 'pkm-problem-collector/0.1 (personal research)';
const lines = v => String(v || '').split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#'));
const BASE = { reddit: process.env.PC_REDDIT_BASE || 'https://oauth.reddit.com', redditAuth: process.env.PC_REDDIT_AUTH || 'https://www.reddit.com/api/v1/access_token' };
const GAP = Number(process.env.PC_GAP_MS ?? 1500);   // 요청 사이 간격
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, opt = {}){
  const r = await fetch(url, { ...opt, headers: { 'user-agent': UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status}`);
  return r;
}
const robotsCache = new Map();
async function allowed(u){
  const { origin, pathname, search } = new URL(u);
  if (!robotsCache.has(origin)) robotsCache.set(origin, await get(`${origin}/robots.txt`).then(r => r.text()).catch(e => /^4\d\d$/.test(e.message) ? '' : null));   // 없음(4xx)은 허용, 못 읽음은 건너뜀
  const t = robotsCache.get(origin);
  return t != null && E.robotsAllowed(t, UA, pathname + search);
}
const sourcesOf = () => ({ rss: lines(args.rss).filter(u => /^https?:\/\//.test(u)), subs: lines(args.subs).map(x => x.replace(/^\/?r\//, '')).filter(x => /^\w{2,30}$/.test(x)) });
const hasReddit = () => !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
function collectList(){
  const s = sourcesOf();
  if (!s.rss.length && !s.subs.length) return { items: [], note: "설정의 'RSS 주소'나 '서브레딧'을 적으면 매일 한 번 모아요" };
  const what = [s.rss.length ? `RSS ${s.rss.length}곳` : '', s.subs.length ? `Reddit ${s.subs.length}곳${hasReddit() ? '' : '(비밀값 필요)'}` : ''].filter(Boolean).join(' · ');
  return { items: [{ id: `collect-${AT.slice(0, 10)}`, title: `오늘 수집 · ${AT.slice(0, 10)}`, meta: [what, `하루 ${Math.max(1, Number(args.limit) || 20)}개까지`], vars: {} }] };
}
async function collect(){
  const s = sourcesOf(), limit = Math.max(1, Math.min(50, Number(args.limit) || 20)), db = load(), seen = db.seen || {};
  const posts = [], notes = [];
  const take = p => { if (posts.length >= limit || seen[p.key] || posts.some(x => x.key === p.key)) return; posts.push(p); };
  for (const u of s.rss){
    if (posts.length >= limit) break;
    try {
      if (!(await allowed(u))){ notes.push(`robots.txt가 막아서 건너뜀: ${u}`); continue; }
      await sleep(GAP);
      for (const it of E.parseFeed(await (await get(u)).text()).slice(0, 30)) take({ key: `rss:${crypto.createHash('sha1').update(it.id || it.url).digest('hex').slice(0, 16)}`, url: it.url, source: E.sourceOf(it.url || u), title: it.title, text: it.text });
    } catch (e) { notes.push(`가져오지 못함(${e.message}): ${u}`); }
  }
  if (s.subs.length && !hasReddit()) notes.push('Reddit은 공식 API 비밀값(REDDIT_CLIENT_ID·REDDIT_CLIENT_SECRET)을 넣어야 모아요');
  if (s.subs.length && hasReddit() && posts.length < limit){
    try {
      const tok = await (await get(BASE.redditAuth, { method: 'POST', body: 'grant_type=client_credentials', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64') } })).json();
      for (const sub of s.subs){
        if (posts.length >= limit) break;
        await sleep(GAP);
        const j = await (await get(`${BASE.reddit}/r/${sub}/new?limit=25&raw_json=1`, { headers: { authorization: `Bearer ${tok.access_token}` } })).json();
        for (const c of (j.data && j.data.children) || []){ const d = c.data || {}; if (d.stickied || d.over_18) continue; take({ key: `reddit:${d.id}`, url: `https://www.reddit.com${d.permalink}`, source: 'Reddit', title: E.str(d.title, 200), text: E.str(d.selftext, 1500) }); }
      }
    } catch (e) { notes.push(`Reddit에서 가져오지 못함(${e.message})`); }
  }
  const clusters = all(db).slice(0, 60).map(c => ({ id: c.id, title: c.title, domain: c.domain, who: c.who }));
  const text = posts.map((p, i) => `[${i}] (${p.source}) ${p.title}\n${p.text.slice(0, 600)}`).join('\n\n');
  return { summary: `새 글 ${posts.length}개${notes.length ? ` · 알림 ${notes.length}` : ''}`, has: posts.length > 0, count: posts.length, today: AT.slice(0, 10),
    meta: JSON.stringify(posts.map(p => ({ key: p.key, url: p.url, source: p.source }))), notes: notes.join('\n'), _posts: text, _clusters: JSON.stringify(clusters),
    ...(posts.length ? {} : { verdict: { tone: notes.length ? 'bad' : 'ok', title: '새 글이 없어요', text: notes.join(' / ') || '내일 다시 모아요' } }) };
}
function collectSave(){
  const meta = json(args.meta, '수집 목록'), a = E.normalizeAnalysis(json(args.analysis, '분석 결과')), db = load();
  const key = 'c:' + crypto.createHash('sha1').update(meta.map(m => m.key).join('|')).digest('hex').slice(0, 12);
  return once(db, key, () => {
    const r = saveProblems(db, a.problems, p => meta[p.post] ? { url: /^https?:\/\//.test(meta[p.post].url) ? meta[p.post].url : '', source: meta[p.post].source || '기타 사이트' } : null);
    db.seen ||= {}; for (const m of meta) db.seen[m.key] = AT.slice(0, 10);
    const ks = Object.keys(db.seen); for (const k of ks.slice(0, Math.max(0, ks.length - 3000))) delete db.seen[k];
    return { summary: `글 ${meta.length}개 → 문제 ${r.n}개`, verdict: { tone: 'ok', title: r.n ? `글 ${meta.length}개에서 문제 ${r.n}개를 넣었어요` : `글 ${meta.length}개를 봤는데 문제로 볼 만한 게 없었어요`, text: a.note || '' }, findings: r.findings };
  });
}

/* ---------- 해결 카드 ---------- */
function solvePrep(){
  const db = load(), c = cluster(db, args.cid);
  all(db);
  const ctx = [`제목: ${c.title}`, `분야: ${c.domain}`, `누가·상황: ${c.who}`, `잃는 것: ${c.loss}`, `지금 버티는 방법: ${c.workaround}`, `요약: ${c.summary}`,
    `돈 신호: ${c.money_why || '없음'}`, `출처: ${sources(c)} · 글 ${c.posts.length}개`, ...c.posts.slice(-5).map(p => `- ${p.source}: ${p.summary}`)].join('\n');
  return { summary: c.title, title: c.title, _ctx: ctx };
}
function solveSave(){
  const db = load(), c = cluster(db, args.cid);
  const first = !c.solution;
  c.solution = E.normalizeSolution(json(args.solution, '해결 카드'));
  c.updated = AT;
  if (first) db.unseen = (db.unseen || 0) + 1;
  all(db); save(db);
  return { summary: `해결 카드 · 점수 ${c.score}`, verdict: { tone: 'ok', title: '해결 카드를 만들었어요', text: `이번 주 한 걸음: ${c.solution.step || '-'}` },
    findings: [{ tag: '해결 카드', title: c.title, copy: E.solutionMarkdown(c), rich: true }, ...(c.solution.contact ? [{ tag: '연락 문구', title: '원글 작성자에게 직접 보내요(자동으로 보내지 않아요)', text: c.solution.contact, copy: c.solution.contact }] : [])] };
}
function contact(){
  const db = load(), c = cluster(db, args.cid);
  if (!c.solution) fail('아직 해결 카드가 없어요. [해결 보기]를 먼저 해 주세요');
  all(db);
  return { summary: '연락 문구', verdict: { tone: 'ok', title: c.solution.step || '이번 주 한 걸음', text: '[문구 복사]로 복사해 직접 보내요. 자동으로 보내지 않아요.' },
    findings: [...(c.solution.contact ? [{ tag: '연락 문구', title: '복사해서 보내기', text: c.solution.contact, copy: c.solution.contact }] : []), { tag: '해결 카드', title: c.title, copy: E.solutionMarkdown(c), rich: true },
      ...c.posts.filter(p => p.url).slice(-3).map(p => ({ tag: '원글', title: p.summary, url: p.url, where: p.source }))] };
}

/* ---------- 검증 결과 · 건물 기록 ---------- */
function result(){
  const db = load(), c = cluster(db, args.cid);
  if (blank(args.answer)) return { summary: '결과 묻기', ask: { question: '이번 주 한 걸음, 어떻게 됐어요?', inline: true, choices: [
    { value: 'none', label: '문의 0' }, { value: 'ask', label: '문의 있음' }, { value: 'paid', label: '결제됨', confirm: '결제가 확인됐나요? 공사 단계로 넘어가요' }] } };
  if (!E.RESULTS[args.answer]) fail('모르는 결과예요');
  const key = `${args.answer}@${AT.slice(0, 16)}`;
  if (!c.results.some(r => r.key === key)) c.results.push({ key, kind: args.answer, at: AT });
  db.unseen = 0; c.updated = AT;
  const before = c.stage; all(db); save(db);
  const up = before !== c.stage;
  return { summary: E.RESULTS[args.answer], outcome: { title: E.RESULTS[args.answer], text: '' },
    verdict: { tone: args.answer === 'none' ? 'bad' : 'ok', title: up ? `${E.STAGE_ICON[c.stage]} ${c.stage} 단계로 올라갔어요` : `${E.RESULTS[args.answer]} · 점수 ${c.score}`,
      text: args.answer === 'none' ? '돈 신호를 낮췄어요. 다른 한 걸음을 해 보거나 다음 묶음으로 넘어가도 돼요' : up ? "반복되는 일을 자동화해서 손을 줄여요. '내 건물'에서 매달 숫자를 적어요" : '돈 신호를 올렸어요' } };
}
function log(){
  const db = load(), c = cluster(db, args.cid);
  const [p, h] = String(args.value || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/g) || [];
  if (p == null || h == null) fail('예처럼 순이익(원)과 손 쓴 시간을 띄어 적어 주세요. 예: 52000 1.5');
  c.logs = c.logs.filter(l => l.month !== MONTH);
  c.logs.push({ month: MONTH, profit: Number(p), hours: Number(h), at: AT });
  const before = c.stage; c.updated = AT; all(db); save(db);
  return { summary: `${MONTH} ${E.money(Number(p))} · ${h}시간`, verdict: { tone: 'ok', title: c.stage === '건물' ? (before === '건물' ? '🏢 건물이에요' : '🏢 건물이 됐어요') : `🏗️ 공사 중`,
    text: c.stage === '건물' ? `월 순이익 ${E.money(Number(p))}, 손 ${h}시간` : `건물 기준: 월 순이익 ${E.money(E.BUILDING.profit)} 이상, 손 월 ${E.BUILDING.hours}시간 이하` } };
}

/* ---------- project-pilot으로 넘기기: 메모에 #설계를 단 단기 카드를 만든다(파일럿의 '설계할 카드'가 받는다) ---------- */
const DEFAULT_FOLDERS = { project: '03_행동/단기보드' };
const unquote = v => { v = String(v ?? '').trim(); if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } } return /^'.*'$/.test(v) ? v.slice(1, -1) : v; };
const fmBlock = t => (String(t || '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/) || [, ''])[1];
const projectFolder = () => { const m = fmBlock(read(path.join(profile, '_설정.md'))).match(/^ {2}project:\s*(.+)$/m); return m ? unquote(m[1]) : DEFAULT_FOLDERS.project; };
const clean = s => String(s || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '제목 없음';
const needsQuote = s => s === '' || /^[\s]|[\s]$|^[-?:,\[\]{}#&*!|>'"%@`]|: | #|^(true|false|null|yes|no|on|off|~)$|^[+-]?\d/i.test(s) || /[\n\r]/.test(s);
const yLine = (k, v) => v == null ? `${k}:` : `${k}: ${needsQuote(String(v)) ? JSON.stringify(String(v)) : String(v)}`;
function handoff(){
  const db = load(), c = cluster(db, args.cid);
  all(db);
  if (c.handoff) return { summary: '이미 넘겼어요', verdict: { tone: 'ok', title: '이미 넘긴 묶음이에요', text: `카드: ${c.handoff.title} — 프로젝트 파일럿의 '설계할 카드'에서 [이 카드로 맡기기]를 눌러요` }, outcome: { title: '넘김', text: c.handoff.title } };
  if (blank(args.answer)) return { summary: '넘길지 묻기', ask: { question: `'${c.title}'을 프로젝트 파일럿으로 넘길까요?`, hint: '단기 카드를 하나 만들고 메모에 #설계를 달아요. 파일럿의 \'설계할 카드\'에 나타나요', inline: true,
    choices: [{ value: 'yes', label: '카드 만들어 넘기기', recommended: true }, { value: 'no', label: '그만두기' }] } };
  if (args.answer !== 'yes') return { summary: '그만뒀어요', outcome: { title: '안 넘김', text: '' } };
  const s = c.solution, title = clean(`${c.title} 자동화`);
  const goal = s && s.goal ? s.goal : `${c.who}의 '${c.loss}' 문제를 자동화 상품으로 풀어 월 순이익 5만원(손 월 1시간 이하)`;
  const memo = [`- ${goal} #설계`, `- 문제: ${c.who} — ${c.loss}. 지금은 ${c.workaround}`, ...(s ? [`- 수익: ${s.revenue.payer} · ${s.revenue.price} · ${s.revenue.channel}`, `- 이번 주 한 걸음: ${s.step}`] : []),
    `- 문제 수집기 점수 ${c.score} · ${E.STAGE_ICON[c.stage]} ${c.stage} · 글 ${c.posts.length}개`, ...c.posts.filter(p => p.url).slice(-3).map(p => `- 원글: ${p.url}`)].map(x => x.replace(/^# /, '## '));
  const dir = path.join(profile, projectFolder());
  let f = path.join(dir, `${title}.md`), n = 2;
  while (fs.existsSync(f)) f = path.join(dir, `${title} (${n++}).md`);
  const id = rid('t'), name = path.basename(f, '.md');
  writeAtomic(f, `---\n${[['type', 'project'], ['id', id], ['title', name], ['status', 'todo'], ['area', null], ['due', null], ['estimate', null], ['created', AT.slice(0, 10)]].map(([k, v]) => yLine(k, v)).join('\n')}\n---\n\n# 할 일\n\n# 완료 조건\n- 월 순이익 ${E.money(E.BUILDING.profit)} 이상, 손 월 ${E.BUILDING.hours}시간 이하\n\n# 메모\n${memo.join('\n')}\n`);
  c.handoff = { id, title: name, at: AT }; c.updated = AT; save(db);
  return { summary: `카드 ${name}`, outcome: { title: '넘김', text: name }, verdict: { tone: 'ok', title: '프로젝트 파일럿으로 넘겼어요', text: `카드 '${name}'을 만들었어요. 파일럿의 '설계할 카드'에서 [이 카드로 맡기기]를 눌러요` } };
}

/* ---------- 보기 바꾸기 ---------- */
function filterPick(){
  if (blank(args.answer)){
    const db = load(), cs = all(db), count = (k, v) => E.applyFilter(cs, { kind: k, value: v }).length;
    const uniq = a => [...new Set(a)].filter(Boolean);
    const choices = [{ value: '전체', label: `전체 (${count('전체')})` },
      ...uniq(cs.map(c => c.domain)).map(d => ({ value: `분야:${d}`, label: `분야 ${d} (${count('분야', d)})` })),
      ...uniq(cs.flatMap(c => c.posts.map(p => p.source))).map(s => ({ value: `출처:${s}`, label: `출처 ${s} (${count('출처', s)})` })),
      ...E.STAGES.map(s => ({ value: `단계:${s}`, label: `${E.STAGE_ICON[s]} ${s} (${count('단계', s)})` })),
      { value: '범위 밖', label: `범위 밖 (${count('범위 밖')})` }];
    return { summary: '보기 고르기', ask: { question: '문제 묶음을 어떻게 볼까요?', choices: choices.slice(0, 20) } };
  }
  const f = E.parseFilter(args.answer);
  return { summary: `보기: ${E.filterLabel(f)}`, settings_patch: { filter: args.answer }, outcome: { title: E.filterLabel(f), text: '' }, verdict: { tone: 'ok', title: `보기: ${E.filterLabel(f)}`, text: "'문제 묶음'을 새로 가져오면 바뀌어요" } };
}

const CMD = { 'collect-list': collectList, collect, 'collect-save': collectSave, 'paste-list': pasteList, 'clusters-list': clustersList, 'top-list': topList, 'verify-list': verifyList, 'building-list': buildingList, 'filter-list': filterList,
  'intake-prep': intakePrep, 'intake-save': intakeSave, 'solve-prep': solvePrep, 'solve-save': solveSave, result, contact, log, handoff, 'filter-pick': filterPick };
async function main(){
  if (argLost) return { error: '앞 단계 결과 파일을 찾지 못했어요(하루가 지나 지워졌을 수 있어요). 앞 단계부터 다시 해 주세요' };
  if (!fs.existsSync(path.join(profile, '_설정.md'))) return { error: `프로필 폴더를 찾지 못했어요: ${profile}` };
  const f = CMD[process.argv[2]];
  return f ? await f() : { error: `모르는 명령이에요: ${process.argv[2]}` };
}
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))){
  let r; try { r = await main(); } catch (e) { r = { error: e.user ? e.message : `처리하다 문제가 생겼어요(${e.message}). 이 단계를 다시 해 주세요` }; }
  process.stdout.write(JSON.stringify(r) + '\n');
}
