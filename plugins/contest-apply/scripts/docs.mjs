// 공모전 양식 문서(.hwp·.hwpx)를 같은 모양의 블록 모델로 읽고, id로 문단·칸 글을 바꾸거나 맨 위 블록을 지워 같은 형식으로 저장한다.
//   readDoc(file) → { format, blocks, text } · writeDoc(src, out, { set, drop, images }) → { applied, skipped }
//   id(순서 기반 — 같은 파일이면 늘 같다): 맨 위 블록 'b3' · 표의 칸 'b3.r0.c1'(행·열 주소) · 칸 안 문단 'b3.r0.c1.p0'
//   표·그림 같은 개체가 든 문단은 fixed: true로 읽히고 바꾸지 않는다. 글 안의 [[img:이름]]은 images의 PNG를 글자처럼 넣는다
// .hwpx는 zip과 section XML을 직접 다루고(바꾸지 않은 바이트는 그대로 둔다), .hwp는 hwp.mjs의 Java 도우미(hwplib)에 맡긴다
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readBlocks, editBlocks } from './hwp.mjs';

const NOT_DOC = '이 양식은 .hwp·.hwpx가 아니라 직접 채워야 해요';
const BROKEN = '양식을 읽지 못했어요. 파일이 깨졌을 수 있으니 원본을 다시 받아 주세요';
const LOCKED = '암호가 걸린 양식이라 열 수 없어요. 한글에서 암호를 풀고 다시 저장하거나 직접 채워 주세요';
const WHY = {
  none: '그런 자리가 없어요', value: '넣을 글이 없어요',
  object: '표·그림 같은 개체가 든 문단이라 바꾸지 않았어요',
  table: '표 전체는 글로 바꿀 수 없어요. 칸 id를 써 주세요',
  cell: '칸 전체를 바꿔서 이 문단은 따로 바꾸지 않았어요',
  dropped: '지우는 블록 안이라 바꾸지 않았어요',
  sec: '구역 설정이 든 첫 문단이라 지우지 않았어요',
  shared: '같은 문단의 표가 남아 있어서 지우지 않았어요',
  failed: '바꾸지 못했어요',
  noImage: '그림 없음', badImage: '그림 파일을 읽지 못했어요(PNG만 넣을 수 있어요)',
};
const fail = msg => { throw Object.assign(new Error(msg), { user: true }); };
const inked = t => /\S/.test(t);
const IMG = /\[\[img:([^\]\n]+)\]\]/g;

/* ---------- zip: 중앙 디렉터리로 읽고, 바꾸지 않은 항목은 압축된 바이트 그대로 다시 쓴다 ---------- */
const CRC = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(buf){
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function unzip(buf){
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557) && end < 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) end = i;
  if (end < 0) fail(BROKEN);
  const entries = [];
  for (let n = buf.readUInt16LE(end + 10), p = buf.readUInt32LE(end + 16); n > 0; n--){
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) fail(BROKEN);
    const head = buf.subarray(p, p + 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32));
    const off = head.readUInt32LE(42), size = head.readUInt32LE(20);
    if (off === 0xffffffff || size === 0xffffffff || off + 30 > buf.length) fail(BROKEN);   // zip64는 다루지 않는다
    if (head.readUInt16LE(8) & 1) fail(LOCKED);
    const at = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    entries.push({ name: head.subarray(46, 46 + head.readUInt16LE(28)).toString('utf8'), head, raw: buf.subarray(at, at + size) });
    p += head.length;
  }
  return { entries, tail: buf.subarray(end) };
}
function content(e){
  if (e.data) return e.data;
  const method = e.head.readUInt16LE(10);
  try { return method === 0 ? e.raw : method === 8 ? zlib.inflateRawSync(e.raw) : fail(BROKEN); } catch { fail(BROKEN); }
}
// data가 있는 항목만 새로 압축한다(store: 압축 없이). 머리(head)가 없으면 첫 항목 것을 본떠 만든다
function zip({ entries, tail }){
  const parts = [], dir = [];
  let off = 0;
  for (const e of [...entries].sort((a, b) => (b.name === 'mimetype') - (a.name === 'mimetype'))){
    const name = Buffer.from(e.name), head = e.head ? Buffer.from(e.head) : Buffer.concat([entries[0].head.subarray(0, 46), name]);
    let raw = e.raw;
    if (!e.head){ head.writeUInt16LE(name.length, 28); head.writeUInt32LE(0, 30); }
    if (e.data){
      raw = e.store ? e.data : zlib.deflateRawSync(e.data);
      head.writeUInt16LE(e.store ? 0 : 8, 10);
      head.writeUInt32LE(crc32(e.data), 16); head.writeUInt32LE(raw.length, 20); head.writeUInt32LE(e.data.length, 24);
    }
    head.writeUInt16LE(head.readUInt16LE(8) & ~8, 8);   // 크기를 머리에 적으므로 뒤따르는 크기 기록은 없다
    head.writeUInt32LE(off, 42);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    head.copy(local, 4, 6, 28);   // 버전·플래그·방식·시각·CRC·크기
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, raw); dir.push(head);
    off += 30 + name.length + raw.length;
  }
  const end = Buffer.from(tail);
  end.writeUInt16LE(dir.length, 8); end.writeUInt16LE(dir.length, 10);
  end.writeUInt32LE(dir.reduce((n, h) => n + h.length, 0), 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, ...dir, end]);
}

