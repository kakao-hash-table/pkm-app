// 공모전 양식 문서 읽기·고치기(plugins/contest-apply/scripts/docs.mjs) — .hwpx는 늘 돌고, .hwp는 Java와 hwplib jar가 이미 있을 때만 돈다(네트워크로 받지 않는다).
// fixture: form-kisa-proposal.hwpx(양식 3개, 값 칸에 안내 글) · form-kisa-consent.hwpx(동의·날짜·서명 문단) · form-thinkcontest.hwpx(표 15개) · form-sample.hwp · form-contestkorea.hwp
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import * as D from '../plugins/contest-apply/scripts/docs.mjs';
import * as H from '../plugins/contest-apply/scripts/hwp.mjs';
import { FX_DIR, HAS_FX, NO_FX } from './contest-fixtures.mjs';

if (!HAS_FX) test(NO_FX, { skip: true }, () => {});
else {

const FIX = FX_DIR;
const fix = name => path.join(FIX, name);
const PROPOSAL = fix('form-kisa-proposal.hwpx'), CONSENT = fix('form-kisa-consent.hwpx'), THINK = fix('form-thinkcontest.hwpx');
const SAMPLE = fix('form-sample.hwp'), REAL = fix('form-contestkorea.hwp');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-docs-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const JAR = path.join(process.env.PKM_HOME || path.join(os.homedir(), '.pkm-app'), 'lib', 'hwplib-1.1.11.jar');
const why = await H.javaVersion().then(() => fs.existsSync(JAR) ? '' : 'hwplib jar가 아직 없어요(처음 쓸 때 받음)', e => e.message);
const needLib = t => { if (why) t.skip(why); return !why; };

/* ---------- 도우미 ---------- */
const cells = doc => doc.blocks.flatMap(b => b.kind === 'table' ? b.rows.flat() : []);
const cell = (doc, id) => cells(doc).find(c => c.id === id);
// 글이 label인 칸의 바로 오른쪽 칸(n번째 것)
const rightOf = (doc, label, n = 0) => {
  const t = doc.blocks.filter(b => b.kind === 'table' && b.rows.flat().some(c => c.text === label))[n], l = t.rows.flat().find(c => c.text === label);
  return t.rows.flat().find(c => c.row === l.row && c.col === l.col + l.colSpan);
};
// id → 글(맨 위 문단, 칸, 칸 안 문단 모두)
const texts = doc => new Map(doc.blocks.flatMap(b => b.kind === 'para' ? [[b.id, b.text]] : b.rows.flat().flatMap(c => [[c.id, c.text], ...c.paras.map(p => [p.id, p.text])])));
// except로 시작하는 id만 빼고 나머지 글이 그대로인지
function sameExcept(before, after, except){
  const skip = id => except.some(x => id === x || id.startsWith(`${x}.`) || x.startsWith(`${id}.`));
  for (const [id, t] of texts(before)) if (!skip(id)) assert.equal(texts(after).get(id), t, `${id}의 글은 그대로`);
}
const CRC = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const x of buf) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// zip을 직접 다시 읽는다: 중앙 디렉터리와 각 항목 머리가 맞고, 풀면 크기·CRC가 맞아야 한다
function readZip(file){
  const b = fs.readFileSync(file), end = b.lastIndexOf(Buffer.from('504b0506', 'hex')), out = [];
  assert.ok(end >= 0, 'zip 끝 기록이 있다');
  assert.equal(end + 22 + b.readUInt16LE(end + 20), b.length, 'zip 끝 기록 뒤에 남는 바이트가 없다');
  let p = b.readUInt32LE(end + 16);
  assert.equal(p + b.readUInt32LE(end + 12), end, '중앙 디렉터리가 끝 기록 바로 앞에 있다');
  for (let i = 0; i < b.readUInt16LE(end + 10); i++){
    assert.equal(b.readUInt32LE(p), 0x02014b50);
    const n = b.readUInt16LE(p + 28), name = b.subarray(p + 46, p + 46 + n).toString(), method = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), size = b.readUInt32LE(p + 20), full = b.readUInt32LE(p + 24), off = b.readUInt32LE(p + 42);
    assert.equal(b.readUInt32LE(off), 0x04034b50, `${name}: 항목 머리`);
    assert.equal(b.readUInt16LE(off + 6) & 8, 0, `${name}: 크기가 머리에 적혀 있다`);
    assert.deepEqual([b.readUInt16LE(off + 8), b.readUInt32LE(off + 14), b.readUInt32LE(off + 18), b.readUInt32LE(off + 22)], [method, crc, size, full], `${name}: 머리와 중앙 디렉터리가 같다`);
    assert.equal(b.subarray(off + 30, off + 30 + b.readUInt16LE(off + 26)).toString(), name);
    const at = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28), raw = b.subarray(at, at + size), data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.ok(method === 0 || method === 8, `${name}: 저장 또는 deflate`);
    assert.equal(data.length, full, `${name}: 크기`);
    assert.equal(crc32(data), crc, `${name}: CRC`);
    out.push({ name, method, raw, data });
    p += 46 + n + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  assert.deepEqual([out[0].name, out[0].method, out[0].data.toString()], ['mimetype', 0, 'application/hwp+zip'], 'mimetype이 첫 항목·무압축');
  return out;
}
const entry = (zip, name) => zip.find(e => e.name === name);
const section = file => entry(readZip(file), 'Contents/section0.xml').data.toString();
// 2×2 PNG
function tinyPng(){
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), b = Buffer.alloc(8 + body.length); b.writeUInt32BE(data.length, 0); body.copy(b, 4); b.writeUInt32BE(crc32(body), 4 + body.length); return b; };
  const head = Buffer.alloc(13); head.writeUInt32BE(2, 0); head.writeUInt32BE(2, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 200, 0, 0, 200, 0, 0, 0, 200, 0, 0, 200, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
}
const STAMP = path.join(tmp, '도장.png');
fs.writeFileSync(STAMP, tinyPng());

