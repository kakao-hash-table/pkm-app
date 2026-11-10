// 공모전 신청 플러그인의 폼 모듈(plugins/contest-apply/scripts/forms.mjs) — 저장해 둔 실제 문항(구글 viewform HTML·네이버 access JSON)으로 읽기를 보고,
// 제출은 같은 프로세스의 가짜 서버(node:http)로만 본다. 주입한 fetch가 구글·네이버 주소를 모두 가짜 서버로 돌리므로 실제 폼에는 아무것도 가지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { kindOf, readForm, checkAnswers, submitForm, prefillUrl, visible, pace } from '../plugins/contest-apply/scripts/forms.mjs';
import { FX_DIR, HAS_FX, NO_FX } from './contest-fixtures.mjs';

if (!HAS_FX) test(NO_FX, { skip: true }, () => {});
else {
pace.naver = 0;   // 실제로는 읽고 잠깐 뒤에 보낸다 — 테스트에서는 기다리지 않는다

const FIX = FX_DIR;
const read = f => fs.readFileSync(FIX + f, 'utf8');
const KSPO_ID = '1FAIpQLScZUoDS5YWkPV3hsOJ-c0NlgvnnDSr9IHH4W2HxsCU3gNFk-w', LIB_ID = '1FAIpQLSdOnpobGnHIho1DXGBNbuvwNaqcLEJXCxKCOSNVYweK0iT4pA';
const KSPO = `https://docs.google.com/forms/d/e/${KSPO_ID}/viewform`, LIB = `https://docs.google.com/forms/d/e/${LIB_ID}/viewform`;
const KIND = 'https://form.naver.com/response/9aiNWQM4Vo9', SEA = 'https://form.naver.com/response/HMiwZuQIUqV', GRID = 'https://form.naver.com/response/TESTGRID0000';

/* ---------- 가짜 fetch·가짜 서버 ---------- */
// 네트워크 없이: 주소마다 Response를 돌려주고, 부른 것을 적어 둔다
function stub(route){
  const calls = [];
  const f = async (url, opt = {}) => { calls.push({ url: String(url), method: opt.method || 'GET', opt }); const r = route(String(url), opt); if (!r) throw new Error(`예상 못 한 요청: ${url}`); return r; };
  return Object.assign(f, { calls });
}
const html = (body, headers = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const to = location => new Response(null, { status: 302, headers: { location } });
const pages = { [KSPO]: 'form-google-kspo.html', [LIB]: 'form-google-lib.html' }, surveys = { '9aiNWQM4Vo9': 'form-naver-kind.json', HMiwZuQIUqV: 'form-naver-cheongju.json', 'TESTGRID0000': 'form-naver-grid.json' };
const fixtures = stub(url => {
  if (pages[url]) return html(read(pages[url]));
  const id = /\/surveys\/([\w-]+)\/access\?ignoreCount=true$/.exec(url)?.[1];
  return surveys[id] && new Response(read(surveys[id]), { status: 200, headers: { 'content-type': 'application/json' } });
});
const load = url => readForm(url, { fetch: fixtures });

// 가짜 폼 서버 — handler(hit, res, req). fetch는 어느 호스트로 가든 이 서버로 돌리고 원래 호스트를 x-real-host로 넘긴다
async function fake(handler){
  const log = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => { const hit = { method: req.method, host: req.headers['x-real-host'], path: req.url, headers: req.headers, body }; log.push(hit); handler(hit, res, req); });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const via = (url, opt = {}) => { const u = new URL(url); return fetch(base + u.pathname + u.search, { ...opt, headers: { ...opt.headers, 'x-real-host': u.host } }); };
  return { log, fetch: via, posts: () => log.filter(h => h.method === 'POST'), close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}
const send = (res, status, body = '', headers = {}) => { res.writeHead(status, headers); res.end(body); };
const sendJson = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json;charset=UTF-8', ...headers });
const googleServer = (page, post) => fake((hit, res, req) => {
  if (hit.method === 'GET' && hit.path.endsWith('/viewform')) return send(res, 200, page, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': ['S=spreadsheet_forms=abc; Path=/forms; HttpOnly', 'NID=xyz; Domain=.google.com'] });
  if (hit.method === 'POST' && hit.path.endsWith('/formResponse')) return post(res, req);
  send(res, 404);
});
const naverServer = (survey, post, { access, address = { meta: { totalCount: 0 }, results: [] }, status = { available: true, answered: false, error: null } } = {}) => fake((hit, res, req) => {
  if (hit.method === 'GET' && hit.path.startsWith('/api/form/address?')) return sendJson(res, 200, address);
  if (hit.method === 'GET' && hit.path.includes('/access')) return access ? access(res) : sendJson(res, 200, survey, { 'set-cookie': 'anonymous=JWT.TEST; Max-Age=172800; Path=/; HttpOnly' });
  if (hit.method === 'GET' && hit.path.endsWith('/answers/status')) return sendJson(res, 200, status);
  if (hit.method === 'POST' && hit.path.endsWith('/answers')) return post(res, req);
  send(res, 404);
});
const CONFIRM = '<html><body><div class="vHW8K">2027 KSPO 스포츠가치센터 슬로건 공모전에 참여해 주셔서 감사합니다!</div></body></html>';
const drop = (res, req) => req.socket.destroy();   // 보내는 중에 끊긴 연결

const KSPO_ANSWERS = { q1: '홍길동', q2: '01012345678', q3: 'me@example.com', q4: '함께 뛰는 가치', q5: '첫 줄\n둘째 줄', q6: '만 14세 이상입니다.',
  q9: '유의사항을 모두 확인하였으며 동의합니다.', q10: ['내용을 확인하였으며 동의합니다.'], q11: '내용을 확인하였으며 동의합니다.', q12: '개인정보 수집 및 이용에 동의합니다.', q13: '개인정보 처리 위탁 안내를 확인하였습니다.' };
const KIND_ANSWERS = { q1: '홍길동', q2: '010-1234-5678', q3: ' me@example.com ', q4: '세계로  잇는\n내일', q5: '첫 문단\n\n\n\n둘째 문단', q6: '예', q7: '동의합니다.', q8: '동의합니다.', q9: '동의', q10: '동의' };

// 문항 몇 개짜리 구글 폼 화면을 만든다(기타 보기·날짜·파일처럼 fixture에 없는 유형용)
const MINI_ID = '1FAIpQLSmini_form-000';
const mini = (items, { set = [null, null, null, 2, null, null, 1], attrs = '' } = {}) =>
  `<html><script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, ['설명', items, ['응답이 기록되었습니다.', 0, 0, 0, 0], null, null, null, null, null, '작은 폼', 76, set], '/forms', '작은 폼', null, null, null, '', null, 0, 0, null, '', 0, `e/${MINI_ID}`, 0, '[]', 0, 0, 1])};</script>
  <body><form action="x" ${attrs}><input type="hidden" name="fbzx" value="-123456789"></form></body></html>`;
const opt = (label, other = 0, go = null) => [label, null, go, null, other];
const MINI_ITEMS = [
  [1, '분야', null, 2, [[111, [opt('슬로건'), opt('네이밍'), opt('', 1)], 1]]],
  [2, '작성일', null, 9, [[112, null, 1, null, null, null, null, [0, 1]]]],
  [3, '관심 주제', null, 4, [[113, [opt('바다'), opt('과학'), opt('', 1)], 0]]],
  [4, '연락 가능한 시간', null, 10, [[114, null, 0, null, null, null, [0]]]],
  [5, '만족도', null, 5, [[115, [['1'], ['2'], ['3']], 0, ['낮음', '높음']]]],
];
const miniForm = (items, o) => readForm(`https://docs.google.com/forms/d/e/${MINI_ID}/viewform`, { fetch: stub(() => html(mini(items, o))) });

/* ---------- 주소 ---------- */
test('kindOf: 구글·네이버 폼 주소만 가린다', () => {
  for (const u of ['https://forms.gle/kZd1UsysL9jrrsbG7', KSPO, `${KSPO}?usp=send_form`, 'https://docs.google.com/forms/d/abc/edit']) assert.equal(kindOf(u), 'google', u);
  for (const u of [KIND, 'https://naver.me/FWTtLoq0']) assert.equal(kindOf(u), 'naver', u);
  for (const u of ['', 'forms.gle/x', 'https://docs.google.com/document/d/abc', 'https://example.com/forms.gle', 'https://form.naver.com.evil.test/response/x', 'javascript:alert(1)', null]) assert.equal(kindOf(u), '', String(u));
});

test('짧은 주소는 Location만 읽어 폼 주소를 얻고, 폼이 아닌 곳으로는 가지 않는다', async () => {
  const g = stub(url => url === 'https://forms.gle/kZd1UsysL9jrrsbG7' ? to(`${KSPO}?usp=send_form`) : url === KSPO ? html(read('form-google-kspo.html')) : null);
  assert.equal((await readForm('https://forms.gle/kZd1UsysL9jrrsbG7', { fetch: g })).id, KSPO_ID);
  assert.deepEqual(g.calls.map(c => [c.method, c.url, c.opt.redirect]), [['GET', 'https://forms.gle/kZd1UsysL9jrrsbG7', 'manual'], ['GET', KSPO, 'manual']]);

  const n = stub(url => url === 'https://naver.me/FWTtLoq0' ? new Response(null, { status: 307, headers: { location: KIND } }) : /9aiNWQM4Vo9\/access/.test(url) ? new Response(read('form-naver-kind.json')) : null);
  const f = await readForm('https://naver.me/FWTtLoq0', { fetch: n });
  assert.equal(f.url, KIND);
  assert.equal(n.calls.length, 2);   // 폼 화면(HTML)은 받지 않는다

  const away = stub(url => url === 'https://naver.me/zzz' ? to('https://example.com/landing') : null);
  assert.match((await readForm('https://naver.me/zzz', { fetch: away })).error, /네이버 폼/);
  assert.equal(away.calls.length, 1);
});

/* ---------- 읽기 ---------- */
test('구글 폼(KSPO): 문항·유형·필수·보기·글자 제한·페이지를 읽는다', async () => {
  const f = await load(KSPO);
  assert.equal(f.kind, 'google');
  assert.equal(f.id, KSPO_ID);
  assert.equal(f.url, KSPO);
  assert.match(f.title, /KSPO 스포츠가치센터 슬로건 공모전/);
  assert.match(f.description, /접수기간: 2026\.10\.26/);
  assert.ok(f.description.length <= 3000);
  assert.deepEqual([f.open, f.closed, f.login, f.blockers, f.pages], [true, '', false, [], 3]);
  assert.deepEqual(f.questions.map(q => q.id), Array.from({ length: 13 }, (_, i) => `q${i + 1}`));
  assert.deepEqual(f.questions.map(q => q.type), ['short', 'short', 'short', 'short', 'long', 'choice', 'short', 'short', 'multi', 'multi', 'multi', 'multi', 'multi']);
  assert.deepEqual(f.questions.filter(q => !q.required).map(q => q.id), ['q7', 'q8']);   // 법정대리인 칸만 선택
  assert.deepEqual(f.questions.map(q => q.page), [2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
  const q5 = f.questions[4], q6 = f.questions[5], q9 = f.questions[8];
  assert.equal(q5.title, '공모 작품: 슬로건 의미 및 기획의도 (500자 이내)');
  assert.equal(q5.limit, 500);   // 폼에 걸린 길이 검증
  assert.deepEqual(q6.options, ['만 14세 이상입니다.', '만 14세 미만이며, 법정대리인이 개인정보 수집 및 이용 내용을 확인하고 동의합니다.']);
  assert.equal(q6.other, false);
  assert.deepEqual(q9.options, ['유의사항을 모두 확인하였으며 동의합니다.']);
  assert.match(q9.desc, /^\[출품 및 응모 관련\]/);
  assert.ok(f.questions.every(q => q.desc.length <= 600 && q.field === '' && Array.isArray(q.options)));
  assert.match(f.sig, /^[0-9a-f]{12}$/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.raw)), f.raw);   // 평범한 객체
  assert.doesNotMatch(JSON.stringify(f), /-6709450495756119812|spreadsheet_forms/);   // 화면 토큰·쿠키는 form에 남기지 않는다
});

test('구글 폼(도서관): 로그인이 필요하고, 답에 따라 거치는 문항이 달라진다', async () => {
  const f = await load(LIB);
  assert.equal(f.login, true);
  assert.equal(f.open, true);
  assert.deepEqual(f.blockers, ['구글 로그인이 필요한 폼이에요']);
  assert.equal(visible(f, { q1: '예' }).length, 9);
  assert.deepEqual(visible(f, { q1: '아니오(신청이 불가합니다.)' }), ['q1']);   // '아니오'는 바로 제출로 간다
  assert.deepEqual(checkAnswers(f, { q1: '아니오(신청이 불가합니다.)' }), []);   // 거치지 않는 문항은 필수로 보지 않는다
  assert.equal(f.pages, 6);
  assert.deepEqual(f.questions.map(q => q.type), ['choice', 'short', 'short', 'short', 'short', 'date', 'short', 'short', 'long']);
  assert.deepEqual(f.questions[0].options, ['예', '아니오(신청이 불가합니다.)']);
  assert.equal(f.questions[4].required, false);
  assert.equal(f.questions[7].limit, 20);   // 설명의 '20자 이내'
});

test('구글 폼: 기타 보기·날짜·시간·척도를 읽고, 못 다루는 것은 blockers에 넣는다', async () => {
  const f = await miniForm(MINI_ITEMS);
  assert.deepEqual(f.blockers, []);
  assert.deepEqual(f.questions.map(q => [q.type, q.options, q.other]), [['choice', ['슬로건', '네이밍'], true], ['date', [], false], ['multi', ['바다', '과학'], true], ['time', [], false], ['scale', ['1', '2', '3'], false]]);

  const hard = await miniForm([...MINI_ITEMS, [6, '신청서 파일', null, 13, [[116, null, 0]]], [8, '새 유형', null, 99, [[119, null, 0]]]]);
  assert.deepEqual(hard.blockers, ['파일 올리기 문항이 있어요', '자동으로 못 채우는 문항 유형이 있어요']);
  assert.deepEqual(hard.questions.slice(5).map(q => [q.type, q.rule]), [['file', '파일은 폼에서 직접 올려야 해요'], ['other', '']]);   // 못 내는 문항도 목록에는 넣는다

  // 설정을 읽지 못하면 로그인 필요 쪽으로, 화면이 로그인·캡차를 알리면 그대로
  assert.equal((await miniForm(MINI_ITEMS, { set: null })).login, true);
  assert.equal((await miniForm(MINI_ITEMS, { set: [null, 1, null, 2, null, null, 1] })).login, true);
  assert.equal((await miniForm(MINI_ITEMS, { attrs: 'data-sign-in-to-continue="true"' })).login, true);
  assert.deepEqual((await miniForm(MINI_ITEMS, { attrs: 'data-should-execute-invisible-captcha-on-form-submit="true"' })).blockers, ['사람인지 확인(캡차)을 거치는 폼이에요']);
});

test('네이버 폼(KIND): 유형이 정한 칸(field)과 동의 문항을 읽는다', async () => {
  const f = await load(KIND);
  assert.deepEqual([f.kind, f.id, f.url, f.open, f.closed, f.login, f.blockers, f.pages], ['naver', '9aiNWQM4Vo9', KIND, true, '', false, [], 3]);
  assert.match(f.title, /KIND\) 뉴 슬로건 공모전/);
  assert.match(f.description, /공모접수 : 2026\. 10\. 28/);
  assert.deepEqual(f.questions.map(q => [q.id, q.type, q.field]), [['q1', 'short', 'name'], ['q2', 'short', 'phone'], ['q3', 'short', 'email'], ['q4', 'short', ''], ['q5', 'long', ''],
    ['q6', 'choice', ''], ['q7', 'choice', ''], ['q8', 'choice', ''], ['q9', 'agree', ''], ['q10', 'agree', '']]);
  assert.ok(f.questions.every(q => q.required));
  assert.deepEqual(f.questions.map(q => q.page), [2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
  assert.deepEqual(f.questions[5].options, ['예', '아니오']);
  assert.deepEqual(f.questions[8].options, ['동의', '동의하지 않음']);   // 체크 하나뿐인 동의
  assert.match(f.questions[8].desc, /수집 항목: 성명\(국문\), 전화번호, 이메일/);
  assert.equal(f.questions[4].limit, 500);   // 설명의 '500자 이내'
  assert.equal(f.questions[3].limit, 100);   // 화면이 단답에 거는 제한
  assert.doesNotMatch(JSON.stringify(f), /mIZhyHqBv6ULpLwwXeUSBQ/);   // taToken은 form에 남기지 않는다
});

test('네이버 폼(청주): 제목의 글자 제한과 AGREE_V2 보기를 읽는다', async () => {
  const f = await load(SEA);
  assert.equal(f.pages, 4);
  assert.deepEqual(f.questions.map(q => q.type), ['choice', 'agree', 'choice', 'short', 'short', 'short', 'short', 'long']);
  assert.deepEqual(f.questions[1].options, ['동의합니다', '동의하지 않습니다']);
  assert.deepEqual(f.raw.q.q2, { qid: 10, type: 'AGREE_V2', items: [{ id: 7, value: 'Y' }, { id: 8, value: 'N' }] });
  assert.equal(f.questions[6].title, '슬로건 (20자 이내)');
  assert.equal(f.questions[6].limit, 20);
  assert.equal(f.questions[7].limit, 149);   // '150자 미만'
});

test('네이버 폼: 끝난 설문·로그인 전용·확인 못 한 유형은 자동 제출 대상에서 뺀다', async () => {
  const base = JSON.parse(read('form-naver-kind.json'));
  const as = change => readForm(KIND, { fetch: stub(() => new Response(JSON.stringify(change(structuredClone(base))))) });
  const done = await as(j => ({ ...j, status: 'FINISHED' }));
  assert.deepEqual([done.open, done.closed, done.blockers], [false, '끝난 설문이에요', ['끝난 설문이에요']]);
  const member = await as(j => { j.options.allowAnonymous = false; return j; });
  assert.deepEqual([member.login, member.blockers], [true, ['네이버 로그인이 필요한 폼이에요']]);
  const odd = await as(j => { j.pages[1].questions.push({ id: 31, title: '증빙', type: 'UPLOAD_FILE', options: {}, props: {}, items: [] }, { id: 32, title: '사진', type: 'UPLOAD_IMAGE', options: {}, props: { max: 1 }, items: [] },
    { id: 33, title: '참여자 정보', type: 'AGREE_NVUSER', options: { required: true }, props: {}, items: [] }, { id: 34, title: '새 유형', type: 'BRAND_NEW', options: {}, props: {}, items: [] }); return j; });
  assert.deepEqual(odd.blockers, ['파일 올리기 문항이 있어요', '사진 올리기 문항이 있어요', '네이버 회원 정보를 불러와 동의하는 문항이 있어요(로그인 필요)', '자동으로 못 채우는 문항이 있어요: BRAND_NEW']);
  assert.deepEqual(odd.questions.slice(5, 9).map(q => q.type), ['file', 'file', 'other', 'other']);
  const back = await as(j => { j.pages[2].questions[0].items[1].skipOffset = -1; return j; });
  assert.deepEqual(back.blockers, ['이동 규칙을 확신하지 못하는 폼이에요(뒤로 돌아가거나 모르는 곳으로 가는 이동)']);
  assert.notEqual(odd.sig, (await as(j => j)).sig);   // 문항이 늘면 sig가 달라진다
  assert.equal(done.sig, (await as(j => j)).sig);   // 상태만 바뀌면 그대로
});

test('읽지 못하면 던지지 않고 { error }를 돌려준다', async () => {
  assert.match((await readForm('https://example.com/form')).error, /구글 폼·네이버 폼 주소가 아니에요/);
  const down = await readForm(KSPO, { fetch: async () => { throw new TypeError('fetch failed'); } });
  assert.deepEqual([typeof down.error, down.reason], ['string', 'network']);
  const login = await readForm(KSPO, { fetch: stub(() => to('https://accounts.google.com/ServiceLogin?continue=x')) });
  assert.deepEqual([/로그인/.test(login.error), login.reason], [true, 'login']);
  assert.match((await readForm(KSPO, { fetch: stub(() => new Response('', { status: 404 })) })).error, /없는 구글 폼/);
  assert.match((await readForm(KSPO, { fetch: stub(() => html('<html>바뀐 화면</html>')) })).error, /형식이 바뀐/);
  const nlogin = await readForm(KIND, { fetch: stub(() => new Response(JSON.stringify({ ok: false, error: 'REDIRECT', details: 'https://nid.naver.com/nidlogin.login' }), { status: 401 })) });
  assert.equal(nlogin.reason, 'login');
  const closed = await readForm(KSPO, { fetch: stub(url => url === KSPO ? to(`https://docs.google.com/forms/d/e/${KSPO_ID}/closedform`) : html('<meta property="og:title" content="끝난 &amp; 폼"><div>더 이상 응답을 받지 않습니다.</div>')) });
  assert.deepEqual([closed.open, closed.title, closed.blockers, closed.questions], [false, '끝난 & 폼', ['더 이상 응답을 받지 않는 폼이에요'], []]);
});

test('읽기는 GET만 쓴다', () => {
  assert.ok(fixtures.calls.length >= 4);
  assert.ok(fixtures.calls.every(c => c.method === 'GET' && !c.opt.body));
});

test('네이버 폼(표, 실제 시험 폼): 행·열을 읽고 줄마다 "행 :: 열"로 답을 받는다', async () => {
  const f = await load(GRID), q = f.questions[1];
  assert.deepEqual([f.title, f.pages, f.blockers, f.questions.map(x => x.type)], ['골라골라 시험 테스트', 1, [], ['choice', 'grid', 'choice']]);
  assert.deepEqual([q.rows, q.options, q.many, q.required, q.rule], [['롤', '리그오브레전드'], ['피구', '배구'], false, true, '행마다 하나씩 고르기']);
  assert.deepEqual(f.raw.q.q2.cells, { '1,1': 4, '1,2': 5, '2,1': 6, '2,2': 7 });
  const ok = { q1: '게임', q2: ['롤 :: 피구', '리그오브레전드::배구'], q3: '1' };
  assert.deepEqual(checkAnswers(f, ok), []);
  assert.deepEqual(checkAnswers(f, { ...ok, q2: '롤 :: 피구\n리그오브레전드 :: 배구' }), []);   // 한 글에 줄마다 써도 된다
  assert.deepEqual(checkAnswers(f, { ...ok, q2: [] }), ['q2 필수인데 비었어요']);
  assert.deepEqual(checkAnswers(f, { ...ok, q2: ['롤 :: 피구'] }), ['q2 답하지 않은 행이 있어요: 리그오브레전드']);
  assert.deepEqual(checkAnswers(f, { ...ok, q2: ['롤 :: 피구', '롤 :: 배구', '리그오브레전드 :: 배구'] }), ['q2 행마다 하나만 고를 수 있어요: 롤']);
  assert.deepEqual(checkAnswers(f, { ...ok, q2: ['롤 :: 축구', '피구'] }), ["q2 표에 없는 답: 롤 :: 축구, 피구 — 줄마다 '행 :: 열' 꼴로 써 주세요"]);
  assert.notEqual(f.sig, (await readForm(GRID, { fetch: stub(() => new Response(read('form-naver-grid.json').replace('"리그오브레전드"', '"스타"'))) })).sig);   // 행 이름이 바뀌면 sig가 달라진다

  const s = await naverServer(JSON.parse(read('form-naver-grid.json')), res => sendJson(res, 200, { success: true }));
  try {
    assert.deepEqual((await submitForm(f, ok, { fetch: s.fetch })).ok, true);
    assert.deepEqual(JSON.parse(s.posts()[0].body), { taToken: '-0IEwxLumGqz7JT2ChgFAQ', extras: null, items: [
      { questionId: 2, type: 'CHOICE', refId: 2, value: '게임' },
      { questionId: 3, type: 'GRID', refId: 4, value: "'롤','피구'" },   // 화면이 보내는 값: '행','열'과 그 칸의 id
      { questionId: 3, type: 'GRID', refId: 7, value: "'리그오브레전드','배구'" },
      { questionId: 4, type: 'CHOICE', refId: 8, value: '1' },
    ] });
  } finally { await s.close(); }
});

/* ---------- 답 검사 ---------- */
test('checkAnswers: 필수 누락·보기에 없는 답·글자 수 초과를 알려 준다', async () => {
  const g = await load(KSPO);
  assert.deepEqual(checkAnswers(g, KSPO_ANSWERS), []);
  assert.deepEqual(checkAnswers(g, { ...KSPO_ANSWERS, q1: '  ', q9: [] }), ['q1 필수인데 비었어요', 'q9 필수인데 비었어요']);
  assert.deepEqual(checkAnswers(g, { ...KSPO_ANSWERS, q6: '만 14세 이상' }), ['q6 보기에 없는 답: 만 14세 이상']);
  assert.deepEqual(checkAnswers(g, { ...KSPO_ANSWERS, q5: '가'.repeat(501) }), ['q5 글자 수 초과: 501자(500자까지)']);
  assert.deepEqual(checkAnswers(g, { ...KSPO_ANSWERS, q5: '가'.repeat(500) }), []);
  assert.deepEqual(checkAnswers(g, { ...KSPO_ANSWERS, q6: g.questions[5].options }), ['q6 답은 하나만 넣을 수 있어요']);
  assert.deepEqual(checkAnswers(g, { ...KSPO_ANSWERS, q99: '남는 답' }), ['q99 폼에 없는 문항이에요']);
  assert.equal(checkAnswers(g, {}).length, 11);

  const sea = await load(SEA), ok = { q1: '동의합니다', q2: '동의합니다', q3: '동의합니다.', q4: '홍길동', q5: '01012345678', q6: 'me@example.com', q7: '바다를 품은 과학', q8: '뜻' };
  assert.deepEqual(checkAnswers(sea, ok), []);
  assert.deepEqual(checkAnswers(sea, { ...ok, q7: '가'.repeat(21) }), ['q7 글자 수 초과: 21자(20자까지)']);
  assert.deepEqual(checkAnswers(sea, { ...ok, q6: 'me@example', q5: '전화 없음' }), ['q5 필수인데 비었어요', 'q6 이메일 꼴이 아니에요: me@example']);

  const kind = await load(KIND);
  assert.deepEqual(checkAnswers(kind, KIND_ANSWERS), []);
  assert.deepEqual(checkAnswers(kind, { ...KIND_ANSWERS, q9: '동의하지 않음', q10: '네' }), ['q9 동의해야 낼 수 있는 문항이에요', 'q10 보기에 없는 답: 네']);

  const m = await miniForm(MINI_ITEMS);
  assert.deepEqual(checkAnswers(m, { q1: '직접 쓴 분야', q2: '2026-11-10', q3: ['바다', '우주'], q4: '14:30', q5: '2' }), []);
  assert.deepEqual(checkAnswers(m, { q1: '슬로건', q2: '2026-02-30', q3: ['우주', '별'], q4: '25:00', q5: '5' }),
    ['q2 날짜는 2026-11-10 꼴로 써 주세요', 'q3 보기에 없는 답: 별', 'q4 시간은 14:30 꼴로 써 주세요', 'q5 보기에 없는 답: 5']);
});

/* ---------- 구글 제출(가짜 서버) ---------- */
test('구글 제출: entry 값·pageHistory·fbzx·쿠키를 실어 formResponse로 보낸다', async () => {
  const form = await load(KSPO);
  const s = await googleServer(read('form-google-kspo.html'), res => send(res, 200, CONFIRM, { 'content-type': 'text/html; charset=utf-8' }));
  try {
    const r = await submitForm(form, KSPO_ANSWERS, { fetch: s.fetch });
    assert.deepEqual([r.ok, r.sure], [true, true]);
    assert.deepEqual(s.log.map(h => [h.method, h.host, h.path]), [['GET', 'docs.google.com', `/forms/d/e/${KSPO_ID}/viewform`], ['POST', 'docs.google.com', `/forms/d/e/${KSPO_ID}/formResponse`]]);
    const post = s.log[1], p = new URLSearchParams(post.body);
    assert.equal(post.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(post.headers.cookie, 'S=spreadsheet_forms=abc; NID=xyz');   // viewform에서 받은 쿠키
    assert.equal(post.headers.referer, KSPO);
    assert.match(post.headers['user-agent'], /^pkm-contest\//);
    assert.equal(p.get('entry.1054384639'), '홍길동');
    assert.equal(p.get('entry.692413427'), 'me@example.com');
    assert.equal(p.get('entry.999399195'), '첫 줄\r\n둘째 줄');
    assert.equal(p.get('entry.197195078'), '만 14세 이상입니다.');
    assert.deepEqual(p.getAll('entry.627153957'), ['유의사항을 모두 확인하였으며 동의합니다.']);
    assert.deepEqual(p.getAll('entry.785925064'), ['내용을 확인하였으며 동의합니다.']);
    assert.equal(p.has('entry.1746425800'), false);   // 비워 둔 선택 문항은 보내지 않는다
    assert.equal(p.get('pageHistory'), '0,1,2');
    assert.equal(p.get('fbzx'), '-6709450495756119812');
    assert.equal(p.get('partialResponse'), '[null,null,"-6709450495756119812"]');
    assert.equal(p.get('fvv'), '1');
    assert.equal([...p.keys()].filter(k => k.startsWith('entry.')).length, 11);
  } finally { await s.close(); }
});

test('구글 제출: 기타 보기는 __other_option__, 날짜는 _year/_month/_day로 보낸다', async () => {
  const page = mini(MINI_ITEMS), form = await miniForm(MINI_ITEMS);
  const s = await googleServer(page, res => send(res, 200, '<html><body>응답이 기록되었습니다.</body></html>'));
  try {
    const r = await submitForm(form, { q1: '직접 쓴 분야', q2: '2026-11-05', q3: ['과학', '우주'], q4: '9:05', q5: '3' }, { fetch: s.fetch });
    assert.deepEqual([r.ok, r.sure], [true, true]);
    const p = new URLSearchParams(s.posts()[0].body);
    assert.deepEqual([p.get('entry.111'), p.get('entry.111.other_option_response')], ['__other_option__', '직접 쓴 분야']);
    assert.deepEqual([p.get('entry.112_year'), p.get('entry.112_month'), p.get('entry.112_day'), p.has('entry.112')], ['2026', '11', '5', false]);
    assert.deepEqual([p.getAll('entry.113'), p.get('entry.113.other_option_response')], [['과학', '__other_option__'], '우주']);
    assert.deepEqual([p.get('entry.114_hour'), p.get('entry.114_minute'), p.get('entry.115')], ['9', '5', '3']);
    assert.equal(p.get('pageHistory'), '0');
  } finally { await s.close(); }
});

test('구글 제출: 확인 화면을 못 보면 sure: false, 400·로그인·캡차·폼 화면은 실패로 알린다', async () => {
  const form = await load(KSPO), page = read('form-google-kspo.html');
  const run = async post => { const s = await googleServer(page, post); try { return [await submitForm(form, KSPO_ANSWERS, { fetch: s.fetch }), s.posts().length]; } finally { await s.close(); } };
  const [vague] = await run(res => send(res, 200, '<html><body>ok</body></html>'));
  assert.deepEqual([vague.ok, vague.sure], [true, false]);
  const [bad] = await run(res => send(res, 400, '<html>Bad Request</html>'));
  assert.deepEqual([bad.ok, bad.sent, bad.reason], [false, false, 'invalid']);
  const [login] = await run(res => send(res, 302, '', { location: 'https://accounts.google.com/v3/signin/identifier?continue=x' }));
  assert.deepEqual([login.ok, login.sent, login.reason], [false, false, 'login']);
  const [robot] = await run(res => send(res, 200, page.replace('<form ', '<form data-captcha-challenge-failed="true" ')));
  assert.deepEqual([robot.ok, robot.sent, robot.reason], [false, false, 'challenge']);
  const [busy] = await run(res => send(res, 429, 'Too Many Requests'));
  assert.equal(busy.reason, 'challenge');
  const [again] = await run(res => send(res, 200, page));   // 같은 폼 화면이 다시 온다
  assert.deepEqual([again.ok, again.sent, again.reason], [false, 'unknown', 'unknown']);
  const [rejected] = await run(res => send(res, 200, page.replace('<form ', '<form data-validation-failed="true" ')));
  assert.deepEqual([rejected.sent, rejected.reason], [false, 'invalid']);
  const [boom] = await run(res => send(res, 503, 'unavailable'));
  assert.deepEqual([boom.sent, boom.reason], ['unknown', 'unknown']);
  for (const r of [bad, login, robot, again, boom]) assert.ok(r.message && /[가-힣]/.test(r.message));
});

test('구글 제출: 폼이 바뀌었거나 답이 틀리면 POST를 보내지 않는다', async () => {
  const form = await load(KSPO), page = read('form-google-kspo.html');
  const run = async (served, answers, f = form) => { const s = await googleServer(served, res => send(res, 200, CONFIRM)); try { return [await submitForm(f, answers, { fetch: s.fetch }), s.posts().length]; } finally { await s.close(); } };
  const [changed, n1] = await run(page.replaceAll('공모전 참여자 성함', '참여자 이름'), KSPO_ANSWERS);
  assert.deepEqual([changed.ok, changed.sent, changed.reason, n1], [false, false, 'changed', 0]);
  const [invalid, n2] = await run(page, { ...KSPO_ANSWERS, q1: '' });
  assert.deepEqual([invalid.sent, invalid.reason, n2], [false, 'invalid', 0]);
  assert.match(invalid.message, /q1 필수인데 비었어요/);
  const lib = await load(LIB);
  const [login, n3] = await run(read('form-google-lib.html'), { q1: '예' }, lib);
  assert.deepEqual([login.sent, login.reason, n3], [false, 'login', 0]);
  const hard = [...MINI_ITEMS, [6, '신청서 파일', null, 13, [[116, null, 0]]]];
  const [blocked, n4] = await run(mini(hard), { q1: '슬로건', q2: '2026-11-10' }, await miniForm(hard));
  assert.deepEqual([blocked.sent, blocked.reason, n4], [false, 'invalid', 0]);
  assert.match(blocked.message, /파일 올리기/);
});

test('구글 제출: 보내는 중에 끊기면 sent: unknown, 읽는 중에 끊기면 sent: false', async () => {
  const form = await load(KSPO);
  const s = await googleServer(read('form-google-kspo.html'), drop);
  try {
    const r = await submitForm(form, KSPO_ANSWERS, { fetch: s.fetch });
    assert.deepEqual([r.ok, r.sent, r.reason], [false, 'unknown', 'network']);
    assert.match(r.message, /중복/);
  } finally { await s.close(); }
  const before = await submitForm(form, KSPO_ANSWERS, { fetch: async () => { throw new TypeError('fetch failed'); } });
  assert.deepEqual([before.ok, before.sent, before.reason], [false, false, 'network']);
});

/* ---------- 네이버 제출(가짜 서버) ---------- */
test('네이버 제출: 웹 화면과 같은 items·taToken을 익명 쿠키와 함께 보낸다', async () => {
  const form = await load(KIND), survey = JSON.parse(read('form-naver-kind.json'));
  const s = await naverServer(survey, res => sendJson(res, 200, { success: true, available: true, surveyStatus: 'IN_PROGRESS', error: null }));
  try {
    const r = await submitForm(form, KIND_ANSWERS, { fetch: s.fetch });
    assert.deepEqual([r.ok, r.sure], [true, true]);
    assert.deepEqual(s.log.map(h => [h.method, h.host, h.path]), [['GET', 'survey-api.naver.com', '/api/form/surveys/9aiNWQM4Vo9/access?ignoreCount=true'],
      ['GET', 'survey-api.naver.com', '/api/form/surveys/9aiNWQM4Vo9/answers/status'], ['POST', 'survey-api.naver.com', '/api/form/surveys/9aiNWQM4Vo9/answers']]);
    const [, status, post] = s.log;
    assert.deepEqual(JSON.parse(post.body), { taToken: 'mIZhyHqBv6ULpLwwXeUSBQ', extras: null, items: [
      { questionId: 2, type: 'NAME', refId: null, value: '홍길동' },
      { questionId: 3, type: 'PHONE_NUMBER', refId: null, value: '01012345678' },   // 숫자만
      { questionId: 4, type: 'EMAIL', refId: null, value: 'me@example.com' },
      { questionId: 5, type: 'SHORT_TEXT', refId: null, value: '세계로 잇는 내일' },   // 한 줄, 한 칸 띄움
      { questionId: 6, type: 'LONG_TEXT', refId: null, value: '첫 문단\n\n둘째 문단' },
      { questionId: 7, type: 'CHOICE', refId: 2, value: '예' },
      { questionId: 8, type: 'CHOICE', refId: 4, value: '동의합니다.' },
      { questionId: 9, type: 'CHOICE', refId: 6, value: '동의합니다.' },
      { questionId: 10, type: 'AGREE', refId: null, value: 'Y' },
      { questionId: 11, type: 'AGREE', refId: null, value: 'Y' },
    ] });
    for (const h of [status, post]){
      assert.equal(h.headers.cookie, 'anonymous=JWT.TEST');
      assert.equal(h.headers.origin, 'https://form.naver.com');
      assert.equal(h.headers.referer, KIND);
      assert.equal(h.headers.survey_uid, undefined);   // 로그인한 화면에만 붙는 헤더
    }
    assert.equal(post.headers['content-type'], 'application/json');
  } finally { await s.close(); }
});

test('네이버 제출: AGREE_V2는 보기 id와 Y/N 값으로, 직접 입력은 refId null로 보낸다', async () => {
  const survey = JSON.parse(read('form-naver-cheongju.json'));
  survey.pages[3].questions.push({ id: 17, title: '알게 된 경로', type: 'MULTI_CHOICE', options: { required: false, multiSelect: true, customValue: true }, props: { max: 2 }, items: [{ id: 21, value: '누리집' }, { id: 22, value: 'SNS' }, { id: 23, value: '지인' }] },
    { id: 18, title: '거주 지역', type: 'DROPDOWN', options: { required: false }, props: {}, items: [{ id: 24, value: '충북' }, { id: 25, value: '그 밖' }] });
  const s = await naverServer(survey, res => sendJson(res, 200, { success: true }));
  try {
    const form = await readForm(SEA, { fetch: s.fetch });
    assert.deepEqual(form.questions.slice(8).map(q => [q.type, q.options, q.other]), [['multi', ['누리집', 'SNS', '지인'], true], ['dropdown', ['충북', '그 밖'], false]]);
    const answers = { q1: '동의합니다', q2: '동의합니다', q3: '동의합니다.', q4: '홍길동', q5: '01012345678', q6: 'me@example.com', q7: '바다를 품은 과학', q8: '뜻', q9: ['전단', 'SNS'], q10: '충북' };
    assert.deepEqual(checkAnswers(form, { ...answers, q9: ['누리집', 'SNS', '지인'] }), ['q9 2개까지만 고를 수 있어요']);
    assert.equal((await submitForm(form, answers, { fetch: s.fetch })).ok, true);
    const items = JSON.parse(s.posts()[0].body).items;
    assert.deepEqual(items.slice(0, 3), [{ questionId: 20, type: 'CHOICE', refId: 14, value: '동의합니다' }, { questionId: 10, type: 'AGREE_V2', refId: 7, value: 'Y' }, { questionId: 11, type: 'CHOICE', refId: 9, value: '동의합니다.' }]);
    assert.deepEqual(items.slice(8), [{ questionId: 17, type: 'MULTI_CHOICE', refId: 22, value: 'SNS' }, { questionId: 17, type: 'MULTI_CHOICE', refId: null, value: '전단' }, { questionId: 18, type: 'DROPDOWN', refId: 24, value: '충북' }]);
  } finally { await s.close(); }
});

test('네이버 제출: INVALID_PARAM·DUPLICATED·로그인 리다이렉트·본인 확인을 reason으로 알린다', async () => {
  const form = await load(KIND), survey = JSON.parse(read('form-naver-kind.json'));
  const run = async (post, o) => { const s = await naverServer(survey, post, o); try { return [await submitForm(form, KIND_ANSWERS, { fetch: s.fetch }), s.posts().length]; } finally { await s.close(); } };
  const [invalid] = await run(res => sendJson(res, 200, { success: false, available: true, surveyStatus: 'IN_PROGRESS', error: 'INVALID_PARAM' }));
  assert.deepEqual([invalid.ok, invalid.sent, invalid.reason], [false, false, 'invalid']);
  // 실제 네이버는 폼을 읽자마자 온 답을 INVALID_PARAM으로 거절한다(시험 폼으로 확인) — 새로 읽어 한 번만 더 보낸다
  let hits = 0;
  const [retried, posts] = await run(res => sendJson(res, 200, hits++ ? { success: true, available: true, answerId: 313058281, error: null } : { success: false, available: false, answerId: null, error: 'INVALID_PARAM' }));
  assert.deepEqual([retried.ok, retried.sure, retried.id, posts], [true, true, '313058281', 2]);
  const [dup] = await run(res => sendJson(res, 200, { success: false, available: false, error: 'DUPLICATED' }));
  assert.deepEqual([dup.sent, dup.reason], [false, 'duplicate']);
  const [already, n1] = await run(res => sendJson(res, 200, { success: true }), { status: { available: false, answered: true, error: null } });
  assert.deepEqual([already.sent, already.reason, n1], [false, 'duplicate', 0]);   // 화면이 여는 순간 하는 확인에서 걸리면 보내지 않는다
  const [full, n2] = await run(res => sendJson(res, 200, { success: true }), { status: { available: false, answered: false, error: 'LIMIT_EXCEEDED' } });
  assert.deepEqual([full.reason, n2], ['closed', 0]);
  const [login] = await run(res => sendJson(res, 401, { ok: false, error: 'REDIRECT', errorMessage: 'redirect to url written in details', details: 'https://nid.naver.com/nidlogin.login?url=x' }));
  assert.deepEqual([login.sent, login.reason], [false, 'login']);
  const [pii] = await run(res => sendJson(res, 403, { ok: false, error: 'PII_AUTH', details: {} }));
  assert.deepEqual([pii.sent, pii.reason], [false, 'challenge']);
  const [gone, n3] = await run(res => sendJson(res, 200, { success: true }), { access: res => sendJson(res, 401, { ok: false, error: 'REDIRECT', details: 'https://nid.naver.com/nidlogin.login' }) });
  assert.deepEqual([gone.sent, gone.reason, n3], [false, 'login', 0]);
  const [boom] = await run(res => send(res, 502, 'bad gateway'));
  assert.deepEqual([boom.sent, boom.reason], ['unknown', 'unknown']);
  const [odd] = await run(res => sendJson(res, 200, { success: false, error: 'SOMETHING_NEW' }));
  assert.deepEqual([odd.sent, odd.reason], [false, 'unknown']);
  for (const r of [invalid, dup, already, login, pii, gone, boom, odd]) assert.ok(/[가-힣]/.test(r.message));
});

test('네이버 제출: 폼이 바뀌었거나 닫혔거나 답이 틀리면 POST를 보내지 않고, 보내는 중에 끊기면 sent: unknown', async () => {
  const form = await load(KIND), survey = JSON.parse(read('form-naver-kind.json'));
  const run = async (served, answers, post = res => sendJson(res, 200, { success: true })) => { const s = await naverServer(served, post); try { return [await submitForm(form, answers, { fetch: s.fetch }), s.posts().length]; } finally { await s.close(); } };
  const edited = structuredClone(survey); edited.pages[2].questions[0].items.push({ id: 9, value: '모르겠음', skipOffset: null });
  const [changed, n1] = await run(edited, KIND_ANSWERS);
  assert.deepEqual([changed.sent, changed.reason, n1], [false, 'changed', 0]);
  const [closed, n2] = await run({ ...survey, status: 'FINISHED' }, KIND_ANSWERS);
  assert.deepEqual([closed.sent, closed.reason, n2], [false, 'closed', 0]);
  const [refused, n3] = await run(survey, { ...KIND_ANSWERS, q9: '동의하지 않음' });
  assert.deepEqual([refused.sent, refused.reason, n3], [false, 'invalid', 0]);
  const [cut, n4] = await run(survey, KIND_ANSWERS, drop);
  assert.deepEqual([cut.ok, cut.sent, cut.reason, n4], [false, 'unknown', 'network', 1]);
});

/* ---------- 미리 채운 주소 ---------- */
test('prefillUrl: 구글만 만들고, skip한 문항은 주소에 싣지 않는다', async () => {
  const g = await load(KSPO), url = new URL(prefillUrl(g, KSPO_ANSWERS, { skip: ['q1', 'q2', 'q3'] }));
  assert.equal(url.origin + url.pathname, KSPO);
  assert.equal(url.searchParams.get('usp'), 'pp_url');
  assert.equal(url.searchParams.get('entry.628603907'), '함께 뛰는 가치');
  assert.equal(url.searchParams.get('entry.999399195'), '첫 줄\n둘째 줄');
  assert.deepEqual(url.searchParams.getAll('entry.627153957'), ['유의사항을 모두 확인하였으며 동의합니다.']);
  for (const hidden of ['1054384639', '1719612680', '692413427', '홍길동', '01012345678', 'example.com']) assert.ok(!decodeURIComponent(url.href).includes(hidden), hidden);
  assert.doesNotMatch(url.search, /fbzx|pageHistory/);
  assert.ok(prefillUrl(g, KSPO_ANSWERS).includes('entry.1054384639='));

  const m = await miniForm(MINI_ITEMS), q = new URL(prefillUrl(m, { q1: '직접 쓴 분야', q2: '2026-11-05', q4: '9:05' })).searchParams;
  assert.deepEqual([q.get('entry.111'), q.get('entry.111.other_option_response'), q.get('entry.112'), q.get('entry.114')], ['__other_option__', '직접 쓴 분야', '2026-11-05', '9:05']);
  assert.equal(prefillUrl(await load(KIND), KIND_ANSWERS), '');
});

/* ---------- 유형 넓히기: 구글 실제 표본(공개 폼을 GET으로 읽어 문항 데이터만 남긴 fixture) ---------- */
const gfix = async name => { const page = read(`form-google-${name}.html`), id = /forms\/d\/e\/([\w-]+)\/formResponse/.exec(page)[1]; return { page, form: await readForm(`https://docs.google.com/forms/d/e/${id}/viewform`, { fetch: stub(() => html(page)) }) }; };
// 가짜 서버에 제출해 보낸 본문(URLSearchParams)을 돌려준다
const gsend = async (page, form, answers) => { const s = await googleServer(page, res => send(res, 200, '<html><body>응답이 기록되었습니다.</body></html>')); try { const r = await submitForm(form, answers, { fetch: s.fetch }); return { r, p: new URLSearchParams(s.posts()[0]?.body || ''), posts: s.posts().length }; } finally { await s.close(); } };

test('구글 분기(실제 표본 2개): 보기에 걸린 이동과 섹션 뒤 이동에 따라 거치는 문항·pageHistory가 달라진다', async () => {
  const { page, form: f } = await gfix('nav-nugu');   // 예 → 2쪽 → 3쪽(감사) → 제출, 아니오 → 4쪽(아쉽습니다) → 제출
  assert.deepEqual([f.pages, f.blockers, f.questions.map(q => q.page)], [4, [], [1, 1, 1, 1, 2]]);
  const base = { q2: '홍길동', q3: 'me@example.com' };
  assert.deepEqual(visible(f, { ...base, q4: '예.' }), ['q1', 'q2', 'q3', 'q4', 'q5']);
  assert.deepEqual(visible(f, { ...base, q4: '아니오.' }), ['q1', 'q2', 'q3', 'q4']);
  assert.deepEqual(checkAnswers(f, { ...base, q4: '예.' }), ['q5 필수인데 비었어요']);
  assert.deepEqual(checkAnswers(f, { ...base, q4: '아니오.' }), []);   // 거치지 않는 2쪽의 필수 문항은 보지 않는다
  const no = await gsend(page, f, { ...base, q4: '아니오.', q5: '완료했습니다.' });
  assert.deepEqual([no.r.ok, no.p.get('pageHistory'), no.p.get('entry.1956998860'), no.p.has('entry.691422301')], [true, '0,3', '아니오.', false]);   // 거치지 않는 문항의 답은 보내지 않는다
  const yes = await gsend(page, f, { ...base, q4: '예.', q5: '완료했습니다.' });
  assert.deepEqual([yes.p.get('pageHistory'), yes.p.get('entry.691422301')], ['0,1,2', '완료했습니다.']);

  const w = (await gfix('nav-wepick')).form;   // 잘 봤어요 → 2쪽 → (섹션 뒤 이동으로 3쪽을 건너) 4쪽, 아쉬워요 → 3쪽 → 4쪽
  assert.deepEqual(visible(w, { q1: '잘 봤어요.' }), ['q1', 'q2', 'q4']);
  assert.deepEqual(visible(w, { q1: '아쉬운 점이 있어요.' }), ['q1', 'q3', 'q4']);
  assert.deepEqual(visible(w, {}), ['q1', 'q2', 'q4']);   // 답하기 전에는 보기 이동 없이 섹션 뒤 이동만 따른다
  assert.deepEqual(checkAnswers(w, { q1: '잘 봤어요.' }), []);
  assert.deepEqual(checkAnswers(w, { q1: '아쉬운 점이 있어요.' }), ['q3 필수인데 비었어요']);
});

test('구글 표(실제 표본): 행마다 entry가 따로 있고, 드롭다운 이동과 함께 거친 쪽만 보낸다', async () => {
  const { page, form: f } = await gfix('grid'), g = f.questions[5];
  assert.deepEqual([f.pages, f.blockers, g.type, g.rows.length, g.options.length, g.many, g.required, g.rule], [6, [], 'grid', 11, 6, false, true, '행마다 하나씩 고르기']);
  assert.equal(g.rows[0], 'I know how to use the formative assessments that are built into the curriculum.');
  assert.deepEqual(visible(f, { q3: 'Facilitator' }), ['q1', 'q2', 'q3']);   // 진행자는 안내 쪽(2쪽)만 보고 제출
  assert.deepEqual(visible(f, { q3: 'Teacher', q4: 'Agree' }).includes('q5'), false);   // 만족하면 '어떻게 바꿀까'(4쪽)를 건너뛴다
  assert.deepEqual(visible(f, { q3: 'Teacher', q4: 'Disagree' }).length, 20);
  const pickAll = (q, col) => q.rows.map(r => `${r} :: ${col}`), t = { q3: 'Teacher', q4: 'Agree', q6: pickAll(g, 'Agree'), q9: 'a', q10: 'b', q12: pickAll(f.questions[11], 'Strongly agree'), q13: 'Agree', q16: 'c', q17: 'd' };
  assert.deepEqual(checkAnswers(f, t), []);
  assert.deepEqual(checkAnswers(f, { ...t, q6: t.q6.slice(1) }), [`q6 답하지 않은 행이 있어요: ${g.rows[0].slice(0, 60)}`]);
  const { r, p } = await gsend(page, f, t);
  assert.deepEqual([r.ok, p.get('pageHistory'), p.get('entry.24684004'), p.get('entry.652893591'), p.get('entry.2085585054'), p.get('entry.722521804')], [true, '0,2,4,5', 'Teacher', 'Agree', 'Agree', 'Strongly agree']);
  assert.equal([...p.keys()].filter(k => k.startsWith('entry.')).length, 2 + 11 + 2 + 7 + 3);
  const fac = await gsend(page, f, { ...t, q3: 'Facilitator' });
  assert.deepEqual([fac.p.get('pageHistory'), [...fac.p.keys()].filter(k => k.startsWith('entry.'))], ['0,1', ['entry.24684004']]);

  const r2 = (await gfix('grid-radio')).form, grids = r2.questions.filter(q => q.type === 'grid');   // 새 폼은 행 entry 끝에 [0](행마다 하나)이 붙는다
  assert.deepEqual([grids.length, grids.every(q => q.many === false), grids.filter(q => !q.required).length, r2.questions.filter(q => q.type === 'dropdown').length], [17, true, 1, 8]);
});

test('구글 설정(실제 표본): 이메일 받기·1회 제한(로그인)·캡차·닫힌 폼·응답 검증', async () => {
  const { page, form: e } = await gfix('scale-email');
  assert.deepEqual([e.blockers, e.login, e.questions[0]], [[], false, { id: 'q1', title: '이메일 주소', desc: '이 폼은 응답과 함께 이메일 주소를 받아요', type: 'short', field: 'email', required: true, options: [], other: false, limit: 0, page: 1, rule: '' }]);
  assert.deepEqual([e.questions[1].type, e.questions[1].options, e.questions[1].rule], ['scale', ['1', '2', '3', '4', '5'], "1(No experience)~5(I've used it extensively before)"]);
  assert.deepEqual(checkAnswers(e, {}), ['q1 필수인데 비었어요']);
  assert.deepEqual(checkAnswers(e, { q1: 'me@example', q2: '6' }), ['q1 이메일 꼴이 아니에요: me@example', 'q2 보기에 없는 답: 6']);
  const { r, p } = await gsend(page, e, { q1: 'me@example.com', q2: '4', q3: ['Learn more about Elm', 'Free pizza'] });
  assert.deepEqual([r.ok, p.get('emailAddress'), p.get('entry.95133344'), p.getAll('entry.1073274690'), p.get('entry.1073274690.other_option_response')], [true, 'me@example.com', '4', ['Learn more about Elm', '__other_option__'], 'Free pizza']);
  assert.match(prefillUrl(e, { q1: 'me@example.com', q2: '4' }), /emailAddress=me%40example\.com&entry\.95133344=4$/);
  assert.doesNotMatch(prefillUrl(e, { q1: 'me@example.com', q2: '4' }, { skip: ['q1'] }), /emailAddress/);

  const s = await gfix('signin');   // 이메일은 받지 않지만 응답 1회 제한 — 화면이 로그인하라고 알린다
  assert.deepEqual([s.form.login, s.form.blockers], [true, ['구글 로그인이 필요한 폼이에요']]);
  const c = await gfix('captcha');
  assert.deepEqual(c.form.blockers, ['사람인지 확인(캡차)을 거치는 폼이에요']);
  const blocked = await gsend(c.page, c.form, { q1: 'me@example.com' });
  assert.deepEqual([blocked.r.reason, blocked.r.sent, blocked.posts], ['invalid', false, 0]);   // 캡차를 넘지 않는다

  const shut = await readForm(KSPO, { fetch: stub(url => url === KSPO ? to(`https://docs.google.com/forms/d/e/${KSPO_ID}/closedform`) : html(read('form-google-closed.html'))) });
  assert.deepEqual([shut.open, shut.title, shut.questions.length, shut.pages, visible(shut, {})], [false, '서울문화포털 홈페이지 사용자 만족도조사', 0, 0, []]);

  const v = (await gfix('validation')).form, n = (await gfix('number')).form;
  assert.deepEqual([v.questions[6].rule, n.questions[6].rule, n.questions[12].other], ['이메일 꼴', '숫자', true]);
  const need = f => Object.fromEntries(f.questions.filter(q => q.required).map(q => [q.id, q.options[0] || (q.type === 'date' ? '1990-01-02' : '1')]));
  assert.deepEqual(checkAnswers(v, { ...need(v), q7: 'me@example.com' }), []);
  assert.deepEqual(checkAnswers(v, need(v)), ['q7 형식이 맞지 않아요: 이메일 꼴']);
  assert.deepEqual(checkAnswers(n, { ...need(n), q7: '19900102' }), []);
  assert.deepEqual(checkAnswers(n, { ...need(n), q7: '1990-01-02' }), ['q7 형식이 맞지 않아요: 숫자']);
});

/* ---------- 유형 넓히기: 표본을 구하지 못한 구글 유형·설정(합성) ---------- */
const grow = (id, row, many) => [id, [['오전'], ['오후']], 1, [row], null, null, null, null, null, null, null, [many]];
const SYN = [
  [21, '참석 일시', null, 9, [[211, null, 1, null, null, null, null, [1, 1]]]],
  [22, '생일', null, 9, [[212, null, 0, null, null, null, null, [0, 0]]]],
  [23, '걸린 시간', null, 10, [[213, null, 0, null, null, null, [1]]]],
  [24, '별점', null, 18, [[214, [['1'], ['2'], ['3'], ['4'], ['5']], 0]]],
  [25, '가능한 때', null, 7, [grow(215, '월', 1), grow(216, '화', 1)]],
  [26, '관심 분야', null, 4, [[217, [opt('가'), opt('나'), opt('다'), opt('라')], 0, null, [[7, 200, ['2']]]]]],
  [27, '딱 둘', null, 4, [[218, [opt('가'), opt('나'), opt('다')], 0, null, [[7, 204, ['2']]]]]],
  [28, '많아야 둘', null, 4, [[219, [opt('가'), opt('나'), opt('다')], 0, null, [[7, 201, ['2']]]]]],
  [29, '나이', null, 0, [[220, null, 0, null, [[1, 7, ['1', '100']]]]]],
  [30, '인원', null, 0, [[221, null, 0, null, [[1, 10]]]]],
  [31, '참가 코드', null, 0, [[222, null, 0, null, [[4, 301, ['[A-Z]{3}\\d{2}']]]]]],
  [32, '제목', null, 0, [[223, null, 0, null, [[2, 100, ['공모']]]]]],
  [33, '누리집', null, 0, [[224, null, 0, null, [[2, 103]]]]],
  [34, '자기소개', null, 1, [[225, null, 0, null, [[6, 203, ['10']]]]]],
  [35, '모르는 검증', null, 0, [[226, null, 0, null, [[9, 999, ['x'], '주최가 적은 오류 글']]]]],
];
test('구글 유형(합성): 날짜+시간·연도 없는 날짜·걸린 시간·평점·체크박스 표를 읽고 보낸다', async () => {
  const page = mini(SYN), f = await miniForm(SYN), q = Object.fromEntries(f.questions.map(x => [x.title, x]));
  assert.deepEqual(f.blockers, []);
  assert.deepEqual(f.questions.slice(0, 5).map(x => [x.type, x.rule]), [['datetime', ''], ['date', '연도 없이 월-일만'], ['duration', ''], ['scale', '1~5'], ['grid', '행마다 여러 개 고를 수 있어요']]);
  assert.deepEqual([q['가능한 때'].rows, q['가능한 때'].options, q['가능한 때'].many], [['월', '화'], ['오전', '오후'], true]);
  const ok = { q1: '2026-11-10T14:30', q2: '03-05', q3: '1:30:00', q4: '4', q5: '월 :: 오전\n월 :: 오후\n화::오후' };
  assert.deepEqual(checkAnswers(f, ok), []);
  assert.deepEqual(checkAnswers(f, { q1: '2026-11-10', q2: '13-05', q3: '90분', q4: '6', q5: ['월 :: 오전'] }),
    ['q1 날짜와 시간은 2026-11-10 14:30 꼴로 써 주세요', 'q2 날짜는 2026-11-10 꼴로 써 주세요', 'q3 걸린 시간은 1:30:00(시:분:초) 꼴로 써 주세요', 'q4 보기에 없는 답: 6', 'q5 답하지 않은 행이 있어요: 화']);
  const { r, p } = await gsend(page, f, ok);
  assert.equal(r.ok, true);
  assert.deepEqual(['year', 'month', 'day', 'hour', 'minute'].map(k => p.get(`entry.211_${k}`)), ['2026', '11', '10', '14', '30']);
  assert.deepEqual([p.has('entry.212_year'), p.get('entry.212_month'), p.get('entry.212_day')], [false, '3', '5']);
  assert.deepEqual(['hour', 'minute', 'second'].map(k => p.get(`entry.213_${k}`)), ['1', '30', '0']);
  assert.deepEqual([p.get('entry.214'), p.getAll('entry.215'), p.getAll('entry.216')], ['4', ['오전', '오후'], ['오후']]);
  const pre = new URL(prefillUrl(f, ok)).searchParams;
  assert.deepEqual([pre.get('entry.211'), pre.get('entry.212'), pre.get('entry.213'), pre.getAll('entry.215')], ['2026-11-10 14:30', '03-05', '1:30:00', ['오전', '오후']]);
});

test('구글 응답 검증(합성): 체크박스 개수·숫자·정규식·글자·URL·최소 길이를 rule로 알리고 checkAnswers에서 본다', async () => {
  const f = await miniForm(SYN), rules = Object.fromEntries(f.questions.slice(5).map(x => [x.id, x.rule]));
  assert.deepEqual(rules, { q6: '2개 이상 고르기', q7: '2개 고르기', q8: '2개까지 고르기', q9: '숫자 1~100', q10: '정수', q11: '정규식 [A-Z]{3}\\d{2}에 맞게', q12: "'공모'이 들어가게", q13: 'URL 꼴', q14: '10자 이상', q15: '주최가 적은 오류 글' });
  const base = { q1: '2026-11-10 14:30', q5: ['월 :: 오전', '화 :: 오후'] }, ok = { ...base, q6: ['가', '나'], q7: ['가', '다'], q8: '가', q9: '42', q10: '3', q11: 'ABC12', q12: '슬로건 공모전', q13: 'https://example.com', q14: '열 글자를 넘는 자기소개', q15: '아무 글' };
  assert.deepEqual(checkAnswers(f, ok), []);
  assert.deepEqual(checkAnswers(f, { ...base, q6: '가', q7: ['가', '나', '다'], q8: ['가', '나', '다'], q9: '101', q10: '2.5', q11: 'ABC123', q12: '슬로건', q13: '누리집 없음', q14: '짧음', q15: '' }),
    ['q6 2개 이상 골라 주세요', 'q7 2개까지만 고를 수 있어요', 'q8 2개까지만 고를 수 있어요', 'q9 형식이 맞지 않아요: 숫자 1~100', 'q10 형식이 맞지 않아요: 정수', 'q11 형식이 맞지 않아요: 정규식 [A-Z]{3}\\d{2}에 맞게',
      "q12 형식이 맞지 않아요: '공모'이 들어가게", 'q13 형식이 맞지 않아요: URL 꼴', 'q14 형식이 맞지 않아요: 10자 이상']);
  assert.deepEqual(checkAnswers(f, { ...base, q9: '스물' }), ['q9 형식이 맞지 않아요: 숫자 1~100']);
  // 폼 주인이 넣은 정규식이 깨졌거나 너무 길면 검사하지 않고 넘긴다(서버가 판단)
  const odd = await miniForm([[41, '코드', null, 0, [[241, null, 0, null, [[4, 301, ['([A-Z']]]]]], [42, '코드2', null, 0, [[242, null, 0, null, [[4, 301, ['a'.repeat(400)]]]]]]]);
  assert.deepEqual(checkAnswers(odd, { q1: '아무거나', q2: '아무거나' }), []);
});

test('구글 분기(합성): 섹션 뒤 이동·제출로 가는 보기를 따르고, 확신 못 하는 이동은 blockers에 넣는다', async () => {
  const sec = (id, go) => [id, `섹션 ${id}`, null, 8, null, go], ask = (id, entry, opts) => [id, `문항 ${id}`, null, opts ? 2 : 0, [[entry, opts || null, 1]]];
  // 1쪽 q1(가→3쪽, 나→제출, 다→이동 없음) · 2쪽 q2 · 3쪽 q3(2쪽 뒤에는 4쪽으로) · 4쪽 q4
  const items = [ask(1, 101, [opt('가', 0, 503), opt('나', 0, -3), opt('다')]), sec(502, null), ask(2, 102), sec(503, -2), ask(3, 103), sec(504, 504), ask(4, 104)];
  const f = await miniForm(items);
  assert.deepEqual([f.pages, f.blockers, f.raw.after, f.raw.q.q1.go], [4, [], [null, null, 4], [3, 0, null]]);
  assert.deepEqual([visible(f, { q1: '가' }), visible(f, { q1: '나' }), visible(f, { q1: '다' })], [['q1', 'q3', 'q4'], ['q1'], ['q1', 'q2', 'q3', 'q4']]);
  const { p } = await gsend(mini(items), f, { q1: '가', q2: '안 거치는 답', q3: '셋', q4: '넷' });
  assert.deepEqual([p.get('pageHistory'), p.has('entry.102'), p.get('entry.103')], ['0,2,3', false, '셋']);
  const jump = '이동 규칙을 확신하지 못하는 폼이에요(뒤로 돌아가거나 모르는 곳으로 가는 이동)';
  assert.deepEqual((await miniForm([ask(1, 101), sec(502, null), ask(2, 102, [opt('처음부터', 0, -1), opt('계속')])])).blockers, [jump]);   // -1(처음으로)은 뜻을 확인하지 못했다
  assert.deepEqual((await miniForm([ask(1, 101), sec(502, null), ask(2, 102), sec(503, 502)])).blockers, [jump]);   // 뒤로 돌아가는 이동
  assert.deepEqual((await miniForm([ask(1, 101, [opt('가', 0, 999), opt('나')])])).blockers, [jump]);   // 없는 섹션
  assert.deepEqual((await miniForm([ask(1, 101, [opt('가', 0, 502), opt('나')]), ask(2, 102, [opt('가', 0, -3), opt('나')]), sec(502, null), ask(3, 103)])).blockers, ['한 페이지에 답에 따른 이동이 둘 이상 걸려 있어요']);
});

/* ---------- 유형 넓히기: 네이버(실제 표본 2개 + nform.js 코드로 확인한 유형은 합성) ---------- */
const nq = (id, type, o = {}) => ({ id, title: o.title || type, description: '', richDescription: null, image: null, type, options: { required: false, multiSelect: false, customValue: false, shuffle: false, ...o.options }, props: o.props || {}, extras: null,
  items: (o.items || []).map((v, i) => typeof v === 'object' ? v : { id: id * 10 + i, value: v, image: null, skipOffset: null, extras: null }) });
const nsurvey = (pages, more = {}) => ({ title: '합성 시험', description: '', richDescription: null, status: 'IN_PROGRESS', restricted: null, pages: pages.map(p => Array.isArray(p) ? { title: '', questions: p, props: {}, nextPageOffset: 1 } : p),
  options: { allowAnonymous: true, allowedUserIds: null }, styles: { useIntro: false }, taToken: 'TOKEN', ...more });
const nread = survey => readForm(KIND, { fetch: stub(() => new Response(JSON.stringify(survey))) });
const nsend = async (survey, answers, o) => { const form = await nread(survey), s = await naverServer(survey, res => sendJson(res, 200, { success: true }), o); try { const r = await submitForm(form, answers, { fetch: s.fetch }); return { r, items: s.posts()[0] ? JSON.parse(s.posts()[0].body).items : null, log: s.log }; } finally { await s.close(); } };

test('네이버(실제 표본): 보기가 하나뿐인 AGREE_V2, 끝난 설문', async () => {
  const f = await readForm(KIND, { fetch: stub(() => new Response(read('form-naver-name.json'))) });
  assert.deepEqual([f.pages, f.blockers, f.questions.length, f.questions[0].type, f.questions[0].options, f.raw.q.q1.items], [1, [], 11, 'agree', ['동의합니다'], [{ id: 2, value: 'Y' }]]);
  const done = await readForm(KIND, { fetch: stub(() => new Response(read('form-naver-finished.json'))) });
  assert.deepEqual([done.open, done.closed, done.questions, done.pages, done.title], [false, '끝난 설문이에요', [], 0, '교생선생님 수업 만족도 조사']);
});

test('네이버 유형(합성): 척도·별점·날짜·시간·숫자·카테고리를 읽고 화면과 같은 item으로 보낸다', async () => {
  const survey = nsurvey([[
    nq(1, 'LIKERT_SCALE', { props: { min: 1, max: 5, minValue: '전혀 아니다', maxValue: '매우 그렇다' }, items: ['1', '2', '3', '4', '5'] }),
    nq(2, 'STAR_RATE', { props: { stars: 5 }, items: ['0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5'] }),
    nq(3, 'CALENDAR', { props: { type: 'DEFAULT' } }), nq(4, 'CALENDAR', { props: { type: 'INCLUDE_TIME' } }), nq(5, 'CALENDAR', { props: { type: 'ONLY_TIME' } }),
    nq(6, 'NUMERIC', { props: { prefix: '', suffix: '원', commaState: true } }), nq(7, 'NUMERIC_REAL'),
    nq(8, 'CATEGORY', { options: { multiSelect: true }, props: { max: 2, maxLevel: 2, categories: [{ value: '문학', next: [{ refId: '1', value: '시', next: null }, { refId: '2', value: '소설', next: null }] }, { value: '예술', next: [{ refId: '3', value: '음악', next: null }] }] },
      items: [{ id: 81, value: '문학·시', extras: { refId: '1' } }, { id: 82, value: '문학·소설', extras: { refId: '2' } }, { id: 83, value: '예술·음악', extras: { refId: '3' } }] }),
    nq(9, 'INFORM', { props: { type: 'entrust', items: [{ type: 'trustee', description: '㈜대행' }] } }),
  ]]);
  const f = await nread(survey);
  assert.deepEqual(f.blockers, []);
  assert.deepEqual(f.questions.map(q => [q.type, q.rule]), [['scale', '1(전혀 아니다)~5(매우 그렇다)'], ['scale', '별점 0.5~5'], ['date', ''], ['datetime', ''], ['time', ''], ['number', '숫자만(0 이상 정수) · 단위 원'], ['number', '숫자(음수·소수 가능)'], ['category', '여러 개 고를 수 있어요 · 2개까지 고르기']]);
  assert.deepEqual([f.questions[7].options, f.questions[7].many, f.questions[0].options.length, f.questions[1].options.length], [['문학·시', '문학·소설', '예술·음악'], true, 5, 10]);
  const ok = { q1: '4', q2: '4.5', q3: '2026-11-10', q4: '2026-11-10 14:30', q5: '09:00', q6: '1,234,567', q7: '-12.50', q8: ['예술·음악', '문학·시'] };
  assert.deepEqual(checkAnswers(f, ok), []);
  assert.deepEqual(checkAnswers(f, { q1: '6', q2: '4.2', q3: '11월 10일', q4: '2026-11-10', q5: '오전 9시', q6: '-5', q7: '열둘', q8: ['문학·시', '문학·소설', '예술·음악'] }),
    ['q1 보기에 없는 답: 6', 'q2 보기에 없는 답: 4.2', 'q3 날짜는 2026-11-10 꼴로 써 주세요', 'q4 날짜와 시간은 2026-11-10 14:30 꼴로 써 주세요', 'q5 시간은 14:30 꼴로 써 주세요', 'q6 숫자만 써 주세요: -5', 'q7 숫자만 써 주세요: 열둘', 'q8 2개까지만 고를 수 있어요']);
  const { r, items } = await nsend(survey, ok);
  assert.equal(r.ok, true);
  assert.deepEqual(items, [
    { questionId: 1, type: 'LIKERT_SCALE', refId: 13, value: '4' },
    { questionId: 2, type: 'STAR_RATE', refId: 28, value: '4.5' },
    { questionId: 3, type: 'CALENDAR', refId: null, value: String(Date.UTC(2026, 10, 10)) },   // 한국 시각 브라우저가 만드는 값: 그날 UTC 0시
    { questionId: 4, type: 'CALENDAR', refId: null, value: String(Date.UTC(2026, 10, 10, 5, 30)) },   // 한국 시각 14:30
    { questionId: 5, type: 'CALENDAR', refId: null, value: '0' },   // 시간만: 1970-01-01 한국 시각 09:00
    { questionId: 6, type: 'NUMERIC', refId: null, value: '1,234,567' },   // 화면처럼 천 단위 쉼표
    { questionId: 7, type: 'NUMERIC_REAL', refId: null, value: '-12.50' },
    { questionId: 8, type: 'CATEGORY', refId: 81, value: '문학·시' }, { questionId: 8, type: 'CATEGORY', refId: 83, value: '예술·음악' },
  ]);
});

test('네이버 주소(합성): 우편번호까지 쓰면 그대로, 빼면 주소 검색(GET)으로 하나로 정해질 때만 보낸다', async () => {
  const survey = nsurvey([[nq(1, 'ADDRESS', { options: { required: true } })]]), f = await nread(survey);
  assert.deepEqual([f.questions[0].type, f.questions[0].limit, /우편번호/.test(f.questions[0].rule)], ['address', 200, true]);
  assert.deepEqual(checkAnswers(f, { q1: '| 3층' }), ["q1 주소는 '(우편번호) 도로명주소 | 상세주소' 꼴로 써 주세요"]);
  const full = await nsend(survey, { q1: '(04524) 서울특별시 중구 세종대로 110 | 3층 민원실' });
  assert.deepEqual(full.items, [{ questionId: 1, type: 'ADDRESS', refId: null, value: '(04524) 서울특별시 중구 세종대로 110|3층 민원실' }]);   // 화면 값: 기본주소|상세주소
  assert.equal(full.log.some(h => h.path.includes('/address')), false);
  const hit = { roadAddress: '서울특별시 중구 세종대로 110 (태평로1가, 서울특별시청)', jibunAddress: '서울특별시 중구 태평로1가 31 서울특별시청', zipCode: '', roadZipcode: '04524' };
  const found = await nsend(survey, { q1: '세종대로 110 | 3층' }, { address: { meta: { totalCount: 1 }, results: [hit] } });
  assert.deepEqual(found.items, [{ questionId: 1, type: 'ADDRESS', refId: null, value: '(04524) 서울특별시 중구 세종대로 110 (태평로1가, 서울특별시청)|3층' }]);
  assert.deepEqual(found.log.filter(h => h.path.includes('/address')).map(h => [h.method, decodeURIComponent(h.path)]), [['GET', '/api/form/address?keyword=세종대로 110']]);
  const many = await nsend(survey, { q1: '세종대로' }, { address: { meta: { totalCount: 2 }, results: [hit, hit] } });
  assert.deepEqual([many.r.ok, many.r.sent, many.r.reason, many.items], [false, false, 'invalid', null]);   // 여러 곳이면 고르지 않고 멈춘다
  assert.match(many.r.message, /q1 주소를 하나로 찾지 못했어요\(2곳\)/);
});

test('네이버 분기(합성): skipOffset·nextPageOffset에 따라 거치는 쪽의 답만 보낸다', async () => {
  // 0쪽 q1(가→2쪽으로 건너뜀, 나→끝으로, 다→다음) · 1쪽 q2(이 쪽 뒤에는 3쪽으로) · 2쪽 q3 · 3쪽 q4
  const it = (id, value, skipOffset = null) => ({ id, value, image: null, skipOffset, extras: null });
  const survey = nsurvey([[nq(1, 'CHOICE', { options: { required: true }, items: [it(11, '가', 2), it(12, '나', 99), it(13, '다')] })],
    { title: '', questions: [nq(2, 'SHORT_TEXT', { options: { required: true } })], props: {}, nextPageOffset: 2 }, [nq(3, 'SHORT_TEXT', { options: { required: true } })], [nq(4, 'SHORT_TEXT')]]);
  const f = await nread(survey);
  assert.deepEqual([f.blockers, f.raw.q.q1.go, f.raw.after], [[], [3, 0, null], [null, 4, null, null]]);
  assert.deepEqual([visible(f, { q1: '가' }), visible(f, { q1: '나' }), visible(f, { q1: '다' })], [['q1', 'q3', 'q4'], ['q1'], ['q1', 'q2', 'q4']]);
  assert.deepEqual(checkAnswers(f, { q1: '나' }), []);
  assert.deepEqual(checkAnswers(f, { q1: '다' }), ['q2 필수인데 비었어요']);
  const { items } = await nsend(survey, { q1: '가', q2: '건너뛴 쪽의 답', q3: '셋', q4: '넷' });
  assert.deepEqual(items.map(i => [i.questionId, i.value]), [[1, '가'], [3, '셋'], [4, '넷']]);
});
}
