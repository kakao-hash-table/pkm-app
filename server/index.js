// PKM 로컬 서버 — 화면(web/)을 내보내고, 데이터 폴더(PKM_DATA, 기본 ./data)의 <프로필>/ 마크다운을 읽고 쓴다. 의존성 없음.
//   PKM_DATA=../my-notes PORT=5270 HOST=127.0.0.1 node server/index.js
// 데이터는 앱 저장소 밖(별도 저장소)에 두는 것을 권한다 — 앱을 공유·업데이트해도 노트가 섞이지 않는다.
// 서버를 켤 때 templates/ 를 각 프로필의 _템플릿/ 에 맞춘다(같은 이름만 덮어쓰고, 프로필이 만든 기록 종류 템플릿은 그대로).
// 저장 위치가 github 인 프로필(_설정.md 의 storage)은 저장 뒤 자동으로 git 커밋·푸시하고, 2분마다 받아 온다.
// GET  /api/profiles                     프로필 목록
// POST /api/profiles {name}              새 프로필(폴더 뼈대 + 템플릿)
// GET  /api/profile/:p                   { files: {경로: 마크다운}, version }
// GET  /api/profile/:p/version           { version } — 바깥(Obsidian·git)에서 바뀌었는지 보려고 자주 부른다
// POST /api/profile/:p/save {writes, deletes}   쓰고 지운다(지운 파일은 .trash/ 로)
// GET  /api/profile/:p/sync              git 동기화 상태
// POST /api/profile/:p/sync              지금 동기화
import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.PKM_DATA ? path.resolve(process.env.PKM_DATA) : path.join(ROOT, 'data');
const TEMPLATES = process.env.PKM_TEMPLATES ? path.resolve(process.env.PKM_TEMPLATES) : path.join(ROOT, 'templates');
const WEB = path.join(ROOT, 'web');
const PORT = Number(process.env.PORT || 5270);
const HOST = process.env.HOST || '127.0.0.1';
const MD = createRequire(import.meta.url)('../web/js/pkm-md.js');
const run = promisify(execFile);

/* ---------- 안전한 경로 ---------- */
const validProfile = n => typeof n === 'string' && n.length > 0 && n.length <= 60 && !/[\\/:]/.test(n) && !n.startsWith('_') && !n.startsWith('.') && n !== '..';
function inProfile(profile, rel){
  if (typeof rel !== 'string' || !rel.endsWith('.md') || rel.startsWith('/') || rel.split('/').some(s => s === '..' || s === '' || s.startsWith('.git'))) return null;
  const dir = path.join(DATA, profile), abs = path.resolve(dir, rel);
  return abs.startsWith(dir + path.sep) ? abs : null;
}

