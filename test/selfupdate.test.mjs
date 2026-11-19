import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSelfUpdate, RESTART } from '../server/selfupdate.js';

const env = { ...process.env, GIT_AUTOPUSH: '0', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { env, stdio: 'pipe' }).toString().trim();

function repos(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-su-'));
  const origin = path.join(dir, 'origin.git'), app = path.join(dir, 'app'), other = path.join(dir, 'other');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin], { env });
  execFileSync('git', ['clone', '-q', origin, other], { env, stdio: 'pipe' });
  fs.writeFileSync(path.join(other, 'a.txt'), '1');
  g(other, 'add', '.'); g(other, 'commit', '-qm', 'one'); g(other, 'push', '-q', 'origin', 'HEAD:main');
  execFileSync('git', ['clone', '-q', origin, app], { env, stdio: 'pipe' });
  const push = (name = 'b.txt') => { fs.writeFileSync(path.join(other, name), String(Math.random())); g(other, 'add', '.'); g(other, 'commit', '-qm', name); g(other, 'push', '-q', 'origin', 'HEAD:main'); };
  return { dir, app, push };
}
const make = (root, o = {}) => {
  const exits = [];
  const su = createSelfUpdate({ root, enabled: () => o.enabled !== false, idleSince: () => o.idle || 0, log: () => {}, exit: c => exits.push(c),
    git: (...a) => Promise.resolve({ stdout: execFileSync('git', ['-C', root, ...a], { env, stdio: 'pipe' }) }) });
  return { su, exits };
};

test('뒤처졌고 깨끗하면 받는다 — 감독 아래면 RESTART로 끝난다', async () => {
  const { app, push } = repos(); push();
  const old = process.env.PKM_CHILD; process.env.PKM_CHILD = '1';
  try {
    const { su, exits } = make(app);
    assert.equal(await su.check(), 'pulled');
    assert.deepEqual(exits, [RESTART]);
    assert.ok(fs.existsSync(path.join(app, 'b.txt')));
    assert.equal(su.state().pulled, 1);
  } finally { if (old == null) delete process.env.PKM_CHILD; else process.env.PKM_CHILD = old; }
});

test('감독 없이 켰으면 받기만 하고 다시 켜야 한다고 남긴다', async () => {
  const { app, push } = repos(); push();
  const old = process.env.PKM_CHILD; delete process.env.PKM_CHILD;
  try {
    const { su, exits } = make(app);
    assert.equal(await su.check(), 'restart');
    assert.deepEqual(exits, []);
  } finally { if (old != null) process.env.PKM_CHILD = old; }
});

test('최신·꺼짐·고친 파일·올리지 않은 커밋·방금 저장은 받지 않는다', async () => {
  const a = repos();
  assert.equal(await make(a.app).su.check(), 'latest');
  a.push();
  assert.equal(await make(a.app, { enabled: false }).su.check(), 'off');
  assert.equal(await make(a.app, { idle: Date.now() }).su.check(), 'busy');
  fs.writeFileSync(path.join(a.app, 'a.txt'), 'mine');
  assert.equal(await make(a.app).su.check(), 'dirty');
  assert.equal(fs.readFileSync(path.join(a.app, 'a.txt'), 'utf8'), 'mine');
  g(a.app, 'commit', '-qam', 'local');
  assert.equal(await make(a.app).su.check(), 'ahead');
});

test('받을 곳이 없는 폴더는 건드리지 않는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-su-'));
  execFileSync('git', ['init', '-q', dir], { env });
  fs.writeFileSync(path.join(dir, 'x'), '1'); g(dir, 'add', '.'); g(dir, 'commit', '-qm', 'x');
  assert.equal(await make(dir).su.check(), 'no-upstream');
});

test('감독은 RESTART면 다시 켜고, 그 밖의 끝은 그대로 따라 끝난다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-sv-'));
  const mod = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'selfupdate.js');
  const entry = path.join(dir, 'entry.mjs'), count = path.join(dir, 'n');
  fs.writeFileSync(entry, `import fs from 'node:fs';
import { supervise, RESTART } from ${JSON.stringify(mod)};
if (!process.env.PKM_CHILD) await supervise(${JSON.stringify(entry)});
else { const n = (fs.existsSync(${JSON.stringify(count)}) ? +fs.readFileSync(${JSON.stringify(count)}, 'utf8') : 0) + 1; fs.writeFileSync(${JSON.stringify(count)}, String(n)); process.exit(n < 3 ? RESTART : 7); }
`);
  const r = spawnSync(process.execPath, [entry], { env: { ...process.env, PKM_CHILD: '' }, timeout: 20000 });
  assert.equal(fs.readFileSync(count, 'utf8'), '3');
  assert.equal(r.status, 7);
});
