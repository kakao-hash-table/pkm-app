// 개발 도구 플러그인(plugins/dev-tools) — 명령 찾기, --port 붙이기, 프로젝트·에이전트 목록, 개발 서버 띄우기·멈추기, domain-proxy
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

// 진짜 ~/.pkm-app·~/.nvm을 건드리지 않게 이 파일의 HOME을 임시 폴더로 — 띄우는 스크립트도 이 HOME을 받는다
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-dev-tools-')));
const HOME = path.join(tmp, 'home');
fs.mkdirSync(HOME);
process.env.HOME = HOME;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PLUGIN = new URL('../plugins/dev-tools/', import.meta.url).pathname;
const SCRIPTS = path.join(PLUGIN, 'scripts');
const dev = await import(path.join(SCRIPTS, 'devserver.mjs'));
const agents = await import(path.join(SCRIPTS, 'agents.mjs'));
const run = async (script, ...args) => {
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(SCRIPTS, script), ...args], { env: { ...process.env, HOME }, timeout: 60000 });
  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 1, `JSON 한 줄이어야 해요: ${stdout}`);
  return JSON.parse(lines[0]);
};
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text)); };
const project = (name, files) => { const d = path.join(tmp, name); for (const [f, t] of Object.entries(files)) write(path.join(d, f), t); return d; };

test('명령 찾기: dev·serve·local → start* → pnpm 워크스페이스 → gradle → 설치', () => {
  const d = project('mono', {
    'package.json': { scripts: { 'start:prod': 'node dist', build: 'tsc', dev: 'next dev', serve: 'vite preview', 'local:mock': 'node mock.js', start: 'node .', 'develop': 'x', 'dev-api': 'node api' } },
    'pnpm-lock.yaml': '', 'pnpm-workspace.yaml': 'packages: [apps/*]',
    'apps/web/package.json': { name: '@acme/web', scripts: { dev: 'vite' } },
    'apps/api/package.json': { name: 'api', scripts: { start: 'node .' } },
    'sites/docs/package.json': { scripts: { dev: 'astro dev' } },
    'gradlew': '#!/bin/sh', 'build.gradle.kts': ''
  });
  const r = dev.detect(d);
  assert.equal(r.pm, 'pnpm');
  assert.deepEqual(r.commands.map(c => c.command), ['pnpm dev', 'pnpm serve', 'pnpm local:mock', 'pnpm dev-api', 'pnpm start:prod', 'pnpm start',
    'pnpm --filter @acme/web dev', 'pnpm --filter docs dev', './gradlew bootRun', 'pnpm install']);
  assert.deepEqual(r.commands.map(c => c.port), [true, true, false, false, false, false, true, true, false, false]);
  assert.ok(r.commands.at(-1).install && r.commands.at(-2).gradle);

  assert.deepEqual(dev.detect(project('y', { 'package.json': { scripts: { start: 'react-scripts start' } }, 'yarn.lock': '' })).commands.map(c => c.command), ['yarn start', 'yarn install']);
  assert.deepEqual(dev.detect(project('n', { 'package.json': { scripts: { dev: 'node server.js' } } })).commands.map(c => c.command), ['npm run dev', 'npm install']);
  // pnpm-workspace.yaml 없이 lock만 있으면 apps/*를 보지 않는다
  assert.deepEqual(dev.detect(project('p', { 'package.json': {}, 'pnpm-lock.yaml': '', 'apps/web/package.json': { scripts: { dev: 'vite' } } })).commands.map(c => c.command), ['pnpm install']);
  const g = dev.detect(project('spring', { gradlew: '#!/bin/sh', 'build.gradle': '' }));
  assert.equal(g.pm, null);
  assert.deepEqual(g.commands.map(c => c.command), ['./gradlew bootRun']);
  assert.deepEqual(dev.detect(project('empty', { 'README.md': '' })).commands, []);
  // 노트의 Spring 프로필 명령은 gradle 프로젝트에서만, 프로필 글자만
  const sp = project('spring-prof', { gradlew: '#!/bin/sh', 'build.gradle': '' });
  assert.deepEqual(dev.detect(sp, './gradlew bootRun --args=--spring.profiles.active=dev,local').commands.map(c => c.argv),
    [['./gradlew', 'bootRun', '--args=--spring.profiles.active=dev,local'], ['./gradlew', 'bootRun']]);
  assert.deepEqual(dev.detect(sp, './gradlew bootRun --args=--spring.profiles.active=dev;rm').commands.map(c => c.command), ['./gradlew bootRun']);
  assert.deepEqual(dev.detect(project('np', { 'package.json': {} }), './gradlew bootRun --args=--spring.profiles.active=dev').commands.map(c => c.command), ['npm install']);
});

