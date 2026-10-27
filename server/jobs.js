// AI 예약 작업 — 프로필 설정(_설정.md의 ai_jobs)에 적은 일을 정한 때마다 pkm-ai-server에 맡기고, 결과를 인박스에 남긴다.
// 돌리는 컴퓨터(플러그인과 같은 '이 컴퓨터에서 돌리기')만 돌린다. 마지막으로 돈 때·결과는 이 컴퓨터의 ~/.pkm-app/jobs.json에만 둔다.
// 모드: chat = 도구 없는 AI 한 번 · read = 프로필 폴더를 읽기만 하는 에이전트 · auto = 프로필 폴더의 노트를 고칠 수 있는 에이전트
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readConf } from './runner.js';

const MD = createRequire(import.meta.url)('../web/js/pkm-md.js');
const HOME = process.env.PKM_HOME ? path.resolve(process.env.PKM_HOME) : path.join(os.homedir(), '.pkm-app');
const STATE = path.join(HOME, 'jobs.json');
const MODES = ['chat', 'read', 'auto'];
const fail = (status, message) => Object.assign(new Error(message), { status });
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ---------- 언제 — 앱과 같은 cron 부분집합(분 시 일 * 요일). 요일 'nL'은 그 달 마지막 n요일 ---------- */
function field(spec, v, lo, hi){
  return String(spec).split(',').some(part => {
    const [range, step] = part.split('/'), st = step ? +step : 1;
    const [a, b] = range === '*' ? [lo, hi] : range.includes('-') ? range.split('-').map(Number) : [+range, step ? hi : +range];
    return v >= a && v <= b && (v - a) % st === 0;
  });
}
export function due(cron, d, offdays = []){
  const f = String(cron || '').trim().split(/\s+/); if (f.length !== 5) return false;
  const [mi, h, dom, , dow] = f, day = d.getDay(), date = d.getDate();
  if (!field(mi, d.getMinutes(), 0, 59) || !field(h, d.getHours(), 0, 23)) return false;
  if (dom !== '*' && !field(dom, date, 1, 31)) return false;
  if (dow === '*') return true;
  if (!/[06]/.test(dow) && offdays.some(o => o.date === ymd(d))) return false;   // 쉬는 날엔 평일 일을 쉰다(앱과 같은 규칙)
  if (/^\dL$/.test(dow)) return day === +dow[0] && date + 7 > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return field(dow, day, 0, 6);
}

/* ---------- 설정에서 읽기 ---------- */
export function jobsOf(settingsFm){
  return (Array.isArray(settingsFm.ai_jobs) ? settingsFm.ai_jobs : []).filter(j => j && typeof j === 'object' && j.id && j.prompt)
    .map(j => ({ id:String(j.id), name:String(j.name || j.id), prompt:String(j.prompt), cron:String(j.cron || ''), mode:MODES.includes(j.mode) ? j.mode : 'chat', provider:String(j.provider || 'claude'), on:j.on !== false }));
}

