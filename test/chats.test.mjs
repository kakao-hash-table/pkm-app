// AI 챗봇 — 가짜 pkm-ai-server(진행 스트림·확인 요청·답하기)로 로컬 확인·데이터 방·카드 방·세션 이어 가기·지우기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-chats-'));
process.env.PKM_HOME = path.join(T, 'home');
const DATA = path.join(T, 'data'), P = '개인';
fs.mkdirSync(path.join(DATA, P), { recursive: true });

// 가짜 pkm-ai-server — 말에 "물어봐"가 있으면 Write 확인 요청을 띄우고 답을 기다린다
const posted = [], answers = [], jobs = new Map(), subs = new Map();
let delayedStop = false, finishDelayedStop = null, rejectStop = false;
let n = 0, me = { host: os.hostname(), user: os.userInfo().username }, full = true, claudeAvailable = true, startOnCancel = false, legacyCancel = false, finishLegacyCancel = null;
const view = j => ({ id: j.id, provider: j.provider, model: j.model, status: j.status, session: j.session, pending: j.pending, result: j.result || null, error: null });
// 브라우저 — 서버 지원(agent.browser), 이 컴퓨터의 승인 목록(/v1/plugins), 탭 경로
let browserOn = true, approvals = [];
const tabHits = [];
const push = (j, ev) => { for (const w of subs.get(j.id) || []) w(ev); };
function finish(j){
  push(j, { type: 'text', text: '하는 중이에요' });
  const tail = /요약해/.test(j.prompt) ? '\n\n<pkm-summary>\n질문: 테스트 실패 원인을, 네트워크 문제는 빼고 찾아 달라고 함\n답: 날짜 계산 버그를 고쳐 테스트 통과, 문서는 남음\n</pkm-summary>\n' : '';
  Object.assign(j, { status: 'done', pending: [], result: { text: `끝났어요: ${j.prompt}${tail}`, session: j.session } });
  push(j, { type: 'status', job: view(j) }); push(j, { type: 'end' });
}
const ai = http.createServer(async (req, res) => {
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (req.headers.authorization !== 'Bearer test-token-0123456789') return send(401, { error: '토큰' });
  let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
  const u = new URL(req.url, 'http://x'), m = u.pathname.match(/^\/v1\/jobs\/(\w+)(?:\/(\w+))?$/);
  if (u.pathname === '/v1/me') return send(200, me);
  if (u.pathname === '/v1/providers') return send(200, { providers: [
    { id: 'claude', input_images: true, installed: claudeAvailable, logged_in: claudeAvailable, models: [{ id: 'default' }, { id: 'fable' }], efforts: ['high'], agent: { modes: full ? ['read', 'auto', 'full'] : ['read', 'auto'], approvals: true, concurrency: 2, browser: browserOn } },
    { id: 'codex', input_images: true, installed: true, logged_in: true, models: [{ id: 'default' }, { id: 'gpt-test' }], efforts: ['high', 'ultra'], agent: { modes: ['read', 'auto'], approvals: false, concurrency: 2 } },
  ] });
  if (u.pathname === '/v1/plugins') return send(req.method === 'POST' ? 201 : 200, { plugins: approvals });
  const bt = u.pathname.match(/^\/v1\/browser\/tabs\/([^/]+)(?:\/(\w+))?$/);
  if (bt){
    tabHits.push({ key: decodeURIComponent(bt[1]), act: bt[2] || '', body });
    if (bt[2] === 'frame'){ res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(Buffer.from('JPEGDATA')); }
    if (bt[2] === 'input') return send(200, { open: true, url: 'https://shop.example/login', focus: { editable: true, password: body.type === 'click' } });
    return send(200, { open: true, key: decodeURIComponent(bt[1]), url: 'https://shop.example/login', title: '로그인', width: 1280, height: 800 });
  }
  if (u.pathname === '/v1/jobs' && req.method === 'POST'){
    posted.push(body);
    const j = { id: `job${++n}`, provider: body.provider, model: body.model, status: 'running', session: body.agent.session || `sess-${n}`, pending: [], prompt: body.prompt };
    jobs.set(j.id, j);
    if (body.prompt.startsWith('대기제어:')) {} // 개별 취소·우선 반영 테스트의 진행 중 작업
    else if (body.prompt.startsWith('진행 중인 응답을 중지하고')) setTimeout(() => finish(j), 30);
    else if (body.provider === 'claude' && /전환시험대기/.test(body.prompt)) setTimeout(() => { j.status = 'waiting'; push(j, { type: 'status', job: view(j) }); }, 30);
    else if (/브라우저로/.test(body.prompt)) setTimeout(() => { j.pending = [{ id: 'bh-1', tool: 'BrowserHandoff', title: '브라우저에서 해 주세요', description: '쇼핑몰에 로그인해 주세요', input: { message: '쇼핑몰에 로그인해 주세요', tab: body.agent.browser && body.agent.browser.tab } }]; push(j, { type: 'status', job: view(j) }); }, 30);
    else if (/물어봐/.test(body.prompt)) setTimeout(() => { j.pending = [{ id: 'req-1', tool: 'Write', title: 'Write', description: 'a.txt', input: { file_path: '/tmp/a.txt', content: 'hi' } }]; push(j, { type: 'status', job: view(j) }); }, 30);
    else setTimeout(() => finish(j), 30);
    return send(202, { job: view(j) });
  }
  if (m && m[2] === 'events'){
    const j = jobs.get(m[1]);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const w = ev => { if (ev.type === 'end') return res.end(); res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`); };
    w({ type: 'status', job: view(j) });
    if (['done', 'error', 'canceled'].includes(j.status)) return res.end();
    subs.set(j.id, [...(subs.get(j.id) || []), w]);
    return;
  }
  if (m && m[2] === 'answer'){ const j = jobs.get(m[1]); answers.push(body); j.pending = []; setTimeout(() => finish(j), 10); return send(200, { job: view(j) }); }
  if (m && req.method === 'DELETE'){
    const j = jobs.get(m[1]);
    if (rejectStop) return send(503, { error: '중지에 실패했어요' });
    if (delayedStop){
      finishDelayedStop = () => { Object.assign(j, { status: 'canceled', pending: [] }); push(j, { type:'status', job:view(j) }); push(j, { type:'end' }); };
      return send(200, { job:view(j) });
    }
    if (legacyCancel && u.searchParams.get('idle_only') === '1'){
      j.status = 'running';
      finishLegacyCancel = () => { Object.assign(j, { status: 'canceled', pending: [] }); push(j, { type: 'status', job: view(j) }); push(j, { type: 'end' }); };
      return send(200, { job: view(j) });
    }
    if (u.searchParams.get('idle_only') === '1'){
      if (startOnCancel) j.status = 'running';
      if (!['queued', 'waiting'].includes(j.status)) return send(409, { error: '대기 중일 때만 다른 AI로 넘길 수 있어요' });
    }
    Object.assign(j, { status: 'canceled', pending: [] }); push(j, { type: 'status', job: view(j) }); push(j, { type: 'end' }); return send(200, { job: view(j) });
  }
  if (m) return send(200, { job: view(jobs.get(m[1])) });
  send(404, {});
});

let chats, conf;
const pushed = [];
const card = { id: 't1abc', title: '견적서 보내기', status: '진행', path: '03_행동/단기보드/견적서 보내기.md', body: '# 할 일\n- [ ] 초안' };
before(async () => {
  await new Promise(r => ai.listen(0, '127.0.0.1', r));
  conf = { ai: { url: `http://127.0.0.1:${ai.address().port}`, token: 'test-token-0123456789' }, profiles: {} };
  const plugins = await import('../server/plugins.js');
  const ins = await plugins.inspect({ local: new URL('../plugins/ai-chat/', import.meta.url).pathname });
  assert.equal(ins.ok, true, ins.errors.join());
  await plugins.install(path.join(DATA, P), ins.stage);
  const root = (await plugins.list(path.join(DATA, P))).find(x => x.id === 'ai-chat').path;
  approvals = [{ id: 'ai-chat', root, permissions: { ai: ['agent'], agent_mode: 'full', browser: true } }];
  const { createChats } = await import('../server/chats.js');
  const project = { id: 'pabc123', title: '쉐어링크 월 10만', goal: '하루 10분으로 월 10만원', status: 'running', file: '/x/pabc123.json', hub: '/x/설계.md', work: T,
    cards: [{ id: 't1', title: '쉐어링크 월 10만 · 오퍼 — 니치 정하기', status: '진행', path: '03_행동/단기보드/a.md', open: ['🙋 니치 고르기 (3분)'] }] };
  chats = createChats({ DATA, readConf: () => conf, findCard: async (p, id) => id === card.id ? card : null, findProject: async (p, id) => id === project.id ? project : null, onPush: (p, m) => { pushed.push({ p, ...m }); } });
});
after(() => { ai.close(); fs.rmSync(T, { recursive: true, force: true }); });

const until = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;){ const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('시간 초과'); await new Promise(r => setTimeout(r, 20)); } };
const lastTurn = id => { const r = chats.room(P, id); return r.turns[r.turns.length - 1]; };