test('--port: next·vite·webpack·nuxt·astro에만, npm만 -- 뒤에(pnpm·yarn은 --까지 넘겨 next가 폴더로 읽는다)', () => {
  const c = (argv, script) => ({ argv, port: dev.detect(project('port-' + Math.random().toString(36).slice(2), { 'package.json': { scripts: { dev: script } } })).commands[0].port });
  for (const s of ['next dev', 'vite', 'vite --host', 'npx astro dev', 'webpack serve', 'webpack-dev-server --hot', 'nuxt dev', 'nuxi dev', 'cross-env A=1 next dev']) assert.equal(c(['npm', 'run', 'dev'], s).port, true, s);
  for (const s of ['node server.js', 'next-sitemap', 'node next.js', 'tsx watch src', 'rails s', 'next dev && echo done', 'node setup.js; vite', 'next build']) assert.equal(c(['npm', 'run', 'dev'], s).port, false, s);
  const on = argv => ({ argv, port: true });
  assert.deepEqual(dev.withPort(on(['npm', 'run', 'dev']), 3001), ['npm', 'run', 'dev', '--', '--port', '3001']);
  assert.deepEqual(dev.withPort(on(['pnpm', 'dev']), 3001), ['pnpm', 'dev', '--port', '3001']);
  assert.deepEqual(dev.withPort(on(['pnpm', '--filter', 'web', 'dev']), 5173), ['pnpm', '--filter', 'web', 'dev', '--port', '5173']);
  assert.deepEqual(dev.withPort(on(['yarn', 'dev']), 3001), ['yarn', 'dev', '--port', '3001']);
  assert.deepEqual(dev.withPort({ argv: ['npm', 'run', 'dev'], port: false }, 3001), ['npm', 'run', 'dev']);
  assert.deepEqual(dev.withPort({ argv: ['./gradlew', 'bootRun'], port: false, gradle: true }, 8081), ['./gradlew', 'bootRun', '--args=--server.port=8081']);
  assert.deepEqual(dev.withPort({ argv: ['./gradlew', 'bootRun', '--args=--spring.profiles.active=dev,local'], gradle: true }, 8090), ['./gradlew', 'bootRun', '--args=--spring.profiles.active=dev,local --server.port=8090']);
  assert.deepEqual(dev.withPort(on(['npm', 'run', 'dev']), null), ['npm', 'run', 'dev']);
});

test('node 버전: .nvmrc·.node-version을 ~/.nvm 버전에 맞춘다', () => {
  for (const v of ['v18.17.0', 'v18.20.4', 'v20.11.1', 'v20.9.0']) fs.mkdirSync(path.join(HOME, '.nvm/versions/node', v, 'bin'), { recursive: true });
  const nv = (file, text) => dev.nodeFor(project('nv-' + Math.random().toString(36).slice(2), { [file]: text }));
  assert.deepEqual(nv('.nvmrc', '18\n'), { want: '18', version: '18.20.4', bin: path.join(HOME, '.nvm/versions/node/v18.20.4/bin') });
  assert.equal(nv('.nvmrc', 'v18.17').version, '18.17.0');
  assert.equal(nv('.node-version', '20').version, '20.11.1');
  assert.equal(nv('.nvmrc', '18.1').version, '18.20.4');   // 18.1은 없으니 같은 주 버전에서 가장 높은 것
  assert.equal(nv('.nvmrc', '20.12.0').version, '20.11.1');   // .nvmrc 24.11.1에 nvm 24.22.1만 있을 때처럼
  assert.deepEqual(nv('.nvmrc', '22'), { want: '22', version: null, bin: null });
  assert.equal(nv('.nvmrc', 'lts/*').version, null);
  assert.equal(dev.nodeFor(project('nv-none', { 'package.json': {} })), null);
});

test('projects.mjs와 devserver.mjs의 공통 코드가 같다', () => {
  const block = f => { const t = fs.readFileSync(path.join(SCRIPTS, f), 'utf8'); return t.slice(t.indexOf('// ---- 공통:'), t.indexOf('// ---- 공통 끝 ----')); };
  assert.ok(block('devserver.mjs').length > 1000);
  assert.equal(block('projects.mjs'), block('devserver.mjs'));
});

test('프로젝트 목록: 폴더/* 펼치기, 항목 모양, 없는 폴더는 note', async () => {
  const root = path.join(tmp, 'code');
  project('code/alpha', { 'package.json': { scripts: { dev: 'vite' } }, '.nvmrc': '20' });
  project('code/beta', { gradlew: '', 'build.gradle': '' });
  project('code/.hidden', { 'package.json': {} });
  write(path.join(root, 'notes.txt'), 'not a folder');
  const single = project('single', { 'package.json': { scripts: { start: 'node .' } } });
  execFileSync('git', ['init', '-q', '-b', 'feature/x', single]);
  fs.symlinkSync(single, path.join(root, 'linked'));

  const r = await run('projects.mjs', 'list', `--projects=${root}/*\n# 주석\n${single}\n${path.join(tmp, 'nope')}\n${single}`);
  assert.deepEqual(r.items.map(i => i.title), ['alpha', 'beta', 'linked', 'single']);
  const [alpha, beta, linked, one] = r.items;
  const { project: controls, busy, log, pid: unusedPid, ...vars } = alpha.vars;
  assert.equal(JSON.parse(controls).commands[0].script, 'vite');
  assert.ok(Array.isArray(JSON.parse(busy)));
  assert.deepEqual({ ...alpha, vars }, { id: path.join(root, 'alpha'), title: 'alpha', url: '', meta: ['멈춤', 'npm run dev', 'node 20.11.1'], tags: [], detail: [], vars: { path: path.join(root, 'alpha'), name: 'alpha', command: 'npm run dev', port: '', avoid: '' } });
  assert.deepEqual(beta.meta, ['멈춤', './gradlew bootRun']);
  assert.equal(linked.id, path.join(root, 'linked'));
  assert.deepEqual(one.meta, ['멈춤', 'npm run start', 'feature/x']);
  assert.match(r.note, /찾지 못한 폴더: .*nope/);

  // ~ 펼치기와 빈 설정
  fs.mkdirSync(path.join(HOME, 'proj-in-home'));
  assert.deepEqual((await run('projects.mjs', 'list', '--projects=~/proj-in-home')).items.map(i => i.id), [path.join(HOME, 'proj-in-home')]);
  const empty = await run('projects.mjs', 'list', '--projects=');
  assert.deepEqual(empty.items, []);
  assert.match(empty.note, /프로젝트/);
});

