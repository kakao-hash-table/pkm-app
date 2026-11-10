#!/usr/bin/env node
// 로컬 개발 서버(개발 도구·FE 프로젝트 관리가 같은 파일을 갖는다 — 고칠 땐 둘 다) — 한 번에 띄우기(up), 명령 찾기·고르기(pick), 띄우기(start), 멈추기(stop), 상태(status), 찾은 명령 보기(detect). 결과는 JSON 한 줄.
//   node devserver.mjs up     --path=<프로젝트> --command="pnpm dev" [--port=8090] [--avoid=8080] [--answer=…]
//   (--avoid: 쓰지 않을 포트 — domain-proxy가 듣는 포트. 넘겨받은 포트·지난 포트가 이것이면 빈 포트를 고른다)
//   up의 --answer: ?(명령·포트 고르기) · cmd=<명령>(그 명령으로 포트 묻기) · run=<포트>|<명령> · kill=<포트>|<pid>|<명령>(그 포트를 쓰는 프로그램을 끄고 띄우기) · 숫자(그 포트로) · 명령
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
const PORT_TOOLS = /^\s*(?:[A-Za-z_][\w]*=\S*\s+)*(?:cross-env\s+)?(?:[A-Za-z_][\w]*=\S*\s+)*(?:npx\s+)?(?:next\s+(?:dev|start)|vite|webpack(?:-dev-server|\s+serve)|vue-cli-service\s+serve|nuxt\s+dev|nuxi\s+dev|astro\s+dev)\b/;

// 실행할 명령: dev·serve·local → start* → pnpm 워크스페이스(apps/*, sites/*) → gradle bootRun(프로필) → 설치
// want가 "./gradlew bootRun --args=--spring.profiles.active=dev,local" 꼴이면 그 프로필 명령도 찾은 명령으로 둔다(노트에 적은 실행 명령)
export function detect(dir, want){
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
  if (has(dir, 'gradlew') && has(dir, 'build.gradle', 'build.gradle.kts')){
    const prof = String(want || '').trim().match(/^\.\/gradlew bootRun --args=--spring\.profiles\.active=([\w,-]+)$/);
    if (prof) cmds.push({ argv: ['./gradlew', 'bootRun', `--args=--spring.profiles.active=${prof[1]}`], script: '', gradle: true });
    cmds.push({ argv: ['./gradlew', 'bootRun'], script: '', gradle: true });
  }
  if (pkg) cmds.push({ argv: [pm, 'install'], script: '', install: true });
  return { pm: pkg ? pm : null, commands: cmds.map(c => ({ command: c.argv.join(' '), argv: c.argv, script: c.script, port: !/&&|\|\||[;|]/.test(c.script) && PORT_TOOLS.test(c.script), gradle: !!c.gradle, install: !!c.install })) };
}

