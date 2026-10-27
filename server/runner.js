// 플러그인 실행기 — "이 컴퓨터에서 돌리기"를 켠 프로필의 플러그인 피드를 주기적으로 가져오고, 워크플로우를 단계별로 돌린다.
// 실제 실행(스크립트·AI·에이전트)은 이 컴퓨터의 pkm-ai-server가 맡는다. 여기는 순서와 상태만 다룬다.
//
// 이 컴퓨터에만 있는 것(동기화하지 않음): ~/.pkm-app/runner.json — AI 연결(주소·접속 토큰), 켠 프로필, 플러그인 설정값
// 프로필 데이터(동기화됨):  <프로필>/_플러그인/.state/<id>.json        — 피드 목록과 실행 기록. 켠 컴퓨터만 쓴다
//                           <프로필>/_플러그인/.state/<id>.inbox.<컴퓨터>.json — 다른 기기에서 누른 것(답하기·다시 하기…). 켠 컴퓨터가 읽어서 처리한다
// 비밀값(토큰)은 어느 쪽에도 두지 않는다 — pkm-ai-server에만 있고, 승인한 플러그인 스크립트의 환경 변수로만 간다.
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

/* ---------- pkm-ai-server 호출 ---------- */
async function ai(conn, pathname, opt = {}){
  if (!conn || !conn.url || !conn.token) throw fail(409, '이 컴퓨터의 AI 연결이 없어요');
  let r;
  try { r = await fetch(conn.url + pathname, { ...opt, headers: { authorization: `Bearer ${conn.token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000) }); }
  catch { throw fail(502, `AI 서버(${conn.url})에 닿지 않아요. 이 컴퓨터에서 pkm-ai-server가 켜져 있는지 확인해 주세요`); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(r.status === 401 ? 409 : r.status, body.error || `AI 서버 오류 ${r.status}`);
  return body;
}

/* ---------- 상태 파일 ---------- */
export function createRunner({ DATA, listProfiles, onWrite = () => {} }){
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
    const workflows = Object.values(wf).flatMap(t => P.parseWorkflows(t));
    const feeds = Object.values(files).flatMap(t => P.parseFeeds(t)).map(d => ({ ...d, every: Number(String(d.every || 60).replace(/분$/, '')) || 60, days: d.days || 'daily', start_mode: d.start ? d.start_mode || 'button' : null }));
    return { ...x, feeds, workflows };
  }
  function settingsFor(x, conf){
    const v = conf.settings || {};
    return Object.fromEntries(x.manifest.settings.map(s => [s.key, v[s.key] ?? s.default]));
  }

  /* ---------- 자리 채우기: {title} {키.필드} {설정키} ---------- */
  // 채우지 못한 자리는 misses에 모은다(설정값 안의 {key}처럼 채운 값 속 중괄호는 스크립트 몫이라 다시 보지 않는다)
  function fill(text, run, settings, misses = []){
    const vars = { id: run.item.id, title: run.item.title, url: run.item.url || '', ...run.item.vars, ...settings };
    return String(text).replace(/\{([^{}\s]+)\}/g, (m, k) => {
      let v;
      if (k.includes('.')){
        const [step, ...rest] = k.split('.'), s = run.steps.find(x => x.key === step);
        v = s && s.output; for (const r of rest) v = v == null ? undefined : v[r];
      } else v = vars[k];
      if (v == null){ misses.push(m); return m; }
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
      detail: (Array.isArray(it.detail) ? it.detail : []).slice(0, 8).map(d => ({ who: clip(d.who, 60), at: d.at ? String(d.at) : null, text: clip(d.text, 400), url: /^https?:\/\//.test(String(d.url || '')) ? String(d.url) : '', kind: d.kind ? clip(d.kind, 30) : '' })),
      vars: Object.fromEntries(Object.entries(it.vars && typeof it.vars === 'object' ? it.vars : {}).slice(0, 20).map(([k, v]) => [clip(k, 40), clip(v, 6000)]))
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
    } catch (e) {
      Object.assign(f, { at: now(), ok: false, error: clip(e.message, 500) });
    } finally { f.running = false; }
    // 새로 들어온 항목 — 자동 시작을 켠 뒤에 처음 본 것만 자동으로
    const pc = conf;
    if (f.ok && feed.start){
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

  function newRun(st, x, feed, item, by){
    const w = x.workflows.find(w => w.name === feed.start);
    if (!w) throw fail(400, `워크플로우 "${feed.start}"가 없어요`);
    const run = { id: 'r' + crypto.randomBytes(5).toString('hex'), feed: feed.name, workflow: w.name, by, item: { id: item.id, title: item.title, url: item.url, vars: item.vars || {} },
      status: 'queued', created: now(), updated: now(), steps: w.steps.map(s => ({ key: s.key, name: s.name, kind: s.kind, mode: s.mode, status: 'pending' })) };
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
    const settings = settingsFor(x, conf), def = x.workflows.find(w => w.name === run.workflow);
    if (!def){ Object.assign(run, { status: 'stopped', note: `워크플로우 "${run.workflow}"가 플러그인에서 사라졌어요`, updated: now() }); return; }
    for (const step of run.steps){
      if (['done', 'skipped'].includes(step.status)) continue;
      const d = def.steps.find(s => s.key === step.key) || {};
      if (step.status === 'input') return;   // 사람 답을 기다린다
      if (step.status === 'failed'){ run.status = 'stopped'; return; }
      if (step.status === 'pending'){
        if (d.kind === 'manual'){ Object.assign(step, { status: 'input', ask: { type: 'confirm' }, started: now() }); run.status = 'input'; run.updated = now(); return; }
        try { step.job = await startStep(conn, x, run, step, d, settings); Object.assign(step, { status: 'running', started: now(), error: null }); }
        catch (e) { Object.assign(step, { status: 'failed', error: clip(e.message, 500), finished: now() }); Object.assign(run, { status: 'stopped', updated: now() }); return; }
        run.status = 'running'; run.updated = now();
        return;   // 다음 차례에 결과를 본다
      }
      if (['running', 'waiting'].includes(step.status)){
        let j;
        try { j = (await ai(conn, `/v1/jobs/${step.job}`)).job; }
        catch (e) { step.note = clip(e.message, 300); return; }
        if (j.status === 'waiting'){ Object.assign(step, { status: 'waiting', reason: j.reason, until: j.until || null }); Object.assign(run, { status: 'waiting', updated: now() }); return; }
        if (!['done', 'error', 'canceled'].includes(j.status)){ if (step.status !== 'running'){ step.status = 'running'; run.status = 'running'; run.updated = now(); } return; }
        if (j.status !== 'done'){ Object.assign(step, { status: 'failed', error: j.status === 'canceled' ? '취소됐어요' : jobError(j), text: clip(j.result && (j.result.stdout || j.result.text), 4000), finished: now() }); Object.assign(run, { status: 'stopped', updated: now() }); return; }
        const out = d.kind === 'script' ? parseOut(j.result.stdout) : (j.result.structured || parseOut(j.result.text));
        const text = clip(d.kind === 'script' ? (out ? out.summary || '' : j.result.stdout) : j.result.text, 6000);
        if (out && out.error){ Object.assign(step, { status: 'failed', error: clip(out.error, 500), output: out, text, finished: now() }); Object.assign(run, { status: 'stopped', updated: now() }); return; }
        if (out && out.ask){ Object.assign(step, { status: 'input', ask: normAsk(out.ask), output: out, text, job: null }); Object.assign(run, { status: 'input', updated: now() }); return; }
        if (out && out.settings_patch) patchSettings(p, x, out.settings_patch);
        Object.assign(step, { status: 'done', output: out, text, finished: now(), session: j.result.session || undefined, until: null, reason: null });
        run.updated = now();
        continue;
      }
    }
    Object.assign(run, { status: 'done', finished: now(), updated: now() });
  }
  const normAsk = a => ({ type: 'choice', question: clip(a.question || '골라 주세요', 200), hint: a.hint ? clip(a.hint, 300) : '',
    choices: (Array.isArray(a.choices) ? a.choices : []).slice(0, 20).map(c => typeof c === 'string' ? { value: c, label: c } : { value: clip(c.value, 500), label: clip(c.label || c.value, 120), hint: c.hint ? clip(c.hint, 120) : '', recommended: c.recommended === true }),
    free: a.free === true, placeholder: a.placeholder ? clip(a.placeholder, 80) : '' });

  async function startStep(conn, x, run, step, d, settings){
    const miss = [], cwd = d.cwd ? fill(d.cwd, run, settings, miss) : null;
    if (cwd && (miss.length || !path.isAbsolute(cwd) || !fs.existsSync(cwd))) throw fail(400, `작업 폴더를 찾지 못했어요: ${cwd}`);
    if (d.kind === 'script'){
      const args = tokens(d.body).map(a => fill(a, run, settings, miss));
      if (step.answer != null) args.push(`--answer=${step.answer}`);
      if (miss.length) throw fail(400, `채우지 못한 값이 있어요: ${miss.join(' ')}`);
      return (await scriptJob(conn, x, args[0], args.slice(1), cwd)).id;
    }
    let prompt = d.body;
    if (/^prompts\/[^\s]+\.md$/.test(prompt)) prompt = fs.readFileSync(path.join(x.path, prompt), 'utf8');
    prompt = fill(prompt, run, settings);
    if (step.answer != null) prompt += `\n\n사용자 추가 요청: ${step.answer}`;
    const body = { plugin: { id: x.id, root: x.path }, provider: settings.provider || 'claude', prompt, tag: `plugin:${x.id}` };
    if (d.kind === 'agent') body.agent = { cwd: cwd || x.path, mode: d.mode || 'read', ...(step.session ? { session: step.session } : {}) };
    return (await ai(conn, '/v1/jobs', { method: 'POST', body: JSON.stringify(body) })).job.id;
  }

  function patchSettings(p, x, patch){
    const c = readConf(), pc = plugConf(c, p, x.id), keys = new Set(x.manifest.settings.map(s => s.key));
    for (const [k, v] of Object.entries(patch || {})) if (keys.has(k) && typeof v === 'string') pc.settings[k] = v.slice(0, 20000);
    writeConf(c);
  }

  /* ---------- 사람이 누른 것 ---------- */
  async function apply(p, x, st, a, conn){
    const conf = plugConf(readConf(), p, x.id);
    const run = a.run ? st.runs.find(r => r.id === a.run) : null;
    const step = run && a.step ? run.steps.find(s => s.key === a.step) : null;
    const cancelJob = async s => { if (s && s.job && ['running', 'waiting'].includes(s.status)) await ai(conn, `/v1/jobs/${s.job}`, { method: 'DELETE' }).catch(() => {}); };
    switch (a.type){
      case 'refresh': { const feed = x.feeds.find(f => f.name === a.feed); if (!feed) throw fail(404, '없는 목록이에요'); await refreshFeed(p, x, conf, feed, st, conn); return; }
      case 'start': {
        const feed = x.feeds.find(f => f.name === a.feed), it = feed && ((st.feeds[feed.name] || {}).items || []).find(i => i.id === a.item);
        if (!it) throw fail(404, '목록에 없는 항목이에요. 목록을 새로 가져와 주세요');
        if (st.runs.some(r => r.feed === feed.name && r.item.id === it.id && !['done', 'canceled'].includes(r.status))) throw fail(409, '이미 진행 중이에요');
        newRun(st, x, feed, it, 'button'); return;
      }
      case 'answer': case 'confirm': {
        if (!step || step.status !== 'input') throw fail(409, '이미 답했거나 기다리는 단계가 아니에요');
        if (a.type === 'confirm') Object.assign(step, { status: 'done', finished: now(), ask: null });
        else Object.assign(step, { status: 'pending', answer: String(a.value ?? '').slice(0, 2000), ask: null });
        Object.assign(run, { status: 'running', updated: now() }); return;
      }
      case 'retry': {
        if (!step || !['failed', 'input', 'done'].includes(step.status)) throw fail(409, '다시 할 수 있는 단계가 아니에요');
        const i = run.steps.indexOf(step);
        for (const s of run.steps.slice(i)) Object.assign(s, { status: 'pending', job: null, error: null, ask: null, output: s === step ? s.output : null, finished: null, ...(s === step && a.value ? { answer: String(a.value).slice(0, 2000) } : {}) });
        Object.assign(run, { status: 'queued', updated: now() }); return;
      }
      case 'skip': {
        if (!step || !['failed', 'input'].includes(step.status)) throw fail(409, '건너뛸 수 있는 단계가 아니에요');
        Object.assign(step, { status: 'skipped', finished: now(), ask: null });
        Object.assign(run, { status: 'running', updated: now() }); return;
      }
      case 'cancel': {
        if (!run || ['done', 'canceled'].includes(run.status)) throw fail(409, '이미 끝난 실행이에요');
        for (const s of run.steps) await cancelJob(s);
        Object.assign(run, { status: 'canceled', note: '그만뒀어요', updated: now() }); return;
      }
      case 'dismiss': { if (!run) throw fail(404, '없는 실행이에요'); st.runs = st.runs.filter(r => r !== run); return; }
      default: throw fail(400, '모르는 동작이에요');
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
          const x = await pluginOf(p, x0.id), pc = plugConf(readConf(), p, x.id), st = readState(p, x.id);
          for (const a of inboxActions(p, x.id)){
            if (st.applied.includes(a.id)) continue;
            st.applied = [...st.applied, a.id].slice(-500);
            try { await apply(p, x, st, a, conf.ai); } catch (e) { st.last_error = clip(`${a.type}: ${e.message}`, 300); }
          }
          for (const feed of x.feeds){
            const f = st.feeds[feed.name];
            if (!inWindow(feed) || (f && f.at && Date.now() - Date.parse(f.at) < feed.every * 60000)) continue;
            await refreshFeed(p, x, pc, feed, st, conf.ai);
          }
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
      out[x.id] = { state: st, feeds: full.feeds, workflows: full.workflows.map(w => ({ name: w.name, steps: w.steps.map(s => ({ key: s.key, name: s.name, kind: s.kind })) })),
        local: { settings: settingsFor(x, pc), auto: !!pc.auto, auto_since: pc.auto_since || null } };
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
    writeConf(c);
    if (on) setTimeout(() => tick(p).catch(() => {}), 50);
    return here(p);
  }
  async function setLocal(p, id, { settings, auto }){
    const x = await pluginOf(p, id), c = readConf(), pc = plugConf(c, p, id);
    if (settings && typeof settings === 'object'){
      for (const s of x.manifest.settings) if (s.key in settings){
        const v = settings[s.key];
        pc.settings[s.key] = s.type === 'toggle' ? v === true : String(v ?? '').slice(0, 20000);
      }
    }
    if (auto != null){ pc.auto = !!auto; pc.auto_since = auto ? (pc.auto_since && pc.auto ? pc.auto_since : now()) : null; }
    writeConf(c);
    if (auto != null && mine(p)){ const st = readState(p, id); st.auto = !!auto; writeState(p, id, st); }
    return { settings: settingsFor(x, pc), auto: !!pc.auto, auto_since: pc.auto_since };
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
        if (a.type !== 'refresh') await advance(p, x, plugConf(c, p, id), st, c.ai).catch(() => {});
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
  /* 승인·비밀값 — 이 컴퓨터의 pkm-ai-server로 보낸다 */
  async function approve(p, id){
    const x = await pluginOf(p, id), conn = readConf().ai;
    const files = Object.fromEntries(x.scripts.map(s => [s.path, s.sha256]));
    return (await ai(conn, '/v1/plugins', { method: 'POST', body: JSON.stringify({ id: x.id, root: x.path, version: x.manifest.version, permissions: x.manifest.permissions, files }) })).plugin;
  }
  async function machine(p, id){
    const x = await pluginOf(p, id), conn = readConf().ai;
    if (!conn) return { connected: false, approved: false, secrets: [] };
    try {
      const [ap, sec] = await Promise.all([ai(conn, '/v1/plugins'), ai(conn, '/v1/secrets').catch(() => ({ secrets: [] }))]);
      const mine = ap.plugins.find(a => a.id === x.id && a.root === x.path);
      const same = !!mine && x.scripts.every(s => mine.files[s.path] === s.sha256) && x.manifest.permissions.secrets.every(n => (mine.permissions.secrets || []).includes(n));
      return { connected: true, approved: same, approved_before: !!mine && !same, secrets: x.manifest.secrets.map(s => ({ ...s, set_at: (sec.secrets.find(z => z.name === s.name) || {}).set_at || null })) };
    } catch (e) { return { connected: false, error: e.message, approved: false, secrets: [] }; }
  }
  async function setSecret(p, id, name, value){
    const x = await pluginOf(p, id);
    if (!x.manifest.permissions.secrets.includes(name)) throw fail(400, '이 플러그인이 쓰지 않는 비밀값이에요');
    const conn = readConf().ai;
    if (value == null) return ai(conn, `/v1/secrets?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
    return ai(conn, '/v1/secrets', { method: 'POST', body: JSON.stringify({ name, value }) });
  }

  return { tick, start, status, setRunner, setLocal, act, approve, machine, setSecret, here };
}
