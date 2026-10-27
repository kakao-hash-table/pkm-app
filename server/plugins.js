// 플러그인 가져오기·설치 — 규격은 docs/PLUGIN.md, 검사는 web/js/pkm-plugin.js(화면과 같은 코드).
// 가져오기(inspect): git(https)은 얕게 받고, 로컬 폴더는 복사해 임시 폴더에서 검사한다. 아무것도 설치하지 않는다.
// 설치(install): 검사를 통과한 파일만 <프로필>/_플러그인/<id>/ 로. 같은 id가 있으면 이전 것은 .trash/로.
// 업데이트(updates·inspectUpdate): 설치 기록의 출처(앱에 들어 있는 플러그인·로컬 폴더·git)를 다시 읽어 설치한 파일 해시와 견준다.
//   앱 내장과 로컬 폴더는 목록을 볼 때마다 견주고, git은 네트워크가 필요해서 사람이 누를 때만 받아 본다. 설치는 install()을 그대로 쓴다.
// 스크립트 실행 승인은 여기서 하지 않는다 — 실행하는 컴퓨터의 pkm-ai-server가 파일 해시로 승인한다.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const run = promisify(execFile);
const P = createRequire(import.meta.url)('../web/js/pkm-plugin.js');
const STAGES = new Map();   // 가져온 것 → 30분 안에 설치하지 않으면 지운다
const TTL = 30 * 60000;
const INSTALL = '.pkm-install.json';
const APP_PLUGINS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'plugins');   // 앱에 들어 있는 플러그인
const fail = (status, message) => Object.assign(new Error(message), { status });
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const textual = p => P.DOC_EXT.test(p) || P.SCRIPT_EXT.test(p);

async function walk(dir, base = dir, out = []){
  for (const e of await fs.readdir(dir, { withFileTypes: true })){
    const abs = path.join(dir, e.name), rel = path.relative(base, abs).split(path.sep).join('/');
    if (P.ignored(rel + (e.isDirectory() ? '/' : ''))) continue;
    if (e.isSymbolicLink()) throw fail(400, `링크 파일은 받지 않아요: ${rel}`);
    if (e.isDirectory()) await walk(abs, base, out);
    else if (e.isFile()) out.push({ path: rel, abs, size: (await fs.stat(abs)).size });
    if (out.length > P.LIMITS.files + 1) break;
  }
  return out;
}

async function readAll(dir){
  const files = await walk(dir);
  for (const f of files){
    if (f.size > P.LIMITS.file) continue;
    const buf = await fs.readFile(f.abs);
    f.sha256 = sha256(buf);
    if (textual(f.path)) f.text = buf.toString('utf8');
  }
  return files;
}

function sweep(){
  for (const [id, st] of STAGES) if (Date.now() - st.at > TTL){ STAGES.delete(id); fs.rm(st.dir, { recursive: true, force: true }).catch(() => {}); }
}

// 앱에 들어 있는 플러그인(plugins/*) — 화면에서 주소 없이 고를 수 있게 이름과 설명만
export async function bundled(dir){
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])){
    if (!e.isDirectory()) continue;
    const f = path.join(dir, e.name, 'plugin.md'); if (!fss.existsSync(f)) continue;
    const r = P.validate([{ path: 'plugin.md', size: 1, text: await fs.readFile(f, 'utf8') }]);
    if (r.manifest && r.manifest.id) out.push({ path: path.join(dir, e.name), id: r.manifest.id, name: r.manifest.name, version: r.manifest.version, description: r.manifest.description });
  }
  return out;
}

