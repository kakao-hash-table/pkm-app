// 그림을 읽는 AI 단계 ai({단계.필드}) — 앞 스크립트가 낸 그림을 AI 요청의 images로 붙인다. 플러그인 데이터 폴더 밖이면 멈추고, 없어진 파일은 뺀다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-ai-img-'));
Object.assign(process.env, { PKM_HOME: path.join(T, 'home'), PKM_HOST_NAME: '집맥', PKM_RUNNER_TICK: '999999' });
const DATA = path.join(T, 'data'), P = '개인', ID = 'img-demo';
fs.mkdirSync(path.join(DATA, P), { recursive: true });
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const SRC = path.join(T, 'src');
const plugin = (wf, at = SRC) => {
  write(path.join(at, 'plugin.md'), `---\npkm_plugin: 1\nid: ${ID}\nname: 그림 시험\nversion: 0.1.0\npermissions:\n  ai: [chat]\n  bundled: [scripts/shot.mjs]\n---\n시험용 — 그림을 읽는 AI 단계.\n`);
  write(path.join(at, 'feeds/목록.md'), '## 할 일\n- run: scripts/shot.mjs list\n- every: 5\n- start: 읽기\n- empty: 없어요\n');
  write(path.join(at, 'workflows/읽기.md'), wf);
  write(path.join(at, 'scripts/shot.mjs'), `import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const [cmd, arg = ''] = process.argv.slice(2), id = arg.replace('--id=', '');
if (cmd === 'list'){ console.log(JSON.stringify({ items: ['in', 'out', 'gone'].map(id => ({ id, title: id })) })); process.exit(0); }
const store = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.data', '${ID}', '.cache');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f3b0a50000000049454e44ae426082', 'hex');
const f = id === 'out' ? path.join(os.tmpdir(), 'pkm-ai-img-out.png') : path.join(store, id + '.png');
if (id !== 'gone'){ fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, png); }
console.log(JSON.stringify({ summary: '그림 1장', _images: [{ path: f, mime: 'image/png' }] }));
`);
};
const WF = '## 읽기\n- [그림] 그림 만들기 · script: scripts/shot.mjs make --id={id}\n- [읽기] 그림 읽기 · ai({그림._images}): 그림을 읽어 줘\n';

const asked = [];
const jobs = new Map(); let n = 0;
const ai = http.createServer(async (req, res) => {
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/v1/plugins') return req.method === 'POST' ? send(201, { plugin: body }) : send(200, { plugins: [] });
  if (u.pathname === '/v1/secrets') return send(200, { secrets: [] });
  if (u.pathname === '/v1/jobs' && req.method === 'POST'){
    const id = `job${++n}`;
    const result = body.plugin_script ? { exit_code: 0, stdout: execFileSync(process.execPath, [path.join(body.plugin.root, body.plugin_script), ...body.args], { encoding: 'utf8' }), stderr: '' } : String(body.tag || '').endsWith(':review') ? { structured: { pass: true, issues: [] }, text: '' } : (asked.push(body), { text: '읽었어요' });   // 독립 검토 요청은 따로
    const job = { id, status: 'done', result }; jobs.set(id, job); return send(201, { job });
  }
  const m = u.pathname.match(/^\/v1\/jobs\/(\w+)$/);
  if (m) return send(200, { job: jobs.get(m[1]) });
  send(404, {});
});
let runner, plugins;
before(async () => {
  await new Promise(r => ai.listen(0, '127.0.0.1', r));
  plugins = await import('../server/plugins.js');
  const { createRunner } = await import('../server/runner.js');
  plugin(WF);
  const ins = await plugins.inspect({ local: SRC });
  assert.equal(ins.ok, true, (ins.errors || []).join());
  await plugins.install(path.join(DATA, P), ins.stage);
  runner = createRunner({ DATA, listProfiles: async () => [{ name: P }] });
  await runner.setRunner(P, { on: true, ai: { url: `http://127.0.0.1:${ai.address().port}`, token: 'test-token-0123456789' } });
  await runner.approve(P, ID);
  await runner.act(P, ID, { type: 'refresh', feed: '할 일' });
});
after(() => { ai.close(); fs.rmSync(T, { recursive: true, force: true }); fs.rmSync(path.join(os.tmpdir(), 'pkm-ai-img-out.png'), { force: true }); });

const runOf = async item => {
  await runner.act(P, ID, { type: 'start', feed: '할 일', item });
  for (let i = 0; i < 60; i++){
    const r = (await runner.status(P)).plugins[ID].state.runs.find(x => x.item.id === item);
    if (r && ['done', 'stopped', 'canceled'].includes(r.status)) return r;
    await runner.tick(); await new Promise(res => setTimeout(res, 30));
  }
  const r = (await runner.status(P)).plugins[ID].state.runs.find(x => x.item.id === item);
  throw new Error(`${item} 실행이 끝나지 않았어요 ${JSON.stringify(r && [r.status, r.steps.map(s => [s.key, s.status, s.error])])}`);
};

test('데이터 폴더 안의 그림은 AI 요청의 images로 붙는다', async () => {
  const r = await runOf('in');
  assert.equal(r.status, 'done', JSON.stringify(r.steps.map(s => [s.key, s.status, s.error])));
  const b = asked.at(-1);
  assert.equal(b.prompt, '그림을 읽어 줘');
  assert.deepEqual(b.images, [{ path: fs.realpathSync(path.join(DATA, P, '_플러그인/.data', ID, '.cache/in.png')), mime: 'image/png' }]);
});

test('데이터 폴더 밖의 그림이면 AI를 부르지 않고 멈춘다', async () => {
  const before = asked.length, r = await runOf('out');
  assert.equal(r.status, 'stopped');
  const step = r.steps.find(s => s.key === '읽기');
  assert.equal(step.status, 'failed');
  assert.match(step.error, /플러그인 데이터 폴더 안/);
  assert.equal(asked.length, before);
});

test('없어진 그림은 빼고 글만으로 한다', async () => {
  const r = await runOf('gone');
  assert.equal(r.status, 'done');
  assert.equal(asked.at(-1).images, undefined);
});

test('그림 자리는 앞 스크립트 단계의 결과여야 한다', async () => {
  for (const wf of ['## 읽기\n- [가] 묻기 · ai: 하나\n- [나] 읽기 · ai({가._images}): 둘\n', '## 읽기\n- [나] 읽기 · ai({없음._images}): 둘\n', '## 읽기\n- [가] 그림 · script: scripts/shot.mjs make\n- [나] 읽기 · ai({가}): 둘\n']){
    const at = path.join(T, `bad-${Math.random().toString(36).slice(2)}`);
    plugin(wf, at);
    const r = await plugins.inspect({ local: at });
    assert.equal(r.ok, false, wf);
    assert.match(r.errors.join('\n'), /앞 스크립트 단계의 결과/);
  }
});
