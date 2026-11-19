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
  const su = createSelfUpdate({ root, enabled: () => o.enabled !== false, ready: () => !o.busy, log: () => {}, exit: c => exits.push(c),
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
  assert.equal(await make(a.app, { busy: true }).su.check(), 'busy');
  g(a.app, 'commit', '-q', '--allow-empty', '-m', 'local');
  assert.equal(await make(a.app).su.check(), 'ahead');
});

test('고친 파일이 있어도 새 버전과 겹치지 않으면 치워 두고 받은 뒤 다시 얹고, 겹치면 받지 않는다', async () => {
  const a = repos(); a.push('b.txt');
  fs.writeFileSync(path.join(a.app, 'a.txt'), 'mine');
  const { su } = make(a.app);
  assert.equal(await su.check(), 'restart');
  assert.equal(su.state().kept, 1);
  assert.equal(fs.readFileSync(path.join(a.app, 'a.txt'), 'utf8'), 'mine');
  assert.ok(fs.existsSync(path.join(a.app, 'b.txt')));
  assert.equal(g(a.app, 'stash', 'list'), '');
  a.push('a.txt');
  assert.equal(await make(a.app).su.check(), 'dirty');
  assert.equal(fs.readFileSync(path.join(a.app, 'a.txt'), 'utf8'), 'mine');
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

test('겹쳐 불러도 한 번만 돌고, 남이 만든 보관함(stash)은 건드리지 않는다', async () => {
  const a = repos();
  fs.writeFileSync(path.join(a.app, 'a.txt'), 'old-stash'); g(a.app, 'stash', 'push', '-q', '-m', '사람이 둔 것');
  a.push('b.txt'); fs.writeFileSync(path.join(a.app, 'a.txt'), 'mine');
  const { su } = make(a.app);
  const [x, y] = await Promise.all([su.check(), su.check()]);
  assert.deepEqual([x, y], ['restart', 'restart']);
  assert.equal(fs.readFileSync(path.join(a.app, 'a.txt'), 'utf8'), 'mine');
  assert.match(g(a.app, 'stash', 'list'), /사람이 둔 것/);
  assert.equal(g(a.app, 'stash', 'list').split('\n').length, 1);
});

test('합치는 중이면 받지 않고, 켜지다 죽어 되돌린 버전은 다시 받지 않는다', async () => {
  const a = repos(); a.push('b.txt');
  const mh = path.join(a.app, '.git', 'MERGE_HEAD'); fs.writeFileSync(mh, g(a.app, 'rev-parse', 'HEAD'));
  assert.equal(await make(a.app).su.check(), 'merging');
  fs.rmSync(mh);
  const old = process.env.PKM_BAD_COMMIT; process.env.PKM_BAD_COMMIT = g(a.app, 'rev-parse', '@{u}');
  try { assert.equal(await make(a.app).su.check(), 'bad'); } finally { if (old == null) delete process.env.PKM_BAD_COMMIT; else process.env.PKM_BAD_COMMIT = old; }
});

test('새 버전이 켜지자마자 죽으면 감독이 전 버전으로 되돌리고 다시 켠다', () => {
  const a = repos(); const from = g(a.app, 'rev-parse', 'HEAD'); a.push('b.txt');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-rb-'));
  const mod = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'selfupdate.js');
  const entry = path.join(dir, 'entry.mjs'), log = path.join(dir, 'log');
  fs.writeFileSync(entry, `import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { supervise, RESTART } from ${JSON.stringify(mod)};
const root = ${JSON.stringify(a.app)};
if (!process.env.PKM_CHILD) await supervise(${JSON.stringify(entry)}, { root, log: () => {} });
else {
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD']).toString().trim();
  fs.appendFileSync(${JSON.stringify(log)}, head.slice(0, 7) + ' ' + (process.env.PKM_BAD_COMMIT || '-').slice(0, 7) + '\\n');
  if (!fs.existsSync(root + '/b.txt') && !process.env.PKM_BAD_COMMIT){ const from = head; execFileSync('git', ['-C', root, 'fetch', '-q']); execFileSync('git', ['-C', root, 'merge', '--ff-only', '-q', '@{u}']); const to = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD']).toString().trim(); fs.writeFileSync(process.env.PKM_UPDATE_MARK, JSON.stringify({ from, to })); process.exit(RESTART); }
  if (fs.existsSync(root + '/b.txt')) process.exit(3);   // 새 버전은 켜지다 죽는다
  process.exit(0);
}
`);
  const r = spawnSync(process.execPath, [entry], { env: { ...process.env, PKM_CHILD: '', GIT_AUTOPUSH: '0' }, timeout: 20000 });
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(g(a.app, 'rev-parse', 'HEAD'), from, '전 버전으로 돌아왔다');
  assert.notEqual(lines[2].split(' ')[1], '-', '되돌린 버전을 다음 서버에 알린다');
  assert.equal(r.status, 0);
});

test('치운 직후 다른 작업이 보관함에 쌓아도 내 항목을 찾아 다시 얹고, 남의 것은 둔다', async () => {
  const a = repos(); a.push('b.txt');
  fs.writeFileSync(path.join(a.app, 'a.txt'), 'mine');
  const raw = (...x) => Promise.resolve({ stdout: execFileSync('git', ['-C', a.app, ...x], { env, stdio: 'pipe' }) });
  const su = createSelfUpdate({ root: a.app, enabled: () => true, log: () => {}, exit: () => {},
    git: async (...x) => { const r = await raw(...x); if (x[0] === 'stash' && x[1] === 'push'){ fs.writeFileSync(path.join(a.app, 'c.txt'), 'other'); execFileSync('git', ['-C', a.app, 'add', 'c.txt'], { env }); execFileSync('git', ['-C', a.app, 'stash', 'push', '-q', '-m', '다른 작업'], { env }); } return r; } });
  assert.equal(await su.check(), 'restart');
  assert.equal(fs.readFileSync(path.join(a.app, 'a.txt'), 'utf8'), 'mine');
  assert.ok(fs.existsSync(path.join(a.app, 'b.txt')));
  assert.equal(g(a.app, 'stash', 'list').split('\n').length, 1);
  assert.match(g(a.app, 'stash', 'list'), /다른 작업/);
});
