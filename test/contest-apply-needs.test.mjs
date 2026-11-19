// 공모전 신청 — 사람 손을 덜 타게: 여러 공모전에서 모자란 정보를 '알려 줄 정보'에 모아 한 번만 묻고, 답하면 기다리던 공모전의 version이 바뀌어(reask) 이어 간다.
// 한 번 받은 정보는 내 정보(값은 AI에게 숨김)·고른 답(AI가 봄)·이 공모전 답으로 기억한다. 접수 방법을 모르면 AI가 공고를 읽어 찾는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-contest-needs-')), profile = path.join(T, '개인');
const SCRIPT = new URL('../plugins/contest-apply/scripts/contest.mjs', import.meta.url).pathname;
const STORE = path.join(profile, '_플러그인/.data/contest-apply'), DB = path.join(STORE, 'db.json'), NOW = '2026-11-10T01:00:00.000Z';
fs.mkdirSync(STORE, { recursive: true });
fs.writeFileSync(path.join(profile, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');
after(() => fs.rmSync(T, { recursive: true, force: true }));
const ME = '이름\t김테스트';
const run = (cmd, a = {}) => JSON.parse(execFileSync(process.execPath, [SCRIPT, cmd, `--profile=${profile}`, `--now=${NOW}`, ...Object.entries(a).map(([k, v]) => `--${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)],
  { encoding: 'utf8', env: { ...process.env, PKM_HOME: path.join(T, 'home'), NAVER_ID: '', NAVER_APP_PASSWORD: '' } }));
const db = () => JSON.parse(fs.readFileSync(DB, 'utf8')), put = d => fs.writeFileSync(DB, JSON.stringify(d));
const kept = () => JSON.parse(fs.readFileSync(path.join(STORE, '내정보.json'), 'utf8'));
const FIT = (method, to) => ({ i: 0, unreadable: false, target: true, target_why: '', kinds: ['네이밍'], prize: { text: '', total: 0, first: 0, goods: false, awards: [] }, deadline: '2026-11-20', announce: '', announce_text: '',
  submit: { what: '이름 + 뜻', allow: 1, desc_limit: 0, note: '', fields: [], method, to, how: '', subject: '' }, eligibility: { text: '누구나', ok: 'yes', why: '' }, ai: { rule: 'none', text: '' }, doubt: '' });
const draft = { items: [{ kind: '네이밍', text: '수원새빛', read: '', why: '새 빛', form: [] }], note: '', at: NOW, made: 'm1' };
const plan = { docs: [{ doc: 0, use: 'once', title: '신청서', fills: [{ id: 'b1', text: '{{이름}} {{주소}} {{조합원 여부}} {{작품 의도}}' }], drop: [], hand: false, manual: [] }], extras: [], note: '', made: 'm1' };
const ORG = ['수원시', '안산시', '부천시', '전주시', '청주시', '포항시', '목포시', '여수시'];   // 같은 공모전으로 합쳐지지 않게 주최·제목을 다르게
const TOPIC = ['', '도서관', '공원', '축제', '다리', '시장', '광장', '버스', '카페'];
const contest = (key, more = {}) => ({ key, site: 'wevity', source: '위비티', title: `${ORG[key.split(':')[1] % 8]} ${TOPIC[key.split(':')[1]]} 이름 짓기`, url: `https://www.wevity.com/?c=find&ix=${key.split(':')[1]}`, organizer: ORG[key.split(':')[1] % 8], deadline: '2026-11-20', added: NOW,
  fit: FIT('email', 'a@b.kr'), draft, docs: [{ name: '신청서.hwpx', file: 'x.hwpx', format: 'hwpx' }], plan, ...more });
const verOf = id => run('open-list', { me: ME }).items.find(i => i.id === id).version;

test('여러 공모전의 모자란 정보를 한 줄씩 모으고, 한 번 답하면 기다리던 공모전이 모두 이어 간다', () => {
  put({ contests: { 'wevity:1': contest('wevity:1'), 'wevity:2': contest('wevity:2') } });
  for (const cid of ['wevity:1', 'wevity:2']){
    const r = run('info', { cid, me: ME });
    assert.equal(r.ask.value, '주소: \n조합원 여부: \n작품 의도: ');
    assert.match(r.ask.hint, /주소·조합원 여부는 내 정보로 기억해서 다른 공모전에서는 묻지 않아요/);
  }
  const v1 = verOf('wevity:1');
  let list = run('need-list', { me: ME }).items;
  assert.deepEqual(list.map(i => [i.title, i.tags[0]]), [['주소', '공모전 2개'], ['조합원 여부', '공모전 2개']], '작품 의도는 그 공모전에서만 묻는다');
  assert.deepEqual(list[0].vars, { key: '주소' });

  const ask = run('need-answer', { key: '주소', me: ME });
  assert.match(ask.verdict.title, /주소 — 공모전 2개에 필요해요/);
  assert.equal(ask.ask.free, true);
  const done = run('need-answer', { key: '주소', me: ME, answer: '서울특별시 중구 세종대로 110' });
  assert.deepEqual(done.settings_patch, { full_auto: false }, '값은 싣지 않고 목록만 다시 가져오게 한다');
  assert.doesNotMatch(JSON.stringify(done), /세종대로/);
  assert.equal(kept().제출용.주소, '서울특별시 중구 세종대로 110');
  assert.notEqual(verOf('wevity:1'), v1, 'version이 바뀌어 기다리던 단계가 다시 돈다(reask)');
  assert.deepEqual(run('need-done').forget, ['적기'], '적은 값은 실행 기록에서 지운다');

  run('need-answer', { key: '조합원 여부', me: ME, answer: 'opt:비조합원' });
  assert.deepEqual(kept().답, { '조합원 여부': '비조합원' }, '민감하지 않은 사실은 고른 답으로');
  assert.deepEqual(run('need-list', { me: ME }).items, []);
  const again = run('info', { cid: 'wevity:1', me: ME });   // reask로 다시 돈 '모자란 내용' 단계
  assert.equal(again.ask.value, '작품 의도: ', '이제 이 공모전에만 쓰는 것만 묻는다');
  assert.match(again.ask.hint, /이 공모전에만 쓰는 답이에요/);
});

test('다음 공모전은 기억한 정보로 채우고 묻지 않는다 — 비슷한 이름(거주지 주소)도', () => {
  const p3 = { ...plan, docs: [{ ...plan.docs[0], fills: [{ id: 'b1', text: '{{성명}} {{거주지 주소}} {{조합원 여부}}' }] }] };
  const d = db(); d.contests['wevity:3'] = contest('wevity:3', { plan: p3 }); put(d);
  const r = run('info', { cid: 'wevity:3', me: ME });
  assert.equal(r.summary, '모자란 내용 없음');
  assert.equal(db().contests['wevity:3'].need, undefined);
});

test('내 정보 — 기억한 것을 한 곳에서 보고(값은 첫 글자만) 고치거나 지운다', () => {
  const items = run('me-list', { me: ME }).items;
  const addr = items.find(i => i.title === '주소'), union = items.find(i => i.title === '조합원 여부');
  assert.deepEqual([addr.tags[0], addr.meta[0]], ['내 정보', '서****** (17자)']);
  assert.deepEqual([union.tags[0], union.meta[0]], ['고른 답', '비조합원']);
  assert.equal(items.find(i => i.title === '이름').tags[0], '설정에 적음');
  assert.match(run('me-edit', { key: '이름', me: ME }).verdict.title, /설정에 적혀 있어요/, '설정에 적은 값은 설정에서 고친다');
  assert.equal(run('me-edit', { key: '주소', me: ME }).ask.choices[0].value, 'delete');
  run('me-edit', { key: '주소', me: ME, answer: 'delete' });
  assert.equal(kept().제출용.주소, undefined);
  assert.deepEqual(run('need-list', { me: ME }).items.map(i => [i.title, i.tags[0]]), [['주소', '공모전 1개']], '지우면 아직 기다리는 공모전에서 다시 묻는다');
  run('need-answer', { key: '주소', me: ME, answer: 'skip' });
  assert.ok(db().contests['wevity:2'].skipped.includes('주소'), '알려 주지 않기 — 그 칸은 비워 두고 이어 간다');
  assert.deepEqual(run('need-list', { me: ME }).items, []);
});

test('브라우저 — 고른 답은 AI가 보기를 고르게 보이고, 내 정보는 자리표시로만. 이미 아는 정보뿐이면 묻지 않고 다시 낸다', () => {
  const d = db(); d.contests['wevity:5'] = contest('wevity:5', { fit: FIT('site', 'https://www.example.org/apply'), docs: [], plan: null }); put(d);
  const k = kept(); k.제출용.주소 = '서울특별시 중구'; fs.writeFileSync(path.join(STORE, '내정보.json'), JSON.stringify(k));
  const r = run('submit', { cid: 'wevity:5', me: ME, answer: 'browse' });
  assert.match(r._task, /사용자가 정한 답 — 조합원 여부: 비조합원/);
  assert.doesNotMatch(r._task, /서울특별시/);
  assert.equal(r._browser.vars.주소, '서울특별시 중구');
  const b = run('browsed', { cid: 'wevity:5', me: ME, result: { sent: 'no', reason: '주소 칸', proof: '', did: [], need: [{ name: '주소', question: '주소?', options: [] }] } });
  assert.deepEqual([b.summary, b.again], ['알려 준 정보로 다시 내기', { step: '제출', value: 'browse' }]);
});

test("AI 활용 여부는 AI 안이 있으면 묻지 않고 '활용함'으로, 안이 없으면 지금처럼 묻는다", () => {
  const d = db(); d.contests['wevity:8'] = contest('wevity:8', { fit: FIT('site', 'https://www.example.org/apply'), docs: [], plan: null, draft });
  d.contests['wevity:3'] = contest('wevity:3', { fit: FIT('site', 'https://www.example.org/apply'), docs: [], plan: null }); delete d.contests['wevity:3'].draft; put(d);
  const need = [{ name: 'AI 활용 여부', question: '생성형 AI를 썼나요?', options: ['활용함', '활용하지 않음'] }];
  const b = run('browsed', { cid: 'wevity:8', me: ME, result: { sent: 'no', reason: '칸', proof: '', did: [], need } });
  assert.equal(b.again.step, '제출');
  assert.match(b.summary, /'AI 활용 여부' 칸은 AI 안이라 '활용함'으로/);
  const ans = JSON.parse(fs.readFileSync(fs.readdirSync(path.join(STORE, '답')).map(f => path.join(STORE, '답', f)).find(f => fs.readFileSync(f, 'utf8').includes('AI 활용')), 'utf8'));
  assert.match(ans['AI 활용 여부'], /^활용함 — 생성형 AI\(Claude\)/);
  const n = run('browsed', { cid: 'wevity:3', me: ME, result: { sent: 'no', reason: '칸', proof: '', did: [], need } });
  assert.match(n.ask.question, /접수 양식에 넣을 내용 1개/);
});

test('접수 방법을 모르면 사람에게 원문을 보라고 하지 않고, AI가 공고를 열어 찾고 찾은 길로 다시 준비한다', () => {
  const d = db(); d.contests['wevity:6'] = contest('wevity:6', { fit: FIT('etc', ''), homepage: 'https://www.suwon.go.kr/notice/1', docs: [], plan: null }); put(d);
  let r = run('submit', { cid: 'wevity:6', me: ME });
  assert.equal(r.findings.find(f => f.where === '브라우저로 내기').title, 'AI가 공고를 읽고 접수 방법을 찾아 내요');
  assert.equal(r.findings.some(f => /원문/.test(`${f.title} ${f.text} ${f.where}`)), false);
  r = run('submit', { cid: 'wevity:6', me: ME, answer: 'browse' });
  assert.match(r._task, /^공고 주소: https:\/\/www\.suwon\.go\.kr\/notice\/1 — 접수 방법을 아직 몰라요/);
  assert.ok(r._browser.allow.includes('suwon.go.kr'));
  const b = run('browsed', { cid: 'wevity:6', me: ME, result: { sent: 'no', reason: '이메일 접수', proof: '', did: ['공고를 읽음'], need: [], found: { method: 'email', to: '응모 메일: naming@suwon.go.kr', how: '신청서를 메일로' } } });
  assert.deepEqual(b.again, { step: '제출', value: '' }, '메일 길로 제출 화면을 다시 만든다');
  const c = db().contests['wevity:6'];
  assert.deepEqual([c.fit.submit.method, c.fit.submit.to, !!c.explored], ['email', 'naming@suwon.go.kr', true]);
  assert.equal(run('submit', { cid: 'wevity:6', me: ME }).findings.some(f => f.where === '브라우저로 내기'), false, '한 번 찾았으면 다시 찾으러 가지 않는다');

  const e = db(); e.contests['wevity:7'] = contest('wevity:7', { fit: FIT('etc', ''), docs: [], plan: null }); put(e);
  const n = run('browsed', { cid: 'wevity:7', me: ME, result: { sent: 'no', reason: '폼 접수', proof: '', did: [], need: [], found: { method: 'form', to: 'https://naver.me/abc', how: '네이버 폼' } } });
  assert.deepEqual(n.again, { step: '요강', value: '' }, '폼이면 폼 문항부터 다시 읽는다');
  assert.equal(db().contests['wevity:7'].fit.submit.method, 'nform');
});
