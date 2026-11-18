// 자동화 기능 — 잠깐 실패하면 알아서 다시 하기(auto_retry), 끝난 일의 대기 닫기(close_gone). 끄면 예전처럼
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-retry-'));
Object.assign(process.env, { PKM_HOME: path.join(T, 'home'), PKM_HOST_NAME: '시험맥', PKM_RUNNER_TICK: '999999', PKM_RETRY_UNIT_MS: '20', PKM_GONE_CLOSE_MS: '40', SAVE_COUNT: path.join(T, 'save-count') });
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

test('목록에서 빠진 지 오래된 대기는 알아서 닫고, 닫은 것도 다시 할 수 있다(끄면 남겨 둔다)', async () => {
  const refresh = () => runner.act(P, ID, { type: 'refresh', feed: '할 일' });
  const run = async rid => (await runner.status(P)).plugins[ID].state.runs.find(r => r.id === rid);
  process.env.LIST_ITEMS = 'A-1'; await refresh();
  let rid = (await runner.act(P, ID, { type: 'start', feed: '할 일', item: 'A-1', workflow: '확인' })).state.runs[0].id;
  await runner.tick(); assert.equal((await run(rid)).status, 'input');
  process.env.LIST_ITEMS = ''; await refresh();
  assert.ok((await run(rid)).gone, '빠졌다고 표시만');
  assert.equal((await run(rid)).status, 'input', '바로 닫지는 않는다');
  await new Promise(z => setTimeout(z, 60)); await refresh();
  const r = await run(rid);
  assert.equal(r.status, 'canceled'); assert.equal(r.closed_gone, true); assert.match(r.note, /자동으로 닫았어요/);
  await runner.act(P, ID, { type: 'retry', run: rid, step: '확인' }); await runner.tick();
  assert.equal((await run(rid)).status, 'input', '[다시 하기]로 살린다');

  await runner.setLocal(P, ID, { features: { close_gone: false } });
  try {
    await new Promise(z => setTimeout(z, 60)); await refresh(); await refresh();
    assert.equal((await run(rid)).status, 'input', '끄면 남겨 둔다');
  } finally { await runner.setLocal(P, ID, { features: { close_gone: true } }); delete process.env.LIST_ITEMS; }
});

test('같은 설정은 한 번만 — 비어 있는 플러그인은 다른 플러그인에 넣은 값을 형식에 맞춰 빌려 쓰고, 직접 넣으면 그 값을 쓴다', async () => {
  const plugins = await import('../server/plugins.js');
  for (const d of ['plugin-share-a', 'plugin-share-b']){
    const ins = await plugins.inspect({ local: new URL(`./fixtures/${d}/`, import.meta.url).pathname });
    assert.equal(ins.ok, true, ins.errors.join()); await plugins.install(path.join(DATA, P), ins.stage);
  }
  const local = async id => (await runner.status(P)).plugins[id].local;
  await runner.setLocal(P, 'share-a', { settings: { jira_url: 'https://team.atlassian.net/', github_api: 'https://api.github.com' } });
  let b = await local('share-b');
  assert.equal(b.settings.jira_url, 'https://team.atlassian.net/browse/', '형식(…/browse/)에 맞춰 빌린다');
  assert.equal(b.borrowed.jira_url, 'share-a');
  assert.equal(b.settings.github_api, 'https://github.example.com/api/v3', '빌려 줄 쪽이 기본값 그대로면 빌리지 않는다');
  await runner.setLocal(P, 'share-a', { settings: { jira_url: 'https://other.atlassian.net' } });
  assert.equal((await local('share-b')).settings.jira_url, 'https://other.atlassian.net/browse/', '빌려 준 쪽을 바꾸면 따라 바뀐다');
  await runner.setLocal(P, 'share-b', { settings: { jira_url: 'https://mine.atlassian.net/browse/' } });
  await runner.setLocal(P, 'share-a', { settings: { jira_url: 'https://third.atlassian.net' } });
  b = await local('share-b');
  assert.equal(b.settings.jira_url, 'https://mine.atlassian.net/browse/', '직접 넣은 값은 덮지 않는다'); assert.equal(b.borrowed.jira_url, undefined);
  await runner.setLocal(P, 'share-b', { features: { share_settings: false } });
  assert.equal((await local('share-b')).features.share_settings, false);
});
