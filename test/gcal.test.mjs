// 구글 캘린더 동기화 시험 — 가짜 구글(토큰·캘린더 API)을 띄우고, 연결 → 가져오기 → 보내기 → 고치기 → 지우기를 양쪽으로 확인한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-gcal-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-home-'));

/* ---------- 가짜 구글 ---------- */
const G = { events:new Map(), seq:0, calls:[] };
const stamp = () => new Date(Date.now() + (G.seq++) * 1000).toISOString();
const iso = (days, h) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.toISOString(); };
function addRemote(id, summary, days, h){ G.events.set(id, { id, status:'confirmed', summary, start:{ dateTime:iso(days, h) }, end:{ dateTime:iso(days, h + 1) }, updated:stamp(), attendees:[{ email:'me@x.com', self:true }, { email:'b@x.com', displayName:'민지' }] }); }
const fake = http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const u = new URL(req.url, 'http://x'), send = (code, b) => { res.writeHead(code, { 'content-type':'application/json' }); res.end(b == null ? '' : JSON.stringify(b)); };
  G.calls.push(`${req.method} ${u.pathname}`);
  if (u.pathname === '/token'){
    const f = new URLSearchParams(raw);
    if (f.get('grant_type') === 'authorization_code'){
      const idt = ['x', Buffer.from(JSON.stringify({ email:'me@x.com' })).toString('base64url'), 'y'].join('.');
      return send(200, { access_token:'at1', expires_in:3600, refresh_token:'rt1', id_token:idt });
    }
    return send(200, { access_token:'at2', expires_in:3600 });
  }
  if (u.pathname === '/revoke') return send(200, {});
  const m = u.pathname.match(/^\/api\/calendars\/primary\/events(?:\/(.+))?$/);
  if (!m) return send(404, { error:{ message:'없음' } });
  const id = m[1] && decodeURIComponent(m[1]);
  if (req.method === 'GET') return send(200, { items:[...G.events.values()] });
  if (req.method === 'POST'){ const b = JSON.parse(raw); const ev = { id:'g' + (G.seq++), status:'confirmed', ...b, updated:stamp() }; G.events.set(ev.id, ev); return send(200, ev); }
  if (req.method === 'PATCH'){ const ev = G.events.get(id); if (!ev) return send(404, {}); Object.assign(ev, JSON.parse(raw), { updated:stamp() }); return send(200, ev); }
  if (req.method === 'DELETE'){ const ev = G.events.get(id); if (!ev) return send(410, {}); ev.status = 'cancelled'; ev.updated = stamp(); res.writeHead(204); return res.end(); }
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const F = `http://127.0.0.1:${fake.address().port}`;
Object.assign(process.env, { PKM_DATA:tmp, PKM_APP_HOME:home, PKM_GCAL_AUTH_URL:`${F}/auth`, PKM_GCAL_TOKEN_URL:`${F}/token`, PKM_GCAL_REVOKE_URL:`${F}/revoke`, PKM_GCAL_API:`${F}/api` });

const { server } = await import('../server/index.js');
let base;
before(() => new Promise(r => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => { server.close(); fake.close(); fs.rmSync(tmp, { recursive:true, force:true }); fs.rmSync(home, { recursive:true, force:true }); });
const j = async (p, opt) => { const r = await fetch(base + p, opt); return { status:r.status, body:await r.json() }; };
const post = (p, b) => j(p, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(b || {}) });
const P = encodeURIComponent('개인');
const apptDir = path.join(tmp, '개인', '03_행동', '약속보드');
const appts = () => fs.existsSync(apptDir) ? fs.readdirSync(apptDir).filter(f => f.endsWith('.md')) : [];
const readAppt = name => fs.readFileSync(path.join(apptDir, name), 'utf8');
const sync = () => post(`/api/profile/${P}/gcal/sync`);
const localAppt = (id, title, days, h, extra = '') => { const d = new Date(); d.setDate(d.getDate() + days); const day = d.toISOString().slice(0, 10); return [`03_행동/약속보드/${day} ${title}.md`, `---\ntype: appointment\nid: ${id}\ntitle: ${title}\nstart: ${day}T${String(h).padStart(2, '0')}:00\nend: ${day}T${String(h + 1).padStart(2, '0')}:00\n${extra}---\n\n# 메모\n`]; };

test('연결 전 준비: 프로필, 연결 전에 만든 약속, 캘린더 일정', async () => {
  await post('/api/profiles', { name:'개인' });
  const [rel, text] = localAppt('a-old', '연결 전 약속', 2, 9);
  await post(`/api/profile/${P}/save`, { writes:{ [rel]:text } });
  addRemote('r1', '팀 회의', 1, 10);
  G.events.set('allday', { id:'allday', status:'confirmed', summary:'휴가', start:{ date:'2030-01-01' }, end:{ date:'2030-01-02' }, updated:stamp() });
  assert.equal((await j(`/api/profile/${P}/gcal`)).body.client, false);
});