test('FE 프로젝트 노트: 로컬 폴더를 더하고, 노트의 실행 명령(찾은 명령일 때만)을 띄울 명령으로, 배포·브랜치 한 줄', async () => {
  const profile = path.join(tmp, 'profile'), notes = path.join(profile, '01_지식', '맥락노트', 'FE 프로젝트');
  const web = project('fe/web', { 'package.json': { scripts: { dev: 'vite', 'dev:mock': 'vite --mode mock' } } });
  const odd = project('fe/odd', { 'package.json': { scripts: { dev: 'vite' } } });
  write(path.join(notes, 'web.md'), `---
type: context
---
# 내용
- 레포: a/web
- 로컬: ${web}
- 실행: \`npm run dev:mock\` · 목 서버로 (명시)
- 배포: Jenkins · real은 금요일 (관례)
- 브랜치: feature/* → develop → main (관례)
`);
  write(path.join(notes, 'odd.md'), `# 내용
- 레포: a/odd
- 로컬: ${odd}
- 실행: \`rm -rf /\` · 노트가 틀려도 찾은 명령만 띄운다
`);
  write(path.join(notes, 'gone.md'), `# 내용
- 레포: a/gone
- 로컬: ${path.join(tmp, 'fe/없음')}
`);

  const r = await run('projects.mjs', 'list', `--projects=${web}`, '--fe=FE 프로젝트', `--profile=${profile}`);
  assert.deepEqual(r.items.map(i => i.title), ['web', 'odd']);   // 설정 폴더와 겹치면 한 번, 없는 폴더는 뺀다
  const [w, o] = r.items;
  assert.equal(w.vars.command, 'npm run dev:mock');
  assert.deepEqual(w.detail, [{ text: '브랜치 feature/* → develop → main (관례) · 배포 Jenkins' }]);
  assert.equal(o.vars.command, 'npm run dev');
  assert.equal(w.vars.port, '');
  const pr = await import(path.join(SCRIPTS, 'projects.mjs'));
  assert.equal(pr.portOf({ 실행: '`./gradlew bootRun` · 포트 8090 · mmap-hash.fedev.kakao.com' }), 8090);
  assert.equal(pr.portOf({ 실행: '`pnpm dev` · 포트 99999' }), null);
  // 묶음을 비우면 노트를 보지 않는다
  assert.deepEqual((await run('projects.mjs', 'list', `--projects=${web}`, '--fe=', `--profile=${profile}`)).items.map(i => i.title), ['web']);
});

test('에이전트 목록: 프런트매터 읽기', async () => {
  const d = path.join(tmp, 'agents');
  write(path.join(d, 'reviewer.md'), '---\nname: code-reviewer\ndescription: "리뷰어: 변경을 읽고\\n지적만 한다"\nmodel: sonnet\ntools: Read, Grep\n---\n\n프롬프트 본문\n');
  write(path.join(d, 'writer.md'), "---\nname: 'writer'\ndescription: >\n  글을 쓰는\n  에이전트\ntools:\n  - Read\n  - Write\nmodel: opus\n---\n본문\n");
  write(path.join(d, 'plain.md'), '그냥 글\n');
  write(path.join(d, '.draft.md'), '---\nname: draft\n---\n');
  write(path.join(d, 'notes.txt'), 'x');
  assert.deepEqual(agents.frontmatter(fs.readFileSync(path.join(d, 'writer.md'), 'utf8')), { name: 'writer', description: '글을 쓰는 에이전트', tools: 'Read, Write', model: 'opus' });
  assert.deepEqual(agents.frontmatter('---\ntools: [Read, "Bash"]\n---\n'), { tools: 'Read, Bash' });

  const r = await run('agents.mjs', 'list', `--dirs=${d}\n${path.join(tmp, 'no-agents')}`);
  assert.deepEqual(r.items.map(i => i.title), ['code-reviewer', 'plain', 'writer']);
  assert.deepEqual(r.items[0], { id: path.join(d, 'reviewer.md'), title: 'code-reviewer', meta: ['리뷰어: 변경을 읽고 지적만 한다', 'sonnet', d], vars: { path: path.join(d, 'reviewer.md'), dir: d, name: 'code-reviewer' } });
  assert.deepEqual(r.items[1].meta, [d]);
  assert.match(r.note, /no-agents/);
  const long = path.join(HOME, '.claude/agents/long.md');
  write(long, `---\nname: long\ndescription: ${'가'.repeat(200)}\n---\n`);
  const h = await run('agents.mjs', 'list', '--dirs=~/.claude/agents');
  assert.equal(h.items[0].meta[0].length, 80);
  assert.equal(h.items[0].meta[1], '~/.claude/agents');
});

const freePort = () => new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const get = async url => { try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return await r.text(); } catch { return null; } };

