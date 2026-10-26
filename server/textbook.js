// 교과서 복제 — Obsidian 폴더(책 한 권 = 폴더 하나)를 프로필의 01_지식/교과서/<책>/ 로 옮기며 읽기전용 규칙(SPEC §0-1)에 맞춘다.
// 원본이 정본이다: 원본은 건드리지 않고, 복제본은 원본이 바뀔 때마다 다시 만든다(내용이 같으면 파일을 다시 쓰지 않는다).
// 책 폴더의 .source.json 이 원본 위치를 기억한다 — 서버는 이걸 보고 원본을 지켜보다가 바뀌면 다시 복제한다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const MD = createRequire(import.meta.url)('../web/js/pkm-md.js');

export const MANIFEST = '.source.json';

// 원본 섹션 이름(기호 붙은 것) → 규칙 섹션 이름
const SECTIONS = [[/^###\s*⊡\s*컨텐츠\s*$/, '# 내용'], [/^###\s*☌\s*연결\s*$/, '# 연결'], [/^###\s*⚙\s*(활용|개발할 때)\s*$/, '# 활용'], [/^###\s*↖︎?\s*출처\s*$/, '# 출처']];
const WORDS = [[/⊡\s*컨텐츠/g, '내용'], [/☌\s*연결/g, '연결'], [/⚙\s*(활용|개발할 때)/g, '활용'], [/↖︎?\s*출처/g, '출처']];

const kindOf = name => /^(\d+_)?MOC(\s*—|_)/.test(name) ? 'moc' : /문제은행|문제$|모의고사/.test(name) ? 'quiz' : /용어/.test(name) ? 'glossary' : 'note';
const hash = s => { let h = 2166136261; for (const c of Buffer.from(s)) h = Math.imul(h ^ c, 16777619) >>> 0; return h.toString(36).padStart(7, '0').slice(-7); };
const today = () => new Date().toLocaleDateString('sv-SE');
// 날짜·원본 위치 줄만 다른 건 내용이 바뀐 게 아니다(볼트를 옮겨도 '바뀜'으로 뜨지 않게)
const strip = (s, keys) => s.replace(new RegExp(`^(${keys}):.*\\n`, 'gm'), '');
const sameText = (a, b) => strip(a, 'imported|updated') === strip(b, 'imported|updated');
const sameBody = (a, b) => strip(a, 'imported|updated|source') === strip(b, 'imported|updated|source');

export function walk(dir, rel = ''){
  return fs.readdirSync(path.join(dir, rel), { withFileTypes:true }).flatMap(e => {
    if (e.name.startsWith('.')) return [];
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, r) : e.name.endsWith('.md') ? [r] : [];
  }).sort((a, b) => a.localeCompare(b, 'ko'));
}

function convert(text, kind){
  let lines = text.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  if (/^# /.test(lines[0] || '')) lines.shift();   // 제목은 파일 이름(=링크 대상)과 프런트매터가 맡는다
  let fence = false;
  lines = lines.map(l => {
    if (l.startsWith('```')) fence = !fence;
    if (fence) return l;
    if (kind === 'note') for (const [re, h] of SECTIONS) if (re.test(l)) return h;
    return WORDS.reduce((s, [re, w]) => s.replace(re, w), l);
  });
  return lines.join('\n').trim() + '\n';
}

// 책 한 권을 복제한다. profileDir 아래 tbFolder/<책 이름>/ 에 쓴다.
// 원본에서 사라진 노트는 프로필의 .trash/ 로 옮긴다(복제본이니 원본과 같아야 한다).
// 원본 폴더가 없거나 비어 있으면 아무것도 지우지 않고 멈춘다 — 원본을 잠깐 옮겼다고 복제본이 사라지면 안 된다.
export function importBook(src, profileDir, { tbFolder = MD.DEFAULT_FOLDERS.textbook, vault = '' } = {}){
  src = path.resolve(src);
  const book = path.basename(src);
  if (!fs.existsSync(src)) return { book, skipped:'원본 폴더가 없어요', added:[], changed:[], removed:[] };
  const files = walk(src);
  if (!files.length) return { book, skipped:'원본 폴더가 비었어요', added:[], changed:[], removed:[] };
  const moc = files.find(f => kindOf(path.basename(f, '.md')) === 'moc' && !f.includes('/'));
  // 읽는 순서 = MOC에 링크가 처음 나온 순서, MOC에 없는 노트는 그 뒤에 경로 순
  const order = new Map();
  if (moc) [...fs.readFileSync(path.join(src, moc), 'utf8').matchAll(/\[\[([^\]|#]+)/g)].forEach(m => { const t = m[1].trim(); if (!order.has(t)) order.set(t, order.size + 1); });
  let tail = order.size + 1;
  const outDir = path.join(profileDir, tbFolder, book), added = [], changed = [];
  for (const rel of files){
    const name = path.basename(rel, '.md'), kind = kindOf(name);
    const out = path.join(outDir, rel), old = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
    const oldDate = k => old && (old.match(new RegExp(`^${k}:\\s*"?([\\d-]+)"?`, 'm')) || [])[1];
    const fm = {
      type:'textbook', id:'B' + hash(`${book}/${rel}`), title:name, book, kind, chapter:rel.includes('/') ? rel.split('/')[0] : '',
      order:kind === 'moc' ? 0 : order.get(name) ?? tail++, readonly:true,
      source:vault ? path.relative(vault, path.join(src, rel)) : '', imported:oldDate('imported') || today(), updated:oldDate('updated') || ''
    };
    const body = convert(fs.readFileSync(path.join(src, rel), 'utf8'), kind);
    let text = MD.writeDoc(Object.fromEntries(Object.entries(fm).filter(([, v]) => v !== '')), [], body);
    if (old !== null && sameText(old, text)) continue;
    if (old === null) added.push(rel);
    else if (!sameBody(old, text)){ fm.updated = today(); text = MD.writeDoc(Object.fromEntries(Object.entries(fm).filter(([, v]) => v !== '')), [], body); changed.push(rel); }
    fs.mkdirSync(path.dirname(out), { recursive:true });
    const tmp = `${out}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text); fs.renameSync(tmp, out);   // 반쯤 쓴 파일이 남지 않게
  }
  const removed = fs.existsSync(outDir) ? walk(outDir).filter(r => !files.includes(r)) : [];
  for (const rel of removed){
    let to = path.join(profileDir, '.trash', tbFolder, book, rel);
    if (fs.existsSync(to)) to = to.replace(/\.md$/, ` ${Date.now()}.md`);
    fs.mkdirSync(path.dirname(to), { recursive:true }); fs.renameSync(path.join(outDir, rel), to);
  }
  const manifest = JSON.stringify({ src, vault:vault ? path.resolve(vault) : '' }, null, 2) + '\n';
  if ((fs.existsSync(path.join(outDir, MANIFEST)) ? fs.readFileSync(path.join(outDir, MANIFEST), 'utf8') : '') !== manifest) fs.writeFileSync(path.join(outDir, MANIFEST), manifest);
  return { book, added, changed, removed };
}

// 프로필에서 원본을 기억하는 책들 → [{ dir, src, vault }]
export function linkedBooks(profileDir, tbFolder = MD.DEFAULT_FOLDERS.textbook){
  const root = path.join(profileDir, tbFolder);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes:true }).filter(e => e.isDirectory()).flatMap(e => {
    try { const m = JSON.parse(fs.readFileSync(path.join(root, e.name, MANIFEST), 'utf8')); return m.src ? [{ dir:path.join(root, e.name), src:m.src, vault:m.vault || '' }] : []; }
    catch { return []; }
  });
}