/* ---------- 프로필 읽기·쓰기 ---------- */
async function listProfiles(){
  const ents = await fs.readdir(DATA, { withFileTypes:true }).catch(() => []);
  const out = [];
  for (const e of ents) if (e.isDirectory() && validProfile(e.name)) out.push({ name:e.name, storage:(await settingsOf(e.name)).storage || 'device' });
  return out;
}
async function walk(dir, base = ''){
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes:true }).catch(() => [])){
    if (e.name.startsWith('.')) continue;            // .trash · .obsidian · .gitkeep 은 건너뛴다
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await walk(path.join(dir, e.name), rel));
    else if (e.name.endsWith('.md')) out.push(rel);
  }
  return out;
}
async function readProfile(p){
  const dir = path.join(DATA, p), files = {};
  for (const rel of await walk(dir)) files[rel] = await fs.readFile(path.join(dir, rel), 'utf8');
  return { files, version:await versionOf(p) };
}
async function versionOf(p){
  const dir = path.join(DATA, p); let acc = '';
  for (const rel of (await walk(dir)).sort()){ const st = await fs.stat(path.join(dir, rel)).catch(() => null); if (st) acc += `${rel}:${st.size}:${Math.floor(st.mtimeMs)}|`; }
  let h = 0; for (let i = 0; i < acc.length; i++) h = (h * 31 + acc.charCodeAt(i)) | 0;
  return `${acc.length}-${(h >>> 0).toString(36)}`;
}
async function settingsOf(p){
  try { return MD.parseDoc(await fs.readFile(path.join(DATA, p, MD.SETTINGS), 'utf8')).fm || {}; } catch { return {}; }
}
async function save(p, { writes = {}, deletes = [] }){
  const dir = path.join(DATA, p);
  for (const [rel, text] of Object.entries(writes)){
    const abs = inProfile(p, rel); if (!abs) throw Object.assign(new Error(`쓸 수 없는 경로: ${rel}`), { status:400 });
    await fs.mkdir(path.dirname(abs), { recursive:true });
    const tmp = `${abs}.${process.pid}.tmp`;
    await fs.writeFile(tmp, String(text)); await fs.rename(tmp, abs);   // 반쯤 쓴 파일이 남지 않게
  }
  for (const rel of deletes){
    const abs = inProfile(p, rel); if (!abs || !fss.existsSync(abs)) continue;
    let to = path.join(dir, '.trash', rel);
    if (fss.existsSync(to)) to = to.replace(/\.md$/, ` ${Date.now()}.md`);
    await fs.mkdir(path.dirname(to), { recursive:true }); await fs.rename(abs, to);
  }
  if ((await settingsOf(p)).storage === 'github') scheduleSync(p);
  return { version:await versionOf(p) };
}
async function createProfile(name){
  if (!validProfile(name)) throw Object.assign(new Error('프로필 이름으로 쓸 수 없어요'), { status:400 });
  const dir = path.join(DATA, name);
  if (fss.existsSync(dir)) throw Object.assign(new Error('이미 있는 프로필이에요'), { status:409 });
  const folders = Object.values(MD.DEFAULT_FOLDERS).filter(f => f !== '_템플릿').concat(['01_지식/참조노트/책', '01_지식/참조노트/아티클', '01_지식/참조노트/영상', '02_시간/회의록']);
  for (const f of folders){ await fs.mkdir(path.join(dir, f), { recursive:true }); await fs.writeFile(path.join(dir, f, '.gitkeep'), ''); }
  await fs.mkdir(path.join(dir, '_템플릿'), { recursive:true });
  await syncTemplates(name);
  const db = MD.emptyDb(); db.kinds = [{ id:'meeting', name:'회의록', fields:[['agenda', '안건'], ['talk', '논의'], ['decisions', '결정']], people:true, todos:true }];
  const settings = MD.serialize({ db, settings:{ storage:'device', onboarded:false } })[MD.SETTINGS];
  await fs.writeFile(path.join(dir, MD.SETTINGS), settings);
  return { name };
}

/* ---------- 템플릿: 앱이 원본, 프로필의 _템플릿/ 은 복사본 ---------- */
async function syncTemplates(p){
  const to = path.join(DATA, p, '_템플릿'); let changed = 0;
  await fs.mkdir(to, { recursive:true });
  for (const t of await fs.readdir(TEMPLATES).catch(() => [])){
    if (!t.endsWith('.md')) continue;
    const src = await fs.readFile(path.join(TEMPLATES, t), 'utf8'), dst = path.join(to, t);
    if (await fs.readFile(dst, 'utf8').catch(() => null) !== src){ await fs.writeFile(dst, src); changed++; }
  }
  return changed;
}