test('개발 서버: 띄운 스크립트가 끝나도 서버는 돌고, 상태에 주소가 보이고, 멈추면 꺼진다', { timeout: 90000 }, async () => {
  const d = project('web-app', {
    'package.json': { name: 'web-app', scripts: { dev: 'node server.js', build: 'echo' } },
    'server.js': "require('http').createServer((q, s) => s.end('hello ' + process.pid)).listen(Number(process.env.PORT), () => console.log('ready', process.env.PORT));"
  });
  let pid = null;
  after(() => { if (pid) try { process.kill(-pid, 'SIGKILL'); } catch {} });

  const pick = await run('devserver.mjs', 'pick', `--path=${d}`);
  assert.deepEqual(pick.ask.choices.map(c => c.value), ['npm run dev', 'npm install']);
  assert.equal(pick.ask.choices[0].recommended, true);
  assert.deepEqual(await run('devserver.mjs', 'pick', `--path=${d}`, '--answer=npm run dev'), { command: 'npm run dev', summary: 'npm run dev' });
  assert.match((await run('devserver.mjs', 'start', `--path=${d}`, '--command=rm -rf /', '--answer=3000').catch(e => JSON.parse(e.stdout))).error, /찾은 명령이 아니에요/);

  const ask = await run('devserver.mjs', 'start', `--path=${d}`, '--command=npm run dev');
  assert.equal(ask.ask.free, true);
  assert.match(ask.ask.placeholder, /^\d+$/);

  const port = await freePort();
  const started = await run('devserver.mjs', 'start', `--path=${d}`, '--command=npm run dev', `--answer=${port}`);
  // 여기까지 오면 start 스크립트(작업)는 이미 끝났다
  const url = `http://localhost:${port}/`;
  assert.equal(started.summary, `${url} 에서 실행 중`);
  pid = started.pid;
  assert.equal(Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim()), pid, '새 프로세스 그룹의 우두머리여야 해요');
  await new Promise(r => setTimeout(r, 500));
  assert.match(await get(`http://127.0.0.1:${port}/`), /^hello \d+$/);

  const st = await run('devserver.mjs', 'status', `--path=${d}`);
  assert.equal(st.running, true);
  assert.equal(st.url, url);
  assert.equal(st.summary, `${url} 에서 실행 중`);
  const state = JSON.parse(fs.readFileSync(path.join(HOME, '.pkm-app/dev-tools/web-app.json'), 'utf8'));
  assert.deepEqual({ pid: state.pid, command: state.command, port: state.port, cwd: state.cwd }, { pid, command: 'npm run dev', port, cwd: d });
  assert.ok(state.startedAt);
  assert.match(fs.readFileSync(path.join(HOME, '.pkm-app/dev-tools/web-app.log'), 'utf8').split('\n')[0], new RegExp(`^\\$ npm run dev # ${d} · node \\S+ · 포트 ${port}$`));

  const listed = (await run('projects.mjs', 'list', `--projects=${d}`)).items[0];
  assert.deepEqual([listed.meta[0], listed.tags, listed.url, listed.vars.url], [`실행 중 · ${url}`, ['실행 중'], url, url]);
  assert.equal((await run('devserver.mjs', 'pick', `--path=${d}`)).summary, `이미 ${url} 에서 실행 중이에요`);
  assert.equal((await run('devserver.mjs', 'start', `--path=${d}`, '--command=npm run dev', `--answer=${port}`)).summary, `이미 ${url} 에서 실행 중이에요`);

  const stopped = await run('devserver.mjs', 'stop', `--path=${d}`);
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.summary, `멈췄어요 (포트 ${port})`);
  assert.equal(await get(`http://127.0.0.1:${port}/`), null);
  assert.equal((await run('devserver.mjs', 'status', `--path=${d}`)).running, false);
  assert.equal((await run('devserver.mjs', 'stop', `--path=${d}`)).summary, '이미 멈춰 있어요');
  pid = null;

  // 다시 띄울 때 지난 포트를 먼저 권한다
  assert.equal((await run('devserver.mjs', 'start', `--path=${d}`, '--command=npm run dev')).ask.placeholder, String(port));
});

test('띄우기 한 번에(up): 묻지 않고 넘겨받은 명령·빈 포트로 띄우고, [명령·포트 바꾸기]면 명령 → 포트를 묻는다', { timeout: 90000 }, async () => {
  const d = project('one-click', {
    'package.json': { name: 'one-click', scripts: { dev: 'node server.js', 'dev:alt': 'node server.js' } },
    'server.js': "require('http').createServer((q, s) => s.end('ok')).listen(Number(process.env.PORT));"
  });
  let pid = null;
  after(() => { if (pid) try { process.kill(-pid, 'SIGKILL'); } catch {} });

  // 찾은 명령이 아니면(노트가 틀렸거나 '-') 띄우지 않고 고르게 묻는다
  const bad = await run('devserver.mjs', 'up', `--path=${d}`, '--command=rm -rf /');
  assert.deepEqual(bad.ask.choices.map(c => c.value), ['cmd=npm run dev', 'cmd=npm run dev:alt', 'npm install']);
  assert.match(bad.ask.hint, /찾은 명령이 아니에요/);
  assert.equal(bad.ask.inline, true);
  assert.doesNotMatch((await run('devserver.mjs', 'up', `--path=${d}`, '--command=-')).ask.hint, /찾은 명령이 아니에요/);
  assert.ok((await run('devserver.mjs', 'up', `--path=${d}`, '--command=npm run dev', '--answer=?')).ask, '[명령 바꾸기]는 묻는다');

  const up = await run('devserver.mjs', 'up', `--path=${d}`, '--command=npm run dev', '--answer=npm run dev:alt');
  pid = up.pid;
  assert.match(up.summary, /^http:\/\/localhost:\d+\/ 에서 실행 중$/);
  assert.equal(up.command, 'npm run dev:alt');
  assert.deepEqual(up.change, { label: '명령·포트 바꾸기', value: '?' });
  assert.match(await get(up.url.replace('localhost', '127.0.0.1')), /^ok$/);
  // 목록은 지난번에 띄운 명령을 띄울 명령으로 둔다
  assert.equal((await run('projects.mjs', 'list', `--projects=${d}`)).items[0].vars.command, 'npm run dev:alt');
  assert.match((await run('devserver.mjs', 'up', `--path=${d}`, '--command=npm run dev')).summary, /^이미 .* 실행 중이에요$/);
  await run('devserver.mjs', 'stop', `--path=${d}`);
  pid = null;

  // 노트의 포트가 비어 있으면 그 포트로
  const want = await freePort();
  const fixed = await run('devserver.mjs', 'up', `--path=${d}`, '--command=npm run dev', `--port=${want}`);
  pid = fixed.pid;
  assert.equal(fixed.port, want);
  await run('devserver.mjs', 'stop', `--path=${d}`);
  pid = null;

  // 다시 띄우면 (포트를 안 주면) 지난 포트를 그대로 쓴다
  const again = await run('devserver.mjs', 'up', `--path=${d}`, '--command=npm run dev');
  pid = again.pid;
  assert.equal(again.port, want);
  await run('devserver.mjs', 'stop', `--path=${d}`);
  pid = null;
});

