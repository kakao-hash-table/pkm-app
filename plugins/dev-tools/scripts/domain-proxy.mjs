#!/usr/bin/env node
// domain-proxy.js(fedev 도메인 → 로컬 포트 리버스 프록시) — 상태 목록(list), 도메인 목록(routes), fedev 등록(apply), 띄우기(run), 멈추기(stop),
// 도메인 더하기(add → set), 포트 바꾸기(set), 지우기(remove). 결과는 JSON 한 줄.
//   node domain-proxy.mjs list   --script=<domain-proxy.js>
//   node domain-proxy.mjs routes --script=<domain-proxy.js>
//   node domain-proxy.mjs apply|run|stop --script=<domain-proxy.js>
//   node domain-proxy.mjs add    --script=<domain-proxy.js> [--answer=place-hash.fedev.kakao.com]
//   node domain-proxy.mjs set    --script=<domain-proxy.js> --base=<도메인> [--answer=8086]
//   node domain-proxy.mjs remove --script=<domain-proxy.js> --base=<도메인> [--answer=yes]
// 고치는 건 `const ROUTES = [...]` 블록뿐이고, 고치기 전 내용을 domain-proxy.js.pkm.bak에 한 벌 남긴다(고칠 때마다 덮어씀).
// 띄운 프록시는 새 세션으로 떼어 둔다. PID·기록은 ~/.pkm-app/dev-tools/.domain-proxy.{pid,log}
// 프로젝트는 개발 도구가 띄울 때 남긴 상태(~/.pkm-app/dev-tools/<이름>.json의 cwd·port)로 도메인에 붙여 보인다.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const home = p => String(p || '').trim().replace(/^~(?=\/|$)/, os.homedir());
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
export const stateDir = () => path.join(os.homedir(), '.pkm-app', 'dev-tools');
const pidFile = () => path.join(stateDir(), '.domain-proxy.pid');
export const logFile = () => path.join(stateDir(), '.domain-proxy.log');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plain = s => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n');
const tail = (s, lines = 8) => plain(s).trim().split('\n').slice(-lines).join('\n').slice(-800);
const short = p => p.replace(os.homedir(), '~');
const fail = msg => { const e = new Error(msg); e.user = true; return e; };

