// 공모전 신청 — 기억 범위와 보내는 시각: 계좌는 이 공모전의 답으로만, 받은 값은 내 정보/이 공모전 답으로 나누고 받은 날을 남긴다.
// 메일에는 요강이 요구할 때만 계좌를 넣고, 자동 메일은 한국 시각 08~21시에만. 브라우저 결과는 러너가 넘긴 화면 원문(_screen)으로 판정한다.
// 메일 서버에는 닿지 않는다 — 자동 메일은 밤 시각으로만 돌리고, 계정은 가짜다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-contest-memory-')), HOME = path.join(T, 'home'), profile = path.join(T, '개인');
const SCRIPT = new URL('../plugins/contest-apply/scripts/contest.mjs', import.meta.url).pathname;
const STORE = path.join(profile, '_플러그인/.data/contest-apply'), DB = path.join(STORE, 'db.json'), NOW = '2026-11-10T01:00:00.000Z';
fs.mkdirSync(STORE, { recursive: true });
fs.writeFileSync(path.join(profile, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');
const run = (cmd, a = {}, { now = NOW, env = {} } = {}) => JSON.parse(execFileSync(process.execPath, [SCRIPT, cmd, `--profile=${profile}`, `--now=${now}`, ...Object.entries(a).map(([k, v]) => `--${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)],
  { encoding: 'utf8', env: { ...process.env, PKM_HOME: HOME, NAVER_ID: '', NAVER_APP_PASSWORD: '', ...env } }));
const db = () => JSON.parse(fs.readFileSync(DB, 'utf8')), put = d => fs.writeFileSync(DB, JSON.stringify(d));
const read = f => JSON.parse(fs.readFileSync(path.join(STORE, f), 'utf8'));
const fit = (method, to, more = {}) => ({ i: 0, unreadable: false, target: true, target_why: '', kinds: ['표어'], prize: { text: '대상 100만원', total: 1000000, first: 1000000, goods: false, awards: [] }, deadline: '2026-11-20', announce: '2026-12-05', announce_text: '',
  submit: { what: '표어 + 의미', allow: 1, desc_limit: 100, note: '', fields: [], method, to, how: '이메일로 제출', subject: '' }, eligibility: { text: '누구나', ok: 'yes', why: '' }, ai: { rule: 'none', text: '' }, ...more });
const draft = { items: [{ kind: '표어', text: '안전은 설계부터', read: '', why: '설계 단계의 안전 관리를 뜻함' }], note: '', at: NOW, made: 'm1' };
const base = (key, f) => ({ key, site: 'wevity', source: '위비티', title: `${key} 표어 공모전`, url: 'https://www.wevity.com/?c=find&ix=1', organizer: '주최', homepage: '', deadline: '2026-11-20', added: NOW, brief: '요강 본문', fit: f, draft });
put({ contests: { 'wevity:1': base('wevity:1', fit('site', 'www.example.org/apply')), 'wevity:2': base('wevity:2', fit('email', 'contest@example.com')) } });
const where = (r, w) => r.findings.filter(f => f.where === w);

test('브라우저에서 적은 값 — 계좌·은행은 내 정보가 아니라 이 공모전의 답으로, 받은 날을 남긴다', () => {
  const r = run('browsed', { cid: 'wevity:1', answer: '이름: 김테스트\n상금 계좌: 국민 123-45\n조합원 여부: 비조합원' });
  assert.equal(r.sent, false);
  assert.deepEqual(read('내정보.json').제출용, { 이름: '김테스트' });
  assert.deepEqual(read('답/wevity-1.json'), { '상금 계좌': '국민 123-45', '조합원 여부': '비조합원' });
  const g = read('받은날.json');
  assert.deepEqual([g.제출용.이름, g.답['wevity-1']['상금 계좌'], g.답['wevity-1']['조합원 여부']], ['2026-11-10', '2026-11-10', '2026-11-10']);
});

test('브라우저가 물어서 받은 값(given)도 내 정보와 이 공모전의 답으로 나눈다', () => {
  run('browsed', { cid: 'wevity:1', given: { 주소: '서울특별시 중구', '거래 은행': '국민', '단체 회원 여부': '아니오' }, result: { sent: 'unknown', reason: '확인 못 함', proof: '', did: [] } });
  const k = read('내정보.json').제출용, a = read('답/wevity-1.json');
  assert.equal(k.주소, '서울특별시 중구');
  assert.equal(k['거래 은행'], undefined, '은행은 다른 공모전에 번지지 않는다');
  assert.equal(k['단체 회원 여부'], undefined);
  assert.deepEqual([a['거래 은행'], a['단체 회원 여부']], ['국민', '아니오']);
  assert.equal(read('받은날.json').제출용.주소, '2026-11-10');
});

test('메일 본문 — 계좌는 요강이 요구할 때만 넣고, 이름·연락처는 그대로. 기억한 값은 받은 날과 함께 보인다', () => {
  const ME = '이름\t김테스트\n연락처\t010-1234-5678\n계좌\t국민 123-45';
  let r = run('submit', { cid: 'wevity:2', me: ME });
  let body = where(r, '메일 본문')[0].copy;
  assert.match(body, /이름: 김테스트/); assert.match(body, /연락처: 010-1234-5678/);
  assert.doesNotMatch(body, /계좌|123-45/);
  assert.match(where(r, '기억한 값')[0].text, /^기억한 값으로 채움: 주소\(11\/10\)/);
  const d = db(); d.contests['wevity:2'].fit.submit.note = '수상자는 상금 받을 계좌 사본을 함께 보내요'; put(d);
  body = where(run('submit', { cid: 'wevity:2', me: ME }), '메일 본문')[0].copy;
  assert.match(body, /계좌: 국민 123-45/);
});

test('자동 메일 — 한국 시각 밤에는 보내지 않고 아침 8시 이후로 미룬다', () => {
  const d = db(); d.contests['wevity:2'].fit.submit.note = ''; d.contests['wevity:9'] = { ...base('wevity:9', fit('email', 'old@example.com')), mailed: { at: NOW, to: 'old@example.com' }, submitted: NOW }; put(d);
  const env = { NAVER_ID: 'tester', NAVER_APP_PASSWORD: 'fake-not-real' }, night = '2026-11-10T13:30:00.000Z';   // 22:30 KST
  const r = run('submit', { cid: 'wevity:2', me: '이름\t김테스트', auto: 'true', full: 'true' }, { now: night, env });
  assert.deepEqual([r.summary, r.choice, r.auto], ['아침 8시 이후에 보내요', 'later', true]);
  const c = db().contests['wevity:2'];
  assert.deepEqual([c.mailed, c.mail_sending, c.submitted], [undefined, undefined, undefined]);
  const fin = run('finish', { cid: 'wevity:2', choice: 'later' }, { now: night });
  assert.equal(fin.verdict.title, '아침 8시 이후에 보내요');
  assert.equal(db().contests['wevity:2'].mail_wait, undefined);
});

test('브라우저 결과 — 러너가 넘긴 화면 원문(_screen)이 있으면 그것으로 판정하고 완료 줄을 증거로 쓴다', () => {
  let r = run('browsed', { cid: 'wevity:1', result: { sent: 'yes', proof: '제출 누름', did: [], _screen: '메뉴 홈 공지\n접수가 완료되었습니다. 접수번호 A-17\n고객센터 1588' } });
  assert.deepEqual([r.summary, r.sent], ['홈페이지에 냈어요', true]);
  assert.equal(where(r, '완료 화면')[0].text, '접수가 완료되었습니다. 접수번호 A-17');
  const d = db(); delete d.contests['wevity:1'].submitted; put(d);
  r = run('browsed', { cid: 'wevity:1', result: { _result: { sent: 'yes', proof: '접수가 완료되었습니다', did: [] }, _screen: '필수 항목을 입력해 주세요\n이름' } });
  assert.deepEqual([r.summary, r.sent], ['제출 확인 못 함', false], 'AI가 고른 글이 완료여도 화면 원문이 아니면 냈어요로 적지 않는다');
  assert.equal(db().contests['wevity:1'].submitted, undefined);
});
