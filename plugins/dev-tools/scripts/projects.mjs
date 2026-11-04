#!/usr/bin/env node
// 프로젝트 목록 — 설정의 폴더(한 줄에 하나, "폴더/*"는 그 아래 폴더 모두)와 FE 프로젝트 노트의 로컬 폴더를 피드 항목으로. 결과는 JSON 한 줄.
//   node projects.mjs list --projects=$'~/code/*\n~/work/site' [--fe="FE 프로젝트"] [--profile=<프로필 폴더>]
// 항목: 실행 중인지와 주소, 띄울 명령, node 버전(.nvmrc), git 브랜치. 노트가 있으면 배포·브랜치 전략 한 줄.
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

// 띄울 명령: 노트의 실행 명령(이 프로젝트에서 찾은 명령일 때만) → 지난번에 띄운 명령 → 찾은 첫 명령
export function preferred(d, note){
  const want = (String(note && note.실행 || '').match(/`([^`]+)`/) || [])[1], cmds = detect(d, want).commands.filter(c => !c.install);
  const last = String((readJSON(statePath(d)) || {}).command || '');
  return (want && cmds.find(c => c.command === want)) || cmds.find(c => last === c.command || last.startsWith(c.command + ' ')) || cmds[0] || null;
}

const branch = d => { try { return execFileSync('git', ['-C', d, 'symbolic-ref', '--short', '-q', 'HEAD'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

export function item(d, note){
  const s = status(d), main = preferred(d, note), node = nodeFor(d), name = path.basename(d);
  const plan = note ? [note.브랜치 && `브랜치 ${short(note.브랜치)}`, note.배포 && `배포 ${short(note.배포)}`].filter(Boolean).join(' · ') : '';
  return {
    id: d, title: name, url: s.url,
    meta: [s.running ? (s.url ? `실행 중 · ${s.url}` : '실행 중') : '멈춤', main && main.command, node && (node.version ? `node ${node.version}` : `node ${node.want} (nvm에 없음)`), branch(d)].filter(Boolean),
    tags: s.running ? ['실행 중'] : [],
    detail: plan ? [{ text: plan }] : [],
    // command는 비우지 않는다 — 찾은 명령이 없으면 띄우기가 그렇다고 알린다
    vars: { path: d, name, command: main ? main.command : '-', port: portOf(note) ? String(portOf(note)) : '', ...(s.url ? { url: s.url } : {}) }
  };
}

function main(){
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
  const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
  if (cmd !== 'list') done({ error: '명령은 list예요' }, 1);
  const { dirs, missing } = expand(opt.projects), fe = feNotes(opt.fe, opt.profile);
  const all = [...new Set([...dirs, ...Object.keys(fe)])].slice(0, 200);
  const note = missing.length ? `찾지 못한 폴더: ${missing.join(', ')}` : !all.length ? '플러그인 설정의 "프로젝트"에 폴더를 적거나, FE 프로젝트 관리 플러그인으로 레포 노트를 만들어 주세요' : undefined;
  done({ items: all.map(d => item(d, fe[d])), ...(note ? { note } : {}) });
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main();