// .nvmrc·.node-version → ~/.nvm/versions/node 에서 맞는 가장 높은 버전. 딱 맞는 게 없으면 같은 주 버전(24.11.1 → 24.22.1)
export function nodeFor(dir){
  const f = ['.nvmrc', '.node-version'].map(n => path.join(dir, n)).find(f => fs.existsSync(f));
  if (!f) return null;
  const want = (fs.readFileSync(f, 'utf8').trim().split(/\s+/)[0] || '').replace(/^v/, '');
  const root = path.join(os.homedir(), '.nvm', 'versions', 'node');
  let vs = []; try { vs = fs.readdirSync(root).filter(v => /^v\d+\.\d+\.\d+$/.test(v)); } catch {}
  const num = v => v.slice(1).split('.').map(Number), parts = want.split('.').map(Number);
  vs.sort((a, b) => { const x = num(a), y = num(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; });
  const hit = /^\d+(\.\d+){0,2}$/.test(want) ? vs.find(v => parts.every((p, i) => num(v)[i] === p)) || vs.find(v => num(v)[0] === parts[0]) || null : null;
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
  const out = lsof(['-nP', '-a', '-g', String(pgid), '-iTCP', '-sTCP:LISTEN', '-Fpcn']) || '';
  const ports = []; let internal = false;
  for (const l of out.split('\n')){
    if (l[0] === 'p'){
      let command = ''; try { command = execFileSync('ps', ['-o', 'command=', '-p', l.slice(1)], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
      internal = /GradleDaemon|org\.gradle\.launcher\.daemon|GradleWorkerMain|KotlinCompileDaemon/.test(command);
    }
    if (!internal && l[0] === 'n'){ const port = Number((l.match(/:(\d+)$/) || [])[1]); if (port) ports.push(port); }
  }
  return [...new Set(ports)].sort((a, b) => a - b);
}
export function status(dir){
  const st = readJSON(statePath(dir)) || {};
  const running = st.cwd === dir && alive(st.pid);
  const ports = running ? groupPorts(st.pid) : [];
  const port = ports.includes(st.port) ? st.port : ports[0] || null;
  return { running, pid: running ? st.pid : null, command: st.command || '', port, ports, last_port: st.port || null, url: port ? `http://localhost:${port}/` : '', started: running ? st.startedAt || null : null };
}
// ---- 공통 끝 ----

// next·vite·webpack·nuxt·astro는 PORT 환경 변수를 안 보므로 --port를 붙인다(스크립트에 --port 8080이 박혀 있어도 뒤에 붙인 것이 이긴다).
// npm만 스크립트 인자 앞에 --가 필요하다 — pnpm·yarn은 --까지 그대로 넘겨서 next가 "--port"를 폴더 이름으로 읽는다
export function withPort(c, port){
  if (!port) return c.argv;
  if (c.gradle){
    const app = c.argv.find(a => a.startsWith('--args='));
    return [...c.argv.filter(a => !a.startsWith('--args=')), `--args=${app ? app.slice(7) + ' ' : ''}--server.port=${port}`];
  }
  if (!c.port) return c.argv;
  return [...c.argv, ...(c.argv[0] === 'npm' ? ['--'] : []), '--port', String(port)];
}

// GUI로 시작한 실행기도 터미널과 같은 명령을 찾는다. 프로젝트의 node를 가장 먼저 둔다.
export function launchEnv(dir, base = process.env){
  const node = nodeFor(dir), bins = [node && node.bin, path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), 'Library/pnpm'), path.join(os.homedir(), '.local/share/pnpm')];
  // pnpm/corepack이 다른 nvm 버전에만 설치돼 있어도 선택한 node로 실행할 수 있게 한다.
  const nvm = path.join(os.homedir(), '.nvm/versions/node');
  try { bins.push(...fs.readdirSync(nvm).filter(v => /^v\d+\.\d+\.\d+$/.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map(v => path.join(nvm, v, 'bin'))); } catch {}
  return { ...base, PATH: [...new Set([...bins.filter(Boolean), ...(base.PATH || '').split(path.delimiter).filter(Boolean)])].join(path.delimiter), BROWSER: 'none', FORCE_COLOR: '0' };
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
// 이 포트에서 듣는 프로그램 { pid, name, command, mine(이 스크립트를 부른 pkm-ai-server·pkm 서버 쪽이면 true) }
const psLine = pid => { try { return execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const ancestors = () => { const out = new Set([process.pid]); for (let p = process.ppid, n = 0; p > 1 && n < 10; n++){ out.add(p); p = Number(psLine(p).split(/\s+/)[0]) || 0; } return out; };
export function portOwner(port){
  const pid = Number(String(lsof(['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']) || '').split(/\s+/).find(Boolean)) || 0;
  if (!pid) return null;
  const command = psLine(pid).replace(/^\d+\s+/, ''), mine = ancestors().has(pid) || /pkm-ai-server|pkm-app\/server\/index\.js|server\/index\.js/.test(command);
  // 개발 도구로 띄운 다른 프로젝트면(상태 파일의 pid가 이 프로세스의 그룹) 그 이름으로, 끌 때는 그룹째
  let pgid = 0; try { pgid = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()) || 0; } catch {}
  let project = '';
  try { for (const n of fs.readdirSync(stateDir()).filter(n => n.endsWith('.json') && !n.startsWith('.'))){ const st = readJSON(path.join(stateDir(), n)); if (st && st.pid && st.pid === pgid && st.cwd){ project = path.basename(st.cwd); break; } } } catch {}
  const name = project || (command.match(/([^/]+)\.app\//) || [])[1] || path.basename(command.split(/\s+/)[0] || '') || `PID ${pid}`;
  return { pid, name, command: clip(command, 160), mine, proxy: command.includes('domain-proxy.js'), group: project ? pgid : 0 };
}
// 포트를 쓰는 프로그램을 끈다 — 고를 때 본 PID가 아직 그 포트를 쓰는지 다시 보고, pkm 서버·pkm-ai-server는 끄지 않는다
async function freeUp(port, pid){
  const o = portOwner(port);
  if (!o) return;
  if (pid && o.pid !== pid) throw new Error(`${port}번을 쓰는 프로그램이 바뀌었어요(지금 PID ${o.pid} ${o.name}). 다시 띄워 주세요`);
  if (o.mine) throw new Error(`${port}번은 pkm이 쓰고 있어서 끌 수 없어요. 다른 포트를 골라 주세요`);
  try { process.kill(o.group ? -o.group : o.pid, 'SIGTERM'); } catch (e) { if (e.code === 'EPERM') throw new Error(`PID ${o.pid}(${o.name})는 권한이 없어 끌 수 없어요`); }
  for (let i = 0; i < 30 && portOwner(port); i++) await sleep(100);
  const left = portOwner(port);
  if (left){
    if (left.pid !== o.pid || left.group !== o.group) throw new Error(`${port}번의 프로세스가 바뀌었어요. 새로 확인해 주세요`);
    try { process.kill(o.group ? -o.group : o.pid, 'SIGKILL'); } catch {} await sleep(300);
  }
  if (portOwner(port)) throw new Error(`${port}번이 아직 비지 않았어요(PID ${portOwner(port).pid}). 잠시 뒤 다시 해 주세요`);
}
// 기록에서 알아볼 수 있는 오류 — 첫 줄에 이름을 붙여 보인다
export function errorName(log){
  const t = String(log || '');
  const port = (t.match(/EADDRINUSE[^\n]*?:(\d{2,5})/) || t.match(/[Pp]ort (\d{2,5}) is (?:already )?in use/) || [])[1];
  if (/EADDRINUSE|address already in use|is already in use/i.test(t)) return `EADDRINUSE · ${port ? `${port}번` : '포트'}을 이미 다른 프로그램이 쓰고 있어요`;
  if (/Invalid project directory provided/.test(t)) return 'next 인자 오류 · 포트 인자가 폴더 이름으로 넘어갔어요';
  const eng = t.match(/Unsupported engine: wanted: \{"node":"([^"]+)"\} \(current: \{"node":"([^"]+)"/);
  if (eng && /ERR_PNPM_UNSUPPORTED_ENGINE|exit code|ELIFECYCLE/.test(t)) return `node 버전 · ${eng[1]}이 필요한데 ${eng[2]}로 돌았어요`;
  if (/command not found|ENOENT|not found:/.test(t)) return `명령을 찾지 못했어요 · ${clip((t.match(/(?:command not found|not found):?\s*(\S+)/) || [])[1] || '', 40)}`.replace(/ · $/, '');
  if (/Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/.test(t)) return '모듈 없음 · 패키지를 먼저 설치해 보세요(설치 명령)';
  if (/EACCES/.test(t)) return 'EACCES · 권한이 없어요(1024 아래 포트는 sudo가 필요해요)';
  const code = (t.match(/(?:exit code|exited with code|code) (\d+)/i) || [])[1];
  if (/ELIFECYCLE/.test(t)) return `ELIFECYCLE · 스크립트가 ${code ? `코드 ${code}로 ` : ''}끝났어요`;
  return code ? `코드 ${code}로 끝났어요` : '';
}

async function suggestPort(last, gradle, avoid = []){
  if (last && !avoid.includes(last) && await portFree(last)) return last;
  for (let p = gradle ? 8080 : 3000, n = 0; n < 200; p++, n++) if (!avoid.includes(p) && await portFree(p)) return p;
  return gradle ? 8081 : 3000;
}
const writeState = (dir, st) => { fs.mkdirSync(stateDir(), { recursive: true }); fs.writeFileSync(statePath(dir), JSON.stringify(st, null, 2) + '\n'); };

// 띄우고 포트가 열릴 때까지 기다린다(최대 30초). done으로 끝난다
// onCrash(오류 이름, 기록 끝): 바로 죽었을 때 실패 대신 물을 수 있게(포트를 이미 쓰고 있을 때)
async function launch(dir, c, port, extra, onCrash){
  const done = (obj, code = 0) => { process.stdout.write(JSON.stringify({ ...obj, ...(code ? {} : extra) }) + '\n'); process.exit(code); };
  const failWith = msg => done({ error: msg }, 1);
  const node = nodeFor(dir);
  const env = launchEnv(dir);
  if (port) Object.assign(env, { PORT: String(port), SERVER_PORT: String(port) });
  let nodeV = node && node.version;
  if (!nodeV) try { nodeV = execFileSync('node', ['--version'], { encoding: 'utf8', env, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().replace(/^v/, ''); } catch { nodeV = '?'; }
  const argv = withPort(c, port), log = logPath(dir);
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(log, `$ ${argv.join(' ')} # ${dir} · node ${nodeV} · 포트 ${port ?? '-'}\n`);
  writeState(dir, { cwd: dir, pid: null, selected: c.command, command: argv.join(' '), port, startedAt: new Date().toISOString(), node: nodeV });
  const fd = fs.openSync(log, 'a');
  let spawnErr = null, exited = null;
  // detached: 새 세션·새 프로세스 그룹(setsid). 표준 입출력은 기록 파일로 — 작업의 파이프를 붙잡지 않아야 작업이 끝난다
  const child = spawn(argv[0], argv.slice(1), { cwd: dir, env, detached: true, stdio: ['ignore', fd, fd] });
  child.on('error', e => { spawnErr = e; });
  child.on('exit', code => { exited = code ?? 'signal'; });
  fs.closeSync(fd);
  child.unref();
  await sleep(200);
  if (spawnErr || !child.pid){
    const error = spawnErr && spawnErr.code === 'ENOENT' ? `ENOENT · ${argv[0]} 명령을 찾지 못했어요. 설치 경로를 확인해 주세요` : `실행하지 못했어요: ${(spawnErr && spawnErr.message) || '알 수 없는 오류'}`;
    fs.appendFileSync(log, error + '\n'); writeState(dir, { ...readJSON(statePath(dir)), error }); failWith(error);
  }
  const pid = child.pid, startedAt = new Date().toISOString();
  writeState(dir, { pid, selected: c.command, command: argv.join(' '), port, startedAt, cwd: dir, node: nodeV });
  if (c.install) done({ pid, command: c.command, log, summary: `${c.command} 시작했어요. 끝나면 기록에 남아요` });

  const until = Date.now() + (Number(process.env.DEV_TOOLS_WAIT_MS) || 30000);
  while (Date.now() < until){
    if (exited != null || !alive(pid)){ const all = (() => { try { return fs.readFileSync(log, 'utf8'); } catch { return ''; } })(), name = errorName(all) || (typeof exited === 'number' ? `코드 ${exited}로 끝났어요` : '');
      if (onCrash) await onCrash(name, tail(log));
      const error = `${c.command}이 바로 멈췄어요${name ? ` — ${name}` : ''}`;
      writeState(dir, { ...readJSON(statePath(dir)), pid: null, error });
      failWith(`${error}.\n${tail(log)}`); }
    const ports = groupPorts(pid);
    if (ports.length){
      const p = ports.includes(port) ? port : ports[0], url = `http://localhost:${p}/`;
      done({ pid, port: p, url, command: c.command, log, summary: `${url} 에서 실행 중` });
    }
    await sleep(400);
  }
  done({ pid, port, url: `http://localhost:${port}/`, command: c.command, log, summary: `http://localhost:${port}/ 에서 시작했어요(아직 준비 중이에요)` });
}

async function main(){
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
  const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
  const failWith = msg => done({ error: msg }, 1);
  if (!String(opt.path || '').trim()) failWith('프로젝트 폴더가 비어 있어요');
  if (opt.path === '-') failWith('로컬 클론이 없어요. FE 프로젝트 관리의 [받기]로 먼저 받아 주세요');
  const dir = path.resolve(home(opt.path)), name = path.basename(dir), answer = String(opt.answer ?? '').trim();
  if (!isDir(dir)) failWith(`프로젝트 폴더가 없어요: ${dir}`);
  const s = status(dir);
  const runningSummary = () => s.url ? `이미 ${s.url} 에서 실행 중이에요` : `이미 실행 중이에요(${s.command})`;

  if (cmd === 'open'){
    try { execFileSync('/usr/bin/open', ['-a', 'Cursor', dir], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }); done({ summary: 'Cursor로 열었어요' }); }
    catch (e) { failWith(`Cursor로 열지 못했어요: ${String(e.stderr || e.message).trim().slice(0, 300)}`); }
  }
  if (cmd === 'free'){
    const port = Number(opt.port), pid = Number(opt.pid);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(pid) || pid < 1) failWith('포트와 PID를 새로 확인해 주세요');
    const owner = portOwner(port);
    if (answer !== 'yes') done({ ask: { question: `${port}번 포트를 종료할까요?`, hint: owner ? `${owner.name}(PID ${owner.pid}) · 저장하지 않은 작업이 있으면 사라져요` : '이미 비어 있어요', choices: [{ value: 'yes', label: '포트 종료', confirm: `${port}번 프로세스를 종료해요` }], inline: true } });
    try { await freeUp(port, pid); done({ summary: `${port}번 포트를 비웠어요` }); } catch (e) { failWith(e.message); }
  }

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
    const c = detect(dir, want).commands.find(c => c.command === want);
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

    await launch(dir, c, port, {});
  }

  if (cmd === 'up'){
    // 띄우기 한 번에 — 명령은 넘겨받은 것(노트의 실행 명령·지난번 명령·찾은 첫 명령), 포트는 넘겨받은 것(노트·지난번·도메인) → 지난번 것 → 빈 곳.
    // 정한 포트를 다른 프로그램이 쓰고 있으면 몰래 옮기지 않고 묻는다: [그 프로그램 끄고 띄우기] [빈 포트로 띄우기] 또는 번호 적기
    // [명령·포트 바꾸기]는 --answer=? 로 다시 와서 명령을 고르게 묻고(cmd=…), 이어서 포트를 묻는다(run=…)
    const extra = { change: { label: '명령·포트 바꾸기', value: '?' } };
    if (s.running) done({ running: true, url: s.url, port: s.port, summary: runningSummary() });
    const other = readJSON(statePath(dir));
    if (other && other.cwd && other.cwd !== dir && alive(other.pid)) failWith(`이름이 같은 다른 프로젝트(${other.cwd})가 실행 중이에요. 그쪽을 먼저 멈춰 주세요`);
    const avoid = String(opt.avoid || '').split(',').map(Number).filter(p => p > 0);
    const [, mode, rest_] = answer.match(/^(cmd|run|kill)=(.*)$/) || [];
    const parts = mode ? rest_.split('|') : [];
    // 적은 번호만 오면 고르던 명령(state.pick)으로
    const st0 = readJSON(statePath(dir)) || {};
    const typed = /^\d+$/.test(answer) ? Number(answer) : null;
    const want = mode === 'cmd' ? rest_ : mode === 'run' ? parts.slice(1).join('|') : mode === 'kill' ? parts.slice(2).join('|')
      : typed != null ? (st0.cwd === dir && st0.pick) || String(opt.command || '').trim() : answer && answer !== '?' ? answer : String(opt.command || '').trim();
    const { commands } = detect(dir, want);
    if (!commands.length) failWith('실행할 명령을 찾지 못했어요. package.json의 dev·serve·start·local 스크립트나 gradlew + build.gradle을 찾아요');
    const c = answer === '?' ? null : commands.find(c => c.command === want);
    const node = nodeFor(dir);
    const nodeHint = node ? (node.version ? `node ${node.version}로 실행해요${node.version !== node.want ? `(.nvmrc ${node.want})` : ''}` : `.nvmrc의 node ${node.want}가 nvm에 없어서 지금 node로 실행해요`) : '';
    if (!c){
      done({ ask: {
        question: `${name}에서 무엇을 실행할까요?`,
        hint: [answer !== '?' && want && want !== '-' && `${clip(want, 40)}은(는) 이 프로젝트에서 찾은 명령이 아니에요`, nodeHint].filter(Boolean).join(' · '),
        choices: commands.map((c, i) => ({ value: c.install ? c.command : `cmd=${c.command}`, label: c.command, hint: c.install ? '패키지 설치' : c.gradle ? 'Spring Boot' : clip(c.script, 100), recommended: i === 0 })), inline: true
      } });
    }
    if (c.install) await launch(dir, c, null, extra);
    const remember = () => { try { writeState(dir, { ...(readJSON(statePath(dir)) || {}), cwd: dir, pick: c.command }); } catch {} };
    const askPort = async (hint, busy) => {
      remember();
      const free = await suggestPort(null, c.gradle, [...avoid, ...(busy ? [busy.port] : [])]), choices = [];
      if (busy && busy.owner && !busy.owner.mine) choices.push({ value: `kill=${busy.port}|${busy.owner.pid}|${c.command}`, label: `${busy.owner.name} 끄고 ${busy.port}번으로`, hint: clip(busy.owner.command, 100),
        confirm: `${busy.port}번을 쓰는 ${busy.owner.name}(PID ${busy.owner.pid})을(를) 끌까요? 저장하지 않은 작업이 있으면 사라져요` });
      if (!busy && s.last_port && !avoid.includes(s.last_port) && s.last_port !== free && await portFree(s.last_port)) choices.push({ value: `run=${s.last_port}|${c.command}`, label: `${s.last_port}번으로`, hint: '지난번에 쓴 포트' });
      choices.push({ value: `run=${free}|${c.command}`, label: `${free}번으로`, hint: '비어 있는 포트', recommended: true });
      done({ ask: { question: busy ? `${busy.port}번을 이미 쓰고 있어요` : `${c.command}을(를) 몇 번 포트로 띄울까요?`, hint: [hint, nodeHint].filter(Boolean).join(' · '), choices, free: true, placeholder: String(free), inline: true } });
    };
    const check = async (port, why) => {
      if (avoid.includes(port)) await askPort(`${port}번은 domain-proxy가 듣는 포트예요. 다른 포트를 골라 주세요`);
      if (await portFree(port)) return port;
      const owner = portOwner(port);
      await askPort(owner ? `${why}${port}번을 ${owner.name}(PID ${owner.pid})이(가) 쓰고 있어요${owner.mine ? ' — pkm이 쓰는 포트라 끌 수 없어요' : owner.proxy ? ' — domain-proxy예요' : ''}` : `${why}${port}번이 비어 있지 않아요`, { port, owner });
    };
    if (mode === 'cmd') await askPort('');
    let port;
    if (mode === 'run' || mode === 'kill' || typed != null){
      port = Number(typed ?? parts[0]);
      if (!(port >= 1 && port <= 65535)) await askPort(`"${clip(answer, 20)}"는 포트 번호가 아니에요. 1~65535 사이 숫자로 적어 주세요`);
      if (mode === 'kill'){ try { await freeUp(port, Number(parts[1]) || 0); } catch (e) { await askPort(e.message); } }
      port = await check(port, '');
    } else {
      const fixed = Number(opt.port), last = s.last_port;
      const first = fixed > 0 && fixed < 65536 && !avoid.includes(fixed) ? [fixed, ''] : last && !avoid.includes(last) ? [last, '지난번 포트 '] : null;
      port = first ? await check(first[0], first[1]) : await suggestPort(null, c.gradle, avoid);
    }
    await launch(dir, c, port, extra, async name => {
      if (!/^EADDRINUSE/.test(name)) return;
      const p = Number((name.match(/(\d+)번/) || [])[1]) || port;   // 스크립트에 박힌 다른 포트일 수 있다
      await askPort(`띄웠더니 ${name}${p !== port ? ` — 스크립트가 ${port}번 대신 ${p}번을 열려고 해요` : ''}`, { port: p, owner: portOwner(p) });
    });
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

  failWith('명령은 up, pick, start, stop, status, detect예요');
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main();