/* ---------- section XML: 다시 직렬화하지 않고 요소 위치(s 시작·o 여는 태그 끝·c 닫는 태그 시작·e 끝)만 잡는다 ---------- */
const TAG = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>/g;
const nsOf = (x, uri, fallback) => new RegExp(`xmlns:([\\w.-]+)="http://www\\.hancom\\.co\\.kr/hwpml/2011/${uri}"`).exec(x)?.[1] || fallback;
function parseXml(x){
  const top = { kids: [] }, stack = [top], ns = nsOf(x, 'paragraph', 'hp');
  for (const m of x.matchAll(TAG)){
    if (!m[2]) continue;
    const up = stack[stack.length - 1];
    if (m[1]){
      if (up.name !== m[2]) fail(BROKEN);
      up.c = m.index; up.e = m.index + m[0].length; stack.pop();
      continue;
    }
    const n = { name: m[2], tag: m[2].startsWith(`${ns}:`) ? m[2].slice(ns.length + 1) : m[2], attrs: m[3], s: m.index, o: m.index + m[0].length, kids: [] };
    up.kids.push(n);
    if (m[4]) n.c = n.e = n.o; else stack.push(n);
  }
  if (stack.length !== 1 || top.kids.length !== 1) fail(BROKEN);
  return { x, ns, root: top.kids[0] };
}
const attr = (n, name) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(n.attrs)?.slice(1).find(v => v != null);
const kid = (n, tag) => n.kids.find(k => k.tag === tag);
const below = (n, tag, out = []) => { for (const k of n.kids) k.tag === tag ? out.push(k) : below(k, tag, out); return out; };
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>|&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, raw, e) => raw != null ? raw
  : e[0] !== '#' ? ENT[e] ?? m : String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MARK = { tab: ' ', lineBreak: '\n', fwSpace: ' ', nbSpace: ' ', hyphen: '-' };   // <hp:t> 안의 특수 글자
function tText(x, t){
  let out = '', at = t.o;
  for (const k of t.kids){ out += unesc(x.slice(at, k.s)) + (MARK[k.tag] ?? ''); at = k.e; }
  return out + unesc(x.slice(at, t.c));
}
const runText = (x, run) => run.kids.filter(k => k.tag === 't').map(t => tText(x, t)).join('');

