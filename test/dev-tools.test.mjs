// 개발 도구 플러그인(plugins/dev-tools) — 명령 찾기, --port 붙이기, 프로젝트·에이전트 목록, 개발 서버 띄우기·멈추기
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
});

test('--port: next·vite·webpack·nuxt·astro에만, npm·pnpm은 -- 뒤에', () => {
  const c = (argv, script) => ({ argv, port: dev.detect(project('port-' + Math.random().toString(36).slice(2), { 'package.json': { scripts: { dev: script } } })).commands[0].port });
  for (const s of ['next dev', 'vite', 'vite --host', 'npx astro dev', 'webpack serve', 'webpack-dev-server --hot', 'nuxt dev', 'nuxi dev', 'cross-env A=1 next dev']) assert.equal(c(['npm', 'run', 'dev'], s).port, true, s);
  for (const s of ['node server.js', 'next-sitemap', 'node next.js', 'tsx watch src', 'rails s']) assert.equal(c(['npm', 'run', 'dev'], s).port, false, s);
  const on = argv => ({ argv, port: true });
  assert.deepEqual(dev.withPort(on(['npm', 'run', 'dev']), 3001), ['npm', 'run', 'dev', '--', '--port', '3001']);
  assert.deepEqual(dev.withPort(on(['pnpm', 'dev']), 3001), ['pnpm', 'dev', '--', '--port', '3001']);
  assert.deepEqual(dev.withPort(on(['pnpm', '--filter', 'web', 'dev']), 5173), ['pnpm', '--filter', 'web', 'dev', '--', '--port', '5173']);
  assert.deepEqual(dev.withPort(on(['yarn', 'dev']), 3001), ['yarn', 'dev', '--port', '3001']);
  assert.deepEqual(dev.withPort({ argv: ['npm', 'run', 'dev'], port: false }, 3001), ['npm', 'run', 'dev']);
  assert.deepEqual(dev.withPort({ argv: ['./gradlew', 'bootRun'], port: false }, 8081), ['./gradlew', 'bootRun']);
  assert.deepEqual(dev.withPort(on(['npm', 'run', 'dev']), null), ['npm', 'run', 'dev']);
});

test('node 버전: .nvmrc·.node-version을 ~/.nvm 버전에 맞춘다', () => {
  for (const v of ['v18.17.0', 'v18.20.4', 'v20.11.1', 'v20.9.0']) fs.mkdirSync(path.join(HOME, '.nvm/versions/node', v, 'bin'), { recursive: true });
  const nv = (file, text) => dev.nodeFor(project('nv-' + Math.random().toString(36).slice(2), { [file]: text }));
  assert.deepEqual(nv('.nvmrc', '18\n'), { want: '18', version: '18.20.4', bin: path.join(HOME, '.nvm/versions/node/v18.20.4/bin') });
  assert.equal(nv('.nvmrc', 'v18.17').version, '18.17.0');
  assert.equal(nv('.node-version', '20').version, '20.11.1');
  assert.equal(nv('.nvmrc', '18.1').version, null);   // 18.1은 18.17이 아니다
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
  assert.deepEqual(alpha, { id: path.join(root, 'alpha'), title: 'alpha', url: '', meta: ['멈춤', 'npm run dev', 'node 20.11.1'], tags: [], vars: { path: path.join(root, 'alpha'), name: 'alpha' } });
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
  assert.deepEqual(r.workflows.map(w => w.name), ['띄우기', '멈추기', 'AI로 고치기', 'AI 사용성 점검', 'AI로 에이전트 고치기']);
  assert.deepEqual(r.feeds.map(f => f.name), ['프로젝트', '에이전트']);
  assert.equal(r.workflows[2].steps[0].kind, 'ask');
});
