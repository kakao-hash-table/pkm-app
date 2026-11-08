// AI 챗봇 — 가짜 pkm-ai-server(진행 스트림·확인 요청·답하기)로 로컬 확인·데이터 방·카드 방·세션 이어 가기·지우기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-chats-'));
process.env.PKM_HOME = path.join(T, 'home');
const DATA = path.join(T, 'data'), P = '개인';
fs.mkdirSync(path.join(DATA, P), { recursive: true });

// 가짜 pkm-ai-server — 말에 "물어봐"가 있으면 Write 확인 요청을 띄우고 답을 기다린다
const posted = [], answers = [], jobs = new Map(), subs = new Map();
let n = 0, me = { host: os.hostname(), user: os.userInfo().username }, full = true;
const view = j => ({ id: j.id, status: j.status, session: j.session, pending: j.pending, result: j.result || null, error: null });
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
  if (u.pathname === '/v1/providers') return send(200, { providers: [{ id: 'claude', installed: true, logged_in: true, agent: { modes: full ? ['read', 'auto', 'full'] : ['read', 'auto'], approvals: true, concurrency: 2 } }] });
  if (u.pathname === '/v1/plugins') return send(req.method === 'POST' ? 201 : 200, { plugins: [] });
  if (u.pathname === '/v1/jobs' && req.method === 'POST'){
    posted.push(body);
    const j = { id: `job${++n}`, status: 'running', session: body.agent.session || `sess-${n}`, pending: [], prompt: body.prompt };
    jobs.set(j.id, j);
    if (/물어봐/.test(body.prompt)) setTimeout(() => { j.pending = [{ id: 'req-1', tool: 'Write', title: 'Write', description: 'a.txt', input: { file_path: '/tmp/a.txt', content: 'hi' } }]; push(j, { type: 'status', job: view(j) }); }, 30);
    else setTimeout(() => finish(j), 30);
    return send(202, { job: view(j) });
  }
  if (m && m[2] === 'events'){
    const j = jobs.get(m[1]);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const w = ev => { if (ev.type === 'end') return res.end(); res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`); };
    w({ type: 'status', job: view(j) });
    if (j.status === 'done') return res.end();
    subs.set(j.id, [...(subs.get(j.id) || []), w]);
    return;
  }
  if (m && m[2] === 'answer'){ const j = jobs.get(m[1]); answers.push(body); j.pending = []; setTimeout(() => finish(j), 10); return send(200, { job: view(j) }); }
  if (m && req.method === 'DELETE'){ const j = jobs.get(m[1]); Object.assign(j, { status: 'canceled', pending: [] }); push(j, { type: 'status', job: view(j) }); push(j, { type: 'end' }); return send(200, { job: view(j) }); }
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
