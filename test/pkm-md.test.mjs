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

test('데일리의 그날 시작 시각과 건너뛴 루틴이 왕복한다', () => {
  const db = { ...MD.emptyDb(), routines:[{ id:'R1', title:'아침 스트레칭', enabled:true, cron:'0 7 * * *', duration:15, block:'', area:'', amount:null, content:'' }],
    dailies:{ '2026-10-26':{ memo:'', retro:'', did:[], plan:{}, start:'08:40', skipped:['R1'] }, '2026-10-27':{ memo:'', retro:'', did:[], plan:{}, start:'10:00' } } };
  const files = MD.serialize({ db, settings });
  assert.match(files['02_시간/데일리/2026-10-26.md'], /start: "08:40"\nroutines: \[\]\nskipped: \["\[\[아침 스트레칭\]\]"\]/);
  const back = MD.parse(files).db;
  assert.equal(back.dailies['2026-10-26'].start, '08:40');
  assert.deepEqual(back.dailies['2026-10-26'].skipped, ['R1']);
  assert.equal(back.dailies['2026-10-27'].start, '10:00');   // 시작만 옮긴 앞날도 파일이 남는다
});

test('하루 여러 번 도는 루틴은 회차별로 체크·건너뛰기가 왕복한다', () => {
  const db = { ...MD.emptyDb(), routines:[{ id:'R1', title:'물 250ml', enabled:true, cron:'0 10-22/2 * * *', duration:5, block:'', area:'', amount:null, content:'' }, { id:'R2', title:'기상', enabled:true, cron:'30 6 * * *', duration:5, block:'', area:'', amount:null, content:'' }],
    routineDone:{ '2026-10-26':{ 'R1@10:00':true, 'R1@12:00':true, R2:true } },
    dailies:{ '2026-10-26':{ memo:'', retro:'', did:[], plan:{}, skipped:['R1@14:00'] } } };
  const files = MD.serialize({ db, settings });
  assert.match(files['02_시간/데일리/2026-10-26.md'], /routines: \["\[\[물 250ml\|10:00\]\]", "\[\[물 250ml\|12:00\]\]", "\[\[기상\]\]"\]\nskipped: \["\[\[물 250ml\|14:00\]\]"\]/);
  const back = MD.parse(files).db;
  assert.equal(back.routines.find(r => r.id === 'R1').cron, '0 10-22/2 * * *');
  assert.deepEqual(back.routineDone['2026-10-26'], { 'R1@10:00':true, 'R1@12:00':true, R2:true });
  assert.deepEqual(back.dailies['2026-10-26'].skipped, ['R1@14:00']);
});

test('메뉴 순서와 숨김이 왕복하고, 적힌 적 없으면 쓰지 않는다', () => {
  const plain = MD.serialize({ db: MD.emptyDb(), settings });
  assert.doesNotMatch(plain['_설정.md'], /menu_/);
  const files = MD.serialize({ db: MD.emptyDb(), settings: { ...settings, menu_order: ['time', 'now', 'action'], menu_hidden: ['knowledge'] } });
  const back = MD.parse(files).settings;
  assert.deepEqual(back.menu_order, ['time', 'now', 'action']);
  assert.deepEqual(back.menu_hidden, ['knowledge']);
});

test('교과서는 읽기전용 — 읽기만 하고 쓰지 않으며, 영구노트 출처로 이어진다', () => {
  const tb = '01_지식/교과서/PKM 교과서';
  const files = {
    [`${tb}/00_MOC — PKM 교과서.md`]: '---\ntype: textbook\nid: Bmoc\nbook: PKM 교과서\nkind: moc\norder: 0\nreadonly: true\n---\n\n1. [[연결이 지식을 만든다]]\n',
    [`${tb}/01 기초/연결이 지식을 만든다.md`]: '---\ntype: textbook\nid: Bn1\nbook: PKM 교과서\nkind: note\nchapter: 01 기초\norder: 1\nreadonly: true\n---\n\n# 내용\n본문\n',
    [`${tb}/01 기초/프런트매터 없는 노트.md`]: '# 프런트매터 없는 노트\n본문\n',
    '01_지식/영구노트/내 생각.md': '---\ntype: permanent\nid: P1\ntitle: 내 생각\ncreated: 2026-10-26\nlinks: []\nsources: ["[[연결이 지식을 만든다]]"]\n---\n\n내 말로\n'
  };
  const { db } = MD.parse(files);
  assert.equal(db.textbooks.length, 3);
  const n1 = db.textbooks.find(x => x.id === 'Bn1');
  assert.deepEqual([n1.book, n1.kind, n1.chapter, n1.order, n1.path], ['PKM 교과서', 'note', '01 기초', 1, `${tb}/01 기초/연결이 지식을 만든다.md`]);
  const loose = db.textbooks.find(x => x.title === '프런트매터 없는 노트');   // 교과서 폴더 안이면 type이 없어도 교과서
  assert.equal(loose.book, 'PKM 교과서'); assert.match(loose.id, /^B[0-9a-z]+$/);
  assert.deepEqual(db.perms[0].sources, ['Bn1']);
  const out = MD.serialize({ db, settings });
  assert.ok(!Object.keys(out).some(p => p.startsWith('01_지식/교과서/')), '교과서 파일을 쓰지 않는다');
  assert.match(out['01_지식/영구노트/내 생각.md'], /sources: \["\[\[연결이 지식을 만든다\]\]"\]/);
  const ch = MD.diff(MD.serialize({ db, settings }), out);   // 앱의 저장 = 정규화한 마지막 저장본과의 차이
  assert.ok(!ch.deletes.some(p => p.startsWith('01_지식/교과서/')));
});

test('교과서 카드는 노트별 카드 묶음으로 읽고, 원본이 바뀌면 알 수 있다', () => {
  const tb = '01_지식/교과서/PKM 교과서', note = '---\ntype: textbook\nid: Bn1\nbook: PKM 교과서\nkind: note\nreadonly: true\n---\n\n# 내용\n본문\n';
  const card = '---\ntype: cards\nid: Cn1\ntitle: 연결이 지식을 만든다\nbook: PKM 교과서\nfrom: Bn1\nfrom_hash: HASH\nreadonly: true\n---\n\n## 연결이 지식을 만든다\n노트는 이어질 때 쓸모가 생긴다.\n\n## 링크는 이유와 함께 단다\n> [!question] 링크를 달 때 무엇을 같이 적나?\n\n왜 이어지는지 한 줄 적는다.\n';
  const files = { [`${tb}/연결이 지식을 만든다.md`]: note, '01_지식/교과서 카드/PKM 교과서/연결이 지식을 만든다.md': card };
  let { db } = MD.parse(files);
  const n1 = db.textbooks[0], c = db.tbCards[0];
  assert.deepEqual([c.from, c.cards.length, c.cards[1].title, c.cards[1].q, c.cards[1].body], ['Bn1', 2, '링크는 이유와 함께 단다', '링크를 달 때 무엇을 같이 적나?', '왜 이어지는지 한 줄 적는다.']);
  assert.notEqual(c.fromHash, MD.textHash(n1.body));
  files['01_지식/교과서 카드/PKM 교과서/연결이 지식을 만든다.md'] = card.replace('HASH', MD.textHash(n1.body));
  ({ db } = MD.parse(files));
  assert.equal(db.tbCards[0].fromHash, MD.textHash(db.textbooks[0].body), '같은 본문이면 같은 해시');
  assert.ok(!Object.keys(MD.serialize({ db, settings })).some(p => p.startsWith('01_지식/교과서 카드/')), '카드 파일을 쓰지 않는다');
});