/* ---------- 읽기(hwpx) ---------- */
test('readDoc(hwpx) — 표·문단을 블록으로 읽고, id는 다시 읽어도 같다', async () => {
  const doc = await D.readDoc(PROPOSAL);
  assert.equal(doc.format, 'hwpx');
  assert.deepEqual(doc.blocks.map(b => b.kind), ['para', 'table', 'table', 'para', 'table', 'table', 'para', 'table', 'table', 'para']);   // 양식 3개: 제목 표 + 본문 표 + 안내 문단
  assert.deepEqual(doc.blocks.map(b => b.id), [...Array(10)].map((_, i) => `b${i}`));
  assert.deepEqual(await D.readDoc(PROPOSAL), doc);
  const name = rightOf(doc, '성  명');
  assert.deepEqual({ ...name }, { id: 'b2.r2.c2', row: 2, col: 2, rowSpan: 1, colSpan: 1, text: '홍길동', paras: [{ id: 'b2.r2.c2.p0', text: '홍길동' }] });
  assert.equal(rightOf(doc, '생년월일').text, 'YYYY. MM. DD.');
  assert.equal(rightOf(doc, '성  명', 1).id, 'b5.r2.c2');
  assert.deepEqual([cell(doc, 'b2.r2.c0').rowSpan, cell(doc, 'b2.r0.c0').colSpan], [2, 5]);   // 병합 칸
  assert.equal(cell(doc, 'b2.r5.c2').text, '슬로건 기획 취지 및 배경 등 간단히 서술');
  assert.deepEqual(cell(doc, 'b2.r4.c0').paras.map(p => p.text), ['슬로건*', '글자 수, 국문 40자 이내(공백 미포함)']);
  assert.equal(doc.blocks[3].text, '  ※ (작성) 필수(*), (분량) A4 2장 이내(HWP 1부, PDF 1부), (제출) idea@kisa.or.kr');   // 런 7개가 한 문단 글로
  assert.deepEqual({ ...doc.blocks[0] }, { id: 'b0', kind: 'para', text: '', fixed: true });   // 구역 설정·머리말이 든 첫 문단
  assert.match(doc.text, /^\[표 1\]\n양식1 \|  \| 국민제안서 양식\(슬로건 부문\)\n\[표 2\]\n모두의 KISA 국민제안서\n/);
  assert.match(doc.text, /\n인적 사항\* \| 성 명 \| 홍길동 \| 생년월일 \| YYYY\. MM\. DD\.\n/);
  assert.ok(doc.text.length <= 20000);
});

