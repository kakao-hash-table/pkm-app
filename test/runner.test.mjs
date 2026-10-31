// 플러그인 실행기 — 가짜 AI 서버(스크립트를 바로 실행)로 목록 가져오기·자동 시작·묻고 답하기·사람 확인·다른 기기의 답·돌리는 컴퓨터 옮기기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-runner-'));
Object.assign(process.env, { PKM_HOME: path.join(T, 'home'), PKM_HOST_NAME: '회사맥', PKM_RUNNER_TICK: '999999' });
const DATA = path.join(T, 'data'), P = '회사';
fs.mkdirSync(path.join(DATA, P), { recursive: true });

// 가짜 pkm-ai-server — 플러그인 스크립트를 그 자리에서 실행하고 결과를 돌려준다
const jobs = new Map(), approvals = [], secrets = {};
let n = 0;
const ai = http.createServer(async (req, res) => {
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (req.headers.authorization !== 'Bearer test-token-0123456789') return send(401, { error: '토큰' });
  let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/v1/plugins') return req.method === 'POST' ? (approvals.push(body), send(201, { plugin: body })) : send(200, { plugins: approvals });
  if (u.pathname === '/v1/secrets') return req.method === 'POST' ? (secrets[body.name] = body.value, send(201, { secret: { name: body.name } })) : send(200, { secrets: Object.keys(secrets).map(name => ({ name, set_at: '2026-10-27T00:00:00Z' })) });
  if (u.pathname === '/v1/jobs' && req.method === 'POST'){
    const id = `job${++n}`, out = execFileSync(process.execPath, [path.join(body.plugin.root, body.plugin_script), ...body.args], { encoding: 'utf8' });
    const job = { id, status: 'done', result: { exit_code: 0, stdout: out, stderr: '' } };
    jobs.set(id, job); return send(201, { job });
  }
  const m = u.pathname.match(/^\/v1\/jobs\/(\w+)$/);
  if (m) return send(200, { job: jobs.get(m[1]) });
  send(404, {});
});
let runner, conn;
before(async () => {
  await new Promise(r => ai.listen(0, '127.0.0.1', r));
  conn = { url: `http://127.0.0.1:${ai.address().port}`, token: 'test-token-0123456789' };
  const plugins = await import('../server/plugins.js');
  const { createRunner } = await import('../server/runner.js');
  const ins = await plugins.inspect({ local: new URL('./fixtures/plugin-flow/', import.meta.url).pathname });
  assert.equal(ins.ok, true, ins.errors.join());
  await plugins.install(path.join(DATA, P), ins.stage);
  runner = createRunner({ DATA, listProfiles: async () => [{ name: P }] });
});
after(() => { ai.close(); fs.rmSync(T, { recursive: true, force: true }); });

const state = async () => (await runner.status(P)).plugins['flow-demo'].state;
const ID = 'flow-demo';

