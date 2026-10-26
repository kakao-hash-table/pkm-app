#!/usr/bin/env node
// 교과서 카드 — 교과서 노트를 휴대폰에서 넘겨 보는 짧은 카드로 다시 쓴 것(SPEC §0-2).
// 카드 글은 사람이나 AI가 scripts/textbook-cards.prompt.md 대로 쓴다. 이 스크립트는 일감을 나누고, 검사하고, 파일로 쓴다.
//   node scripts/textbook-cards.mjs todo <프로필 폴더> --out <폴더> [--book <책 이름 일부>] [--batch 30]   카드가 없거나 원본이 바뀐 노트 → 일감 JSON
//   node scripts/textbook-cards.mjs write <프로필 폴더> <카드 JSON…>                                        검사를 통과한 것만 카드 파일로
//   node scripts/textbook-cards.mjs status <프로필 폴더>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { walk } from '../server/textbook.js';
const MD = createRequire(import.meta.url)('../web/js/pkm-md.js');

const [cmd, profile, ...rest] = process.argv.slice(2);
const opt = k => { const i = rest.indexOf(k); if (i < 0) return null; const v = rest[i + 1]; rest.splice(i, 2); return v; };
if (!cmd || !profile){ console.error('사용법: node scripts/textbook-cards.mjs todo|write|status <프로필 폴더> …'); process.exit(1); }

const files = Object.fromEntries(walk(profile).map(r => [r, fs.readFileSync(path.join(profile, r), 'utf8')]));
const { db, settings } = MD.parse(files);
const F = settings.folders || {}, tbDir = (F.textbook || MD.DEFAULT_FOLDERS.textbook) + '/', cardDir = (F.cards || MD.DEFAULT_FOLDERS.cards) + '/';
const notes = db.textbooks.filter(x => x.kind === 'note');
const cardsOf = new Map(db.tbCards.map(c => [c.from, c]));
const stale = x => { const c = cardsOf.get(x.id); return !c ? 'missing' : c.fromHash !== MD.textHash(x.body) ? 'stale' : null; };

// 카드가 원문을 벗어나지 않았는지 — 길이, 개수, 원문에 없는 숫자·링크
export function check(note, cards){
  const errs = [], src = `${note.title}\n${note.body}`;
  if (!Array.isArray(cards) || cards.length < 2 || cards.length > 8) errs.push(`카드 수 ${cards && cards.length}(2~8)`);
  const seen = new Set();
  for (const [i, c] of (cards || []).entries()){
    const t = String(c.title || '').trim(), q = String(c.q || '').trim(), b = String(c.body || '').trim(), at = `카드 ${i + 1}`;
    if (!q || q.length > 30 || !q.endsWith('?') || /\n/.test(q)) errs.push(`${at} 질문 길이 ${q.length}(1~30, 한 줄, 물음표로 끝)`);
    if (!t || t.length > 45 || /\n/.test(t)) errs.push(`${at} 제목 길이 ${t.length}(1~45, 한 줄)`);
    if (seen.has(t)) errs.push(`${at} 제목이 겹침`); seen.add(t);
    const prose = b.replace(/```[\s\S]*?```/g, '');
    if (!prose.trim() || prose.length > 220) errs.push(`${at} 본문 길이 ${prose.length}(1~220)`);
    if ((b.match(/```[\s\S]*?```/g) || []).some(blk => blk.split('\n').length - 2 > 4)) errs.push(`${at} 코드가 4줄을 넘음`);
    for (const n of `${t} ${q} ${prose}`.match(/\d+(?:[.,]\d+)*/g) || []) if (!src.includes(n)) errs.push(`${at} 원문에 없는 숫자 "${n}"`);
    for (const m of `${t} ${b}`.matchAll(/\[\[([^\]]+)\]\]/g)) if (!src.includes(m[0])) errs.push(`${at} 원문에 없는 링크 ${m[0]}`);
  }
  return errs;
}

function write(note, cards){
  const rel = note.path.startsWith(tbDir) ? note.path.slice(tbDir.length) : note.path;
  const fm = { type:'cards', id:'C' + note.id.replace(/^B/, ''), title:note.title, book:note.book, chapter:note.chapter || undefined, from:note.id, from_hash:MD.textHash(note.body), readonly:true, made:new Date().toLocaleDateString('sv-SE') };
  const body = cards.map(c => `## ${String(c.title).trim().replace(/\.$/, '')}\n> [!question] ${String(c.q).trim()}\n\n${String(c.body).trim()}`).join('\n\n');   // 질문은 Obsidian에서도 콜아웃으로 보인다
  const out = path.join(profile, cardDir, rel);
  fs.mkdirSync(path.dirname(out), { recursive:true });
  fs.writeFileSync(out, MD.writeDoc(fm, [], body));
}

if (cmd === 'status'){
  const by = {};
  for (const x of notes){ const b = by[x.book] || (by[x.book] = { notes:0, missing:0, stale:0 }); b.notes++; const s = stale(x); if (s) b[s]++; }
  for (const [b, v] of Object.entries(by)) console.log(`${b}: 노트 ${v.notes} · 카드 없음 ${v.missing} · 원본이 바뀜 ${v.stale}`);
  const orphan = db.tbCards.filter(c => !notes.some(x => x.id === c.from));
  if (orphan.length) console.log(`원본 노트가 사라진 카드 ${orphan.length}: ${orphan.map(c => c.path).join(', ')}`);
} else if (cmd === 'todo'){
  const out = opt('--out'), book = opt('--book'), size = Number(opt('--batch') || 30);
  if (!out){ console.error('--out <폴더> 가 필요해요'); process.exit(1); }
  const todo = notes.filter(x => (!book || x.book.includes(book)) && stale(x)).sort((a, b) => a.book.localeCompare(b.book, 'ko') || a.order - b.order);
  fs.mkdirSync(out, { recursive:true });
  for (let i = 0; i < todo.length; i += size){
    const f = path.join(out, `todo-${String(i / size + 1).padStart(2, '0')}.json`);
    fs.writeFileSync(f, JSON.stringify(todo.slice(i, i + size).map(x => ({ id:x.id, title:x.title, book:x.book, chapter:x.chapter, body:x.body })), null, 1));
  }
  console.log(`일감 ${todo.length}개 → ${Math.ceil(todo.length / size)}개 파일 (${out})`);
} else if (cmd === 'write'){
  let ok = 0, bad = 0;
  for (const f of rest){
    for (const { id, cards } of JSON.parse(fs.readFileSync(f, 'utf8'))){
      const note = notes.find(x => x.id === id);
      const errs = note ? check(note, cards) : ['그런 노트가 없음'];
      if (errs.length){ bad++; console.log(`✗ ${id} ${note ? note.title : ''}\n   ${errs.join('\n   ')}`); continue; }
      write(note, cards); ok++;
    }
  }
  console.log(`카드 파일 ${ok}개 씀 · 검사에서 떨어진 노트 ${bad}개`);
  if (bad) process.exitCode = 2;
}