function lsof(args){
  for (const bin of ['lsof', '/usr/sbin/lsof']){
    try { return execFileSync(bin, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (e) { if (e.code === 'ENOENT') continue; return ''; }   // 찾은 게 없으면 lsof는 1로 끝난다
  }
  return null;
}
const pidAlive = pid => { if (!(Number(pid) > 0)) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const groupAlive = pid => { if (!(Number(pid) > 0)) return false; try { process.kill(-pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const listeners = port => (lsof(['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']) || '').split(/\s+/).map(Number).filter(Boolean);
const commandOf = pid => { try { return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
export async function portFree(port){
  const out = lsof(['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  if (out != null) return !out.trim();
  return new Promise(res => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))); s.listen(port); });
}

// ---- domain-proxy.js 읽기: PROXY_PORT와 ROUTES 블록 ----
export const proxyPort = text => Number((String(text).match(/^const PROXY_PORT\s*=\s*(\d+)/m) || [])[1]) || 8080;
// `const ROUTES = [` 부터 짝이 맞는 `]`(뒤 ;까지). 글자·주석 안의 괄호는 세지 않는다
export function routesBlock(text){
  const head = text.match(/^const ROUTES\s*=\s*\[/m);
  if (!head) throw fail('domain-proxy.js에서 `const ROUTES = [` 를 찾지 못했어요');
  const open = head.index + head[0].length - 1;
  let depth = 0, quote = '', i = open;
  for (; i < text.length; i++){
    const ch = text[i];
    if (quote){ if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && text[i + 1] === '/'){ i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && text[i + 1] === '*'){ i = text.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') quote = ch;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) break;
  }
  if (depth !== 0 || i < 0 || i >= text.length) throw fail('ROUTES 블록의 끝을 찾지 못했어요');
  return { start: head.index, end: text[i + 1] === ';' ? i + 2 : i + 1, literal: text.slice(open, i + 1) };
}
const evalRoutes = literal => vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 200 });
export function readProxy(script){
  let text;
  try { text = fs.readFileSync(script, 'utf8'); }
  catch (e) { throw fail(e.code === 'ENOENT' ? `domain-proxy.js가 없어요: ${short(script)}. 플러그인 설정의 "domain-proxy.js 위치"를 확인해 주세요` : `domain-proxy.js를 읽지 못했어요(${e.code})`); }
  const block = routesBlock(text);
  let routes;
  try { routes = evalRoutes(block.literal); } catch (e) { throw fail(`ROUTES를 읽지 못했어요: ${e.message}`); }
  if (!Array.isArray(routes)) throw fail('ROUTES가 배열이 아니에요');
  return { text, block, port: proxyPort(text), routes: [...routes].map(r => ({ base: String(r && r.base || ''), port: Number(r && r.port) || null,
    ...(r && r.remote ? { remote: { target: String(r.remote.target || ''), paths: (Array.isArray(r.remote.paths) ? [...r.remote.paths] : []).map(String) } } : {}) })) };
}

// ---- ROUTES 고치기 ----
export const BASE_RE = /^[a-z0-9-]+\.fedev\.(devel\.)?(kakao\.com|onkakao\.net)$/;   // domain-proxy.js RECORD_RE와 같다
export function normalize(list, avoid){
  if (!Array.isArray(list) || !list.length) throw fail('ROUTES에 도메인이 하나는 있어야 해요');
  if (list.length > 50) throw fail('ROUTES는 50개까지 둘 수 있어요');
  const seen = new Set();
  return list.map((r, i) => {
    const n = i + 1, base = String(r && r.base || '').trim().toLowerCase(), port = Number(r && r.port);
    if (!BASE_RE.test(base)) throw fail(`${n}번 도메인 꼴이 맞지 않아요: "${base}" (예: place-hash.fedev.kakao.com)`);
    if (seen.has(base)) throw fail(`${n}번 도메인이 위와 겹쳐요: ${base}`);
    seen.add(base);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail(`${n}번 포트는 1~65535 사이 숫자여야 해요`);
    if (port === avoid) throw fail(`${n}번 포트 ${port}은 프록시가 듣는 포트예요. 다른 포트를 골라 주세요`);
    const out = { base, port };
    const target = String(r.remote && r.remote.target || '').trim();
    const paths = (r.remote && Array.isArray(r.remote.paths) ? r.remote.paths : []).map(p => String(p).trim()).filter(Boolean);
    if (target || paths.length){
      let url = null; try { url = new URL(target); } catch {}
      if (!url || !['http:', 'https:'].includes(url.protocol) || /['\\\n]/.test(target)) throw fail(`${n}번 원격 주소는 http(s)://로 시작해야 해요`);
      if (!paths.length) throw fail(`${n}번 원격 주소로 보낼 경로가 없어요`);
      const bad = paths.find(p => !p.startsWith('/') || /[\s'\\]/.test(p));
      if (bad) throw fail(`${n}번 경로는 /로 시작하고 공백·따옴표가 없어야 해요: ${bad}`);
      out.remote = { target, paths: [...new Set(paths)] };
    }
    return out;
  });
}
export function routesSource(routes){
  const lines = ['const ROUTES = ['];
  for (const r of routes){
    if (!r.remote){ lines.push(`  { base: '${r.base}', port: ${r.port} },`); continue; }
    lines.push('  {', `    base: '${r.base}',`, `    port: ${r.port},`, '    remote: {', `      target: '${r.remote.target}',`, '      paths: [',
      ...r.remote.paths.map(p => `        '${p}',`), '      ],', '    },', '  },');
  }
  lines.push('];');
  return lines.join('\n');
}
// 블록만 바꿔 쓴다: 고치기 전 내용은 .pkm.bak으로, 새 내용은 임시 파일 → 이름 바꾸기
export function saveRoutes(script, edit){
  const cur = readProxy(script);
  const routes = normalize(edit(cur.routes.map(r => ({ ...r }))), cur.port);
  const next = cur.text.slice(0, cur.block.start) + routesSource(routes) + cur.text.slice(cur.block.end);
  try { evalRoutes(routesBlock(next).literal); } catch (e) { throw fail(`저장할 ROUTES를 만들지 못했어요: ${e.message}`); }
  const mode = fs.statSync(script).mode & 0o777;
  fs.writeFileSync(`${script}.pkm.bak`, cur.text, { mode });
  const temp = `${script}.${process.pid}.tmp`;
  fs.writeFileSync(temp, next, { mode });
  fs.renameSync(temp, script);
  return { before: cur.routes, routes, port: cur.port };
}

// ---- 프로젝트: 개발 도구가 띄울 때 남긴 상태 ----
export function projects(){
  let names = []; try { names = fs.readdirSync(stateDir()).filter(n => n.endsWith('.json') && !n.startsWith('.')); } catch {}
  return names.map(n => readJSON(path.join(stateDir(), n))).filter(s => s && s.cwd)
    .map(s => ({ name: path.basename(s.cwd), dir: s.cwd, port: Number(s.port) || null, running: s.pid ? groupAlive(s.pid) : false }));
}
// 도메인 앞부분(-hash 뺀 것)과 프로젝트 이름을 견준다 — projects.mjs의 routeFor와 같은 규칙
const nameKey = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const baseKey = base => nameKey(String(base).split('.')[0].replace(/-hash$/, ''));
export function projectFor(route, list){
  const key = baseKey(route.base);
  return list.find(p => nameKey(p.name) === key) || list.find(p => p.port && p.port === route.port) ||
    list.find(p => Math.min(nameKey(p.name).length, key.length) >= 5 && (key.startsWith(nameKey(p.name)) || nameKey(p.name).startsWith(key))) || null;
}

// ---- 프록시 상태 ----
export function status(script){
  const exists = fs.existsSync(script);
  let port = 8080; try { port = proxyPort(fs.readFileSync(script, 'utf8')); } catch {}
  let pid = Number((() => { try { return fs.readFileSync(pidFile(), 'utf8'); } catch { return ''; } })()) || 0;
  if (pid && !pidAlive(pid)){ pid = 0; fs.rmSync(pidFile(), { force: true }); }
  const ls = listeners(port);
  // 우리가 띄운 것이 아닌데 그 포트를 잡은 것 — 터미널의 `pp`(domain-proxy.js run)인지 본다
  const lp = ls.find(p => p !== pid), command = lp ? commandOf(lp) : '';
  const other = lp ? { pid: lp, command: command.slice(0, 200), proxy: command.includes('domain-proxy.js') } : null;
  let log = ''; try { log = fs.readFileSync(logFile(), 'utf8'); } catch {}
  return { exists, port, pid: pid || null, running: Boolean(pid && ls.includes(pid)), starting: Boolean(pid && !ls.includes(pid)), other, log_tail: tail(log) };
}

async function start(script){
  const st = status(script);
  if (st.running || st.starting) return { ...st, summary: `이미 :${st.port}에서 실행 중이에요` };
  if (st.other) throw fail(st.other.proxy ? `터미널에서 띄운 domain-proxy(PID ${st.other.pid})가 :${st.port}에서 돌고 있어요. [프록시 멈추기]로 멈춘 뒤 다시 띄워 주세요` : `:${st.port}을 다른 프로그램(PID ${st.other.pid} ${st.other.command.split(/\s+/)[0]})이 쓰고 있어요`);
  fs.mkdirSync(stateDir(), { recursive: true });
  const fd = fs.openSync(logFile(), 'w', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [script, 'run'], { cwd: path.dirname(script), env: process.env, detached: true, stdio: ['ignore', fd, fd] });
    child.on('error', () => {});
    fs.writeFileSync(pidFile(), String(child.pid), { mode: 0o600 });
    child.unref();
  } finally { fs.closeSync(fd); }
  for (const until = Date.now() + 5000; Date.now() < until; await sleep(200)){
    const s = status(script);
    if (s.running) return { ...s, summary: `:${s.port}에서 실행 중` };
    if (!s.pid) throw fail(`domain-proxy가 바로 멈췄어요.\n${s.log_tail}`);
  }
  return { ...status(script), summary: `띄웠어요(아직 :${st.port}을 열지 않았어요)` };
}

async function stop(script){
  const st = status(script);
  // 여기서 띄운 것, 또는 같은 포트를 잡은 domain-proxy.js(터미널 `pp`)만 끈다
  const pid = st.pid || (st.other && st.other.proxy ? st.other.pid : 0);
  if (!pid){
    if (st.other) throw fail(`:${st.port}을 domain-proxy가 아닌 프로그램(PID ${st.other.pid})이 쓰고 있어서 끄지 않았어요`);
    return { ...st, stopped: false, summary: '이미 멈춰 있어요' };
  }
  try { process.kill(pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  for (let i = 0; i < 30 && pidAlive(pid); i++) await sleep(100);
  if (pidAlive(pid)) try { process.kill(pid, 'SIGKILL'); } catch {}
  if (pid === st.pid) fs.rmSync(pidFile(), { force: true });
  return { ...status(script), stopped: true, summary: `멈췄어요(PID ${pid})` };
}

function apply(script){
  let out = '', ok = true;
  try { out = execFileSync(process.execPath, [script, 'apply'], { cwd: path.dirname(script), encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 20, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { ok = false; out = `${e.stdout || ''}${e.stderr || ''}${e.killed ? '\n2분 안에 끝나지 않아 멈췄어요' : ''}`; }
  if (!ok) throw fail(`fedev 등록에 실패했어요.\n${tail(out, 12)}`);
  return { summary: 'fedev에 등록했어요', log_tail: tail(out, 12) };
}

// 새 도메인에 권할 포트: 이름이 닮은 프로젝트가 지난번에 쓴 포트 → 8081부터 ROUTES·프록시·다른 프로그램이 안 쓰는 포트
async function suggest(base, routes, avoid){
  const p = projectFor({ base, port: null }, projects());
  const used = new Set([avoid, ...routes.filter(r => r.base !== base).map(r => r.port)]);
  if (p && p.port && !used.has(p.port)) return { port: p.port, hint: `${p.name}이(가) 지난번에 쓴 포트` };
  for (let port = 8081; port < 8200; port++) if (!used.has(port) && await portFree(port)) return { port, hint: '비어 있는 포트' };
  return { port: 8081, hint: '' };
}
const reload = async (script, summary) => {
  const st = status(script);
  if (st.running){ await stop(script); await start(script); return `${summary} · 프록시를 다시 띄웠어요`; }
  if (st.other && st.other.proxy) return `${summary} · 터미널의 프록시를 다시 띄워야 반영돼요`;
  return summary;
};

export function feedItem(script){
  const st = status(script);
  let r = null, err = '';
  try { r = readProxy(script); } catch (e) { err = e.message; }
  const state = st.running ? `실행 중 · :${st.port}` : st.starting ? '띄우는 중' : st.other ? (st.other.proxy ? `터미널에서 실행 중 · :${st.port}` : `:${st.port}을 다른 프로그램이 씀`) : '멈춤';
  return {
    id: 'domain-proxy', title: 'domain-proxy',
    meta: [state, r ? `도메인 ${r.routes.length}개` : err, short(script)].filter(Boolean),
    tags: st.running || (st.other && st.other.proxy) ? ['실행 중'] : [],
    detail: st.log_tail && !st.running ? [{ kind: 'log', text: st.log_tail }] : [],
    version: st.running ? `run-${st.pid}` : 'stop',
    vars: { script }
  };
}
export function routeItems(script){
  const r = readProxy(script), list = projects();
  return r.routes.map(x => {
    const p = projectFor(x, list);
    const link = p ? `${p.name}${p.port === x.port ? (p.running ? ' · 실행 중' : ' · 멈춤') : ` · 지난번 포트 ${p.port || '-'}`}` : '이 포트로 띄운 프로젝트 없음';
    return { id: x.base, title: x.base, url: `https://${x.base}/`,
      meta: [`→ :${x.port}`, link, x.remote && `원격 ${x.remote.paths.length}개 경로 → ${x.remote.target}`].filter(Boolean),
      tags: p && p.running && p.port === x.port ? ['실행 중'] : [],
      vars: { script, base: x.base, port: String(x.port) } };
  });
}

async function main(){
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
  const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
  const answer = String(opt.answer ?? '').trim();
  try {
    if (!String(opt.script || '').trim()) throw fail('플러그인 설정의 "domain-proxy.js 위치"가 비어 있어요');
    const script = path.resolve(home(opt.script));
    if (cmd === 'list') done(fs.existsSync(script) ? { items: [feedItem(script)] } : { items: [], note: `domain-proxy.js가 없어요: ${short(script)}. 플러그인 설정의 "domain-proxy.js 위치"를 확인해 주세요` });
    if (cmd === 'routes') done(fs.existsSync(script) ? { items: routeItems(script) } : { items: [] });
    if (!fs.existsSync(script)) throw fail(`domain-proxy.js가 없어요: ${short(script)}`);
    if (cmd === 'status') done({ ...status(script), summary: feedItem(script).meta[0] });
    if (cmd === 'run') done(await start(script));
    if (cmd === 'stop') done(await stop(script));
    if (cmd === 'apply') done(apply(script));

    if (cmd === 'add'){
      const { routes } = readProxy(script), taken = new Set(routes.map(r => baseKey(r.base)));
      if (!answer){
        // 띄운 적 있는데 도메인이 없는 프로젝트를 먼저 권한다
        const names = [...new Set(projects().map(p => p.name.toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(n => n && !taken.has(nameKey(n))))].slice(0, 8);
        done({ ask: { question: '어떤 도메인을 더할까요?', hint: '<이름>-hash.fedev.kakao.com 꼴로 적어요. 더한 뒤 [fedev 등록]을 눌러야 열려요',
          choices: names.map(n => ({ value: `${n}-hash.fedev.kakao.com`, label: `${n}-hash.fedev.kakao.com`, hint: '띄운 적 있는 프로젝트' })), free: true, placeholder: 'place-hash.fedev.kakao.com' } });
      }
      const base = answer.toLowerCase();
      if (!BASE_RE.test(base)) done({ ask: { question: '어떤 도메인을 더할까요?', hint: `"${base.slice(0, 60)}"은(는) 도메인 꼴이 아니에요. 예: place-hash.fedev.kakao.com`, free: true, placeholder: 'place-hash.fedev.kakao.com' } });
      if (routes.some(r => r.base === base)) throw fail(`이미 있는 도메인이에요: ${base}. 그 도메인 줄의 [포트 바꾸기]를 써 주세요`);
      done({ base, summary: base });
    }

    if (cmd === 'set'){
      const base = String(opt.base || '').trim().toLowerCase();
      if (!BASE_RE.test(base)) throw fail(`도메인 꼴이 아니에요: ${base}`);
      const { routes, port: avoid } = readProxy(script), cur = routes.find(r => r.base === base);
      const ask = async hint => {
        const s = await suggest(base, routes, avoid), choices = [];
        if (cur && cur.port) choices.push({ value: String(cur.port), label: String(cur.port), hint: '지금 포트' });
        if (!cur || s.port !== cur.port) choices.push({ value: String(s.port), label: String(s.port), hint: s.hint, recommended: true });
        done({ ask: { question: `${base}을(를) 몇 번 포트로 보낼까요?`, hint, choices, free: true, placeholder: String(s.port) } });
      };
      if (!answer) await ask(`프록시 포트(${avoid})와 다른 도메인이 쓰는 포트는 피했어요. 다른 번호를 적어도 돼요`);
      const port = Number(answer);
      if (!/^\d+$/.test(answer) || port < 1 || port > 65535) await ask(`"${answer.slice(0, 20)}"은(는) 포트 번호가 아니에요. 1~65535 사이 숫자로 적어 주세요`);
      if (port === avoid) await ask(`${port}번은 프록시가 듣는 포트예요`);
      const clash = routes.find(r => r.base !== base && r.port === port);
      if (clash) await ask(`${port}번은 ${clash.base}이(가) 쓰고 있어요`);
      if (cur && cur.port === port) done({ base, port, summary: `${base} → :${port} 그대로예요` });
      saveRoutes(script, list => cur ? list.map(r => r.base === base ? { ...r, port } : r) : [...list, { base, port }]);
      done({ base, port, summary: await reload(script, cur ? `${base} → :${port}로 바꿨어요` : `${base} → :${port}를 더했어요 · [fedev 등록]을 눌러야 열려요`) });
    }

    if (cmd === 'remove'){
      const base = String(opt.base || '').trim().toLowerCase(), { routes } = readProxy(script);
      if (!routes.some(r => r.base === base)) done({ summary: `이미 없는 도메인이에요: ${base}` });
      if (answer !== 'yes') done({ ask: { question: `${base}을(를) ROUTES에서 지울까요?`, hint: 'fedev에 등록한 기록은 지우지 않아요. 고치기 전 파일은 domain-proxy.js.pkm.bak에 남아요',
        choices: [{ value: 'yes', label: '지우기', recommended: true }], inline: true } });
      if (routes.length === 1) throw fail('마지막 도메인은 지울 수 없어요');
      saveRoutes(script, list => list.filter(r => r.base !== base));
      done({ summary: await reload(script, `${base}을(를) 지웠어요`) });
    }
    throw fail('명령은 list, routes, status, apply, run, stop, add, set, remove예요');
  } catch (e) {
    done({ error: e.user ? e.message : `domain-proxy 작업에 실패했어요: ${e.message}` }, 1);
  }
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main();
