// 플러그인 실행기 — "이 컴퓨터에서 돌리기"를 켠 프로필의 플러그인 피드를 주기적으로 가져오고, 워크플로우를 단계별로 돌린다.
// 실제 실행(스크립트·AI·에이전트)은 이 컴퓨터의 pkm-ai-server가 맡는다. 여기는 순서와 상태만 다룬다.
//
// 이 컴퓨터에만 있는 것(동기화하지 않음): ~/.pkm-app/runner.json — AI 연결(주소·접속 토큰), 켠 프로필, 플러그인 설정값
// 프로필 데이터(동기화됨):  <프로필>/_플러그인/.state/<id>.json        — 피드 목록과 실행 기록. 켠 컴퓨터만 쓴다
//                           <프로필>/_플러그인/.state/<id>.inbox.<컴퓨터>.json — 다른 기기에서 누른 것(답하기·다시 하기…). 켠 컴퓨터가 읽어서 처리한다
// 비밀값(토큰)은 어느 쪽에도 두지 않는다 — pkm-ai-server에만 있고, 승인한 플러그인 스크립트의 환경 변수로만 간다.
// 이 컴퓨터의 플러그인 설정(runner.json)에는 설정값 말고도 every(목록마다 가져오는 주기, 분)와 gates(자동 시작한 작업에서 내 확인을 받을 단계)가 있다.
// 브라우저 단계(browser(…)): 브라우저 도구만 가진 에이전트. 에이전트가 사람에게 넘긴 일(BrowserHandoff)은 그 단계의 '내 확인'으로 올리고, 답하면 같은 작업을 이어 간다.
// 사람이 보는 화면(작업 화면의 브라우저 보기·미리 로그인)은 이 서버가 pkm-ai-server의 같은 탭으로 중계한다(browser()).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as plugins from './plugins.js';

const P = createRequire(import.meta.url)('../web/js/pkm-plugin.js');
const HOME = process.env.PKM_HOME ? path.resolve(process.env.PKM_HOME) : path.join(os.homedir(), '.pkm-app');
const CONF = path.join(HOME, 'runner.json');
export const HOST = (process.env.PKM_HOST_NAME || os.hostname().replace(/\.local$/, '')).slice(0, 40);
const hostSlug = h => h.replace(/[^\p{L}\p{N}._-]+/gu, '_');   // 파일 이름에 쓸 컴퓨터 이름(한글 이름도 그대로)
const TICK = Number(process.env.PKM_RUNNER_TICK || 10000);
const KEEP_RUNS = 60;
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
// 긴 인자 — pkm-ai-server는 인자 하나를 2000자까지 받는다. 넘는 값(앞 단계의 큰 JSON 등)은 이 컴퓨터의 임시 파일(0600)에 쓰고
// --키=@file:<경로>로 넘긴다. 스크립트가 그 파일을 읽는다. 하루 지난 파일은 지운다
const ARG_MAX = 1800, ARG_DIR = path.join(HOME, 'args');
export function bigArg(a, tag){
  if (a.length <= ARG_MAX) return a;
  const m = a.match(/^(--[^=\s]+=)([\s\S]*)$/), head = m ? m[1] : '', val = m ? m[2] : a;
  fs.mkdirSync(ARG_DIR, { recursive: true, mode: 0o700 });
  for (const f of fs.readdirSync(ARG_DIR)){ const p = path.join(ARG_DIR, f); try { if (Date.now() - fs.statSync(p).mtimeMs > 86400000) fs.rmSync(p, { force: true }); } catch {} }
  const f = path.join(ARG_DIR, `${tag}-${crypto.randomBytes(6).toString('hex')}.txt`);
  fs.writeFileSync(f, val, { mode: 0o600 });
  return `${head}@file:${f}`;
}