test('AI 연결 없이는 켜지 않고, 켜면 돌리는 컴퓨터가 동기화되는 파일에 남는다', async () => {
  await assert.rejects(runner.setRunner(P, { on: true }), /AI 연결/);
  const h = await runner.setRunner(P, { on: true, ai: conn });
  assert.equal(h.on, true); assert.equal(h.runner, '회사맥');
  assert.equal(JSON.parse(fs.readFileSync(path.join(DATA, P, '_플러그인/.state/runner.json'), 'utf8')).host, '회사맥');
  // 승인 전에 실패한 목록은 승인하자마자 다시 가져온다(가져오는 주기를 기다리지 않는다)
  const sf = path.join(DATA, P, '_플러그인/.state', `${ID}.json`);
  fs.writeFileSync(sf, JSON.stringify({ v: 1, runs: [], applied: [], feeds: { '할 일': { items: [], first: {}, ok: false, at: new Date().toISOString(), error: `이 컴퓨터에서 승인하지 않은 플러그인이에요: ${ID}` } } }));
  await runner.approve(P, ID);
  assert.equal((await runner.machine(P, ID)).approved, true);
  let f;
  for (let i = 0; i < 50 && !(f = (await state()).feeds['할 일']).ok; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(f.ok, true, f.error);
  assert.deepEqual(f.items.map(i => i.id), ['A-1']);
});

test('처음 가져온 목록은 자동 시작하지 않고, 그 뒤 새로 들어온 것만 자동으로', async () => {
  await runner.setLocal(P, ID, { auto: true });
  await runner.act(P, ID, { type: 'refresh', feed: '할 일' });
  let st = await state();
  assert.deepEqual(st.feeds['할 일'].items.map(i => i.id), ['A-1']);
  assert.equal(st.feeds['할 일'].items[0].url, '', 'http(s)가 아닌 주소는 버린다');
  assert.equal(st.runs.length, 0);
  await runner.setLocal(P, ID, { settings: { items: 'A-1,A-2' } });
  await runner.act(P, ID, { type: 'refresh', feed: '할 일' });
  st = await state();
  assert.deepEqual(st.runs.map(r => r.item.id), ['A-2']);
});

test('묻는 단계는 답을 기다리고, 답하면 --answer로 다시 돌린 뒤 사람 확인에서 멈춘다', async () => {
  await runner.tick(); await runner.tick();
  let r = (await state()).runs[0];
  assert.equal(r.status, 'input'); assert.equal(r.steps[0].ask.question, '어느 쪽?');
  assert.deepEqual(r.steps[0].ask.choices.map(c => c.value), ['왼쪽', '오른쪽']);
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '고르기', value: '오른쪽' });
  await runner.tick(); await runner.tick();
  r = (await state()).runs[0];
  assert.equal(r.steps[0].output.picked, '오른쪽');
  assert.equal(r.status, 'input'); assert.equal(r.steps[1].ask.type, 'confirm');
});

test('다른 기기에서 누른 것은 받은편지함 파일로 오고, 켠 컴퓨터가 한 번만 처리한다', async () => {
  const r = (await state()).runs[0];
  fs.writeFileSync(path.join(DATA, P, '_플러그인/.state/flow-demo.inbox.휴대폰.json'), JSON.stringify([{ id: 'phone-1', at: new Date().toISOString(), type: 'confirm', run: r.id, step: '확인' }]));
  await runner.tick(); await runner.tick();
  const st = await state();
  assert.equal(st.runs[0].status, 'done');
  assert.ok(st.applied.includes('phone-1'));
});

test('버튼으로 시작한 것도 같은 흐름이고, 이미 진행 중이면 다시 시작하지 않는다', async () => {
  await runner.act(P, ID, { type: 'start', feed: '할 일', item: 'A-1' });
  await assert.rejects(runner.act(P, ID, { type: 'start', feed: '할 일', item: 'A-1' }), /이미 진행 중/);
  const r = (await state()).runs.find(x => x.item.id === 'A-1');
  await runner.act(P, ID, { type: 'cancel', run: r.id });
  assert.equal((await state()).runs.find(x => x.id === r.id).status, 'canceled');
});

test('그만둔 작업은 처음부터 다시 하고, 같은 항목을 다른 갈래로 하나 더 돌린다 — 같은 갈래는 하나만, 갈래는 다시 고를 수 있다', async () => {
  const ticks = async (k = 4) => { for (let i = 0; i < k; i++) await runner.tick(); };
  const get = async id => (await state()).runs.find(x => x.id === id);
  const r = (await state()).runs.find(x => x.item.id === 'A-1' && x.status === 'canceled');
  await runner.act(P, ID, { type: 'retry', run: r.id, step: '고르기' });   // 처음부터 다시
  assert.notEqual((await get(r.id)).status, 'canceled'); assert.equal((await get(r.id)).note, null);
  await ticks();
  assert.equal((await get(r.id)).steps[0].ask.question, '어느 쪽?');
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '고르기', value: '왼쪽' });
  await ticks();
  assert.equal((await get(r.id)).lane, '왼쪽');

  await runner.act(P, ID, { type: 'start', feed: '할 일', item: 'A-1', fork: { step: '고르기', value: '왼쪽' } });   // 같은 갈래로 하나 더 — 막힌다
  const dup = (await state()).runs[0];
  await ticks();
  assert.equal((await get(dup.id)).status, 'stopped');
  assert.match((await get(dup.id)).steps[0].error, /왼쪽에서 이미/);

  await runner.act(P, ID, { type: 'start', feed: '할 일', item: 'A-1', fork: { step: '고르기', value: '*' } });   // 다른 갈래 — 새로 고른다
  const f = (await state()).runs[0];
  await ticks();
  await runner.act(P, ID, { type: 'answer', run: f.id, step: '고르기', value: '오른쪽' });
  await ticks();
  assert.equal((await get(f.id)).lane, '오른쪽');
  assert.equal((await get(r.id)).lane, '왼쪽');   // 앞 작업은 그대로

  await runner.act(P, ID, { type: 'retry', run: r.id, step: '고르기', value: '*' });   // 갈래 다시 고르기(저장소 바꾸기)
  await ticks();
  assert.equal((await get(r.id)).steps[0].status, 'input');
  assert.equal((await get(r.id)).steps[1].status, 'pending');   // 뒤 단계도 새로
  for (const z of (await state()).runs.filter(x => !['done', 'canceled'].includes(x.status))) await runner.act(P, ID, { type: 'cancel', run: z.id });
});