test('개발 서버: 바로 죽으면 기록 끝을 보여 준다', { timeout: 60000 }, async () => {
  const d = project('broken', { 'package.json': { scripts: { dev: 'node -e "console.error(\'boom-err\'); process.exit(3)"' } } });
  const port = await freePort();
  const r = await run('devserver.mjs', 'start', `--path=${d}`, '--command=npm run dev', `--answer=${port}`).catch(e => JSON.parse(e.stdout));
  assert.match(r.error, /바로 멈췄어요/);
  assert.match(r.error, /boom-err/);
});

test('검사기가 개발 도구 플러그인을 받는다', () => {
  const P = createRequire(import.meta.url)('../web/js/pkm-plugin.js');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const r = P.validate(walk(PLUGIN).map(f => ({ path: path.relative(PLUGIN, f), size: fs.statSync(f).size, text: fs.readFileSync(f, 'utf8') })));
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.manifest.id, 'dev-tools');
  assert.deepEqual(r.workflows.map(w => w.name), ['띄우기', '멈추기', '포트 종료', 'Cursor로 열기', '프록시 띄우기', '프록시 멈추기', 'fedev 등록', '도메인 더하기', '포트 바꾸기', '도메인 지우기', 'AI로 고치기', 'AI 사용성 점검', 'AI로 에이전트 고치기']);
  assert.equal(r.workflows[0].steps.length, 1, '띄우기는 한 단계(묻지 않고 바로)');
  assert.equal(P.parseFeeds(fs.readFileSync(path.join(PLUGIN, 'feeds/개발.md'), 'utf8'))[0].view, 'inline');   // 실행기는 parseFeeds 그대로 쓴다
  assert.deepEqual(r.feeds.map(f => f.name), ['프로젝트', 'domain-proxy', '도메인', '에이전트']);
  assert.equal(P.parseFeeds(fs.readFileSync(path.join(PLUGIN, 'feeds/개발.md'), 'utf8'))[0].search, '프로젝트 이름·명령·브랜치로 찾기', '프로젝트 목록에 찾는 칸');
  assert.equal(r.workflows.find(w => w.name === 'AI로 고치기').steps[0].kind, 'ask');
});

// 가짜 domain-proxy.js — run이면 PROXY_PORT에서 듣고, apply면 한 줄 찍고 끝난다. ROUTES 밖의 코드·주석은 그대로 남아야 한다
const fakeProxy = (port, routes) => {
  const f = path.join(tmp, `dkos-${port}`, 'domain-proxy.js');
  write(f, `#!/usr/bin/env node
// 위 설명 [괄호] 'quote'
const ROUTES = ${routes};
const PROXY_PORT = ${port}; // 8443;
const LDAP_ID = 'hash';
if (process.argv[2] === 'run') require('http').createServer((q, s) => s.end('proxy')).listen(PROXY_PORT, () => console.log('[ok] listening'));
else if (process.argv[2] === 'apply') console.log('\\x1b[32m[ok]\\x1b[0m applied ' + ROUTES.length);
else process.exit(2);
`);
  return f;
};

test('domain-proxy: ROUTES 블록만 읽고 고친다(백업, 프록시 포트·겹치는 포트 막기, 원격 경로 그대로)', async () => {
  const f = fakeProxy(18080, `[
  {
    base: 'map-hash.fedev.kakao.com',
    port: 8084, // 주석 ] 괄호
    remote: { target: 'https://sandbox-map.devel.kakao.com', paths: ['/favorite/config'] },
  },
  { base: 'place-hash.fedev.kakao.com', port: 8086 },
]`);
  const dp = await import(path.join(SCRIPTS, 'domain-proxy.mjs'));
  const r = dp.readProxy(f);
  assert.equal(r.port, 18080);
  assert.deepEqual(r.routes.map(x => [x.base, x.port]), [['map-hash.fedev.kakao.com', 8084], ['place-hash.fedev.kakao.com', 8086]]);

  // 도메인 목록: 띄운 적 있는 프로젝트를 이름·포트로 붙인다
  write(path.join(HOME, '.pkm-app/dev-tools/place.json'), { cwd: path.join(tmp, 'place'), port: 8086, pid: null });
  const items = (await run('domain-proxy.mjs', 'routes', `--script=${f}`)).items;
  assert.deepEqual(items.map(i => i.vars.port), ['8084', '8086']);
  assert.match(items[1].meta.join(' '), /place · 멈춤/);

  // 포트를 물을 때 프록시 포트·다른 도메인 포트를 피한다
  const ask = (await run('domain-proxy.mjs', 'set', `--script=${f}`, '--base=place-hash.fedev.kakao.com')).ask;
  assert.equal(ask.choices[0].value, '8086');
  assert.ok(ask.free);
  assert.match((await run('domain-proxy.mjs', 'set', `--script=${f}`, '--base=place-hash.fedev.kakao.com', '--answer=18080')).ask.hint, /프록시가 듣는 포트/);
  assert.match((await run('domain-proxy.mjs', 'set', `--script=${f}`, '--base=place-hash.fedev.kakao.com', '--answer=8084')).ask.hint, /map-hash/);
  assert.match((await run('domain-proxy.mjs', 'set', `--script=${f}`, '--base=place-hash.fedev.kakao.com', '--answer=abc')).ask.hint, /포트 번호가 아니에요/);

  const before = fs.readFileSync(f, 'utf8');
  const set = await run('domain-proxy.mjs', 'set', `--script=${f}`, '--base=place-hash.fedev.kakao.com', '--answer=8087');
  assert.equal(set.summary, 'place-hash.fedev.kakao.com → :8087로 바꿨어요');
  assert.equal(fs.readFileSync(f + '.pkm.bak', 'utf8'), before);
  const after_ = fs.readFileSync(f, 'utf8');
  assert.ok(after_.startsWith('#!/usr/bin/env node\n// 위 설명 [괄호] \'quote\'\nconst ROUTES = ['));
  assert.ok(after_.includes("const PROXY_PORT = 18080; // 8443;\nconst LDAP_ID = 'hash';"));
  const r2 = dp.readProxy(f);
  assert.deepEqual(r2.routes[0].remote, { target: 'https://sandbox-map.devel.kakao.com', paths: ['/favorite/config'] });
  assert.equal(r2.routes[1].port, 8087);

  // 더하기: 꼴이 틀리면 다시 묻고, 있는 도메인이면 막고, 새 도메인은 포트를 받아 끝에 붙인다
  assert.match((await run('domain-proxy.mjs', 'add', `--script=${f}`, '--answer=evil.com')).ask.hint, /도메인 꼴이 아니에요/);
  assert.match((await run('domain-proxy.mjs', 'add', `--script=${f}`, '--answer=map-hash.fedev.kakao.com').catch(e => JSON.parse(e.stdout))).error, /이미 있는 도메인/);
  assert.deepEqual(await run('domain-proxy.mjs', 'add', `--script=${f}`, '--answer=Applink-hash.fedev.kakao.com'), { base: 'applink-hash.fedev.kakao.com', summary: 'applink-hash.fedev.kakao.com' });
  const add = await run('domain-proxy.mjs', 'set', `--script=${f}`, '--base=applink-hash.fedev.kakao.com', '--answer=8082');
  assert.match(add.summary, /더했어요 · \[fedev 등록\]/);
  assert.deepEqual(dp.readProxy(f).routes.map(x => x.port), [8084, 8087, 8082]);

  // 지우기는 한 번 묻는다
  assert.equal((await run('domain-proxy.mjs', 'remove', `--script=${f}`, '--base=applink-hash.fedev.kakao.com')).ask.choices[0].value, 'yes');
  await run('domain-proxy.mjs', 'remove', `--script=${f}`, '--base=applink-hash.fedev.kakao.com', '--answer=yes');
  assert.equal(dp.readProxy(f).routes.length, 2);

  // 원격 주소에 따옴표를 넣는 식으로 파일을 깨뜨릴 수 없다
  assert.throws(() => dp.normalize([{ base: 'a-hash.fedev.kakao.com', port: 1, remote: { target: "https://x/'+require('fs')", paths: ['/a'] } }], 8080), /원격 주소/);
  assert.throws(() => dp.normalize([{ base: "a'.fedev.kakao.com", port: 1 }], 8080), /도메인 꼴/);
});