export async function inspect({ git, ref, local }, appDir = APP_PLUGINS){
  sweep();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pkm-plugin-'));
  try {
    let source, commit = null;
    if (git){
      if (!/^https:\/\/[\w.-]+(:\d+)?\/[\w.~/-]+$/.test(git)) throw fail(400, 'git 주소는 https://로 시작하는 저장소 주소여야 해요');
      if (ref && !/^[\w./-]{1,100}$/.test(ref)) throw fail(400, '브랜치·태그 이름 형식이 맞지 않아요');
      try {
        await run('git', ['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), '--', git, dir], { timeout: 90000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      } catch (e) { throw fail(400, `받아 오지 못했어요 — ${String(e.stderr || e.message).trim().split('\n').pop()}`); }
      commit = (await run('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim();
      source = { type: 'git', url: git, ref: ref || null };
    } else if (local){
      local = String(local).trim().replace(/^~(?=\/|$)/, os.homedir());
      if (!path.isAbsolute(local) || !fss.existsSync(local) || !fss.statSync(local).isDirectory()) throw fail(400, `폴더가 없거나 절대 경로가 아니에요: ${local}`);
      await fs.cp(local, dir, { recursive: true, filter: src => !/(^|[/\\])(\.git|node_modules)([/\\]|$)/.test(path.relative(local, src)) });
      source = { type: 'local', path: path.resolve(local) };
    } else throw fail(400, 'git 주소나 폴더 경로를 알려 주세요');

    const files = await readAll(dir), result = P.validate(files);
    // 앱에 들어 있는 플러그인이면 이 컴퓨터의 경로가 아니라 '앱 내장 + id'로 기록한다 — 다른 컴퓨터·앱 위치에서도 업데이트를 찾게
    if (source.type === 'local' && result.manifest && path.dirname(source.path) === path.resolve(appDir)) source = { type: 'bundled', id: result.manifest.id, path: source.path };
    const stage = crypto.randomBytes(8).toString('hex');
    STAGES.set(stage, { dir, at: Date.now(), result, source, commit, files });
    const hashOf = p => (files.find(f => f.path === p) || {}).sha256 || null;
    return {
      stage, ok: result.ok, errors: result.errors, warnings: result.warnings, manifest: result.manifest, source, commit,
      workflows: result.workflows.map(w => ({ name: w.name, file: w.file, steps: w.steps })),
      feeds: result.feeds,
      files: files.map(f => ({ path: f.path, size: f.size, sha256: f.sha256 || null })),
      scripts: result.scripts.map(p => ({ path: p, sha256: hashOf(p), text: (files.find(f => f.path === p) || {}).text || '' }))
    };
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
}

export async function install(profileDir, stageId){
  const st = STAGES.get(stageId);
  if (!st) throw fail(404, '가져온 지 오래됐어요. 다시 가져와 주세요');
  if (!st.result.ok) throw fail(400, '검사를 통과하지 못한 플러그인은 설치할 수 없어요');
  const { id, version } = st.result.manifest;
  const base = path.join(profileDir, P.DIR), dest = path.join(base, id), tmp = path.join(base, `.${id}.new`);
  await fs.mkdir(base, { recursive: true });
  await fs.rm(tmp, { recursive: true, force: true });
  for (const f of st.files){   // 검사한 파일만 옮긴다
    const to = path.join(tmp, ...f.path.split('/'));
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(f.abs, to);
  }
  const record = { id, version, source: st.source, commit: st.commit, installed_at: new Date().toISOString(), files: Object.fromEntries(st.files.map(f => [f.path, f.sha256])) };
  await fs.writeFile(path.join(tmp, INSTALL), JSON.stringify(record, null, 2) + '\n');
  let previous = null;
  if (fss.existsSync(dest)){
    try { previous = JSON.parse(await fs.readFile(path.join(dest, INSTALL), 'utf8')).version || null; } catch {}
    const trash = path.join(profileDir, '.trash', P.DIR);
    await fs.mkdir(trash, { recursive: true });
    await fs.rename(dest, path.join(trash, `${id}-${Date.now()}`));
  }
  await fs.rename(tmp, dest);
  STAGES.delete(stageId); fs.rm(st.dir, { recursive: true, force: true }).catch(() => {});
  return { id, version, previous, path: dest, manifest: st.result.manifest };
}

export async function list(profileDir){
  const base = path.join(profileDir, P.DIR);
  if (!fss.existsSync(base)) return [];
  const out = [];
  for (const e of await fs.readdir(base, { withFileTypes: true })){
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = path.join(base, e.name);
    let rec = {}; try { rec = JSON.parse(await fs.readFile(path.join(dir, INSTALL), 'utf8')); } catch {}
    const files = await readAll(dir), r = P.validate(files);
    const changed = Object.entries(rec.files || {}).filter(([p, h]) => (files.find(f => f.path === p) || {}).sha256 !== h).map(([p]) => p);
    out.push({ id: e.name, path: dir, ok: r.ok, errors: r.errors, manifest: r.manifest, source: rec.source || null, commit: rec.commit || null,
      installed_at: rec.installed_at || null, changed, scripts: r.scripts.map(p => ({ path: p, sha256: (files.find(f => f.path === p) || {}).sha256 || null })) });
  }
  return out;
}

/* ---------- 업데이트 ---------- */
// 설치 기록의 출처를 지금 읽을 수 있는 곳으로: 앱 내장(같은 id) → 로컬 폴더 → git
async function sourceOf(rec, id, appDir){
  const s = rec.source || {};
  const inApp = (await bundled(appDir)).find(b => b.id === id);
  if (inApp && (s.type === 'bundled' || (s.type === 'local' && path.dirname(path.resolve(s.path || '')) === path.resolve(appDir)))) return { local: inApp.path, kind: 'bundled' };
  if (s.type === 'local' && s.path && fss.existsSync(s.path)) return { local: s.path, kind: 'local' };
  if (s.type === 'git' && s.url) return { git: s.url, ref: s.ref || null, kind: 'git' };
  return null;
}
function diffFiles(installed, files){
  const now = Object.fromEntries(files.map(f => [f.path, f.sha256]));
  const out = [];
  for (const [p, h] of Object.entries(now)) if (!(p in installed)) out.push({ path: p, kind: '새 파일' }); else if (installed[p] !== h) out.push({ path: p, kind: '바뀜' });
  for (const p of Object.keys(installed)) if (!(p in now)) out.push({ path: p, kind: '지움' });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
const recOf = async dir => { try { return JSON.parse(await fs.readFile(path.join(dir, INSTALL), 'utf8')); } catch { return {}; } };

// 설치한 플러그인마다 새 버전이 있는지 — { id: { kind, from, to, files:[…] } | { kind:'git', check:true } }. 같으면 넣지 않는다
export async function updates(profileDir, appDir = APP_PLUGINS){
  const base = path.join(profileDir, P.DIR), out = {};
  if (!fss.existsSync(base)) return out;
  for (const e of await fs.readdir(base, { withFileTypes: true })){
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const rec = await recOf(path.join(base, e.name)), src = await sourceOf(rec, e.name, appDir).catch(() => null);
    if (!src) continue;
    if (src.kind === 'git'){ out[e.name] = { kind: 'git', check: true, url: src.git }; continue; }
    try {
      const files = await readAll(src.local), files_ = diffFiles(rec.files || {}, files);
      if (!files_.length) continue;
      const mf = P.validate(files).manifest;
      out[e.name] = { kind: src.kind, from: rec.version || null, to: mf ? mf.version : null, files: files_ };
    } catch {}
  }
  return out;
}
// 업데이트할 것을 출처에서 다시 가져와 검사한다(설치는 하지 않음) — 화면은 이 결과로 검토 화면을 띄우고 install(stage)
export async function inspectUpdate(profileDir, id, appDir = APP_PLUGINS){
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) throw fail(400, 'id 형식이 맞지 않아요');
  const dir = path.join(profileDir, P.DIR, id);
  if (!fss.existsSync(dir)) throw fail(404, '설치된 플러그인이 아니에요');
  const rec = await recOf(dir), src = await sourceOf(rec, id, appDir);
  if (!src) throw fail(409, '어디서 설치했는지 기록이 없거나 그 폴더가 사라졌어요. 플러그인 더하기에서 다시 가져와 주세요');
  const r = await inspect(src.kind === 'git' ? { git: src.git, ref: src.ref } : { local: src.local }, appDir);
  if (r.manifest && r.manifest.id !== id){ STAGES.delete(r.stage); throw fail(409, `출처의 플러그인 id가 달라요(${r.manifest.id})`); }
  const st = STAGES.get(r.stage), changes = diffFiles(rec.files || {}, st ? st.files : []);
  return { ...r, update: { from: rec.version || null, to: r.manifest ? r.manifest.version : null, commit_from: rec.commit || null, changes } };
}

export async function remove(profileDir, id){
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) throw fail(400, 'id 형식이 맞지 않아요');
  const dest = path.join(profileDir, P.DIR, id);
  if (!fss.existsSync(dest)) throw fail(404, '설치된 플러그인이 아니에요');
  const trash = path.join(profileDir, '.trash', P.DIR);
  await fs.mkdir(trash, { recursive: true });
  await fs.rename(dest, path.join(trash, `${id}-${Date.now()}`));
  return { id };
}
