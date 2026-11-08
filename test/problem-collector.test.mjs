// 문제 수집기 플러그인(plugins/problem-collector) — 임시 프로필에서 붙여 넣기 → 분석·묶기 → 해결 카드 → 검증 결과 → 건물 → 프로젝트 파일럿으로 넘기기.
// AI 단계(분석·해결)는 사람이 쓴 결과로 대신한다. 원문이 저장되지 않는지, 넘긴 카드를 앱과 파일럿이 그대로 읽는지도 본다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as plugins from '../server/plugins.js';
import * as E from '../plugins/problem-collector/scripts/engine.mjs';

const MD = createRequire(import.meta.url)('../web/js/pkm-md.js');
const PLUGIN = new URL('../plugins/problem-collector/', import.meta.url).pathname;
const PILOT = new URL('../plugins/project-pilot/', import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-collector-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const profile = path.join(tmp, '개인');
write(path.join(profile, '_설정.md'), '---\ntype: settings\nformat: 1\nfolders:\n  project: "03_행동/단기보드"\n---\n');
const run = (cmd, a = {}) => JSON.parse(execFileSync(process.execPath, [path.join(PLUGIN, 'scripts/collector.mjs'), cmd, `--profile=${profile}`, ...Object.entries(a).map(([k, v]) => `--${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)], { encoding: 'utf8' }));
const dbText = () => fs.readFileSync(path.join(profile, '_플러그인/.data/problem-collector/db.json'), 'utf8');

const RAW = 'https://kmong.com/request/123 쇼핑몰 주문 엑셀 정리해 주실 분 구해요. 매일 아침 2시간씩 스마트스토어 주문을 엑셀로 옮기고 있어요. 월 20만원까지 낼게요. 비밀문구-원문표시';
const P1 = { title: '주문 엑셀 정리', who: '1인 쇼핑몰 사장, 매일 아침', loss: '하루 2시간', workaround: '손으로 엑셀에 옮김', summary: '스마트스토어 주문을 매일 손으로 정리한다.', domain: '쇼핑몰', qualifies: true, reject_why: '',
  money: 5, money_why: '월 20만원 의뢰', pain: 5, auto: 5, build: 4, out_of_scope: false, scope_why: '', match: '' };

test('규격 검사를 통과하고, 워크플로우의 자리는 모두 앞 단계·항목·설정으로 채워진다', async () => {
  const r = await plugins.inspect({ local: PLUGIN });
  assert.equal(r.ok, true, (r.errors || []).join('\n'));
  assert.deepEqual(r.feeds.map(f => f.name), ['이번 주 검증', '해결 카드 자동 만들기', '문제 묶음', '자동 수집', '붙여 넣기', '내 건물', '보기']);
});

test('엔진 — 문제 기준(셋 다), 출처, 비중, 검증 결과로 돈 신호, 단계', () => {
  const a = E.normalizeAnalysis({ problems: [P1, { ...P1, workaround: '' }, { ...P1, money: 99, pain: -3 }] });
  assert.deepEqual(a.problems.map(p => p.qualifies), [true, false, true]);
  assert.equal(a.problems[2].money, 5); assert.equal(a.problems[2].pain, 0);
  assert.equal(E.sourceOf('https://soomgo.com/x'), '숨고'); assert.equal(E.sourceOf('https://www.clien.net/a'), '국내 커뮤니티'); assert.equal(E.sourceOf(''), '붙여 넣기');
  assert.deepEqual(E.weights('1,2,3'), E.WEIGHTS);
  const c = { money: 3, pain: 3, auto: 3, build: 3, posts: [{ source: '크몽' }], results: [], logs: [] };
  assert.equal(E.moneyLevel({ ...c, results: [{ kind: 'none' }] }), 3 * 0.7);
  assert.equal(E.moneyLevel({ ...c, results: [{ kind: 'ask' }] }), 4);
  assert.equal(E.stageOf({ ...c, solution: {} }), '검증');
  assert.equal(E.stageOf({ ...c, results: [{ kind: 'paid' }], logs: [{ profit: 60000, hours: 0.5 }] }), '건물');
  assert.equal(E.stageOf({ ...c, results: [{ kind: 'paid' }], logs: [{ profit: 60000, hours: 3 }] }), '공사');
  assert.ok(E.score({ ...c, out_of_scope: true }) < E.score(c), '범위 밖은 만들 수 있나 0점');
  assert.ok(E.score({ ...c, solution: { first_hours: 200 } }, E.WEIGHTS, { weekHours: 10 }) < E.score(c), '8주 넘으면 감점');
});

let cid;
test('붙여 넣기 → 분석 → 묶기. 원문은 남지 않고, 같은 글을 다시 넣어도 한 번만', () => {
  const prep = run('intake-prep', { text: RAW });
  assert.equal(prep.source, '크몽'); assert.equal(prep.url, 'https://kmong.com/request/123');
  assert.match(run('intake-prep', { text: '짧음' }).error, /너무 짧아요/);
  const analysis = { problems: [P1, { ...P1, title: '화풀이', qualifies: false, reject_why: '버티는 방법이 없음' }], note: '' };
  const r = run('intake-save', { url: prep.url, source: prep.source, analysis });
  assert.equal(r.verdict.title, '문제 1개를 넣었어요');
  assert.deepEqual(r.findings.map(f => f.tag), ['새 묶음', '걸러짐']);
  assert.match(run('intake-save', { url: prep.url, source: prep.source, analysis }).summary, /이미 넣은 글/);
  assert.doesNotMatch(dbText(), /비밀문구-원문표시/);
  const list = run('clusters-list', { filter: '전체' });
  assert.equal(list.items.length, 1);
  cid = list.items[0].vars.cid;
  assert.deepEqual(list.items[0].tags, ['🔍 후보', '쇼핑몰']);
  assert.equal(list.items[0].url, 'https://kmong.com/request/123');
  // 다른 출처의 같은 문제는 합쳐지고 반복 점수가 오른다
  const before = list.items[0].meta[0];
  run('intake-save', { url: 'https://www.clien.net/1', source: '국내 커뮤니티', analysis: { problems: [{ ...P1, match: cid }], note: '' } });
  const after = run('clusters-list', { filter: '전체' }).items[0];
  assert.equal(after.meta[1], '글 2개 · 크몽·국내 커뮤니티');
  assert.notEqual(after.meta[0], before);
  assert.equal(run('clusters-list', { filter: '출처:Reddit' }).items.length, 0);
  assert.equal(run('clusters-list', { filter: '분야:쇼핑몰' }).items.length, 1);
});

const SOL = { forms: [{ form: '대행', offer: '주문 정리 월 10만원', how: '스크립트로 처리', weeks: 1, automation: 'API 연동' }, { form: '제품', offer: '구독 웹앱', how: '', weeks: 6, automation: '' }],
  first_hours: 40, revenue: { payer: '쇼핑몰 사장', cost_now: '하루 2시간 × 2만원', price: '월 10만원', channel: '크몽 상품', first3: '원글 작성자에게 연락', monthly: '10만원 × 1명', running_cost: '확인 필요' },
  abroad: [{ name: 'OrderSync', how: '구독', url: 'javascript:alert(1)' }], step: '크몽에 상품 올리기', contact: '안녕하세요, 주문 정리 도와드릴 수 있어요.', goal: '주문 정리 자동화로 월 5만원', risks: [] };

test('해결 카드 → 상위 3에서 빠지고 검증으로. 결과를 적으면 단계가 오른다', () => {
  assert.equal(run('top-list').items.length, 1);
  assert.match(run('solve-prep', { cid })._ctx, /주문 엑셀 정리/);
  const s = run('solve-save', { cid, solution: SOL });
  assert.equal(s.findings[1].copy, SOL.contact);
  assert.match(s.findings[0].copy, /1\. 대행: 주문 정리 월 10만원/);
  assert.match(s.findings[0].copy, /2\. 도구: -/);
  assert.doesNotMatch(dbText(), /javascript:/);
  assert.equal(run('top-list').items.length, 0);
  assert.equal(run('verify-list').items[0].detail[0].text, '크몽에 상품 올리기');
  assert.equal(run('result', { cid }).ask.choices.length, 3);
  assert.equal(run('result', { cid, answer: 'paid' }).verdict.title, '🏗️ 공사 단계로 올라갔어요');
  assert.equal(run('verify-list').items.length, 0);
  assert.match(run('building-list').note, /건물 0채/);
  assert.match(run('log', { cid, value: '52,000 0.5' }).verdict.title, /건물이 됐어요/);
  assert.match(run('building-list').note, /건물 1채 · 월 합계 52,000원 · 내 손 0.5시간/);
  assert.match(run('log', { cid, value: '많이' }).error, /예처럼/);
});

test('피로 규칙 — 결과 없이 해결 카드 7개면 자동 해결을 쉬고, 결과를 적으면 다시', () => {
  const ids = [];
  for (let i = 0; i < 7; i++){
    run('intake-save', { url: `https://soomgo.com/r/${i}`, source: '숨고', analysis: { problems: [{ ...P1, title: `문제 ${i}`, match: '' }], note: '' } });
    ids.push(run('clusters-list', { filter: '전체' }).items.find(x => x.title === `문제 ${i}`).vars.cid);
  }
  for (const id of ids.slice(0, 7)) run('solve-save', { cid: id, solution: SOL });
  run('intake-save', { url: 'https://soomgo.com/r/x', source: '숨고', analysis: { problems: [{ ...P1, title: '새 문제', match: '' }], note: '' } });
  const t = run('top-list');
  assert.equal(t.items.length, 0); assert.match(t.note, /쉬어요/);
  run('result', { cid: ids[0], answer: 'none' });
  assert.equal(run('top-list').items.length, 1);
});

test('보기 바꾸기 — 있는 분야·출처만 고를 수 있고 설정을 고친다', () => {
  const ask = run('filter-pick').ask;
  assert.ok(ask.choices.some(c => c.value === '출처:숨고'));
  assert.ok(!ask.choices.some(c => c.value === '출처:Reddit'));
  assert.deepEqual(run('filter-pick', { answer: '단계:건물' }).settings_patch, { filter: '단계:건물' });
  assert.equal(run('filter-list', { filter: '단계:건물' }).items[0].title, '지금 보기: 단계 건물');
});

test('프로젝트 파일럿으로 넘기기 — 묻고, #설계 카드를 한 번만 만들고, 앱과 파일럿이 그대로 읽는다', () => {
  assert.equal(run('handoff', { cid }).ask.choices[0].value, 'yes');
  const r = run('handoff', { cid, answer: 'yes' });
  assert.equal(r.verdict.title, '프로젝트 파일럿으로 넘겼어요');
  assert.equal(run('handoff', { cid, answer: 'yes' }).verdict.title, '이미 넘긴 묶음이에요');
  const dir = path.join(profile, '03_행동/단기보드'), names = fs.readdirSync(dir);
  assert.deepEqual(names, ['주문 엑셀 정리 자동화.md']);
  const text = fs.readFileSync(path.join(dir, names[0]), 'utf8');
  const files = { '_설정.md': fs.readFileSync(path.join(profile, '_설정.md'), 'utf8'), [`03_행동/단기보드/${names[0]}`]: text };
  const parsed = MD.parse(files), card = parsed.db.tasks.find(t => t.title === '주문 엑셀 정리 자동화');
  assert.ok(card, '앱이 카드로 읽는다');
  assert.equal(MD.serialize(parsed)[`03_행동/단기보드/${names[0]}`], text, '앱이 다시 저장해도 그대로');
  const picked = JSON.parse(execFileSync(process.execPath, [path.join(PILOT, 'scripts/pilot.mjs'), 'cards-list', `--profile=${profile}`], { encoding: 'utf8' }));
  assert.equal(picked.items.length, 1);
  assert.equal(picked.items[0].title, '주문 엑셀 정리 자동화');
  assert.match(picked.items[0].meta[0], /주문 정리 자동화로 월 5만원/);
});
