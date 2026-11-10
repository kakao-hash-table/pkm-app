// 공모전 신청 — 주최가 준 양식(.hwpx)을 채우는 흐름: 양식 읽기(papers) → AI 계획 저장·동의 표시·모자란 내용 묻기(info) → 채우기(fill) → 제출 화면(submit).
// 실제 KISA 양식 두 개(국민제안서 양식 모음·개인정보 동의서)로 돌린다. AI 계획은 사람이 쓴 것으로 대신한다. hwpx는 순수 JS라 Java 없이 돈다.
// 내 정보는 AI에게 가지 않고(자리표시로만), 노트 폴더의 기록(db.json)에도 남지 않는지 본다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import * as D from '../plugins/contest-apply/scripts/docs.mjs';
import { FX_DIR, HAS_FX, NO_FX } from './contest-fixtures.mjs';

if (!HAS_FX) test(NO_FX, { skip: true }, () => {});
else {

const PLUGIN = new URL('../plugins/contest-apply/', import.meta.url).pathname;
const FIX = FX_DIR;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-contest-forms-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const HOME = path.join(tmp, 'home'), profile = path.join(tmp, '개인'), STORE = path.join(profile, '_플러그인/.data/contest-apply'), FILES = path.join(STORE, 'files'), DB = path.join(profile, '_플러그인/.data/contest-apply/db.json');
fs.mkdirSync(FILES, { recursive: true }); fs.mkdirSync(path.dirname(DB), { recursive: true });
fs.writeFileSync(path.join(profile, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');
fs.copyFileSync(path.join(FIX, 'form-kisa-proposal.hwpx'), path.join(FILES, 'thinkcontest-1-원본-1.hwpx'));
fs.copyFileSync(path.join(FIX, 'form-kisa-consent.hwpx'), path.join(FILES, 'thinkcontest-1-원본-2.hwpx'));
const run = (cmd, a = {}, env = {}) => JSON.parse(execFileSync(process.execPath, [path.join(PLUGIN, 'scripts/contest.mjs'), cmd, `--profile=${profile}`, '--now=2026-11-10T01:00:00.000Z', ...Object.entries(a).map(([k, v]) => `--${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)],
  { encoding: 'utf8', env: { ...process.env, PKM_HOME: HOME, NAVER_ID: '', NAVER_APP_PASSWORD: '', ...env } }));
const db = () => JSON.parse(fs.readFileSync(DB, 'utf8')).contests['thinkcontest:1'];
const crc = b => { let c = ~0; for (const x of b){ c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]), n = Buffer.alloc(4), c = Buffer.alloc(4); n.writeUInt32BE(d.length); c.writeUInt32BE(crc(b)); return Buffer.concat([n, b, c]); };
const png = () => { const h = Buffer.alloc(13); h.writeUInt32BE(2, 0); h.writeUInt32BE(2, 4); h.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', zlib.deflateSync(Buffer.alloc(2 * 9, 200))), chunk('IEND', Buffer.alloc(0))]); };

const ME = '이름\t김테스트\n연락처\t010-1234-5678\n이메일\tkim@example.com';
const PLAN = { note: '영문 후보는 국문 40자 제한에 안 맞을 수 있어요', docs: [
  { doc: 0, use: 'per_pick', title: '국민제안서', hand: false, manual: ['PDF로도 저장해 1부 더'], drop: ['b4-b6', 'b7', 'b8~9'],   // 범위로도 쓴다
    fills: [{ id: 'b2.r2.c2', text: '{{이름}}' }, { id: 'b2.r2.c4', text: '{{생년월일}}' }, { id: 'b2.r3.c2', text: '{{연락처}}' }, { id: 'b2.r3.c4', text: '{{이메일}}' },
      { id: 'b2.r4.c2', text: '{{작품}}' }, { id: 'b2.r5.c2', text: '{{기획 이유}}' }, { id: 'b2.r6.c2', text: '{{기대효과}}' }] },
  { doc: 1, use: 'once', title: '개인정보 동의서', hand: true, manual: ['인쇄해 자필 서명 후 스캔'], drop: [],
    fills: [{ id: 'b2.r1.c0.p2', text: '동의함 {{동의:☑|☐}}  동의하지 않음 ☐' }, { id: 'b2.r1.c0.p5', text: '{{년}}년 {{월}}월 {{일}}일' }, { id: 'b2.r1.c0.p7', text: '성명 : {{이름}} {{도장}} (서명 또는 인)' }] }],
  extras: [{ cand: 0, values: [{ name: '기획 이유', value: '이유-영' }, { name: '기대효과', value: '효과-영' }] }, { cand: 1, values: [{ name: '기획이유', value: '이유-일' }, { name: '기대효과', value: '효과-일' }] }] };
const fit = { target: true, kinds: ['슬로건'], prize: { text: '', total: 0, first: 0, awards: [] }, deadline: '2026-11-20', announce: '', announce_text: '', doubt: '', unreadable: false, ai: { rule: 'none', text: '' },
  submit: { what: '국민제안서 + 동의서', allow: 1, desc_limit: 0, note: '', fields: [], method: 'email', to: 'idea@kisa.or.kr', how: '제안서와 동의서를 이메일로', subject: '' }, eligibility: { text: '누구나', ok: 'yes', why: '' } };
fs.writeFileSync(DB, JSON.stringify({ contests: { 'thinkcontest:1': { key: 'thinkcontest:1', site: 'thinkcontest', source: '씽굿', title: 'KISA 슬로건 공모', url: 'https://www.thinkcontest.com/x', organizer: '한국인터넷진흥원', deadline: '2026-11-20', added: '2026-11-01', fit,
  draft: { items: [{ kind: '슬로건', text: '안전한 연결, KISA', read: '', why: '뜻-영', form: [] }, { kind: '슬로건', text: '믿음을 잇다', read: '', why: '뜻-일', form: [] }], note: '', at: '2026-11-09', made: 'm1' },
  docs: [{ name: '[붙임2] 국민제안서 양식 모음.hwpx', file: 'thinkcontest-1-원본-1.hwpx', format: 'hwpx' }, { name: '[붙임3] 개인정보 수집·이용 동의서.hwpx', file: 'thinkcontest-1-원본-2.hwpx', format: 'hwpx' }] } } }));
const textOf = async name => (await D.readDoc(path.join(FILES, name))).text;

test('양식 읽기 — 받아 둔 양식을 AI가 볼 글로 만들고(자리마다 id), 계획이 있으면 다시 시키지 않는다', () => {
  assert.match(run('prep', { cid: 'thinkcontest:1' }).summary, /AI 안 2개 있음 · 양식 2개/);
  const p = run('papers', { cid: 'thinkcontest:1', draft: '' });
  assert.equal(p.need_plan, true);
  assert.match(p._docs, /### 문서 0: \[붙임2\] 국민제안서 양식 모음\.hwpx/);
  assert.match(p._docs, /\[b2\.r2\.c2\] 홍길동/);
  assert.match(p._docs, /\[b2\.r1\.c0\.p2\] .*동의함 ☐/);
  assert.match(p._cands, /^\[0\] 안전한 연결, KISA — 뜻-영\n\[1\] 믿음을 잇다/);
  assert.doesNotMatch(p._docs + p._ctx + p._cands, /김테스트|010-1234/, '내 정보는 AI에게 가는 글에 없다');
});

test('모자란 내용 묻기 — 동의 표시는 내가 고르고, 양식에 필요한데 없는 내 정보는 적어서 내 프로필 데이터에 기억한다', () => {
  const a = run('info', { cid: 'thinkcontest:1', plan: PLAN, me: ME });
  assert.equal(a.ask.question, "동의서에 '동의함'으로 표시할까요?");
  assert.deepEqual(a.ask.choices.map(c => c.value), ['consent:yes', 'consent:no']);
  assert.deepEqual(a.findings.map(f => [f.where, f.file]), [['개인정보 동의서', 'thinkcontest-1-원본-2.hwpx']]);
  const b = run('info', { cid: 'thinkcontest:1', plan: '', me: ME, answer: 'consent:yes' });
  assert.equal(b.ask.value, '생년월일: ');
  assert.equal(b.ask.free, true);
  const c = run('info', { cid: 'thinkcontest:1', plan: '', me: ME, answer: '생년월일: 1997. 05. 01.' });
  assert.equal(c.ask, undefined);
  assert.equal(c.settings_patch, undefined, '내 정보를 단계 결과에 싣지 않는다(실행 기록은 동기화된다)');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(STORE, '내정보.json'), 'utf8')), { 조건: {}, 제출용: { 생년월일: '1997. 05. 01.' } });   // 내 프로필 데이터에(다른 기기와 동기화)
  assert.equal(run('info', { cid: 'thinkcontest:1', plan: '', me: ME }).summary, '모자란 내용 없음');
  assert.doesNotMatch(fs.readFileSync(DB, 'utf8'), /1997\. 05|010-1234|김테스트/, '노트 폴더의 기록에는 내 정보가 없다');
});

test('채우기 — 응모작마다 내는 문서와 한 부만 내는 문서를 계획대로 채우고, 안 쓰는 양식은 뺀다', async () => {
  const f = run('fill', { cid: 'thinkcontest:1', me: ME });
  assert.equal(f.summary, '서류 2개');
  assert.deepEqual(f.forget, ['정보']);
  const [prop, cons] = db().filled;
  assert.deepEqual([prop.title, prop.cand, prop.missing, prop.hand], ['국민제안서', '안전한 연결, KISA', [], false]);
  const t = await textOf(prop.file);
  for (const v of ['김테스트', '1997. 05. 01.', '010-1234-5678', 'kim@example.com', '안전한 연결, KISA', '이유-영', '효과-영']) assert.ok(t.includes(v), v);
  assert.doesNotMatch(t, /홍길동|YYYY|캐릭터 부문|국민참여예산 아이디어/, '예시 글과 안 쓰는 양식 2·3은 없다');
  const u = await textOf(cons.file);
  assert.match(u, /동의함 ☑\s+동의하지 않음 ☐/);
  assert.match(u, /2026년 11월 10일/);
  assert.match(u, /성명 : 김테스트\s+\(서명 또는 인\)/);
  assert.deepEqual([cons.hand, cons.stamped, cons.manual], [true, false, ['인쇄해 자필 서명 후 스캔']]);
  assert.ok((await textOf('thinkcontest-1-원본-1.hwpx')).includes('홍길동'), '원본은 그대로');
});

test('제출 화면 — 채운 서류를 미리 보기 파일로 보이고, 메일에는 붙일 수 있는 것만. 안을 바꾸면 서류도 다시 채운다', async () => {
  const off = run('submit', { cid: 'thinkcontest:1', draft: '', me: ME, auto: 'false' });
  assert.match(off.verdict.title, /서류 2개 · 이메일로 내요/);
  const docs = off.findings.filter(f => f.file);
  assert.deepEqual(docs.map(f => f.where), ['국민제안서', '개인정보 동의서']);
  assert.equal(off.findings.find(f => f.where === '서류 메모').text, '영문 후보는 국문 40자 제한에 안 맞을 수 있어요');
  assert.match(docs[0].text, /채웠어요\. 미리 보기로 확인해 주세요\n직접 할 일: PDF로도 저장해 1부 더/);
  assert.match(docs[1].text, /자필 서명이 필요해서 메일에 붙이지 않아요/);

  const env = { NAVER_ID: 'tester', NAVER_APP_PASSWORD: 'fake-not-real' };
  assert.equal(run('submit', { cid: 'thinkcontest:1', draft: '', me: ME, auto: 'true' }, env).ask.question, '어떤 안을 보낼까요?');
  const sel = run('submit', { cid: 'thinkcontest:1', draft: '', me: ME, auto: 'true', answer: 'pick:1' }, env);
  assert.ok(sel.ask.question.startsWith('냈나요?'), '서류에 손으로 할 일이 있으면 확인 없이 보내지 않는다');
  const at = sel.findings.find(f => f.where === '메일에 붙일 파일');
  assert.equal(at.title, '1개');
  assert.match(at.text, /^국민제안서_믿음을 잇다\.hwpx\n/);
  assert.match(at.copy, /thinkcontest-1-보탤 파일$/);
  assert.match(sel.ask.choices[0].confirm, /첨부 1개\(국민제안서_믿음을 잇다\.hwpx\)/);
  const t = await textOf(db().filled[0].file);
  assert.ok(t.includes('믿음을 잇다') && t.includes('이유-일') && !t.includes('이유-영'), '고른 안으로 다시 채운다');

  // 도장.png를 두면 서명 자리에 넣고, 그 문서도 붙인다(자필 서명을 요구한다는 말은 남긴다). 보탤 파일 폴더의 파일도 함께
  fs.writeFileSync(path.join(FILES, '도장.png'), png());
  fs.writeFileSync(path.join(FILES, 'thinkcontest-1-보탤 파일', '제안서.pdf'), 'pdf');
  const st = run('submit', { cid: 'thinkcontest:1', draft: '', me: ME, auto: 'false', answer: 'pick:1' }, env);
  assert.equal(st.findings.find(f => f.where === '메일에 붙일 파일').title, '3개');
  assert.match(st.findings.find(f => f.where === '개인정보 동의서').text, /도장 이미지를 넣었어요\. 이 문서는 자필 서명 후 스캔을 요구하니/);
  assert.equal(db().filled[1].stamped, true);
  assert.match(st.findings.find(f => f.where === '메일 본문').copy, /첨부: 국민제안서_믿음을 잇다\.hwpx, 개인정보 동의서\.hwpx, 제안서\.pdf/);
});

test('동의 표시를 하지 않기로 하면 동의 칸은 비워 둔다', async () => {
  run('info', { cid: 'thinkcontest:1', plan: PLAN, me: ME });   // 계획을 다시 받으면 처음부터
  const c = JSON.parse(fs.readFileSync(DB, 'utf8')); delete c.contests['thinkcontest:1'].consent; fs.writeFileSync(DB, JSON.stringify(c));
  run('info', { cid: 'thinkcontest:1', plan: '', me: ME, answer: 'consent:no' });
  run('fill', { cid: 'thinkcontest:1', me: ME });
  assert.match(await textOf(db().filled[1].file), /동의함 ☐\s+동의하지 않음 ☐/);
});
}
