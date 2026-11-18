// 자동화 기능 — 잠깐 실패하면 알아서 다시 하기(auto_retry). 끄면 예전처럼 멈춘다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-retry-'));
Object.assign(process.env, { PKM_HOME: path.join(T, 'home'), PKM_HOST_NAME: '시험맥', PKM_RUNNER_TICK: '999999', PKM_RETRY_UNIT_MS: '20', SAVE_COUNT: path.join(T, 'save-count') });
const DATA = path.join(T, 'data'), P = '개인', ID = 'retry-demo';
fs.mkdirSync(path.join(DATA, P), { recursive: true });

// 가짜 pkm-ai-server — AI 요청은 처음 한 번 시간 초과로 실패하고, 스크립트는 그 자리에서 실행한다
const jobs = new Map();
let n = 0, aiCalls = 0;
const ai = http.createServer(async (req, res) => {
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/v1/plugins') return send(req.method === 'POST' ? 201 : 200, req.method === 'POST' ? { plugin: body } : { plugins: [] });
  if (u.pathname === '/v1/secrets') return send(200, { secrets: [] });
  if (u.pathname === '/v1/jobs' && req.method === 'POST'){
    const id = `job${++n}`;
    const job = body.plugin_script
      ? { id, status: 'done', result: { exit_code: 0, stdout: execFileSync(process.execPath, [path.join(body.plugin.root, body.plugin_script), ...body.args], { encoding: 'utf8' }), stderr: '' } }
      : ++aiCalls === 1 ? { id, status: 'error', reason: 'timeout', error: '30분 안에 끝나지 않았어요' } : { id, status: 'done', result: { text: '한 줄 요약' } };
    jobs.set(id, job); return send(201, { job });
  }
  const m = u.pathname.match(/^\/v1\/jobs\/(\w+)$/);
  if (m) return jobs.has(m[1]) ? send(200, { job: jobs.get(m[1]) }) : send(404, { error: '없는 작업' });
  send(404, {});
});
let runner;
before(async () => {
  await new Promise(r => ai.listen(0, '127.0.0.1', r));
  const plugins = await import('../server/plugins.js');
  const { createRunner } = await import('../server/runner.js');
  const ins = await plugins.inspect({ local: new URL('./fixtures/plugin-retry/', import.meta.url).pathname });
  assert.equal(ins.ok, true, ins.errors.join());
  await plugins.install(path.join(DATA, P), ins.stage);
  runner = createRunner({ DATA, listProfiles: async () => [{ name: P }] });
  await runner.setRunner(P, { on: true, ai: { url: `http://127.0.0.1:${ai.address().port}`, token: 'test-token-0123456789' } });
  await runner.approve(P, ID);
  await runner.act(P, ID, { type: 'refresh', feed: '할 일' });
});
after(() => { ai.close(); fs.rmSync(T, { recursive: true, force: true }); });

const lastRun = async () => (await runner.status(P)).plugins[ID].state.runs[0];
async function until(pred, label){
  for (let i = 0; i < 80; i++){ await runner.tick(); const r = await lastRun(); if (pred(r)) return r; await new Promise(z => setTimeout(z, 15)); }
  throw new Error(`시간 초과: ${label} — ${JSON.stringify(await lastRun())}`);
}

test('기능 목록과 기본값 — 처음엔 모두 켜져 있다', async () => {
  const s = await runner.status(P);
  assert.ok(s.features.some(f => f.key === 'auto_retry' && f.label));
  assert.equal(s.plugins[ID].local.features.auto_retry, true);
  await assert.rejects(runner.setLocal(P, ID, { features: { nope: true } }), /없는 기능/);
});

test('AI 단계가 시간 초과로 실패하고, 스크립트가 다시 해도 된다고 한 실패도 — 알아서 다시 해서 끝까지 간다', async () => {
  await runner.act(P, ID, { type: 'start', feed: '할 일', item: 'A-1', workflow: '처리' });
  const w = await until(r => r.status === 'waiting', 'AI 실패 뒤 기다림');
  assert.equal(w.steps[0].reason, 'retry'); assert.equal(w.steps[0].retries, 1); assert.match(w.steps[0].retry_why, /끝나지 않았/);
  const r = await until(r => r.status === 'done', '끝까지');
  assert.equal(r.steps[0].text, '한 줄 요약');
  assert.equal(r.steps[1].retries, 1, '저장 단계도 한 번 다시 했다');
  assert.match(r.steps[1].text, /2번째/);
});

test('끄면 예전처럼 그 자리에서 멈춘다', async () => {
  aiCalls = 0; fs.rmSync(process.env.SAVE_COUNT, { force: true });
  assert.equal((await runner.setLocal(P, ID, { features: { auto_retry: false } })).features.auto_retry, false);
  const old = await lastRun(); await runner.act(P, ID, { type: 'dismiss', run: old.id });
  await runner.act(P, ID, { type: 'start', feed: '할 일', item: 'A-1', workflow: '처리' });
  const r = await until(r => r.status === 'stopped', '멈춤');
  assert.equal(r.steps[0].status, 'failed'); assert.equal(r.steps[0].retries, undefined);
  await runner.setLocal(P, ID, { features: { auto_retry: true } });
});
