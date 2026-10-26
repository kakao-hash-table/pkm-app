#!/usr/bin/env node
// 교과서 가져오기 — Obsidian 폴더(책 한 권 = 폴더 하나)를 프로필의 01_지식/교과서/ 로 복제하며 읽기전용 규칙(SPEC §0-1)에 맞춘다.
//   node scripts/import-textbook.mjs <책 폴더…> --to <프로필 폴더> [--vault <원본 볼트 루트>]
// 한 번 가져온 책은 서버가 원본을 지켜보다가 바뀌면 알아서 다시 복제한다(server/textbook.js). 원본은 건드리지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { importBook } from '../server/textbook.js';
const MD = createRequire(import.meta.url)('../web/js/pkm-md.js');

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const to = opt('--to'), vault = opt('--vault');
if (!to || !args.length){ console.error('사용법: node scripts/import-textbook.mjs <책 폴더…> --to <프로필 폴더> [--vault <볼트 루트>]'); process.exit(1); }

const settingsFile = path.join(to, MD.SETTINGS);
const tbFolder = ((fs.existsSync(settingsFile) && MD.parseDoc(fs.readFileSync(settingsFile, 'utf8')).fm.folders) || {}).textbook || MD.DEFAULT_FOLDERS.textbook;

for (const src of args){
  const r = importBook(src, to, { tbFolder, vault });
  console.log(r.skipped ? `${r.book}: 건너뜀 — ${r.skipped}` : `${r.book}: 새 노트 ${r.added.length} · 바뀜 ${r.changed.length} · 원본에서 사라져 휴지통으로 ${r.removed.length}`);
}
