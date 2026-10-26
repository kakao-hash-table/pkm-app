// 서버 시험: 임시 data 폴더에서 프로필 만들기 → 쓰기 → 읽기 → 지우기(.trash) → 위험한 경로 막기.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-'));
const tpl = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-tpl-'));
fs.writeFileSync(path.join(tpl, '단기보드.md'), '---\ntype: project\n---\n');
process.env.PKM_DATA = tmp; process.env.PKM_TEMPLATES = tpl;
const { server } = await import('../server/index.js');
let base;
before(() => new Promise(r => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => { server.close(); fs.rmSync(tmp, { recursive:true, force:true }); fs.rmSync(tpl, { recursive:true, force:true }); });
const j = async (p, opt) => { const r = await fetch(base + p, opt); return { status:r.status, body:await r.json() }; };
const post = (p, b) => j(p, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(b) });

test('프로필을 만들고 목록에 나온다', async () => {
  assert.equal((await post('/api/profiles', { name:'개인' })).status, 201);
  assert.ok(fs.existsSync(path.join(tmp, '개인', '_템플릿', '단기보드.md')));
  assert.ok(fs.existsSync(path.join(tmp, '개인', '_설정.md')));
  assert.deepEqual((await j('/api/profiles')).body.profiles.map(p => p.name), ['개인']);
  assert.equal((await post('/api/profiles', { name:'개인' })).status, 409);
  assert.equal((await post('/api/profiles', { name:'../x' })).status, 400);
});
test('쓰고 읽고 지우면 .trash로 간다', async () => {
  const v0 = (await j('/api/profile/개인/version')).body.version;
  assert.equal((await post('/api/profile/개인/save', { writes:{ '03_행동/단기보드/할 일 하나.md':'---\ntype: project\nid: t1\ntitle: 할 일 하나\nstatus: todo\n---\n' } })).status, 200);
  const r = (await j('/api/profile/개인')).body;
  assert.match(r.files['03_행동/단기보드/할 일 하나.md'], /할 일 하나/);
  assert.notEqual(r.version, v0);
  await post('/api/profile/개인/save', { deletes:['03_행동/단기보드/할 일 하나.md'] });
  assert.ok(!fs.existsSync(path.join(tmp, '개인', '03_행동/단기보드/할 일 하나.md')));
  assert.ok(fs.existsSync(path.join(tmp, '개인', '.trash/03_행동/단기보드/할 일 하나.md')));
  assert.ok(!('.trash/03_행동/단기보드/할 일 하나.md' in (await j('/api/profile/개인')).body.files));
});
test('위험한 경로는 막는다', async () => {
  for (const p of ['../밖.md', '/etc/x.md', 'a/../../밖.md', '.git/config.md', '그냥.txt']) assert.equal((await post('/api/profile/개인/save', { writes:{ [p]:'x' } })).status, 400, p);
  assert.equal((await j('/api/profile/없음')).status, 404);
  const r = await fetch(base + '/../../etc/passwd'); assert.equal(r.status, 404);
});
test('읽기전용 노트(교과서 폴더·readonly: true)는 쓰지도 지우지도 않는다', async () => {
  const dir = path.join(tmp, '개인', '01_지식', '교과서', '책'); fs.mkdirSync(dir, { recursive:true });
  fs.writeFileSync(path.join(dir, '노트.md'), '---\ntype: textbook\nreadonly: true\n---\n\n원본\n');
  fs.writeFileSync(path.join(tmp, '개인', '밖에 둔 원본.md'), '---\ntype: textbook\nreadonly: true   # 고치지 않음\n---\n\n원본\n');
  for (const ch of [{ writes:{ '01_지식/교과서/책/노트.md':'바꿈' } }, { writes:{ '01_지식/교과서/책/새 노트.md':'새로' } }, { deletes:['01_지식/교과서/책/노트.md'] }, { writes:{ '밖에 둔 원본.md':'바꿈' } }, { writes:{ '00_인박스/같이.md':'x' }, deletes:['밖에 둔 원본.md'] }])
    assert.equal((await post('/api/profile/개인/save', ch)).status, 403, JSON.stringify(ch));
  assert.match(fs.readFileSync(path.join(dir, '노트.md'), 'utf8'), /원본/);
  assert.ok(fs.existsSync(path.join(tmp, '개인', '밖에 둔 원본.md')));
  assert.ok(!fs.existsSync(path.join(tmp, '개인', '00_인박스', '같이.md')), '하나라도 읽기전용이면 아무것도 쓰지 않는다');
});
test('화면 파일을 내보낸다', async () => {
  const r = await fetch(base + '/js/pkm-md.js'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /javascript/);
});
test('앱 템플릿이 바뀌면 프로필 복사본을 맞추고, 프로필만의 템플릿은 남긴다', async () => {
  const { syncTemplates } = await import('../server/index.js');
  fs.writeFileSync(path.join(tpl, '단기보드.md'), '---\ntype: project\nestimate:\n---\n');
  fs.writeFileSync(path.join(tmp, '개인', '_템플릿', '기록_요리.md'), '---\ntype: record\n---\n');
  assert.equal(await syncTemplates('개인'), 1);
  assert.match(fs.readFileSync(path.join(tmp, '개인', '_템플릿', '단기보드.md'), 'utf8'), /estimate/);
  assert.ok(fs.existsSync(path.join(tmp, '개인', '_템플릿', '기록_요리.md')));
});