// 문단 하나: 자기 글, 바로 든 표, 그 밖의 것(구역 설정 sec · 머리말 같은 조판 부호 ctl · 그림·글상자 obj)
function paraInfo(sx, p){
  const i = { text: '', tables: [], items: [], sec: false, obj: false, ctl: false };
  for (const run of p.kids){
    if (run.tag === 'linesegarray') continue;
    if (run.tag !== 'run'){ i.ctl = true; continue; }
    for (const k of run.kids){
      if (k.tag === 't'){ i.text += tText(sx.x, k); continue; }
      i.items.push(k);
      if (k.tag === 'tbl') i.tables.push(k);
      else if (k.tag === 'secPr') i.sec = true;
      else if (k.tag === 'ctrl') i.ctl = true;
      else i.obj = true;
    }
  }
  i.lock = i.sec || i.obj || i.ctl || i.tables.length > 0;
  return i;
}
// 문단 글 + 그 안 개체(머리말·각주·글상자·중첩 표)의 글. 표는 행마다 ' | '
function deepLines(sx, p, withTables = true){
  const i = paraInfo(sx, p), out = inked(i.text) ? [i.text] : [];
  for (const k of i.items){
    if (k.tag !== 'tbl') out.push(...below(k, 'p').flatMap(q => deepLines(sx, q)));
    else if (withTables) out.push(...rowsOf(sx, k).map(r => r.map(c => c.paras.map(q => q.text).join(' ').replace(/\s+/g, ' ').trim()).join(' | ')).filter(l => /[^\s|]/.test(l)));
  }
  return out;
}
function paraOf(sx, p, withTables = true){
  const i = paraInfo(sx, p);
  return { node: p, lock: i.lock, text: i.lock ? deepLines(sx, p, withTables).join('\n') : i.text };
}
const rowsOf = (sx, tbl) => tbl.kids.filter(k => k.tag === 'tr').map((tr, r) => tr.kids.filter(k => k.tag === 'tc').map((tc, c) => {
  const at = kid(tc, 'cellAddr'), span = kid(tc, 'cellSpan'), num = (n, name, d) => Number((n && attr(n, name)) ?? d);
  return { row: num(at, 'rowAddr', r), col: num(at, 'colAddr', c), rowSpan: num(span, 'rowSpan', 1), colSpan: num(span, 'colSpan', 1),
    paras: (kid(tc, 'subList')?.kids || []).filter(k => k.tag === 'p').map(p => paraOf(sx, p)) };
}));
function hwpxBlocks(sections){
  const out = [];
  let par = 0;
  sections.forEach((sx, s) => {
    for (const p of sx.root.kids.filter(k => k.tag === 'p')){
      const i = paraInfo(sx, p), base = { s, par: par++, sec: i.sec, obj: i.obj, ctl: i.ctl, brk: attr(p, 'pageBreak') === '1', sx, node: p };
      if (!i.tables.length || inked(i.text)) out.push({ ...base, kind: 'para', ...paraOf(sx, p, false) });
      for (const t of i.tables) out.push({ ...base, kind: 'table', table: t, rows: rowsOf(sx, t) });
    }
  });
  return out;
}
function openHwpx(buf){
  const z = unzip(buf), text = name => { const e = z.entries.find(x => x.name === name); return e ? content(e).toString('utf8') : ''; };
  const num = e => Number(/\d+/.exec(e.name.slice(9))[0]);
  const files = z.entries.filter(e => /^Contents\/section\d+\.xml$/.test(e.name)).sort((a, b) => num(a) - num(b));
  if (!files.length) fail(NOT_DOC);   // .docx 같은 다른 zip
  if (/encryption-data/.test(text('META-INF/manifest.xml'))) fail(LOCKED);
  const sections = files.map(entry => ({ ...parseXml(content(entry).toString('utf8')), entry }));
  return { z, sections, raw: hwpxBlocks(sections) };
}

/* ---------- 공통: 읽은 블록 → 모델, 바꿀 것 정하기 ---------- */
function model(format, raw){
  const lines = [];
  let nth = 0;
  const blocks = raw.map((b, i) => {
    const id = `b${i}`, fixed = p => p.lock ? { fixed: true } : {};
    if (b.kind === 'para'){
      if (inked(b.text)) lines.push(b.text.trim());
      return { id, kind: 'para', text: b.text, ...fixed(b) };
    }
    const rows = b.rows.map(r => r.map(c => {
      const cid = `${id}.r${c.row}.c${c.col}`;
      return { id: cid, row: c.row, col: c.col, rowSpan: c.rowSpan, colSpan: c.colSpan, text: c.paras.map(p => p.text).filter(inked).join('\n'),
        paras: c.paras.map((p, k) => ({ id: `${cid}.p${k}`, text: p.text, ...fixed(p) })) };
    }));
    lines.push(`[표 ${++nth}]`, ...rows.map(r => r.map(c => c.text.replace(/\s+/g, ' ').trim()).join(' | ')));
    return { id, kind: 'table', rows };
  });
  return { format, blocks, text: lines.join('\n').slice(0, 20000) };
}
// 탭·제어 글자는 빼고 줄바꿈만 문단 나눔으로 남긴다. 끝의 빈 줄은 버린다
const clean = v => String(v).replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f\ufffe\uffff]/g, '').replace(/\s+$/, '');
const byPara = raw => [...raw.reduce((m, b, i) => m.set(b.par, [...(m.get(b.par) || []), i]), new Map()).values()];

