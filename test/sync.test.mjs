// GitHub 자동 동기화 시험: 임시 저장소(원격은 로컬 bare 저장소)에서 storage: github 프로필을 저장하면 커밋·푸시된다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-sync-'));
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe'] }).trim();
const remote = path.join(tmp, 'remote.git'), work = path.join(tmp, 'work');
sh(tmp, 'init', '--bare', '-b', 'main', remote);
fs.mkdirSync(path.join(work, 'data', '개인'), { recursive:true });
sh(work, 'init', '-b', 'main'); sh(work, 'config', 'user.email', 't@t'); sh(work, 'config', 'user.name', 't');
fs.writeFileSync(path.join(work, 'README.md'), 'x'); sh(work, 'add', 'README.md'); sh(work, 'commit', '-m', 'init'); sh(work, 'remote', 'add', 'origin', remote); sh(work, 'push', '-u', 'origin', 'main');
fs.writeFileSync(path.join(work, 'data', '개인', '_설정.md'), '---\ntype: settings\nstorage: github\n---\n');
fs.writeFileSync(path.join(work, 'data', '회사.md'), 'not a profile');
fs.mkdirSync(path.join(work, 'data', '회사')); fs.writeFileSync(path.join(work, 'data', '회사', '_설정.md'), '---\ntype: settings\nstorage: device\n---\n');
process.env.PKM_DATA = path.join(work, 'data');
const { save } = await import('../server/index.js?sync');
after(() => fs.rmSync(tmp, { recursive:true, force:true }));

test('github 프로필은 저장하면 커밋·푸시되고, device 프로필은 올라가지 않는다', async () => {
  await save('개인', { writes:{ '00_인박스/메모.md':'---\ntype: inbox\nid: i1\n---\n\n안녕\n' } });
  await save('회사', { writes:{ '00_인박스/비밀.md':'---\ntype: inbox\nid: i2\n---\n\n회사\n' } });
  const { syncNowForTest } = await import('../server/index.js?sync');
  const st = await syncNowForTest('개인');
  assert.equal(st.state, 'ok', st.error || '');
  const files = sh(remote, '-c', 'core.quotepath=off', 'ls-tree', '-r', '--name-only', 'main');
  assert.match(files, /data\/개인\/00_인박스\/메모\.md/);
  assert.doesNotMatch(files, /회사/);
});

// 다른 기기(같은 원격의 다른 clone)에서 같은 파일을 고쳐 올린 경우
const other = path.join(tmp, 'other');
const otherPush = (files, msg) => {
  if (!fs.existsSync(other)){ sh(tmp, 'clone', '-q', remote, other); sh(other, 'config', 'user.email', 'o@o'); sh(other, 'config', 'user.name', 'o'); }
  sh(other, 'pull', '-q', '--no-rebase', 'origin', 'main');
  for (const [f, c] of Object.entries(files)){ fs.mkdirSync(path.dirname(path.join(other, f)), { recursive:true }); fs.writeFileSync(path.join(other, f), c); }
  sh(other, 'add', '-A'); sh(other, 'commit', '-q', '-m', msg); sh(other, 'push', '-q', 'origin', 'main');
};
const memo = 'data/개인/00_인박스/메모.md', state = 'data/개인/_플러그인/.state/x.json';

test('같은 파일을 양쪽에서 고쳐도 멈추지 않는다 — 이 기기 것을 두고 다른 기기 것은 충돌 사본으로, .state는 이 기기 것만', async () => {
  const { syncNowForTest } = await import('../server/index.js?sync');
  const writeState = v => { fs.mkdirSync(path.dirname(path.join(work, state)), { recursive:true }); fs.writeFileSync(path.join(work, state), v); };   // 실행기가 직접 쓰는 파일
  writeState('{"v":0}'); assert.equal((await syncNowForTest('개인')).state, 'ok');
  otherPush({ [memo]:'다른 기기\n', [state]:'{"v":"other"}' }, 'other');
  writeState('{"v":"here"}');
  await save('개인', { writes:{ '00_인박스/메모.md':'이 기기\n' } });
  const st = await syncNowForTest('개인');
  assert.equal(st.state, 'ok', st.error || '');
  assert.equal(sh(work, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(sh(remote, 'show', `main:${memo}`), '이 기기');
  assert.equal(sh(remote, 'show', 'main:data/개인/00_인박스/메모 (다른 기기 충돌 사본).md'), '다른 기기');
  assert.equal(sh(remote, 'show', `main:${state}`), '{"v":"here"}');
  assert.doesNotMatch(sh(remote, '-c', 'core.quotepath=off', 'ls-tree', '-r', '--name-only', 'main'), /x \(다른 기기/);
});

test('앞서 멈춘 rebase가 남아 있으면 되돌리고 다시 동기화한다', async () => {
  const { syncNowForTest } = await import('../server/index.js?sync');
  otherPush({ [memo]:'다른 기기 2\n' }, 'other 2');
  fs.writeFileSync(path.join(work, memo), '이 기기 2\n'); sh(work, 'commit', '-q', '-am', 'here 2');
  assert.throws(() => sh(work, 'pull', '--rebase', 'origin', 'main'));   // 예전 앱처럼 rebase 도중에 멈춘 상태
  const st = await syncNowForTest('개인');
  assert.equal(st.state, 'ok', st.error || '');
  assert.equal(sh(work, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(sh(remote, 'show', `main:${memo}`), '이 기기 2');
  assert.equal(sh(remote, 'show', 'main:data/개인/00_인박스/메모 (다른 기기 충돌 사본).md'), '다른 기기 2');
});
