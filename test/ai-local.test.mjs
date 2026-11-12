// 같은 컴퓨터의 pkm-ai-server에 연결 코드 없이 붙기(/api/ai/local) — pkm-ai-server가 켤 때 남기는 local.json(주소·이 컴퓨터용 토큰)을 읽는다.
// 찾기는 토큰을 내보내지 않고, 연결은 그 토큰이 맞는지 확인한 뒤 이 컴퓨터의 AI 연결(runner.json의 ai)로 넣는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-ailocal-'));
const TOKEN = 'pkmai_local-token-0123456789';
const ai = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`){ res.writeHead(401); return res.end('{"error":"토큰"}'); }
  if (req.url === '/v1/providers') return res.end(JSON.stringify({ providers:[{ id:'claude' }] }));
  if (req.url === '/v1/plugins') return res.end(JSON.stringify({ plugins:[] }));
  res.writeHead(404); res.end('{}');
});
let server, base, aiUrl;
const LOCAL = path.join(T, 'ai', 'local.json');
const same = { 'sec-fetch-site':'same-origin' };
before(async () => {
  await new Promise(r => ai.listen(0, '127.0.0.1', r));
  aiUrl = `http://127.0.0.1:${ai.address().port}`;
  for (const d of ['home', 'data', 'ai']) fs.mkdirSync(path.join(T, d), { recursive:true });
  Object.assign(process.env, { PKM_HOME:path.join(T, 'home'), PKM_DATA:path.join(T, 'data'), PKM_AI_HOME:path.join(T, 'ai'), PKM_RUNNER_TICK:'999999' });
  ({ server } = await import('../server/index.js'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/ai/local`;
});
after(() => { server.close(); ai.close(); fs.rmSync(T, { recursive:true, force:true }); });
const conf = () => JSON.parse(fs.readFileSync(path.join(T, 'home', 'runner.json'), 'utf8'));

test('local.json이 없으면 못 찾았다고 하고, 연결은 404', async () => {
  assert.deepEqual(await (await fetch(base)).json(), { found:false });
  const r = await fetch(base, { method:'POST', headers:same });
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /찾지 못했어요/);
});

test('켜져 있으면 찾았다고 하되 토큰은 내보내지 않고, 누르면 이 컴퓨터의 AI 연결로 넣는다', async () => {
  fs.writeFileSync(LOCAL, JSON.stringify({ v:1, url:aiUrl + '/', token:TOKEN }));
  const r = await (await fetch(base)).json();
  assert.deepEqual(r, { found:true, ok:true, url:aiUrl, connected:false });
  assert.equal((await fetch(base, { method:'POST', headers:{ origin:'https://evil.example' } })).status, 403);
  assert.deepEqual(await (await fetch(base, { method:'POST', headers:same })).json(), { url:aiUrl });
  assert.equal(conf().ai.url, aiUrl);
  assert.equal(conf().ai.token, TOKEN);
  assert.equal((await (await fetch(base)).json()).connected, true);
  assert.deepEqual((await (await fetch(base.replace('/local', '/v1/providers'))).json()).providers, [{ id:'claude' }]);   // 화면은 pkm 서버를 거쳐 쓴다
});

test('토큰이 끊겼거나 서버가 꺼져 있으면 찾기는 ok:false, 연결은 거절', async () => {
  fs.writeFileSync(LOCAL, JSON.stringify({ v:1, url:aiUrl, token:'pkmai_revoked-token-000000' }));
  assert.equal((await (await fetch(base)).json()).ok, false);
  assert.equal((await fetch(base, { method:'POST', headers:same })).status, 409);
  fs.writeFileSync(LOCAL, JSON.stringify({ v:1, url:'http://127.0.0.1:1', token:TOKEN }));
  assert.deepEqual(await (await fetch(base)).json(), { found:true, ok:false, url:'http://127.0.0.1:1', connected:false });
  assert.equal((await fetch(base, { method:'POST', headers:same })).status, 502);
});
