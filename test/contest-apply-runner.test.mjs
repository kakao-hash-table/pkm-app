// 공모전 신청을 실제 실행기(server/runner.js)로 — 낼 공모전 목록의 정렬 값, 제출 준비(AI 안 → 냈나요 → 낸 안 → 정리),
// 그리고 제출용 내 정보(private 짚은 곳)가 끝나거나 그만둔 실행의 상태 파일에 남지 않는지. 사이트 읽기는 네트워크라 빼고 찾은 뒤의 저장 꼴을 넣는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-contest-run-'));
Object.assign(process.env, { PKM_HOME: path.join(T, 'home'), PKM_HOST_NAME: '집맥', PKM_RUNNER_TICK: '999999' });
const DATA = path.join(T, 'data'), P = '개인', ID = 'contest-apply';
fs.mkdirSync(path.join(DATA, P), { recursive: true });
fs.writeFileSync(path.join(DATA, P, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');
const FIT = { i: 0, unreadable: false, target: true, target_why: '', kinds: ['네이밍'], prize: { text: '대상 100만원', total: 2000000, first: 1000000, goods: false, awards: ['대상 · 100만원'] },
  deadline: '2099-11-20', announce: '2099-12-05', announce_text: '', submit: { what: '이름 1개 + 뜻풀이 200자', allow: 1, desc_limit: 200, note: '', fields: ['이름', '연락처'], method: 'email', to: 'a@b.kr', how: '이메일 접수', subject: '' },
  eligibility: { text: '누구나', ok: 'yes', why: '제한 없음' } };
const db = { contests: {
  'wevity:1': { key: 'wevity:1', site: 'wevity', source: '위비티', title: '수원 네이밍 공모', url: 'https://www.wevity.com/?c=find&s=1&gbn=viewok&ix=1', organizer: '수원시', deadline: '2099-11-20', added: '2099-11-01T00:00:00Z', fit: FIT, brief: '요강본문표시' },
  'wevity:2': { key: 'wevity:2', site: 'wevity', source: '위비티', title: '상금 큰 공모', url: 'https://www.wevity.com/?c=find&s=1&gbn=viewok&ix=2', organizer: '서울시', deadline: '2099-11-25', added: '2099-11-01T00:00:00Z', fit: { ...FIT, prize: { ...FIT.prize, first: 5000000 }, announce: '' } } } };
fs.mkdirSync(path.join(DATA, P, '_플러그인/.data/contest-apply'), { recursive: true });
fs.writeFileSync(path.join(DATA, P, '_플러그인/.data/contest-apply/db.json'), JSON.stringify(db));

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
    if ((body.args || []).some(a => typeof a !== 'string' || a.length > 2000)) return send(400, { error: 'args는 문자열 배열이어야 해요' });
    if (body.plugin_script) result = { exit_code: 0, stdout: (await exec(process.execPath, [path.join(body.plugin.root, body.plugin_script), ...body.args], { encoding: 'utf8' })).stdout, stderr: '' };
    else {
      prompts.push(body.prompt);
      result = /카피라이터/.test(body.prompt) ? { text: '', structured: { _draft: { candidates: [{ kind: '네이밍', text: '수원새빛', why: '새 빛' }, { kind: '네이밍', text: '수원온', why: '따뜻함' }], note: '' } } } : { text: '모르는 프롬프트' };
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
  const ins = await plugins.inspect({ local: new URL('../plugins/contest-apply/', import.meta.url).pathname });
  assert.equal(ins.ok, true, ins.errors.join());
  assert.deepEqual(ins.manifest.permissions.plain, ['NAVER_ID'], '아이디는 비밀이 아니다 — 가리면 내 이메일 주소까지 ***가 된다(비밀번호는 가린다)');
  await plugins.install(path.join(DATA, P), ins.stage);
  runner = createRunner({ DATA, listProfiles: async () => [{ name: P }] });
  await runner.setRunner(P, { on: true, ai: { url: `http://127.0.0.1:${ai.address().port}`, token: 'test-token-0123456789' } });
  await runner.setLocal(P, ID, { settings: { me: '이름\t홍길동\n연락처\t010-9999-8888\n이메일\thong@example.com', prompt: '4글자 안팎으로' } });
});
after(() => { ai.close(); fs.rmSync(T, { recursive: true, force: true }); });

const state = async () => (await runner.status(P)).plugins[ID].state;
const stateFile = () => fs.readFileSync(path.join(DATA, P, '_플러그인/.state', `${ID}.json`), 'utf8');
async function until(fn, label){
  for (let i = 0; i < 80; i++){ await runner.tick(); const r = (await state()).runs[0]; if (r && fn(r)) return r; }
  const r = (await state()).runs[0]; assert.fail(`${label}: ${r && r.status} ${JSON.stringify(r && r.steps.map(s => [s.key, s.status, s.error]))}`);
}

test('낼 공모전 — 항목에 정렬 값(sort)이 남고, 워크플로우 값은 cid로 넘긴다', async () => {
  await runner.act(P, ID, { type: 'refresh', feed: '낼 공모전' });
  const items = (await state()).feeds['낼 공모전'].items;
  assert.deepEqual(items.map(i => i.id), ['wevity:1', 'wevity:2']);
  assert.deepEqual(items[1].sort, { deadline: '2099-11-25', prize: 5000000, announce: null });
  assert.deepEqual(items[0].vars, { cid: 'wevity:1' });
});

test('제출 준비 — 그만두면 내 정보가 상태 파일에서 지워지고, 다시 하면 AI를 건너뛰어 냈어요까지 간다', async () => {
  await runner.act(P, ID, { type: 'start', feed: '낼 공모전', item: 'wevity:1', workflow: '제출 준비' });
  let r = await until(r => r.status === 'input', '냈나요에서 멈춘다');
  const ask = r.steps.find(s => s.key === '제출');
  assert.equal(ask.ask.question.startsWith('냈나요?'), true);
  assert.deepEqual(ask.output.findings.filter(f => f.private).map(f => f.where), ['메일 제목', '메일 본문']);
  assert.equal(ask.output.findings[0].copy, '수원새빛\n새 빛', '이메일은 이름 + 뜻풀이');
  const p = prompts.find(p => /카피라이터/.test(p));
  assert.match(p, /요강본문표시/);
  assert.match(p, /4글자 안팎으로/);
  assert.doesNotMatch(p, /010-9999-8888/, '내 정보는 AI에게 보내지 않는다');
  await runner.act(P, ID, { type: 'cancel', run: r.id });
  assert.doesNotMatch(stateFile(), /010-9999-8888/, '그만둔 실행에 내 정보가 남지 않는다');

  const before = prompts.length;
  await runner.act(P, ID, { type: 'start', feed: '낼 공모전', item: 'wevity:1', workflow: '제출 준비' });
  r = await until(r => r.status === 'input', '두 번째도 냈나요에서 멈춘다');
  assert.equal(r.steps.find(s => s.key === '안').status, 'skipped');
  assert.equal(prompts.length, before, 'AI 안이 있으면 AI를 부르지 않는다');
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '제출', value: 'yes' });
  r = await until(r => r.status === 'input' && r.steps.find(s => s.key === '낸안').status === 'input', '낸 안을 묻는다');
  assert.equal(r.steps.find(s => s.key === '낸안').ask.value, '수원새빛');
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '낸안', value: '수원새빛' });
  r = await until(r => ['done', 'stopped'].includes(r.status), '끝까지 간다');
  assert.equal(r.status, 'done', JSON.stringify(r.steps.map(s => [s.key, s.status, s.error])));
  assert.equal(r.steps.at(-1).output.verdict.title, '냈어요 · 발표 12월 5일');
  assert.doesNotMatch(stateFile(), /010-9999-8888|hong@example\.com/);
  await runner.act(P, ID, { type: 'refresh', feed: '결과 기다리는 공모전' });
  assert.deepEqual((await state()).feeds['결과 기다리는 공모전'].items.map(i => i.id), ['wevity:1']);
});