test('플러그인 규격 — chats/는 scope·프롬프트·모드 상한을 검사한다', async () => {
  const PP = (await import('node:module')).createRequire(import.meta.url)('../web/js/pkm-plugin.js');
  const base = { path: 'plugin.md', size: 0, text: '---\npkm_plugin: 1\nid: chat-x\nname: c\nversion: 0.1.0\npermissions:\n  ai: [agent]\n  agent_mode: auto\n---\n' };
  const ok = PP.validate([base, { path: 'chats/a.md', size: 0, text: '## 데이터\n- scope: profile\n- mode: auto' }]);
  assert.equal(ok.ok, true, ok.errors.join()); assert.equal(ok.chats[0].scope, 'profile');
  const bad = PP.validate([base, { path: 'chats/a.md', size: 0, text: '## 데이터\n- scope: room\n- mode: full\n- prompt: prompts/x.md' }]);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => /scope/.test(e)) && bad.errors.some(e => /상한/.test(e)) && bad.errors.some(e => /프롬프트/.test(e)));
});

test('로컬 전용 — 루프백이 아니거나 다른 컴퓨터의 pkm-ai-server면 열지 않는다', async () => {
  const real = conf.ai;
  conf.ai = { url: 'http://home-mac.example.ts.net:5280', token: real.token };
  let st = await chats.status(P);
  assert.equal(st.ok, false); assert.equal(st.reason, 'remote');
  await assert.rejects(chats.open(P, {}), /다른 컴퓨터/);
  conf.ai = real; me = { host: 'other-mac', user: 'x' };   // 루프백 주소여도 컴퓨터 이름이 다르면(포트 포워딩 등) 열지 않는다
  st = await chats.status(P);
  assert.equal(st.reason, 'other');
  me = { host: os.hostname(), user: os.userInfo().username }; chats.forget();
  st = await chats.status(P);
  assert.equal(st.ok, true, st.message); assert.equal(st.full, true); assert.equal(st.plugin.id, 'ai-chat');
  assert.deepEqual(st.plugin.scopes.map(s => s.scope).sort(), ['card', 'profile', 'project']);
});

test('데이터 방 — 확인 요청을 방에 올리고, 허락하면 이어서 끝내고, 다음 말은 같은 세션으로', async () => {
  const r = await chats.open(P, {});
  assert.equal(r.id, 'data'); assert.equal(r.cwd, path.join(DATA, P));
  await chats.send(P, 'data', { id: 'msg-000001', text: '물어봐 — 단기 하나 만들어 줘' });
  const t = await until(() => { const x = lastTurn('data'); return x.pending.length ? x : null; });
  const body = posted[posted.length - 1];
  assert.equal(body.agent.approvals, true); assert.equal(body.agent.mode, 'full'); assert.equal(body.agent.cwd, path.join(DATA, P));
  assert.deepEqual(body.agent.add_dirs, [DATA]); assert.equal(body.plugin.id, 'ai-chat');
  assert.match(body.system, new RegExp(`지금 프로필: ${P}`)); assert.doesNotMatch(body.system, /\{profile\}|\{today\}/);
  assert.equal(t.pending[0].tool, 'Write');
  await chats.answer(P, 'data', { request_id: 'req-1', allow: true });
  assert.deepEqual(answers[0], { request_id: 'req-1', allow: true, message: '' });
  const done = await until(() => { const x = lastTurn('data'); return x.status === 'done' ? x : null; });
  assert.match(done.reply, /^끝났어요/); assert.ok(done.log.some(l => l.kind === 'note' && /허락함/.test(l.text)));
  const sess = chats.room(P, 'data').session; assert.match(sess, /^sess-/);
  // 같은 id로 다시 보내면 한 번만
  await chats.send(P, 'data', { id: 'msg-000001', text: '물어봐 — 단기 하나 만들어 줘' });
  await assert.rejects(chats.send(P, 'data', { id: 'msg-000001', text: '다른 말' }), /같은 요청 id/);
  await chats.send(P, 'data', { id: 'msg-000002', text: '고마워' });
  await until(() => lastTurn('data').status === 'done');
  assert.equal(posted[posted.length - 1].agent.session, sess);
  assert.equal(chats.room(P, 'data').turns.length, 2);
});

