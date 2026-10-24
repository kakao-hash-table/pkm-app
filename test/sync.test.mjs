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
