// 짚은 곳의 답 버튼(findings[].choose) — 단계가 도는 중에 누른 답은 줄 세웠다가 다시 물을 때 넘긴다(ask.batch면 한 번에, 아니면 차례로)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-runner-queue-'));
Object.assign(process.env, { PKM_HOME: path.join(T, 'home'), PKM_HOST_NAME: '회사맥', PKM_RUNNER_TICK: '999999', PKM_Q_STATE: path.join(T, 'q.json') });
const DATA = path.join(T, 'data'), P = '회사', ID = 'queue-demo';
fs.mkdirSync(path.join(DATA, P), { recursive: true });

// 시험용 플러그인: 레포 a·b·c를 줄마다 버튼으로. 답(여러 줄일 수 있다)에 든 것을 끝낸 것으로 적고, 남으면 다시 묻는다
const SRC = path.join(T, 'plugin');
const put = (f, text) => { fs.mkdirSync(path.dirname(path.join(SRC, f)), { recursive: true }); fs.writeFileSync(path.join(SRC, f), text); };
put('plugin.md', '---\npkm_plugin: 1\nid: queue-demo\nname: 줄 세우기 시험\nversion: 0.1.0\npermissions:\n  bundled: [scripts/q.mjs]\n---\n시험용.\n');
put('feeds/목록.md', '## 목록\n- run: scripts/q.mjs list\n- every: 5\n- start: 올리기\n- empty: 없어요\n');
put('workflows/올리기.md', '## 올리기\n- [올리기] 줄마다 올리기 · script: scripts/q.mjs ship\n');
put('scripts/q.mjs', `import fs from 'node:fs';
const f = process.env.PKM_Q_STATE, st = (() => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { done: [], calls: [] }; } })();
if (process.argv[2] === 'list'){ console.log(JSON.stringify({ items: [{ id: 'n1', title: '공지' }] })); process.exit(0); }
const ans = (process.argv.find(a => a.startsWith('--answer=')) || '--answer=').slice(9);
st.calls.push(ans); for (const v of ans.split('\\n')) if (v.startsWith('do:') && !st.done.includes(v.slice(3))) st.done.push(v.slice(3));
fs.writeFileSync(f, JSON.stringify(st));
const left = ['a', 'b', 'c'].filter(n => !st.done.includes(n));
const findings = ['a', 'b', 'c'].map(n => ({ where: n, title: n, ...(left.includes(n) ? { choose: { value: 'do:' + n, label: '올리기' } } : {}) }));
console.log(JSON.stringify(left.length ? { verdict: { tone: 'bad', title: left.length + '개 남음' }, findings, ask: { question: '고르기', inline: true, batch: st.batch === true, choices: [{ value: 'done', label: '끝' }] } } : { verdict: { tone: 'ok', title: '다 올림' }, findings }));
`);

// 가짜 pkm-ai-server — hold가 켜져 있으면 작업을 '하는 중'으로 두었다가 풀 때 끝낸다
const jobs = new Map(), approvals = [];
let n = 0, hold = false;
const ai = http.createServer(async (req, res) => {
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/v1/plugins') return req.method === 'POST' ? (approvals.push(body), send(201, { plugin: body })) : send(200, { plugins: approvals });
  if (u.pathname === '/v1/secrets') return send(200, { secrets: [] });
  if (u.pathname === '/v1/jobs' && req.method === 'POST'){
    const id = `job${++n}`, out = execFileSync(process.execPath, [path.join(body.plugin.root, body.plugin_script), ...body.args], { encoding: 'utf8' });
    const job = { id, status: 'done', result: { exit_code: 0, stdout: out, stderr: '' } };
    jobs.set(id, { job, held: hold }); return send(201, { job: hold ? { id, status: 'running' } : job });
  }
  const m = u.pathname.match(/^\/v1\/jobs\/(\w+)$/);
  if (m){ const j = jobs.get(m[1]); return send(200, { job: j.held ? { id: j.job.id, status: 'running' } : j.job }); }
  send(404, {});
});
const release = () => { hold = false; for (const j of jobs.values()) j.held = false; };
let runner;
before(async () => {
  await new Promise(r => ai.listen(0, '127.0.0.1', r));
  const plugins = await import('../server/plugins.js');
  const { createRunner } = await import('../server/runner.js');
  const ins = await plugins.inspect({ local: SRC });
  assert.equal(ins.ok, true, ins.errors.join());
  await plugins.install(path.join(DATA, P), ins.stage);
  runner = createRunner({ DATA, listProfiles: async () => [{ name: P }] });
  await runner.setRunner(P, { on: true, ai: { url: `http://127.0.0.1:${ai.address().port}`, token: 'test-token-0123456789' } });
  await runner.approve(P, ID);
  await runner.tick();
});
after(() => { ai.close(); fs.rmSync(T, { recursive: true, force: true }); });
const run0 = async () => (await runner.status(P)).plugins[ID].state.runs[0];
const calls = () => JSON.parse(fs.readFileSync(process.env.PKM_Q_STATE, 'utf8')).calls;

test('도는 중에 누른 줄 버튼은 줄 세우고, 다시 물을 때 차례로 넘긴다', async () => {
  await runner.act(P, ID, { type: 'start', feed: '목록', item: 'n1' });
  await runner.tick(); await runner.tick();
  let r = await run0();
  assert.equal(r.status, 'input'); assert.equal(r.steps[0].output.findings.filter(f => f.choose).length, 3);
  hold = true;
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '올리기', value: 'do:a' });
  r = await run0(); assert.equal(r.steps[0].status, 'running');
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '올리기', value: 'do:b' });
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '올리기', value: 'do:b' });   // 같은 줄을 두 번 눌러도 한 번
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '올리기', value: 'do:c' });
  await assert.rejects(runner.act(P, ID, { type: 'answer', run: r.id, step: '올리기', value: 'nope' }), /기다리는 단계가 아니에요/);   // 줄 버튼의 값이 아니면 받지 않는다
  r = await run0(); assert.deepEqual(r.steps[0].queue, ['do:b', 'do:c']);
  release();
  for (let i = 0; i < 6; i++) await runner.tick();
  r = await run0();
  assert.equal(r.status, 'done'); assert.equal(r.steps[0].output.verdict.title, '다 올림');
  assert.deepEqual(calls(), ['', 'do:a', 'do:b', 'do:c']);
});

test('ask.batch면 줄 세운 답을 한 번에(줄바꿈으로 이어) 넘긴다', async () => {
  fs.writeFileSync(process.env.PKM_Q_STATE, JSON.stringify({ done: [], calls: [], batch: true }));
  let r = await run0();
  await runner.act(P, ID, { type: 'retry', run: r.id, step: '올리기', value: 'again' });   // 다시 하기는 앞 답을 다시 쓰니, 아무 줄도 아닌 답으로
  await runner.tick(); await runner.tick();
  r = await run0(); assert.equal(r.status, 'input');
  hold = true;
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '올리기', value: 'do:a' });
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '올리기', value: 'do:b' });
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '올리기', value: 'do:c' });
  release();
  for (let i = 0; i < 4; i++) await runner.tick();
  r = await run0();
  assert.equal(r.status, 'done');
  assert.deepEqual(calls(), ['again', 'do:a', 'do:b\ndo:c']);
});
