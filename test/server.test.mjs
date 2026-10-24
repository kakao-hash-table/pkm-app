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