/* ---------- git 동기화 (storage: github 프로필만) ---------- */
const SYNC = {};   // 프로필 → { state, at, error, timer }
const git = (...args) => run('git', ['-C', DATA, ...args], { timeout:60000 });   // data 폴더가 들어 있는 저장소에서
function scheduleSync(p, ms = 8000){
  const s = SYNC[p] || (SYNC[p] = { state:'idle' });
  clearTimeout(s.timer); s.state = 'pending';
  s.timer = setTimeout(() => syncNow(p).catch(() => {}), ms);
}
async function syncNow(p){
  const s = SYNC[p] || (SYNC[p] = { state:'idle' });
  if (s.running) return s;
  s.running = true; s.state = 'syncing';
  const rel = p;   // DATA 기준 경로
  try {
    await git('add', '-A', '--', rel, `:(exclude)${rel}/.trash`);
    const staged = await git('diff', '--cached', '--name-only', '--', rel);
    if (staged.stdout.trim()) await git('commit', '-m', `pkm(${p}): 자동 저장 ${new Date().toLocaleString('ko-KR', { hour12:false })}`, '--', rel);
    const branch = (await git('rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim();
    await git('pull', '--rebase', '--autostash', 'origin', branch);
    await git('push', 'origin', `HEAD:${branch}`);
    Object.assign(s, { state:'ok', at:new Date().toISOString(), error:null });
  } catch (e) {
    Object.assign(s, { state:'error', at:new Date().toISOString(), error:String(e.stderr || e.message).trim().split('\n').slice(-2).join(' ') });
  } finally { s.running = false; }
  return s;
}
setInterval(async () => {   // 다른 기기에서 올린 것을 받아 온다
  for (const pr of await listProfiles()) if (pr.storage === 'github' && !(SYNC[pr.name] || {}).running) syncNow(pr.name).catch(() => {});
}, 120000).unref();

/* ---------- (선택) 허브로 돌아가는 줄 ---------- */
// PKM_HUB_LINK 에 withHubLink(html, req) 를 내보내는 모듈 경로를 주면, 여러 사이트를 모아 보는 허브로 돌아가는 줄을 맨 위에 붙인다(선택).
let withHubLink = null;
if (process.env.PKM_HUB_LINK && fss.existsSync(process.env.PKM_HUB_LINK)) withHubLink = (await import(pathToFileURL(path.resolve(process.env.PKM_HUB_LINK)).href)).withHubLink;

/* ---------- HTTP ---------- */
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json', '.ico':'image/x-icon' };
const SEC = { 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer', 'content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.github.com; frame-ancestors 'none'" };
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type':type, 'cache-control':'no-store', ...SEC }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
async function body(req){ let s = ''; for await (const c of req){ s += c; if (s.length > 20e6) throw Object.assign(new Error('너무 커요'), { status:413 }); } return s ? JSON.parse(s) : {}; }

async function api(req, res, url){
  const parts = url.pathname.split('/').slice(2).map(decodeURIComponent);   // ['profiles'] · ['profile', p, ...]
  if (parts[0] === 'profiles'){
    if (req.method === 'GET') return send(res, 200, { profiles:await listProfiles() });
    if (req.method === 'POST') return send(res, 201, await createProfile(String((await body(req)).name || '').trim()));
  }
  if (parts[0] === 'profile' && validProfile(parts[1]) && fss.existsSync(path.join(DATA, parts[1]))){
    const p = parts[1], sub = parts[2] || '';
    if (req.method === 'GET' && !sub) return send(res, 200, await readProfile(p));
    if (req.method === 'GET' && sub === 'version') return send(res, 200, { version:await versionOf(p), sync:SYNC[p] ? { state:SYNC[p].state, at:SYNC[p].at, error:SYNC[p].error } : null });
    if (req.method === 'POST' && sub === 'save') return send(res, 200, await save(p, await body(req)));
    if (sub === 'sync'){
      if (req.method === 'POST'){ const s = await syncNow(p); return send(res, 200, { state:s.state, at:s.at, error:s.error }); }
      const s = SYNC[p] || {}; return send(res, 200, { storage:(await settingsOf(p)).storage || 'device', state:s.state || 'idle', at:s.at || null, error:s.error || null });
    }
  }
  send(res, 404, { error:'없는 경로예요' });
}
async function statics(req, res, url){
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.resolve(WEB, '.' + rel);
  if (!abs.startsWith(WEB + path.sep) || !fss.existsSync(abs) || fss.statSync(abs).isDirectory()) return send(res, 404, 'not found', 'text/plain; charset=utf-8');
  let data = await fs.readFile(abs);
  if (abs.endsWith('index.html')){
    let html = data.toString('utf8').replace('<html lang="ko"', '<html lang="ko" data-server="1"');
    if (withHubLink) html = withHubLink(html, req, { inset:'16px' });
    data = html;
  }
  send(res, 200, data, TYPES[path.extname(abs)] || 'application/octet-stream');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET') await statics(req, res, url);
    else send(res, 405, { error:'허용하지 않는 방법이에요' });
  } catch (e) {
    send(res, e.status || 500, { error:e.message || '서버 오류' });
  }
});
if (process.argv[1] === fileURLToPath(import.meta.url)){
  for (const pr of await listProfiles()){ const n = await syncTemplates(pr.name); if (n) console.log(`${pr.name}: 템플릿 ${n}개를 앱 템플릿에 맞췄어요`); }
  server.listen(PORT, HOST, () => console.log(`PKM: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/  (데이터: ${DATA})`));
}
export { server, readProfile, save, createProfile, listProfiles, versionOf, inProfile, syncTemplates, syncNow as syncNowForTest };
