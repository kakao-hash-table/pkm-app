// 코드 리뷰 플러그인의 AI 리뷰 — 가짜 GitHub·가짜 AI 서버로: diff 줄 번호·뺄 파일, 스키마로 묻기, 판정 정리, 승인은 검토한 커밋에만, 새 커밋이면 다시
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
const exec = (args) => new Promise(r => execFile(process.execPath, args, { encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: 'ghp_test' } }, (e, out) => r(out)));

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-review-'));
Object.assign(process.env, { PKM_HOME: path.join(T, 'home'), PKM_HOST_NAME: '회사맥', PKM_RUNNER_TICK: '999999' });
const DATA = path.join(T, 'data'), P = '회사', ID = 'github-reviews', FEED = '나한테 요청된 리뷰';
fs.mkdirSync(path.join(DATA, P), { recursive: true });

// 가짜 GitHub — PR 하나(o/web#7). 승인하면 리뷰 요청에서 빠진다
const GH = { head: 'a'.repeat(40), requested: true, posted: [], big: false };
const BIG = '@@ -0,0 +1,2000 @@\n' + Array.from({ length: 2000 }, (_, i) => `+export const value${i} = '${'x'.repeat(24)}';`).join('\n');   // 64KB가 넘는 diff
const PATCH = '@@ -10,3 +10,4 @@ function A(){\n   const a = 1;\n-  old();\n+  el.innerHTML = props.html;\n+  track(a);\n   return a;';
const gh = http.createServer(async (req, res) => {
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (req.headers.authorization !== 'Bearer ghp_test') return send(401, {});
  let body = ''; for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x'), p = u.pathname.replace(/^\/api\/v3/, '');
  const pr = { html_url: 'http://gh/o/web/pull/7', number: 7, title: 'XSS 고치기', state: 'open', user: { login: 'kim' }, created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z',
    additions: 2, deletions: 1, head: { sha: GH.head, ref: 'feature/x' }, requested_reviewers: [], body: '설명' };
  if (p === '/user') return send(200, { login: 'me' });
  if (p === '/search/issues'){
    const q = u.searchParams.get('q');
    return send(200, { items: q.includes('review-requested:me') && GH.requested ? [{ id: 1, number: 7, title: pr.title, html_url: pr.html_url, repository_url: 'http://gh/api/v3/repos/o/web' }] : [] });
  }
  if (p === '/repos/o/web/pulls/7') return send(200, pr);
  if (p === '/repos/o/web/pulls/7/files') return send(200, u.searchParams.get('page') === '1' ? [
    { filename: 'src/A.tsx', status: 'modified', patch: PATCH },
    { filename: 'package-lock.json', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' },
    { filename: 'src/icon.svg', status: 'added', patch: '@@ -0,0 +1 @@\n+<svg/>' }, ...(GH.big ? [{ filename: 'src/Big.ts', status: 'added', patch: BIG }] : [])] : []);
  if (p === '/repos/o/web/pulls/7/reviews' && req.method === 'POST'){ GH.posted.push(JSON.parse(body)); GH.requested = false; return send(200, { id: 1 }); }
  if (p === '/repos/o/web/pulls/7/reviews') return send(200, []);
  send(404, { message: p });
});

// 가짜 pkm-ai-server — 스크립트는 그 자리에서 실행, AI는 정해 둔 답(AI_ANSWER)을 구조화된 결과로
const jobs = new Map(), aiCalls = [], secrets = {};
let n = 0, AI_ANSWER = null, CUT = false;   // CUT: 스크립트 출력을 앞부분만 넘긴다(잘린 출력)
const ai = http.createServer(async (req, res) => {
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/v1/plugins') return req.method === 'POST' ? send(201, { plugin: body }) : send(200, { plugins: [] });
  if (u.pathname === '/v1/secrets') return send(200, { secrets: [] });
  if (u.pathname === '/v1/jobs' && req.method === 'POST'){
    const id = `job${++n}`;
    let job;
    if (body.plugin_script){
      let out = await exec([path.join(body.plugin.root, body.plugin_script), ...body.args]);
      if (CUT && body.args.includes('diff')) out = out.slice(0, 200);
      job = { id, status: 'done', result: { exit_code: 0, stdout: out, stderr: '' } };
    } else { aiCalls.push(body); job = { id, status: 'done', result: { text: '', structured: AI_ANSWER } }; }
    jobs.set(id, job); return send(201, { job });
  }
  const m = u.pathname.match(/^\/v1\/jobs\/(\w+)$/);
  if (m) return send(200, { job: jobs.get(m[1]) });
  send(404, {});
});

let runner, API;
const SCRIPT = new URL('../plugins/github-reviews/scripts/reviews.mjs', import.meta.url).pathname;
const runScript = async args => JSON.parse(await exec([SCRIPT, ...args, `--api=${API}`]));
before(async () => {
  await Promise.all([new Promise(r => gh.listen(0, '127.0.0.1', r)), new Promise(r => ai.listen(0, '127.0.0.1', r))]);
  API = `http://127.0.0.1:${gh.address().port}/api/v3`;
  const plugins = await import('../server/plugins.js');
  const { createRunner } = await import('../server/runner.js');
  const ins = await plugins.inspect({ local: new URL('../plugins/github-reviews/', import.meta.url).pathname });
  assert.equal(ins.ok, true, ins.errors.join());
  await plugins.install(path.join(DATA, P), ins.stage);
  runner = createRunner({ DATA, listProfiles: async () => [{ name: P }] });
  await runner.setRunner(P, { on: true, ai: { url: `http://127.0.0.1:${ai.address().port}`, token: 'test-token-0123456789' } });
  await runner.setLocal(P, ID, { settings: { github_api: API } });
});
after(() => { gh.close(); ai.close(); fs.rmSync(T, { recursive: true, force: true }); });

const state = async () => (await runner.status(P)).plugins[ID].state;
const runOf = async () => (await state()).runs[0];
async function until(ok){ for (let i = 0; i < 12; i++){ await runner.tick(P); if (ok(await runOf())) return runOf(); } return runOf(); }

test('diff: 새 파일 줄 번호를 붙이고 바꾼 줄 범위를 모으며, 잠금 파일·이미지는 뺀다', async () => {
  const d = await runScript(['diff', '--repo=o/web', '--number=7']);
  assert.equal(d.head, GH.head);
  assert.deepEqual(d._lines, { 'src/A.tsx': [[11, 12]] });
  assert.match(d._diff, /   11│\+  el\.innerHTML = props\.html;/);
  assert.match(d._diff, /     │-  old\(\);/);
  assert.match(d._diff, /   13│   return a;/);
  assert.deepEqual(d.skipped, ['package-lock.json', 'src/icon.svg']);
  assert.match(d.summary, /파일 1개를 봐요 · \+2 −1 · 2개 뺌/);
});

test('decide: 범주 밖·확신 낮은·diff에 없는 파일은 버리고, 남은 게 없으면 큰 문제 없음', async () => {
  const lines = JSON.stringify({ 'src/A.tsx': [[11, 12]] });
  const weak = [{ path: 'src/A.tsx', start_line: 11, end_line: 11, category: 'style', title: '이름', scenario: '', comment: '', confidence: 0.99 },
    { path: 'src/A.tsx', start_line: 11, end_line: 11, category: 'security', title: 'XSS', scenario: '', comment: '', confidence: 0.5 },
    { path: 'src/B.tsx', start_line: 1, end_line: 1, category: 'logic', title: '없는 파일', scenario: '', comment: '', confidence: 0.9 }];
  const ok = await runScript(['decide', '--repo=o/web', '--number=7', `--head=${GH.head}`, '--verdict=block', '--summary=요약', `--findings=${JSON.stringify(weak)}`, `--lines=${lines}`, '--truncated=false']);
  assert.equal(ok.verdict.tone, 'ok'); assert.equal(ok.ask.choices[0].value, 'approve'); assert.equal(ok.ask.inline, true);
  const bad = await runScript(['decide', '--repo=o/web', '--number=7', `--head=${GH.head}`, '--verdict=block', '--summary=요약', `--lines=${lines}`, '--truncated=false',
    `--findings=${JSON.stringify([{ path: 'src/A.tsx', start_line: 11, end_line: 12, category: 'security', title: 'innerHTML에 props', scenario: 'html에 스크립트가 오면 실행돼요', comment: 'innerHTML 대신 textContent를 써 주세요.', confidence: 0.9 }])}`]);
  assert.equal(bad.verdict.tone, 'bad');
  assert.deepEqual(bad.findings[0], { where: 'src/A.tsx:11-12', url: `http://127.0.0.1:${gh.address().port}/o/web/blob/${GH.head}/src/A.tsx#L11-L12`, tag: '보안', title: 'innerHTML에 props', text: 'html에 스크립트가 오면 실행돼요', copy: 'innerHTML 대신 textContent를 써 주세요.', note: '' });
  assert.ok(bad.ask.choices.find(c => c.value === 'approve').confirm);
});

test('목록 → AI 검토 → 큰 문제 없음 → 승인은 검토한 커밋에, 끝나면 diff는 상태에서 지운다', async () => {
  await runner.act(P, ID, { type: 'refresh', feed: FEED });
  const items = (await state()).feeds[FEED].items;
  assert.equal(items.length, 1); assert.equal(items[0].version, GH.head);
  AI_ANSWER = { verdict: 'ok', summary: 'XSS를 고쳐요', findings: [] };
  await runner.act(P, ID, { type: 'start', feed: FEED, item: items[0].id });
  let r = await until(r => r.status === 'input');
  assert.equal(r.status, 'input');
  assert.equal(aiCalls[0].json_schema.properties.verdict.enum.join(), 'ok,block');   // 스키마 파일을 같이 넘긴다
  assert.match(aiCalls[0].prompt, /   11│\+  el\.innerHTML/); assert.match(aiCalls[0].prompt, /제목: XSS 고치기/);
  assert.doesNotMatch(aiCalls[0].prompt, /\{review_rules\}/);   // 비어 있는 설정도 채운다
  const s = r.steps.find(z => z.status === 'input');
  assert.equal(s.ask.inline, true); assert.equal(s.output.verdict.title, '큰 문제 없음');
  await runner.act(P, ID, { type: 'answer', run: r.id, step: s.key, value: 'approve' });
  r = await until(r => r.status === 'done');
  assert.equal(r.status, 'done');
  assert.deepEqual(GH.posted, [{ commit_id: GH.head, event: 'APPROVE' }]);
  assert.equal(r.steps[2].output.verdict.title, '큰 문제 없음'); assert.equal(r.steps[2].output.outcome.title, '승인함');   // 판정은 그대로 두고 한 일만 더한다
  assert.equal(r.steps[0].output._diff, undefined); assert.equal(r.steps[0].output.head, GH.head);
  await runner.act(P, ID, { type: 'refresh', feed: FEED });
  assert.equal((await state()).feeds[FEED].items.length, 0);   // 승인하면 요청에서 빠진다 — 화면은 칸을 바꾸기 전까지 그 줄을 둔다
});

test('검토한 뒤 새 커밋이 오면 승인하지 않고, 새 버전으로 다시 검토하면 이전 실행은 그만둔다', async () => {
  GH.requested = true; GH.head = 'b'.repeat(40); GH.posted = [];
  await runner.act(P, ID, { type: 'refresh', feed: FEED });
  const it = (await state()).feeds[FEED].items[0];
  AI_ANSWER = { verdict: 'block', summary: '위험', findings: [{ path: 'src/A.tsx', start_line: 11, end_line: 11, category: 'security', title: 'XSS', scenario: '스크립트 실행', comment: '고쳐 주세요', confidence: 0.95 }] };
  await runner.act(P, ID, { type: 'start', feed: FEED, item: it.id });
  let r = await until(r => r.status === 'input');
  const s = r.steps.find(z => z.status === 'input');
  assert.equal(s.output.findings.length, 1); assert.equal(s.output.verdict.tone, 'bad');
  GH.head = 'c'.repeat(40);   // 그 사이 push
  await runner.act(P, ID, { type: 'answer', run: r.id, step: s.key, value: 'approve' });
  r = await until(r => r.status === 'stopped');
  assert.equal(r.status, 'stopped'); assert.match(r.steps[2].error, /새 커밋이 올라왔어요/); assert.equal(GH.posted.length, 0);
  await runner.act(P, ID, { type: 'refresh', feed: FEED });
  await runner.act(P, ID, { type: 'start', feed: FEED, item: it.id });
  const runs = (await state()).runs;
  assert.equal(runs[0].item.version, 'c'.repeat(40)); assert.equal(runs[1].status, 'canceled');
  await assert.rejects(runner.act(P, ID, { type: 'start', feed: FEED, item: it.id }), /이미 진행 중/);
});

test('나한테 달린 답변은 확인하고 닫을 수 있고(버전째), 목록에서 빠지면 닫은 기록도 지운다', async () => {
  const R = '나한테 달린 답변', it = 'http://gh/o/web/pull/7';
  await runner.act(P, ID, { type: 'hide', feed: R, item: it, version: '2026-10-27T00:00:00Z' });
  assert.deepEqual((await state()).hidden[R], { [it]: '2026-10-27T00:00:00Z' });
  await assert.rejects(runner.act(P, ID, { type: 'hide', feed: FEED, item: it }), /닫을 수 없는 목록/);
  await runner.act(P, ID, { type: 'unhide', feed: R, item: it });
  assert.deepEqual((await state()).hidden[R], {});
  await runner.act(P, ID, { type: 'hide', feed: R, item: 'http://gh/o/web/pull/99', version: '1' });
  await runner.act(P, ID, { type: 'refresh', feed: R });
  assert.equal((await state()).feeds[R].ok, true);
  assert.deepEqual((await state()).hidden[R], {});
});

test('diff: 64KB가 넘는 출력도 잘리지 않고 끝까지 JSON으로 나온다', async () => {
  GH.big = true;
  try {
    const out = await exec([SCRIPT, 'diff', '--repo=o/web', '--number=7', `--api=${API}`]);
    assert.ok(out.length > 65536, `출력 ${out.length}바이트`);
    const d = JSON.parse(out);
    assert.deepEqual(d._lines['src/Big.ts'], [[1, 2000]]);
  } finally { GH.big = false; }
});

test('바뀐 코드 결과가 잘리면 그 단계에서 멈추고, 빈 값은 두고 이어 하면 직접 리뷰를 남기고, 처음부터 다시 하면 정상으로 돈다', async () => {
  for (const r of (await state()).runs) if (!['done', 'canceled'].includes(r.status)) await runner.act(P, ID, { type: 'cancel', run: r.id });
  GH.requested = true; GH.head = 'd'.repeat(40); GH.posted = [];
  await runner.act(P, ID, { type: 'refresh', feed: FEED });
  const it = (await state()).feeds[FEED].items[0];
  AI_ANSWER = { verdict: 'ok', summary: '코드를 못 받았어요', findings: [] };
  CUT = true;
  await runner.act(P, ID, { type: 'start', feed: FEED, item: it.id });
  let r = await until(r => r.status === 'stopped');
  assert.equal(r.steps[0].status, 'failed'); assert.match(r.steps[0].error, /결과를 읽지 못했어요/);   // 다음 단계로 넘기지 않는다
  // 건너뛰면 결정 단계가 앞 단계 값을 못 채워 멈춘다 — 예전에 갇히던 자리
  await runner.act(P, ID, { type: 'skip', run: r.id, step: '변경' });
  r = await until(r => r.status === 'stopped');
  assert.match(r.steps[2].error, /채우지 못한 값이 있어요: \{변경\.head\}/);
  // 빈 값은 두고 이어 하기 — PR에서 커밋을 다시 읽고, AI가 못 봤으니 승인을 권하지 않는다
  await runner.act(P, ID, { type: 'retry', run: r.id, step: '결정', lenient: true });
  r = await until(r => r.status === 'input');
  const s = r.steps[2];
  assert.equal(s.output.verdict.title, 'AI가 코드를 못 봤어요'); assert.equal(s.ask.choices[0].value, 'done');
  assert.ok(!s.ask.choices.some(c => c.recommended));
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '결정', value: 'done' });
  r = await until(r => r.status === 'done');
  assert.equal(r.steps[2].output.outcome.title, '직접 리뷰함'); assert.equal(GH.posted.length, 0);
  // 다시 멈춘 것을 처음부터 다시 — 잘림이 없으면 처음 흐름 그대로
  await runner.act(P, ID, { type: 'start', feed: FEED, item: it.id });
  r = await until(r => r.status === 'stopped');
  assert.equal(r.steps[0].status, 'failed');
  CUT = false;
  await runner.act(P, ID, { type: 'retry', run: r.id, step: '변경' });
  r = await until(r => r.status === 'input');
  assert.equal(r.steps[0].output.head, GH.head); assert.equal(r.steps[2].lenient, undefined);
  assert.equal(r.steps[2].output.verdict.title, '큰 문제 없음');
});