test('domain-proxy: 띄우기·멈추기·fedev 등록', { timeout: 60000 }, async () => {
  const port = await freePort();
  const f = fakeProxy(port, `[{ base: 'place-hash.fedev.kakao.com', port: 8086 }]`);
  let pid = null;
  after(() => { if (pid) try { process.kill(pid, 'SIGKILL'); } catch {} });
  assert.equal((await run('domain-proxy.mjs', 'list', `--script=${f}`)).items[0].meta[0], '멈춤');
  const up = await run('domain-proxy.mjs', 'run', `--script=${f}`);
  pid = up.pid;
  assert.equal(up.summary, `:${port}에서 실행 중`);
  assert.equal(await get(`http://127.0.0.1:${port}/`), 'proxy');
  assert.match((await run('domain-proxy.mjs', 'list', `--script=${f}`)).items[0].meta[0], /^실행 중/);
  assert.match((await run('domain-proxy.mjs', 'run', `--script=${f}`)).summary, /이미/);
  // 실행 중에 포트를 바꾸면 다시 띄운다
  const set = await run('domain-proxy.mjs', 'set', `--script=${f}`, '--base=place-hash.fedev.kakao.com', '--answer=8090');
  assert.match(set.summary, /다시 띄웠어요$/);
  pid = (await run('domain-proxy.mjs', 'status', `--script=${f}`)).pid;
  assert.notEqual(pid, up.pid);
  const down = await run('domain-proxy.mjs', 'stop', `--script=${f}`);
  assert.equal(down.stopped, true);
  pid = null;
  assert.equal(await get(`http://127.0.0.1:${port}/`), null);
  assert.equal((await run('domain-proxy.mjs', 'stop', `--script=${f}`)).summary, '이미 멈춰 있어요');

  const ap = await run('domain-proxy.mjs', 'apply', `--script=${f}`);
  assert.equal(ap.log_tail, '[ok] applied 1');
  const none = await run('domain-proxy.mjs', 'list', `--script=${path.join(tmp, 'nope.js')}`);
  assert.deepEqual(none.items, []);
  assert.match(none.note, /domain-proxy.js가 없어요/);
});

test('프로젝트 포트: 노트 → 지난번 → 닮은 도메인 → 비움, 프록시 포트는 쓰지 않는다', async () => {
  const f = fakeProxy(8080, `[{ base: 'place-hash.fedev.kakao.com', port: 8086 }, { base: 'mmap-hash.fedev.kakao.com', port: 8080 }, { base: 'applink-hash.fedev.kakao.com', port: 8082 }]`);
  const root = path.join(tmp, 'cc');
  for (const n of ['place', 'place-phocus', 'applink-web', 'mmap', 'other']) project(path.join('cc', n), { 'package.json': { scripts: { dev: 'vite' } } });
  const list = async () => Object.fromEntries((await run('projects.mjs', 'list', `--projects=${root}/*`, `--proxy=${f}`)).items.map(i => [i.title, i]));
  let items = await list();
  assert.equal(items.place.vars.port, '8086');
  assert.ok(items.place.meta.includes('포트 8086(place-hash)'));
  assert.equal(items['place-phocus'].vars.port, '', '이름이 똑같은 프로젝트가 있는 도메인은 앞부분만 닮은 프로젝트에 권하지 않는다');
  assert.equal(items['applink-web'].vars.port, '8082');
  assert.equal(items.mmap.vars.port, '', '프록시 포트는 권하지 않는다');
  assert.equal(items.other.vars.avoid, '8080');
  // 지난번 포트가 도메인보다 먼저
  write(path.join(HOME, '.pkm-app/dev-tools/place.json'), { cwd: path.join(root, 'place'), port: 9001, pid: null });
  items = await list();
  assert.equal(items.place.vars.port, '9001');
  assert.ok(items.place.meta.includes('포트 9001(지난번)'));
  // 설정이 비면 domain-proxy를 보지 않는다
  assert.equal((await run('projects.mjs', 'list', `--projects=${root}/other`, '--proxy=')).items[0].vars.avoid, '');
});

