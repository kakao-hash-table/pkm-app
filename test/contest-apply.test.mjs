// 공모전 신청 플러그인(plugins/contest-apply) — 임시 프로필에서 찾은 공모전 → AI 요강 정리로 나누기 → 제출 준비(AI 안·복사할 것·냈나요) → 결과.
// 사이트 읽기(find)는 네트워크라 빼고, 찾은 뒤의 저장 꼴을 직접 넣는다. AI 단계는 사람이 쓴 결과로 대신한다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as plugins from '../server/plugins.js';
import * as E from '../plugins/contest-apply/scripts/engine.mjs';

const PLUGIN = new URL('../plugins/contest-apply/', import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-contest-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const profile = path.join(tmp, '개인');
write(path.join(profile, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');
const NOW = '2026-11-10T01:00:00.000Z';
process.env.PKM_HOME = path.join(tmp, 'home');   // 이 컴퓨터의 진짜 ~/.pkm-app에 쓰지 않게
const run = (cmd, a = {}) => JSON.parse(execFileSync(process.execPath, [path.join(PLUGIN, 'scripts/contest.mjs'), cmd, `--profile=${profile}`, `--now=${NOW}`, ...Object.entries(a).map(([k, v]) => `--${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)], { encoding: 'utf8' }));
const DB = path.join(profile, '_플러그인/.data/contest-apply/db.json');
const seed = cs => write(DB, JSON.stringify({ contests: Object.fromEntries(cs.map(c => [c.key, { site: 'wevity', source: '위비티', url: `https://www.wevity.com/?c=find&s=1&gbn=viewok&ix=${c.key.split(':')[1]}`, organizer: '수원시', added: NOW, fit: null, brief: '요강 본문', ...c }])) }));
const FIT = (i, more = {}) => ({ i, unreadable: false, is_target: true, kinds: ['네이밍'], target_why: '', prize_text: '대상 1명 100만원 · 우수 2명 50만원', prize_total: 2000000, prize_first: 1000000, first_is_goods: false,
  awards: ['대상 · 100만원', '우수상 · 50만원'], deadline: '2026-11-20', announce: '2026-12-05', announce_text: '', submit_what: '이름 1개 + 뜻풀이 200자', allow: 2, desc_limit: 200, form_note: '신청서(hwp) 첨부 · 저작권은 주최 측',
  submit_fields: ['이름', '연락처', '작품명'], method: 'email', submit_to: 'name@suwon.go.kr', submit_how: '신청서를 이메일로', mail_subject: '[네이밍 공모] <이름>_<연락처>', eligibility_text: '수원 거주·재직·재학', eligible: 'yes', eligible_why: '수원 거주', ...more });

test('규격 검사를 통과하고, 목록·워크플로우·정렬 칩이 설계대로다', async () => {
  const r = await plugins.inspect({ local: PLUGIN });
  assert.equal(r.ok, true, (r.errors || []).join('\n'));
  assert.deepEqual(r.feeds.map(f => f.name), ['공모전 찾기', '완전 자동화', '낼 공모전', '결과 기다리는 공모전', '뺀 공모전', '메일 계정', '폼 제출 시험']);
});

test('엔진 — 표시 글: 상금·마감·발표, 제출 방식, 정렬 값', () => {
  const f = E.normalizeFit({ contests: [FIT(0), FIT(1, { prize_first: 0, prize_total: 0, announce: '', announce_text: '12월 중', method: 'oops', submit_how: 'https://forms.gle/x 로 접수', eligible: 'maybe' })] }).contests;
  assert.equal(E.prizeLine(f[0]), '1등 100만원 · 총 200만원');
  assert.equal(E.prizeLine(f[1]), '상금 요강 확인');
  assert.equal(E.deadlineLine('2026-11-20', '2026-11-10'), '마감 D-10 · 11월 20일');
  assert.equal(E.deadlineLine('2026-11-11', '2026-11-10'), '마감 내일 · 11월 11일');
  assert.equal(E.deadlineLine('2026-11-10', '2026-11-10'), '마감 오늘');
  assert.equal(E.deadlineLine('', '2026-11-10'), '마감일 요강 확인');
  assert.equal(E.announceLine(f[0], '2026-11-10'), '발표 12월 5일');
  assert.equal(E.announceLine(f[0], '2026-11-10', true), '발표 D-25 · 12월 5일');
  assert.equal(E.announceLine(f[1], '2026-11-10'), '발표 12월 중');
  assert.equal(f[1].submit.method, 'form');
  assert.equal(f[1].eligibility.ok, 'unsure');
  assert.deepEqual(E.sortOf({ deadline: '2026-11-20', fit: f[0] }), { deadline: '2026-11-20', prize: 1000000, announce: '2026-12-05' });
  assert.deepEqual(E.sortOf({ deadline: '2026-11-20', fit: f[1] }), { deadline: '2026-11-20', prize: null, announce: '2026-12-20' });
  assert.equal(E.sortOf({ deadline: '2026-11-20', fit: { ...f[1], announce_text: '12월 초' } }).announce, '2026-12-10');
  assert.equal(E.sortOf({ deadline: '2026-12-20', fit: { ...f[1], announce_text: '1월 말' } }).announce, '2027-01-31');
  assert.deepEqual(E.sortOf({ deadline: '', fit: null }), { deadline: null, prize: null, announce: null });
  assert.equal(E.methodOf('contest@suwon.go.kr 로 접수'), 'email');
  assert.deepEqual(['www.cmak.or.kr/reception/21-cm', 'https://forms.gle/x', 'a@b.kr', '홈페이지 접수'].map(E.urlOf), ['https://www.cmak.or.kr/reception/21-cm', 'https://forms.gle/x', '', '']);
  assert.ok(E.similar('2027 KSPO 스포츠가치센터 슬로건 공모전', '스포츠가치센터 슬로건 공모전'));
  assert.ok(E.similar('경남통합복지플랫폼 브랜드 네이밍 공모', '경상남도 통합복지 플랫폼 네이밍 공모'));
  assert.ok(!E.similar('수원시 시정 슬로건 공모', '수원시 마스코트 이름 공모'));
  // 목록 단계: 요강을 받기 전에 다른 사이트의 같은 공모전을 거른다
  const L = (title, deadline, organizer = '') => ({ title, deadline, organizer });
  assert.ok(E.sameListing(L('2027 KSPO 스포츠가치센터 슬로건 공모전', '2026-11-15', '국민체육진흥공단 스포츠가치센터'), L('스포츠가치센터 슬로건 공모전', '2026-11-15', '국민체육진흥공단')));
  assert.ok(E.sameListing(L('경남통합복지플랫폼 브랜드 네이밍 공모', '2026-11-11'), L('경상남도 통합복지 플랫폼 네이밍 공모', '2026-11-10')), '위비티 D-day 하루 어긋남');
  assert.ok(!E.sameListing(L('도서관의 날 공식주제 공모', '2026-11-16'), L('도서관의 날 공식주제 공모', '2026-12-16')), '마감이 다르면 다른 회차');
  assert.ok(!E.sameListing(L('시정 슬로건 공모', '2026-11-20', '수원시'), L('시정 홍보 슬로건 공모', '2026-11-20', '부산시')), '주최가 다르면 제목이 똑같을 때만');
  assert.ok(!E.sameListing(L('2026 도서관의 날 공모', ''), L('2027 도서관의 날 공모', '')), '마감을 모르면 연도까지 제목이 같을 때만');
  assert.ok(E.sameListing(L('[수원시] 이름 공모', ''), L('수원시 이름 공모', '2026-11-20')));
  assert.ok(!E.sameListing(L('도서관의 날 공모', ''), L('도서관의 날 표어 공모', '2026-11-16')));
  assert.equal(E.methodOf('등기우편'), 'post');
  assert.equal(E.methodOf('https://form.naver.com/response/abc'), 'nform');
  // 폼은 글에 드러난 대로만 부른다 — AI가 form(폼 일반)으로 준 것을 '구글 폼'이라 하지 않는다
  assert.equal(E.formOf('네이버 폼으로 온라인 접수 https://form.naver.com/response/abc'), 'nform');
  assert.equal(E.formOf('네이버 폼 접수 https://naver.me/abc'), 'nform');
  assert.equal(E.formOf('구글폼으로 온라인 접수 https://forms.gle/abc'), 'form');
  assert.equal(E.formOf('접수폼 접수'), 'oform');
  assert.equal(E.fixMethod({ method: 'form', how: '네이버 폼으로 온라인 접수', to: 'https://form.naver.com/response/abc' }).method, 'nform');
  assert.equal(E.fixMethod({ method: 'email', how: '네이버 폼 또는 이메일', to: 'a@b.kr' }).method, 'email');
  assert.equal(E.METHODS.oform, '온라인 폼');
  assert.equal(E.won(150000000), '1.5억원');
  assert.equal(E.day('2026년 12월 5일(금)'), '2026-12-05');
  assert.equal(E.methodStats([{ fit: f[0] }, { fit: f[1] }, { fit: f[1] }]), '구글 폼 2 · 이메일 1');
  const m = k => ({ fit: { target: true, submit: { method: k } } });
  assert.equal(E.methodStats(['form', 'form', 'etc', 'email', 'site', 'post', 'etc'].map(m)), '구글 폼 2 · 이메일 1 · 홈페이지 1 · 기타 3');
});

test('찾은 공모전을 AI 정리로 낼 것·뺀 것으로 나누고, 판정에 개수를 보인다', () => {
  seed([{ key: 'wevity:1', title: '2026 수원 새 브랜드 네이밍 공모전 (~11.20)', deadline: '2026-11-20' }, { key: 'wevity:2', title: '서울 슬로건 공모', deadline: '2026-11-25', organizer: '서울시' },
    { key: 'wevity:3', title: '대학생 영상 공모', deadline: '2026-11-25', organizer: '대학연합' }, { key: 'wevity:4', title: '포스터만 있는 공모', deadline: '2026-11-15', organizer: '포스터청' },
    { key: 'linkareer:9', site: 'linkareer', source: '링커리어', title: '수원특례시 브랜드 이름 공모', deadline: '2026-11-20', organizer: '수원시(시민소통과)' },
    { key: 'wevity:5', title: '수원시 시정 슬로건 공모', deadline: '2026-11-20' }, { key: 'wevity:6', title: '가짜 요강 공모', deadline: '2026-11-28', organizer: '의심청' }]);
  const out = run('sort-out', { keys: ['wevity:1', 'wevity:2', 'wevity:3', 'wevity:4', 'linkareer:9', 'wevity:5', 'wevity:6'], seen: 7, sites: 4, failed: '링커리어',
    fit: { contests: [FIT(0), FIT(1, { eligibility_text: '서울시 거주자', eligible: 'no', eligible_why: '서울 거주만' }), FIT(2, { is_target: false, kinds: ['영상'], target_why: '영상 공모전이에요' }), FIT(3, { unreadable: true, method: 'etc', eligible: 'unsure', deadline: '2026-11-15' }),
      FIT(4, { announce: '' }),   // 다른 사이트에 제목만 달리 올라온 같은 공모전(주최·마감·접수처·작품 같음) — 정보가 적은 쪽을 숨긴다
      FIT(5, { kinds: ['슬로건'], submit_to: 'slogan@suwon.go.kr', ai_rule: 'banned', ai_rule_text: '생성형 AI 활용 작품 제외' }),   // 같은 주최·같은 마감이어도 다른 공모전은 그대로 둔다
      FIT(6, { deadline: '2024-11-28', doubt: '본문이 2024년 공모 글 같아요' })], note: '' } });
  assert.equal(out.verdict.title, '새 공모전 6개를 찾았어요 · 링커리어는 못 읽었어요');
  assert.match(out.verdict.text, /낼 공모전 4 · 조건이 안 맞아 뺀 것 2 · 이미 있던 것 7 · 요강을 못 읽은 것 1개/);
  assert.equal(out.outcome.title, '찾음');

  const open = run('open-list').items;
  assert.deepEqual(open.map(i => i.id), ['wevity:4', 'wevity:1', 'wevity:5', 'wevity:6']);   // 마감 임박순
  const a = open[1];
  const ai = open[2];
  assert.ok(ai.tags.includes('AI 작품 제한'));
  assert.match(ai.detail[0].text, /\nAI · 생성형 AI로만 만든 작품은 안 받아요\n양식 · /);
  const aiAsk = run('submit', { cid: 'wevity:5', draft: '', me: '' });
  assert.deepEqual([aiAsk.findings[0].where, aiAsk.findings[0].tag, aiAsk.findings[0].title], ['응모 규칙', 'AI 작품 제한', '생성형 AI로만 만든 작품은 안 받아요']);
  assert.match(aiAsk.findings[0].text, /^생성형 AI 활용 작품 제외 — /);
  const odd = open[3];
  assert.equal(odd.meta[1], '마감 D-18 · 11월 28일', '마감일은 사이트 값을 믿는다');
  assert.ok(odd.tags.includes('요강 확인'));
  assert.match(odd.detail[0].text, /\n확인 · 본문이 2024년 공모 글 같아요 — 원문을 봐 주세요$/);
  assert.equal(a.title, '2026 수원 새 브랜드 네이밍 공모전');
  assert.deepEqual(a.tags, ['네이밍', '이메일', 'AI 안 없음']);
  assert.deepEqual(a.meta, ['1등 100만원 · 총 200만원', '마감 D-10 · 11월 20일', '발표 12월 5일', '주최 수원시']);
  assert.equal(a.detail[0].who, '요강');
  assert.equal(a.detail[0].text, '낼 것 · 이름 1개 + 뜻풀이 200자 · 1인 2건까지\n조건 · 수원 거주·재직·재학 → 돼요(수원 거주)\n양식 · 신청서(hwp) 첨부 · 저작권은 주최 측');
  assert.deepEqual(a.sort, { deadline: '2026-11-20', prize: 1000000, announce: '2026-12-05' });
  assert.deepEqual(a.vars, { cid: 'wevity:1' });
  assert.deepEqual(open[0].tags, ['네이밍', '방식 확인', 'AI 안 없음', '조건 확인']);
  assert.match(open[0].detail[0].text, /^요강이 그림이라 읽지 못했어요/);

  const out2 = run('out-list').items;
  assert.deepEqual(out2.map(i => [i.id, i.tags[0], i.detail[0].text]), [['wevity:2', '조건 안 맞음', '서울시 거주자 → 서울 거주만'], ['wevity:3', '분야 다름', '영상 공모전이에요']]);

  const find = run('find-list', { sites: 'true,true,true,false' }).items[0];
  assert.equal(find.id, 'find-2026-11-10');   // 한국 10시
  assert.equal(find.title, '11월 10일 찾기');
  assert.deepEqual(find.meta, ['제출 방식 · 이메일 4 · 기타 1', '아직 낸 것 없음', '링커리어 꺼 둠']);
  assert.deepEqual(run('find-list', { sites: 'false,false,false,false' }).items, []);
});

test('제출 준비 — AI 안이 없으면 만들고, 복사할 것·제출처·내 정보를 모으고, 냈어요면 결과 기다리는 쪽으로', () => {
  const p = run('prep', { cid: 'wevity:1' });
  assert.equal(p.need_ai, true);
  assert.match(p._ctx, /1인 응모 건수: 2\n의미 설명 글자 제한: 200자/);
  assert.equal(p.change.value, 'regen');
  const draft = { candidates: [{ kind: '네이밍', text: '수원새빛', read: '', why: '새로운 빛으로 여는 수원' }, { kind: '네이밍', text: 'HWASEONG', read: '화성', why: 'x'.repeat(210) }, { kind: '네이밍', text: '수원온', why: '따뜻한 수원' }], note: '' };
  const me = '이름\t홍길동\n연락처\t010-1234-5678\n이메일\thong@example.com\n주소\t';
  const ask = run('submit', { cid: 'wevity:1', draft, me });
  assert.equal(ask.verdict.title, 'AI 안 3개 · 이메일로 내요');
  assert.equal(ask.verdict.text, '마감 11월 20일 · 1인 2건까지 · 뜻풀이 200자 이내');
  assert.equal(ask.findings[1].title, 'HWASEONG · 화성');
  assert.match(ask.ask.hint, /^냈어요 → .*\n나중에 낼게요 → .*\n안 낼래요 → /);
  assert.equal(ask.ask.question, '냈나요? · 마감 D-10 (11월 20일)');
  const w = ask.findings.map(f => f.where);
  assert.deepEqual(w, ['추천 1', '추천 2', '안 3', '받는 사람', '메일 제목', '메일 본문', '공모전 원문']);   // 메일 접수는 내 정보를 본문에 담아 미리 보인다
  assert.equal(ask.findings[0].copy, '수원새빛\n새로운 빛으로 여는 수원');   // 이메일은 이름 + 뜻풀이
  assert.equal(ask.findings[1].note, '뜻 210/200자 · 줄여야 해요');
  assert.equal(ask.findings[4].copy, '[네이밍 공모] 홍길동_010-1234-5678');
  assert.deepEqual(ask.findings.filter(f => f.private).map(f => f.where), ['메일 제목', '메일 본문']);   // 실행이 끝나면 실행기가 지운다
  assert.match(ask.findings[5].copy, /응모작\n1\. 수원새빛\n   새로운 빛으로 여는 수원\n2\. HWASEONG[\s\S]*이름: 홍길동\n연락처: 010-1234-5678/);
  assert.deepEqual(ask.ask.choices.map(c => c.label), ['냈어요', '나중에 낼게요', '안 낼래요'], '네이버 비밀값이 없으면 메일 보내기는 없다');
  assert.match(ask.ask.hint, /비밀값에 넣으면 여기서 바로 보낼 수 있어요/);

  // 네이버 비밀값이 있으면 [메일 보내기]가 생기고, '확인 없이 보내기'를 켜도 뜻풀이가 글자 제한을 넘으면(안 2: 210/200자) 묻는다
  Object.assign(process.env, { NAVER_ID: 'tester', NAVER_APP_PASSWORD: 'fake-not-real' });
  try {
    // 안이 여러 개여도 먼저 고르라고 묻지 않는다 — AI 추천 안(1인 2건까지)으로 바로 제출 화면. [메일 보내기]에는 확인창이 없다
    const first = run('submit', { cid: 'wevity:1', draft: '', me, auto: 'true' });
    assert.ok(first.ask, '글자 초과면 자동으로 보내지 않는다');
    assert.equal(first.ask.question.startsWith('냈나요?'), true);
    assert.equal(first.verdict.title, '보낼 안 · 수원새빛 · HWASEONG · 이메일로 내요');
    assert.deepEqual(first.ask.choices.map(c => [c.label, c.confirm]), [['메일 보내기', undefined], ['보낼 안 다시 고르기', undefined], ['직접 냈어요', undefined], ['나중에 낼게요', undefined], ['안 낼래요', undefined]]);
    // 고르기는 [보낼 안 다시 고르기](repick)를 눌렀을 때만 — AI 추천 그대로, 하나만, 또는 번호로 여러 개
    const pick = run('submit', { cid: 'wevity:1', draft: '', me, auto: 'true', answer: 'repick' });
    assert.equal(pick.ask.question, '어떤 안을 보낼까요? (2개까지)');
    assert.deepEqual(pick.ask.choices.map(c => [c.value, c.label]), [['pick:0,1', 'AI 추천 2개 · 수원새빛 · HWASEONG'], ['pick:0', '수원새빛만'], ['pick:1', 'HWASEONG만'], ['pick:2', '수원온만']]);
    assert.equal(pick.ask.free, true);
    assert.deepEqual(pick.findings.map(f => f.where), ['안 1', '안 2', '안 3']);
    assert.equal(pick.verdict.title, '메일로 보낼 안을 골라 주세요');
    // 번호로 고르면(1, 3) 그 안으로 메일을 만들어 보인다
    const sel = run('submit', { cid: 'wevity:1', draft: '', me, auto: 'true', answer: '1, 3' });
    assert.deepEqual(sel.ask.choices.map(c => c.label), ['메일 보내기', '보낼 안 다시 고르기', '직접 냈어요', '나중에 낼게요', '안 낼래요']);
    assert.equal(sel.ask.choices[0].confirm, undefined);
    assert.deepEqual(sel.findings.slice(0, 3).map(f => f.where), ['보낼 안 1', '안 2', '보낼 안 3']);
    assert.equal(sel.verdict.title, '보낼 안 · 수원새빛 · 수원온 · 이메일로 내요');
    const body = sel.findings.find(f => f.where === '메일 본문').copy;
    assert.match(body, /1\. 수원새빛[\s\S]*2\. 수원온/); assert.doesNotMatch(body, /HWASEONG/);
    assert.equal(run('submit', { cid: 'wevity:1', draft: '', me, auto: 'false' }).ask.question.startsWith('냈나요?'), true, '고른 뒤에는 다시 묻지 않는다');
    // 다시 고르기 · 잘못된 번호 · 선택지로 고르기
    assert.equal(run('submit', { cid: 'wevity:1', draft: '', me, answer: 'repick' }).ask.question, '어떤 안을 보낼까요? (2개까지)');
    assert.match(run('submit', { cid: 'wevity:1', draft: '', me, answer: '1, 2, 3' }).ask.hint, /^번호를 읽지 못했어요. 1부터 3까지에서 2개까지 골라 주세요/);
    assert.match(run('submit', { cid: 'wevity:1', draft: '', me, answer: '9' }).ask.hint, /^번호를 읽지 못했어요/);
    assert.equal(run('submit', { cid: 'wevity:1', draft: '', me, answer: 'pick:0,1' }).verdict.title, '보낼 안 · 수원새빛 · HWASEONG · 이메일로 내요');
  } finally { delete process.env.NAVER_ID; delete process.env.NAVER_APP_PASSWORD; }
  // 안이 생겼으니 다시 누르면 AI를 건너뛴다
  assert.equal(run('prep', { cid: 'wevity:1' }).need_ai, false);
  assert.equal(run('prep', { cid: 'wevity:1', answer: 'regen' }).need_ai, true);
  assert.deepEqual(run('open-list').items.find(i => i.id === 'wevity:1').detail[1], { who: 'AI 안 3개 · 추천 2', text: '수원새빛 · HWASEONG · 수원온' });

  const yes = run('submit', { cid: 'wevity:1', draft: '', me, answer: 'yes' });
  assert.deepEqual([yes.ask_names, yes.choice, yes.names], [true, 'yes', '수원새빛\nHWASEONG']);
  assert.equal(run('picked', { cid: 'wevity:1', value: yes.names }).ask.value, '수원새빛\nHWASEONG');
  run('picked', { cid: 'wevity:1', value: yes.names, answer: '수원새빛' });
  assert.equal(run('prep', { cid: 'wevity:1' }).change, undefined, '낸 공모전은 AI 안을 다시 만들지 않는다');
  const fin = run('finish', { cid: 'wevity:1', choice: 'yes' });
  assert.equal(fin.verdict.title, '냈어요 · 발표 12월 5일');
  assert.ok(!run('open-list').items.some(i => i.id === 'wevity:1'));
  const sent = run('sent-list').items[0];
  assert.deepEqual(sent.meta, ['발표 D-25 · 12월 5일', '1등 100만원 · 총 200만원', '11월 10일에 냄', '주최 수원시']);
  assert.deepEqual(sent.detail, [{ who: '낸 안', text: '수원새빛' }, { who: '증거', text: '직접 냈다고 적은 것이에요(프로그램이 확인한 증거는 없어요)' }]);   // 프로그램이 낸 게 아니면 증거가 없다고 그대로 적는다(A4·A6)
  assert.match(run('find-list', { sites: 'true,true,true,true' }).items[0].meta[1], /낸 것 1 · 당선 0/);
});

test('나중에·안 낼래요, 빼기·다시 넣기, 결과 적기와 받은 상', () => {
  assert.equal(run('finish', { cid: 'wevity:4', choice: 'later' }).verdict.title, '그대로 둘게요 · 마감 D-5');
  run('submit', { cid: 'wevity:4', draft: '', me: '', answer: 'no' });
  assert.equal(run('out-list').items.find(i => i.id === 'wevity:4').tags[0], '내가 뺌');
  run('force', { cid: 'wevity:4' });
  assert.ok(run('open-list').items.some(i => i.id === 'wevity:4'));
  run('force', { cid: 'wevity:2' });   // AI가 조건으로 뺀 것도 다시 넣을 수 있다
  assert.ok(run('open-list').items.some(i => i.id === 'wevity:2'));
  run('drop', { cid: 'wevity:2' });
  assert.ok(!run('open-list').items.some(i => i.id === 'wevity:2'));

  const r = run('result', { cid: 'wevity:1' });
  assert.equal(r.verdict.title, '발표 12월 5일 · 낸 안 1개');
  assert.deepEqual(r.ask.choices.map(c => c.label), ['당선됐어요', '떨어졌어요', '안 낸 걸로 되돌리기']);
  assert.equal(run('result', { cid: 'wevity:1', answer: 'won' }).won, true);
  const aw = run('award', { cid: 'wevity:1' });
  assert.deepEqual(aw.ask.choices, ['대상 · 100만원', '우수상 · 50만원']);
  assert.equal(aw.verdict.title, '당선 축하해요!');
  assert.equal(run('award', { cid: 'wevity:1', answer: '우수상 · 50만원' }).verdict.title, '축하해요! 우수상 · 50만원');
  assert.deepEqual(run('sent-list').items, []);
  assert.match(run('find-list', { sites: 'true,true,true,true' }).items[0].meta[1], /낸 것 1 · 당선 1/);
  assert.match(run('prep', { cid: 'nope:1' }).error, /찾지 못했어요/);
});

test('메일 계정 시험 — 계정이 없으면 실패를 남기고 목록에 이유가 보인다', () => {
  assert.deepEqual(run('mail-list').items.map(i => [i.id, i.meta[0]]), [['mail-test', '아직 시험하지 않았어요']]);
  const env = { ...process.env }; delete env.NAVER_ID; delete env.NAVER_APP_PASSWORD;
  const r = JSON.parse(execFileSync(process.execPath, [path.join(PLUGIN, 'scripts/contest.mjs'), 'mail-test', `--profile=${profile}`, `--now=${NOW}`], { encoding: 'utf8', env }));
  assert.match(r.error, /애플리케이션 비밀번호가 없어요/);
  const it = run('mail-list').items[0];
  assert.equal(it.meta[0], '11월 10일 실패');
  assert.match(it.detail[0].text, /애플리케이션 비밀번호가 없어요/);
});

test('전에 가져온 기록도 하나로 — 손으로 뺀 중복만 알던 접수 메일을 남긴 쪽에 옮기고, 메일로 보낼 수 있으면 표시한다', () => {
  const fit = more => E.normalizeFit({ contests: [FIT(0, more)] }).contests[0];
  seed([
    { key: 'wevity:10', title: '경남통합복지플랫폼 브랜드 네이밍 공모', organizer: '경상남도', deadline: '2026-11-20', fit: fit({ method: 'etc', submit_to: '', submit_how: '', announce: '' }) },
    { key: 'contestkorea:11', site: 'contestkorea', source: '콘테스트코리아', title: '경상남도 통합복지 플랫폼 네이밍 공모', organizer: '경상남도', deadline: '2026-11-20', dropped: NOW, fit: fit({ submit_to: 'dodud@korea.kr' }) },
    { key: 'wevity:12', title: '2027 KSPO 스포츠가치센터 슬로건 공모전', organizer: '국민체육진흥공단 스포츠가치센터', deadline: '2026-11-25', fit: fit({ method: 'form', submit_to: 'https://forms.gle/a' }) },
    { key: 'linkareer:13', site: 'linkareer', source: '링커리어', title: '스포츠가치센터 슬로건 공모전', organizer: '국민체육진흥공단', deadline: '2026-11-25', fit: fit({ method: 'form', submit_to: 'https://forms.gle/a' }) },
    { key: 'wevity:14', title: '이미 낸 공모', organizer: '수원시', deadline: '2026-11-28', submitted: NOW, fit: fit({}) },
    { key: 'linkareer:15', site: 'linkareer', source: '링커리어', title: '이미 낸 공모', organizer: '수원시', deadline: '2026-11-28', submitted: NOW, fit: fit({}) }]);
  const open = run('open-list').items;
  assert.deepEqual(open.map(i => i.id), ['wevity:10', 'wevity:12']);
  assert.deepEqual(open[0].tags.slice(0, 2), ['네이밍', '이메일'], '뺀 쪽의 접수 메일을 옮겨 왔다');
  assert.deepEqual(run('out-list').items.map(i => i.id), [], '중복이라 뺀 쪽은 뺀 공모전에서도 숨긴다');
  assert.equal(run('sent-list').items.length, 2, '낸 기록은 숨기지 않는다');
  const db = JSON.parse(fs.readFileSync(DB, 'utf8')).contests;
  assert.equal(db['contestkorea:11'].dup_of, 'wevity:10');
  assert.equal(db['wevity:10'].fit.submit.to, 'dodud@korea.kr');
  assert.deepEqual(db['wevity:12'].also.map(a => a.key), ['linkareer:13']);

  // 네이버 계정이 있으면 목록에 '메일로 바로 보내기', 메일 접수가 아닌 공모전의 제출 화면에는 왜 버튼이 없는지
  Object.assign(process.env, { NAVER_ID: 'tester', NAVER_APP_PASSWORD: 'fake-not-real' });
  try {
    assert.deepEqual(run('open-list').items.map(i => i.tags[1]), ['메일로 바로 보내기', '구글 폼']);
    assert.match(run('mail-list').items[0].meta[1], /^메일로 바로 보낼 수 있는 낼 공모전 1개/);
    const ask = run('submit', { cid: 'wevity:12', draft: '', me: '', auto: 'false' }).ask;
    assert.match(ask.hint, /\[메일 보내기\]는 이메일로 받는 공모전에만 나와요 · 이 공모전은 구글 폼 접수예요$/);
    assert.ok(!ask.choices.some(c => c.value === 'mail'));
  } finally { delete process.env.NAVER_ID; delete process.env.NAVER_APP_PASSWORD; }
});

test('접수 방법을 모르던 공모전을 다시 읽히면 접수 방법·발표일만 고치고 판정과 AI 안은 그대로 둔다', () => {
  const fit = more => E.normalizeFit({ contests: [FIT(0, more)] }).contests[0];
  seed([{ key: 'wevity:20', title: '해양과학관 슬로건 공모', organizer: '해양과학관', deadline: '2026-11-20', refit: true, draft: { items: [{ kind: '슬로건', text: '바다를 읽다', read: '', why: '', form: [] }], note: '', at: NOW, made: 'x' },
    fit: fit({ method: 'etc', submit_to: '', announce: '', eligibility_text: '누구나', eligible: 'yes' }) }]);
  assert.equal(E.weak(fit({ method: 'etc', submit_to: '' })), true);
  assert.equal(E.weak(fit({ method: 'form', submit_to: '' })), true);
  assert.equal(E.weak(fit({})), false);
  const out = run('sort-out', { keys: ['wevity:20'], seen: 1, sites: 4, failed: '', fit: { contests: [FIT(0, { submit_to: 'sea@museum.kr', announce: '2026-12-01', eligible: 'no', eligible_why: '달리 읽음' })], note: '' } });
  assert.match(out.verdict.text, /접수 방법을 새로 알아낸 공모전 1개/);
  assert.equal(out.verdict.title, '새 공모전이 없어요');
  const c = JSON.parse(fs.readFileSync(DB, 'utf8')).contests['wevity:20'];
  assert.deepEqual([c.fit.submit.method, c.fit.submit.to, c.fit.announce, c.fit.eligibility.ok, c.refit, !!c.refit_at, c.draft.items[0].text], ['email', 'sea@museum.kr', '2026-12-01', 'yes', undefined, true, '바다를 읽다']);
});

test('내 정보 연동 — 설정에 적은 값은 프로필 데이터(내정보.json)에 옮기고, 설정이 빈 기기에서는 데이터의 값으로 설정을 채운다', () => {
  seed([{ key: 'wevity:90', title: '연동 네이밍 공모', deadline: '2026-11-20', fit: E.normalizeFit({ contests: [FIT(0)] }).contests[0] }]);
  const kept = path.join(profile, '_플러그인/.data/contest-apply/내정보.json');
  let r = run('prep', { cid: 'wevity:90', birth: '1990', gender: '여', home: '서울', work: '', status: '직장인', me: '이름\t김테스트\n연락처\t\n이메일\tkim@example.com' });
  assert.equal(r.settings_patch, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(kept, 'utf8')), { 조건: { birth: '1990', gender: '여', home: '서울', status: '직장인' }, 제출용: { 이름: '김테스트', 이메일: 'kim@example.com' } });
  r = run('prep', { cid: 'wevity:90', birth: '', gender: '', home: '서울', work: '', status: '', me: '이름\t\n연락처\t\n이메일\t' });   // 다른 기기 — 설정이 비어 있다
  assert.deepEqual(r.settings_patch, { birth: '1990', gender: '여', status: '직장인', me: '이름\t김테스트\n이메일\tkim@example.com' });
  assert.equal(run('open-list').settings_patch, undefined, '다른 명령은 설정을 건드리지 않는다');
});