export function createJobs({ DATA, listProfiles, settingsOf, here, onWrite = () => {} }){
  const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
  const writeState = s => { fs.mkdirSync(HOME, { recursive:true, mode:0o700 }); const t = `${STATE}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(s, null, 1) + '\n', { mode:0o600 }); fs.renameSync(t, STATE); };
  const key = (p, id) => `${p}|${id}`;

  async function ai(pathname, opt = {}){
    const conn = readConf().ai;
    if (!conn || !conn.url || !conn.token) throw fail(409, '이 컴퓨터의 AI 연결이 없어요');
    let r;
    try { r = await fetch(conn.url + pathname, { ...opt, headers:{ authorization:`Bearer ${conn.token}`, 'content-type':'application/json' }, signal:AbortSignal.timeout(15000) }); }
    catch { throw fail(502, `AI 서버(${conn.url})에 닿지 않아요`); }
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw fail(r.status === 401 ? 409 : r.status, b.error || `AI 서버 오류 ${r.status}`);
    return b;
  }

  async function start(p, job, why){
    const dir = path.join(DATA, p), today = ymd(new Date());
    const prompt = `${job.prompt}\n\n(오늘은 ${today}이에요.${job.mode === 'chat' ? '' : ` 지금 폴더는 개인 지식관리 앱의 '${p}' 프로필이에요 — 01_지식(노트), 02_시간(데일리·기록), 03_행동(단기·장기·루틴·약속)이 마크다운으로 있어요.${job.mode === 'read' ? ' 파일을 고치지 말고 읽기만 해요.' : ' 파일을 고쳤다면 답 끝에 고친 파일 경로를 목록으로 적어요.'}`} 답은 한국어로, 사람이 바로 읽을 수 있게 짧게.)`;
    const body = { provider:job.provider, prompt, tag:`pkm-job:${job.id}`, ...(job.mode === 'chat' ? {} : { agent:{ cwd:dir, mode:job.mode } }) };
    const st = readState(), k = key(p, job.id), prev = st[k] || {};
    try {
      const r = await ai('/v1/jobs', { method:'POST', body:JSON.stringify(body) });
      st[k] = { ...prev, job:r.job.id, status:'running', started:new Date().toISOString(), why, error:null };
    } catch (e) { st[k] = { ...prev, status:'error', error:e.message, started:new Date().toISOString(), why }; }
    writeState(st);
    return st[k];
  }

  // 끝난 일은 결과를 인박스 노트 하나로
  async function collect(p, job, s){
    let r;
    try { r = (await ai(`/v1/jobs/${s.job}`)).job; } catch (e) { return { ...s, error:e.message }; }
    if (['queued', 'running', 'waiting'].includes(r.status)) return { ...s, status:r.status === 'waiting' ? 'waiting' : 'running' };
    if (r.status !== 'done') return { ...s, status:'error', error:r.error || '실패했어요', finished:new Date().toISOString() };
    const text = String((r.result && r.result.text) || '').trim() || '(빈 답)';
    const d = new Date(), at = d.toISOString(), id = `i${d.getTime().toString(36)}${job.id.slice(-3)}`;
    const folder = ((await settingsOf(p)).folders || {}).inbox || MD.DEFAULT_FOLDERS.inbox;
    const name = `${ymd(d)} ${job.name}`.replace(/[\\/:*?"<>|#^[\]]/g, ' ').slice(0, 80);
    let rel = `${folder}/${name}.md`, n = 2;
    while (fs.existsSync(path.join(DATA, p, rel))) rel = `${folder}/${name} (${n++}).md`;
    fs.mkdirSync(path.dirname(path.join(DATA, p, rel)), { recursive:true });
    fs.writeFileSync(path.join(DATA, p, rel), MD.writeDoc({ type:'inbox', id, captured:at }, [], `${job.name} — AI 예약 작업\n\n${text}`));
    onWrite(p);
    return { ...s, status:'done', finished:at, note:rel, error:null };
  }

  async function tick(now = new Date()){
    const minute = now.toISOString().slice(0, 16);
    for (const { name:p } of await listProfiles()){
      if (!here(p).on) continue;
      const fm = await settingsOf(p), jobs = jobsOf(fm), offdays = Array.isArray(fm.offdays) ? fm.offdays : [];
      for (const job of jobs){
        const st = readState(), k = key(p, job.id), s = st[k] || {};
        if (s.status === 'running' || s.status === 'waiting'){ const next = await collect(p, job, s); const st2 = readState(); st2[k] = next; writeState(st2); continue; }
        if (job.on && due(job.cron, now, offdays) && s.minute !== minute){ const st2 = readState(); st2[k] = { ...(st2[k] || {}), minute }; writeState(st2); await start(p, job, 'schedule'); }
      }
    }
  }
  let timer = null;
  const begin = () => { if (!timer){ timer = setInterval(() => tick().catch(e => console.error(`AI 예약 작업: ${e.message}`)), 20000); timer.unref(); } };

  async function status(p){
    const st = readState(), jobs = jobsOf(await settingsOf(p));
    return { here:here(p), jobs:Object.fromEntries(jobs.map(j => [j.id, st[key(p, j.id)] || null])) };
  }
  async function runNow(p, id){
    if (!here(p).on) throw fail(409, '이 컴퓨터가 이 프로필을 돌리고 있지 않아요');
    const job = jobsOf(await settingsOf(p)).find(j => j.id === id);
    if (!job) throw fail(404, '그런 예약 작업이 없어요. 저장된 뒤에 다시 눌러 주세요');
    const s = readState()[key(p, id)];
    if (s && (s.status === 'running' || s.status === 'waiting')) throw fail(409, '이미 돌고 있어요');
    return start(p, job, 'manual');
  }
  return { tick, start:begin, status, runNow };
}