const PLUGIN = new URL('./fixtures/plugin-ok/', import.meta.url).pathname;
test('플러그인: 로컬 폴더를 검사하고, 설치·목록·업데이트·지우기', async () => {
  const ins = await post('/api/plugins/inspect', { local:PLUGIN });
  assert.equal(ins.status, 200, JSON.stringify(ins.body));
  assert.equal(ins.body.ok, true);
  assert.equal(ins.body.manifest.id, 'deploy-loop');
  assert.equal(ins.body.scripts[0].path, 'scripts/pr-body.mjs');
  assert.match(ins.body.scripts[0].text, /PR body/);
  assert.match(ins.body.scripts[0].sha256, /^[0-9a-f]{64}$/);
  assert.ok(!fs.existsSync(path.join(tmp, '개인', '_플러그인')));   // 검사만 — 아직 설치 안 함
  const inst = await post('/api/profile/개인/plugins', { stage:ins.body.stage });
  assert.equal(inst.status, 201);
  assert.ok(fs.existsSync(path.join(tmp, '개인', '_플러그인/deploy-loop/scripts/pr-body.mjs')));
  assert.equal((await post('/api/profile/개인/plugins', { stage:ins.body.stage })).status, 404);   // 한 번 쓴 stage는 끝
  const list = (await j('/api/profile/개인/plugins')).body.plugins;
  assert.equal(list[0].id, 'deploy-loop'); assert.equal(list[0].source.type, 'local'); assert.deepEqual(list[0].changed, []);
  // 설치된 스크립트가 바깥에서 바뀌면 목록에 표시
  fs.appendFileSync(path.join(tmp, '개인', '_플러그인/deploy-loop/scripts/pr-body.mjs'), '// 바뀜\n');
  assert.deepEqual((await j('/api/profile/개인/plugins')).body.plugins[0].changed, ['scripts/pr-body.mjs']);
  // 다시 설치(업데이트)하면 이전 것은 휴지통으로
  const again = await post('/api/plugins/inspect', { local:PLUGIN });
  assert.equal((await post('/api/profile/개인/plugins', { stage:again.body.stage })).body.previous, '0.1.0');
  assert.ok(fs.readdirSync(path.join(tmp, '개인', '.trash/_플러그인')).some(n => n.startsWith('deploy-loop-')));
  // 플러그인 문서는 노트로 읽히지 않는다
  assert.ok(Object.keys((await j('/api/profile/개인')).body.files).some(p => p.startsWith('_플러그인/')));
  assert.equal((await j('/api/profile/개인/plugins/deploy-loop', { method:'DELETE' })).status, 200);
  assert.ok(!fs.existsSync(path.join(tmp, '개인', '_플러그인/deploy-loop')));
});
test('플러그인: 검사를 통과하지 못하면 설치하지 않는다', async () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-bad-'));
  fs.cpSync(PLUGIN, bad, { recursive:true });
  fs.writeFileSync(path.join(bad, 'scripts/evil.sh'), 'rm -rf ~');
  const ins = await post('/api/plugins/inspect', { local:bad });
  assert.equal(ins.body.ok, false); assert.match(ins.body.errors.join(), /evil.sh/);
  assert.equal((await post('/api/profile/개인/plugins', { stage:ins.body.stage })).status, 400);
  assert.equal((await post('/api/plugins/inspect', { local:'relative/path' })).status, 400);
  assert.equal((await post('/api/plugins/inspect', { git:'file:///etc' })).status, 400);
  fs.rmSync(bad, { recursive:true, force:true });
});
test('다른 사이트에서 온 쓰기 요청은 거절', async () => {
  const r = await fetch(base + '/api/profiles', { method:'POST', headers:{ 'content-type':'application/json', origin:'https://evil.example' }, body:JSON.stringify({ name:'x' }) });
  assert.equal(r.status, 403);
  const r2 = await fetch(base + '/api/profiles', { method:'POST', headers:{ 'content-type':'application/json', 'sec-fetch-site':'cross-site' }, body:JSON.stringify({ name:'x' }) });
  assert.equal(r2.status, 403);
  // 프록시 뒤라 Host가 달라도 브라우저가 same-origin이라고 하면 받는다
  const r3 = await fetch(base + '/api/plugins/inspect', { method:'POST', headers:{ 'content-type':'application/json', 'sec-fetch-site':'same-origin', origin:'https://mac.tail.ts.net:5270' }, body:'{}' });
  assert.equal(r3.status, 400);
});

test('교과서 원본을 고치면 서버가 다시 복제한다', async () => {
  const { syncTextbooks } = await import('../server/index.js');
  const { importBook } = await import('../server/textbook.js');
  const src = path.join(tmp, '..', path.basename(tmp) + '-vault', '책');
  fs.mkdirSync(src, { recursive:true }); fs.writeFileSync(path.join(src, '노트.md'), '# 노트\n처음\n');
  importBook(src, path.join(tmp, '개인'));
  fs.writeFileSync(path.join(src, '노트.md'), '# 노트\n고침\n');
  await syncTextbooks();
  assert.match(fs.readFileSync(path.join(tmp, '개인', '01_지식/교과서/책/노트.md'), 'utf8'), /고침/);
  fs.rmSync(path.dirname(src), { recursive:true, force:true });
});