test('카드 방 — 카드 id로 만들고, 카드 내용이 프롬프트에 들어가고, 방끼리는 동시에 돈다', async () => {
  await assert.rejects(chats.open(P, { card: '없는카드' }), /찾지 못했어요/);
  await assert.rejects(chats.open(P, { card: card.id, cwd: path.join(T, '없음') }), /작업 폴더가 없어요/);
  const r = await chats.open(P, { card: card.id, cwd: T });
  assert.equal(r.id, `card-${card.id}`); assert.equal(r.cwd, T); assert.equal(r.card.title, '견적서 보내기');
  assert.equal((await chats.open(P, { card: card.id })).id, r.id);   // 이미 있으면 그 방
  await chats.send(P, r.id, { id: 'card-msg-01', text: '물어봐 — 초안 써 줘' });
  await chats.send(P, 'data', { id: 'msg-000003', text: '오늘 할 일 알려 줘' });
  await until(() => lastTurn(r.id).pending.length && lastTurn('data').status === 'done');   // 카드 방이 답을 기다리는 동안 데이터 방은 끝난다
  const body = posted.find(b => b.agent.cwd === T);
  assert.deepEqual(body.agent.add_dirs, [path.join(DATA, P)]);
  assert.match(body.system, /견적서 보내기 \(ID t1abc/); assert.match(body.system, /- \[ \] 초안/);
  const st = await chats.status(P);
  assert.equal(st.rooms.find(x => x.id === r.id).pending, 1);
  // 지우면 하던 일을 멈추고 방이 사라진다
  await chats.remove(P, r.id);
  assert.throws(() => chats.room(P, r.id), /없는 채팅/);
  assert.ok(!(await chats.status(P)).rooms.some(x => x.id === r.id));
});

test('카드 세션은 작업 폴더 없이 만들고, 나중에 고르면 새 세션으로 앞선 대화를 이어 붙인다', async () => {
  const r = await chats.open(P, { card: card.id });
  assert.equal(r.cwd, null);
  await chats.send(P, r.id, { id: 'nofolder-01', text: '할 일 정리해 줘' });
  await until(() => lastTurn(r.id).status === 'done');
  let body = posted[posted.length - 1];
  assert.equal(body.agent.cwd, path.join(DATA, P)); assert.deepEqual(body.agent.add_dirs, []);
  assert.match(body.system, /작업 폴더: 아직 고르지 않았어요/);
  const sess = chats.room(P, r.id).session; assert.ok(sess);
  // 폴더 목록 — 숨김 폴더는 빼고, git 저장소는 프로젝트로
  fs.mkdirSync(path.join(T, 'proj', '.git'), { recursive: true }); fs.mkdirSync(path.join(T, 'plain')); fs.mkdirSync(path.join(T, '.hidden'));
  const d = await chats.dirs(P, T);
  assert.equal(d.path, T); assert.equal(d.dirs[0].name, 'proj'); assert.equal(d.dirs[0].git, true);
  assert.ok(!d.dirs.some(x => x.name.startsWith('.'))); assert.ok(d.dirs.some(x => x.name === 'plain'));
  await assert.rejects(chats.dirs(P, path.join(T, '없음')), /폴더가 없어요/);
  // 고르면 세션을 비우고 다음 말에 앞선 대화를 붙인다
  await assert.rejects(chats.setCwd(P, r.id, path.join(T, '없음')), /작업 폴더가 없어요/);
  const r2 = await chats.setCwd(P, r.id, path.join(T, 'proj'));
  assert.equal(r2.cwd, path.join(T, 'proj')); assert.equal(r2.session, null);
  assert.equal((await chats.status(P)).recent[0], path.join(T, 'proj'));
  await chats.send(P, r.id, { id: 'nofolder-02', text: '테스트 돌려 줘' });
  await until(() => lastTurn(r.id).status === 'done');
  body = posted[posted.length - 1];
  assert.equal(body.agent.cwd, path.join(T, 'proj')); assert.deepEqual(body.agent.add_dirs, [path.join(DATA, P)]); assert.equal(body.agent.session, undefined);
  assert.match(body.prompt, /앞선 대화:\n사용자: 할 일 정리해 줘/); assert.match(body.prompt, /테스트 돌려 줘$/);
  // 하는 중에는 바꿀 수 없고, 데이터 방은 폴더를 고르지 않는다
  await chats.send(P, r.id, { id: 'nofolder-03', text: '물어봐 — 계속' });
  await until(() => lastTurn(r.id).pending.length);
  await assert.rejects(chats.setCwd(P, r.id, T), /하는 중/);
  await chats.cancel(P, r.id);
  await assert.rejects(chats.setCwd(P, 'data', T), /카드·프로젝트 세션에서만/);
  await chats.remove(P, r.id);
});

test('새 대화는 기록과 세션을 비우고, 기록은 이 컴퓨터의 파일에 남는다', async () => {
  const f = path.join(process.env.PKM_HOME, 'chats', `${encodeURIComponent(P)}.json`);
  await until(() => fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).rooms.length);
  assert.equal((fs.statSync(f).mode & 0o777).toString(8), '600');
  const r = await chats.reset(P, 'data');
  assert.equal(r.session, null); assert.equal(r.turns.length, 0);
});

test('full을 허용하지 않은 서버면 자동 권한 모드로 돌리고 그렇다고 남긴다', async () => {
  full = false; chats.forget();
  assert.equal((await chats.status(P)).full, false);
  await chats.send(P, 'data', { id: 'msg-000004', text: '정리해 줘' });
  const t = await until(() => { const x = lastTurn('data'); return x.status === 'done' ? x : null; });
  assert.equal(posted[posted.length - 1].agent.mode, 'auto');
  assert.ok(t.log.some(l => /자동 권한 모드/.test(l.text)));
  full = true; chats.forget();
});