test('reask — 내 확인을 기다리는 동안 접수처가 바뀌면 AI 없이 그 단계만 다시 돌려 새로 묻는다', async () => {
  await runner.act(P, ID, { type: 'start', feed: '낼 공모전', item: 'wevity:2', workflow: '제출 준비' });
  const to = r => { const s = r.steps.find(s => s.key === '제출'), f = s && s.output && (s.output.findings || []).find(f => f.where === '받는 사람'); return f && f.title; };
  let r = await until(r => r.status === 'input', '냈나요에서 멈춘다');
  assert.equal(to(r), 'a@b.kr');
  const asked = prompts.length, file = path.join(DATA, P, '_플러그인/.data/contest-apply/db.json'), d = JSON.parse(fs.readFileSync(file, 'utf8'));
  d.contests['wevity:2'].fit.submit.to = 'new@b.kr'; fs.writeFileSync(file, JSON.stringify(d));
  await runner.act(P, ID, { type: 'refresh', feed: '낼 공모전' });
  r = await until(r => r.status === 'input' && to(r) === 'new@b.kr', '바뀐 접수처로 새로 묻는다');
  assert.equal(r.steps.find(s => s.key === '안').status, 'done', '앞 단계는 그대로');
  assert.equal(prompts.length, asked, 'AI를 다시 부르지 않는다');
  // 바뀐 게 없으면 다시 묻지 않는다
  const at = r.updated;
  await runner.act(P, ID, { type: 'refresh', feed: '낼 공모전' }); await runner.tick();
  assert.equal((await state()).runs[0].updated, at);
});

test('완전 자동화 — 칸에서 켜면 켜고 끄는 설정이 바뀌고, 목록을 바뀐 설정으로 다시 가져온다', async () => {
  await runner.act(P, ID, { type: 'refresh', feed: '완전 자동화' });
  assert.equal((await state()).feeds['완전 자동화'].items[0].title, '완전 자동화 꺼짐');
  await runner.act(P, ID, { type: 'start', feed: '완전 자동화', item: 'full-auto', workflow: '완전 자동화 바꾸기' });
  let r = await until(r => r.workflow === '완전 자동화 바꾸기' && r.status === 'input', '켤지 묻는다');
  assert.match(r.steps[0].ask.choices[0].confirm, /제출은 되돌릴 수 없어요/);
  await runner.act(P, ID, { type: 'answer', run: r.id, step: '바꾸기', value: 'on' });
  await until(r => r.workflow === '완전 자동화 바꾸기' && r.status === 'done', '켠다');
  for (let i = 0; i < 6; i++) await runner.tick();
  assert.equal((await runner.status(P)).plugins[ID].local.settings.full_auto, true);
  assert.equal((await state()).feeds['완전 자동화'].items[0].title, '완전 자동화 켜짐');
});

