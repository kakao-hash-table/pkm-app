// 워크플로우의 브라우저 단계(browser(…))를 실제 실행기(server/runner.js)와 가짜 pkm-ai-server로 —
// 요청 꼴(only·vars·allow·files·tab), 넘겨받기 → 내 확인 → 답 → 같은 작업으로 이어 감, 구조화 결과가 뒤 단계로, 승인에 브라우저가 없으면 멈춤,
// 내 정보(vars)가 브라우저 단계 기록과 끝난 실행의 상태 파일에 남지 않음, 사람이 보는 브라우저 경로의 탭 검사, 규격 검사.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const exec = promisify(execFile);
const V = createRequire(import.meta.url)('../web/js/pkm-plugin.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-browser-step-'));
const DATA = path.join(T, 'data'), P = '개인', ID = 'web-submit';
Object.assign(process.env, { PKM_HOME: path.join(T, 'home'), PKM_HOST_NAME: '집맥', PKM_RUNNER_TICK: '999999', PKM_DATA: DATA });
fs.mkdirSync(path.join(DATA, P), { recursive: true });
fs.writeFileSync(path.join(DATA, P, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');
const FIX = new URL('./fixtures/plugin-browser/', import.meta.url).pathname;
const ROOT = path.join(DATA, P, '_플러그인', ID);

/* 가짜 pkm-ai-server — 에이전트 작업은 fake.hand가 있으면 사람에게 넘기고(BrowserHandoff) 답을 받으면 끝낸다 */
const fake = { approved: true, browser: true, hand: null, result: { text: '', structured: { _result: { sent: 'yes', proof: '홍길동님 접수 완료 · 접수 번호 77' } } }, posts: [], answers: [], deleted: [], tabs: [] };
const jobs = new Map(); let n = 0;
const finish = j => Object.assign(j, { status: 'done', pending: [], result: { ...fake.result, session: 'sess-1' } });
const ai = http.createServer(async (req, res) => {
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/v1/providers') return send(200, { providers: [{ id: 'claude', installed: true, logged_in: true, agent: { modes: ['read', 'auto'], approvals: true, browser: fake.browser } }] });
  if (u.pathname === '/v1/plugins') return req.method === 'POST' ? send(201, { plugin: body }) : send(200, { plugins: fake.approved === null ? [] : [{ id: ID, root: ROOT, permissions: { browser: fake.approved }, files: {} }] });
  if (u.pathname === '/v1/jobs' && req.method === 'POST'){
    const id = `job${++n}`;
    if (body.plugin_script){
      const job = { id, status: 'done', result: { exit_code: 0, stdout: (await exec(process.execPath, [path.join(body.plugin.root, body.plugin_script), ...body.args], { encoding: 'utf8' })).stdout, stderr: '' } };
      jobs.set(id, job); return send(201, { job });
    }
    fake.posts.push(body);
    const job = { id, status: 'running', agent: body.agent, pending: [], result: null };
    if (fake.hand && body.agent.browser) job.pending = [{ id: `bh_${n}`, tool: 'BrowserHandoff', title: '브라우저에서 해 주세요', description: fake.hand, input: { message: fake.hand, tab: body.agent.browser.tab, url: 'https://apply.example.com/login', title: '로그인' }, at: new Date().toISOString() }];
    else finish(job);
    jobs.set(id, job); return send(201, { job });
  }
  let m = u.pathname.match(/^\/v1\/jobs\/(\w+)\/answer$/);
  if (m && req.method === 'POST'){
    const j = jobs.get(m[1]); if (!j) return send(404, { error: '없는 요청이에요' });
    if (!(j.pending || []).some(q => q.id === body.request_id)) return send(409, { error: '이미 답했거나 끝난 확인 요청이에요' });
    fake.answers.push({ job: j.id, ...body }); finish(j);
    if (!body.allow) j.result = { text: '', structured: { _result: { sent: 'no', proof: '로그인하지 못했어요' } } };
    return send(200, { job: j });
  }
  m = u.pathname.match(/^\/v1\/jobs\/(\w+)$/);
  if (m && req.method === 'DELETE'){ fake.deleted.push(m[1]); const j = jobs.get(m[1]); if (j) Object.assign(j, { status: 'canceled', pending: [] }); return send(200, { job: j || null }); }
  if (m) return jobs.has(m[1]) ? send(200, { job: jobs.get(m[1]) }) : send(404, { error: '없는 요청이에요' });
  m = u.pathname.match(/^\/v1\/browser\/tabs\/([^/]+)(\/\w+)?$/);
  if (m){
    const key = decodeURIComponent(m[1]); fake.tabs.push({ key, sub: m[2] || '', method: req.method, body });
    if (m[2] === '/frame'){ res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); }
    return send(200, { open: true, key, url: body.url || 'https://apply.example.com/form', title: '접수', width: 1280, height: 800, mobile: false, headless: false, popup: false, dialog: null, ...(m[2] === '/input' ? { focus: { editable: true, password: body.type === 'click' } } : {}) });
  }
  send(404, {});
});
let runner; const asked = [];
before(async () => {
  await new Promise(r => ai.listen(0, '127.0.0.1', r));
  const plugins = await import('../server/plugins.js');
  const { createRunner } = await import('../server/runner.js');
  const ins = await plugins.inspect({ local: FIX });
  assert.equal(ins.ok, true, ins.errors.join());
  await plugins.install(path.join(DATA, P), ins.stage);
  runner = createRunner({ DATA, listProfiles: async () => [{ name: P }], onAsk: (p, m) => asked.push({ p, ...m }) });
  await runner.setRunner(P, { on: true, ai: { url: `http://127.0.0.1:${ai.address().port}`, token: 'test-token-0123456789' } });
  await runner.act(P, ID, { type: 'refresh', feed: '낼 곳' });
});
after(() => { ai.close(); fs.rmSync(T, { recursive: true, force: true }); });

const state = async () => (await runner.status(P)).plugins[ID].state;
const stateFile = () => fs.readFileSync(path.join(DATA, P, '_플러그인/.state', `${ID}.json`), 'utf8');
const stepOf = (r, k) => r.steps.find(s => s.key === k);
async function until(rid, fn, label){
  const get = async () => (await state()).runs.find(r => r.id === rid);
  for (let i = 0; i < 40; i++){ const r = await get(); if (r && fn(r)) return r; await runner.tick(); }
  const r = await get(); assert.fail(`${label}: ${r && r.status} ${JSON.stringify(r && r.steps.map(s => [s.key, s.status, s.error]))}`);
}
async function start(item, workflow = '내기'){
  const st = (await runner.act(P, ID, { type: 'start', feed: '낼 곳', item, workflow })).state;
  return st.runs[0].id;
}
const reset = () => Object.assign(fake, { approved: true, browser: true, hand: null, posts: [], answers: [], deleted: [], tabs: [] });
const MINE = /홍길동|010-9999-8888/;

test('브라우저 단계 — 계약대로 보낸다(브라우저 도구만 · 내 정보 · 갈 수 있는 곳 · 올릴 파일 · 탭 키)', async () => {
  reset();
  const r = await until(await start('cm-2026'), r => r.status === 'done', '끝까지 간다');
  assert.equal(fake.posts.length, 1);
  const b = fake.posts[0], schema = JSON.parse(fs.readFileSync(path.join(FIX, 'prompts/내기.schema.json'), 'utf8'));
  assert.deepEqual(b.plugin, { id: ID, root: ROOT });
  assert.equal(b.provider, 'claude');
  assert.deepEqual(b.json_schema, schema, '옆의 .schema.json 모양으로 답하게 한다');
  assert.deepEqual(b.agent, { cwd: ROOT, mode: 'read', approvals: true, browser: {
    tab: b.agent.browser.tab, only: true, vars: { 이름: '홍길동', 연락처: '010-9999-8888' }, allow: ['apply.example.com', 'www.example.com'], files: [{ name: '신청서.hwp', path: '/tmp/pkm-test-신청서.hwp' }] } });
  assert.match(b.agent.browser.tab, /^h[0-9a-f]{16}\|web-submit\|cm-2026$/, '한글 프로필 이름은 해시로, 플러그인 id와 항목 id는 그대로');
  assert.match(b.agent.browser.tab, /^[\w:.|\-/]{1,160}$/, 'pkm-ai-server의 탭 키 규칙');
  assert.match(b.prompt, /https:\/\/apply\.example\.com\/form 접수 화면을 열어 "표어 공모"/, '프롬프트 파일의 자리를 채운다');
  assert.match(b.prompt, /\{\{이름\}\} \{\{연락처\}\}/);
  assert.doesNotMatch(b.prompt, MINE, '내 정보 값은 프롬프트에 넣지 않는다');
  assert.equal(stepOf(r, '브라우저').tab, b.agent.browser.tab, '화면이 볼 탭을 단계에 적어 둔다');
});

test('구조화 결과가 단계 결과가 되어 뒤 단계로 넘어가고, 끝난 실행의 상태 파일에 내 정보가 없다', async () => {
  const r = (await state()).runs[0];
  assert.equal(stepOf(r, '결과').output.summary, 'sent=yes · {{이름}}님 접수 완료 · 접수 번호 77', '{브라우저._result}가 다음 스크립트의 인자로 — 화면에서 옮겨 적힌 내 정보는 자리표시로');
  assert.equal(stepOf(r, '결과').output.verdict.title, '냈어요');
  assert.equal(stepOf(r, '브라우저').session, 'sess-1');
  assert.equal('_result' in stepOf(r, '브라우저').output, false, '_로 시작하는 값은 끝나면 지운다');
  assert.equal('_browser' in stepOf(r, '준비').output, false);
  assert.doesNotMatch(stateFile(), MINE);
});

test('넘겨받기 — 내 확인으로 멈추고, [다 했어요]로 답하면 같은 작업을 이어 간다', async () => {
  reset(); fake.hand = '홍길동 계정으로 로그인해 주세요'; asked.length = 0;
  const rid = await start('위비티:12/3');
  let r = await until(rid, r => r.status === 'input', '내 확인으로 멈춘다');
  const s = stepOf(r, '브라우저'), job = s.job;
  assert.deepEqual(s.ask, { type: 'handoff', question: '{{이름}} 계정으로 로그인해 주세요', request_id: s.ask.request_id, url: 'https://apply.example.com/login', title: '로그인' });
  assert.ok(job, '작업은 답을 기다리며 살아 있다');
  assert.match(s.tab, /^h[0-9a-f]{16}\|web-submit\|h[0-9a-f]{16}$/, '옵션의 tab(한글)도 이 플러그인의 키 안에서 해시로');
  assert.deepEqual(asked.map(a => [a.p, a.plugin, a.run, a.step, a.question]), [[P, ID, rid, '브라우저', '{{이름}} 계정으로 로그인해 주세요']], '알림은 넘긴 일마다 한 번');
  assert.doesNotMatch(JSON.stringify(s), MINE, '브라우저 단계의 기록에는 내 정보 값이 없다');
  assert.equal(V.runFeedback(r).text, '내 확인이 필요해요 · {{이름}} 계정으로 로그인해 주세요', '목록 줄의 내 확인');
  for (let i = 0; i < 3; i++) await runner.tick();   // 기다리는 동안 몇 번을 돌아도 그대로
  r = (await state()).runs.find(z => z.id === rid);
  assert.equal(r.status, 'input'); assert.equal(asked.length, 1); assert.equal(fake.posts.length, 1);

  await runner.act(P, ID, { type: 'answer', run: rid, step: '브라우저', value: 'done' });
  assert.deepEqual(fake.answers, [{ job, request_id: s.ask.request_id, allow: true, message: '' }]);
  r = await until(rid, r => r.status === 'done', '이어서 끝까지 간다');
  assert.equal(fake.posts.length, 1, '단계를 처음부터 다시 돌리지 않는다');
  assert.equal(stepOf(r, '브라우저').job, job);
  assert.equal(stepOf(r, '결과').output.verdict.title, '냈어요');
  assert.doesNotMatch(stateFile(), MINE);
});

test('넘겨받기 — [못 했어요]는 못 했다고 답하고, 그만두면 기다리던 작업도 멈춘다', async () => {
  reset(); fake.hand = '본인 인증을 해 주세요';
  let rid = await start('cm-2026'), r = await until(rid, r => r.status === 'input', '멈춘다');
  await runner.act(P, ID, { type: 'answer', run: rid, step: '브라우저', value: 'fail' });
  assert.equal(fake.answers[0].allow, false);
  assert.match(fake.answers[0].message, /하지 못했다/);
  r = await until(rid, r => r.status === 'done', '에이전트가 낸 결과대로 끝난다');
  assert.equal(stepOf(r, '결과').output.verdict.title, '내지 못했어요');

  rid = await start('cm-2026'); r = await until(rid, r => r.status === 'input', '다시 멈춘다');
  const job = stepOf(r, '브라우저').job;
  await runner.act(P, ID, { type: 'cancel', run: rid });
  assert.deepEqual(fake.deleted, [job], '답을 기다리던 에이전트 작업을 멈춘다');
  assert.equal((await state()).runs.find(z => z.id === rid).status, 'canceled');
  assert.doesNotMatch(stateFile(), MINE, '그만둔 실행에도 내 정보가 남지 않는다');
});

test('넘겨받기를 기다리던 작업이 사라지면 그 단계를 멈춘 것으로 두고, 다시 하면 새 작업으로 한다', async () => {
  reset(); fake.hand = '로그인해 주세요';
  const rid = await start('cm-2026');
  let r = await until(rid, r => r.status === 'input', '멈춘다');
  jobs.delete(stepOf(r, '브라우저').job);   // AI 서버가 그 작업을 잃었다
  await runner.tick();
  r = (await state()).runs.find(z => z.id === rid);
  assert.equal(r.status, 'stopped');
  assert.equal(stepOf(r, '브라우저').status, 'failed');
  assert.match(stepOf(r, '브라우저').error, /찾지 못했어요.*다시 해 주세요/);
  fake.hand = null;
  await runner.act(P, ID, { type: 'retry', run: rid, step: '브라우저' });
  r = await until(rid, r => r.status === 'done', '다시 하면 끝까지 간다');
  assert.equal(fake.posts.length, 2);

  // AI 서버를 다시 켜면 묻던 것은 사라지고 작업을 처음부터 다시 한다 — 기다림을 풀고, 새로 넘기면 다시 내 확인으로
  fake.hand = '로그인해 주세요';
  const rid2 = await start('cm-2026');
  r = await until(rid2, r => r.status === 'input', '멈춘다');
  const j = jobs.get(stepOf(r, '브라우저').job), old = stepOf(r, '브라우저').ask.request_id;
  j.pending = [];
  await runner.tick();
  assert.equal((await state()).runs.find(z => z.id === rid2).status, 'running', '답할 것이 사라졌으면 기다림을 푼다');
  j.pending = [{ id: 'bh_again', tool: 'BrowserHandoff', description: '다시 로그인해 주세요', input: { message: '다시 로그인해 주세요' } }];
  r = await until(rid2, r => r.status === 'input', '새로 넘긴 일로 다시 멈춘다');
  assert.notEqual(stepOf(r, '브라우저').ask.request_id, old);
  await runner.act(P, ID, { type: 'cancel', run: rid2 });
});

test('승인에 브라우저가 없으면 실행하지 않고 다시 승인하라고 멈춘다', async () => {
  reset(); fake.approved = false;
  await runner.approve(P, ID).catch(() => {});   // 기억해 둔 승인 상태를 비운다
  const rid = await start('cm-2026');
  let r = await until(rid, r => r.status === 'stopped', '멈춘다');
  assert.equal(stepOf(r, '브라우저').status, 'failed');
  assert.match(stepOf(r, '브라우저').error, /준비와 설정에서 다시 승인해 주세요/);
  assert.equal(fake.posts.length, 0, '에이전트를 부르지 않는다');
  assert.deepEqual(await runner.browser(P, ID, 'info', ''), { ok: false, reason: 'approve', message: stepOf(r, '브라우저').error, login: (await runner.browser(P, ID, 'info', '')).login });
  await assert.rejects(runner.browser(P, ID, 'frame', (await runner.browser(P, ID, 'info', '')).login), /다시 승인/);

  fake.approved = true; await runner.approve(P, ID).catch(() => {});
  await runner.act(P, ID, { type: 'retry', run: rid, step: '브라우저' });
  r = await until(rid, r => r.status === 'done', '승인한 뒤 다시 하면 된다');
  assert.equal(fake.posts.length, 1);

  fake.browser = false; await runner.approve(P, ID).catch(() => {});
  assert.equal((await runner.browser(P, ID, 'info', '')).reason, 'old', 'pkm-ai-server가 브라우저를 모르면 그렇다고 알린다');
  fake.browser = true; await runner.approve(P, ID).catch(() => {});
});

test('옵션 없는 브라우저 단계(browser())는 탭과 브라우저 도구만 붙인다', async () => {
  reset();
  await until(await start('no-web', '열기'), r => r.status === 'done', '끝난다');
  assert.deepEqual(fake.posts[0].agent.browser, { tab: fake.posts[0].agent.browser.tab, only: true });
  assert.equal(fake.posts[0].json_schema, undefined);
  assert.match(fake.posts[0].prompt, /^우편 접수 접수 화면을 열고/);

  reset();   // when으로 건너뛴 브라우저 단계 — 뒤 단계에는 빈 값
  const r = await until(await start('no-web'), r => r.status === 'done', '끝난다');
  assert.equal(stepOf(r, '브라우저').status, 'skipped');
  assert.equal(fake.posts.length, 0);
  assert.equal(stepOf(r, '결과').output.summary, '브라우저로 내지 않았어요');
});

test('에이전트 단계도 옆의 .schema.json 모양으로 답하게 하고, 그 결과가 단계 결과가 된다', async () => {
  reset(); const keep = fake.result; fake.result = { text: '', structured: { found: true, summary: '쓸 만한 글이 있어요' } };
  try {
    const r = await until(await start('cm-2026', '살피기'), r => r.status === 'done', '끝난다');
    assert.deepEqual(fake.posts[0].json_schema, JSON.parse(fs.readFileSync(path.join(FIX, 'prompts/살피기.schema.json'), 'utf8')));
    assert.deepEqual(fake.posts[0].agent, { cwd: ROOT, mode: 'read' }, '브라우저는 browser 단계에만 붙는다');
    assert.deepEqual(stepOf(r, '살피기').output, { found: true, summary: '쓸 만한 글이 있어요' });
  } finally { fake.result = keep; }
});

test('사람이 보는 브라우저 — 이 플러그인의 탭만 중계한다', async () => {
  reset();
  const st = await runner.browser(P, ID, 'info', '');
  assert.equal(st.ok, true);
  assert.match(st.login, /^h[0-9a-f]{16}\|web-submit\|login$/);
  const info = await runner.browser(P, ID, 'info', st.login);
  assert.equal(info.ok, true); assert.equal(info.info.open, true); assert.equal(info.info.width, 1280);
  assert.equal((await runner.browser(P, ID, 'frame', st.login, { q: '55' })).length, 4);
  await runner.browser(P, ID, 'open', st.login, { url: 'https://accounts.google.com/' });
  const r = await runner.browser(P, ID, 'input', st.login, { type: 'click', x: 10, y: 20, tab: st.login });
  assert.equal(r.focus.password, true);
  assert.deepEqual(fake.tabs.map(t => [t.key, t.sub, t.method]), [[st.login, '', 'GET'], [st.login, '/frame', 'GET'], [st.login, '/open', 'POST'], [st.login, '/input', 'POST']]);
  assert.deepEqual(fake.tabs[2].body, { url: 'https://accounts.google.com/' });
  assert.deepEqual(fake.tabs[3].body, { type: 'click', x: 10, y: 20 });
  const seg = st.login.split('|')[0];
  for (const bad of ['chat:abc:data', `${seg}|other-plugin|login`, `${seg}|web-submit`, `x${seg}|web-submit|login`, `${seg}|web-submit|로그인`, ''])
    await assert.rejects(runner.browser(P, ID, 'frame', bad), /이 플러그인의 브라우저 탭이 아니에요/, bad);
  assert.equal(fake.tabs.length, 4, '다른 탭으로는 pkm-ai-server에 가지 않는다');
});

test('서버 경로 — 채팅 것과 나란히: 상태 · 화면 · 열기 · 누르기(tab은 주소의 ?tab=)', async () => {
  reset();
  const { server } = await import('../server/index.js');
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/profile/${encodeURIComponent(P)}/plugins/${ID}/browser`;
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const st = await (await fetch(base)).json();
    assert.deepEqual(st, { ok: true, message: '', login: st.login });
    const tab = `?tab=${encodeURIComponent(st.login)}`;
    assert.equal((await (await fetch(base + tab)).json()).info.title, '접수');
    const f = await fetch(`${base}/frame${tab}&t=1`);
    assert.equal(f.headers.get('content-type'), 'image/jpeg');
    assert.equal((await f.arrayBuffer()).byteLength, 4);
    assert.equal((await (await post(`${base}/open${tab}`, { url: 'https://nid.naver.com/nidlogin.login' })).json()).url, 'https://nid.naver.com/nidlogin.login');
    assert.equal((await (await post(`${base}/input${tab}`, { type: 'text', text: '비밀' })).json()).focus.editable, true);
    assert.deepEqual(fake.tabs.map(t => t.sub), ['', '/frame', '/open', '/input']);
    const bad = await fetch(`${base}/frame?tab=${encodeURIComponent('chat:abc:data')}`);
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /이 플러그인의 브라우저 탭이 아니에요/);
    assert.equal((await post(`${base}/input?tab=${encodeURIComponent(st.login.replace(ID, 'other'))}`, { type: 'reload' })).status, 400);
    assert.equal((await fetch(base.replace(ID, 'none'))).status, 404);
  } finally { server.close(); }
});

test('규격 검사 — browser 단계와 logins', () => {
  const mf = (perm, extra = '') => `---\npkm_plugin: 1\nid: demo-web\nname: 시험\nversion: 0.1.0\npermissions:\n${perm}${extra}---\n시험`;
  const check = (plugin, wf) => V.validate([{ path: 'plugin.md', size: 1, text: plugin }, { path: 'scripts/a.mjs', size: 1, text: '' }, { path: 'prompts/p.md', size: 1, text: 'p' },
    ...(wf ? [{ path: 'workflows/w.md', size: 1, text: `## 내기\n${wf}\n` }] : [])]);
  const full = '  ai: [chat, agent]\n  browser: true\n  bundled: [scripts/a.mjs]\n', flow = '- [준비] 준비 · script: scripts/a.mjs\n- [웹] 내기 · browser({준비._browser}) when {준비.go}: prompts/p.md';
  let r = check(mf(full), flow);
  assert.equal(r.ok, true, r.errors.join());
  assert.deepEqual(r.workflows[0].steps[1], { key: '웹', name: '내기', kind: 'browser', mode: null, browser: '{준비._browser}', when: '{준비.go}', cwd: null, body: 'prompts/p.md' });
  assert.equal(check(mf(full), '- [웹] 열기 · browser(): 열어 줘').ok, true, '괄호를 비우면 옵션 없음');
  assert.equal(check(mf(full), '- [웹] 열기 · browser(): 열어 줘').workflows[0].steps[0].browser, null);

  r = check(mf('  ai: [agent]\n  bundled: [scripts/a.mjs]\n'), flow);
  assert.match(r.errors.join('\n'), /\[웹\]: browser 단계를 쓰려면 permissions\.browser: true가 있어야 해요/);
  r = check(mf('  ai: [chat]\n  browser: true\n  bundled: [scripts/a.mjs]\n'), flow);
  assert.match(r.errors.join('\n'), /\[웹\]: browser 단계를 쓰려면 permissions\.ai에 agent가 있어야 해요/);
  for (const bad of ['- [웹] 내기 · browser({없는._browser}): prompts/p.md', '- [웹] 내기 · browser({title}): prompts/p.md', '- [안] 안 · ai: prompts/p.md\n- [웹] 내기 · browser({안._browser}): prompts/p.md'])
    assert.match(check(mf(full), bad).errors.join('\n'), /앞 스크립트 단계의 결과\(\{단계\.필드\}\)여야 해요/, bad);
  assert.match(check(mf(full), '- [웹] 내기 · browser(): prompts/없음.md').errors.join('\n'), /프롬프트 파일이 없어요 prompts\/없음\.md/);
  assert.match(check(mf(full), '- [웹] 내기 · browser():').errors.join('\n'), /내용이 비어 있어요/);
  assert.match(check(mf(full), '- [웹] 내기 · browser() in /tmp: 열어 줘').errors.join('\n'), /in 폴더를 쓰지 않아요/);

  const logins = v => check(mf(full, `logins:\n${v}`));
  r = logins('  - { name: 구글, url: "https://accounts.google.com/" }\n  - { name: 네이버, url: "https://nid.naver.com/nidlogin.login" }\n');
  assert.equal(r.errors.length, 0, r.errors.join());
  assert.deepEqual(r.manifest.logins, [{ name: '구글', url: 'https://accounts.google.com/' }, { name: '네이버', url: 'https://nid.naver.com/nidlogin.login' }]);
  assert.deepEqual(check(mf(full)).manifest.logins, []);
  assert.match(logins('  - { name: 사내, url: "http://intra.example.com/" }\n').errors.join('\n'), /logins 항목은 name\(20자까지\)과 https:\/\/ 주소/);
  assert.match(logins('  - { url: "https://a.example.com/" }\n').errors.join('\n'), /logins 항목은/);
  assert.match(logins(Array.from({ length: 7 }, (_, i) => `  - { name: 곳${i}, url: "https://a${i}.example.com/" }\n`).join('')).errors.join('\n'), /logins는 6개까지예요/);
  r = check(mf('  ai: [agent]\n  bundled: [scripts/a.mjs]\n', 'logins:\n  - { name: 구글, url: "https://accounts.google.com/" }\n'));
  assert.match(r.errors.join('\n'), /logins를 쓰려면 permissions\.browser: true가 있어야 해요/);
});
