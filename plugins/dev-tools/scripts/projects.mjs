#!/usr/bin/env node
// 프로젝트 목록 — 설정의 폴더(한 줄에 하나, "폴더/*"는 그 아래 폴더 모두)와 FE 프로젝트 노트의 로컬 폴더를 피드 항목으로. 결과는 JSON 한 줄.
//   node projects.mjs list --projects=$'~/code/*\n~/work/site' [--fe="FE 프로젝트"] [--profile=<프로필 폴더>] [--proxy=<domain-proxy.js>]
// 항목: 실행 중인지와 주소, 띄울 명령, 띄울 포트와 그 까닭, node 버전(.nvmrc), git 브랜치. 노트가 있으면 배포·브랜치 전략 한 줄.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
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

// 설정 줄 → 프로젝트 폴더(절대 경로). "폴더/*"는 그 바로 아래 폴더(링크 포함, 점으로 시작하는 것 빼고)
export function expand(lines){
  const dirs = [], missing = [];
  for (const l of String(lines || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))){
    if (/\/\*$/.test(l)){
      const parent = path.resolve(home(l.slice(0, -2)));
      if (!isDir(parent)){ missing.push(l); continue; }
      for (const n of fs.readdirSync(parent).filter(n => !n.startsWith('.')).sort((a, b) => a.localeCompare(b))) if (isDir(path.join(parent, n))) dirs.push(path.join(parent, n));
    } else {
      const d = path.resolve(home(l));
      if (isDir(d)) dirs.push(d); else missing.push(l);
    }
  }
  return { dirs: [...new Set(dirs)].slice(0, 200), missing };
}

