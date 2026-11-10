// 공모전 신청서 .hwp 읽기·채우기(plugins/contest-apply/scripts/hwp.mjs) — Java와 hwplib jar가 이미 있을 때만 돈다(네트워크로 받지 않는다).
// form-sample.hwp는 hwplib로 만든 '성명 | 빈칸' 꼴 표, form-contestkorea.hwp는 실제 공모전 신청서(질문 칸 안 ____ 자리)다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as H from '../plugins/contest-apply/scripts/hwp.mjs';
import { FX_DIR, HAS_FX, NO_FX } from './contest-fixtures.mjs';

if (!HAS_FX) test(NO_FX, { skip: true }, () => {});
else {

const FIX = FX_DIR;
const SAMPLE = path.join(FIX, 'form-sample.hwp'), REAL = path.join(FIX, 'form-contestkorea.hwp');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-hwp-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const JAR = path.join(process.env.PKM_HOME || path.join(os.homedir(), '.pkm-app'), 'lib', 'hwplib-1.1.11.jar');
const why = await H.javaVersion().then(() => fs.existsSync(JAR) ? '' : 'hwplib jar가 아직 없어요(처음 쓸 때 받음)', e => e.message);
const needLib = t => { if (why) t.skip(why); return !why; };
const NOT_HWP = /이 양식은 \.hwp가 아니라 직접 채워야 해요/;

test('.hwpx·.docx·.pdf와 이름만 .hwp인 zip은 직접 채우라고 하고, 깨진 파일은 다시 받으라고 한다', async () => {
  for (const f of ['신청서.hwpx', '신청서.docx', '신청서.pdf']) await assert.rejects(H.readForm(path.join(tmp, f)), NOT_HWP);
  await assert.rejects(H.fillForm(path.join(tmp, 'a.docx'), path.join(tmp, 'b.hwp'), {}), NOT_HWP);
  const hwpx = fs.readdirSync(FIX).find(f => f.endsWith('.hwpx'));
  if (hwpx) await assert.rejects(H.readForm(path.join(FIX, hwpx)), NOT_HWP);
  fs.writeFileSync(path.join(tmp, 'zip.hwp'), Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(60)]));
  await assert.rejects(H.readForm(path.join(tmp, 'zip.hwp')), NOT_HWP);
  fs.writeFileSync(path.join(tmp, 'broken.hwp'), 'not a hwp file at all, just text');
  await assert.rejects(H.readForm(path.join(tmp, 'broken.hwp')), /깨졌을 수 있으니/);
  await assert.rejects(H.readForm(path.join(tmp, 'none.hwp')), /찾지 못했어요/);
});

test('readForm — 라벨 칸 오른쪽(없으면 아래) 빈칸을 찾고, 라벨은 공백·콜론·괄호를 정리한다', async t => {
  if (!needLib(t)) return;
  const r = await H.readForm(SAMPLE);
  assert.match(r.text, /^2026 우리 동네 이름 짓기 공모전 참가 신청서\n\[표 1\]\n구분 \| 내용\n성    명 \| \n/);
  assert.match(r.text, /위와 같이 공모전에 응모합니다\./);
  assert.deepEqual(r.tables[0].rows[1], [{ text: '성    명', row: 1, col: 0, rowSpan: 1, colSpan: 1 }, { text: '', row: 1, col: 1, rowSpan: 1, colSpan: 1 }]);
  assert.deepEqual(r.fields, [
    { label: '성명', table: 0, row: 1, col: 1 }, { label: '연락처', table: 0, row: 2, col: 1 }, { label: '이메일', table: 0, row: 3, col: 1 },
    { label: '작품명', table: 0, row: 4, col: 1 }, { label: '작품 설명', table: 0, row: 5, col: 1 }, { label: '제안 이유', table: 0, row: 7, col: 0 }]);   // '구분 | 내용'은 칸이 차 있어 빠진다
});

test('fillForm — 값을 넣어 .hwp로 저장하고, 다시 읽으면 들어 있다. 안 채운 라벨은 missing, 모르는 라벨은 unknown', async t => {
  if (!needLib(t)) return;
  const out = path.join(tmp, '채움', '신청서.hwp'), before = fs.readFileSync(SAMPLE);
  const r = await H.fillForm(SAMPLE, out, { '성 명': '홍길동', 연락처: '010-1234-5678', 작품명: '새빛마루', '작품 설명': '새 빛이 모이는 마루.\n둘째 줄', '제안 이유': '  ', 없는칸: 'x' });
  assert.deepEqual(r, { filled: ['성명', '연락처', '작품명', '작품 설명'], missing: ['이메일', '제안 이유'], unknown: ['없는칸'] });
  assert.deepEqual(fs.readFileSync(SAMPLE), before, '원본은 그대로');
  const back = await H.readForm(out), cell = (row, col) => back.tables[0].rows.flat().find(c => c.row === row && c.col === col).text;
  assert.equal(cell(1, 1), '홍길동');
  assert.equal(cell(2, 1), '010-1234-5678');
  assert.equal(cell(4, 1), '새빛마루');
  assert.equal(cell(5, 1), '새 빛이 모이는 마루.\n둘째 줄');   // 여러 줄 값은 문단 둘
  assert.equal(cell(4, 0), '작품명(국문)');
  assert.deepEqual(back.fields.map(f => f.label), ['이메일', '제안 이유']);
  assert.equal(fs.readdirSync(path.dirname(out)).length, 1, '임시 파일이 남지 않는다');

  const none = await H.fillForm(SAMPLE, path.join(tmp, '빈.hwp'), {});
  assert.deepEqual(none.filled, []);
  assert.equal(none.missing.length, 6);
  await assert.rejects(H.fillForm(SAMPLE, path.join(tmp, '신청서.hwpx'), { 성명: 'a' }), /\.hwp 이름으로 저장/);
});

test('실제 신청서 — 질문 칸 안 ____ 자리를 질문 첫 줄 라벨로 찾고 채운다', async t => {
  if (!needLib(t)) return;
  if (!fs.existsSync(REAL)) return t.skip('form-contestkorea.hwp가 없어요');
  const r = await H.readForm(REAL);
  assert.ok(r.text.length > 1000 && r.text.length <= 20000);
  const label = n => r.fields.find(f => f.label.startsWith(n)).label;
  assert.equal(label('2-1.'), '2-1. 응모자 성명을 입력해 주시기 바랍니다.');
  assert.ok(label('5-1.') && label('5-2.'));
  const out = path.join(tmp, '도서관.hwp');
  const f = await H.fillForm(REAL, out, { [label('2-1.')]: '홍길동', [label('5-2.')]: '첫 줄\n둘째 줄' });
  assert.deepEqual(f.filled, [label('2-1.'), label('5-2.')]);
  const back = await H.readForm(out), text = i => back.tables[i].rows[0][0].text;
  assert.equal(text(2), '2-1. 응모자 성명을 입력해 주시기 바랍니다.\n홍길동');
  assert.match(text(11), /작성해주시기 바랍니다\.\n첫 줄\n둘째 줄$/);
  assert.equal(back.fields.length, r.fields.length - 2);
});

test('암호가 걸린 HWP는 사람이 읽을 오류로 알린다', async t => {
  if (!needLib(t)) return;
  const b = fs.readFileSync(SAMPLE), i = b.indexOf('HWP Document File');
  b[i + 36] |= 2;   // FileHeader 속성의 '암호 설정' 비트
  fs.writeFileSync(path.join(tmp, 'pw.hwp'), b);
  await assert.rejects(H.readForm(path.join(tmp, 'pw.hwp')), /암호가 걸린 HWP라 열 수 없어요/);
});
}
