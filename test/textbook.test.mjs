// 교과서 복제 시험: Obsidian 원본이 정본 — 바뀐 것만 다시 쓰고, 사라진 노트는 휴지통으로, 원본이 없으면 아무것도 지우지 않는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importBook, linkedBooks } from '../server/textbook.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-tb-'));
after(() => fs.rmSync(tmp, { recursive:true, force:true }));
const vault = path.join(tmp, 'vault'), src = path.join(vault, '임시노트', '시험 교과서'), prof = path.join(tmp, 'data', '개인');
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive:true }); fs.writeFileSync(path.join(src, rel), text); };
const out = rel => path.join(prof, '01_지식/교과서/시험 교과서', rel);

test('처음 복제하고, 다시 돌리면 아무것도 다시 쓰지 않는다', () => {
  put('00_MOC — 시험 교과서.md', '# 시험\n1. [[둘]]\n2. [[하나]]\n');
  put('01 기초/하나.md', '# 하나\n### ⊡ 컨텐츠\n첫 본문\n');
  put('01 기초/둘.md', '# 둘\n본문\n');
  const r = importBook(src, prof, { vault });
  assert.equal(r.added.length, 3);
  assert.match(fs.readFileSync(out('01 기초/하나.md'), 'utf8'), /readonly: true[\s\S]*source: "?임시노트\/시험 교과서\/01 기초\/하나.md"?[\s\S]*# 내용\n첫 본문/);
  assert.match(fs.readFileSync(out('01 기초/하나.md'), 'utf8'), /order: 2/);
  const mt = fs.statSync(out('01 기초/하나.md')).mtimeMs;
  const again = importBook(src, prof, { vault });
  assert.deepEqual([again.added, again.changed, again.removed], [[], [], []]);
  assert.equal(fs.statSync(out('01 기초/하나.md')).mtimeMs, mt, '내용이 같으면 파일을 건드리지 않는다');
  assert.deepEqual(linkedBooks(prof).map(b => b.src), [src]);
});
test('원본을 고치면 그 노트만 바뀌고 바뀐 날이 붙는다, 지운 노트는 휴지통으로', () => {
  put('01 기초/하나.md', '# 하나\n### ⊡ 컨텐츠\n고친 본문\n');
  fs.rmSync(path.join(src, '01 기초/둘.md'));
  const r = importBook(src, prof, { vault });
  assert.deepEqual(r.changed, ['01 기초/하나.md']);
  assert.deepEqual(r.removed, ['01 기초/둘.md']);
  const t = fs.readFileSync(out('01 기초/하나.md'), 'utf8');
  assert.match(t, /고친 본문/); assert.match(t, /^updated: "\d{4}-\d\d-\d\d"$/m); assert.match(t, /^imported: /m);
  assert.ok(!fs.existsSync(out('01 기초/둘.md')));
  assert.ok(fs.existsSync(path.join(prof, '.trash/01_지식/교과서/시험 교과서/01 기초/둘.md')));
});
test('볼트를 옮겨 원본 위치만 달라지면 고쳐 쓰되 바뀜으로 치지 않는다', () => {
  const r = importBook(src, prof, { vault:path.dirname(vault) });
  assert.deepEqual(r.changed, []);
  assert.match(fs.readFileSync(out('00_MOC — 시험 교과서.md'), 'utf8'), /source: "?vault\//);
  assert.doesNotMatch(fs.readFileSync(out('00_MOC — 시험 교과서.md'), 'utf8'), /^updated:/m);
});
test('원본 폴더가 사라지면 복제본을 지우지 않는다', () => {
  fs.renameSync(src, src + ' 옮김');
  const r = importBook(src, prof, { vault });
  assert.ok(r.skipped);
  assert.ok(fs.existsSync(out('01 기초/하나.md')));
  fs.renameSync(src + ' 옮김', src);
});
test('책 안의 그림은 그대로 옮기고, 원본에서 지우면 휴지통으로', () => {
  put('_그림/곡선.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const r = importBook(src, prof, { vault });
  assert.ok(r.added.includes('_그림/곡선.svg'));
  assert.equal(fs.readFileSync(out('_그림/곡선.svg'), 'utf8'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.deepEqual(importBook(src, prof, { vault }).added, [], '같으면 다시 쓰지 않는다');
  fs.rmSync(path.join(src, '_그림/곡선.svg'));
  assert.ok(importBook(src, prof, { vault }).removed.includes('_그림/곡선.svg'));
  assert.ok(!fs.existsSync(out('_그림/곡선.svg')));
});
