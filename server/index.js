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
// POST /api/plugins/inspect {git, ref} | {local}   플러그인 가져와서 검사만(설치 안 함) → { stage, ok, errors, manifest, scripts… }
// GET  /api/plugins/bundled              앱에 들어 있는 플러그인(plugins/*)
// GET  /api/profile/:p/plugins            설치된 플러그인
// POST /api/profile/:p/plugins {stage}    검사한 플러그인을 이 프로필에 설치
// DELETE /api/profile/:p/plugins/:id      휴지통으로
// GET  /api/profile/:p/plugins/state      피드·실행 기록과 이 컴퓨터의 실행기 상태(server/runner.js)
// POST /api/profile/:p/runner {on, ai}     이 컴퓨터에서 돌리기 켜기·끄기, AI 연결 넣기
// GET  /api/profile/:p/plugins/:id/machine 이 컴퓨터의 승인·비밀값 상태     POST …/approve  승인     POST …/secret {name, value|null}
// POST /api/profile/:p/plugins/:id/local {settings, auto}   이 컴퓨터의 설정값     POST …/act {type, …}  새로 가져오기·시작·답하기·다시 하기·건너뛰기·그만두기
// GET  /api/profile/:p/plugins/:id/scripts  가져오는 스크립트 내용(승인 전에 보여 준다)
// POST /api/profile/:p/plugins/:id/search {name, q}   플러그인 검색 한 번(이 컴퓨터의 pkm-ai-server, 60초까지) → { items, note }
// GET  /api/profile/:p/gcal              구글 캘린더 연결 상태
// GET  /api/profile/:p/gcal/connect      구글 로그인으로 보낸다(302) — 돌아오는 곳은 /api/gcal/callback
// POST /api/profile/:p/gcal/sync         지금 맞추기 · POST …/gcal/disconnect 연결 끊기
// POST /api/gcal/client {client_id, client_secret}   내 구글 OAuth 클라이언트 등록(토큰과 함께 ~/.pkm-app/gcal.json, 데이터 폴더 밖)
// GET  /api/profile/:p/jobs               AI 예약 작업의 마지막 실행(이 컴퓨터) · POST …/jobs/:id/run  지금 돌리기(server/jobs.js)
// PKM_AI_CONNECT='https://ai.example.com'   AI 연결 서버 주소를 CSP connect-src에 더한다(기본: 127.0.0.1·localhost·*.ts.net)
import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as plugins from './plugins.js';
import * as textbook from './textbook.js';
import { createRunner } from './runner.js';
import { createJobs } from './jobs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.PKM_DATA ? path.resolve(process.env.PKM_DATA) : path.join(ROOT, 'data');
const TEMPLATES = process.env.PKM_TEMPLATES ? path.resolve(process.env.PKM_TEMPLATES) : path.join(ROOT, 'templates');
const WEB = path.join(ROOT, 'web');
const PORT = Number(process.env.PORT || 5270);
const HOST = process.env.HOST || '127.0.0.1';
const MD = createRequire(import.meta.url)('../web/js/pkm-md.js');
const run = promisify(execFile);
const { createGcal } = await import('./gcal.js');

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
// 읽기전용 노트(교과서 폴더 · 프런트매터 readonly: true)는 앱이 쓰거나 지우지 않는다 — 하나라도 있으면 아무것도 쓰기 전에 거절
async function readonlyIn(p, rels){
  const F = (await settingsOf(p)).folders || {}, tb = F.textbook || MD.DEFAULT_FOLDERS.textbook, cards = F.cards || MD.DEFAULT_FOLDERS.cards;
  for (const rel of rels){
    if (rel.startsWith(tb + '/') || rel.startsWith(cards + '/')) return rel;
    const abs = inProfile(p, rel); if (!abs || !fss.existsSync(abs)) continue;
    const head = (await fs.readFile(abs, 'utf8')).slice(0, 2000).match(/^---\n([\s\S]*?)\n---/);
    if (head && /^readonly:\s*true\s*(#.*)?$/m.test(head[1])) return rel;
  }
  return null;
}
async function save(p, { writes = {}, deletes = [] }, { fromGcal = false } = {}){
  const dir = path.join(DATA, p);
  const ro = await readonlyIn(p, [...Object.keys(writes), ...deletes]);
  if (ro) throw Object.assign(new Error(`읽기전용 노트라 앱에서 고칠 수 없어요: ${ro}`), { status:403 });
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
  if (!fromGcal) touchesAppointments(p, [...Object.keys(writes), ...deletes]).then(yes => yes && gcal.schedule(p)).catch(() => {});
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

/* ---------- 플러그인 실행기: 이 컴퓨터에서 돌리기를 켠 프로필만 ---------- */
const runner = createRunner({ DATA, listProfiles, onWrite:async p => { if ((await settingsOf(p)).storage === 'github') scheduleSync(p, 30000); } });
/* ---------- AI 예약 작업: 돌리는 컴퓨터가 정한 때에 AI에 맡기고 결과를 인박스로 ---------- */
const jobs = createJobs({ DATA, listProfiles, settingsOf, here:p => runner.here(p), onWrite:async p => { if ((await settingsOf(p)).storage === 'github') scheduleSync(p); } });

/* ---------- 교과서: 원본(Obsidian)이 정본, 바뀌면 다시 복제 ---------- */
// 책 폴더의 .source.json 이 가리키는 원본을 지켜본다. 놓친 변경은 5분마다 한 번 더 맞춘다.
const TB = {};   // 원본 경로 → { watcher, timer, profile, tbFolder }
const tbFolderOf = async p => ((await settingsOf(p)).folders || {}).textbook || MD.DEFAULT_FOLDERS.textbook;
async function syncTextbook(p, src, tbFolder, vault){
  const r = textbook.importBook(src, path.join(DATA, p), { tbFolder, vault });
  const n = r.added.length + r.changed.length + r.removed.length;
  if (n){
    console.log(`${p}: 교과서 「${r.book}」 원본에서 새 노트 ${r.added.length} · 바뀜 ${r.changed.length} · 사라짐 ${r.removed.length}`);
    if ((await settingsOf(p)).storage === 'github') scheduleSync(p);
  }
  return r;
}
async function syncTextbooks(){
  for (const { name:p } of await listProfiles()){
    const tbFolder = await tbFolderOf(p);
    for (const b of textbook.linkedBooks(path.join(DATA, p), tbFolder)){
      try { await syncTextbook(p, b.src, tbFolder, b.vault); } catch (e) { console.error(`${p}: 교과서 복제 실패 ${b.src}: ${e.message}`); }
      if (TB[b.src] || !fss.existsSync(b.src)) continue;
      const w = TB[b.src] = { profile:p };
      try {
        w.watcher = fss.watch(b.src, { recursive:true }, (ev, name) => {
          if (name && String(name).split('/').some(s => s.startsWith('.'))) return;
          clearTimeout(w.timer);   // 저장 한 번에 이벤트가 여러 번 온다 — 잠잠해지면 한 번만
          w.timer = setTimeout(() => syncTextbook(p, b.src, tbFolder, b.vault).catch(e => console.error(`${p}: 교과서 복제 실패 ${b.src}: ${e.message}`)), 1500);
        });
        w.watcher.unref();   // 지켜보는 것만으로 서버가 끝나지 못하게 붙잡지 않는다
        w.watcher.on('error', () => { w.watcher.close(); delete TB[b.src]; });   // 원본 폴더가 옮겨졌으면 다음 차례에 다시 찾는다
      } catch { delete TB[b.src]; }
    }
  }
}
/* ---------- 구글 캘린더 (server/gcal.js) ---------- */
// 돌아오는 주소는 이 서버의 실제 포트로 — 구글 "데스크톱 앱" 클라이언트는 127.0.0.1의 아무 포트나 받아 준다
const gcal = createGcal({
  MD, read:async p => (await readProfile(p)).files, write:(p, ch) => save(p, ch, { fromGcal:true }),
  redirectUri:() => `http://127.0.0.1:${server.address()?.port || PORT}/api/gcal/callback`, log:m => console.log(m),
});
async function touchesAppointments(p, rels){
  const folder = ((await settingsOf(p)).folders || {}).appointment || MD.DEFAULT_FOLDERS.appointment;
  return rels.some(r => r.startsWith(folder + '/'));
}
setInterval(() => { for (const p of gcal.connectedProfiles()) if (fss.existsSync(path.join(DATA, p))) gcal.sync(p).catch(() => {}); }, 120000).unref();
const page = (title, text) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 24px;color:#1b1d21"><h1 style="font-size:20px">${title}</h1><p>${text}</p></body>`;
const escHtml = v => String(v).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

/* ---------- (선택) 허브로 돌아가는 줄 ---------- */
// PKM_HUB_LINK 에 withHubLink(html, req) 를 내보내는 모듈 경로를 주면, 여러 사이트를 모아 보는 허브로 돌아가는 줄을 맨 위에 붙인다(선택).
let withHubLink = null;
if (process.env.PKM_HUB_LINK && fss.existsSync(process.env.PKM_HUB_LINK)) withHubLink = (await import(pathToFileURL(path.resolve(process.env.PKM_HUB_LINK)).href)).withHubLink;

/* ---------- HTTP ---------- */
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json', '.ico':'image/x-icon' };
// AI 연결(pkm-ai-server)이 닿을 수 있는 곳 — 이 컴퓨터, Tailscale 주소, 그리고 이 화면을 연 호스트의 다른 포트(휴대폰에서 junhosoft:5270으로 열면 junhosoft:5280).
// 다른 주소에 띄웠다면 PKM_AI_CONNECT에 공백으로 더한다
const AI_CONNECT = ['http://127.0.0.1:*', 'http://localhost:*', 'https://*.ts.net', ...(process.env.PKM_AI_CONNECT || '').split(/\s+/).filter(Boolean)].join(' ');
const sameHost = req => { const h = String(req.headers.host || '').replace(/:\d+$/, ''); return /^[a-z0-9.-]+$/i.test(h) ? ` http://${h}:* https://${h}:*` : ''; };
const SEC = req => ({ 'x-content-type-options':'nosniff', 'referrer-policy':'no-referrer', 'content-security-policy':`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.github.com ${AI_CONNECT}${sameHost(req)}; frame-ancestors 'none'` });
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type':type, 'cache-control':'no-store', ...SEC(res.req) }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
async function body(req){ let s = ''; for await (const c of req){ s += c; if (s.length > 20e6) throw Object.assign(new Error('너무 커요'), { status:413 }); } return s ? JSON.parse(s) : {}; }

async function api(req, res, url){
  const parts = url.pathname.split('/').slice(2).map(decodeURIComponent);   // ['profiles'] · ['profile', p, ...]
  // 다른 사이트가 이 로컬 서버에 쓰기 요청을 보내지 못하게. 브라우저가 붙이는 Sec-Fetch-Site를 먼저 본다(프록시를 거쳐도 그대로라
  // tailscale serve 뒤에서도 맞다). 없는 브라우저면 Origin과 Host를 비교한다
  if (req.method !== 'GET'){
    const site = req.headers['sec-fetch-site'];
    let cross = site ? !['same-origin', 'none'].includes(site) : false;
    if (!site && req.headers.origin){ let host = ''; try { host = new URL(req.headers.origin).host; } catch {} cross = host !== req.headers.host && host !== req.headers['x-forwarded-host']; }
    if (cross) return send(res, 403, { error:'다른 사이트에서 온 요청이에요' });
  }
  if (parts[0] === 'plugins' && parts[1] === 'bundled' && req.method === 'GET') return send(res, 200, { plugins:await plugins.bundled(path.join(ROOT, 'plugins')) });
  if (parts[0] === 'plugins' && parts[1] === 'inspect' && req.method === 'POST') return send(res, 200, await plugins.inspect(await body(req)));
  if (parts[0] === 'gcal'){
    if (parts[1] === 'client' && req.method === 'POST'){ gcal.setClient(await body(req)); return send(res, 200, { ok:true }); }
    if (parts[1] === 'callback' && req.method === 'GET'){
      try {
        const r = await gcal.callback(Object.fromEntries(url.searchParams));
        return send(res, 200, page('구글 캘린더를 연결했어요', `${escHtml(r.email || '구글 계정')}의 캘린더를 프로필 "${escHtml(r.profile)}"의 약속과 맞추기 시작했어요. 이 창은 닫아도 돼요.`), 'text/html; charset=utf-8');
      } catch (e) { return send(res, 400, page('연결하지 못했어요', escHtml(e.message)), 'text/html; charset=utf-8'); }
    }
  }
  if (parts[0] === 'profiles'){
    if (req.method === 'GET') return send(res, 200, { profiles:await listProfiles() });
    if (req.method === 'POST') return send(res, 201, await createProfile(String((await body(req)).name || '').trim()));
  }
  if (parts[0] === 'profile' && validProfile(parts[1]) && fss.existsSync(path.join(DATA, parts[1]))){
    const p = parts[1], sub = parts[2] || '';
    if (req.method === 'GET' && !sub) return send(res, 200, await readProfile(p));
    if (req.method === 'GET' && sub === 'version') return send(res, 200, { version:await versionOf(p), sync:SYNC[p] ? { state:SYNC[p].state, at:SYNC[p].at, error:SYNC[p].error } : null });
    if (req.method === 'POST' && sub === 'save') return send(res, 200, await save(p, await body(req)));
    if (req.method === 'GET' && sub === 'image') return image(res, p, url.searchParams.get('name'));
    if (sub === 'runner' && req.method === 'POST') return send(res, 200, await runner.setRunner(p, await body(req)));
    if (sub === 'jobs' && !parts[3] && req.method === 'GET') return send(res, 200, await jobs.status(p));
    if (sub === 'jobs' && parts[3] && parts[4] === 'run' && req.method === 'POST') return send(res, 200, await jobs.runNow(p, parts[3]));
    if (sub === 'plugins' && parts[3] === 'state' && req.method === 'GET') return send(res, 200, await runner.status(p));
    if (sub === 'plugins' && parts[3] && parts[4]){
      const id = parts[3], what = parts[4];
      if (what === 'machine' && req.method === 'GET') return send(res, 200, await runner.machine(p, id));
      if (what === 'approve' && req.method === 'POST') return send(res, 200, { plugin:await runner.approve(p, id) });
      if (what === 'secret' && req.method === 'POST'){ const b = await body(req); return send(res, 200, await runner.setSecret(p, id, String(b.name || ''), b.value == null ? null : String(b.value))); }
      if (what === 'local' && req.method === 'POST') return send(res, 200, await runner.setLocal(p, id, await body(req)));
      if (what === 'act' && req.method === 'POST') return send(res, 200, await runner.act(p, id, await body(req)));
      if (what === 'search' && req.method === 'POST'){ const b = await body(req); return send(res, 200, await runner.search(p, id, b.name, b.q)); }
      if (what === 'scripts' && req.method === 'GET'){
        const x = (await plugins.list(path.join(DATA, p))).find(x => x.id === id);
        if (!x) return send(res, 404, { error:'설치된 플러그인이 아니에요' });
        return send(res, 200, { scripts:await Promise.all(x.scripts.map(async s => ({ ...s, text:await fs.readFile(path.join(x.path, s.path), 'utf8').catch(() => '') }))) });
      }
    }
    if (sub === 'plugins'){
      const dir = path.join(DATA, p);
      if (req.method === 'GET' && !parts[3]) return send(res, 200, { plugins:await plugins.list(dir) });
      if (req.method === 'POST' && !parts[3]){ const r = await plugins.install(dir, String((await body(req)).stage || '')); if ((await settingsOf(p)).storage === 'github') scheduleSync(p); return send(res, 201, r); }
      if (req.method === 'DELETE' && parts[3]){ const r = await plugins.remove(dir, parts[3]); if ((await settingsOf(p)).storage === 'github') scheduleSync(p); return send(res, 200, r); }
    }
    if (sub === 'gcal'){
      const act = parts[3] || '';
      if (req.method === 'GET' && !act) return send(res, 200, gcal.status(p));
      if (req.method === 'GET' && act === 'connect'){
        try { res.writeHead(302, { location:gcal.connectUrl(p), 'cache-control':'no-store' }); return res.end(); }
        catch (e) { return send(res, 400, page('연결하지 못했어요', escHtml(e.message)), 'text/html; charset=utf-8'); }
      }
      if (req.method === 'POST' && act === 'sync'){ await gcal.sync(p); return send(res, 200, gcal.status(p)); }
      if (req.method === 'POST' && act === 'disconnect'){ await gcal.disconnect(p); return send(res, 200, gcal.status(p)); }
    }
    if (sub === 'sync'){
      if (req.method === 'POST'){ const s = await syncNow(p); return send(res, 200, { state:s.state, at:s.at, error:s.error }); }
      const s = SYNC[p] || {}; return send(res, 200, { storage:(await settingsOf(p)).storage || 'device', state:s.state || 'idle', at:s.at || null, error:s.error || null });
    }
  }
  send(res, 404, { error:'없는 경로예요' });
}
// 노트에 붙은 그림(![[이름.svg]]) — 이름이 같은 그림을 프로필 안에서 찾아 읽기만 한다. 교과서 그림은 import가 책 폴더로 옮겨 둔다
async function findImage(dir, name, base = ''){
  for (const e of await fs.readdir(path.join(dir, base), { withFileTypes:true }).catch(() => [])){
    if (e.name.startsWith('.')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()){ const r = await findImage(dir, name, rel); if (r) return r; }
    else if (e.name === name) return path.join(dir, rel);
  }
  return null;
}
async function image(res, p, name){
  if (typeof name !== 'string' || !textbook.IMAGE_RE.test(name) || /[\\/]/.test(name) || name.startsWith('.')) return send(res, 400, { error:'그림 이름이 아니에요' });
  const abs = await findImage(path.join(DATA, p), name);
  if (!abs) return send(res, 404, { error:'그림이 없어요' });
  const ext = path.extname(name).toLowerCase(), type = { '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' }[ext];
  res.writeHead(200, { 'content-type':type, 'cache-control':'no-cache', ...SEC(res.req), ...(ext === '.svg' ? { 'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'" } : {}) });
  res.end(await fs.readFile(abs));
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
  await syncTextbooks(); setInterval(() => syncTextbooks().catch(() => {}), 300000).unref();
  runner.start(); jobs.start();
  server.listen(PORT, HOST, () => console.log(`PKM: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/  (데이터: ${DATA})`));
}
export { server, runner, gcal, jobs, readProfile, save, createProfile, listProfiles, versionOf, inProfile, syncTemplates, syncNow as syncNowForTest, syncTextbooks };