/* ---------- 이 컴퓨터의 설정 ---------- */
export function readConf(){ try { return JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch { return { profiles: {} }; } }
function writeConf(c){
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const tmp = `${CONF}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, CONF);
}
const profConf = (c, p) => (c.profiles[p] ||= { on: false, plugins: {} });
const plugConf = (c, p, id) => (profConf(c, p).plugins[id] ||= { settings: {}, auto: false, auto_since: null });
const everyOf = (pc, feed) => (pc.every && pc.every[feed.name]) || feed.every;   // 이 컴퓨터에서 바꾼 주기가 먼저
const gateKey = (workflow, step) => `${workflow}|${step}`;
export const EVERY_MIN = 5, EVERY_MAX = 1440;

/* ---------- pkm-ai-server 호출 ---------- */
async function ai(conn, pathname, opt = {}){
  if (!conn || !conn.url || !conn.token) throw fail(409, '이 컴퓨터의 AI 연결이 없어요');
  let r;
  try { r = await fetch(conn.url + pathname, { ...opt, headers: { authorization: `Bearer ${conn.token}`, 'content-type': 'application/json' }, signal: opt.signal || AbortSignal.timeout(15000) }); }
  catch { throw fail(502, `AI 서버(${conn.url})에 닿지 않아요. 이 컴퓨터에서 pkm-ai-server가 켜져 있는지 확인해 주세요`); }
  if (opt.raw && r.ok) return r;
  const body = await r.json().catch(() => ({}));
  if (r.status === 404 && /^\/v1\/(plugins|secrets)/.test(pathname)) throw fail(409, `AI 서버(${conn.url})가 플러그인을 모르는 옛 버전이에요. pkm-ai-server를 업데이트한 뒤 다시 켜 주세요`);   // 켜 둔 서버가 업데이트 전 코드일 때
  if (!r.ok) throw fail(r.status === 401 ? 409 : r.status, body.error || `AI 서버 오류 ${r.status}`);
  return body;
}

/* ---------- 브라우저 단계 ----------
   탭 키는 `<프로필>|<플러그인 id>|<이름>` — 이름은 항목 id(브라우저 단계)나 login(미리 로그인). pkm-ai-server의 키는 영문·숫자 몇 가지만이라 다른 글자가 든 조각은 해시로 바꾼다.
   채팅 방의 키(chat:…)와 겹치지 않고, 화면이 보낸 키는 앞부분으로 그 플러그인 것인지 가린다 */
const TAB_RE = /^[\w:.|\-/]{1,160}$/;
const tabSeg = v => /^[\w.-]{1,48}$/.test(String(v)) ? String(v) : 'h' + crypto.createHash('sha1').update(String(v)).digest('hex').slice(0, 16);
export const tabKey = (p, id, name) => `${tabSeg(p)}|${id}|${tabSeg(name)}`;
const LOST = 'AI 서버에서 이 작업을 찾지 못했어요. 이 단계를 다시 해 주세요';
// 앞 스크립트 단계가 낸 옵션 { vars, allow, files, tab } — 꼴이 틀린 값은 버리지 않고 멈춘다(갈 수 있는 곳이 조용히 넓어지지 않게)
function browserOpts(v){
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {}, out = {};
  const vars = o.vars == null ? [] : Object.entries(typeof o.vars === 'object' && !Array.isArray(o.vars) ? o.vars : { '': null });
  if (vars.length > 60 || vars.some(([k, x]) => !k || k.length > 60 || x == null || typeof x === 'object' || String(x).length > 4000)) throw fail(400, '브라우저 옵션의 vars는 { 이름: 값 } 60개까지예요(이름 60자, 값 4,000자)');
  if (vars.length) out.vars = Object.fromEntries(vars.map(([k, x]) => [k, String(x)]));
  if (o.allow != null){
    const hosts = (Array.isArray(o.allow) ? o.allow : [null]).map(h => String(h ?? '').trim().toLowerCase());
    if (hosts.length > 40 || hosts.some(h => !/^[a-z0-9*][a-z0-9.*-]{0,252}(:\d{1,5})?$/.test(h))) throw fail(400, '브라우저 옵션의 allow는 호스트 이름 40개까지예요(예: www.example.com)');
    out.allow = [...new Set(hosts)];
  }
  if (o.files != null){
    const files = Array.isArray(o.files) ? o.files : [null];
    if (files.length > 10 || files.some(f => !f || typeof f.path !== 'string' || !path.isAbsolute(f.path))) throw fail(400, '브라우저 옵션의 files는 { name, path(절대 경로) } 10개까지예요');
    if (files.length) out.files = files.map(f => ({ name: clip(f.name || path.basename(f.path), 120), path: f.path }));
  }
  return { opts: out, tab: o.tab == null || o.tab === '' ? null : String(o.tab) };
}
// 브라우저 단계가 남기는 글에서 내 정보 값을 자리표시로 되돌린다(화면에 찍힌 값을 에이전트가 옮겨 적었더라도 상태 파일에는 남지 않게 — 상태 파일은 동기화된다)
function scrub(v, vars){
  const pairs = Object.entries(vars && typeof vars === 'object' ? vars : {}).map(([k, x]) => [k, String(x ?? '')]).filter(([, x]) => x.length >= 2).sort((a, b) => b[1].length - a[1].length);
  const walk = z => typeof z === 'string' ? pairs.reduce((t, [k, x]) => t.split(x).join(`{{${k}}}`), z) : Array.isArray(z) ? z.map(walk) : z && typeof z === 'object' ? Object.fromEntries(Object.entries(z).map(([k, y]) => [k, walk(y)])) : z;
  return pairs.length ? walk(v) : v;
}

/* ---------- 같은 컴퓨터의 pkm-ai-server ----------
   pkm-ai-server는 켤 때 ~/.pkm-ai-server/local.json(0600)에 주소와 이 컴퓨터용 토큰을 남긴다. 같은 사용자 계정인 이 서버는 그걸 읽어 연결 코드 없이 붙는다 */
const AI_HOME = process.env.PKM_AI_HOME ? path.resolve(process.env.PKM_AI_HOME) : path.join(os.homedir(), '.pkm-ai-server');
function localConn(){
  try {
    const j = JSON.parse(fs.readFileSync(path.join(AI_HOME, 'local.json'), 'utf8')), url = String(j.url || '').replace(/\/+$/, '');
    return /^https?:\/\/[\w.:\-[\]]+$/.test(url) && /^[\w.~-]{16,200}$/.test(String(j.token || '')) ? { url, token: j.token } : null;
  } catch { return null; }
}
// 화면이 '이 컴퓨터의 AI에 연결하기'를 보여 줄지 — { found, ok, url, connected }. 토큰은 내보내지 않는다
export async function localAI(){
  const conn = localConn();
  if (!conn) return { found: false };
  let ok = false;
  try { ok = (await fetch(`${conn.url}/v1/providers`, { headers: { authorization: `Bearer ${conn.token}` }, signal: AbortSignal.timeout(2000) })).ok; } catch {}
  const cur = readConf().ai;
  return { found: true, ok, url: conn.url, connected: !!cur && cur.url === conn.url && cur.token === conn.token };
}
export async function connectLocalAI(){
  const conn = localConn();
  if (!conn) throw fail(404, '이 컴퓨터에서 켠 pkm-ai-server를 찾지 못했어요. pkm-ai-server를 최신으로 받아 켠 뒤 다시 눌러 주세요');
  await ai(conn, '/v1/plugins');   // 닿는지, 토큰이 맞는지
  const c = readConf(); c.ai = { ...conn, at: now() }; writeConf(c);
  return { url: conn.url };
}

/* ---------- 상태 파일 ---------- */
export function createRunner({ DATA, listProfiles, onWrite = () => {}, onAsk = () => {} }){
  const stateDir = p => path.join(DATA, p, P.DIR, '.state');
  const statePath = (p, id) => path.join(stateDir(p), `${id}.json`);
  const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const readState = (p, id) => readJSON(statePath(p, id), null) || { v: 1, feeds: {}, runs: [], applied: [] };
  function writeState(p, id, st){
    st.host = HOST; st.updated = now();
    fs.mkdirSync(stateDir(p), { recursive: true });
    const f = statePath(p, id), tmp = `${f}.${process.pid}.tmp`, text = JSON.stringify(st, null, 1) + '\n';
    if (readJSON(f, null) && fs.readFileSync(f, 'utf8') === text) return;
    fs.writeFileSync(tmp, text); fs.renameSync(tmp, f);
    onWrite(p);
  }
  const busy = new Set();   // 프로필|플러그인 — 한 번에 한 차례만
  const retry = new Map();  // 프로필|플러그인 → 'failed'(실패한 목록) | 'all' — 승인·비밀값·설정을 바꾼 뒤 주기를 기다리지 않고 다시 가져온다
  function kick(p, id, what){ const k = `${p}|${id}`; if (retry.get(k) !== 'all') retry.set(k, what); tick(p).catch(e => console.error(`플러그인 실행기: ${e.message}`)); }
  // 돌리는 컴퓨터는 프로필마다 하나 — 동기화되는 runner.json에 적는다. 다른 컴퓨터로 옮기면 앞 컴퓨터는 받는 대로 멈춘다
  const runnerFile = p => path.join(stateDir(p), 'runner.json');
  const runnerHost = p => (readJSON(runnerFile(p), {}) || {}).host || null;
  const mine = p => profConf(readConf(), p).on && runnerHost(p) === HOST;

  async function installed(p){ return (await plugins.list(path.join(DATA, p))).filter(x => x.ok && x.manifest); }
  async function pluginOf(p, id){
    const x = (await installed(p)).find(x => x.id === id);
    if (!x) throw fail(404, '설치된 플러그인이 아니에요');
    const files = Object.fromEntries((await fs.promises.readdir(path.join(x.path, 'feeds')).catch(() => [])).filter(f => f.endsWith('.md')).map(f => [f, fs.readFileSync(path.join(x.path, 'feeds', f), 'utf8')]));
    const wf = Object.fromEntries((await fs.promises.readdir(path.join(x.path, 'workflows')).catch(() => [])).filter(f => f.endsWith('.md')).map(f => [f, fs.readFileSync(path.join(x.path, 'workflows', f), 'utf8')]));
    // 체크인이 부르는 프롬프트는 이름 그대로(prompts/…md) 넘겨야 검사기가 찾는다
    const named = async dir => (await fs.promises.readdir(path.join(x.path, dir)).catch(() => [])).filter(f => f.endsWith('.md')).map(f => { const t = fs.readFileSync(path.join(x.path, dir, f), 'utf8'); return { path: `${dir}/${f}`, size: t.length, text: t }; });
    const docs = async dir => Object.values(Object.fromEntries((await fs.promises.readdir(path.join(x.path, dir)).catch(() => [])).filter(f => f.endsWith('.md')).map(f => [f, fs.readFileSync(path.join(x.path, dir, f), 'utf8')])));
    const workflows = Object.values(wf).flatMap(t => P.parseWorkflows(t));
    const feeds = Object.values(files).flatMap(t => P.parseFeeds(t)).map(d => { const starts = P.startsOf(d.start);
      return { ...d, every: Number(String(d.every || 60).replace(/분$/, '')) || 60, days: d.days || 'daily', start: starts[0] || null, starts, start_mode: starts.length ? d.start_mode || 'button' : null }; });
    // 검색·편집기·퀵링크는 검사기가 정리한 꼴 그대로 쓴다(설치할 때 이미 검사했다)
    const v = P.validate([{ path: 'plugin.md', size: 0, text: fs.readFileSync(path.join(x.path, 'plugin.md'), 'utf8') },
      ...(await docs('searches')).map((t, i) => ({ path: `searches/${i}.md`, size: t.length, text: t })), ...(await docs('editors')).map((t, i) => ({ path: `editors/${i}.md`, size: t.length, text: t })),
      ...(await docs('links')).map((t, i) => ({ path: `links/${i}.md`, size: t.length, text: t })),
      ...(await docs('checkins')).map((t, i) => ({ path: `checkins/${i}.md`, size: t.length, text: t })),
      ...(await named('prompts')),
      ...x.manifest.permissions.bundled.map(b => ({ path: b, size: 0, text: '' }))]);
    return { ...x, feeds, workflows, searches: v.searches || [], editors: v.editors || [], checkins: v.checkins || [], links: v.links || [] };
  }
  function settingsFor(x, conf){
    const v = conf.settings || {};
    return Object.fromEntries(x.manifest.settings.map(s => [s.key, v[s.key] ?? s.default]));
  }

  /* ---------- 자리 채우기: {title} {키.필드} {설정키} ---------- */
  // 채우지 못한 자리는 misses에 모은다(설정값 안의 {key}처럼 채운 값 속 중괄호는 스크립트 몫이라 다시 보지 않는다)
  // blank면 못 채운 자리를 빈 값으로 넘긴다 — 사람이 "빈 값은 두고 이 단계 하기"를 골랐을 때
  const stepOf = (run, k) => run.steps.find(x => x.key === k.split('.')[0]);
  const stepValue = (run, k) => { let v = (stepOf(run, k) || {}).output; for (const r of k.split('.').slice(1)) v = v == null ? undefined : v[r]; return v; };   // '단계.필드' → 그 단계 결과의 값(글로 바꾸지 않은 그대로)
  function fill(text, run, settings, misses = [], blank = false){
    const vars = { id: run.item.id, title: run.item.title, url: run.item.url || '', ...run.item.vars, ...settings };
    return String(text).replace(/\{([^{}\s]+)\}/g, (m, k) => {
      let v;
      if (k.includes('.')){
        const s = stepOf(run, k);
        v = stepValue(run, k);
        if (v == null && s && s.when_skipped) v = '';   // when으로 건너뛴 단계 — 뒤 단계에는 빈 값으로
      } else v = vars[k];
      if (v == null){ misses.push(m); return blank ? '' : m; }
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }

  /* ---------- 피드 ---------- */
  const inWindow = (d, t = new Date()) => {
    if (d.days === 'weekdays' && (t.getDay() === 0 || t.getDay() === 6)) return false;
    if (!d.hours) return true;
    const [a, b] = d.hours.split('-'), hm = t.toTimeString().slice(0, 5);
    return hm >= a && hm <= b;
  };
  function normItem(it){
    if (!it || typeof it !== 'object' || it.id == null) return null;
    const strs = (a, n, len = 80) => (Array.isArray(a) ? a : []).filter(x => x != null && x !== '').slice(0, n).map(x => clip(x, len));
    return {
      id: clip(it.id, 200), title: clip(it.title || it.id, 300), url: /^https?:\/\//.test(String(it.url || '')) ? String(it.url) : '',
      meta: strs(it.meta, 6), tags: strs(it.tags, 4, 30), at: it.at ? String(it.at) : null, version: it.version != null ? clip(it.version, 100) : null,
      detail: (Array.isArray(it.detail) ? it.detail : []).slice(0, 8).map(d => ({ who: clip(d.who, 120), at: d.at ? String(d.at) : null, text: clip(d.text, 2000), url: /^https?:\/\//.test(String(d.url || '')) ? String(d.url) : '', kind: d.kind ? clip(d.kind, 30) : '' })),
      vars: Object.fromEntries(Object.entries(it.vars && typeof it.vars === 'object' ? it.vars : {}).slice(0, 20).map(([k, v]) => [clip(k, 40), clip(v, 6000)])),
      // 정렬 칩이 읽는 값 — 숫자나 ISO 날짜 글자. 모르는 값(null·빈 글)은 화면이 늘 맨 뒤로 둔다
      sort: Object.fromEntries(Object.entries(it.sort && typeof it.sort === 'object' ? it.sort : {}).slice(0, 6).filter(([k]) => /^[a-z_][a-z0-9_]{0,40}$/.test(k))
        .map(([k, v]) => [k, typeof v === 'number' && Number.isFinite(v) ? v : v == null || v === '' ? null : clip(v, 40)]))
    };
  }
  async function scriptJob(conn, x, ref, args, cwd){
    const body = { plugin: { id: x.id, root: x.path }, args, tag: `plugin:${x.id}` };
    if (/^scripts\//.test(ref)) body.plugin_script = ref; else body.script = ref;
    if (cwd) body.cwd = cwd;
    return (await ai(conn, '/v1/jobs', { method: 'POST', body: JSON.stringify(body) })).job;
  }
  const tokens = s => String(s).trim().split(/\s+/).filter(Boolean);
  function parseOut(stdout){
    const t = String(stdout || '').trim();
    try { return JSON.parse(t); } catch {}
    const fenced = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);   // AI가 코드 블록으로 감싼 JSON
    if (fenced) try { return JSON.parse(fenced[1]); } catch {}
    const last = t.split('\n').reverse().find(l => /^\s*\{/.test(l));   // 마지막 줄의 JSON
    try { return last ? JSON.parse(last) : null; } catch { return null; }
  }
  const jobError = j => {
    const o = parseOut(j.result && j.result.stdout);
    if (o && o.error) return clip(o.error, 500);
    const tail = String((j.result && j.result.stderr) || '').trim().split('\n').filter(Boolean).pop();
    return clip(tail || j.error || j.message || '실패했어요', 500);
  };

  async function refreshFeed(p, x, conf, feed, st, conn){
    const f = st.feeds[feed.name] ||= { items: [], first: {} };
    f.running = true; f.started = now(); writeState(p, x.id, st);
    try {
      const missing = [], settings = settingsFor(x, conf), args = tokens(feed.run).map(a => fill(a, { item: { id: '', title: '', vars: {} }, steps: [] }, settings, missing));
      if (missing.length) throw fail(400, `설정이 비어 있어요: ${missing.join(' ')}`);
      let job = await scriptJob(conn, x, args[0], args.slice(1));
      for (let i = 0; i < 60 && !['done', 'error', 'canceled'].includes(job.status); i++){
        await new Promise(r => setTimeout(r, 2000));
        job = (await ai(conn, `/v1/jobs/${job.id}`)).job;
      }
      if (job.status !== 'done') throw fail(502, job.status === 'error' ? jobError(job) : '가져오기가 2분 안에 끝나지 않았어요');
      const out = parseOut(job.result.stdout);
      if (!out || !Array.isArray(out.items)) throw fail(502, '스크립트 결과에 items 목록이 없어요');
      const items = out.items.map(normItem).filter(Boolean).slice(0, 200);
      // 처음 가져온 목록은 "원래 있던 것" — 자동 시작을 먼저 켰어도 이미 할당돼 있던 티켓까지 한꺼번에 돌지 않게
      for (const it of items) f.first[it.id] ||= f.seeded ? now() : '1970-01-01T00:00:00.000Z';
      f.seeded = true;
      for (const k of Object.keys(f.first)) if (!items.some(it => it.id === k) && Date.now() - Date.parse(f.first[k]) > 30 * 86400000) delete f.first[k];
      const t = now(); Object.assign(f, { items, at: t, items_at: t, ok: true, error: null, note: out.note ? clip(out.note, 200) : null });   // items_at: 오류 뒤에도 남는 목록이 언제 것인지
      const hid = st.hidden && st.hidden[feed.name];   // 닫은 항목 — 목록에서 빠진 것은 기록도 지운다
      if (hid) for (const k of Object.keys(hid)) if (!items.some(it => it.id === k)) delete hid[k];
    } catch (e) {
      Object.assign(f, { at: now(), ok: false, error: clip(e.message, 500) });
    } finally { f.running = false; }
    // 새로 들어온 항목 — 자동 시작을 켠 뒤에 처음 본 것만 자동으로
    const pc = conf;
    if (f.ok && feed.start){
      // reask: yes — 항목 version이 바뀌면(접수 방법을 알아냈다·계정을 넣었다·날이 바뀌었다) 내 확인을 기다리던 스크립트 단계를 다시 돌려 묻는 내용을 새로 만든다
      if (feed.reask === 'yes') for (const r of st.runs){
        if (r.feed !== feed.name || r.status !== 'input') continue;
        const it = f.items.find(i => i.id === r.item.id), s = r.steps.find(z => z.status === 'input');
        if (!it || !s || s.kind !== 'script' || !s.ask || s.ask.type !== 'choice' || (it.version ?? null) === (r.item.version ?? null)) continue;
        Object.assign(r.item, { title: it.title, url: it.url, version: it.version ?? null, vars: it.vars || {} });
        Object.assign(s, { status: 'pending', job: null, ask: null, output: null, error: null, answer: null }); Object.assign(r, { status: 'queued', updated: now() });
      }
      const live = new Set(f.items.map(it => it.id));
      for (const r of st.runs){
        if (r.feed !== feed.name) continue;
        if (r.status === 'queued' && !live.has(r.item.id)) Object.assign(r, { status: 'canceled', note: '목록에서 빠져서 시작하지 않았어요', updated: now() });
        else if (['input', 'stopped'].includes(r.status)) r.gone = live.has(r.item.id) ? undefined : r.gone || now();   // 할당이 풀렸거나 끝났을 수 있다 — 사람에게 보인다
      }
      if (feed.start_mode === 'auto' && pc.auto && pc.auto_since){
        for (const it of f.items){
          if (f.first[it.id] < pc.auto_since || st.runs.some(r => r.feed === feed.name && r.item.id === it.id)) continue;
          newRun(st, x, feed, it, 'auto');
        }
      }
    }
    writeState(p, x.id, st);
  }

  function newRun(st, x, feed, item, by, wname = feed.start, answer, preset){
    const w = x.workflows.find(w => w.name === wname);
    if (!w) throw fail(400, `워크플로우 "${wname}"가 없어요`);
    const run = { id: 'r' + crypto.randomBytes(5).toString('hex'), feed: feed.name, workflow: w.name, by, item: { id: item.id, title: item.title, url: item.url, version: item.version ?? null, vars: item.vars || {} },
      status: 'queued', created: now(), updated: now(), steps: w.steps.map(s => ({ key: s.key, name: s.name, kind: s.kind, mode: s.mode, status: 'pending' })) };
    // 첫 단계가 ask면 시작할 때 받은 답으로 바로 채운다(시작 버튼을 누를 때 물어본다)
    if (answer != null && w.steps[0] && w.steps[0].kind === 'ask') run.steps[0].answer = String(answer).slice(0, 2000);
    // 같은 항목을 한 갈래 더(fork) — 그 단계에 미리 답을 넣어 둔다(예: 저장소를 새로 고르게)
    const ps = preset && run.steps.find(s => s.key === preset.step); if (ps) ps.answer = String(preset.value ?? '').slice(0, 2000);
    st.runs.unshift(run);
    st.runs = st.runs.slice(0, KEEP_RUNS);
    return run;
  }

  /* ---------- 실행: 한 플러그인에서 한 번에 하나씩 ---------- */
  async function advance(p, x, conf, st, conn){
    let run = st.runs.find(r => ['running', 'waiting'].includes(r.status));
    if (!run){
      run = [...st.runs].reverse().find(r => r.status === 'queued');
      if (!run) return;
      Object.assign(run, { status: 'running', started: now(), updated: now() });
    }
    let settings = settingsFor(x, conf); const def = x.workflows.find(w => w.name === run.workflow);
    if (!def){ Object.assign(run, { status: 'stopped', note: `워크플로우 "${run.workflow}"가 플러그인에서 사라졌어요`, updated: now() }); return; }
    for (const step of run.steps){
      if (['done', 'skipped'].includes(step.status)) continue;
      const d = def.steps.find(s => s.key === step.key) || {};
      if (step.status === 'input') return;   // 사람 답을 기다린다
      if (step.status === 'failed'){ run.status = 'stopped'; return; }
      if (step.status === 'pending'){
        if (d.kind === 'manual'){ Object.assign(step, { status: 'input', ask: { type: 'confirm' }, started: now() }); run.status = 'input'; run.updated = now(); return; }
        if (d.kind === 'ask'){   // 사람에게 글 받기 — 답이 있으면 끝, 없으면 묻고 멈춘다. 다음 단계는 {키.answer}로 쓴다
          if (step.answer != null && String(step.answer).trim()){ const v = String(step.answer).trim(); Object.assign(step, { status: 'done', output: { answer: v }, text: clip(v, 6000), finished: now(), ask: null }); run.updated = now(); continue; }
          Object.assign(step, { status: 'input', ask: normAsk({ question: d.name, free: true, placeholder: d.body }), started: now() }); Object.assign(run, { status: 'input', updated: now() }); return;
        }
        if (d.when){   // when {단계.필드} — 그 값이 비었으면 이 단계를 건너뛴다(예: 고칠 점이 없으면 반영 AI를 부르지 않는다)
          const v = fill(d.when, run, settings).trim();
          if (!v || v === d.when || v === '{}' || v === '[]' || v === 'false'){ Object.assign(step, { status: 'skipped', when_skipped: true, finished: now() }); run.updated = now(); continue; }
        }
        if (run.by === 'auto' && !step.gate_ok && conf.gates && conf.gates[gateKey(run.workflow, step.key)]){
          Object.assign(step, { status: 'input', ask: { type: 'gate', question: `${step.name}을 할까요?` }, started: now() }); Object.assign(run, { status: 'input', updated: now() }); return;
        }
        try { step.job = await startStep(conn, x, run, step, d, settings, p); Object.assign(step, { status: 'running', started: now(), error: null }); }
        catch (e) { Object.assign(step, { status: 'failed', error: clip(e.message, 500), finished: now() }); Object.assign(run, { status: 'stopped', updated: now() }); return; }
        run.status = 'running'; run.updated = now();
        return;   // 다음 차례에 결과를 본다
      }
      if (['running', 'waiting'].includes(step.status)){
        let j;
        try { j = (await ai(conn, `/v1/jobs/${step.job}`)).job; }
        catch (e) {
          if (e.status === 404){ Object.assign(step, { status: 'failed', error: LOST, finished: now() }); Object.assign(run, { status: 'stopped', updated: now() }); return; }   // 작업이 사라졌다(AI 서버가 기록을 잃었다) — 기다려도 오지 않는다
          step.note = clip(e.message, 300); return;
        }
        if (j.status === 'waiting'){ Object.assign(step, { status: 'waiting', reason: j.reason, until: j.until || null }); Object.assign(run, { status: 'waiting', updated: now() }); return; }
        const web = d.kind === 'browser', my = web && d.browser ? (stepValue(run, d.browser.slice(1, -1)) || {}).vars : null;   // my: 내 정보 — 이 단계가 남기는 글에서 가린다
        if (web && !['done', 'error', 'canceled'].includes(j.status)){
          // 브라우저 도구만 쓰는 단계 — 다른 확인 요청은 거절하고, 사람에게 넘긴 일은 내 확인으로 올린다(작업은 답을 기다리며 살아 있다)
          for (const q of (j.pending || []).filter(q => q.tool !== 'BrowserHandoff')) await ai(conn, `/v1/jobs/${step.job}/answer`, { method: 'POST', body: JSON.stringify({ request_id: q.id, allow: false, message: '이 단계에서는 브라우저 도구만 써요' }) }).catch(() => {});
          const h = (j.pending || []).find(q => q.tool === 'BrowserHandoff' && !(step.answered || []).includes(q.id));
          if (h){
            const inp = h.input || {}, what = scrub(clip(inp.message || h.description || '브라우저에서 할 일이 있어요', 300), my);
            Object.assign(step, { status: 'input', ask: { type: 'handoff', question: what, request_id: String(h.id), url: /^https?:\/\//.test(String(inp.url || '')) ? clip(inp.url, 500) : '', title: clip(inp.title || '', 120) } });
            Object.assign(run, { status: 'input', updated: now() });
            Promise.resolve().then(() => onAsk(p, { plugin: x.id, name: x.manifest.name, run: run.id, step: step.key, title: run.item.title, question: what })).catch(() => {});
            return;
          }
        }
        if (!['done', 'error', 'canceled'].includes(j.status)){ if (step.status !== 'running'){ step.status = 'running'; run.status = 'running'; run.updated = now(); } return; }
        if (j.status !== 'done'){ Object.assign(step, { status: 'failed', error: j.status === 'canceled' ? '취소됐어요' : scrub(jobError(j), my), text: scrub(clip(j.result && (j.result.stdout || j.result.text), 4000), my), finished: now() }); Object.assign(run, { status: 'stopped', updated: now() }); return; }
        let out = d.kind === 'script' ? parseOut(j.result.stdout) : (j.result.structured || parseOut(j.result.text));
        // 브라우저 단계의 결과는 웹 페이지를 읽은 AI의 글이다 — 실행기를 움직이는 필드(묻기·설정 바꾸기·지우기·갈래)는 스크립트 단계만 낸다
        if (web && out && typeof out === 'object'){ out = scrub(out, my); for (const k of ['ask', 'settings_patch', 'forget', 'lane', 'change', 'fork']) delete out[k]; }
        const text = scrub(clip(d.kind === 'script' ? (out ? out.summary || '' : j.result.stdout) : j.result.text, 6000), my);
        // JSON을 내려다 중간에 잘린 출력 — 결과 없이 넘기면 다음 단계가 "채우지 못한 값"으로 멈춘다. 여기서 멈춰 다시 하게 한다
        if (d.kind === 'script' && !out && /^\s*\{/.test(j.result.stdout || '')){ Object.assign(step, { status: 'failed', error: '스크립트 결과를 읽지 못했어요. 출력이 중간에 잘렸을 수 있어요', text, finished: now() }); Object.assign(run, { status: 'stopped', updated: now() }); return; }
        if (out && out.error){ Object.assign(step, { status: 'failed', error: clip(out.error, 500), output: out, text, finished: now() }); Object.assign(run, { status: 'stopped', updated: now() }); return; }
        if (out && out.ask){
          Object.assign(step, { status: 'input', ask: normAsk(out.ask), output: out, text, job: null }); Object.assign(run, { status: 'input', updated: now() });
          const fd = x.feeds.find(f => f.name === run.feed), fs_ = st.feeds[run.feed];   // 앞 단계가 항목을 바꿨을 수 있다(예: AI 안 저장) — 내 확인을 묻는 동안 목록도 맞게 다시 가져온다
          if (fd && (fd.starts.length > 1 || fd.start_mode !== 'auto') && fs_) fs_.at = null;
          return;
        }
        if (out && out.settings_patch){   // 같은 차례에 이어 시작하는 다음 단계도 바뀐 설정을 보게. 목록도 바뀐 설정으로 다시 가져온다(설정을 인자로 받는 목록·다시 묻기)
          patchSettings(p, x, out.settings_patch); settings = settingsFor(x, plugConf(readConf(), p, x.id));
          for (const fs_ of Object.values(st.feeds)) if (fs_) fs_.at = null;
        }
        if (out && out.lane){   // 갈래 이름(예: 저장소) — 같은 항목·워크플로우에서 같은 갈래는 하나만 돈다
          const lane = clip(out.lane, 60);
          if (st.runs.some(r => r !== run && r.feed === run.feed && r.item.id === run.item.id && r.workflow === run.workflow && r.lane === lane && !['done', 'canceled'].includes(r.status))){
            Object.assign(step, { status: 'failed', error: `${lane}에서 이미 이 항목을 작업하고 있어요`, output: out, text, finished: now() }); Object.assign(run, { status: 'stopped', updated: now() }); return;
          }
          run.lane = lane;
        }
        if (out && Array.isArray(out.forget)) forgetAnswers(run, step, out.forget);
        Object.assign(step, { status: 'done', output: out, text, finished: now(), session: j.result.session || undefined, until: null, reason: null });
        run.updated = now();
        continue;
      }
    }
    Object.assign(run, { status: 'done', finished: now(), updated: now() });
    // 담기·실행·멈추기처럼 항목 상태를 바꾸는 워크플로우 — 끝나면 다음 차례에 목록을 바로 새로 가져온다
    const fd = x.feeds.find(f => f.name === run.feed), fs_ = st.feeds[run.feed];
    if (fd && (fd.starts.length > 1 || fd.start_mode !== 'auto') && fs_) fs_.at = null;   // 늘 남는 목록(자동 시작이 아닌 것)
    slim(run);
  }
  // 스크립트가 forget: [단계 키]를 내면 그 앞 단계의 사람 답(붙여 넣은 원문 등)을 실행 기록에서 지운다 — 상태 파일은 동기화된다
  const forgetAnswers = (run, step, keys) => {
    for (const k of keys.slice(0, 10)){
      const s = run.steps.find(z => z !== step && z.key === k && ['done', 'skipped'].includes(z.status));
      if (!s) continue;
      const out = s.output && typeof s.output === 'object' ? Object.fromEntries(Object.entries(s.output).filter(([f]) => f !== 'answer')) : null;
      Object.assign(s, { answer: null, answer_label: null, text: '(지웠어요)', output: { ...(out || {}), forgotten: true } });
    }
  };
  // 끝나거나 그만둔 실행은 다음 단계에 넘기려고 받은 큰 값(이름이 _로 시작하는 필드, 예: diff)과 private 짚은 곳(예: 제출용 내 정보)을 버린다 — 상태 파일은 동기화된다
  const slim = run => { for (const s of run.steps) if (s.output && typeof s.output === 'object'){
    for (const k of Object.keys(s.output)) if (k.startsWith('_')) delete s.output[k];
    if (Array.isArray(s.output.findings)) s.output.findings = s.output.findings.filter(f => !(f && f.private));
  } };
  const normAsk = a => ({ type: 'choice', question: clip(a.question || '골라 주세요', 200), hint: a.hint ? clip(a.hint, 300) : '',
    choices: (Array.isArray(a.choices) ? a.choices : []).slice(0, 20).map(c => typeof c === 'string' ? { value: c, label: c } : { value: clip(c.value, 500), label: clip(c.label || c.value, 120), hint: c.hint ? clip(c.hint, 120) : '', recommended: c.recommended === true, confirm: c.confirm ? clip(c.confirm, 200) : '' }),
    free: a.free === true, placeholder: a.placeholder ? clip(a.placeholder, 80) : '', inline: a.inline === true, value: a.value ? clip(a.value, 2000) : '' });   // value: 적는 칸에 미리 채울 글(고쳐서 보낸다)   // inline: 목록 줄에서 바로 고르는 버튼으로

  async function startStep(conn, x, run, step, d, settings, p){
    let web = null;   // 브라우저 단계 — 이 컴퓨터에서 브라우저까지 승인했을 때만, 앞 스크립트 단계가 낸 옵션으로
    if (d.kind === 'browser'){
      const bs = await browserState(p, x.id);
      if (!bs.ok) throw fail(409, bs.message);
      const v = d.browser ? stepValue(run, d.browser.slice(1, -1)) : {};
      if ((v == null || typeof v !== 'object') && !step.lenient) throw fail(400, `채우지 못한 값이 있어요: ${d.browser}`);
      const o = browserOpts(v);
      step.tab = tabKey(p, x.id, o.tab || run.item.id);
      web = { tab: step.tab, only: true, ...o.opts };
    }
    const miss = [], cwd = d.cwd ? fill(d.cwd, run, settings, miss) : null;
    if (cwd && (miss.length || !path.isAbsolute(cwd) || !fs.existsSync(cwd))) throw fail(400, `작업 폴더를 찾지 못했어요: ${cwd}`);
    if (d.kind === 'script'){
      const args = tokens(d.body).map(a => fill(a, run, settings, miss, !!step.lenient));
      if (step.answer != null) args.push(`--answer=${step.answer}`);
      if (miss.length && !step.lenient) throw fail(400, `채우지 못한 값이 있어요: ${miss.join(' ')}`);
      return (await scriptJob(conn, x, args[0], args.slice(1).map(a => bigArg(a, `${run.id}-${String(step.key).replace(/[^\w-]/g, '')}`)), cwd)).id;
    }
    let prompt = d.body, schema = null;
    if (/^prompts\/[^\s]+\.md$/.test(prompt)){
      const sf = path.join(x.path, prompt.replace(/\.md$/, '.schema.json'));   // 옆에 같은 이름의 .schema.json이 있으면 그 모양으로 답하게 한다
      if (fs.existsSync(sf)) try { schema = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch { throw fail(400, `${path.basename(sf)}이 JSON이 아니에요`); }
      prompt = fs.readFileSync(path.join(x.path, prompt), 'utf8');
    }
    const pm = []; prompt = fill(prompt, run, settings, pm);
    const lost = pm.filter(k => k.includes('.') && run.steps.some(z => z.key === k.slice(1, -1).split('.')[0] && z.status !== 'skipped'));   // JSON 예시 같은 중괄호와 사람이 건너뛴 단계는 두고, 끝난 단계에 빠진 결과만 본다
    if (lost.length && !step.lenient) throw fail(400, `채우지 못한 값이 있어요: ${lost.join(' ')}`);
    if (step.answer != null) prompt += `\n\n사용자 추가 요청: ${step.answer}`;
    const provider = web ? 'claude' : settings.provider || 'claude';   // 브라우저 도구는 Claude만
    const body = { plugin: { id: x.id, root: x.path }, provider, prompt, tag: `plugin:${x.id}` };
    if (schema){   // ai·agent·browser 모두 — 결과(구조화 출력)가 단계 결과가 된다
      if (provider === 'claude') body.json_schema = schema;   // 지원하는 AI만. 나머지는 글 끝의 JSON을 읽는다
      else body.prompt += `\n\n답은 아래 JSON 스키마에 맞는 JSON 하나로만 써 주세요.\n${JSON.stringify(schema)}`;
    }
    if (d.kind === 'agent') body.agent = { cwd: cwd || x.path, mode: d.mode || 'read', ...(step.session ? { session: step.session } : {}) };
    if (web) body.agent = { cwd: x.path, mode: 'read', approvals: true, browser: web, ...(step.session ? { session: step.session } : {}) };
    return (await ai(conn, '/v1/jobs', { method: 'POST', body: JSON.stringify(body) })).job.id;
  }

  function patchSettings(p, x, patch){
    const c = readConf(), pc = plugConf(c, p, x.id), keys = new Set(x.manifest.settings.map(s => s.key));
    const toggles = new Set(x.manifest.settings.filter(s => s.type === 'toggle').map(s => s.key));
    for (const [k, v] of Object.entries(patch || {})){
      if (toggles.has(k)){ if (typeof v === 'boolean') pc.settings[k] = v; }   // 켜고 끄는 설정은 참·거짓으로만
      else if (keys.has(k) && typeof v === 'string') pc.settings[k] = v.slice(0, 20000);
    }
    writeConf(c);
  }

  /* ---------- 사람이 누른 것 ---------- */
  async function apply(p, x, st, a, conn){
    const conf = plugConf(readConf(), p, x.id);
    const run = a.run ? st.runs.find(r => r.id === a.run) : null;
    const step = run && a.step ? run.steps.find(s => s.key === a.step) : null;
    const handed = s => !!s && s.status === 'input' && !!s.ask && s.ask.type === 'handoff';   // 넘겨받기를 기다리는 단계 — 에이전트 작업이 답을 기다리며 살아 있다
    const cancelJob = async s => { if (s && s.job && (['running', 'waiting'].includes(s.status) || handed(s))) await ai(conn, `/v1/jobs/${s.job}`, { method: 'DELETE' }).catch(() => {}); };
    switch (a.type){
      case 'refresh': { const feed = x.feeds.find(f => f.name === a.feed); if (!feed) throw fail(404, '없는 목록이에요'); await refreshFeed(p, x, conf, feed, st, conn); return; }
      case 'start': {
        const feed = x.feeds.find(f => f.name === a.feed), it = feed && ((st.feeds[feed.name] || {}).items || []).find(i => i.id === a.item);
        if (!it) throw fail(404, '목록에 없는 항목이에요. 목록을 새로 가져와 주세요');
        const wname = a.workflow || feed.start;
        if (!feed.starts.includes(wname)) throw fail(400, `이 목록에서 시작할 수 없는 워크플로우예요: ${wname}`);
        if (a.fork){   // 같은 항목을 다른 갈래로 하나 더 — 갈래가 겹치는지는 그 단계가 끝날 때 본다
          if (!x.workflows.find(w => w.name === wname)?.steps.some(s => s.key === a.fork.step)) throw fail(400, '없는 단계예요');
          newRun(st, x, feed, it, 'button', wname, null, { step: a.fork.step, value: a.fork.value }); return;
        }
        const prev = st.runs.find(r => r.feed === feed.name && r.item.id === it.id && r.workflow === wname && !['done', 'canceled'].includes(r.status));
        // 항목이 바뀌었으면(새 커밋 등) 사람을 기다리던 이전 실행은 그만두고 새로 — 하는 중인 것은 끝날 때까지 둔다
        if (prev && (prev.item.version == null || prev.item.version === it.version || ['running', 'waiting'].includes(prev.status))) throw fail(409, '이미 진행 중이에요');
        if (prev){ for (const s of prev.steps) await cancelJob(s); Object.assign(prev, { status: 'canceled', note: '항목이 바뀌어서 새로 시작했어요', updated: now() }); slim(prev); }
        newRun(st, x, feed, it, 'button', wname, a.answer); return;
      }
      case 'answer': case 'confirm': {
        if (!step || step.status !== 'input') throw fail(409, '이미 답했거나 기다리는 단계가 아니에요');
        if (handed(step)){   // 넘겨받은 일을 마쳤다·못 했다 — 같은 작업에 답해 이어 가게 한다(단계를 다시 돌리지 않는다)
          const ok = a.type === 'confirm' || a.value === 'done';
          try { await ai(conn, `/v1/jobs/${step.job}/answer`, { method: 'POST', body: JSON.stringify({ request_id: step.ask.request_id, allow: ok, message: ok ? '' : '사용자가 브라우저에서 하지 못했다고 했어요' }) }); }
          catch (e) {
            if (e.status === 404){ Object.assign(step, { status: 'failed', ask: null, error: LOST, finished: now() }); Object.assign(run, { status: 'stopped', updated: now() }); return; }
            if (e.status !== 409) throw e;   // 409: 그 사이 작업이 다시 시작됐거나 끝났다 — 다음 차례에 작업 상태대로
          }
          Object.assign(step, { status: 'running', answered: [...(step.answered || []), step.ask.request_id].slice(-20), ask: null });
          Object.assign(run, { status: 'running', updated: now() }); return;
        }
        if (a.type === 'confirm' && step.ask && step.ask.type === 'gate') Object.assign(step, { status: 'pending', gate_ok: true, ask: null });   // 관문: 확인하면 그 단계를 한다
        else if (a.type === 'confirm') Object.assign(step, { status: 'done', finished: now(), ask: null });
        else { const v = String(a.value ?? '').slice(0, 2000), ch = ((step.ask && step.ask.choices) || []).find(c => c.value === v);   // 고른 것이면 사람이 본 이름도 남긴다
          Object.assign(step, { status: 'pending', answer: v, answer_label: ch ? ch.label : null, ask: null }); }
        Object.assign(run, { status: 'running', updated: now() }); return;
      }
      case 'retry': {
        if (!step) throw fail(409, '다시 할 수 있는 단계가 아니에요');
        if (['queued', 'running', 'waiting'].includes(run.status)) throw fail(409, '하는 중에는 다시 할 수 없어요. 그만두거나 끝난 뒤에 해 주세요');
        // 그만뒀거나 멈춘 실행은 어느 단계에서든 다시(처음부터 다시 등)
        if (!['failed', 'input', 'done'].includes(step.status) && !['canceled', 'stopped'].includes(run.status)) throw fail(409, '다시 할 수 있는 단계가 아니에요');
        const i = run.steps.indexOf(step);
        for (const s of run.steps.slice(i)) await cancelJob(s);
        // lenient: 못 채운 값은 빈 값으로 두고 이 단계를 한다(앞 단계 결과가 비었을 때 처음부터 다시 말고 이어 가는 길)
        for (const s of run.steps.slice(i)) Object.assign(s, { status: 'pending', job: null, error: null, ask: null, answered: undefined, output: s === step ? s.output : null, finished: null, when_skipped: undefined, lenient: s === step && a.lenient === true ? true : undefined, ...(s === step && a.value ? { answer: String(a.value).slice(0, 2000) } : {}) });
        Object.assign(run, { status: 'queued', note: null, finished: null, updated: now() }); return;
      }
      case 'skip': {
        if (!step || !['failed', 'input'].includes(step.status)) throw fail(409, '건너뛸 수 있는 단계가 아니에요');
        await cancelJob(step);
        Object.assign(step, { status: 'skipped', finished: now(), ask: null });
        Object.assign(run, { status: 'running', updated: now() }); return;
      }
      case 'cancel': {
        if (!run || ['done', 'canceled'].includes(run.status)) throw fail(409, '이미 끝난 실행이에요');
        for (const s of run.steps) await cancelJob(s);
        Object.assign(run, { status: 'canceled', note: '그만뒀어요', updated: now() }); slim(run); return;
      }
      case 'dismiss': { if (!run) throw fail(404, '없는 실행이에요'); st.runs = st.runs.filter(r => r !== run); return; }
      // 확인하고 닫기(피드 dismiss: yes) — 항목 버전째 기억해서, 버전이 바뀌면(새 답변 등) 다시 보인다
      case 'hide': case 'unhide': {
        const feed = x.feeds.find(f => f.name === a.feed);
        if (!feed || feed.dismiss !== 'yes') throw fail(400, '닫을 수 없는 목록이에요');
        const h = ((st.hidden ||= {})[feed.name] ||= {}), key = clip(a.item, 200);
        if (a.type === 'hide') h[key] = a.version == null ? '*' : clip(a.version, 100); else delete h[key];
        return;
      }
      default: throw fail(400, '모르는 동작이에요');
    }
  }

  /* 넘겨받기를 기다리는 단계 — 그 사이 작업이 사라졌으면(AI 서버 기록이 없어졌다) 멈춘 것으로 두어 다시 하게 하고,
     답할 것이 사라졌으면(AI 서버를 다시 켜 작업이 처음부터 다시 돈다·시간이 넘어 끝났다) 기다림을 풀어 다음 차례에 작업 상태대로 한다 */
  async function handoffs(st, conn){
    for (const run of st.runs){
      const step = run.status === 'input' && run.steps.find(s => s.status === 'input' && s.ask && s.ask.type === 'handoff' && s.job);
      if (!step) continue;
      let j;
      try { j = (await ai(conn, `/v1/jobs/${step.job}`)).job; }
      catch (e) { if (e.status === 404){ Object.assign(step, { status: 'failed', ask: null, error: LOST, finished: now() }); Object.assign(run, { status: 'stopped', updated: now() }); } continue; }
      if ((j.pending || []).some(q => q.id === step.ask.request_id)) continue;
      Object.assign(step, { status: 'running', ask: null }); Object.assign(run, { status: 'running', updated: now() });
    }
  }

  /* 다른 기기에서 누른 것 — 컴퓨터마다 따로 쓴 파일을 읽어 아직 안 한 것만 */
  function inboxActions(p, id){
    const dir = stateDir(p), out = [];
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []){
      const m = f.match(new RegExp(`^${id}\\.inbox\\.(.+)\\.json$`));
      if (m) for (const a of readJSON(path.join(dir, f), [])) out.push(a);
    }
    return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  /* ---------- 한 차례 ---------- */
  async function tick(only){
    const conf = readConf();
    for (const { name: p } of await listProfiles()){
      if (!profConf(conf, p).on || runnerHost(p) !== HOST || (only && only !== p)) continue;
      for (const x0 of await installed(p).catch(() => [])){
        const key = `${p}|${x0.id}`;
        if (busy.has(key)) continue;
        busy.add(key);
        try {
          const x = await pluginOf(p, x0.id), pc = plugConf(readConf(), p, x.id), st = readState(p, x.id), again = retry.get(key);
          retry.delete(key);
          for (const a of inboxActions(p, x.id)){
            if (st.applied.includes(a.id)) continue;
            st.applied = [...st.applied, a.id].slice(-500);
            try { await apply(p, x, st, a, conf.ai); } catch (e) { st.last_error = clip(`${a.type}: ${e.message}`, 300); }
          }
          for (const feed of x.feeds){
            const f = st.feeds[feed.name];
            const force = again === 'all' || (again && f && !f.ok);
            if (!force && (!inWindow(feed) || (f && f.at && Date.now() - Date.parse(f.at) < everyOf(pc, feed) * 60000))) continue;
            await refreshFeed(p, x, pc, feed, st, conf.ai);
          }
          await handoffs(st, conf.ai);
          await advance(p, x, pc, st, conf.ai);
          st.auto = !!pc.auto;   // 다른 기기도 돌리는 컴퓨터의 자동 시작 상태를 보게
          writeState(p, x.id, st);
        } catch (e) { console.error(`플러그인 실행기 ${p}/${x0.id}: ${e.message}`); }
        finally { busy.delete(key); }
      }
    }
  }
  let timer = null;
  function start(){ if (!timer){ timer = setInterval(() => tick().catch(e => console.error(`플러그인 실행기: ${e.message}`)), TICK); timer.unref(); } }

  /* ---------- API에서 부르는 것 ---------- */
  function here(p){
    const c = readConf(), pc = profConf(c, p);
    const host = runnerHost(p);
    return { host: HOST, on: !!pc.on && host === HOST, runner: host, runner_since: (readJSON(runnerFile(p), {}) || {}).since || null, ai: c.ai ? { url: c.ai.url, at: c.ai.at || null } : null };
  }
  async function status(p){
    const list = await installed(p).catch(() => []), c = readConf();
    const out = {};
    for (const x of list){
      const st = readState(p, x.id), pc = plugConf(c, p, x.id), full = await pluginOf(p, x.id);
      out[x.id] = { state: st, feeds: full.feeds.map(f => ({ ...f, every: everyOf(pc, f), every_default: f.every })), searches: full.searches.map(s => ({ name: s.name, description: s.description, limit: s.limit })), editors: full.editors, checkins: full.checkins, links: full.links, chats: (x.chats || []).map(c => ({ scope: c.scope, name: c.name, label: c.label })), workflows: full.workflows.map(w => ({ name: w.name, note: w.note || '', ok: w.ok || '', steps: w.steps.map(s => ({ key: s.key, name: s.name, kind: s.kind, ...(s.kind === 'ask' ? { placeholder: s.body } : {}) })) })),
        local: { settings: settingsFor(x, pc), auto: !!pc.auto, auto_since: pc.auto_since || null, every: pc.every || {}, gates: pc.gates || {} } };
    }
    return { here: here(p), plugins: out };
  }
  async function setRunner(p, { on, ai: conn }){
    const c = readConf();
    if (conn){
      if (!/^https?:\/\/[\w.:\-[\]]+$/.test(String(conn.url || '')) || !/^[\w.~-]{16,200}$/.test(String(conn.token || ''))) throw fail(400, 'AI 연결 주소나 접속 토큰 형식이 맞지 않아요');
      await ai({ url: conn.url, token: conn.token }, '/v1/plugins');   // 닿는지, 토큰이 맞는지
      c.ai = { url: conn.url, token: conn.token, at: now() };
    }
    if (on != null){
      if (on && !c.ai) throw fail(409, '이 컴퓨터의 AI 연결이 먼저 필요해요');
      const pc = profConf(c, p); pc.on = !!on; pc.since = on ? now() : null;
      fs.mkdirSync(stateDir(p), { recursive: true });
      if (on) fs.writeFileSync(runnerFile(p), JSON.stringify({ host: HOST, since: now() }, null, 1) + '\n');
      else if (runnerHost(p) === HOST) fs.rmSync(runnerFile(p), { force: true });
      onWrite(p);
    }
    writeConf(c); brMemo.clear();
    if (on) setTimeout(() => tick(p).catch(() => {}), 50);
    return here(p);
  }
  async function setLocal(p, id, { settings, auto, every, gates }){
    const x = await pluginOf(p, id), c = readConf(), pc = plugConf(c, p, id);
    if (every && typeof every === 'object'){   // { 목록 이름: 분 | null(기본으로) }
      for (const [name, v] of Object.entries(every)){
        if (!x.feeds.some(f => f.name === name)) throw fail(400, `없는 목록이에요: ${name}`);
        if (v == null){ if (pc.every) delete pc.every[name]; continue; }
        const n = Number(v);
        if (!Number.isInteger(n) || n < EVERY_MIN || n > EVERY_MAX) throw fail(400, `가져오는 주기는 ${EVERY_MIN}~${EVERY_MAX}분이에요`);
        (pc.every ||= {})[name] = n;
      }
    }
    if (gates && typeof gates === 'object'){   // { "워크플로우|단계키": true | false }
      for (const [k, v] of Object.entries(gates)){
        const [w, s] = k.split('|'), wf = x.workflows.find(z => z.name === w), st = wf && wf.steps.find(z => z.key === s);
        if (!st) throw fail(400, `없는 단계예요: ${k}`);
        if (st.kind === 'manual') continue;   // 사람이 하는 단계는 원래 내 차례
        if (v) (pc.gates ||= {})[k] = true; else if (pc.gates) delete pc.gates[k];
      }
    }
    if (settings && typeof settings === 'object'){
      for (const s of x.manifest.settings) if (s.key in settings){
        const v = settings[s.key];
        pc.settings[s.key] = s.type === 'toggle' ? v === true : String(v ?? '').slice(0, 20000);
      }
    }
    if (auto != null){ pc.auto = !!auto; pc.auto_since = auto ? (pc.auto_since && pc.auto ? pc.auto_since : now()) : null; }
    writeConf(c);
    if (auto != null && mine(p)){ const st = readState(p, id); st.auto = !!auto; writeState(p, id, st); }
    if (settings && typeof settings === 'object') kick(p, id, 'all');   // 주소·토픽이 바뀌면 목록도 새로
    return { settings: settingsFor(x, pc), auto: !!pc.auto, auto_since: pc.auto_since, every: pc.every || {}, gates: pc.gates || {} };
  }
  // 누른 것 — 켠 컴퓨터면 바로, 아니면 이 컴퓨터 이름의 받은편지함에 남겨 동기화로 보낸다
  async function act(p, id, a){
    const x = await pluginOf(p, id), action = { ...a, id: 'a' + crypto.randomBytes(6).toString('hex'), at: now(), from: HOST };
    const c = readConf();
    if (mine(p)){
      const key = `${p}|${id}`;
      for (let i = 0; busy.has(key) && i < 100; i++) await new Promise(r => setTimeout(r, 100));
      busy.add(key);
      try {
        const st = readState(p, id);
        await apply(p, x, st, action, c.ai);
        if (a.type !== 'refresh'){
          // 스크립트 단계는 금방 끝난다 — 다음 차례(10초)를 기다리지 않고 잠깐씩 이어서 본다(사람이 누른 직후 바로 다음 물음·결과가 보이게)
          for (let i = 0; i < 6; i++){
            await advance(p, x, plugConf(c, p, id), st, c.ai).catch(() => {});
            const r = st.runs.find(r => ['running', 'queued'].includes(r.status)), s = r && r.steps.find(s => s.status === 'running');
            if (!r || (s && s.kind !== 'script')) break;
            await new Promise(res => setTimeout(res, 500));
          }
        }
        writeState(p, id, st);
        return { applied: true, state: st };
      } finally { busy.delete(key); }
    }
    const f = path.join(stateDir(p), `${id}.inbox.${hostSlug(HOST)}.json`);
    fs.mkdirSync(stateDir(p), { recursive: true });
    const list = readJSON(f, []).filter(z => Date.now() - Date.parse(z.at) < 7 * 86400000);
    fs.writeFileSync(f, JSON.stringify([...list, action], null, 1) + '\n');
    onWrite(p);
    return { applied: false, queued: action.id };
  }
  /* 검색 — 찾기 화면에서 누를 때. 이 컴퓨터의 pkm-ai-server로 한 번 돌리고 60초까지 기다린다(돌리는 컴퓨터가 아니어도 된다) */
  async function search(p, id, name, q){
    const x = await pluginOf(p, id), s = x.searches.find(s => s.name === name);
    if (!s) throw fail(404, '그런 검색이 없어요');
    q = String(q || '').trim().slice(0, 300); if (!q) throw fail(400, '찾을 말을 적어 주세요');
    const conn = readConf().ai, settings = settingsFor(x, plugConf(readConf(), p, id)), missing = [];
    const args = tokens(s.run).map(a => fill(a, { item: { id: '', title: '', vars: { q } }, steps: [] }, settings, missing));
    if (missing.length) throw fail(400, `플러그인 설정이 비어 있어요: ${missing.join(' ')}`);
    let job = await scriptJob(conn, x, args[0], args.slice(1));
    const until = Date.now() + 60000;
    while (!['done', 'error', 'canceled'].includes(job.status) && Date.now() < until){
      await new Promise(r => setTimeout(r, 700));
      job = (await ai(conn, `/v1/jobs/${job.id}`)).job;
    }
    if (job.status !== 'done'){
      if (!['error', 'canceled'].includes(job.status)) await ai(conn, `/v1/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {});
      throw fail(502, job.status === 'error' ? jobError(job) : job.status === 'waiting' ? '이 컴퓨터에서 플러그인을 승인해야 찾을 수 있어요' : '60초 안에 끝나지 않았어요');
    }
    const out = parseOut(job.result.stdout);
    if (out && out.error) throw fail(502, clip(out.error, 500));
    if (!out || !Array.isArray(out.items)) throw fail(502, '검색 결과에 items 목록이 없어요');
    return { items: out.items.map(normItem).filter(Boolean).slice(0, s.limit), note: out.note ? clip(out.note, 200) : null };
  }

  /* 승인·비밀값 — 이 컴퓨터의 pkm-ai-server로 보낸다 */
  async function approve(p, id){
    const x = await pluginOf(p, id), conn = readConf().ai;
    const files = Object.fromEntries(x.scripts.map(s => [s.path, s.sha256]));
    const r = (await ai(conn, '/v1/plugins', { method: 'POST', body: JSON.stringify({ id: x.id, root: x.path, version: x.manifest.version, permissions: x.manifest.permissions, files }) })).plugin;
    kick(p, id, 'failed');   // 승인 전에 실패한 목록을 바로 다시 가져온다
    brMemo.delete(`${p}|${id}`);
    return r;
  }
  async function machine(p, id){
    const x = await pluginOf(p, id), conn = readConf().ai;
    if (!conn) return { connected: false, approved: false, secrets: [] };
    try {
      const [ap, sec] = await Promise.all([ai(conn, '/v1/plugins'), ai(conn, '/v1/secrets').catch(() => ({ secrets: [] }))]);
      const mine = ap.plugins.find(a => a.id === x.id && a.root === x.path);
      const same = !!mine && x.scripts.every(s => mine.files[s.path] === s.sha256) && x.manifest.permissions.secrets.every(n => (mine.permissions.secrets || []).includes(n)) && (x.manifest.permissions.plain || []).every(n => (mine.permissions.plain || []).includes(n))
        && (!x.manifest.permissions.browser || mine.permissions.browser === true);   // 브라우저를 새로 쓰게 됐으면 다시 승인
      return { connected: true, approved: same, approved_before: !!mine && !same, browser_new: !!mine && x.manifest.permissions.browser && mine.permissions.browser !== true, secrets: x.manifest.secrets.map(s => ({ ...s, set_at: (sec.secrets.find(z => z.name === s.name) || {}).set_at || null })) };
    } catch (e) { return { connected: false, error: e.message, approved: false, secrets: [] }; }
  }
  async function setSecret(p, id, name, value){
    const x = await pluginOf(p, id);
    if (!x.manifest.permissions.secrets.includes(name)) throw fail(400, '이 플러그인이 쓰지 않는 비밀값이에요');
    const conn = readConf().ai;
    if (value == null) return ai(conn, `/v1/secrets?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    const r = await ai(conn, '/v1/secrets', { method: 'POST', body: JSON.stringify({ name, value }) });
    kick(p, id, 'failed');
    return r;
  }

  /* ---------- 브라우저 — 플러그인의 탭을 사람이 보고 누르고 적는다(작업 화면의 브라우저 보기·미리 로그인). 적은 글은 AI에게 가지 않는다 ---------- */
  // 쓸 수 있나 — 플러그인 선언 · 이 컴퓨터가 돌리는지 · pkm-ai-server 지원 · 이 컴퓨터의 승인(채팅의 browserState와 같은 판단). 화면이 1초에도 여러 번 물어 10초 기억한다
  const brMemo = new Map();
  async function browserState(p, id){
    const k = `${p}|${id}`, hit = brMemo.get(k);
    if (hit && Date.now() - hit.at < 10000) return hit.v;
    const x = await pluginOf(p, id), host = runnerHost(p), conn = readConf().ai;
    let v = { ok: true };
    if (!x.manifest.permissions.browser) v = { ok: false, reason: 'off', message: '이 플러그인은 브라우저를 쓰지 않아요' };
    else if (host && host !== HOST && (x.feeds.length || x.workflows.length)) v = { ok: false, reason: 'elsewhere', message: `브라우저는 돌리는 컴퓨터(${host})에 있어요. 그 컴퓨터에서 pkm을 열어 주세요` };
    else if (!conn) v = { ok: false, reason: 'none', message: '이 컴퓨터의 AI 연결이 없어요. 준비와 설정에서 먼저 연결해 주세요' };
    else try {
      const claude = ((await ai(conn, '/v1/providers')).providers || []).find(z => z.id === 'claude');
      if (!claude || !claude.agent || !claude.agent.browser) v = { ok: false, reason: 'old', message: 'pkm-ai-server가 브라우저를 모르는 옛 버전이거나 브라우저를 꺼 두었어요. 업데이트한 뒤 다시 켜 주세요' };
      else {
        const ap = ((await ai(conn, '/v1/plugins')).plugins || []).find(a => a.id === x.id && a.root === x.path);
        if (!ap || !ap.permissions || ap.permissions.browser !== true) v = { ok: false, reason: 'approve', message: `브라우저를 쓰려면 플러그인 › ${x.manifest.name} › 준비와 설정에서 다시 승인해 주세요` };
      }
    } catch (e) { return { ok: false, reason: 'local', message: e.message }; }   // 못 읽은 것은 기억하지 않는다
    brMemo.set(k, { at: Date.now(), v });
    return v;
  }
  // tab은 이 플러그인의 탭 키만(다른 플러그인·채팅 방의 탭을 건드리지 못하게 앞부분을 본다). tab 없이 물으면 상태와 로그인 탭 키만 돌려준다
  async function browser(p, id, act, tab, b = {}){
    const st = await browserState(p, id), login = tabKey(p, id, 'login');
    if (act === 'info' && !tab) return { ok: st.ok, reason: st.reason, message: st.message || '', login };
    if (!TAB_RE.test(String(tab || '')) || !String(tab).startsWith(`${tabSeg(p)}|${id}|`)) throw fail(400, '이 플러그인의 브라우저 탭이 아니에요');
    if (!st.ok){ if (act === 'info') return { ok: false, reason: st.reason, message: st.message, login, info: null }; throw fail(409, st.message); }
    const conn = readConf().ai, base = `/v1/browser/tabs/${encodeURIComponent(tab)}`, long = { signal: AbortSignal.timeout(45000) };
    if (act === 'info') return { ok: true, login, info: await ai(conn, base) };
    if (act === 'open') return ai(conn, `${base}/open`, { method: 'POST', body: JSON.stringify(b.url ? { url: String(b.url).slice(0, 2000) } : {}), ...long });
    if (act === 'input'){ const { tab: _t, ...input } = b; return ai(conn, `${base}/input`, { method: 'POST', body: JSON.stringify(input), ...long }); }
    if (act === 'frame') return Buffer.from(await (await ai(conn, `${base}/frame?q=${Math.min(80, Math.max(30, +b.q || 55))}`, { raw: true })).arrayBuffer());
    throw fail(404, '없는 주소예요');
  }

  return { tick, start, status, setRunner, setLocal, act, approve, machine, setSecret, here, search, browser };
}
