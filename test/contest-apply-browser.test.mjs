// 공모전 신청 — 브라우저로 내기: 홈페이지 접수와 로그인이 필요한 폼. 스크립트가 에이전트에게 줄 과제(_task)에는 내 정보 값이 없고(자리표시만),
// 값은 _browser.vars로만 넘긴다. 낸 것이 확실할 때만 '냈어요'로 적는다. 여기서는 브라우저를 띄우지 않는다(스크립트 단계만).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as F from '../plugins/contest-apply/scripts/forms.mjs';
import { FX_DIR, HAS_FX, NO_FX } from './contest-fixtures.mjs';

if (!HAS_FX) test(NO_FX, { skip: true }, () => {});
else {

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-contest-browser-')), HOME = path.join(T, 'home'), profile = path.join(T, '개인');
const SCRIPT = new URL('../plugins/contest-apply/scripts/contest.mjs', import.meta.url).pathname, FX = FX_DIR;
const DB = path.join(profile, '_플러그인/.data/contest-apply/db.json'), NOW = '2026-11-10T01:00:00.000Z';
fs.mkdirSync(path.dirname(DB), { recursive: true });
fs.writeFileSync(path.join(profile, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');
const ME = '이름\t김테스트\n연락처\t010-1234-5678\n이메일\tkim@example.com';
const run = (cmd, a = {}) => JSON.parse(execFileSync(process.execPath, [SCRIPT, cmd, `--profile=${profile}`, `--now=${NOW}`, ...Object.entries(a).map(([k, v]) => `--${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)],
  { encoding: 'utf8', env: { ...process.env, PKM_HOME: HOME, NAVER_ID: '', NAVER_APP_PASSWORD: '' } }));
const db = () => JSON.parse(fs.readFileSync(DB, 'utf8')), put = d => fs.writeFileSync(DB, JSON.stringify(d));
const fit = (method, to, more = {}) => ({ i: 0, unreadable: false, target: true, target_why: '', kinds: ['표어'], prize: { text: '대상 100만원', total: 1000000, first: 1000000, goods: false, awards: [] }, deadline: '2026-11-20', announce: '2026-12-05', announce_text: '',
  submit: { what: '표어 + 의미', allow: 1, desc_limit: 100, note: '', fields: [], method, to, how: '접수 페이지에서 온라인 작성 제출', subject: '' }, eligibility: { text: '누구나', ok: 'yes', why: '' }, ai: { rule: 'none', text: '' }, ...more });
const draft = { items: [{ kind: '표어', text: '안전은 설계부터', read: '', why: '설계 단계의 안전 관리를 뜻함' }, { kind: '표어', text: '현장을 잇는 CM', read: '', why: '현장을 잇는다는 뜻' }], note: '', at: NOW, made: 'm1' };
const lib = await F.readForm('https://docs.google.com/forms/d/e/1FAIpQLSdOnpobGnHIho1DXGBNbuvwNaqcLEJXCxKCOSNVYweK0iT4pA/viewform', { fetch: async () => new Response(fs.readFileSync(path.join(FX, 'form-google-lib.html')), { status: 200, headers: { 'content-type': 'text/html' } }) });
const base = (key, f) => ({ key, site: 'wevity', source: '위비티', title: `${key} 표어 공모전`, url: 'https://www.wevity.com/?c=find&ix=1', organizer: '한국CM협회', homepage: 'https://www.cmak.or.kr/board/1', deadline: '2026-11-20', added: NOW, brief: '요강 본문', fit: f, draft });
put({ contests: { 'wevity:1': base('wevity:1', fit('site', 'www.cmak.or.kr/reception/21-cm')),
  'wevity:2': { ...base('wevity:2', fit('form', lib.url)), form: { ...lib, src: lib.url, at: NOW, v: 2 },
    fplan: { made: 'm1', sig: lib.sig, note: '', extras: [], answers: lib.questions.map(q => ({ id: q.id, consent: false, text: /성명/.test(q.title) ? '{{이름}}' : /주제를 작성/.test(q.title) ? '{{작품}}' : /의미/.test(q.title) ? '{{뜻풀이}}' : '' })) } } } });
const where = (r, w) => r.findings.filter(f => f.where === w);

test('홈페이지 접수 — 안을 고르면 [AI가 브라우저로 내기]가 나오고, 과제에는 내 정보 값 없이 자리표시만 넘긴다', () => {
  assert.equal(run('submit', { cid: 'wevity:1', me: ME }).summary, '보낼 안 고르기');
  let r = run('submit', { cid: 'wevity:1', me: ME, answer: 'pick:0' });
  const b = r.ask.choices.find(c => c.value === 'browse');
  assert.equal(b.label, 'AI가 브라우저로 내기'); assert.match(b.confirm, /cmak\.or\.kr의 접수 화면을 열어 "안전은 설계부터"로 채우고 제출해요/);
  assert.match(where(r, '브라우저로 내기')[0].text, /내 정보는 AI에게 보이지 않고/);
  r = run('submit', { cid: 'wevity:1', me: ME, answer: 'browse' });
  assert.deepEqual([r.choice, r.browse, r.ask_names], ['browse', true, false]);
  assert.deepEqual(r._browser.vars, { 이름: '김테스트', 연락처: '010-1234-5678', '연락처 숫자만': '01012345678', '연락처 하이픈': '010-1234-5678', '연락처 앞': '010', '연락처 가운데': '1234', '연락처 끝': '5678', 이메일: 'kim@example.com', '이메일 아이디': 'kim', '이메일 도메인': 'example.com' });   // 칸의 꼴에 맞춰 쓸 자리표시
  assert.deepEqual(r._browser.allow, ['cmak.or.kr']);
  assert.match(r._task, /접수 주소: https:\/\/www\.cmak\.or\.kr\/reception\/21-cm/);
  assert.match(r._task, /응모작: 안전은 설계부터\n뜻풀이: 설계 단계의 안전 관리를 뜻함/);
  assert.match(r._task, /쓸 수 있는 자리표시: \{\{이름\}\} \{\{연락처\}\} \{\{이메일\}\} \{\{연락처 숫자만\}\}.*\{\{이메일 도메인\}\}/);
  assert.doesNotMatch(JSON.stringify({ ...r, _browser: null }), /김테스트|010-1234-5678|01012345678|kim@example\.com/, '내 정보 값은 _browser.vars에만 있다');
  assert.equal(db().contests['wevity:1'].submitted, undefined, '아직 낸 것이 아니다');
});

test('결과 적기 — 완료를 봤을 때만 냈어요. 확인 못 했으면 묻고, 완전 자동화도 다시 보내지 않는다', () => {
  let r = run('browsed', { cid: 'wevity:1', result: { sent: 'unknown', reason: '제출을 눌렀지만 완료 화면이 뜨지 않았어요', proof: '잠시 후 다시 시도', did: ['이름 칸에 {{이름}}', '제출 누름'] } });
  assert.equal(r.verdict.title, '제출됐는지 확인하지 못했어요');
  assert.deepEqual(r.ask.choices.map(c => c.value), ['yes', 'later']);
  assert.equal(db().contests['wevity:1'].submitted, undefined);
  assert.equal(run('browsed', { cid: 'wevity:1', answer: 'later' }).sent, false);
  r = run('submit', { cid: 'wevity:1', me: ME, full: 'true' });
  assert.equal(r.summary, '냈는지 묻기', '지난 시도가 불확실하면 묻는다');
  assert.equal(where(r, '지난 시도')[0].title, '제출됐는지 확인하지 못했어요');
  assert.match(r.ask.choices.find(c => c.value === 'browse').confirm, /두 번 내게 돼요/);

  r = run('browsed', { cid: 'wevity:1', result: { _result: { sent: 'yes', reason: '', proof: '접수가 완료되었습니다. 접수번호 2026-0412', did: ['제출 누름'] } } });
  assert.deepEqual([r.summary, r.sent], ['홈페이지에 냈어요', true]);
  assert.deepEqual(db().contests['wevity:1'].sent_names, ['안전은 설계부터']);
  assert.match(run('finish', { cid: 'wevity:1', choice: 'browse' }).verdict.text, /브라우저로 접수 화면에 냈어요/);
  assert.deepEqual(run('sent-list').items.map(i => i.id), ['wevity:1']);
});

test('로그인이 필요한 폼 — 브라우저로 내고, 미리 세운 문항별 답 계획을 자리표시째로 넘긴다. 완전 자동화면 묻지 않고 넘긴다', () => {
  const r = run('submit', { cid: 'wevity:2', me: ME, full: 'true' });
  assert.deepEqual([r.choice, r.auto], ['browse', true]);
  assert.deepEqual(r._browser.allow, ['docs.google.com', 'cmak.or.kr', 'form.naver.com']);
  assert.match(r._task, /문항별 답 계획/);
  assert.match(r._task, /응모자 성명을 입력해 주시기 바랍니다\. → \{\{이름\}\}/);
  assert.match(r._task, /주제를 작성해주십시오\. → 안전은 설계부터/);
  assert.doesNotMatch(r._task, /김테스트/);
});
}