// drop: 문단의 블록이 다 지워지면 문단째(cutParas), 아니면 표만 뺀다(cutTables). 구역 설정이 든 문단은 남긴다
function planDrops(raw, drop, skip){
  const want = new Set(), gone = new Set(), cutParas = [], cutTables = [];
  for (const id of new Set(drop)){
    const b = /^b(\d+)$/.exec(id);
    if (b && raw[b[1]]) want.add(Number(b[1])); else skip(id, WHY.none);
  }
  for (const idxs of byPara(raw)){
    const hit = idxs.filter(i => want.has(i)), head = raw[idxs[0]], hasText = head.kind === 'para';
    if (!hit.length) continue;
    if (hit.length === idxs.length && !head.sec && (hasText || !(head.obj || head.ctl))){
      cutParas.push({ b: idxs[0], ids: hit.map(i => `b${i}`) });
      hit.forEach(i => gone.add(i));
      continue;
    }
    for (const i of hit){
      if (raw[i].kind !== 'table'){ skip(`b${i}`, head.sec ? WHY.sec : WHY.shared); continue; }
      cutTables.push({ b: i, ids: [`b${i}`] }); gone.add(i);
    }
  }
  return { gone, cutParas, cutTables };
}
// 앞쪽 블록을 지워서 쪽 나눔으로 시작하는 문단이 맨 앞 내용이 되면, 빈 첫 쪽이 생기지 않게 그 쪽 나눔을 푼다
function planUnbreak(raw, { gone, cutParas }){
  const whole = new Set(cutParas.map(c => raw[c.b].par)), cut = new Set(), found = new Set(), out = [];
  for (const idxs of byPara(raw)){
    const head = raw[idxs[0]];
    if (idxs.some(i => gone.has(i))) cut.add(head.s);
    if (found.has(head.s) || whole.has(head.par)) continue;
    if (!head.obj && idxs.every(i => raw[i].kind === 'table' ? gone.has(i) : !inked(raw[i].text))) continue;   // 빈 문단은 건너뛴다
    found.add(head.s);
    if (head.brk && cut.has(head.s)) out.push(idxs[0]);
  }
  return out;
}
function planSets(raw, set, gone, skip){
  const sets = [], cells = new Set();
  const parsed = Object.entries(set).map(([id, v]) => ({ id, v, m: /^b(\d+)(?:\.r(\d+)\.c(\d+)(?:\.p(\d+))?)?$/.exec(id) }));
  for (const pass of ['cell', 'para']) for (const { id, v, m } of parsed){
    const isCell = !!m && m[2] != null && m[4] == null;
    if ((pass === 'cell') !== isCell) continue;
    const b = m && raw[m[1]], cell = b && m[2] != null && b.kind === 'table' ? b.rows.flat().find(c => c.row === Number(m[2]) && c.col === Number(m[3])) : null;
    const target = !b ? null : m[2] == null ? (b.kind === 'para' ? b : null) : m[4] == null ? cell : cell?.paras[m[4]];
    const why = !b ? WHY.none : gone.has(Number(m[1])) ? WHY.dropped : b.kind === 'table' && m[2] == null ? WHY.table : !target ? WHY.none
      : v == null ? WHY.value : (isCell ? target.paras.some(p => p.lock) || !target.paras.length : target.lock) ? WHY.object
      : !isCell && cell && cells.has(cell) ? WHY.cell : '';
    if (why){ skip(id, why); continue; }
    if (isCell) cells.add(cell);
    sets.push({ id, b: Number(m[1]), block: b, cell, para: m[4] == null ? -1 : Number(m[4]), target, value: clean(v) });
  }
  const order = new Map(parsed.map((p, i) => [p.id, i]));
  return sets.sort((a, b) => order.get(a.id) - order.get(b.id));
}

