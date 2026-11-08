// 화면의 AI 요청을 pkm 서버가 '이 컴퓨터의 AI 연결'로 넘기는 길(/api/ai/v1/…) — https로 연 휴대폰 화면이 http AI 서버에 직접 닿지 못할 때.
// 가짜 pkm-ai-server로: 토큰은 서버가 붙이고, 화면이 쓰는 요청만, 작업은 도구 없는 AI만(에이전트·스크립트 필드는 버린다), 스트림은 그대로 흘린다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-aiproxy-'));
const seen = [];
const ai = http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  seen.push({ method:req.method, url:req.url, auth:req.headers.authorization, body:b ? JSON.parse(b) : null });
  if (req.url === '/v1/providers') return res.end(JSON.stringify({ providers:[{ id:'claude' }] }));
  if (req.url === '/v1/jobs' && req.method === 'POST') return res.end(JSON.stringify({ job:{ id:'job1', status:'run' } }));
  if (req.url === '/v1/jobs/job1/events'){ res.writeHead(200, { 'content-type':'text/event-stream' }); res.write('data: {"type":"text","text":"안"}\n\n'); setTimeout(() => { res.end('data: {"type":"text","text":"녕"}\n\n'); }, 30); return; }
  res.writeHead(404); res.end('{}');
});
let server, base;
before(async () => {
  await new Promise(r => ai.listen(0, '127.0.0.1', r));
  fs.mkdirSync(path.join(T, 'home'), { recursive:true });
  fs.writeFileSync(path.join(T, 'home', 'runner.json'), JSON.stringify({ profiles:{}, ai:{ url:`http://127.0.0.1:${ai.address().port}`, token:'server-token' } }));
  Object.assign(process.env, { PKM_HOME:path.join(T, 'home'), PKM_DATA:path.join(T, 'data'), PKM_RUNNER_TICK:'999999' });
  fs.mkdirSync(path.join(T, 'data'), { recursive:true });
  ({ server } = await import('../server/index.js'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/ai/v1`;
});
after(() => { server.close(); ai.close(); fs.rmSync(T, { recursive:true, force:true }); });
const same = { 'sec-fetch-site':'same-origin', 'content-type':'application/json' };

test('토큰은 서버가 붙이고, 작업 요청은 도구 없는 AI 필드만 넘긴다', async () => {
  const p = await (await fetch(`${base}/providers`)).json();
  assert.deepEqual(p.providers.map(x => x.id), ['claude']);
  assert.equal(seen.at(-1).auth, 'Bearer server-token');
  const r = await fetch(`${base}/jobs`, { method:'POST', headers:same, body:JSON.stringify({ provider:'claude', prompt:'안녕', agent:{ mode:'full', cwd:'/' }, plugin:{ id:'x' }, plugin_script:'a.mjs', args:['x'] }) });
  assert.equal(r.status, 200);
  assert.deepEqual(seen.at(-1).body, { provider:'claude', prompt:'안녕' });
});

test('스트림을 그대로 흘리고, 화면이 쓰지 않는 요청과 다른 사이트의 쓰기는 막는다', async () => {
  const t = await (await fetch(`${base}/jobs/job1/events`)).text();
  assert.equal(t, 'data: {"type":"text","text":"안"}\n\ndata: {"type":"text","text":"녕"}\n\n');
  assert.equal((await fetch(`${base}/plugins`)).status, 404);
  assert.equal((await fetch(`${base}/secrets`)).status, 404);
  assert.equal((await fetch(`${base}/jobs`, { method:'POST', headers:{ 'content-type':'application/json', origin:'https://evil.example' }, body:'{}' })).status, 403);
});

test('서버에 AI 연결이 없으면 409로 알린다', async () => {
  fs.writeFileSync(path.join(T, 'home', 'runner.json'), JSON.stringify({ profiles:{} }));
  const r = await fetch(`${base}/providers`);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'no_server_ai');
});