// FE 프로젝트 노트(<프로필>/01_지식/맥락노트/<묶음>/*.md, fe-projects 플러그인이 만든다)의 "- 키: 값" 줄 → 로컬 폴더별 { 레포, 실행, 배포, 브랜치 }
const here = path.dirname(fileURLToPath(import.meta.url));
export function feNotes(group, profile){
  if (!String(group || '').trim()) return {};
  const dir = path.join(profile ? path.resolve(home(profile)) : path.resolve(here, '..', '..', '..'), '01_지식', '맥락노트', String(group).replace(/[\\/:*?"<>|]/g, ' ').trim()), out = {};
  let names = []; try { names = fs.readdirSync(dir).filter(n => n.endsWith('.md') && !n.startsWith('.')).sort(); } catch {}
  for (const n of names){
    const f = {};
    for (const l of fs.readFileSync(path.join(dir, n), 'utf8').split('\n')){ const m = l.match(/^- (레포|로컬|실행|배포|브랜치): ?(.*)$/); if (m && !(m[1] in f)) f[m[1]] = m[2].trim(); }
    const d = f.로컬 && path.resolve(home(f.로컬));
    if (d && isDir(d) && !out[d]) out[d] = f;
  }
  return out;
}
const short = (s, n = 40) => { s = String(s || '').replace(/`/g, '').split(/ · | — /)[0].trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// 노트 실행 줄의 "포트 8090" — 띄울 때 먼저 쓸 포트
export const portOf = note => { const p = Number((String(note && note.실행 || '').match(/포트\s*(\d{2,5})\b/) || [])[1]); return p > 0 && p < 65536 ? p : null; };

// 띄울 명령: 마지막 선택 → 노트의 실행 명령(찾은 명령일 때만) → 찾은 첫 명령
export function preferred(d, note){
  const want = (String(note && note.실행 || '').match(/`([^`]+)`/) || [])[1], cmds = detect(d, want).commands.filter(c => !c.install);
  const st = readJSON(statePath(d)) || {}, last = st.cwd === d ? String(st.selected || st.command || '') : '';
  return cmds.find(c => c.command === last) || cmds.slice().sort((a, b) => b.command.length - a.command.length).find(c => last.startsWith(c.command + ' ')) || (want && cmds.find(c => c.command === want)) || cmds[0] || null;
}

// domain-proxy.js의 PROXY_PORT와 ROUTES(도메인 → 로컬 포트). 없거나 못 읽으면 비운다 — domain-proxy.mjs의 readProxy와 같은 블록을 읽는다
export function proxyRoutes(file){
  let text = ''; try { text = fs.readFileSync(path.resolve(home(file)), 'utf8'); } catch { return { port: null, routes: [] }; }
  const port = Number((text.match(/^const PROXY_PORT\s*=\s*(\d+)/m) || [])[1]) || 8080;
  const head = text.match(/^const ROUTES\s*=\s*\[/m);
  if (!head) return { port, routes: [] };
  let depth = 0, quote = '', i = head.index + head[0].length - 1;
  for (const open = i; i < text.length; i++){
    const ch = text[i];
    if (quote){ if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && text[i + 1] === '/'){ i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && text[i + 1] === '*'){ i = text.indexOf('*/', i + 2) + 1; if (i <= 0) break; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') quote = ch;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0){
      try { const list = vm.runInNewContext(`(${text.slice(open, i + 1)})`, Object.create(null), { timeout: 200 });
        return { port, routes: (Array.isArray(list) ? [...list] : []).map(r => ({ base: String(r && r.base || ''), port: Number(r && r.port) || null })).filter(r => r.base && r.port) }; }
      catch { break; }
    }
  }
  return { port, routes: [] };
}
// 이름이 닮은 도메인(place ↔ place-hash.fedev…). 이름이 똑같은 다른 프로젝트가 있는 도메인은 앞부분만 닮은 프로젝트(place-phocus)에 권하지 않는다
const nameKey = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
export function routeFor(name, routes, names = []){
  const key = nameKey(name), taken = new Set(names.map(nameKey));
  const keyed = routes.map(r => ({ ...r, key: nameKey(r.base.split('.')[0].replace(/-hash$/, '')) }));
  return keyed.find(r => r.key === key) || keyed.find(r => !taken.has(r.key) && Math.min(r.key.length, key.length) >= 5 && (r.key.startsWith(key) || key.startsWith(r.key))) || null;
}
// 띄울 포트: 마지막 선택 → 노트의 "포트 N" → 기존 웹 → 닮은 도메인 → 비움(실행할 때 빈 포트). 프록시 포트는 쓰지 않는다
export function portPlan(d, note, proxy = { port: null, routes: [] }, names = [], legacy = {}){
  const ok = p => Number.isInteger(p) && p > 0 && p < 65536 && p !== proxy.port;
  const st = readJSON(statePath(d)) || {}, last = st.cwd === d ? Number(st.port) || null : null, route = routeFor(path.basename(d), proxy.routes, names);
  if (ok(last)) return { port: last, why: '지난번' };
  if (ok(portOf(note))) return { port: portOf(note), why: '노트' };
  const old = legacy[d]; if (ok(old)) return { port: old, why: '기존 웹' };
  if (route && ok(route.port)) return { port: route.port, why: route.base.split('.')[0] };
  return { port: null, why: '' };
}

// 기존 웹 설정은 읽기만 한다. ~/cc 별칭(mw, ranking 등)도 실제 경로로 맞춘다.
export function legacyPorts(file){
  const out = {}, data = readJSON(home(file));
  const real = d => { try { return fs.realpathSync(d); } catch { return d; } };
  for (const [name, port] of Object.entries(data && typeof data === 'object' ? data : {})){
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[\w.-]+$/.test(name)) continue;
    out[real(path.join(os.homedir(), 'cc', name))] = port;
  }
  return out;
}
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

const readLog = d => { try { return fs.readFileSync(logPath(d), 'utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').slice(-5000); } catch { return ''; } };

// 지금 듣고 있는 포트 → { pid, name } — 목록 한 번에 lsof 한 번
export function listening(){
  const out = lsof(['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcgn']) || '', map = new Map(), mine = new Map();
  // 개발 도구로 띄운 프로젝트(상태 파일의 pid = 프로세스 그룹)는 프로젝트 이름으로
  try { for (const n of fs.readdirSync(stateDir()).filter(n => n.endsWith('.json') && !n.startsWith('.'))){ const st = readJSON(path.join(stateDir(), n)); if (st && st.pid && st.cwd) mine.set(st.pid, path.basename(st.cwd)); } } catch {}
  let pid = 0, pgid = 0, name = '';
  for (const l of out.split('\n')){
    if (l[0] === 'p') pid = Number(l.slice(1)); else if (l[0] === 'g') pgid = Number(l.slice(1)); else if (l[0] === 'c') name = l.slice(1);
    else if (l[0] === 'n'){ const port = Number((l.match(/:(\d+)$/) || [])[1]); if (port && !map.has(port)) map.set(port, { pid, name: mine.get(pgid) || name }); }
  }
  return map;
}

const branch = d => { try { return execFileSync('git', ['-C', d, 'symbolic-ref', '--short', '-q', 'HEAD'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

export function item(d, note, proxy = { port: null, routes: [] }, names = [], busy = new Map(), legacy = {}){
  const saved = readJSON(statePath(d)) || {}, log = readLog(d);
  const s = status(d), main = preferred(d, note), node = nodeFor(d), name = path.basename(d), want = portPlan(d, note, proxy, names, legacy);
  const plan = note ? [note.브랜치 && `브랜치 ${short(note.브랜치)}`, note.배포 && `배포 ${short(note.배포)}`].filter(Boolean).join(' · ') : '';
  return {
    id: d, title: name, url: s.url,
    meta: [s.running ? (s.url ? `실행 중 · ${s.url}` : '실행 중') : '멈춤', main && main.command, !s.running && want.port && (busy.get(want.port) ? `포트 ${want.port} 사용 중 · ${busy.get(want.port).name}(PID ${busy.get(want.port).pid})` : `포트 ${want.port}(${want.why})`),
      node && (node.version ? `node ${node.version}${node.version !== node.want && node.want.split('.').length > 1 ? `(.nvmrc ${node.want})` : ''}` : `node ${node.want} (nvm에 없음)`), branch(d)].filter(Boolean),
    tags: s.running ? ['실행 중'] : !s.running && want.port && busy.get(want.port) ? ['포트 사용 중'] : [],
    detail: plan ? [{ text: plan }] : [],
    // command는 비우지 않는다 — 찾은 명령이 없으면 띄우기가 그렇다고 알린다
    vars: { project: JSON.stringify({ running: s.running, pid: s.pid, pm: detect(d).pm, node, branch: branch(d), route: routeFor(name, proxy.routes, names), why: want.why, commands: detect(d, main && main.command).commands.slice(0, 40).map(c => ({ command: c.command.slice(0, 1000), script: c.script.slice(0, 300), install: c.install })), error: saved.cwd === d ? saved.error || (!s.running && saved.pid && !saved.stoppedAt ? errorName(log) || '실행이 종료됐어요. 실행 로그를 확인해 주세요' : '') : '', started: s.started }), log, busy: JSON.stringify([...busy].map(([port, o]) => ({ port, ...o }))), pid: '', path: d, name, command: main ? main.command : '-', port: want.port ? String(want.port) : '', avoid: proxy.port ? String(proxy.port) : '', ...(s.url ? { url: s.url } : {}) }
  };
}

function main(){
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
  // 큰 목록도 파이프에 끝까지 쓴 뒤 종료한다(process.exit를 바로 부르면 64KB 부근에서 잘릴 수 있다).
  const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n', () => process.exit(code)); };
  if (cmd !== 'list') return done({ error: '명령은 list예요' }, 1);
  const { dirs, missing } = expand(opt.projects), fe = feNotes(opt.fe, opt.profile);
  const all = [...new Set([...dirs, ...Object.keys(fe)])].slice(0, 200);
  const note = missing.length ? `찾지 못한 폴더: ${missing.join(', ')}` : !all.length ? '플러그인 설정의 "프로젝트"에 폴더를 적거나, FE 프로젝트 관리 플러그인으로 레포 노트를 만들어 주세요' : undefined;
  const legacy = legacyPorts(opt.legacy);
  const proxy = proxyRoutes(opt.proxy), names = all.map(d => path.basename(d));
  const busy = listening();
  done({ items: all.map(d => item(d, fe[d], proxy, names, busy, legacy)), ...(note ? { note } : {}) });
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main();
