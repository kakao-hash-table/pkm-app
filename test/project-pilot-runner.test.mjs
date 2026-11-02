// 프로젝트 파일럿을 실제 실행기(server/runner.js)로 — 설치한 플러그인에서 'AI에게 맡기기'를 끝까지, 이어서 '오늘 할 것' 루프 한 번.
// 가짜 pkm-ai-server: 스크립트는 그 자리에서 실행하고, AI·에이전트는 프롬프트를 보고 정해 둔 답(파일 쓰기 포함)을 낸다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-pilot-run-'));
Object.assign(process.env, { PKM_HOME: path.join(T, 'home'), PKM_HOST_NAME: '집맥', PKM_RUNNER_TICK: '999999' });
const DATA = path.join(T, 'data'), P = '개인', ID = 'project-pilot', WORK = path.join(T, 'work');
fs.mkdirSync(path.join(DATA, P), { recursive: true });
fs.writeFileSync(path.join(DATA, P, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');

const BRIEF = { goal: '하루 10분으로 월 3만원', metric: '수익', target: '월 30,000원', deadline: '3개월', minutes: 10, budget: '', assets: [], exclude: [], assumptions: [], verdict: 'ok', verdict_why: '', questions: [] };
const PLAN = { name: '부수입 3만', one_liner: '스레드 하나로', strategy: '작게 시작. ' + '실제 설계처럼 긴 전략 글. '.repeat(400), /* 설계 JSON이 인자 한도(2000자)를 넘게 */ metric: { name: '수익', unit: '원', target: 30000, period: '월' }, tree: [], milestones: [], decisions: ['스레드 하나로 시작할까요?'], me_minutes: 5, routine_at: '21:00',
  subprojects: [{ key: 'acq', lens: '고객유치', title: '채널 열기', why: '', outcome: '', wave: 1, done: [], todos: [{ text: '규칙 조사하기', who: 'ai', minutes: 0 }, { text: '계정 만들기', who: 'me', minutes: 5 }] }],
  loops: [{ key: 'draft', title: '글 초안', sub: 'acq', every: 'daily', at: '00:00', task: '초안 2개', me: '골라 올리기', me_minutes: 5, metric: '' }],
  checkins: [], risks: [], first_week: [], assumptions: [], sources: [] };
const prompts = [];
const jobs = new Map(); let n = 0;
const ai = http.createServer(async (req, res) => {
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/v1/plugins') return req.method === 'POST' ? send(201, { plugin: body }) : send(200, { plugins: [] });
  if (u.pathname === '/v1/secrets') return send(200, { secrets: [] });
  if (u.pathname === '/v1/jobs' && req.method === 'POST'){
    const id = `job${++n}`; let result;
    if ((body.args || []).some(a => typeof a !== 'string' || a.length > 2000)) return send(400, { error: 'args는 문자열 배열이어야 해요' });   // 실제 pkm-ai-server와 같은 한도
    if (body.plugin_script) result = { exit_code: 0, stdout: execFileSync(process.execPath, [path.join(body.plugin.root, body.plugin_script), ...body.args], { encoding: 'utf8', cwd: body.cwd || body.plugin.root }), stderr: '' };
    else {
      const p = body.prompt; prompts.push(p);
      const cwd = body.agent && body.agent.cwd, put = (f, t) => { fs.mkdirSync(path.dirname(path.join(cwd, f)), { recursive: true }); fs.writeFileSync(path.join(cwd, f), t); };
      if (/설계에 쓸 조건으로 정리해/.test(p)) result = { text: '', structured: { _brief: BRIEF } };
      else if (/알아서 돌아가는 데까지/.test(p)) result = { text: '', structured: { _plan: PLAN } };
      else if (/설계를 고치는/.test(p)) result = { text: '', structured: { changed: false, summary: '', _plan: PLAN } };
      else if (/사실을 모으는 조사 담당/.test(p)){ put('.pilot/research.md', '# 조사\n수수료 5%'); result = { text: '조사 끝' }; }
      else if (/실행 담당 AI/.test(p)){ put('.pilot/out/kickoff.json', JSON.stringify({ summary: '규칙을 조사했어요', items: [], files: [], done_todos: [{ sub: 'acq', text: '규칙 조사하기' }], me_next: ['계정 만들기'] })); result = { text: '시동 끝' }; }
      else if (/자동 루프를 맡은 AI/.test(p)){ const out = p.match(/\.pilot\/out\/[^\s"']+\.json/)[0]; put(out, JSON.stringify({ summary: '초안 2개', items: [{ title: '초안 1', copy: '글 하나' }] })); result = { text: '루프 끝' }; }
      else result = { text: '모르는 프롬프트' };
    }
    const job = { id, status: 'done', result }; jobs.set(id, job); return send(201, { job });
  }
  const m = u.pathname.match(/^\/v1\/jobs\/(\w+)$/);
  if (m) return send(200, { job: jobs.get(m[1]) });
  send(404, {});
});
let runner;
before(async () => {
  await new Promise(r => ai.listen(0, '127.0.0.1', r));
  const plugins = await import('../server/plugins.js');
  const { createRunner } = await import('../server/runner.js');
  const ins = await plugins.inspect({ local: new URL('../plugins/project-pilot/', import.meta.url).pathname });
  assert.equal(ins.ok, true, ins.errors.join());
  await plugins.install(path.join(DATA, P), ins.stage);
  runner = createRunner({ DATA, listProfiles: async () => [{ name: P }] });
  await runner.setRunner(P, { on: true, ai: { url: `http://127.0.0.1:${ai.address().port}`, token: 'test-token-0123456789' } });
  await runner.setLocal(P, ID, { settings: { workspace: WORK } });
});
after(() => { ai.close(); fs.rmSync(T, { recursive: true, force: true }); });

const state = async () => (await runner.status(P)).plugins[ID].state;
async function until(fn, label){
  for (let i = 0; i < 80; i++){ await runner.tick(); const r = (await state()).runs[0]; if (r && fn(r)) return r; }
  const r = (await state()).runs[0]; assert.fail(`${label}: ${r && r.status} ${JSON.stringify(r && r.steps.map(s => [s.key, s.status, s.error]))}`);
}

test('AI에게 맡기기 — 고칠 점이 없으면 반영 AI를 부르지 않고 카드·노트까지 만든다', async () => {
  await runner.act(P, ID, { type: 'refresh', feed: '새 프로젝트' });
  await runner.act(P, ID, { type: 'start', feed: '새 프로젝트', item: 'new-1', workflow: 'AI에게 맡기기', answer: '하루 10분으로 월 3만원 벌기' });
  let r = await until(r => r.status === 'input', '설계 확인에서 멈춘다');
  assert.equal(r.steps.find(s => s.status === 'input').key, '검토');
  assert.match(r.steps.find(s => s.key === '검토').output.verdict.title, /부수입 3만 — 서브 프로젝트 1개/);
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '검토', value: 'build' });
  r = await until(r => ['done', 'stopped'].includes(r.status), '끝까지 간다');
  assert.equal(r.status, 'done', JSON.stringify(r.steps.map(s => [s.key, s.status, s.error])));
  assert.equal(r.steps.find(s => s.key === '반영').status, 'skipped');
  assert.ok(fs.readdirSync(path.join(T, 'home/args')).length >= 1, '2000자가 넘는 설계는 파일로 넘어간다');
  assert.equal(prompts.filter(p => /설계를 고치는/.test(p)).length, 0);
  assert.ok(prompts.every(p => !/\{(준비|자료|검토|구체화)\.[^}]+\}/.test(p)), '모든 프롬프트의 자리가 채워진다');
  assert.equal(r.steps.at(-1).output.verdict.title, 'AI가 할 일 1개를 먼저 해 뒀어요');
  const card = fs.readdirSync(path.join(DATA, P, '03_행동/단기보드')).find(f => f.includes('채널 열기'));
  assert.match(fs.readFileSync(path.join(DATA, P, '03_행동/단기보드', card), 'utf8'), /- \[x\] 🤖 규칙 조사하기\n- \[ \] 🙋 계정 만들기 \(5분\)/);
  assert.ok(fs.existsSync(path.join(WORK, fs.readdirSync(WORK)[0], '.claude/settings.json')));
});

test('오늘 할 것 — 루프를 돌려 복사할 글을 보이고, 했어요를 누르면 끝', async () => {
  await runner.act(P, ID, { type: 'refresh', feed: '오늘 할 것' });
  const it = (await state()).feeds['오늘 할 것'].items[0];
  assert.equal(it.title, '글 초안');
  await runner.act(P, ID, { type: 'start', feed: '오늘 할 것', item: it.id });
  let r = await until(r => r.workflow === '루프 돌리기' && r.status === 'input', '내 차례가 된다');
  const s = r.steps.find(x => x.key === '결과');
  assert.equal(s.output.findings[0].copy, '글 하나');
  assert.equal(s.ask.inline, true);
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '결과', value: 'done' });
  r = await until(r => r.workflow === '루프 돌리기' && r.status === 'done', '끝난다');
  assert.equal(r.steps.at(-1).output.outcome.title, '했어요');
});