/* ---------- 그림([[img:이름]]) ---------- */
function loadImages(images = {}){
  const out = new Map();
  for (const [name, spec] of Object.entries(images || {})){
    let data = null;
    try { data = fs.readFileSync(spec.file); } catch { /* 아래에서 못 읽은 그림으로 */ }
    const ok = data && data.length > 24 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && data.readUInt32BE(16) > 0 && data.readUInt32BE(20) > 0;
    out.set(name, ok ? { file: path.resolve(spec.file), data, w: data.readUInt32BE(16), h: data.readUInt32BE(20), mm: Number(spec.mm) > 0 ? Number(spec.mm) : 14 } : null);
  }
  return out;
}
// 한 변 mm짜리 정사각형 안에 비율대로 맞춘 크기(HWPUNIT, 1mm = 283.46)
function fit(img){
  const k = img.mm * 7200 / 25.4 / Math.max(img.w, img.h);
  return [Math.max(1, Math.round(img.w * k)), Math.max(1, Math.round(img.h * k))];
}
// 넣을 수 없는 토큰은 글에서 지우고 이유를 남긴다
function settleImages(sets, images, skip){
  for (const s of sets) s.value = s.value.replace(IMG, (token, name) => {
    const why = !images.has(name) ? WHY.noImage : !images.get(name) ? WHY.badImage : '';
    if (why) skip(s.id, why);
    return why ? '' : token;
  }).replace(/\s+$/, '');
}