test('주기는 이 컴퓨터에서 바꾸고, 자동 시작한 작업은 내 확인을 받게 한 단계 앞에서 멈췄다가 확인하면 그 단계를 한다', async () => {
  await assert.rejects(runner.setLocal(P, ID, { every: { '할 일': 2 } }), /5~1440/);
  await assert.rejects(runner.setLocal(P, ID, { every: { '없는 목록': 30 } }), /없는 목록/);
  await runner.setLocal(P, ID, { every: { '할 일': 30 }, gates: { '처리|고르기': true, '처리|확인': true } });
  const s = (await runner.status(P)).plugins[ID];
  assert.equal(s.feeds[0].every, 30); assert.equal(s.feeds[0].every_default, 5);
  assert.deepEqual(s.local.gates, { '처리|고르기': true });   // 사람이 하는 단계(manual)는 원래 내 차례
  await runner.setLocal(P, ID, { settings: { items: 'A-1,A-2,A-3' } });
  await runner.act(P, ID, { type: 'refresh', feed: '할 일' });
  await runner.tick();
  let r = (await state()).runs.find(x => x.item.id === 'A-3');
  assert.equal(r.by, 'auto'); assert.equal(r.status, 'input'); assert.equal(r.steps[0].ask.type, 'gate');
  assert.equal(r.steps[0].job, undefined);   // 아직 아무것도 실행하지 않았다
  await runner.act(P, ID, { type: 'confirm', run: r.id, step: '고르기' });
  await runner.tick();
  r = (await state()).runs.find(x => x.item.id === 'A-3');
  assert.equal(r.steps[0].ask.question, '어느 쪽?');   // 관문을 지나 그 단계(묻는 스크립트)를 했다
  await runner.act(P, ID, { type: 'start', feed: '할 일', item: 'A-1' }).catch(() => {});
  const b = (await state()).runs.find(x => x.item.id === 'A-1' && x.by === 'button' && x.status !== 'canceled');
  if (b){ await runner.tick(); assert.notEqual((await state()).runs.find(x => x.id === b.id).steps[0].ask?.type, 'gate'); }   // 버튼으로 시작한 것은 멈추지 않는다
  for (const z of (await state()).runs.filter(x => !['done', 'canceled'].includes(x.status))) await runner.act(P, ID, { type: 'cancel', run: z.id });
  await runner.setLocal(P, ID, { every: { '할 일': null } });
  assert.equal((await runner.status(P)).plugins[ID].feeds[0].every, 5);
});

test('돌리는 컴퓨터가 다른 컴퓨터로 옮겨지면 이 컴퓨터는 멈추고, 누른 것은 받은편지함으로 보낸다', async () => {
  fs.writeFileSync(path.join(DATA, P, '_플러그인/.state/runner.json'), JSON.stringify({ host: '집맥' }));
  const h = (await runner.status(P)).here;
  assert.equal(h.on, false); assert.equal(h.runner, '집맥');
  const r = await runner.act(P, ID, { type: 'refresh', feed: '할 일' });
  assert.equal(r.applied, false);
  assert.ok(fs.existsSync(path.join(DATA, P, '_플러그인/.state/flow-demo.inbox.회사맥.json')));
});
