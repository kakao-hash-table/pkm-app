// 프로젝트 파일럿 플러그인(plugins/project-pilot) — 임시 프로필에서 목표 → 설계 확인 → 카드·장기·루틴·노트 만들기 → 루프·점검·숫자 기록까지.
// AI 단계(구체화·조사·설계·시동·루프)는 사람이 쓴 결과로 대신하고, 스크립트가 만든 파일을 앱(pkm-md.js)이 그대로 읽고 다시 쓰는지 본다.
// 실행기의 [다시 하기]로 같은 단계를 두 번 돌려도 카드·기록이 두 번 쓰이지 않는지도 본다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as plugins from '../server/plugins.js';
import * as E from '../plugins/project-pilot/scripts/engine.mjs';

const MD = createRequire(import.meta.url)('../web/js/pkm-md.js');
const P = createRequire(import.meta.url)('../web/js/pkm-plugin.js');
const PLUGIN = new URL('../plugins/project-pilot/', import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-pilot-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const profile = path.join(tmp, '개인'), work = path.join(tmp, 'work');
write(path.join(profile, '_설정.md'), '---\ntype: settings\nformat: 1\nfolders:\n  project: "03_행동/단기보드"\n  area: "03_행동/장기보드"\n  routine: "03_행동/루틴보드"\n  context: "01_지식/맥락노트"\n---\n');
write(path.join(profile, '03_행동/단기보드/스레드 키우기.md'), '---\ntype: project\nid: tflag01\ntitle: 스레드 키우기\nstatus: todo\n---\n\n# 할 일\n\n# 완료 조건\n\n# 메모\n- 팔로워 1천 명 #설계\n');

const run = (cmd, a = {}) => JSON.parse(execFileSync(process.execPath, [path.join(PLUGIN, 'scripts/pilot.mjs'), cmd, `--profile=${profile}`, `--work-root=${work}`, ...Object.entries(a).map(([k, v]) => `--${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)], { encoding: 'utf8' }));
const files = () => { const out = {}; const walk = (d, b = '') => { for (const e of fs.readdirSync(d, { withFileTypes: true })){ if (e.name.startsWith('.')) continue; const r = b ? `${b}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else if (r.endsWith('.md')) out[r] = fs.readFileSync(path.join(d, e.name), 'utf8'); } }; walk(profile); return out; };
const db = () => MD.parse(files()).db;
const rec = pid => JSON.parse(fs.readFileSync(path.join(profile, '_플러그인/.data/project-pilot', `${pid}.json`), 'utf8'));

const PLAN = {
  name: '쉐어링크 월 10만', one_liner: '자취 직장인 생활용품 특가를 스레드에 매일 하나씩', strategy: '하루 10분으로 월 10만원은 처음부터 어렵다. 첫 수익 1건부터 단계로 간다.\n# 핵심\n객단가가 첫 레버다.',
  metric: { name: '쉐어링크 확정 수익', unit: '원', target: 100000, period: '월 (2027-01 확정분 기준)' },
  tree: [{ name: '월 클릭', value: '2,000회', assumed: true, note: '' }, { name: '수수료율', value: '5%', assumed: false, note: '공식 공지', source_url: 'https://sharelink-docs.toss.im/notice' }, { name: '전환율', value: '3%', assumed: false, note: '후기', source_url: '' }],
  milestones: [{ name: '첫 신호', target: '확정 수익 1건', by: '2주', next: '클릭 1건 이상' }],
  decisions: ['기한 3개월로 가정'], me_minutes: 9, routine_at: '21:00',
  subprojects: [
    { key: 'offer', lens: '오퍼', title: '대상과 차별점 정하기', why: '좁을수록 쉽다', outcome: '프로필 첫 줄', wave: 0, done: ['프로필 문구 확정'], todos: [{ text: '포지셔닝 후보 5개 쓰기', who: 'ai', minutes: 0 }, { text: '하나 고르기', who: 'me', minutes: 2 }] },
    { key: 'acquire', lens: '고객유치', title: '스레드 채널 열기', why: '', outcome: '첫 클릭', done: ['2주 안에 클릭 1건'], todos: [{ text: '글 쓰기 검토', who: 'me', minutes: 3 }, { text: '글 쓰기', who: 'ai', minutes: 0 }, { text: '스레드 규칙 조사하기', who: 'ai', minutes: 0 }] },
    { key: 'tools', lens: '운영툴', title: '링크 기록표', why: '', outcome: 'CSV', wave: 2, done: [], todos: [{ text: '링크 기록 CSV 만들기', who: 'ai', minutes: 0 }] }
  ],
  loops: [
    { key: 'draft', title: '오늘 올릴 글 초안', sub: 'acquire', every: 'daily', at: '08:00', task: '특가 하나로 글 초안 2개, 표기 문구 포함', me: '골라 올리기', me_minutes: 5, metric: '월 클릭' },
    { key: 'scout', title: '소재 찾기', sub: 'acquire', every: 'weekdays', at: '07:30', task: '특가 후보 3개', me: '', me_minutes: 0, metric: '' },
    { key: 'dup', title: '주간 점검', every: 'weekly', dow: 7, at: '19:00', task: 'AI가 넣은 중복 점검', me: '', me_minutes: 0, metric: '' }
  ],
  checkins: [{ key: 'weekly', question: '이번 주 쉐어링크 확정 수익은 얼마였나요?', unit: '원', every: 'weekly', dow: 7, at: '20:00', to_metric: true }],
  risks: [{ risk: '표기 누락', guard: '초안마다 표기 문구' }], first_week: ['쉐어링크 가입하기'], assumptions: ['클릭률 1%'], sources: [{ title: '쉐어링크 공지', url: 'https://sharelink-docs.toss.im/notice' }]
};
const BRIEF = { goal: '토스 쉐어링크로 하루 10분, 3개월 안에 월 10만원', metric: '확정 수익', target: '월 100,000원', deadline: '3개월', minutes: 10, budget: '0원', assets: [], exclude: [], assumptions: ['3개월'], verdict: 'hard', verdict_why: '수수료 5%',
  questions: [{ question: '어떤 상품을 다룰까요?', assume: '생활용품', blocking: true }, { question: '블로그가 있나요?', assume: '없음', blocking: true }] };
let pid;

test('규격 검사를 통과하고, 워크플로우의 자리는 모두 앞 단계·항목·설정으로 채워진다', async () => {
  const r = await plugins.inspect({ local: PLUGIN });
  assert.equal(r.ok, true, (r.errors || []).join('\n'));
  assert.deepEqual(r.feeds.map(f => f.name), ['내가 할 일', '오늘 할 것', '숫자 기록', '내 프로젝트', '새 프로젝트', '설계할 카드']);
  const wf = r.workflows.find(w => w.name === 'AI에게 맡기기');
  assert.equal(wf.note, '설계를 먼저 보여 드려요. 내가 확인해야 카드를 만들어요.');
  assert.equal(wf.steps.find(s => s.key === '반영').when, '{검토.request}');
});

test('불법·금지 기법뿐인 목표는 설계하지 않는다', () => {
  const r = run('init', { goal: '체험단 계정 여러 개로 후기 쓰기' });
  assert.match(run('brief', { pid: r.pid, brief: { ...BRIEF, verdict: 'refuse', verdict_why: '다계정 후기는 금지예요' } }).error, /설계하지 않아요. 다계정/);
});

test('새 프로젝트 → 구체화(꼭 물을 것 하나만) → 맥락', () => {
  assert.equal(run('new-list').items[0].id, 'new-2');
  const r = run('init', { goal: '토스 쉐어링크로 하루 10분 이하로 월 10만원 벌기' });
  pid = r.pid;
  assert.ok(fs.existsSync(path.join(r.work, '.pilot/out')));
  assert.ok(r.work.startsWith(work + path.sep) && r.work.endsWith(pid.slice(-4)));   // 같은 날 같은 목표여도 폴더가 겹치지 않는다
  const guard = JSON.parse(fs.readFileSync(path.join(r.work, '.claude/settings.json'), 'utf8'));
  assert.ok(guard.permissions.deny.includes(`Write(/${profile}/**)`));   // 에이전트가 노트 폴더를 고치지 못하게
  const asked = run('brief', { pid, brief: BRIEF });
  assert.equal(asked.ask.question, '어떤 상품을 다룰까요?');
  assert.equal(asked.ask.hint, '모르면 이렇게 가정해요: 생활용품');
  run('brief', { pid, brief: BRIEF, answer: '주방용품' });
  const ok = run('brief', { pid, brief: BRIEF, answer: '주방용품' });   // 다시 해도 답이 두 번 쌓이지 않는다
  assert.match(ok.summary, /닿기 어려움/);
  assert.deepEqual(rec(pid).brief.answers, ['어떤 상품을 다룰까요? → 주방용품']);
  const ctx = run('context', { pid });
  assert.match(ctx._ctx, /주방용품/);
  assert.match(ctx._playbook, /설계 순서/);
});

test('설계 확인 — 출처 없는 "확인" 숫자는 가정으로, AI가 넣은 주간 점검은 빼고, 고칠 점을 받는다', () => {
  const r = run('review', { pid, plan: PLAN });
  assert.equal(r.verdict.tone, 'ok');
  assert.match(r.verdict.title, /서브 프로젝트 3개 · 자동 루프 3개/);   // 오늘 올릴 글·소재 찾기 + 시스템 주간 점검
  assert.equal(r.findings[0].where, '결정할 것');
  assert.equal(r.findings[0].tag, undefined);   // 중립 정보는 빨간 배지(tag) 대신 note
  assert.ok(r.findings.find(f => f.where === '1차 · 고객유치').text.includes('나 · 글 쓰기 검토 (3분)'));
  assert.match(r.findings.find(f => f.where === '목표 숫자 역산').text, /수수료율: 5% \(확인\)\n전환율: 3% \(가정\)/);
  assert.equal(r.ask.choices[0].value, 'build');
  assert.equal(run('review', { pid, answer: 'build' }).request, '');
  assert.equal(run('review', { pid, answer: '블로그 빼 줘' }).request, '블로그 빼 줘');
  assert.equal(run('review', { pid, plan: PLAN, auto: 'true' }).ask, undefined);   // 바로 만들기 설정
  const over = { ...PLAN, loops: [{ ...PLAN.loops[0], me_minutes: 30 }] };
  assert.ok(run('review', { pid, plan: over, auto: 'true' }).ask, '예산을 넘으면 바로 만들기여도 묻는다');
  run('review', { pid, plan: PLAN });
});

test('만들기 — 앱이 그대로 읽고, 다시 저장해도 바뀌지 않는 카드·장기·루틴·맥락노트', () => {
  const r = run('build', { pid, plan: '' });
  assert.equal(r.verdict.title, '카드 3개를 만들었어요');
  const D = db();
  const tasks = D.tasks.filter(t => t.title.startsWith('쉐어링크 월 10만'));
  assert.equal(tasks.length, 3);
  const acq = tasks.find(t => t.title.includes('스레드 채널 열기'));
  assert.equal(acq.status, '진행');   // wave를 빠뜨리면 1차
  assert.equal(acq.area, '쉐어링크 월 10만');
  assert.deepEqual(acq.todos.map(t => t.t), ['🙋 글 쓰기 검토 (3분)', '🤖 글 쓰기', '🤖 스레드 규칙 조사하기']);
  assert.equal(D.longs[0].unit, '원');
  assert.equal(D.routines[0].title, '쉐어링크 월 10만 5분');
  const hub = D.ctxs.find(c => c.title === '쉐어링크 월 10만 설계');
  assert.match(hub.body, /## 목표 숫자 역산/);
  assert.match(hub.body, /^## 핵심$/m);   // 전략 글의 '# '는 칸 제목이 되지 않게 한 단계 낮춘다
  assert.match(hub.body, /## 서브 프로젝트/);
  const again = MD.serialize(MD.parse(files()));
  for (const [k, v] of Object.entries(files())) if (/쉐어링크/.test(k)) assert.equal(again[k], v, k);
  assert.equal(run('build', { pid }).verdict.title, '설계를 바꿨어요');   // 다시 해도 카드가 늘지 않는다
  assert.equal(db().tasks.filter(t => t.title.startsWith('쉐어링크 월 10만')).length, 3);
});

test('시동 결과 — 🤖 할 일만, 글이 정확히 같을 때만 체크하고, 다시 해도 일지에 한 번', () => {
  const pr = rec(pid);
  write(path.join(pr.work, '.pilot/out/kickoff.json'), JSON.stringify({ summary: '첫 글 3개와 기록표를 만들었어요', items: [{ title: '첫 글', copy: '광고: 이 글은 쉐어링크로 수수료를 받아요\n원룸 가전 고르는 법', where: '스레드' }, { title: '표기 빠진 글', copy: '이거 무조건 사세요 29,000원' }],
    files: ['content/첫글.md', 'content/없는파일.md'], done_todos: [{ sub: 'acquire', text: '글 쓰기' }, { sub: 'acquire', text: '조사' }, { sub: 'offer', text: '하나 고르기' }, { sub: 'acquire', text: ' ' }], me_next: ['쉐어링크 가입하기'] }));
  write(path.join(pr.work, 'content/첫글.md'), '첫 글');
  const r = run('kickoff-done', { pid });
  assert.equal(r.verdict.title, 'AI가 할 일 1개를 먼저 해 뒀어요');
  assert.match(r.verdict.text, /자동 시작을 켜 주세요/);
  assert.equal(r.findings[0].tag, undefined);
  assert.equal(r.findings[1].tag, '표기 없음 · 과장 표현');
  assert.equal(r.findings[1].note, '가격 확인 필요');
  assert.deepEqual(r.findings.filter(f => f.where === '만든 파일').map(f => f.title), ['content/첫글.md']);
  const todos = () => db().tasks.find(t => t.title.includes('스레드 채널 열기')).todos.map(x => x.d);
  assert.deepEqual(todos(), [false, true, false]);   // 사람 몫 '글 쓰기 검토'와 부분 일치 '조사'는 체크하지 않는다
  assert.equal(db().tasks.find(t => t.title.includes('대상과 차별점')).todos[1].d, false);   // 🙋은 AI가 체크하지 못한다
  write(path.join(pr.work, '.pilot/out/kickoff.json'), JSON.stringify({ summary: 's', items: [{ title: '명령', copy: 'node tools/check.mjs content/첫글.md' }], done_todos: [{ sub: '고객유치', text: '스레드 규칙 조사하기' }] }));
  const pr2 = rec(pid); pr2.kickoff_done = false; fs.writeFileSync(path.join(profile, '_플러그인/.data/project-pilot', `${pid}.json`), JSON.stringify(pr2));
  const r2 = run('kickoff-done', { pid });
  assert.equal(r2.findings[0].tag, undefined);   // 명령어는 표기 검사 대상이 아니다
  assert.deepEqual(todos(), [false, true, true]);   // 키 대신 렌즈 이름을 적어도 같은 🤖 글이면 체크
  run('kickoff-done', { pid });
  assert.equal((db().ctxs.find(c => c.title === '쉐어링크 월 10만 운영 일지').body.match(/첫 작업/g) || []).length, 2);   // 위에서 일부러 한 번 더 돌렸다
});

test('내가 할 일 — AI 요청·정할 것·카드의 🙋 할 일을 한 목록에, [했어요]면 카드에도 체크', () => {
  const pr = rec(pid);
  write(path.join(pr.work, '.pilot/out/kickoff.json'), JSON.stringify({ summary: 's', items: [], me_asks: [{ text: '카카오 오픈채팅 운영정책 읽기', why: '홍보 조항 확인 필요', after: '' }, { text: '앱에서 니치 가격 채우기', after: '2026-11-05' }, { text: 'x' }] }));
  const p2 = rec(pid); p2.kickoff_done = false; fs.writeFileSync(path.join(profile, '_플러그인/.data/project-pilot', `${pid}.json`), JSON.stringify(p2));
  run('kickoff-done', { pid });
  const list = run('me-list', { now: '2026-11-01T22:00:00' }).items;
  assert.deepEqual(list.map(i => i.tags[0]), ['AI 요청', '정할 것', '2분', '3분', 'AI 요청']);   // 지금 할 수 있는 요청 → 정할 것 → 셋업·1차 카드의 🙋 → 날짜가 지나야 하는 요청
  assert.equal(list[0].title, '카카오 오픈채팅 운영정책 읽기');
  assert.match(list[4].meta.join(' '), /11\/05부터 할 수 있어요/);
  const todo = list.find(i => i.title === '글 쓰기 검토');
  assert.equal(run('me-done', todo.vars).outcome.title, '했어요');
  assert.equal(db().tasks.find(t => t.title.includes('스레드 채널 열기')).todos[0].d, true);
  for (const i of list.filter(i => i.vars.kind !== 'todo')) run('me-done', i.vars);
  assert.deepEqual(run('me-list').items.map(i => i.title), ['하나 고르기']);
  assert.equal(run('me-done', todo.vars).verdict.title, '이미 체크돼 있어요');   // 다시 눌러도 괜찮다
});

test('내가 할 일 — 이어 둔 파일은 항목 안에 보이고, 작업 폴더 밖·없는 파일은 읽지 않으며, id·version은 그대로', () => {
  const save = f => { const p = rec(pid); f(p); fs.writeFileSync(path.join(profile, '_플러그인/.data/project-pilot', `${pid}.json`), JSON.stringify(p)); };
  const pr = rec(pid), before = run('me-list').items.find(i => i.title === '하나 고르기');
  assert.equal(before.detail, undefined);   // 이은 파일이 없으면 예전 그대로
  assert.match(run('loop-prep', { pid, loop: 'draft', period: '2026-11-21' }).task, /아직 볼 파일이 이어지지 않은 내 몫[\s\S]*- 하나 고르기/);

  // 설계에 적은 볼 파일 — 아직 만들지 않았으면 그 사실만
  save(p => { p.plan.subprojects.find(s => s.key === 'offer').todos.find(t => t.text === '하나 고르기').see = ['content/계획.md']; });
  assert.deepEqual(run('me-list').items.find(i => i.title === '하나 고르기').detail, [{ who: 'content/계획.md', kind: 'missing', text: '파일이 아직 없어요' }]);

  // 시동·루프 결과의 me_see·me_asks.files — 실제로 만든 파일이 설계보다 앞선다
  write(path.join(pr.work, 'content/후보.md'), '# 후보\n이름: 예시 계정\n소개: 예시 소개 문구\n');
  write(path.join(tmp, 'outside.md'), '밖에 있는 비밀');
  fs.symlinkSync(path.join(tmp, 'outside.md'), path.join(pr.work, 'content/link.md'));
  write(path.join(pr.work, '.pilot/out/kickoff.json'), JSON.stringify({ summary: 's', items: [],
    me_see: [{ text: '🙋 하나 고르기 (2분)', files: ['./content/후보.md'] }],
    me_asks: [{ text: '예시 자료 확인하기', why: '시험', files: ['../outside.md', '/etc/hosts', 'content/link.md', 'content/넷째.md'] }, { text: '예시 표 채우기', files: ['content/없음.md'] }] }));
  save(p => { p.kickoff_done = false; });
  run('kickoff-done', { pid });
  const items = run('me-list').items, todo = items.find(i => i.title === '하나 고르기'), ask = items.find(i => i.title === '예시 자료 확인하기'), ask2 = items.find(i => i.title === '예시 표 채우기');
  assert.deepEqual(todo.detail, [{ who: 'content/후보.md', kind: 'file', text: '# 후보\n이름: 예시 계정\n소개: 예시 소개 문구\n' }]);
  assert.match(todo.meta.join(' '), /아래 내용을 보고 끝냈으면 \[했어요\], 바꾸려면 \[다르게 할래요\]/);
  assert.equal(todo.id, before.id); assert.equal(todo.version, before.version);   // 이미 처리한 항목이 다시 올라오지 않게
  assert.deepEqual(ask.detail.map(d => d.kind), ['outside', 'outside', 'outside']);   // 파일은 3개까지
  assert.deepEqual(ask2.detail, [{ who: 'content/없음.md', kind: 'missing', text: '파일이 아직 없어요' }]);
  assert.ok(!JSON.stringify(items).includes('밖에 있는 비밀'));
  assert.doesNotMatch(run('loop-prep', { pid, loop: 'draft', period: '2026-11-22' }).task, /이어지지 않은 내 몫[\s\S]*- 하나 고르기/);

  // 하드 링크는 작업 폴더 안에 있어도 읽지 않는다 · 같은 부탁이 다시 오면 비어 있던 파일만 채운다 · 긴 경로는 확장자가 남게 앞을 줄인다
  fs.linkSync(path.join(tmp, 'outside.md'), path.join(pr.work, 'content/hard.md'));
  const long = `content/${'긴'.repeat(120)}.md`;
  write(path.join(pr.work, '.pilot/out/kickoff.json'), JSON.stringify({ summary: 's', items: [], me_asks: [{ text: '예시 표 채우기', files: ['content/후보.md'] }, { text: '예시 하드 링크 보기', files: ['content/hard.md', long] }] }));
  save(p => { p.kickoff_done = false; delete p.see[ask2.vars.ref]; });
  run('kickoff-done', { pid });
  const again = run('me-list').items, hard = again.find(i => i.title === '예시 하드 링크 보기');
  assert.equal(again.find(i => i.title === '예시 표 채우기').detail[0].who, 'content/후보.md');
  assert.deepEqual(hard.detail.map(d => d.kind), ['linked', 'missing']);
  assert.ok(!JSON.stringify(again).includes('밖에 있는 비밀'));
  assert.match(hard.detail[1].who, /^….*\.md$/); assert.ok(hard.detail[1].who.length <= 110);
  run('me-done', ask.vars); run('me-done', ask2.vars); run('me-done', hard.vars);
});

test('다르게 할래요 — 사유는 필수, AI 요청은 내리고 다시 올리지 않으며, 정할 것·할 일은 사유를 채운 고칠 요청으로 설계 고치기에 넘긴다', () => {
  const save = f => { const p = rec(pid); f(p); fs.writeFileSync(path.join(profile, '_플러그인/.data/project-pilot', `${pid}.json`), JSON.stringify(p)); };
  // AI 요청 — 사유를 남기고 내린다. 같은 부탁은 다시 올라오지 않고, 다음 루프·맥락에 이유가 들어간다
  const pr = rec(pid);
  write(path.join(pr.work, '.pilot/out/kickoff.json'), JSON.stringify({ summary: 's', items: [], me_asks: [{ text: 'X 계정을 만들기', why: '교차 게시' }] }));
  save(p => { p.kickoff_done = false; });
  run('kickoff-done', { pid });
  const ask = run('me-list').items.find(i => i.title === 'X 계정을 만들기');
  assert.match(run('me-reject', { ...ask.vars, reason: ' ' }).error, /이유를 적어 주세요/);
  const r = run('me-reject', { ...ask.vars, reason: '회사 규정상 X는 못 써요' });
  assert.equal(r.request, '');   // 설계 고치기 단계는 when으로 건너뛴다
  assert.equal(r.outcome.title, '뺐어요');
  assert.equal(run('me-list').items.some(i => i.title === 'X 계정을 만들기'), false);
  save(p => { p.kickoff_done = false; });
  run('kickoff-done', { pid });   // AI가 같은 부탁을 또 내도
  assert.equal(run('me-list').items.some(i => i.title === 'X 계정을 만들기'), false);
  assert.match(run('context', { pid })._ctx, /## 사람이 거절하거나 바꾼 것[\s\S]*\[AI 요청\] X 계정을 만들기 — 이유: 회사 규정상 X는 못 써요/);
  assert.match(run('loop-prep', { pid, loop: 'draft', period: '2026-11-20' }).task, /사람이 거절하거나 바꾼 것[\s\S]*X 계정을 만들기 — 이유: 회사 규정상 X는 못 써요/);
  assert.match(rec(pid).log.at(-1).text + rec(pid).log.map(l => l.text).join('\n'), /안 하기로 함: X 계정을 만들기 — 이유: 회사 규정상 X는 못 써요/);

  // 정할 것 — 고칠 요청 글을 채워 보여 주고, 고쳐 보낸 글로 설계 고치기. 만들기까지 가야 목록에서 내린다
  save(p => { p.plan.decisions.push('채널은 스레드 하나로 시작하는 데 동의하나요?'); });
  const dec = run('me-list').items.find(i => i.vars.kind === 'decision');
  const asked = run('me-reject', { ...dec.vars, reason: '블로그도 같이 하고 싶어요' });
  assert.equal(asked.ask.value, "'채널은 스레드 하나로 시작하는 데 동의하나요?' 바꿔 줘. 이유: 블로그도 같이 하고 싶어요");
  assert.equal(asked.ask.free, true);
  const sent = run('me-reject', { ...dec.vars, reason: '블로그도 같이 하고 싶어요', answer: '스레드와 네이버 블로그를 같이 해 줘. 이유: 블로그가 이미 있어요' });
  assert.equal(sent.request, '스레드와 네이버 블로그를 같이 해 줘. 이유: 블로그가 이미 있어요');
  assert.ok(sent._plan.subprojects.length && sent._ctx && sent._playbook);   // 반영 AI에게 넘길 것
  assert.ok(run('me-list').items.some(i => i.vars.kind === 'decision'), '만들기 전에 그만두면 목록에 남는다');
  run('review', { pid, plan: { ...sent._plan, decisions: [] }, confirm: 'yes' });
  run('build', { pid, why: sent.request });
  assert.equal(run('me-list').items.some(i => i.vars.kind === 'decision'), false);
  assert.match(run('context', { pid })._ctx, /\[정할 것\] 채널은 스레드 하나로 시작하는 데 동의하나요\? — 이유: 블로그도 같이 하고 싶어요/);

  // 할 일 — 설계 고치기를 거쳐 만들면 그 줄은 '바꿈: 이유'로 내리고, 새 설계에 생긴 할 일은 카드에 더한다
  const todo = run('me-list').items.find(i => i.title === '하나 고르기');
  assert.equal(run('me-reject', { ...todo.vars, reason: '이미 골랐어요' }).ask.value, "'하나 고르기' 바꿔 줘. 이유: 이미 골랐어요");
  const t2 = run('me-reject', { ...todo.vars, reason: '이미 골랐어요', answer: "'하나 고르기' 바꿔 줘. 이유: 이미 골랐어요" });
  const next = structuredClone(t2._plan);
  const offer = next.subprojects.find(x => x.key === 'offer');
  offer.todos = offer.todos.filter(x => x.text !== '하나 고르기').concat({ text: '고른 니치로 프로필 문구 다듬기', who: 'ai', minutes: 0 });
  run('review', { pid, plan: next, confirm: 'yes' });
  run('build', { pid, why: t2.request });
  const card = db().tasks.find(x => x.title.includes('대상과 차별점'));
  assert.deepEqual(card.todos.map(x => [x.t, x.d]), [['🤖 포지셔닝 후보 5개 쓰기', false], ['🙋 하나 고르기 (2분) (바꿈: 이미 골랐어요)', true], ['🤖 고른 니치로 프로필 문구 다듬기', false]]);
  assert.equal(run('me-list').items.some(i => i.title === '하나 고르기'), false);
  // 했어요는 그대로 — 남은 기록도 예전 꼴로 읽힌다
  assert.ok(Array.isArray(rec(pid).accepted));
});

test('루프 일정 — 매일·평일·매주·매월 회차', () => {
  const l = (o) => E.normalizeLoop({ task: 't', ...o }, 0);
  assert.equal(E.due(l({ every: 'daily', at: '08:00' }), new Date('2026-11-02T07:59:00')), null);
  assert.equal(E.due(l({ every: 'daily', at: '08:00' }), new Date('2026-11-02T08:00:00')).period, '2026-11-02');
  assert.equal(E.due(l({ every: 'weekdays', at: '08:00' }), new Date('2026-11-01T09:00:00')), null);   // 일요일
  assert.equal(E.due(l({ every: 'weekdays', at: '08:00' }), new Date('2026-11-03T09:00:00'), ['2026-11-03']), null);   // 쉬는 날
  const w = l({ every: 'weekly', dow: 7, at: '19:00' });
  assert.equal(E.due(w, new Date('2026-11-07T23:00:00')), null);   // 토요일
  assert.equal(E.due(w, new Date('2026-11-08T19:30:00')).period, '2026-W45');
  assert.equal(E.due(l({ every: 'monthly', day: 1, at: '09:00' }), new Date('2026-11-15T10:00:00')).period, '2026-11');
  assert.equal(E.meMinutes({ loops: [l({ every: 'daily', me_minutes: 5 }), l({ every: 'weekly', me_minutes: 7 })] }), 6);
});

test('오늘 할 것 → 루프 돌리기 → 복사할 글 → 했어요', () => {
  const list = run('loops-list', { now: '2026-11-02T09:00:00' });
  assert.deepEqual(list.items.map(i => i.title), ['오늘 올릴 글 초안', '소재 찾기']);
  const it = list.items[0];
  assert.deepEqual(it.vars, { pid, loop: 'draft', period: '2026-11-02' });
  const prep = run('loop-prep', it.vars);
  assert.match(prep.task, /특가 하나로 글 초안 2개/);
  assert.match(prep.task, /사람 몫\(5분\)/);
  assert.match(prep.task, /첫 줄에 대가성 표기/);
  assert.match(run('loop-done', { pid, loop: 'draft', period: prep.period }).error, /결과 파일이 없어요/);
  write(path.join(prep.work, prep.out), '{"summary": "초안 2개", "items": [');
  assert.match(run('loop-done', { pid, loop: 'draft', period: prep.period }).error, /JSON이 깨짐/);
  write(path.join(prep.work, prep.out), JSON.stringify({ summary: '초안 2개', items: [{ title: '초안 1', copy: '[광고] 수수료를 받아요\n전자레인지 고르는 법' }, { title: '초안 2', copy: '[광고] 수수료를 받아요\n에어프라이어' }] }));
  const r = run('loop-done', { pid, loop: 'draft', period: prep.period });
  assert.deepEqual(r.ask.choices.map(c => c.value), ['done', 'skip']);
  assert.equal(r.ask.inline, true);
  assert.equal(run('loop-done', { pid, loop: 'draft', period: prep.period, answer: 'done' }).outcome.title, '했어요');
  assert.equal((db().ctxs.find(c => c.title === '쉐어링크 월 10만 운영 일지').body.match(/오늘 올릴 글 초안/g) || []).length, 1);
  assert.match(run('loop-prep', { pid, loop: 'draft', period: '2026-11-03' }).task, /이미 낸 것[\s\S]*초안 1 — 전자레인지 고르는 법/);   // 되풀이하지 않게
});

test('피로 규칙 — 사람 몫 루프를 7번 이어서 확인하지 않으면 쉬고, 다시 켜면 돌아온다', () => {
  for (let d = 3; d <= 9; d++){
    const period = `2026-11-${String(d).padStart(2, '0')}`, prep = run('loop-prep', { pid, loop: 'draft', period });
    write(path.join(prep.work, prep.out), JSON.stringify({ summary: 's', items: [{ title: `초안 ${d}`, copy: '[광고] 수수료를 받아요\n글' }] }));
    run('loop-done', { pid, loop: 'draft', period });
  }
  assert.equal(run('loops-list', { now: '2026-11-10T09:00:00' }).items.some(i => i.vars.loop === 'draft'), false);
  assert.match(run('toggle', { pid, to: 'on' }).verdict.text, /쉬던 루프 1개도 켰어요/);
  assert.ok(run('loops-list', { now: '2026-11-10T09:00:00' }).items.some(i => i.vars.loop === 'draft'));
});

test('주간 점검 — 제안대로 바꾸면 카드·루프·설계 노트가 바뀌고, 다시 눌러도 한 번만', () => {
  const rv = run('loops-list', { now: '2026-11-08T19:30:00' }).items.find(i => i.vars.loop === 'review');
  assert.ok(rv, '일요일 19시에 주간 점검이 올라온다');
  const prep = run('loop-prep', rv.vars);
  assert.match(prep.task, /"changes"/);
  write(path.join(prep.work, prep.out), JSON.stringify({ summary: '클릭 0 — 형식을 바꿔요', items: [], changes: [
    { type: 'todo_add', sub: 'acquire', text: '질문형 글 2개 시험하기', who: 'ai' }, { type: 'loop_off', loop: 'scout', why: '안 씀' }, { type: 'target', target: 1 },
    { type: 'sub_add', sub: { key: 'retain', lens: '리텐션', title: '오픈채팅 열기', wave: 2, todos: [{ text: '방 규칙 초안', who: 'ai' }] } }] }));
  const ask = run('loop-done', { pid, loop: 'review', period: prep.period });
  assert.equal(ask.ask.choices[0].value, 'apply');
  assert.equal(ask.findings.filter(f => f.where === '제안').length, 3);   // 목표 숫자 바꾸기는 점검에서 하지 않는다
  const r = run('loop-done', { pid, loop: 'review', period: prep.period, answer: 'apply' });
  assert.match(r.outcome.title, /바꿨어요 · 3개/);
  assert.equal(run('loop-done', { pid, loop: 'review', period: prep.period, answer: 'apply' }).summary, '이미 정했어요');
  const D = db();
  assert.equal(D.tasks.find(t => t.title.includes('스레드 채널 열기')).todos.filter(t => t.t === '🤖 질문형 글 2개 시험하기').length, 1);
  assert.ok(D.tasks.some(t => t.title === '쉐어링크 월 10만 · 리텐션 — 오픈채팅 열기'));
  assert.match(D.ctxs.find(c => c.title === '쉐어링크 월 10만 설계').body, /07:30 \(꺼짐\) \| 소재 찾기/);
  assert.equal(rec(pid).plan.metric.target, 100000);
  assert.equal(run('loops-list', { now: '2026-11-09T09:00:00' }).items.some(i => i.vars.loop === 'scout'), false);
});

test('점검이 사람 몫을 예산보다 늘리면 루프 변경은 되돌린다', () => {
  const prep = run('loop-prep', { pid, loop: 'review', period: 'now', now: '2026-11-09T10:00:00' });
  write(path.join(prep.work, prep.out), JSON.stringify({ summary: '루프 더하기', items: [], changes: [{ type: 'loop_add', loop: { key: 'heavy', title: '긴 루프', every: 'daily', at: '09:00', task: '많이', me: '오래', me_minutes: 30 } }] }));
  const r = run('loop-done', { pid, loop: 'review', period: prep.period, answer: 'apply' });
  assert.match(r.outcome.text, /루프 변경은 되돌렸어요\(내 시간 하루 \d+분 > 예산 10분\)/);
  assert.equal(rec(pid).loops.some(l => l.key === 'heavy'), false);
});

test('숫자 기록 — 회차 날짜로 장기에 쌓고, 다시 해도 두 번 쌓지 않는다', () => {
  const it = run('checkins-list', { now: '2026-11-09T08:00:00' }).items[0];   // 일요일 숫자를 월요일에 적는다
  assert.equal(it.title, '이번 주 쉐어링크 확정 수익은 얼마였나요?');
  assert.equal(it.vars.date, '2026-11-08');
  const vars = { pid, key: it.vars.ck, period: it.vars.period, date: it.vars.date, now: '2026-11-09T08:00:00' };
  assert.match(run('checkin', vars).ask.hint, /이번 달 0원 \/ 10만원/);
  const r = run('checkin', { ...vars, answer: '3만 2천원 정산 2건' });
  assert.match(r.verdict.title, /이번 달 3\.2만원 \/ 10만원 \(32%\)/);
  assert.equal(run('checkin', { ...vars, answer: '3만 2천원 정산 2건' }).verdict.text, '이 회차는 이미 적었어요');
  assert.deepEqual(db().longs[0].records.map(x => [x.date, x.amt]), [['2026-11-08', 32000]]);
  assert.equal(run('checkins-list', { now: '2026-11-09T08:10:00' }).items.length, 0);
  const p = run('projects-list', { now: '2026-11-09T08:10:00' }).items[0];
  assert.deepEqual(p.tags, ['운영 중']);
  assert.match(p.meta[0], /이번 달 3\.2만원 \/ 10만원/);
});

test('장기·설계 노트 이름을 바꿔도 id로 찾아 이어 쓴다', () => {
  const pr = rec(pid), from = path.join(profile, pr.area.path), to = path.join(path.dirname(from), '쉐어링크 수익.md');
  fs.renameSync(from, to);
  const hub = path.join(profile, pr.hub.path); fs.renameSync(hub, path.join(path.dirname(hub), '쉐어링크 설계 노트.md'));
  run('checkin', { pid, key: 'manual', value: '5천 커피값 아님', now: '2026-11-10T10:00:00' });
  assert.deepEqual(db().longs[0].records.map(x => x.amt), [32000, 5000]);
  assert.equal(rec(pid).area.title, '쉐어링크 수익');
  run('revise', { pid, request: '그대로' }); run('build', { pid });
  assert.equal(db().ctxs.filter(c => /설계/.test(c.title)).length, 1);   // 사본을 만들지 않는다
});

test('설계 노트를 직접 고쳤으면 덮지 않는다', () => {
  const pr = rec(pid), f = path.join(profile, pr.hub.path);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('## 전략', '## 전략\n내가 덧붙인 메모'));
  run('revise', { pid, request: '그대로' });
  const b = run('build', { pid });
  assert.match(b.verdict.text, /직접 고친 내용이 있어 그대로 뒀어요/);
  assert.match(fs.readFileSync(f, 'utf8'), /내가 덧붙인 메모/);
  assert.ok(fs.existsSync(path.join(pr.work, '.pilot/plan.md')));
});

test('멈추면 루프가 올라오지 않는다', () => {
  assert.equal(run('toggle', { pid, to: 'off' }).verdict.title, '루프를 멈췄어요');
  assert.equal(run('toggle', { pid, to: 'off' }).verdict.title, '이미 멈춰 있어요');
  assert.equal(run('loops-list', { now: '2026-11-09T09:00:00' }).items.length, 0);
  run('toggle', { pid, to: 'on' });
  assert.ok(run('loops-list', { now: '2026-11-09T09:00:00' }).items.length > 0);
});

test('그만둔 설계는 목록·카드를 붙잡지 않고, 운영 명령은 알기 쉽게 막는다', () => {
  const r = run('init', { card: 'tflag01' });
  assert.equal(run('cards-list').items.length, 1);   // 설계가 끝나기 전엔 카드가 그대로 보인다
  assert.equal(run('projects-list').items.some(i => i.id === r.pid), false);
  assert.match(run('loop-prep', { pid: r.pid, loop: 'review', period: 'now' }).error, /아직 설계가 끝나지 않은/);
});

test('#설계 카드 — 맡아 만들면 목록에서 빠지고, 카드 메모에 설계 노트 링크가 붙는다', () => {
  const r = run('init', { card: 'tflag01' });
  assert.match(r.goal, /스레드 키우기\n- 팔로워 1천 명/);
  run('review', { pid: r.pid, plan: { ...PLAN, name: '스레드 1천' } });
  run('build', { pid: r.pid });
  assert.equal(run('cards-list').items.length, 0);
  assert.match(db().tasks.find(t => t.id === 'tflag01').memo, /\[\[스레드 1천 설계\]\]/);
});

test('설계 고치기 — 점검에서 바꾼 루프를 지우지 않고, 이미 있는 카드는 두고 새 서브 프로젝트만 더한다', () => {
  const before = db().tasks.length;
  const r = run('revise', { pid, request: '제품 렌즈 더해 줘' });
  assert.equal(r.request, '제품 렌즈 더해 줘');
  assert.equal(r._plan.loops.find(l => l.key === 'scout').on, false);   // 점검에서 끈 루프가 설계에 담겨 간다
  const next = { ...r._plan, subprojects: [{ key: 'page', lens: '제품', title: '추천 모음 페이지', why: '', outcome: '', wave: 2, done: [], todos: [] }] };   // AI가 기존 서브 프로젝트를 빠뜨려도
  assert.equal(run('review', { pid, plan: next, confirm: 'yes' }).ask.free, false);
  const b = run('build', { pid, plan: next, why: '제품 렌즈' });
  assert.equal(b.outcome.title, '바꿨어요');
  assert.equal(db().tasks.length, before + 1);
  assert.ok(rec(pid).plan.subprojects.some(s => s.key === 'acquire'), '카드와 이어진 서브 프로젝트는 남는다');
  assert.equal(rec(pid).loops.find(l => l.key === 'scout').on, false);
});

test('숫자 읽기', async () => {
  const { parseAmount } = await import('../plugins/project-pilot/scripts/pilot.mjs');
  assert.deepEqual(parseAmount('12,000 정산'), { amt: 12000, memo: '정산' });
  assert.deepEqual(parseAmount('5천원 커피'), { amt: 5000, memo: '커피' });
  assert.equal(parseAmount('3만 2천원').amt, 32000);
  assert.equal(parseAmount('3.2만').amt, 32000);
  assert.equal(parseAmount('1억').amt, 100000000);
  assert.equal(parseAmount('모름'), null);
});

test('실행기 규격 — when으로 건너뛴 단계의 결과 자리는 빈 값, 설명 줄은 워크플로우 note', () => {
  const [w] = P.parseWorkflows('## 맡기기\n설명 한 줄\n- [검토] 확인 · script: scripts/a.mjs\n- [반영] 반영 · ai when {검토.request}: prompts/a.md');
  assert.equal(w.note, '설명 한 줄');
  assert.deepEqual(w.steps.map(s => [s.key, s.when]), [['검토', null], ['반영', '{검토.request}']]);
  const bad = P.validate([{ path: 'plugin.md', size: 1, text: '---\npkm_plugin: 1\nid: x-y\nname: x\nversion: 0.1.0\npermissions:\n  ai: [chat]\n---\n' }, { path: 'workflows/a.md', size: 1, text: '## a\n- [반영] 반영 · ai when {없음.x}: 해 줘' }]);
  assert.match(bad.errors.join('\n'), /when의 \{없음.x\}는 앞 단계 결과여야 해요/);
});

test('설계의 볼 파일(see) — 사람 몫 할 일에만 3개까지 남고, 설계 노트에 보인다', () => {
  const p = E.normalizePlan({ ...PLAN, subprojects: [{ ...PLAN.subprojects[0], todos: [{ text: '예시 문구를 보고 정한다', who: 'me', minutes: 1, see: ['./content/a.md', 'b.md', 'c.md', 'd.md'] }, { text: '예시 문구 쓰기', who: 'ai', see: ['content/a.md'] }, { text: '그냥 하기', who: 'me' }] }] });
  assert.deepEqual(p.subprojects[0].todos.map(t => t.see), [['content/a.md', 'b.md', 'c.md'], undefined, undefined]);
  assert.match(E.planMarkdown({ goal: 'g', plan: p }), /🙋 예시 문구를 보고 정한다 \(1분\) — 볼 파일: content\/a\.md, b\.md, c\.md/);
});