/* ---------- hwpx 고치기: section XML 문자열을 부분 교체 ---------- */
function picXml(sx, img, ref, ids){
  const hc = nsOf(sx.x, 'core', ''), c = hc || 'hc', decl = hc ? '' : ' xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"', p = sx.ns;
  const W = img.w * 75, H = img.h * 75, [w, h] = fit(img);   // 원래 크기는 96dpi로 친다
  const unit = `e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"`;
  return `<${p}:pic id="${ids.id++}" zOrder="${ids.z++}" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${ids.inst++}" reverse="0"${decl}>`
    + `<${p}:offset x="0" y="0"/><${p}:orgSz width="${W}" height="${H}"/><${p}:curSz width="${w}" height="${h}"/><${p}:flip horizontal="0" vertical="0"/>`
    + `<${p}:rotationInfo angle="0" centerX="${Math.round(w / 2)}" centerY="${Math.round(h / 2)}" rotateimage="1"/>`
    + `<${p}:renderingInfo><${c}:transMatrix ${unit}/><${c}:scaMatrix e1="${+(w / W).toFixed(6)}" e2="0" e3="0" e4="0" e5="${+(h / H).toFixed(6)}" e6="0"/><${c}:rotMatrix ${unit}/></${p}:renderingInfo>`
    + `<${c}:img binaryItemIDRef="${ref}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>`
    + `<${p}:imgRect><${c}:pt0 x="0" y="0"/><${c}:pt1 x="${W}" y="0"/><${c}:pt2 x="${W}" y="${H}"/><${c}:pt3 x="0" y="${H}"/></${p}:imgRect>`
    + `<${p}:imgClip left="0" right="${W}" top="0" bottom="${H}"/><${p}:inMargin left="0" right="0" top="0" bottom="0"/><${p}:imgDim dimwidth="${W}" dimheight="${H}"/><${p}:effects/>`
    + `<${p}:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>`
    + `<${p}:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>`
    + `<${p}:outMargin left="0" right="0" top="0" bottom="0"/></${p}:pic>`;
}
// 그림 파일을 zip과 content.hpf 목록에 올리고, 이름 → 목록 id와 개체 번호를 돌려준다
function imageStore(doc, images){
  const max = re => Math.max(0, ...doc.sections.flatMap(sx => [...sx.x.matchAll(re)].map(m => Number(m[1]))).filter(n => n < 0x7fffffff));
  const ids = { id: max(/\sid="(\d+)"/g) + 1, z: max(/\szOrder="(\d+)"/g) + 1, inst: max(/\sinstid="(\d+)"/g) + 1 }, refs = new Map();
  const hpf = doc.z.entries.find(e => e.name === 'Contents/content.hpf');
  let n = Math.max(0, ...doc.z.entries.map(e => Number(/^BinData\/image(\d+)\./i.exec(e.name)?.[1] || 0)));
  const ref = name => {
    if (!hpf) return null;
    if (refs.has(name)) return refs.get(name);
    const id = `image${++n}`, xml = content(hpf).toString('utf8'), close = /<\/([\w.-]+:)?manifest>/.exec(xml);
    if (!close) return null;
    const at = Math.max(...[...xml.matchAll(/<[\w.:-]+\s[^>]*href="BinData\/[^>]*\/>/g)].map(m => m.index + m[0].length), -1);
    const item = `<${close[1] || ''}item id="${id}" href="BinData/${id}.png" media-type="image/png" isEmbeded="1"/>`, cut = at < 0 ? close.index : at;
    hpf.data = Buffer.from(xml.slice(0, cut) + item + xml.slice(cut));
    doc.z.entries.push({ name: `BinData/${id}.png`, data: images.get(name).data, store: true });
    return refs.set(name, id).get(name);
  };
  return { ids, ref };
}
const openTag = (sx, n) => sx.x.slice(n.s, n.o).replace(/\s*\/>$/, '>');
// 글자 모양은 빈칸이 아닌 첫 글자가 든 런의 것
function runOpen(sx, p){
  const runs = p.kids.filter(k => k.tag === 'run'), r = runs.find(k => inked(runText(sx.x, k))) || runs.find(k => runText(sx.x, k)) || runs[0];
  return r ? openTag(sx, r) : `<${sx.ns}:run charPrIDRef="0">`;
}
// 문단 p의 모양으로 값의 줄마다 문단 하나. 줄 배치(linesegarray)는 넣지 않아 한글이 다시 계산한다
function parasXml(sx, p, value, store, { unbreak, onMiss } = {}){
  const run = runOpen(sx, p), T = `${sx.ns}:t`, t = s => s ? `<${T}>${esc(s)}</${T}>` : '';
  return value.split('\n').map((line, i) => {
    let open = openTag(sx, p), body = '', at = 0, pic = false;
    if (i > 0 || unbreak) open = open.replace(/\spageBreak="1"/, ' pageBreak="0"');
    if (i > 0) open = open.replace(/\scolumnBreak="1"/, ' columnBreak="0"');
    for (const m of line.matchAll(IMG)){
      const ref = store.ref(m[1]);
      body += t(line.slice(at, m.index)); at = m.index + m[0].length;
      if (ref){ body += picXml(sx, store.images.get(m[1]), ref, store.ids); pic = true; } else onMiss?.();
    }
    const rest = t(line.slice(at));
    body += rest || (pic ? `<${T}/>` : '');
    return `${open}${body ? `${run}${body}</${sx.ns}:run>` : run.replace(/>$/, '/>')}</${sx.ns}:p>`;
  }).join('');
}
function editHwpx(doc, plan, images, skip){
  const edits = new Map(), put = (sx, s, e, text) => edits.set(sx, [...(edits.get(sx) || []), { s, e, text }]);
  const store = { ...imageStore(doc, images), images }, unbreak = new Set(plan.unbreak.map(b => doc.raw[b].node));
  const stale = new Map(), written = new Set();   // 높이가 달라질 이웃 문단(같은 칸의 문단, 표를 품은 문단)도 줄 배치를 지운다
  for (const s of plan.sets){
    const sx = s.block.sx, ps = s.target.paras?.map(p => p.node) || [s.target.node];
    put(sx, ps[0].s, ps[ps.length - 1].e, parasXml(sx, ps[0], s.value, store, { unbreak: unbreak.delete(ps[0]), onMiss: () => skip(s.id, WHY.failed) }));
    ps.forEach(p => written.add(p));
    if (s.cell) for (const p of [s.block.node, ...s.cell.paras.map(p => p.node)]) stale.set(p, sx);
  }
  for (const c of plan.cutTables){
    put(doc.raw[c.b].sx, doc.raw[c.b].table.s, doc.raw[c.b].table.e, '');
    stale.set(doc.raw[c.b].node, doc.raw[c.b].sx);
  }
  for (const c of plan.cutParas) put(doc.raw[c.b].sx, doc.raw[c.b].node.s, doc.raw[c.b].node.e, '');
  for (const b of plan.unbreak) if (unbreak.has(doc.raw[b].node)) put(doc.raw[b].sx, doc.raw[b].node.s, doc.raw[b].node.o, openTag(doc.raw[b].sx, doc.raw[b].node).replace(/\spageBreak="1"/, ' pageBreak="0"'));
  for (const [p, sx] of stale) for (const k of written.has(p) ? [] : p.kids.filter(k => k.tag === 'linesegarray')) put(sx, k.s, k.e, '');
  for (const [sx, list] of edits){
    let x = sx.x, floor = Infinity;
    for (const e of list.sort((a, b) => b.s - a.s)){
      if (e.e > floor) fail('양식을 고치다 자리가 겹쳤어요. 같은 자리를 두 번 바꾸지 않았는지 확인해 주세요');
      x = x.slice(0, e.s) + e.text + x.slice(e.e); floor = e.s;
    }
    Object.assign(sx, parseXml(x));   // 고친 XML이 온전한지 다시 읽어 확인한다
    sx.entry.data = Buffer.from(x);
  }
  const preview = doc.z.entries.find(e => e.name === 'Preview/PrvText.txt');
  if (preview && edits.size) preview.data = Buffer.from(prvText(hwpxBlocks(doc.sections)));
  return zip(doc.z);
}
// 미리보기 글: 문단은 한 줄, 표는 행마다 <칸><칸>
const prvText = raw => raw.map(b => b.kind === 'para' ? b.text : b.rows.map(r => r.map(c => `<${c.paras.map(p => p.text).filter(inked).join(' ')}>`).join('')).join('\r\n')).join('\r\n').slice(0, 1024) + '\r\n';

/* ---------- 공개 API ---------- */
function load(file){
  let buf;
  try { buf = fs.readFileSync(file); } catch { fail('양식 파일을 찾지 못했어요. 다시 받아 주세요'); }
  if (buf.subarray(0, 2).toString('latin1') === 'PK') return { format: 'hwpx', buf };
  if (buf.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')) && buf.includes('HWP Document File')) return { format: 'hwp', buf };
  fail(NOT_DOC);
}

export async function readDoc(file){
  const { format, buf } = load(file);
  return model(format, format === 'hwpx' ? openHwpx(buf).raw : (await readBlocks(file)).blocks);
}

export async function writeDoc(src, out, { set = {}, drop = [], images = {} } = {}){
  const { format, buf } = load(src);
  if (path.extname(out).toLowerCase() !== `.${format}`) fail(`채운 양식은 .${format} 이름으로 저장해야 해요`);
  const doc = format === 'hwpx' ? openHwpx(buf) : await readBlocks(src);
  if (doc.distribution) fail('배포용 HWP라 고칠 수 없어요(편집이 막혀 있어요). 직접 채워 주세요');
  const raw = doc.raw || doc.blocks, skipped = [], skip = (id, why) => skipped.push({ id, why }), pics = loadImages(images);
  const drops = planDrops(raw, drop || [], skip), plan = { ...drops, sets: planSets(raw, set || {}, drops.gone, skip), unbreak: planUnbreak(raw, drops) };
  settleImages(plan.sets, pics, skip);
  const todo = [...plan.sets, ...plan.cutTables, ...plan.cutParas], dest = path.resolve(out), part = path.join(path.dirname(dest), `.${path.basename(dest)}.${process.pid}.tmp`);
  let applied = todo.flatMap(t => t.ids || [t.id]);
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!todo.length) fs.copyFileSync(src, part);
    else if (format === 'hwpx') fs.writeFileSync(part, editHwpx(doc, plan, pics, skip));
    else {
      const names = [...new Set(plan.sets.flatMap(s => [...s.value.matchAll(IMG)].map(m => m[1])))], mark = v => v.replace(IMG, (_, n) => `\u0001${names.indexOf(n)}\u0002`);
      const first = [...plan.unbreak.map(b => ['unbreak', b]), ...names.map((n, i) => ['image', 0, ...fit(pics.get(n)), i, pics.get(n).file])];
      const ops = [...first, ...plan.sets.map(s => [s.cell ? (s.para < 0 ? 'cell' : 'cpara') : 'para', s.b, s.cell?.row, s.cell?.col, s.para, mark(s.value)]),
        ...plan.cutTables.map(c => ['cutt', c.b]), ...plan.cutParas.map(c => ['cutp', c.b])];
      const done = new Set(await editBlocks(src, part, ops)), ok = t => done.has(first.length + todo.indexOf(t));
      for (const t of todo.filter(t => !ok(t))) for (const id of t.ids || [t.id]) skip(id, WHY.failed);
      applied = todo.filter(ok).flatMap(t => t.ids || [t.id]);
    }
    fs.renameSync(part, dest);
  } finally { fs.rmSync(part, { force: true }); }
  return { applied, skipped };
}