test('다르게 할래요 — 부탁은 사유만 남기고 끝, 정할 것은 고칠 요청을 고쳐 보내면 설계 고치기까지', async () => {
  const wf = (await runner.status(P)).plugins[ID].workflows.find(w => w.name === '다르게 할래요');
  assert.equal(wf.ok, '이유 보내기');
  await runner.act(P, ID, { type: 'refresh', feed: '내가 할 일' });
  const items = (await state()).feeds['내가 할 일'].items;
  const dec = items.find(i => i.vars.kind === 'decision');
  assert.ok(dec, `정할 것이 목록에 있다: ${JSON.stringify((await state()).feeds['내가 할 일'])}`);
  await runner.act(P, ID, { type: 'start', feed: '내가 할 일', item: dec.id, workflow: '다르게 할래요', answer: '블로그도 하고 싶어요' });
  let r = await until(r => r.workflow === '다르게 할래요' && r.status === 'input', '고칠 요청을 묻는다');
  const ask = r.steps.find(s => s.key === '검토').ask;
  assert.equal(ask.value, "'스레드 하나로 시작할까요?' 바꿔 줘. 이유: 블로그도 하고 싶어요");
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '검토', value: '스레드와 블로그를 같이 해 줘. 이유: 블로그도 하고 싶어요' });
  r = await until(r => r.workflow === '다르게 할래요' && r.status === 'input' && r.steps.find(s => s.key === '확인').status === 'input', '고친 설계를 확인한다');
  assert.ok(prompts.some(p => p.includes('스레드와 블로그를 같이 해 줘')), '반영 AI가 고칠 요청을 받는다');
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '확인', value: 'build' });
  r = await until(r => r.workflow === '다르게 할래요' && ['done', 'stopped'].includes(r.status), '끝난다');
  assert.equal(r.status, 'done', JSON.stringify(r.steps.map(s => [s.key, s.status, s.error])));
  await runner.act(P, ID, { type: 'refresh', feed: '내가 할 일' });
  assert.equal((await state()).feeds['내가 할 일'].items.some(i => i.vars.kind === 'decision'), false);
});