test('개발 서버 띄우기(up): --avoid 포트는 넘겨받아도 쓰지 않는다', { timeout: 60000 }, async () => {
  const d = project('avoid-app', {
    'package.json': { name: 'avoid-app', scripts: { dev: 'node server.js' } },
    'server.js': "require('http').createServer((q, s) => s.end('ok')).listen(Number(process.env.PORT));"
  });
  const bad = await freePort();
  const up = await run('devserver.mjs', 'up', `--path=${d}`, '--command=npm run dev', `--port=${bad}`, `--avoid=${bad}`);
  after(() => { try { process.kill(-up.pid, 'SIGKILL'); } catch {} });
  assert.notEqual(up.port, bad);
  await run('devserver.mjs', 'stop', `--path=${d}`);
});

test('띄우기(up): 정한 포트를 다른 프로그램이 쓰면 묻고, 끄고 띄우거나 다른 포트로 띄운다. 죽으면 오류 이름을 보인다', { timeout: 90000 }, async () => {
  const d = project('busy-app', {
    'package.json': { name: 'busy-app', scripts: { dev: 'node server.js', 'dev:fixed': 'node fixed.js' } },
    'server.js': "require('http').createServer((q, s) => s.end('ok')).listen(Number(process.env.PORT));",
    'fixed.js': "require('http').createServer((q, s) => s.end('ok')).listen(Number(process.env.FIXED));"   // 스크립트에 박힌 포트
  });
  const kids = [];
  after(() => { for (const p of kids) try { process.kill(-p, 'SIGKILL'); } catch {} });
  // 다른 프로그램이 듣는 포트 — 떼어 띄운 node
  const hold = await freePort();
  const holder = (await import('node:child_process')).spawn(process.execPath, ['-e', `require('http').createServer(()=>{}).listen(${hold})`], { detached: true, stdio: 'ignore' });
  kids.push(holder.pid);
  for (let i = 0; i < 50 && !dev.portOwner(hold); i++) await new Promise(r => setTimeout(r, 100));

  const ask = (await run('devserver.mjs', 'up', `--path=${d}`, '--command=npm run dev', `--port=${hold}`)).ask;
  assert.match(ask.question, new RegExp(`${hold}번을 이미 쓰고 있어요`));
  assert.match(ask.hint, /PID \d+/);
  const kill = ask.choices.find(c => c.value.startsWith('kill='));
  assert.ok(kill && kill.confirm, '끄고 띄우기는 한 번 더 묻는다');
  const other = ask.choices.find(c => c.recommended);
  assert.match(other.value, /^run=\d+\|npm run dev$/);
  assert.ok(ask.inline && ask.free);

  // 다른 포트로
  const moved = await run('devserver.mjs', 'up', `--path=${d}`, '--command=npm run dev', `--answer=${other.value}`);
  kids.push(moved.pid);
  assert.equal(moved.port, Number(other.value.slice(4).split('|')[0]));
  await run('devserver.mjs', 'stop', `--path=${d}`);

  // 끄고 그 포트로
  const took = await run('devserver.mjs', 'up', `--path=${d}`, '--command=npm run dev', `--answer=${kill.value}`);
  kids.push(took.pid);
  assert.equal(took.port, hold);
  assert.equal(await get(`http://127.0.0.1:${hold}/`), 'ok');
  // 이제 그 포트는 이 프로젝트 것 — 다른 프로젝트가 그 포트를 원하면 프로젝트 이름으로 알린다
  const d2 = project('busy-app2', { 'package.json': { name: 'busy-app2', scripts: { dev: 'node server.js' } }, 'server.js': 'setInterval(()=>{},1000)' });
  assert.match((await run('devserver.mjs', 'up', `--path=${d2}`, '--command=npm run dev', `--port=${hold}`)).ask.hint, /busy-app\(PID/);
  await run('devserver.mjs', 'stop', `--path=${d}`);

  // [명령·포트 바꾸기]: 명령을 고르면 포트를 묻고, 적은 번호는 고른 명령으로
  const pick = (await run('devserver.mjs', 'up', `--path=${d}`, '--command=npm run dev', '--answer=cmd=npm run dev:fixed')).ask;
  assert.match(pick.question, /npm run dev:fixed을\(를\) 몇 번 포트로/);

  // 스크립트에 박힌 포트를 누가 쓰고 있으면, 띄운 뒤 죽은 기록을 보고 다시 묻는다
  const hold2 = await freePort();
  const holder2 = (await import('node:child_process')).spawn(process.execPath, ['-e', `require('http').createServer(()=>{}).listen(${hold2})`], { detached: true, stdio: 'ignore' });
  kids.push(holder2.pid);
  await new Promise(r => setTimeout(r, 500));
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(SCRIPTS, 'devserver.mjs'), 'up', `--path=${d}`, '--command=npm run dev', `--answer=${await freePort()}`], { env: { ...process.env, HOME, FIXED: String(hold2) } })
    .catch(e => e);
  const crash = JSON.parse(stdout.trim());
  assert.ok(crash.ask, stdout);
  assert.match(crash.ask.hint, new RegExp(`EADDRINUSE · ${hold2}번`));
  assert.ok(crash.ask.choices.some(c => c.value.startsWith(`kill=${hold2}|`)));

  assert.equal(dev.errorName('Invalid project directory provided, no such directory: /x/--port'), 'next 인자 오류 · 포트 인자가 폴더 이름으로 넘어갔어요');
  assert.match(dev.errorName(' WARN  Unsupported engine: wanted: {"node":"24.x"} (current: {"node":"v22.23.4","pnpm":"10"})\n ELIFECYCLE  Command failed with exit code 1.'), /^node 버전 · 24\.x이 필요한데 v22\.23\.4/);
  assert.equal(dev.errorName(' ELIFECYCLE  Command failed with exit code 3.'), 'ELIFECYCLE · 스크립트가 코드 3로 끝났어요');
});