test('readDoc(hwpx) — 동의서의 동의·날짜·성명 문단, 표 15개짜리 신청서', async () => {
  const doc = await D.readDoc(CONSENT), paras = cells(doc).flatMap(c => c.paras), find = s => paras.find(p => p.text.includes(s));
  assert.equal(find('동의함 ☐').id, 'b2.r1.c0.p2');
  assert.equal(find('동의함 ☐').text.trim(), '동의함 ☐  동의하지 않음 ☐');
  assert.deepEqual({ ...find('2026년') }, { id: 'b2.r1.c0.p5', text: '2026년       월       일' });
  assert.deepEqual({ ...find('성명 :') }, { id: 'b2.r1.c0.p7', text: '성명 :                    (서명 또는 인)' });

  const think = await D.readDoc(THINK), tables = think.blocks.filter(b => b.kind === 'table');
  assert.equal(tables.length, 15);
  assert.equal(think.blocks[0].kind, 'table');   // 구역 설정이 든 첫 문단에 표가 같이 있다
  assert.equal(rightOf(think, '성명').text, '');
  assert.ok(cells(think).some(c => c.text === '□ 활용함 □ 활용하지 않음'));
  assert.equal(think.blocks.find(b => b.kind === 'para' && b.text.includes('참가자 성명:')).id, 'b6');
  assert.match(think.text, /\[표 15\]/);
});

/* ---------- 고치기(hwpx) ---------- */
test('writeDoc(hwpx) — 칸·문단 글을 바꾸면 다시 읽을 때 들어 있고, 다른 글과 원본은 그대로다', async () => {
  const out = path.join(tmp, '채움', '제안서.hwpx'), before = fs.readFileSync(PROPOSAL), doc = await D.readDoc(PROPOSAL);
  const reason = '첫 줄이에요.\n둘째 줄 <태그> & "기호"\n\n넷째 줄';
  const r = await D.writeDoc(PROPOSAL, out, { set: { 'b2.r2.c2': '김테스트', 'b2.r2.c4': '1990. 01. 02.', 'b2.r5.c2': reason, 'b2.r4.c0.p1': '글자 수 12자',
    b2: '표 전체', b0: '첫 문단', 'b2.r9.c9': '없는 칸', 'b3.r0.c0': '문단인데 칸', 이상한id: 'x', 'b2.r6.c2': null } });
  assert.deepEqual(r.applied, ['b2.r2.c2', 'b2.r2.c4', 'b2.r5.c2', 'b2.r4.c0.p1']);
  assert.deepEqual(Object.fromEntries(r.skipped.map(s => [s.id, s.why])), { b2: '표 전체는 글로 바꿀 수 없어요. 칸 id를 써 주세요', b0: '표·그림 같은 개체가 든 문단이라 바꾸지 않았어요',
    'b2.r9.c9': '그런 자리가 없어요', 'b3.r0.c0': '그런 자리가 없어요', 이상한id: '그런 자리가 없어요', 'b2.r6.c2': '넣을 글이 없어요' });
  assert.deepEqual(fs.readFileSync(PROPOSAL), before, '원본은 그대로');
  assert.deepEqual(fs.readdirSync(path.dirname(out)), ['제안서.hwpx'], '임시 파일이 남지 않는다');

  const back = await D.readDoc(out);
  assert.equal(cell(back, 'b2.r2.c2').text, '김테스트');
  assert.equal(cell(back, 'b2.r2.c4').text, '1990. 01. 02.');
  assert.deepEqual(cell(back, 'b2.r5.c2').paras.map(p => p.text), reason.split('\n'));   // 줄마다 문단 하나, 빈 줄도
  assert.deepEqual(cell(back, 'b2.r4.c0').paras.map(p => p.text), ['슬로건*', '글자 수 12자']);
  sameExcept(doc, back, ['b2.r2.c2', 'b2.r2.c4', 'b2.r5.c2', 'b2.r4.c0']);
  assert.equal(rightOf(back, '성  명', 1).text, '홍길동');   // 양식2의 같은 칸은 안 바뀐다

  // 유효한 zip이고, 바꾸지 않은 항목은 압축된 바이트까지 그대로다
  const zip = readZip(out), orig = readZip(PROPOSAL);
  assert.deepEqual(zip.map(e => e.name).sort(), orig.map(e => e.name).sort());
  for (const e of orig) if (!/section0\.xml$|PrvText\.txt$/.test(e.name)) assert.deepEqual(entry(zip, e.name).raw, e.raw, `${e.name}은 그대로`);
  const xml = entry(zip, 'Contents/section0.xml').data.toString(), old = entry(orig, 'Contents/section0.xml').data.toString();
  assert.ok(xml.includes('<hp:run charPrIDRef="21"><hp:t>김테스트</hp:t></hp:run></hp:p>'), '원래 글자 모양으로, 줄 배치 없이');
  assert.ok(xml.includes('<hp:t>둘째 줄 &lt;태그&gt; &amp; "기호"</hp:t>'));
  const upTo = old.indexOf('<hp:t>홍길동</hp:t>') - 200;
  assert.ok(xml.slice(0, upTo) === old.slice(0, upTo), '바꾼 자리 앞의 XML은 한 글자도 안 바뀐다');
  assert.match(entry(zip, 'Preview/PrvText.txt').data.toString(), /<성 {2}명><김테스트>/);
});

