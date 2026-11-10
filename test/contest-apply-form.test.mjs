// 공모전 신청 — 온라인 폼(구글 폼·네이버 폼) 흐름: 문항 글 → 답 계획 → 동의 문항 묻기 → 문항별 답 → [폼 제출하기]는 시험 뒤에만.
// 실제 폼에는 아무것도 보내지 않는다 — 폼 id를 없는 것으로 바꿔 두고, 제출(form) 답은 여기서 시험하지 않는다(제출 꼴은 contest-forms.test.mjs가 가짜 서버로 본다).
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

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-contest-form-')), HOME = path.join(T, 'home'), profile = path.join(T, '개인');
const SCRIPT = new URL('../plugins/contest-apply/scripts/contest.mjs', import.meta.url).pathname, FX = FX_DIR;
const DB = path.join(profile, '_플러그인/.data/contest-apply/db.json'), NOW = '2026-11-10T01:00:00.000Z';
fs.mkdirSync(path.dirname(DB), { recursive: true });
fs.writeFileSync(path.join(profile, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');
const ME = '이름\t김테스트\n연락처\t010-1234-5678\n이메일\tkim@example.com';
const run = (cmd, a = {}) => JSON.parse(execFileSync(process.execPath, [SCRIPT, cmd, `--profile=${profile}`, `--now=${NOW}`, ...Object.entries(a).map(([k, v]) => `--${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)],
  { encoding: 'utf8', env: { ...process.env, PKM_HOME: HOME, NAVER_ID: '', NAVER_APP_PASSWORD: '' } }));
const db = () => JSON.parse(fs.readFileSync(DB, 'utf8')), put = d => fs.writeFileSync(DB, JSON.stringify(d));
const res = (body, type) => new Response(body, { status: 200, headers: { 'content-type': type } });
// fixture로 읽은 폼의 id를 없는 것으로 바꾼다 — 스크립트가 실수로 보내도 실제 폼에 닿지 않게
const fake = (fm, id) => JSON.parse(JSON.stringify(fm).split(fm.id).join(id));
const naver = fake(await F.readForm('https://form.naver.com/response/9aiNWQM4Vo9', { fetch: async () => res(fs.readFileSync(path.join(FX, 'form-naver-kind.json')), 'application/json') }), 'TESTFORM0000');
const google = fake(await F.readForm('https://docs.google.com/forms/d/e/1FAIpQLScZUoDS5YWkPV3hsOJ-c0NlgvnnDSr9IHH4W2HxsCU3gNFk-w/viewform', { fetch: async () => res(fs.readFileSync(path.join(FX, 'form-google-kspo.html')), 'text/html') }), '1FAIpQLSc_TEST_FORM_DOES_NOT_EXIST_0000000000000000000000');
const fit = (method, to) => ({ i: 0, unreadable: false, target: true, target_why: '', kinds: ['슬로건'], prize: { text: '대상 100만원', total: 1000000, first: 1000000, goods: false, awards: [] }, deadline: '2026-11-20', announce: '2026-12-05', announce_text: '',
  submit: { what: '슬로건 + 의미', allow: 1, desc_limit: 0, note: '', fields: [], method, to, how: method === 'nform' ? '네이버 폼으로 온라인 접수' : '구글폼으로 온라인 접수', subject: '' }, eligibility: { text: '누구나', ok: 'yes', why: '' }, ai: { rule: 'none', text: '' } });
const draft = { items: [{ kind: '슬로건', text: '세계를 잇는 길', read: '', why: '해외 인프라로 세계를 잇는다는 뜻' }, { kind: '슬로건', text: '함께 짓는 내일', read: '', why: '함께 만든다는 뜻' }], note: '', at: NOW, made: 'm1' };
const seed = (key, method, fm) => ({ key, site: 'wevity', source: '위비티', title: `${key} 슬로건 공모전`, url: 'https://www.wevity.com/?c=find&ix=1', organizer: '주최', deadline: '2026-11-20', added: NOW, brief: '요강', fit: fit(method, fm.url), draft, form: { ...fm, src: fm.url, at: NOW, v: 2 } });
put({ contests: { 'wevity:1': seed('wevity:1', 'nform', naver), 'wevity:2': seed('wevity:2', 'form', google) } });
const text = (r, where) => r.findings.filter(f => f.where.startsWith(where));

test('네이버 폼 — 문항을 AI가 볼 글로 만들고, 계획이 오면 동의 문항부터 내가 정한다', () => {
  const p = run('papers', { cid: 'wevity:1' });
  assert.equal(p.need_fplan, true); assert.equal(p.need_plan, false);
  assert.match(p._form, /\[q1\] \(단답 · 필수 · .*이름 칸\) 공모전 참여자 성함/);
  assert.match(p._form, /\[q6\] \(하나 고르기 · 필수\)[\s\S]*보기: 예 \| 아니오/);
  const plan = { note: '', extras: [], answers: [
    { id: 'q1', text: '{{이름}}', consent: false, format: '' }, { id: 'q2', text: '{{연락처}}', consent: false, format: 'digits' }, { id: 'q3', text: '{{이메일}}', consent: false, format: '' },
    { id: 'q4', text: '{{작품}}', consent: false, format: '' }, { id: 'q5', text: '{{뜻풀이}}', consent: false, format: '' },
    { id: 'q6', text: '예', consent: true, format: '' }, { id: 'q7', text: '동의합니다.', consent: false, format: '' }, { id: 'q8', text: '동의합니다.', consent: false, format: '' },
    { id: 'q9', text: '동의', consent: false, format: '' }, { id: 'q10', text: '동의', consent: false, format: '' }, { id: 'q99', text: '없는 문항', consent: false, format: '' }] };
  const ask = run('info', { cid: 'wevity:1', fplan: { ...plan }, me: ME });
  assert.equal(ask.summary, '폼 동의 문항 묻기');
  assert.equal(text(ask, '동의 문항').length, 5, 'AI가 표시하지 않아도 서약·동의 문항은 내가 정한다');
  assert.equal(db().contests['wevity:1'].fplan.answers.length, 10, '폼에 없는 문항은 버린다');
  assert.deepEqual(ask.ask.choices.map(c => c.value), ['fconsent:yes', 'fconsent:no']);
  assert.equal(run('info', { cid: 'wevity:1', me: ME, answer: 'fconsent:yes' }).summary, '모자란 내용 없음');
});

test('네이버 폼 — 안을 고르면 문항별 답을 보이고, 시험하기 전에는 [폼 제출하기]를 두지 않는다', () => {
  assert.equal(run('submit', { cid: 'wevity:1', me: ME }).summary, '보낼 안 고르기');
  let r = run('submit', { cid: 'wevity:1', me: ME, answer: 'pick:1' });
  const rows = text(r, '폼 ');
  assert.equal(rows[0].copy, '김테스트'); assert.equal(rows[0].private, true);
  assert.equal(rows[1].copy, '01012345678', '숫자만');
  assert.equal(rows[3].copy, '함께 짓는 내일'); assert.equal(rows[4].copy, '함께 만든다는 뜻');
  assert.equal(rows[5].text, '→ 예'); assert.equal(rows[5].private, undefined);
  assert.match(text(r, '폼 제출')[0].text, /폼 제출 시험/);
  assert.equal(r.ask.choices.some(c => c.value === 'form'), false);
  assert.match(run('submit', { cid: 'wevity:1', me: ME, answer: 'form' }).error, /아직 네이버 폼 제출을 시험하지 않았어요/);

  const d = db(); d.form_test = { naver: { at: NOW, ok: true, sent: true } }; put(d);
  r = run('submit', { cid: 'wevity:1', me: ME });
  const b = r.ask.choices.find(c => c.value === 'form');
  assert.equal(b.label, '폼 제출하기'); assert.match(b.confirm, /낼 안: 함께 짓는 내일 · 문항 10개에 답해요\. 제출하면 되돌릴 수 없어요/);
  assert.equal(text(r, '폼 제출').length, 0);
  assert.equal(run('open-list').items.find(i => i.id === 'wevity:1').tags[1], '네이버 폼');
});

test('동의 문항에 답하지 않기로 하면 폼 답만 보이고 제출은 직접 한다', () => {
  const d = db(); d.contests['wevity:1'].fconsent = 'no'; put(d);
  const r = run('submit', { cid: 'wevity:1', me: ME });
  assert.equal(r.ask.choices.some(c => c.value === 'form'), false);
  assert.match(text(r, '폼 제출')[0].text, /동의 문항에 답하지 않기로/);
  assert.equal(text(r, '폼 6')[0].text, '답하지 않아요(동의 문항)');
});

test('구글 폼 — 글자 제한을 넘으면 막고, 작품 칸만 채운 주소를 준다(내 정보는 주소에 넣지 않는다)', () => {
  const qs = google.questions, plan = { note: '', extras: [{ cand: 0, values: [{ name: '기획의도', value: '가'.repeat(501) }] }, { cand: 1, values: [{ name: '기획의도', value: '짧은 기획의도' }] }],
    answers: qs.map(q => ({ id: q.id, format: /연락처/.test(q.title) && !/법정/.test(q.title) ? 'digits' : '', consent: q.type === 'multi',
      text: /법정대리인 (성함|연락처)/.test(q.title) ? '' : /성함/.test(q.title) ? '{{이름}}' : /연락처/.test(q.title) ? '{{연락처}}' : /이메일/.test(q.title) ? '{{이메일}}' : /기획의도/.test(q.title) ? '{{기획의도}}' : /공모 작품/.test(q.title) ? '{{작품}}' : q.options[0] })) };
  assert.equal(run('info', { cid: 'wevity:2', fplan: plan, me: ME }).summary, '폼 동의 문항 묻기');
  run('info', { cid: 'wevity:2', me: ME, answer: 'fconsent:yes' });
  const d = db(); d.form_test.google = { at: NOW, ok: true, sent: true }; put(d);
  let r = run('submit', { cid: 'wevity:2', me: ME, answer: 'pick:0' });
  assert.match(text(r, '폼 제출')[0].text, /글자 수 초과: 501자\(500자까지\)/);
  const pre = new URL(text(r, '작품 칸을 채워서 열기')[0].url);
  assert.equal(pre.searchParams.get('usp'), 'pp_url');
  assert.equal([...pre.searchParams.values()].includes('세계를 잇는 길'), true);
  assert.doesNotMatch(decodeURIComponent(pre.href), /김테스트|01012345678|kim@example\.com|동의/);
  r = run('submit', { cid: 'wevity:2', me: ME, answer: 'pick:1' });
  assert.equal(r.ask.choices.find(c => c.value === 'form').recommended, true);
});

test('완전 자동 — 동의 자동 답 설정이면 묻지 않고, 확인 없이 제출은 시험을 통과한 종류의 폼에만 한다', () => {
  const d = db(), c = d.contests['wevity:1']; delete c.fconsent; delete c.picks; delete d.form_test.naver; put(d);
  assert.equal(run('info', { cid: 'wevity:1', me: ME, consent_auto: 'true' }).summary, '모자란 내용 없음');
  assert.equal(db().contests['wevity:1'].fconsent, 'yes'); assert.ok(db().contests['wevity:1'].consent_auto);
  const r = run('submit', { cid: 'wevity:1', me: ME, fauto: 'true' });   // 네이버 폼은 아직 시험 전 — 보내지 않고 묻는다
  assert.equal(r.summary, '보낼 안 고르기');
  assert.equal(db().contests['wevity:1'].submitted, undefined);
});

test('완전 자동화 — 켜고 끄는 칸, 켜면 동의를 묻지 않는다. 폼 링크는 글·링크 어디에 있든 찾는다', async () => {
  const off = run('auto-list', { full: 'false' }).items[0];
  assert.equal(off.title, '완전 자동화 꺼짐');
  const ask = run('auto-toggle', { full: 'false' });
  assert.deepEqual(ask.ask.choices.map(c => [c.value, !!c.confirm]), [['on', true], ['keep', false]]);
  assert.deepEqual(run('auto-toggle', { full: 'false', answer: 'on' }).settings_patch, { full_auto: true });
  assert.deepEqual(run('auto-toggle', { full: 'true', answer: 'off' }).settings_patch, { full_auto: false });
  assert.equal(run('auto-toggle', { full: 'true', answer: 'keep' }).settings_patch, undefined);
  assert.equal(run('auto-list', { full: 'true' }).items[0].title, '완전 자동화 켜짐');
  const d = db(), c = d.contests['wevity:1']; delete c.fconsent; delete c.consent_auto; put(d);
  assert.equal(run('info', { cid: 'wevity:1', me: ME, full: 'true' }).summary, '모자란 내용 없음');
  assert.equal(db().contests['wevity:1'].fconsent, 'yes');
  const S = await import('../plugins/contest-apply/scripts/sources.mjs');
  assert.deepEqual(S.parseFormLinks('<a href="https://form.naver.com/response/6PuWi6hIrob">접수</a> https://forms.gle/abc123. "https:\\/\\/docs.google.com\\/forms\\/d\\/e\\/1FAIp_x\\/viewform" https://docs.google.com/document/d/x'),
    ['https://form.naver.com/response/6PuWi6hIrob', 'https://forms.gle/abc123', 'https://docs.google.com/forms/d/e/1FAIp_x/viewform']);
});

test('폼 제출 시험 — 종류마다 한 줄, 주소를 묻고 폼 주소가 아니면 보내지 않는다', () => {
  const l = run('form-test-list').items;
  assert.deepEqual(l.map(i => [i.title, i.vars.kind]), [['구글 폼 제출 시험', 'google'], ['네이버 폼 제출 시험', 'naver']]);
  assert.match(run('form-test', { kind: 'naver' }).ask.hint, /제목에 '시험'이나 '테스트'를 꼭/);
  assert.match(run('form-test', { kind: 'naver', answer: 'https://forms.gle/abc' }).error, /네이버 폼 주소가 아니에요/);
  assert.match(run('form-test', { kind: 'google', answer: 'https://example.com/x' }).error, /구글 폼 주소가 아니에요/);
});
}
