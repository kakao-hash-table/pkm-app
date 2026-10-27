#!/usr/bin/env node
// 프로젝트 목록 — 설정의 폴더(한 줄에 하나, "폴더/*"는 그 아래 폴더 모두)를 피드 항목으로. 결과는 JSON 한 줄.
//   node projects.mjs list --projects=$'~/code/*\n~/work/site'
// 항목: 실행 중인지와 주소, 찾은 실행 명령, node 버전(.nvmrc), git 브랜치.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

const branch = d => { try { return execFileSync('git', ['-C', d, 'symbolic-ref', '--short', '-q', 'HEAD'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

export function item(d){
  const s = status(d), main = detect(d).commands.find(c => !c.install), node = nodeFor(d), name = path.basename(d);
  return {
    id: d, title: name, url: s.url,
    meta: [s.running ? (s.url ? `실행 중 · ${s.url}` : '실행 중') : '멈춤', main && main.command, node && (node.version ? `node ${node.version}` : `node ${node.want} (nvm에 없음)`), branch(d)].filter(Boolean),
    tags: s.running ? ['실행 중'] : [],
    vars: { path: d, name, ...(s.url ? { url: s.url } : {}) }
  };
}

function main(){
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
  const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
  if (cmd !== 'list') done({ error: '명령은 list예요' }, 1);
  const { dirs, missing } = expand(opt.projects);
  const note = missing.length ? `찾지 못한 폴더: ${missing.join(', ')}` : !dirs.length && !String(opt.projects || '').trim() ? '플러그인 설정의 "프로젝트"에 폴더를 적어 주세요' : undefined;
  done({ items: dirs.map(item), ...(note ? { note } : {}) });
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main();
