// 저장 형식 왕복 시험: 목업의 예시 데이터 → 마크다운 파일 → 다시 읽기 → 다시 쓰기가 같아야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const MD = require('../web/js/pkm-md.js');

const html = fs.readFileSync(new URL('../web/prototype/index.html', import.meta.url), 'utf8');
const grab = name => { const i = html.indexOf(`function ${name}(){`); let depth = 0, j = html.indexOf('{', i); for (; j < html.length; j++){ if (html[j] === '{') depth++; else if (html[j] === '}' && --depth === 0) break; } return html.slice(i, j + 1); };
const FENCE = '```';
const seed = new Function('FENCE', `${grab('seed')}; return seed();`)(FENCE);
const seedWork = new Function('FENCE', `${grab('seedWork')}; return seedWork();`)(FENCE);

const settings = { storage:'device', week_start:1, day_start:'07:00', day_end:'23:00', blocked:[{ days:'1-5', from:'09:00', to:'18:00', label:'회사' }], fill_ratio:0.75, max_block:120, default_block:60, onboarded:true };

for (const [name, db] of [['개인', seed], ['회사', seedWork]]){
  test(`${name}: 쓰고 읽고 다시 쓰면 같다`, () => {
    const a = MD.serialize({ db, settings });
    const back = MD.parse(a);
    const b = MD.serialize(back);
    assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort());
    for (const p of Object.keys(a)) assert.equal(b[p], a[p], p);
  });
  test(`${name}: 개수와 연결이 유지된다`, () => {
    const back = MD.parse(MD.serialize({ db, settings })).db;
    for (const k of ['inbox', 'refs', 'fleeting', 'perms', 'meetings', 'tasks', 'longs', 'routines', 'appts']) assert.equal(back[k].length, db[k].length, k);
    for (const t of db.tasks){ const u = back.tasks.find(x => x.id === t.id); assert.equal(u.status, t.status); assert.equal(u.area || '', t.area || ''); }
    for (const p of db.perms){ assert.deepEqual(back.perms.find(x => x.id === p.id).links, p.links); }
    for (const m of db.meetings){ const u = back.meetings.find(x => x.id === m.id); assert.equal(u.appt || null, m.appt || null, m.id); assert.deepEqual(u.todos.map(t => t.task || null), m.todos.map(t => t.task || null)); }
  });
}
test('설정이 왕복한다', () => {
  const back = MD.parse(MD.serialize({ db:seed, settings })).settings;
  assert.equal(back.day_start, '07:00'); assert.deepEqual(back.blocked, settings.blocked); assert.equal(back.max_block, 120);
});
test('템플릿 주석이 달린 프런트매터를 읽는다', () => {
  const d = MD.parseDoc('---\ntype: project\nstatus: todo    # todo 대기 | doing 진행\narea:          # 쌓이는 장기\nblocked:\n  - { days: "1-5", from: "09:00", to: "18:00", label: "회사" }\n---\n# 할 일\n- [x] 하나\n');
  assert.equal(d.fm.status, 'todo'); assert.equal(d.fm.area, null); assert.equal(d.fm.blocked[0].from, '09:00'); assert.match(d.sections['할 일'], /하나/);
});