test('GUI PATH: pnpm이 다른 nvm에만 있어도 프로젝트 node로 실행하고, 선택 명령·포트를 기억한다', { timeout: 30000 }, async () => {
  const d = project('gui-path', {
    'package.json': { scripts: { dev: 'node server.js', 'dev:mock': 'node server.js' } },
    'pnpm-lock.yaml': '', '.nvmrc': '20',
    'server.js': "require('http').createServer((q,s)=>s.end(process.version)).listen(Number(process.env.PORT));"
  });
  const bin = path.join(HOME, '.nvm/versions/node/v18.17.0/bin');
  write(path.join(bin, 'pnpm'), '#!/bin/sh\nexec node server.js "$@"\n'); fs.chmodSync(path.join(bin, 'pnpm'), 0o755);
  const env = dev.launchEnv(d, { PATH: '/usr/bin:/bin', KEEP_SETTING: 'unchanged' });
  assert.equal(env.PATH.split(path.delimiter)[0], path.join(HOME, '.nvm/versions/node/v20.11.1/bin'));
  assert.ok(env.PATH.split(path.delimiter).includes(bin)); assert.equal(env.KEEP_SETTING, 'unchanged');
  const port = await freePort();
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(SCRIPTS, 'devserver.mjs'), 'up', `--path=${d}`, '--command=pnpm dev:mock', `--port=${port}`], { env: { ...process.env, PATH: '/usr/bin:/bin' }, timeout: 15000 });
  const up = JSON.parse(stdout); after(() => { try { process.kill(-up.pid, 'SIGKILL'); } catch {} });
  assert.equal(up.port, port); assert.match(await get(`http://127.0.0.1:${port}/`), /^v\d/);
  await run('devserver.mjs', 'stop', `--path=${d}`);
  const it = (await run('projects.mjs', 'list', `--projects=${d}`)).items[0];
  assert.equal(it.vars.command, 'pnpm dev:mock'); assert.equal(it.vars.port, String(port));
});

test('기존 웹 설정: ~/cc 별칭을 실제 경로로 맞추고 읽기만, 이후 저장한 선택이 노트보다 우선', async () => {
  const d = project('legacy-backend', { gradlew: '', 'build.gradle': '' }), old = path.join(tmp, 'old-ports.json');
  fs.mkdirSync(path.join(HOME, 'cc'), { recursive: true }); fs.symlinkSync(d, path.join(HOME, 'cc', 'mw'));
  write(old, { mw: 8090, bad: 99999 });
  const pr = await import(path.join(SCRIPTS, 'projects.mjs'));
  const legacy = pr.legacyPorts(old); assert.equal(legacy[d], 8090);
  assert.deepEqual(pr.portPlan(d, null, { port: 8080, routes: [] }, [], legacy), { port: 8090, why: '기존 웹' });
  write(dev.statePath(d), { cwd: d, selected: './gradlew bootRun', port: 8091 });
  assert.equal(pr.portPlan(d, { 실행: '포트 8090' }, { port: 8080, routes: [] }, [], legacy).port, 8091);
  assert.deepEqual(JSON.parse(fs.readFileSync(old, 'utf8')), { mw: 8090, bad: 99999 });
});

test('포트 종료: 화면이 본 PID가 바뀌면 새 프로세스를 끄지 않는다', { timeout: 15000 }, async () => {
  const port = await freePort(), d = project('free-port-ui', { 'package.json': {} });
  const holder = (await import('node:child_process')).spawn(process.execPath, ['-e', `require('http').createServer(()=>{}).listen(${port})`], { detached: true, stdio: 'ignore' });
  after(() => { try { process.kill(-holder.pid, 'SIGKILL'); } catch {} });
  for (let i = 0; i < 30 && !dev.portOwner(port); i++) await new Promise(r => setTimeout(r, 100));
  const result = await run('devserver.mjs', 'free', `--path=${d}`, `--port=${port}`, `--pid=${holder.pid + 1}`, '--answer=yes').catch(e => JSON.parse(e.stdout));
  assert.match(result.error, /프로그램이 바뀌었어요/); assert.equal(await dev.portFree(port), false);
  const freed = await run('devserver.mjs', 'free', `--path=${d}`, `--port=${port}`, `--pid=${holder.pid}`, '--answer=yes');
  assert.match(freed.summary, /포트를 비웠어요/); assert.equal(await dev.portFree(port), true);
});

test('프로젝트 목록이 64KB를 넘어도 JSON을 끝까지 출력한다', { timeout: 30000 }, async () => {
  const root = path.join(tmp, 'large-list');
  for (let i = 0; i < 20; i++){
    const d = project(`large-list/large-${i}`, { 'package.json': {scripts:{dev:'node server.js'}} });
    write(dev.logPath(d), 'large log line\n'.repeat(400));
  }
  const result = await run('projects.mjs','list',`--projects=${root}/*`);
  assert.equal(result.items.length,20);assert.ok(JSON.stringify(result).length > 65536);
  assert.ok(result.items.every(it=>it.vars.log.endsWith('large log line\n')));
});
