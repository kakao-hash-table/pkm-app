#!/usr/bin/env node
// 로컬 개발 서버 — 명령 찾기·고르기(pick), 띄우기(start), 멈추기(stop), 상태(status), 찾은 명령 보기(detect). 결과는 JSON 한 줄.
//   node devserver.mjs pick   --path=<프로젝트> [--answer="pnpm dev"]
//   node devserver.mjs start  --path=<프로젝트> --command="pnpm dev" [--answer=3000]
//   node devserver.mjs stop   --path=<프로젝트>
//   node devserver.mjs status --path=<프로젝트>
// 서버는 새 세션으로 떼어 띄운다(detached) — 이 스크립트(pkm-ai-server의 작업)가 끝나도 계속 돈다.
// 상태 ~/.pkm-app/dev-tools/<이름>.json { pid, command, port, startedAt, cwd }, 기록 ~/.pkm-app/dev-tools/<이름>.log
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---- 공통: 프로젝트 살피기 — projects.mjs와 devserver.mjs가 똑같이 갖는다 ----
// 스크립트는 파일마다 따로 승인되므로 서로 import하지 않는다(승인 뒤 바뀐 파일을 import로 돌리지 않게). 고칠 땐 둘 다 고치고, 시험이 같은지 본다.
const home = p => String(p || '').trim().replace(/^~(?=\/|$)/, os.homedir());
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const has = (dir, ...names) => names.some(n => fs.existsSync(path.join(dir, n)));
const isDir = d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
export const stateDir = () => path.join(os.homedir(), '.pkm-app', 'dev-tools');
const slug = dir => path.basename(dir).replace(/[^\w.-]+/g, '_') || 'project';
export const statePath = dir => path.join(stateDir(), `${slug(dir)}.json`);
export const logPath = dir => path.join(stateDir(), `${slug(dir)}.log`);
const PORT_TOOLS = /(?:^|[\s;&|(])(?:npx\s+)?(?:next|vite|webpack(?:-dev-server)?|nuxt|nuxi|astro)(?=\s|$)/;

// 실행할 명령: dev·serve·local → start* → pnpm 워크스페이스(apps/*, sites/*) → gradle bootRun → 설치
export function detect(dir){
  const pkg = readJSON(path.join(dir, 'package.json')), cmds = [];
  const pm = has(dir, 'pnpm-lock.yaml', 'pnpm-workspace.yaml') ? 'pnpm' : has(dir, 'yarn.lock') ? 'yarn' : 'npm';
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const names = Object.keys(scripts).filter(s => /^(dev|serve|start|local)([:-].*)?$/.test(s));
  for (const s of [...names.filter(s => !s.startsWith('start')), ...names.filter(s => s.startsWith('start'))])
    cmds.push({ argv: pm === 'npm' ? ['npm', 'run', s] : [pm, s], script: String(scripts[s]) });
  if (pm === 'pnpm' && has(dir, 'pnpm-workspace.yaml')){
    for (const group of ['apps', 'sites']){
      let subs = []; try { subs = fs.readdirSync(path.join(dir, group)).filter(n => !n.startsWith('.')).sort(); } catch {}
      for (const n of subs){
        const sub = readJSON(path.join(dir, group, n, 'package.json'));
        if (sub && sub.scripts && sub.scripts.dev) cmds.push({ argv: ['pnpm', '--filter', String(sub.name || n), 'dev'], script: String(sub.scripts.dev) });
      }
    }
  }
  if (has(dir, 'gradlew') && has(dir, 'build.gradle', 'build.gradle.kts')) cmds.push({ argv: ['./gradlew', 'bootRun'], script: '', gradle: true });
  if (pkg) cmds.push({ argv: [pm, 'install'], script: '', install: true });
  return { pm: pkg ? pm : null, commands: cmds.map(c => ({ command: c.argv.join(' '), argv: c.argv, script: c.script, port: PORT_TOOLS.test(c.script), gradle: !!c.gradle, install: !!c.install })) };
}

// .nvmrc·.node-version → ~/.nvm/versions/node 에서 맞는 가장 높은 버전
export function nodeFor(dir){
  const f = ['.nvmrc', '.node-version'].map(n => path.join(dir, n)).find(f => fs.existsSync(f));
  if (!f) return null;
  const want = (fs.readFileSync(f, 'utf8').trim().split(/\s+/)[0] || '').replace(/^v/, '');
  const root = path.join(os.homedir(), '.nvm', 'versions', 'node');
  let vs = []; try { vs = fs.readdirSync(root).filter(v => /^v\d+\.\d+\.\d+$/.test(v)); } catch {}
  const num = v => v.slice(1).split('.').map(Number), parts = want.split('.').map(Number);
  const hit = /^\d+(\.\d+){0,2}$/.test(want)
    ? vs.filter(v => parts.every((p, i) => num(v)[i] === p)).sort((a, b) => { const x = num(a), y = num(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; })[0] || null : null;
  return { want, version: hit ? hit.slice(1) : null, bin: hit ? path.join(root, hit, 'bin') : null };
}

function lsof(args){
  for (const bin of ['lsof', '/usr/sbin/lsof']){
    try { return execFileSync(bin, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (e) { if (e.code === 'ENOENT') continue; return ''; }   // 찾은 게 없으면 lsof는 1로 끝난다
  }
  return null;
}
// 띄운 서버는 새 세션(프로세스 그룹)의 우두머리다 — 그룹이 살아 있는지 본다(npm → sh → node 처럼 자식이 남아 있어도)
export function alive(pid){
  if (!(Number(pid) > 0)) return false;
  try { process.kill(-pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
export function groupPorts(pgid){
  const out = lsof(['-nP', '-a', '-g', String(pgid), '-iTCP', '-sTCP:LISTEN', '-Fn']) || '';
  return [...new Set(out.split('\n').map(l => (l.match(/^n.*:(\d+)$/) || [])[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
}
export function status(dir){
  const st = readJSON(statePath(dir)) || {};
  const running = st.cwd === dir && alive(st.pid);
  const ports = running ? groupPorts(st.pid) : [];
  const port = ports.includes(st.port) ? st.port : ports[0] || null;
  return { running, pid: running ? st.pid : null, command: st.command || '', port, ports, last_port: st.port || null, url: port ? `http://localhost:${port}/` : '', started: running ? st.startedAt || null : null };
}
// ---- 공통 끝 ----

// next·vite·webpack·nuxt·astro는 PORT 환경 변수를 안 보므로 --port를 붙인다. npm·pnpm은 스크립트 인자 앞에 --가 필요하다
export function withPort(c, port){
  if (!port || !c.port) return c.argv;
  return [...c.argv, ...(c.argv[0] === 'yarn' ? [] : ['--']), '--port', String(port)];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const tail = (file, lines = 8) => { try { return fs.readFileSync(file, 'utf8').trim().split('\n').slice(-lines).join('\n').slice(-600); } catch { return ''; } };
// 다른 프로그램이 이 포트에서 듣고 있는지 — lsof가 없으면 직접 열어 본다
export async function portFree(port){
  const out = lsof(['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  if (out != null) return !out.trim();
  return new Promise(res => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))); s.listen(port); });
}
async function suggestPort(last, gradle){
  if (last && await portFree(last)) return last;
  for (let p = gradle ? 8080 : 3000, n = 0; n < 200; p++, n++) if (await portFree(p)) return p;
  return gradle ? 8080 : 3000;
}
const writeState = (dir, st) => { fs.mkdirSync(stateDir(), { recursive: true }); fs.writeFileSync(statePath(dir), JSON.stringify(st, null, 2) + '\n'); };

async function main(){
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
  const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
  const failWith = msg => done({ error: msg }, 1);
  if (!String(opt.path || '').trim()) failWith('프로젝트 폴더가 비어 있어요');
  const dir = path.resolve(home(opt.path)), name = path.basename(dir), answer = String(opt.answer ?? '').trim();
  if (!isDir(dir)) failWith(`프로젝트 폴더가 없어요: ${dir}`);
  const s = status(dir);
  const runningSummary = () => s.url ? `이미 ${s.url} 에서 실행 중이에요` : `이미 실행 중이에요(${s.command})`;

  if (cmd === 'detect') done({ ...detect(dir), node: nodeFor(dir) });

  if (cmd === 'status'){
    const log = logPath(dir);
    done({ ...s, log, log_tail: tail(log), summary: s.running ? (s.url ? `${s.url} 에서 실행 중` : `실행 중(${s.command})`) : '멈춤' });
  }

  if (cmd === 'pick'){
    if (s.running) done({ command: '', running: true, url: s.url, summary: runningSummary() });
    const { commands } = detect(dir);
    if (!commands.length) failWith('실행할 명령을 찾지 못했어요. package.json의 dev·serve·start·local 스크립트나 gradlew + build.gradle을 찾아요');
    if (answer){
      const c = commands.find(c => c.command === answer);
      if (!c) failWith(`이 프로젝트에서 찾은 명령이 아니에요: ${answer}`);
      done({ command: c.command, summary: c.command });
    }
    const node = nodeFor(dir);
    done({ ask: {
      question: `${name}에서 무엇을 실행할까요?`,
      hint: node ? (node.version ? `node ${node.version}로 실행해요(${node.want})` : `.nvmrc의 node ${node.want}가 nvm에 없어서 지금 node로 실행해요`) : '',
      choices: commands.map((c, i) => ({ value: c.command, label: c.command, hint: c.install ? '패키지 설치' : c.gradle ? 'Spring Boot' : clip(c.script, 100), recommended: i === 0 }))
    } });
  }

  if (cmd === 'start'){
    if (s.running) done({ running: true, url: s.url, port: s.port, summary: runningSummary() });
    const other = readJSON(statePath(dir));
    if (other && other.cwd && other.cwd !== dir && alive(other.pid)) failWith(`이름이 같은 다른 프로젝트(${other.cwd})가 실행 중이에요. 그쪽을 먼저 멈춰 주세요`);
    const want = String(opt.command || '').trim();
    if (!want) failWith('실행할 명령이 비어 있어요. 처음부터 다시 실행해 주세요');
    const c = detect(dir).commands.find(c => c.command === want);
    if (!c) failWith(`이 프로젝트에서 찾은 명령이 아니에요: ${want}`);

    let port = null;
    if (!c.install){
      const ask = async hint => { const p = await suggestPort(s.last_port, c.gradle); done({ ask: { question: '몇 번 포트로 띄울까요?', hint,
        choices: [{ value: String(p), label: String(p), hint: p === s.last_port ? '지난번에 쓴 포트' : '비어 있는 포트', recommended: true }], free: true, placeholder: String(p) } }); };
      if (!answer) await ask(`${c.command} · 비어 있는 포트를 골라 두었어요. 다른 번호를 적어도 돼요`);
      port = Number(answer);
      if (!/^\d+$/.test(answer) || port < 1 || port > 65535) await ask(`"${clip(answer, 20)}"는 포트 번호가 아니에요. 1~65535 사이 숫자로 적어 주세요`);
      if (!(await portFree(port))) await ask(`${port}번은 이미 다른 프로그램이 쓰고 있어요`);
    }

    const node = nodeFor(dir);
    const env = { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' };
    if (port) Object.assign(env, { PORT: String(port), SERVER_PORT: String(port) });
    if (node && node.bin) env.PATH = `${node.bin}${path.delimiter}${env.PATH || ''}`;
    let nodeV = node && node.version;
    if (!nodeV) try { nodeV = execFileSync('node', ['--version'], { encoding: 'utf8', env, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().replace(/^v/, ''); } catch { nodeV = '?'; }
    const argv = withPort(c, port), log = logPath(dir);
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(log, `$ ${argv.join(' ')} # ${dir} · node ${nodeV} · 포트 ${port ?? '-'}\n`);
    const fd = fs.openSync(log, 'a');
    let spawnErr = null, exited = null;
    // detached: 새 세션·새 프로세스 그룹(setsid). 표준 입출력은 기록 파일로 — 작업의 파이프를 붙잡지 않아야 작업이 끝난다
    const child = spawn(argv[0], argv.slice(1), { cwd: dir, env, detached: true, stdio: ['ignore', fd, fd] });
    child.on('error', e => { spawnErr = e; });
    child.on('exit', code => { exited = code ?? 'signal'; });
    fs.closeSync(fd);
    child.unref();
    await sleep(200);
    if (spawnErr || !child.pid) failWith(spawnErr && spawnErr.code === 'ENOENT' ? `${argv[0]}를 찾지 못했어요. 설치돼 있는지, pkm-ai-server의 PATH에 있는지 확인해 주세요` : `실행하지 못했어요: ${(spawnErr && spawnErr.message) || '알 수 없는 오류'}`);
    const pid = child.pid, startedAt = new Date().toISOString();
    writeState(dir, { pid, command: argv.join(' '), port, startedAt, cwd: dir, node: nodeV });
    if (c.install) done({ pid, command: c.command, log, summary: `${c.command} 시작했어요. 끝나면 기록에 남아요` });

    const until = Date.now() + (Number(process.env.DEV_TOOLS_WAIT_MS) || 30000);
    while (Date.now() < until){
      if (exited != null || !alive(pid)) failWith(`${c.command}이 바로 멈췄어요.\n${tail(log)}`);
      const ports = groupPorts(pid);
      if (ports.length){
        const p = ports.includes(port) ? port : ports[0], url = `http://localhost:${p}/`;
        done({ pid, port: p, url, command: c.command, log, summary: `${url} 에서 실행 중` });
      }
      await sleep(400);
    }
    done({ pid, port, url: `http://localhost:${port}/`, command: c.command, log, summary: `http://localhost:${port}/ 에서 시작했어요(아직 준비 중이에요)` });
  }

  if (cmd === 'stop'){
    const st = readJSON(statePath(dir)) || {};
    if (!(st.cwd === dir && alive(st.pid))) done({ stopped: false, summary: '이미 멈춰 있어요' });
    const gone = async ms => { for (const t = Date.now() + ms; Date.now() < t; await sleep(100)) if (!alive(st.pid)) return true; return !alive(st.pid); };
    try { process.kill(-st.pid, 'SIGTERM'); } catch {}
    let forced = false;
    if (!(await gone(3000))){ forced = true; try { process.kill(-st.pid, 'SIGKILL'); } catch {} }
    if (!(await gone(2000))) failWith(`멈추지 못했어요(pid ${st.pid}). 터미널에서 kill -9 -${st.pid}로 멈춰 주세요`);
    writeState(dir, { ...st, pid: null, stoppedAt: new Date().toISOString() });
    done({ stopped: true, forced, summary: `멈췄어요${st.port ? ` (포트 ${st.port})` : ''}${forced ? ' · 강제로' : ''}` });
  }

  failWith('명령은 pick, start, stop, status, detect예요');
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main();