test('writeDoc(hwpx) — 동의서 문단을 바꾸고, 바꿀 것이 없으면 그대로 복사한다', async () => {
  const out = path.join(tmp, '동의서.hwpx'), doc = await D.readDoc(CONSENT);
  const set = { 'b2.r1.c0.p2': '                                           동의함 ☑  동의하지 않음 ☐', 'b2.r1.c0.p5': '2026년 11월 10일', 'b2.r1.c0.p7': '성명 : 김테스트 (서명 또는 인)' };
  assert.deepEqual(await D.writeDoc(CONSENT, out, { set }), { applied: Object.keys(set), skipped: [] });
  const back = await D.readDoc(out);
  for (const [id, v] of Object.entries(set)) assert.equal(texts(back).get(id), v);
  sameExcept(doc, back, ['b2.r1.c0']);
  assert.deepEqual(cell(back, 'b2.r1.c0').paras.map(p => p.text).filter((_, i) => ![2, 5, 7].includes(i)), cell(doc, 'b2.r1.c0').paras.map(p => p.text).filter((_, i) => ![2, 5, 7].includes(i)));
  assert.ok(section(out).includes('<hp:run charPrIDRef="35"><hp:t>                                           동의함 ☑'), '빈칸 말고 첫 글자의 글자 모양을 쓴다');

  const copy = path.join(tmp, '그대로.hwpx');
  assert.deepEqual(await D.writeDoc(CONSENT, copy, {}), { applied: [], skipped: [] });
  assert.deepEqual(fs.readFileSync(copy), fs.readFileSync(CONSENT));
  // 칸 전체와 그 칸의 문단을 같이 주면 칸이 이긴다
  const both = await D.writeDoc(CONSENT, copy, { set: { 'b2.r1.c0.p5': '날짜', 'b2.r1.c0': '칸 전체\n둘째 문단' } });
  assert.deepEqual(both, { applied: ['b2.r1.c0'], skipped: [{ id: 'b2.r1.c0.p5', why: '칸 전체를 바꿔서 이 문단은 따로 바꾸지 않았어요' }] });
  assert.deepEqual(cell(await D.readDoc(copy), 'b2.r1.c0').paras.map(p => p.text), ['칸 전체', '둘째 문단']);
});