test('메모 — 방마다 적고 지우며, 새 대화에도 남고 AI에게는 보내지 않는다', async () => {
  const r = await chats.open(P, { card: card.id });
  const m = await chats.setMemo(P, r.id, '  결과 열어서 실패한 테스트부터 보기 \r\n');
  assert.equal(m.memo.text, '결과 열어서 실패한 테스트부터 보기'); assert.ok(m.memo.at);
  assert.equal((await chats.status(P)).rooms.find(x => x.id === r.id).memo.text, m.memo.text);
  await chats.send(P, r.id, { id: 'memo-0001', text: '이어서 해 줘' });
  await until(() => lastTurn(r.id).status === 'done');
  assert.doesNotMatch(JSON.stringify(posted[posted.length - 1]), /실패한 테스트부터/);
  assert.equal((await chats.reset(P, r.id)).memo.text, m.memo.text);
  await assert.rejects(chats.setMemo(P, r.id, 'x'.repeat(2001)), /2천 자/);
  assert.equal((await chats.setMemo(P, r.id, '  ')).memo, null);
  await assert.rejects(chats.setMemo(P, 'card-없음', '메모'), /없는 채팅/);
  await chats.remove(P, r.id);
});

test('방 상태 — 대화 없음 → 하는 중 → 확인 요청 → 새 답 → 읽으면 내 차례, 멈추면 멈춤', async () => {
  const id = `card-${card.id}`, stOf = async () => (await chats.status(P)).rooms.find(x => x.id === id);
  await chats.open(P, { card: card.id });
  assert.equal((await stOf()).state, 'idle');
  await chats.send(P, id, { id: 'state-msg-01', text: '물어봐 — 표 만들어 줘' });
  assert.ok(['run', 'ask'].includes((await stOf()).state));
  await until(async () => (await stOf()).state === 'ask');
  await chats.answer(P, id, { request_id: 'req-1', allow: true });
  await until(async () => (await stOf()).state === 'new');
  assert.equal((await stOf()).unread, true);
  const s1 = chats.markRead(P, id);
  assert.equal(s1.state, 'reply'); assert.equal(s1.unread, false);
  assert.equal(chats.markRead(P, id).read, s1.read);   // 이미 읽었으면 그대로
  chats.room(P, id).turns.at(-1).status = 'error';
  assert.equal((await stOf()).state, 'bad');
  await chats.reset(P, id);
  assert.equal((await stOf()).state, 'idle');
  await chats.remove(P, id);
});

test('요약 — 답 끝의 <pkm-summary>를 떼어 턴에 두고, 시스템 프롬프트로 요청한다', async () => {
  const { splitSummary } = await import('../server/chats.js');
  assert.deepEqual(splitSummary('그냥 답'), { text: '그냥 답', summary: null });
  assert.deepEqual(splitSummary('답\n<pkm-summary>\n질문： 가\n</pkm-summary>'), { text: '답', summary: { q: '가', a: '' } });
  assert.equal(splitSummary('답\n<pkm-summary>\n질문: 가\n답: 나').text, '답');   // 닫는 태그가 없어도 뗀다
  assert.equal(splitSummary('답\n<pkm-summary>엉뚱</pkm-summary>').summary, null);
  await chats.send(P, 'data', { id: 'sum-000001', text: '요약해 — 테스트 고쳐 줘' });
  const t = await until(() => { const x = lastTurn('data'); return x.status === 'done' ? x : null; });
  assert.match(posted[posted.length - 1].system, /<pkm-summary>/);
  assert.equal(t.reply, '끝났어요: 요약해 — 테스트 고쳐 줘');
  assert.deepEqual(t.summary, { q: '테스트 실패 원인을, 네트워크 문제는 빼고 찾아 달라고 함', a: '날짜 계산 버그를 고쳐 테스트 통과, 문서는 남음' });
  await chats.send(P, 'data', { id: 'sum-000002', text: '고마워' });
  assert.equal((await until(() => { const x = lastTurn('data'); return x.status === 'done' ? x : null; })).summary, undefined);
});

