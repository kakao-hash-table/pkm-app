// 화면 스크립트 문법 — index.html 안의 스크립트가 통째로 깨지면 앱이 뜨지 않는다(한 줄 주석이 코드를 삼킨 일이 있었다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('index.html의 인라인 스크립트가 문법에 맞다', () => {
  const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(blocks.length >= 1);
  for (const b of blocks) assert.doesNotThrow(() => new Function(b));
});