test('writeDoc(hwpx) — drop으로 안 쓰는 양식 블록을 지운다. 구역 설정이 든 첫 문단은 남긴다', async () => {
  const out = path.join(tmp, '양식1만.hwpx');
  const r = await D.writeDoc(PROPOSAL, out, { drop: ['b0', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b42'], set: { 'b5.r2.c2': '지워질 칸', 'b2.r2.c2': '김테스트' } });
  assert.deepEqual(r.applied, ['b2.r2.c2', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9']);
  assert.deepEqual(r.skipped, [{ id: 'b42', why: '그런 자리가 없어요' }, { id: 'b0', why: '구역 설정이 든 첫 문단이라 지우지 않았어요' }, { id: 'b5.r2.c2', why: '지우는 블록 안이라 바꾸지 않았어요' }]);
  const back = await D.readDoc(out);
  assert.deepEqual(back.blocks.map(b => b.kind), ['para', 'table', 'table', 'para']);
  assert.match(back.text, /양식1/);
  assert.match(back.text, /슬로건 부문/);
  assert.doesNotMatch(back.text, /양식2|양식3|캐릭터|국민참여예산/);
  assert.equal(cell(back, 'b2.r2.c2').text, '김테스트');
  readZip(out);

  // 앞 양식을 지우면, 쪽 나눔으로 시작하던 다음 양식이 빈 첫 쪽 없이 맨 앞에 온다
  const out2 = path.join(tmp, '양식2부터.hwpx'), breaks = x => x.match(/<hp:p [^>]*pageBreak="1"/g).length;
  assert.deepEqual((await D.writeDoc(PROPOSAL, out2, { drop: ['b1', 'b2', 'b3'] })).applied, ['b1', 'b2', 'b3']);
  assert.deepEqual([breaks(section(PROPOSAL)), breaks(section(out2))], [2, 1]);
  assert.match((await D.readDoc(out2)).text, /^\[표 1\]\n양식2/);

  // 구역 설정과 같은 문단에 든 표는 표만 빼고, 표 둘이 든 문단은 둘 다 지워야 문단째 없어진다
  const out3 = path.join(tmp, '신청서.hwpx'), think = await D.readDoc(THINK);
  assert.deepEqual(await D.writeDoc(THINK, out3, { drop: ['b0', 'b38'] }), { applied: ['b0', 'b38'], skipped: [] });
  const back3 = await D.readDoc(out3);
  assert.deepEqual({ ...back3.blocks[0] }, { id: 'b0', kind: 'para', text: '', fixed: true });
  assert.equal(back3.blocks.filter(b => b.kind === 'table').length, 13);
  assert.equal(back3.blocks.length, think.blocks.length - 1);
  assert.ok(section(out3).includes('<hp:secPr '));
});

test('writeDoc(hwpx) — [[img:이름]] 자리에 PNG를 글자처럼 넣는다', async () => {
  const out = path.join(tmp, '도장.hwpx'), doc = await D.readDoc(CONSENT);
  const r = await D.writeDoc(CONSENT, out, { set: { 'b2.r1.c0.p7': '성명 : 홍길동 [[img:도장]] [[img:없는그림]]', b3: '끝 [[img:깨진그림]]' },
    images: { 도장: { file: STAMP, mm: 14 }, 깨진그림: { file: path.join(tmp, '없음.png') } } });
  assert.deepEqual(r, { applied: ['b2.r1.c0.p7', 'b3'], skipped: [{ id: 'b2.r1.c0.p7', why: '그림 없음' }, { id: 'b3', why: '그림 파일을 읽지 못했어요(PNG만 넣을 수 있어요)' }] });
  const zip = readZip(out), orig = readZip(CONSENT), bin = z => z.filter(e => e.name.startsWith('BinData/')).map(e => e.name);
  assert.deepEqual(bin(orig), ['BinData/image1.bmp', 'BinData/image2.png']);
  assert.deepEqual(bin(zip).sort(), ['BinData/image1.bmp', 'BinData/image2.png', 'BinData/image3.png']);
  assert.deepEqual(entry(zip, 'BinData/image3.png').data, fs.readFileSync(STAMP));
  const hpf = entry(zip, 'Contents/content.hpf').data.toString();
  assert.ok(hpf.includes('<opf:item id="image2" href="BinData/image2.png" media-type="image/png" isEmbeded="1"/><opf:item id="image3" href="BinData/image3.png" media-type="image/png" isEmbeded="1"/>'));
  // 그 문단 안에 새 그림을 가리키는 pic이 글자처럼 취급으로, 14mm(3969 HWPUNIT) 정사각으로 들어 있다
  const xml = entry(zip, 'Contents/section0.xml').data.toString(), at = xml.indexOf('<hp:t>성명 : 홍길동 </hp:t><hp:pic '), para = xml.slice(at, xml.indexOf('</hp:p>', at));
  assert.ok(at > 0);
  assert.match(para, /<hc:img binaryItemIDRef="image3" /);
  assert.match(para, /<hp:sz width="3969" widthRelTo="ABSOLUTE" height="3969" heightRelTo="ABSOLUTE" protect="0"\/><hp:pos treatAsChar="1" /);
  assert.equal(xml.match(/<hp:pic /g).length, section(CONSENT).match(/<hp:pic /g).length + 1);
  assert.equal(new Set(xml.match(/<hp:pic id="\d+"/g)).size, xml.match(/<hp:pic /g).length, '개체 id가 겹치지 않는다');
  const back = await D.readDoc(out), p = cell(back, 'b2.r1.c0').paras[7];
  assert.deepEqual({ ...p }, { id: 'b2.r1.c0.p7', text: '성명 : 홍길동 ', fixed: true });   // 글은 그대로 읽히고, 그림이 들어 다시 바꾸지는 않는다
  assert.equal(back.blocks[3].text, '끝');
  sameExcept(doc, back, ['b2.r1.c0.p7', 'b2.r1.c0', 'b2', 'b3']);
  assert.deepEqual(cell(back, 'b2.r1.c0').paras.slice(0, 7).map(q => q.text), cell(doc, 'b2.r1.c0').paras.slice(0, 7).map(q => q.text));

  // 같은 그림을 두 번 써도 파일은 하나, 그림이 없던 문서에도 목록을 만든다
  const out2 = path.join(tmp, '도장2.hwpx');
  await D.writeDoc(THINK, out2, { set: { b6: '참가자 성명: 홍길동 [[img:도장]]', b16: '참가자 성명: 홍길동 [[img:도장]]' }, images: { 도장: { file: STAMP } } });
  const zip2 = readZip(out2);
  assert.deepEqual(bin(zip2), ['BinData/image1.png']);
  assert.match(entry(zip2, 'Contents/content.hpf').data.toString(), /<opf:item id="image1" href="BinData\/image1\.png" media-type="image\/png" isEmbeded="1"\/><\/opf:manifest>/);
  assert.equal(entry(zip2, 'Contents/section0.xml').data.toString().match(/<hc:img binaryItemIDRef="image1" /g).length, 2);
});

/* ---------- hwp ---------- */
test('readDoc·writeDoc(hwp) — 같은 모델로 읽고, 칸·문단 글을 바꿔 .hwp로 저장한다', async t => {
  if (!needLib(t)) return;
  const doc = await D.readDoc(SAMPLE), before = fs.readFileSync(SAMPLE);
  assert.equal(doc.format, 'hwp');
  assert.deepEqual(doc.blocks.map(b => `${b.id}:${b.kind}`), ['b0:para', 'b1:table', 'b2:para', 'b3:para']);
  assert.deepEqual({ ...rightOf(doc, '성    명') }, { id: 'b1.r1.c1', row: 1, col: 1, rowSpan: 1, colSpan: 1, text: '', paras: [{ id: 'b1.r1.c1.p0', text: '' }] });
  assert.equal(cell(doc, 'b1.r6.c0').colSpan, 2);
  assert.deepEqual({ ...doc.blocks[2] }, { id: 'b2', kind: 'para', text: '위와 같이 공모전에 응모합니다.' });
  assert.match(doc.text, /^2026 우리 동네 이름 짓기 공모전 참가 신청서\n\[표 1\]\n구분 \| 내용\n성 명 \| \n/);
  assert.deepEqual(await D.readDoc(SAMPLE), doc);

  const out = path.join(tmp, 'hwp', '신청서.hwp');
  const r = await D.writeDoc(SAMPLE, out, { set: { 'b1.r1.c1': '김테스트', 'b1.r5.c1': '새 빛이 모이는 마루.\n둘째 줄', 'b1.r0.c0.p0': '구 분', b3: '2026년 11월 10일    신청인 : 김테스트 (인)', b0: '제목', b1: '표' } });
  assert.deepEqual(r.applied, ['b1.r1.c1', 'b1.r5.c1', 'b1.r0.c0.p0', 'b3']);
  assert.deepEqual(r.skipped.map(s => s.id), ['b0', 'b1']);   // 구역 설정이 든 첫 문단, 표 전체
  assert.deepEqual(fs.readFileSync(SAMPLE), before, '원본은 그대로');
  assert.deepEqual(fs.readdirSync(path.dirname(out)), ['신청서.hwp']);
  const back = await D.readDoc(out);
  assert.equal(cell(back, 'b1.r1.c1').text, '김테스트');
  assert.deepEqual(cell(back, 'b1.r5.c1').paras.map(p => p.text), ['새 빛이 모이는 마루.', '둘째 줄']);
  assert.equal(cell(back, 'b1.r0.c0').text, '구 분');
  assert.equal(back.blocks[3].text, '2026년 11월 10일    신청인 : 김테스트 (인)');
  sameExcept(doc, back, ['b1.r1.c1', 'b1.r5.c1', 'b1.r0.c0', 'b3']);
  assert.equal((await H.readForm(out)).tables[0].rows[1][1].text, '김테스트');   // 기존 읽기로도 같은 값

  const out2 = path.join(tmp, 'hwp', '표없이.hwp');
  assert.deepEqual(await D.writeDoc(SAMPLE, out2, { drop: ['b0', 'b1', 'b2'] }), { applied: ['b1', 'b2'], skipped: [{ id: 'b0', why: '구역 설정이 든 첫 문단이라 지우지 않았어요' }] });
  assert.equal((await D.readDoc(out2)).text, '2026 우리 동네 이름 짓기 공모전 참가 신청서\n2026년    월    일    신청인 :            (인)');
  await assert.rejects(D.writeDoc(SAMPLE, path.join(tmp, 'a.hwpx'), {}), /\.hwp 이름으로 저장/);
});

test('writeDoc(hwp) — 실제 신청서의 칸 안 문단을 바꾸고 블록을 지운다. [[img:이름]]은 그림 개체로 들어간다', async t => {
  if (!needLib(t)) return;
  if (!fs.existsSync(REAL)) return t.skip('form-contestkorea.hwp가 없어요');
  const doc = await D.readDoc(REAL), slot = cells(doc).find(c => c.text.startsWith('2-1. 응모자 성명'));
  assert.equal(slot.id, 'b44.r0.c0');
  assert.match(slot.paras[1].text, /^_{10,}$/);
  const out = path.join(tmp, '도서관.hwp');
  const r = await D.writeDoc(REAL, out, { set: { 'b44.r0.c0.p1': '홍길동', b1: '응모링크 : 없음' }, drop: ['b33', 'b34', 'b35'] });
  assert.deepEqual(r, { applied: ['b44.r0.c0.p1', 'b1', 'b33', 'b34', 'b35'], skipped: [] });
  const back = await D.readDoc(out);
  assert.equal(back.blocks.length, doc.blocks.length - 3);
  assert.equal(back.blocks[1].text, '응모링크 : 없음');
  assert.deepEqual(cell(back, 'b41.r0.c0').paras.map(p => p.text), ['2-1. 응모자 성명을 입력해 주시기 바랍니다.', '홍길동']);   // 블록 셋이 빠져 번호가 3 당겨진다
  assert.doesNotMatch(back.text, /문항 1 : 응모 유의사항 숙지 및 동의/);
  assert.match(back.text, /문항 2 : 개인정보 입력/);

  const out2 = path.join(tmp, '도장.hwp');
  const s = await D.writeDoc(SAMPLE, out2, { set: { b3: '신청인 : 홍길동 [[img:도장]] (인) [[img:없는그림]]' }, images: { 도장: { file: STAMP, mm: 14 } } });
  assert.deepEqual(s, { applied: ['b3'], skipped: [{ id: 'b3', why: '그림 없음' }] });
  assert.deepEqual({ ...(await D.readDoc(out2)).blocks[3] }, { id: 'b3', kind: 'para', text: '신청인 : 홍길동  (인)', fixed: true });
  assert.ok(fs.readFileSync(out2).includes(Buffer.from('BIN0001.png', 'utf16le')), '그림 스트림이 들어 있다');

  // 낮은 층: 문단에서 표만 빼기(cutt)·쪽 나눔 풀기(unbreak) — fixture에는 구역 설정과 같은 문단에 든 표가 없어 직접 부른다
  const part = path.join(tmp, '낮은층.hwp'), at = (await H.readBlocks(REAL)).blocks.findIndex(b => b.brk);
  assert.deepEqual(await H.editBlocks(SAMPLE, part, [['cutt', 1], ['cutt', 0]]), [0]);   // b0은 표가 아니라 안 된다
  assert.deepEqual((await H.readBlocks(part)).blocks.map(b => [b.kind, b.text]).slice(1, 3), [['para', ''], ['para', '위와 같이 공모전에 응모합니다.']]);
  assert.deepEqual(await H.editBlocks(REAL, part, [['unbreak', at]]), [0]);
  assert.deepEqual([at > 0, (await H.readBlocks(part)).blocks[at].brk], [true, false]);
});

/* ---------- 지원하지 않는 형식 ---------- */
test('.hwp·.hwpx가 아니면(이름이 아니라 내용으로) 직접 채우라고 하고, 깨진 파일은 다시 받으라고 한다', async () => {
  const NOT = /이 양식은 \.hwp·\.hwpx가 아니라 직접 채워야 해요/, put = (name, data) => { fs.writeFileSync(path.join(tmp, name), data); return path.join(tmp, name); };
  const emptyZip = Buffer.concat([Buffer.from('504b0506', 'hex'), Buffer.alloc(18)]);
  for (const f of [put('신청서.pdf', '%PDF-1.7\n'), put('옛한글.hwp', 'HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05'), put('워드.hwpx', emptyZip),
    put('엑셀.hwp', Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(600)])), put('글.txt', '그냥 글')]){
    const e = await D.readDoc(f).catch(x => x);
    assert.match(e.message, NOT, path.basename(f));
    assert.equal(e.user, true);
    await assert.rejects(D.writeDoc(f, path.join(tmp, 'x.hwpx'), {}), NOT);
  }
  await assert.rejects(D.readDoc(path.join(tmp, '없는파일.hwpx')), /양식 파일을 찾지 못했어요/);
  await assert.rejects(D.readDoc(put('잘린.hwpx', fs.readFileSync(PROPOSAL).subarray(0, 3000))), /깨졌을 수 있으니/);
  // 확장자가 틀려도 내용이 hwpx면 읽는다. 저장 이름은 같은 형식이어야 한다
  assert.equal((await D.readDoc(put('이름만.hwp', fs.readFileSync(CONSENT)))).format, 'hwpx');
  await assert.rejects(D.writeDoc(CONSENT, path.join(tmp, 'x.hwp'), {}), /\.hwpx 이름으로 저장/);
});
}