test('클라이언트를 등록하고 구글 로그인으로 연결한다', async () => {
  assert.equal((await post('/api/gcal/client', { client_id:'' })).status, 400);
  assert.equal((await post('/api/gcal/client', { client_id:'cid.apps.googleusercontent.com', client_secret:'sec' })).status, 200);
  const r = await fetch(`${base}/api/profile/${P}/gcal/connect`, { redirect:'manual' });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.searchParams.get('redirect_uri'), `${base}/api/gcal/callback`);
  assert.match(loc.searchParams.get('scope'), /calendar\.events/);
  const cb = await fetch(`${base}/api/gcal/callback?code=c1&state=${loc.searchParams.get('state')}`);
  assert.equal(cb.status, 200);
  assert.match(await cb.text(), /연결했어요/);
  const st = (await j(`/api/profile/${P}/gcal`)).body;
  assert.equal(st.connected, true); assert.equal(st.email, 'me@x.com');
  const saved = fs.statSync(path.join(home, 'gcal.json'));
  assert.equal(saved.mode & 0o777, 0o600);
  assert.ok(!fs.readdirSync(tmp, { recursive:true }).some(f => String(f).includes('gcal.json')));   // 토큰은 데이터 폴더에 없다
  const bad = await fetch(`${base}/api/gcal/callback?code=c1&state=nope`); assert.equal(bad.status, 400);
});

test('처음 동기화: 캘린더 일정을 가져오고, 연결 전 약속과 하루 종일 일정은 건드리지 않는다', async () => {
  await sync();
  const names = appts();
  const meet = names.find(n => n.includes('팀 회의'));
  assert.ok(meet, names.join());
  assert.match(readAppt(meet), /gcal_id: r1/);
  assert.match(readAppt(meet), /민지/);
  assert.ok(!names.some(n => n.includes('휴가')));
  assert.ok(![...G.events.values()].some(e => e.summary === '연결 전 약속'));
  assert.equal((await j(`/api/profile/${P}/gcal`)).body.skipped, 1);
});

test('pkm에서 만든 약속은 캘린더로 보내고 gcal_id를 적는다(참석자는 보내지 않는다)', async () => {
  const [rel, text] = localAppt('a-new', '치과', 3, 15, 'attendees:\n  - 민지\n');
  await post(`/api/profile/${P}/save`, { writes:{ [rel]:text } });
  await sync();
  const ev = [...G.events.values()].find(e => e.summary === '치과');
  assert.ok(ev); assert.equal(ev.attendees, undefined);
  assert.match(ev.start.dateTime, /T15:00:00$/);
  assert.match(readAppt(appts().find(n => n.includes('치과'))), new RegExp(`gcal_id: ${ev.id}`));
});

test('pkm에서 고치면 캘린더에 반영하고, 캘린더에서 고치면 pkm에 반영한다', async () => {
  const name = appts().find(n => n.includes('치과'));
  await post(`/api/profile/${P}/save`, { writes:{ [`03_행동/약속보드/${name}`]:readAppt(name).replace('title: 치과', 'title: 치과 정기검진') } });
  await sync();
  assert.ok([...G.events.values()].some(e => e.summary === '치과 정기검진'));
  const r1 = G.events.get('r1'); r1.summary = '팀 회의 (장소 변경)'; r1.location = '3층'; r1.updated = stamp();
  await sync();
  const meet = appts().find(n => n.includes('장소 변경'));
  assert.ok(meet, appts().join()); assert.match(readAppt(meet), /location: "?3층"?/);
});

test('pkm에서 지우면 캘린더에서도, 캘린더에서 지우면 pkm에서도(휴지통으로) 지운다', async () => {
  const name = appts().find(n => n.includes('치과 정기검진'));
  const gid = readAppt(name).match(/gcal_id: (\S+)/)[1];
  await post(`/api/profile/${P}/save`, { deletes:[`03_행동/약속보드/${name}`] });
  await sync();
  assert.equal(G.events.get(gid).status, 'cancelled');
  G.events.get('r1').status = 'cancelled'; G.events.get('r1').updated = stamp();
  await sync();
  assert.ok(!appts().some(n => n.includes('팀 회의')));
  assert.ok(fs.readdirSync(path.join(tmp, '개인', '.trash', '03_행동', '약속보드')).some(n => n.includes('팀 회의')));
  assert.ok(appts().some(n => n.includes('연결 전 약속')));
});

test('한 번에 너무 많이 지워야 하면 캘린더에서 지우지 않고 알린다', async () => {
  const writes = {};
  for (let i = 0; i < 12; i++){ const [rel, text] = localAppt(`bulk${i}`, `일괄 ${i}`, 5, 8 + (i % 10)); writes[rel.replace('.md', ` ${i}.md`)] = text; }
  await post(`/api/profile/${P}/save`, { writes });
  await sync();
  const made = [...G.events.values()].filter(e => /^일괄/.test(e.summary) && e.status !== 'cancelled');
  assert.equal(made.length, 12);
  await post(`/api/profile/${P}/save`, { deletes:appts().filter(n => n.includes('일괄')).map(n => `03_행동/약속보드/${n}`) });
  await sync();
  assert.equal([...G.events.values()].filter(e => /^일괄/.test(e.summary) && e.status !== 'cancelled').length, 12);
  assert.match((await j(`/api/profile/${P}/gcal`)).body.error, /지우지 않았어요/);
});

test('연결을 끊으면 토큰을 지운다', async () => {
  const st = (await post(`/api/profile/${P}/gcal/disconnect`)).body;
  assert.equal(st.connected, false);
  assert.ok(!JSON.parse(fs.readFileSync(path.join(home, 'gcal.json'), 'utf8')).profiles['개인']);
});