test('프로젝트 세션 — 프로젝트마다 방 하나, 처음 작업 폴더는 그 프로젝트의 AI 작업 폴더, 프롬프트에 목표와 카드 목록', async () => {
  await assert.rejects(chats.open(P, { project: 'pnone00' }), /프로젝트를 찾지 못했어요/);
  const r = await chats.open(P, { project: 'pabc123' });
  assert.equal(r.id, 'project-pabc123'); assert.equal(r.kind, 'project'); assert.equal(r.cwd, T); assert.equal(r.card.title, '쉐어링크 월 10만');
  assert.equal((await chats.open(P, { project: 'pabc123' })).id, r.id);   // 다시 열면 같은 방
  await chats.send(P, r.id, { id: 'proj-01', text: '이번 주 할 일 정리해 줘' });
  await until(() => lastTurn(r.id).status === 'done');
  const body = posted[posted.length - 1];
  assert.equal(body.agent.cwd, T); assert.deepEqual(body.agent.add_dirs, [path.join(DATA, P)]);
  assert.match(body.system, /프로젝트: 쉐어링크 월 10만 \(ID pabc123/);
  assert.match(body.system, /목표: 하루 10분으로 월 10만원/);
  assert.match(body.system, /- \[진행\] 쉐어링크 월 10만 · 오퍼 — 니치 정하기[\s\S]*🙋 니치 고르기/);
  assert.ok((await chats.setCwd(P, r.id, null)).cwd === null, '프로젝트 방도 작업 폴더를 바꿀 수 있다');
  await chats.remove(P, r.id);
});

test('GPT 선택을 모델·effort와 함께 실행하고, AI를 바꿔도 대화 맥락을 잇는다', async () => {
  const oldSession = chats.room(P, 'data').session;
  assert.ok(oldSession);
  await chats.send(P, 'data', { id: 'gpt-turn-01', text: 'GPT로 이어서 답해 줘', provider: 'codex', model: 'gpt-test', effort: 'ultra' });
  const t = await until(() => { const x = lastTurn('data'); return x.status === 'done' ? x : null; });
  const body = posted.at(-1);
  assert.equal(body.provider, 'codex'); assert.equal(body.model, 'gpt-test'); assert.equal(body.effort, 'ultra');
  assert.equal(body.agent.mode, 'auto'); assert.equal(body.agent.approvals, undefined);
  assert.equal(body.agent.session, undefined, 'Claude 세션을 Codex로 넘기지 않는다');
  assert.match(body.prompt, /AI를 바꿔[\s\S]*앞선 대화/);
  assert.equal(t.provider, 'codex'); assert.equal(t.model, 'gpt-test');
  const session = chats.room(P, 'data').session;
  assert.notEqual(session, oldSession);
  assert.equal(chats.room(P, 'data').sessionProvider, 'codex');
  await chats.send(P, 'data', { id: 'gpt-turn-02', text: '같은 GPT로 이어 줘', provider: 'codex', model: 'gpt-test', effort: 'high' });
  await until(() => lastTurn('data').status === 'done');
  assert.equal(posted.at(-1).agent.session, session);
  assert.equal(posted.at(-1).effort, 'high');
  await chats.send(P, 'data', { id: 'claude-back-01', text: 'Claude로 바꿔 줘', provider: 'claude', model: 'fable', effort: 'high' });
  await until(() => lastTurn('data').status === 'done');
  assert.equal(posted.at(-1).provider, 'claude'); assert.equal(posted.at(-1).model, 'fable');
  assert.equal(posted.at(-1).agent.session, undefined, 'Codex 세션도 Claude로 넘기지 않는다');
  assert.match(posted.at(-1).prompt, /같은 GPT로 이어 줘/);
});

test('Claude가 없어도 GPT로 채팅하며 선택한 AI가 없으면 다른 AI로 돌리지 않는다', async () => {
  claudeAvailable = false; chats.forget();
  try {
    assert.equal((await chats.status(P)).ok, true);
    await chats.send(P, 'data', { id: 'gpt-only-01', text: 'GPT만으로 답해 줘', provider: 'codex', model: 'gpt-test' });
    await until(() => lastTurn('data').status === 'done');
    assert.equal(posted.at(-1).provider, 'codex');
    const count = posted.length, turns = chats.room(P, 'data').turns.length;
    await assert.rejects(chats.send(P, 'data', { id: 'bad-provider', text: '안 됨', provider: 'claude' }), /선택한 AI를 쓸 수 없어요/);
    await assert.rejects(chats.send(P, 'data', { id: 'bad-model', text: '안 됨', provider: 'codex', model: 'fable' }), /모델이 아니에요/);
    await assert.rejects(chats.send(P, 'data', { id: 'bad-effort', text: '안 됨', provider: 'codex', effort: 'invalid' }), /생각하는 정도/);
    assert.equal(posted.length, count); assert.equal(chats.room(P, 'data').turns.length, turns);
  } finally { claudeAvailable = true; chats.forget(); }
});

test('차례를 기다리는 말도 접수할 때 고른 AI와 모델을 유지한다', async () => {
  const start = posted.length;
  await chats.send(P, 'data', { id: 'queue-gpt-01', text: '먼저 GPT', provider: 'codex', model: 'gpt-test', effort: 'high' });
  await chats.send(P, 'data', { id: 'queue-claude-02', text: '다음 Claude', provider: 'claude', model: 'fable' });
  await until(() => lastTurn('data').status === 'done');
  assert.deepEqual(posted.slice(start).map(x => [x.provider, x.model]), [['codex', 'gpt-test'], ['claude', 'fable']]);
});

test('대기 중인 Claude를 중단하고 지시·진행 기록·작업 폴더를 넘겨 GPT로 한 번만 이어간다', async () => {
  const at = posted.length;
  await chats.send(P, 'data', { id: 'move-source-01', text: '전환시험대기: 로컬만 수정, 원격에 올리지 마. 남은 테스트를 마무리해 줘', provider: 'claude', model: 'fable' });
  const source = await until(() => { const t = lastTurn('data'); return t.status === 'waiting' ? t : null; });
  source.log.push({ kind: 'tool', tool: 'Read', text: '파일 a.js까지 확인, 테스트 b가 남음' });
  const oldSession = chats.room(P, 'data').session;
  const request = { id: 'move-target-01', turn_id: source.id, provider: 'codex', model: 'gpt-test', effort: 'high' };
  const moved = await chats.handoff(P, 'data', request);
  await until(() => moved.status === 'done');
  assert.equal(source.status, 'canceled'); assert.equal(jobs.get(source.job).status, 'canceled');
  assert.equal(source.continued_by, moved.id); assert.equal(moved.handoff.from_provider, 'claude');
  assert.equal(moved.text, source.text); assert.equal(moved.provider, 'codex');
  const body = posted.at(-1);
  assert.equal(body.provider, 'codex'); assert.equal(body.model, 'gpt-test'); assert.equal(body.effort, 'high');
  assert.equal(body.agent.session, undefined); assert.equal(body.agent.cwd, path.join(DATA, P));
  assert.match(body.prompt, /로컬만 수정, 원격에 올리지 마/); assert.match(body.prompt, /파일 a.js까지 확인, 테스트 b가 남음/);
  assert.match(body.prompt, /이미 끝낸 일을 반복하지 말고/);
  assert.notEqual(chats.room(P, 'data').session, oldSession);
  assert.equal(await chats.handoff(P, 'data', request), moved);
  assert.equal(posted.length, at + 2, '같은 전환 재요청은 중복 실행하지 않는다');
  await assert.rejects(chats.handoff(P, 'data', { ...request, model: 'default' }), /같은 요청 id/);
  await assert.rejects(chats.handoff(P, 'data', { ...request, id: 'move-again-02' }), /대기 중인 요청/);
});

test('전환할 AI가 없거나 기존 요청이 실행을 재개했으면 GPT를 시작하지 않는다', async () => {
  await chats.send(P, 'data', { id: 'move-race-source', text: '전환시험대기: 확인 중', provider: 'claude' });
  const source = await until(() => { const t = lastTurn('data'); return t.status === 'waiting' ? t : null; });
  const count = posted.length;
  await assert.rejects(chats.handoff(P, 'data', { id: 'move-no-provider', turn_id: source.id, provider: 'missing' }), /선택한 AI/);
  assert.equal(source.status, 'waiting'); assert.equal(jobs.get(source.job).status, 'waiting');
  startOnCancel = true;
  try { await assert.rejects(chats.handoff(P, 'data', { id: 'move-race-target', turn_id: source.id, provider: 'codex' }), /대기 중일 때만/); }
  finally { startOnCancel = false; }
  assert.equal(posted.length, count); assert.equal(source.continued_by, undefined);
  await chats.cancel(P, 'data');
  await until(() => source.status === 'canceled');
});

test('앞선 요청이 기다리는 동안 뒤의 미실행 요청도 전환하며 원래 대화 순서를 유지한다', async () => {
  await chats.send(P, 'data', { id: 'move-blocker-01', text: '전환시험대기: 먼저 할 일', provider: 'claude' });
  const blocker = await until(() => { const t = lastTurn('data'); return t.status === 'waiting' ? t : null; });
  const queued = await chats.send(P, 'data', { id: 'move-queued-01', text: '그 다음 할 일', provider: 'claude' });
  assert.equal(queued.status, 'queued'); assert.equal(queued.job, null);
  const session = chats.room(P, 'data').session, count = posted.length;
  const second = await chats.handoff(P, 'data', { id: 'move-queued-gpt', turn_id: queued.id, provider: 'codex', model: 'gpt-test' });
  assert.equal(queued.status, 'canceled'); assert.equal(second.status, 'queued');
  assert.equal(chats.room(P, 'data').session, session); assert.equal(posted.length, count);
  const first = await chats.handoff(P, 'data', { id: 'move-blocker-gpt', turn_id: blocker.id, provider: 'codex', model: 'gpt-test' });
  await until(() => first.status === 'done' && second.status === 'done');
  assert.equal(posted.length, count + 2); assert.match(posted[count].prompt, /먼저 할 일/); assert.match(posted[count + 1].prompt, /그 다음 할 일/);
  assert.ok(posted.slice(count).every(x => x.provider === 'codex'));
});

test('구버전 AI 서버에서도 기존 작업의 종료를 확인한 뒤 다른 AI를 시작한다', async () => {
  await chats.send(P, 'data', { id: 'move-legacy-source', text: '전환시험대기: 종료 확인', provider: 'claude' });
  const source = await until(() => { const t = lastTurn('data'); return t.status === 'waiting' ? t : null; });
  legacyCancel = true;
  try {
    const promise = chats.handoff(P, 'data', { id: 'move-legacy-target', turn_id: source.id, provider: 'codex', model: 'gpt-test' });
    await until(() => finishLegacyCancel);
    assert.equal(jobs.get(source.job).status, 'running');
    assert.equal(chats.room(P, 'data').turns.some(t => t.id === 'move-legacy-target'), false, '종료 전에는 이어갈 요청을 만들지 않는다');
    finishLegacyCancel(); finishLegacyCancel = null;
    const moved = await promise;
    assert.equal(jobs.get(source.job).status, 'canceled');
    await until(() => moved.status === 'done');
    assert.equal(moved.provider, 'codex');
  } finally { legacyCancel = false; }
});


test('사진·영상만 전송해도 Claude·GPT에 실제 이미지 경로와 시간 정보가 전달된다', async () => {
  await chats.reset(P, 'data');
  const image = path.join(T, 'photo.png'), video = path.join(T, 'video.mp4');
  execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=red:s=160x90','-frames:v','1',image]);
  execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc=size=160x90:rate=4','-t','2','-pix_fmt','yuv420p',video]);
  const upload = (file, mime) => chats.upload(P,'data',Object.assign(Readable.from([fs.readFileSync(file)]),{headers:{'content-type':mime}}),path.basename(file));
  const photo = await upload(image,'image/png'), movie = await upload(video,'video/mp4');
  for (const provider of ['claude','codex']){
    const t = await chats.send(P,'data',{id:`media-${provider}`,text:'',attachments:[photo.id,movie.id],provider});
    await until(() => t.status === 'done');
    const body = posted.at(-1);
    assert.equal(body.provider,provider); assert.equal(body.images.length,3);
    assert.ok(body.images.every(i => i.mime === 'image/jpeg' && fs.existsSync(i.path)));
    assert.match(body.prompt,/첨부한 사진·영상/); assert.match(body.prompt,/0.00초, 1.00초/);
    assert.deepEqual(t.attachments.map(a=>a.id),[photo.id,movie.id]);
    assert.equal(await chats.send(P,'data',{id:`media-${provider}`,text:'',attachments:[photo.id,movie.id],provider}),t,'재전송해도 한 번만 실행');
    await assert.rejects(chats.send(P,'data',{id:`media-${provider}`,text:'',attachments:[photo.id],provider}),{status:409});
  }
  await assert.rejects(chats.send(P,'data',{text:'파일 확인',attachments:['../../elsewhere']}),{status:400});
});

test('대기 메시지 하나만 발송 취소하고 진행 중인 작업·다른 대기·다른 방은 유지한다', async () => {
  await chats.reset(P,'data');
  await chats.send(P,'data',{id:'queue-cancel-active',text:'대기제어: 원래 작업',provider:'codex'});
  const active=await until(()=>{const t=lastTurn('data');return t.job?t:null;});
  const second=await chats.send(P,'data',{id:'queue-cancel-second',text:'취소할 메시지',provider:'codex'});
  const third=await chats.send(P,'data',{id:'queue-cancel-third',text:'유지할 메시지',provider:'codex'});
  const other=await chats.open(P,{card:card.id});
  await chats.send(P,other.id,{id:'queue-other-active',text:'대기제어: 다른 방 작업',provider:'codex'});
  const otherTurn=await until(()=>lastTurn(other.id).job?lastTurn(other.id):null);
  const count=posted.length;
  assert.equal(await chats.cancelTurn(P,'data',{turn_id:second.id}),second);
  assert.equal(second.status,'canceled');assert.equal(second.cancel_kind,'send');assert.equal(third.status,'queued');
  assert.equal(jobs.get(active.job).status,'running');assert.equal(jobs.get(otherTurn.job).status,'running');assert.equal(posted.length,count);
  assert.equal(await chats.cancelTurn(P,'data',{turn_id:second.id}),second);
  await chats.cancelTurn(P,'data',{turn_id:third.id});
  assert.equal((await chats.status(P)).rooms.find(r=>r.id==='data').status,'running','대기 발송 취소로 실행 중 표시가 사라지지 않는다');
  await assert.rejects(chats.cancelTurn(P,'data',{turn_id:active.id}),/이미 실행/);
  await chats.cancel(P,'data');await chats.cancel(P,other.id);
  await until(()=>active.status==='canceled'&&otherTurn.status==='canceled');
});

test('지금 반영은 현재 응답을 멈추고 선택한 메시지를 우선 실행하며 다른 대기는 유지한다', async () => {
  await chats.reset(P,'data');const at=posted.length;
  await chats.send(P,'data',{id:'queue-now-active',text:'대기제어: 원격 push 없이 기존 목표 완성',provider:'claude'});
  const active=await until(()=>lastTurn('data').job?lastTurn('data'):null);
  active.log.push({kind:'tool',tool:'Read',text:'a.js 수정 완료, 남은 작업은 b.js'});
  const waiting=await chats.send(P,'data',{id:'queue-now-waiting',text:'보류된다른요청_ONLYB',provider:'claude'});
  const selected=await chats.send(P,'data',{id:'queue-now-selected',text:'기존 색은 유지하고 패딩만 고쳐',provider:'codex',model:'gpt-test',effort:'ultra'});
  assert.equal(await chats.runNow(P,'data',{turn_id:selected.id}),selected);
  await until(()=>selected.status==='done'&&waiting.status==='done');
  assert.equal(active.status,'canceled');assert.equal(jobs.get(active.job).status,'canceled');assert.equal(active.interrupted_by,selected.id);
  assert.deepEqual(posted.slice(at).map(b=>b.provider),['claude','codex','claude']);
  const body=posted[at+1];assert.equal(body.model,'gpt-test');assert.equal(body.effort,'ultra');
  assert.match(body.prompt,/원격 push 없이 기존 목표 완성/);assert.match(body.prompt,/a.js 수정 완료/);assert.match(body.prompt,/패딩만 고쳐/);
  assert.doesNotMatch(body.prompt,/보류된다른요청_ONLYB/);assert.equal(body.agent.session,undefined,'다른 AI일 때 내부 세션은 섞지 않는다');
  assert.deepEqual(chats.room(P,'data').turns.map(t=>t.id),[active.id,waiting.id,selected.id],'화면의 메시지 순서를 바꾸지 않는다');
  assert.equal((await chats.status(P)).rooms.find(r=>r.id==='data').finished,waiting.finished,'방 목록에는 마지막으로 완료된 답을 보여 준다');
  const count=posted.length;assert.equal(await chats.runNow(P,'data',{turn_id:selected.id}),selected);assert.equal(posted.length,count);
});

test('현재 작업이 실제로 멈추기 전에는 우선 메시지를 실행하지 않는다', async () => {
  await chats.reset(P,'data');
  await chats.send(P,'data',{id:'queue-stop-active',text:'대기제어: 종료 대기',provider:'codex'});
  const active=await until(()=>lastTurn('data').job?lastTurn('data'):null);
  const selected=await chats.send(P,'data',{id:'queue-stop-selected',text:'먼저 반영할 수정',provider:'codex'});
  const other=await chats.send(P,'data',{id:'queue-stop-other',text:'그 다음 작업',provider:'codex'});
  const count=posted.length;delayedStop=true;
  try{
    const pending=chats.runNow(P,'data',{turn_id:selected.id});
    await until(()=>finishDelayedStop);
    assert.equal(posted.length,count);assert.equal(selected.status,'queued');assert.equal(jobs.get(active.job).status,'running');
    await assert.rejects(chats.cancelTurn(P,'data',{turn_id:other.id}),/처리 중/);
    finishDelayedStop();finishDelayedStop=null;delayedStop=false;
    await pending;await until(()=>selected.status==='done'&&other.status==='done');
    assert.equal(posted[count].agent.session,jobs.get(active.job).session,'같은 AI 세션에서 기존 작업 맥락을 이어간다');
  }finally{delayedStop=false;if(finishDelayedStop){finishDelayedStop();finishDelayedStop=null;}}
});

test('AI 서버 대기 메시지는 하나만 취소하고, 취소 직전 실행이 시작되면 거절한다', async () => {
  await chats.reset(P,'data');
  await chats.send(P,'data',{id:'queue-race-active',text:'대기제어: 대기 취소 경합',provider:'codex'});
  const source=await until(()=>lastTurn('data').job?lastTurn('data'):null), job=jobs.get(source.job);
  job.status='queued';push(job,{type:'status',job:view(job)});await until(()=>source.status==='queued');
  startOnCancel=true;
  try{await assert.rejects(chats.cancelTurn(P,'data',{turn_id:source.id}),/대기 중일 때만/);}
  finally{startOnCancel=false;}
  assert.equal(job.status,'running');assert.notEqual(source.status,'canceled');
  job.status='waiting';push(job,{type:'status',job:view(job)});await until(()=>source.status==='waiting');
  await chats.cancelTurn(P,'data',{turn_id:source.id});assert.equal(job.status,'canceled');assert.equal(source.status,'canceled');
});

test('중단 요청이 실패하면 진행 중인 작업과 선택한 대기 메시지를 그대로 둔다', async()=>{
  await chats.reset(P,'data');
  await chats.send(P,'data',{id:'queue-fail-active',text:'대기제어: 중단 실패',provider:'codex'});
  const active=await until(()=>lastTurn('data').job?lastTurn('data'):null);
  const selected=await chats.send(P,'data',{id:'queue-fail-selected',text:'추가 지시 보존',provider:'codex'}),count=posted.length;
  rejectStop=true;
  try{await assert.rejects(chats.runNow(P,'data',{turn_id:selected.id}),/중지에 실패/);}
  finally{rejectStop=false;}
  assert.equal(posted.length,count);assert.equal(jobs.get(active.job).status,'running');assert.equal(selected.status,'queued');assert.equal(selected.immediate,undefined);
  await chats.cancel(P,'data');await until(()=>active.status==='canceled');
});

test('지금 반영할 때 원래 작업의 사진과 추가 지시의 사진을 함께 전달한다',async()=>{
  await chats.reset(P,'data');
  const upload=()=>chats.upload(P,'data',Object.assign(Readable.from([fs.readFileSync(path.join(T,'photo.png'))]),{headers:{'content-type':'image/png'}}),'photo.png');
  const original=await upload(),addition=await upload();
  await chats.send(P,'data',{id:'queue-image-active',text:'대기제어: 원래 사진의 배치 유지',provider:'codex',attachments:[original.id]});
  await until(()=>lastTurn('data').job);
  const selected=await chats.send(P,'data',{id:'queue-image-selected',text:'추가 사진처럼 여백 조정',provider:'codex',attachments:[addition.id]});
  await chats.runNow(P,'data',{turn_id:selected.id});await until(()=>selected.status==='done');
  assert.equal(posted.at(-1).images.length,2);assert.equal(selected.attachments.length,1,'추가 지시에 보이는 첨부는 그대로 둔다');
});

test('알림 — 말마다 시작·확인 요청·끝을 한 번씩만, 채팅을 여는 주소와 함께', async () => {
  await chats.open(P, {});
  await chats.send(P, 'data', { id: 'push-msg-01', text: '물어봐 — 알림 확인' });
  await until(() => lastTurn('data').pending.length);
  await chats.answer(P, 'data', { request_id: 'req-1', allow: true });
  await until(() => lastTurn('data').status === 'done');
  await new Promise(r => setTimeout(r, 50));
  const mine = pushed.filter(m => m.tag === 'data:push-msg-01');
  assert.deepEqual(mine.map(m => m.kind), ['run', 'ask', 'done']);
  assert.ok(mine.every(m => m.p === P && m.room === 'data' && m.url === `/?chat=data&profile=${encodeURIComponent(P)}`));
  assert.equal(mine[1].title, '답해 주세요 · 데이터 관리'); assert.match(mine[1].body, /^허락이 필요해요 — a\.txt/);
  assert.equal(mine[2].title, '답이 왔어요 · 데이터 관리'); assert.match(mine[2].body, /^끝났어요/);
});

test('실시간 현황 — 하는 중인 방은 시작 시각·보낸 말·지금 하는 일, 확인 요청이면 그 내용을 요약에 싣는다', async () => {
  await chats.open(P, {});
  await chats.send(P, 'data', { id: 'live-msg-01', text: '물어봐 — 현황 확인' });
  const s = await until(async () => { const x = (await chats.status(P)).rooms.find(r => r.id === 'data'); return x.state === 'ask' ? x : null; });
  assert.equal(s.asked, '물어봐 — 현황 확인'); assert.ok(s.started); assert.equal(s.question, 'a.txt'); assert.equal(typeof s.doing, 'string');
  await chats.answer(P, 'data', { request_id: 'req-1', allow: true });
  await until(() => lastTurn('data').status === 'done');
  const e = (await chats.status(P)).rooms.find(r => r.id === 'data');
  assert.equal(e.asked, undefined); assert.equal(e.doing, undefined);
});

test('브라우저 — 승인에 브라우저가 있으면 방마다 탭 하나를 붙이고, 사람에게 넘긴 일은 방에 띄워 [다 했어요]로 잇는다', async () => {
  const st = await chats.status(P);
  assert.equal(st.browser.ok, true);
  await chats.open(P, {});
  await chats.send(P, 'data', { id: 'browser-msg-01', text: '브라우저로 주문 내역 봐 줘' });
  const t = await until(() => { const x = lastTurn('data'); return x.pending.length ? x : null; });
  const tab = posted[posted.length - 1].agent.browser.tab;
  assert.match(tab, /^chat:[0-9a-f]{10}:data$/);
  assert.equal(t.pending[0].tool, 'BrowserHandoff');
  const ask = pushed.filter(m => m.tag === 'data:browser-msg-01' && m.kind === 'ask')[0];
  assert.equal(ask.body, '브라우저에서 해 주세요 — 쇼핑몰에 로그인해 주세요');
  // 사람이 채팅 창에서 같은 탭을 보고 누르고 적는다 — 이 방의 탭 키로 중계
  assert.equal((await chats.browser(P, 'data', 'info')).title, '로그인');
  assert.equal(String(await chats.browser(P, 'data', 'frame')), 'JPEGDATA');
  const r = await chats.browser(P, 'data', 'input', { type: 'click', x: 10, y: 20 });
  assert.equal(r.focus.password, true);
  assert.ok(tabHits.slice(-3).every(h => h.key === tab));
  assert.deepEqual(tabHits[tabHits.length - 1].body, { type: 'click', x: 10, y: 20 });
  await chats.answer(P, 'data', { request_id: 'bh-1', allow: true });
  assert.equal(answers[answers.length - 1].message, '');
  const done = await until(() => lastTurn('data').status === 'done' ? lastTurn('data') : null);
  assert.ok(done.log.some(x => x.kind === 'note' && x.text === '다 했어요 · 쇼핑몰에 로그인해 주세요'));
});

test('브라우저 — 못 했다고 하면 그 말이 가고, 승인에 브라우저가 없으면 브라우저 없이 하고 다시 승인하라고 남긴다', async () => {
  await chats.send(P, 'data', { id: 'browser-msg-02', text: '브라우저로 다시' });
  await until(() => lastTurn('data').pending.length);
  await chats.answer(P, 'data', { request_id: 'bh-1', allow: false, message: '인증 문자가 안 와요' });
  assert.equal(answers[answers.length - 1].message, '인증 문자가 안 와요');
  await until(() => lastTurn('data').status === 'done');
  const keep = approvals;
  approvals = [{ ...keep[0], permissions: { ai: ['agent'], agent_mode: 'full' } }]; chats.forget();
  assert.equal((await chats.status(P)).browser.reason, 'approve');
  await chats.send(P, 'data', { id: 'browser-msg-03', text: '그냥 해 줘' });
  const t = await until(() => lastTurn('data').status === 'done' ? lastTurn('data') : null);
  assert.equal(posted[posted.length - 1].agent.browser, undefined);
  assert.ok(t.log.some(x => x.kind === 'note' && /브라우저 없이 해요 — .*다시 승인/.test(x.text)));
  approvals = keep; browserOn = false; chats.forget();
  assert.equal((await chats.status(P)).browser.reason, 'old');
  await assert.rejects(chats.browser(P, 'data', 'info'), /옛 버전/);
  browserOn = true; chats.forget();
});
