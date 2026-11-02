// FE 프로젝트 관리 플러그인(plugins/fe-projects) — 노트 읽기·한 줄 고치기, 로컬 클론 짝짓기, PR 활동 모으기, 노트 맞추기, 피드 항목
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-fe-projects-')));
const HOME = path.join(tmp, 'home');
fs.mkdirSync(HOME);
process.env.HOME = HOME;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PLUGIN = new URL('../plugins/fe-projects/', import.meta.url).pathname;
const SCRIPT = path.join(PLUGIN, 'scripts', 'fe.mjs');
const fe = await import(SCRIPT);
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const run = async (...args) => {
  const env = { ...process.env, HOME }; delete env.GITHUB_TOKEN;
  const { stdout } = await promisify(execFile)(process.execPath, [SCRIPT, ...args], { env, timeout: 30000 });
  return JSON.parse(stdout.trim());
};

test('노트: 프런트매터·한 줄 요약·"- 키: 값" 줄을 읽고, 한 줄만 고친다', () => {
  const text = fe.newNote({ repo: 'webtech/place', summary: '장소 상세', fields: { 실행: '`pnpm dev` · 로컬 (관례)' } }) + '- 레포: 메모 칸의 같은 키는 안 읽는다\n';
  const n = fe.parseNote(text);
  assert.equal(n.fm.type, 'context');
  assert.match(n.fm.id, /^[a-z0-9]{8}$/);
  assert.equal(n.fm.group, 'FE 프로젝트');
  assert.equal(n.summary, '장소 상세');
  assert.equal(n.fields.레포, 'webtech/place');
  assert.equal(fe.commandOf(n.fields.실행), 'pnpm dev');
  assert.deepEqual(Object.keys(n.fields), fe.FIELDS);

  const t2 = fe.setField(text, '활동', 'PR 3건 · $& 그대로');
  assert.equal(fe.parseNote(t2).fields.활동, 'PR 3건 · $& 그대로');
  assert.equal(t2.split('\n').length, text.split('\n').length);
  // 줄이 없으면 마지막 키 줄 뒤에
  const t3 = fe.setField('# 내용\n- 레포: a/b\n- 실행: x\n\n## 메모\n', '활동', 'PR 1건');
  assert.equal(t3, '# 내용\n- 레포: a/b\n- 실행: x\n- 활동: PR 1건\n\n## 메모\n');
});

test('로컬 클론: origin 주소(ssh·https)로 owner/name과 폴더를 짝짓는다', () => {
  assert.equal(fe.repoOf('git@github.daumkakao.com:webtech/kakaomap-pc.git'), 'webtech/kakaomap-pc');
  assert.equal(fe.repoOf('https://github.com/kakao-hash-table/pkm-app'), 'kakao-hash-table/pkm-app');
  assert.equal(fe.repoOf('ssh://git@host:22/a/b.c.git'), 'a/b.c');
  assert.equal(fe.repoOf('not a url'), '');
  const code = path.join(tmp, 'code');
  write(path.join(code, 'pc', '.git', 'config'), '[core]\n\tbare = false\n[remote "upstream"]\n\turl = git@h:x/y.git\n[remote "origin"]\n\turl = git@h:webtech/kakaomap-pc.git\n');
  write(path.join(code, 'plain', 'README.md'), '');
  write(path.join(tmp, 'single', '.git', 'config'), '[remote "origin"]\n\turl = https://h/Kakaomap-Web/fiy\n');
  assert.deepEqual(fe.clones(`${code}/*\n# 주석\n${path.join(tmp, 'single')}`), { 'webtech/kakaomap-pc': path.join(code, 'pc'), 'kakaomap-web/fiy': path.join(tmp, 'single') });
});

test('PR 활동: 팀원마다 페이지를 넘기며 레포별로 세고, 사내 아이디의 점은 하이픈으로', async () => {
  assert.deepEqual(fe.handles('hash.table\n@zoe-seong\nhash-table\n'), ['hash-table', 'zoe-seong']);
  assert.equal(fe.webOf('https://github.daumkakao.com/api/v3/'), 'https://github.daumkakao.com');
  assert.equal(fe.webOf('https://api.github.com'), 'https://github.com');
  const calls = [];
  const pr = (repo, at) => ({ repository_url: `https://h/api/v3/repos/${repo}`, updated_at: at });
  const fetchImpl = async url => {
    calls.push(decodeURIComponent(url));
    const who = decodeURIComponent(url).match(/author:(\S+)/)[1], page = Number(new URL(url).searchParams.get('page'));
    if (who === 'ghost') return { ok: false, status: 422 };
    const items = who === 'a' ? (page === 1 ? Array.from({ length: 100 }, (_, i) => pr('w/one', `2026-10-${String(i % 28 + 1).padStart(2, '0')}T00:00:00Z`)) : [pr('w/two', '2026-11-01T09:00:00Z')]) : [pr('w/one', '2026-09-01T00:00:00Z')];
    return { ok: true, status: 200, json: async () => ({ items }) };
  };
  const r = await fe.collect({ api: 'https://h/api/v3', token: 't', members: ['a', 'b', 'ghost'], days: 30, fetchImpl });
  assert.equal(calls.length, 4);   // a 두 쪽, b 한 쪽, ghost 한 번
  assert.match(calls[0], /is:pr author:a created:>=\d{4}-\d{2}-\d{2}&per_page=100&page=1$/);
  assert.deepEqual(r.repos['w/one'], { n: 101, users: { a: 100, b: 1 }, last: '2026-10-28' });
  assert.deepEqual(r.repos['w/two'], { n: 1, users: { a: 1 }, last: '2026-11-01' });
  assert.equal(fe.activityLine({ n: 5, last: '2026-11-02', users: { 'zoe-seong': 1, 'hash-table': 4 } }), 'PR 5건 · 마지막 11-02 · hash 4, zoe 1');
  await assert.rejects(fe.collect({ api: 'https://h', token: 'x', members: ['a'], fetchImpl: async () => ({ ok: false, status: 401 }) }), /토큰이 맞지 않아요/);
});

test('노트 맞추기: 활동·빈 로컬만 고치고, 바뀐 노트만 쓰고, 새 레포는 노트를 만들되 뺄 레포는 건너뛴다', () => {
  const dir = path.join(tmp, 'profile', '01_지식', '맥락노트', 'FE 프로젝트');
  write(path.join(dir, 'place.md'), fe.newNote({ repo: 'webtech/place', fields: { 실행: '`pnpm dev` (명시)', 로컬: '~/mine' } }).replace(/updated: .*/, 'updated: "2026-01-01"') + '사람 메모\n');
  write(path.join(dir, 'quiet.md'), fe.newNote({ repo: 'webtech/quiet' }));
  write(path.join(dir, '레포 없는 노트.md'), '# 내용\n그냥 글\n');
  const act = { since: new Date(Date.now() - 183 * 864e5).toISOString().slice(0, 10), repos: {
    'webtech/place': { n: 3, users: { 'kevin-home': 3 }, last: '2026-10-30' }, 'kakaomap-web/new-one': { n: 1, users: { 'zoe-seong': 1 }, last: '2026-10-01' }, 'gitops/apps-dev': { n: 2, users: { x: 2 }, last: '2026-10-06' } } };
  const local = { 'webtech/place': '/elsewhere', 'webtech/quiet': path.join(HOME, 'q') };

  assert.deepEqual(fe.sync({ dir, act, local, exclude: ['gitops/*'] }), { made: 1, changed: 2 });
  const place = fs.readFileSync(path.join(dir, 'place.md'), 'utf8'), p = fe.parseNote(place);
  assert.equal(p.fields.활동, 'PR 3건 · 마지막 10-30 · kevin 3');
  assert.equal(p.fields.로컬, '~/mine', '사람이 적은 로컬은 두기');
  assert.equal(p.fields.실행, '`pnpm dev` (명시)');
  assert.match(place, /사람 메모\n$/);
  assert.notEqual(p.fm.updated, '2026-01-01');
  const q = fe.parseNote(fs.readFileSync(path.join(dir, 'quiet.md'), 'utf8')).fields;
  assert.deepEqual([q.활동, q.로컬], ['최근 6개월 PR 없음', '~/q']);
  assert.equal(fe.parseNote(fs.readFileSync(path.join(dir, 'new-one.md'), 'utf8')).fields.활동, 'PR 1건 · 마지막 10-01 · zoe 1');
  assert.equal(fs.existsSync(path.join(dir, 'apps-dev.md')), false);
  // 같은 값이면 다시 쓰지 않는다
  const before = fs.statSync(path.join(dir, 'place.md')).mtimeMs;
  assert.deepEqual(fe.sync({ dir, act, local, exclude: ['gitops/*'] }), { made: 0, changed: 0 });
  assert.equal(fs.statSync(path.join(dir, 'place.md')).mtimeMs, before);
});

test('피드: 노트를 항목으로 — 조사 전 표시, 실행·배포·브랜치 한 줄, 토큰이 없으면 지난 값', async () => {
  const profile = path.join(tmp, 'feed-profile'), dir = fe.groupDir(profile, 'FE 프로젝트');
  write(path.join(dir, 'webview.md'), fe.newNote({ repo: 'webtech/kakaomap-webview', summary: '앱 웹뷰', fields: {
    실행: '`pnpm --filter weather dev` · 앱별로 (관례)', 배포: 'GitHub Actions · CBT는 master, PROD는 release (명시)', 브랜치: 'workingfe → master → release (관례)', 활동: 'PR 188건 · 마지막 11-02 · degurii 88', 종류: '서비스' } }));
  write(path.join(dir, 'e2e.md'), fe.newNote({ repo: 'kakaomap-web/map-e2e', fields: { 종류: '도구', 로컬: path.join(tmp, '없는 폴더') } }));
  const r = await run('list', `--profile=${profile}`, '--group=FE 프로젝트', '--members=hash.table', '--api=https://github.daumkakao.com/api/v3');
  assert.match(r.note, /토큰이 없어서/);
  const [e2e, wv] = r.items;
  assert.deepEqual(wv.meta, ['실행 pnpm --filter weather dev', '배포 GitHub Actions', '브랜치 workingfe → master → release (관례)', 'PR 188건 · 마지막 11-02 · degurii 88']);
  assert.equal(wv.url, 'https://github.daumkakao.com/webtech/kakaomap-webview');
  assert.deepEqual(wv.tags, []);
  assert.deepEqual(wv.detail, [{ text: '앱 웹뷰' }]);
  assert.equal(wv.vars.command, 'pnpm --filter weather dev');
  assert.deepEqual(e2e.tags, ['조사 전', '도구', '로컬 없음']);
  assert.equal(e2e.vars.local, '');
  assert.equal(e2e.vars.note, path.join(dir, 'e2e.md'));
  assert.match((await run('list', `--profile=${path.join(tmp, '빈 프로필')}`, '--group=FE 프로젝트', '--members=')).note, /팀원/);

  // [최신화]: 토큰이 없어도 멈추지 않고 노트 경로를 넘긴다(다음 단계 AI가 쓴다), 없는 레포는 멈춘다
  const fr = await run('refresh', `--profile=${profile}`, '--group=FE 프로젝트', '--repo=WEBTECH/kakaomap-webview', '--members=hash.table', '--api=https://h/api/v3');
  assert.equal(fr.note, path.join(dir, 'webview.md'));
  assert.match(fr.summary, /토큰이 없어서/);
  const miss = await run('refresh', `--profile=${profile}`, '--group=FE 프로젝트', '--repo=a/none').catch(e => JSON.parse(e.stdout));
  assert.match(miss.error, /노트를 찾지 못했어요/);
});

test('검사기가 FE 프로젝트 관리 플러그인을 받는다', () => {
  const P = createRequire(import.meta.url)('../web/js/pkm-plugin.js');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const r = P.validate(walk(PLUGIN).map(f => ({ path: path.relative(PLUGIN, f), size: fs.statSync(f).size, text: fs.readFileSync(f, 'utf8') })));
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.manifest.id, 'fe-projects');
  assert.deepEqual(r.manifest.permissions.secrets, ['GITHUB_TOKEN']);
  assert.deepEqual(r.feeds.map(f => [f.name, f.starts]), [['FE 프로젝트', ['최신화', '받기', '띄우기', '멈추기', '배포', '빼기']], ['레포 더하기', ['레포 더하기']]]);
  assert.deepEqual(r.workflows.map(w => [w.name, w.steps.map(x => x.kind)]), [['최신화', ['script', 'agent']], ['빼기', ['script']], ['레포 더하기', ['ask', 'script', 'agent']], ['받기', ['script']], ['띄우기', ['script']], ['멈추기', ['script']], ['배포', ['script']]]);
  // 두 워크플로우 모두 첫 스크립트 단계 키가 '활동'이라 같은 프롬프트({활동.note} {활동.repo} {활동.local})를 쓴다
  assert.equal(fs.readFileSync(path.join(PLUGIN, 'scripts/devserver.mjs'), 'utf8'), fs.readFileSync(new URL('../plugins/dev-tools/scripts/devserver.mjs', import.meta.url), 'utf8'), '띄우기는 개발 도구와 같은 파일(같은 상태 파일을 쓴다)');
  for (const w of ['최신화', '레포 더하기']) assert.ok(r.workflows.find(x => x.name === w).steps.some(x => x.key === '활동'), w);
});

test('레포 주소 읽기와 빼 둘 레포 줄 고치기', () => {
  for (const t of ['https://github.daumkakao.com/webtech/place', 'https://github.daumkakao.com/webtech/place/tree/master/src?x=1', 'git@github.daumkakao.com:webtech/place.git', ' webtech/place ', 'webtech/place.git'])
    assert.equal(fe.parseRepo(t), 'webtech/place', t);
  for (const t of ['', 'place', 'https://github.com/only-owner', 'a b/c']) assert.equal(fe.parseRepo(t), '', t);
  assert.equal(fe.excludeWith('gitops/*\nA/B', 'a/b', false), 'gitops/*');
  assert.equal(fe.excludeWith('gitops/*', 'w/x', true), 'gitops/*\nw/x');
  assert.equal(fe.excludeWith('gitops/*', 'gitops/apps-dev', true), 'gitops/*', '이미 걸리면 더하지 않는다');
  assert.equal(fe.excludeWith('', 'w/x', true), 'w/x');
});

test('빼기는 묻고 나서 노트를 휴지통으로 옮기고 빼 둘 레포에 더한다 · 더하기는 노트를 만들고 빼 둘 레포에서 지운다', async () => {
  const profile = path.join(tmp, 'edit-profile'), dir = fe.groupDir(profile, 'FE 프로젝트');
  write(path.join(dir, 'old.md'), fe.newNote({ repo: 'w/old' }));
  const base = [`--profile=${profile}`, '--group=FE 프로젝트'];

  const ask = await run('remove', ...base, '--repo=w/old', '--exclude=gitops/*');
  assert.equal(ask.ask.choices[0].value, 'yes');
  assert.ok(fs.existsSync(path.join(dir, 'old.md')), '묻기만 하고 지우지 않는다');
  const rm = await run('remove', ...base, '--repo=W/OLD', '--exclude=gitops/*', '--answer=yes');
  assert.deepEqual(rm.settings_patch, { exclude: 'gitops/*\nw/old' });
  assert.equal(fs.existsSync(path.join(dir, 'old.md')), false);
  assert.ok(fs.existsSync(path.join(profile, '.trash', '01_지식', '맥락노트', 'FE 프로젝트', 'old.md')));
  // 빼 둔 레포는 다시 모아도 노트를 만들지 않는다
  assert.equal(fe.sync({ dir, act: { since: '2026-01-01', repos: { 'w/old': { n: 1, users: { a: 1 }, last: '2026-10-01' } } }, local: {}, exclude: rm.settings_patch.exclude.split('\n') }).made, 0);

  write(path.join(tmp, 'clones', 'old', '.git', 'config'), '[remote "origin"]\n\turl = git@h:w/old.git\n');
  const add = await run('add', ...base, '--input=https://github.daumkakao.com/w/old/tree/main', `--dirs=${path.join(tmp, 'clones')}/*`, `--exclude=${rm.settings_patch.exclude}`);
  assert.equal(add.repo, 'w/old');
  assert.equal(add.local, path.join(tmp, 'clones', 'old'));
  assert.deepEqual(add.settings_patch, { exclude: 'gitops/*' });
  assert.equal(fe.parseNote(fs.readFileSync(add.note, 'utf8')).fields.레포, 'w/old');
  assert.match((await run('add', ...base, '--input=w/old')).summary, /이미 있어요/);
  assert.match((await run('add', ...base, '--input=그냥 글').catch(e => JSON.parse(e.stdout))).error, /알아보지 못했어요/);
  assert.equal((await run('add-item')).items.length, 1);
});

// ---- 받기·배포: 진짜 git으로. origin은 임시 bare 저장소, git@h:… 주소는 insteadOf로 그쪽에 붙인다 ----
const G = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function origin(name){
  Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' });
  const bare = path.join(tmp, 'remotes', `${name}.git`), seed = path.join(tmp, 'seed', name);
  fs.mkdirSync(seed, { recursive: true });
  G(tmp, 'init', '-q', '--bare', '-b', 'master', bare);
  G(seed, 'init', '-q', '-b', 'master'); write(path.join(seed, 'a.txt'), 'a\n'); G(seed, 'add', '.'); G(seed, 'commit', '-qm', 'init');
  G(seed, 'remote', 'add', 'origin', bare); G(seed, 'push', '-q', 'origin', 'master', 'master:sandbox', 'master:develop');
  G(bare, 'symbolic-ref', 'HEAD', 'refs/heads/master');
  return { bare, seed };
}
const runGit = async (script, ...args) => {
  const env = { ...process.env, HOME, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${path.join(tmp, 'remotes')}/.insteadOf`, GIT_CONFIG_VALUE_0: 'git@h:w/' }; delete env.GITHUB_TOKEN;
  try { const { stdout } = await promisify(execFile)(process.execPath, [path.join(PLUGIN, 'scripts', script), ...args], { env, timeout: 60000 }); return JSON.parse(stdout.trim()); }
  catch (e) { return JSON.parse(e.stdout.trim()); }
};

test('받기: 처음이면 받을 폴더에 clone하고 노트의 로컬을 채우고, 다음엔 fetch·fast-forward, 노트 폴더 안에는 받지 않는다', async () => {
  const { seed } = origin('getme');
  const profile = path.join(tmp, 'get-profile'), dir = fe.groupDir(profile, 'FE 프로젝트');
  write(path.join(dir, 'getme.md'), fe.newNote({ repo: 'w/getme' }));
  const base = [`--profile=${profile}`, '--group=FE 프로젝트', '--repo=w/getme', '--api=https://h/api/v3'];

  assert.match((await runGit('fe.mjs', 'get', ...base, `--clone_dir=${path.join(profile, 'code')}`)).error, /노트 폴더와 겹쳐요/);
  const got = await runGit('fe.mjs', 'get', ...base, `--clone_dir=${path.join(tmp, 'code')}`);
  assert.equal(got.path, path.join(tmp, 'code', 'getme'));
  assert.equal(fs.readFileSync(path.join(got.path, 'a.txt'), 'utf8'), 'a\n');
  assert.equal(fe.parseNote(fs.readFileSync(path.join(dir, 'getme.md'), 'utf8')).fields.로컬, got.path);
  // 링크는 클론의 origin 호스트로(API 주소를 안 적었어도)
  assert.equal(fe.item(fe.readNotes(dir)[0], 'https://github.com').url, 'https://h/w/getme');
  write(path.join(tmp, 'hostcheck', '.git', 'config'), '[remote "origin"]\n\turl = git@github.daumkakao.com:w/x.git\n');
  assert.equal(fe.originHost(path.join(tmp, 'hostcheck')), 'github.daumkakao.com');

  write(path.join(seed, 'b.txt'), 'b\n'); G(seed, 'add', '.'); G(seed, 'commit', '-qm', 'b'); G(seed, 'push', '-q', 'origin', 'master');
  assert.match((await runGit('fe.mjs', 'get', ...base)).summary, /master를 최신으로\(1개 커밋 받음\)/);
  assert.ok(fs.existsSync(path.join(got.path, 'b.txt')));
  write(path.join(got.path, 'a.txt'), 'local edit\n');
  write(path.join(seed, 'c.txt'), 'c\n'); G(seed, 'add', '.'); G(seed, 'commit', '-qm', 'c'); G(seed, 'push', '-q', 'origin', 'master');
  assert.match((await runGit('fe.mjs', 'get', ...base)).summary, /1개 뒤처짐 · 고친 파일이 있어서 merge는 안 했어요/);
});

test('배포: 노트의 배포 줄에 있는 테스트 브랜치에만 머지해 push, 운영 태그는 날짜로, 내 작업 폴더는 그대로', async () => {
  const { bare } = origin('dep');
  const work = path.join(tmp, 'dep-work'); G(tmp, 'clone', '-q', bare, work);
  G(work, 'checkout', '-qb', 'feature/MPEN-1'); write(path.join(work, 'f.txt'), 'feature\n'); G(work, 'add', '.'); G(work, 'commit', '-qm', 'feature');
  const deploy = 'develop→dev, sandbox→sandbox 자동, prod는 master에 v{yy.mm.dd} 태그 (명시)';
  const args = [`--path=${work}`, `--deploy=${deploy}`, '--repo=w/dep', '--web=https://github.daumkakao.com'];

  const ask = await runGit('deploy.mjs', 'run', ...args);
  assert.deepEqual(ask.ask.choices.map(c => c.value), ['merge:sandbox', 'merge:develop', `tag:${(await import(path.join(PLUGIN, 'scripts', 'deploy.mjs'))).tagName([])}`]);
  assert.ok(ask.ask.choices.every(c => c.confirm), '모두 한 번 더 묻는다');
  assert.equal(ask.findings[0].url, 'https://github.daumkakao.com/w/dep/actions');
  assert.match((await runGit('deploy.mjs', 'run', ...args, '--answer=merge:qa')).error, /배포 줄에 없거나/);

  const ok = await runGit('deploy.mjs', 'run', ...args, '--answer=merge:sandbox');
  assert.equal(ok.verdict.tone, 'ok');
  assert.equal(G(bare, 'show', 'sandbox:f.txt'), 'feature');
  assert.equal(G(bare, 'show', 'master:a.txt'), 'a', 'master는 그대로');
  assert.equal(G(work, 'symbolic-ref', '--short', 'HEAD'), 'feature/MPEN-1', '내 브랜치 그대로');
  assert.equal(G(work, 'worktree', 'list').split('\n').length, 1, '임시 worktree를 지운다');

  const D = await import(path.join(PLUGIN, 'scripts', 'deploy.mjs'));
  const t = D.tagName([]);
  const tagged = await runGit('deploy.mjs', 'run', ...args, `--answer=tag:${t}`);
  assert.equal(tagged.verdict.tone, 'ok');
  assert.equal(G(bare, 'rev-parse', `${t}^{commit}`), G(bare, 'rev-parse', 'master'));
  assert.equal((await runGit('deploy.mjs', 'run', ...args)).ask.choices.at(-1).value, `tag:${t}.1`, '같은 날 두 번째는 .1');
  assert.deepEqual([D.tagName(['v26.11.02', 'v26.11.02.1'], new Date(2026, 10, 2)), D.tagStyle('vYY.MM.DD 태그'), D.tagStyle('release 브랜치 push')], ['v26.11.02.2', true, false]);
  assert.deepEqual(D.mentioned('deploy/sandbox·deploy/develop push, qa/* 는 아님, sandboxes'), ['deploy/sandbox', 'deploy/develop']);

  // 충돌이면 멈추고 아무것도 올리지 않는다
  const other = path.join(tmp, 'dep-other'); G(tmp, 'clone', '-q', bare, other); G(other, 'checkout', '-q', 'develop');
  write(path.join(other, 'f.txt'), 'theirs\n'); G(other, 'add', '.'); G(other, 'commit', '-qm', 'theirs'); G(other, 'push', '-q', 'origin', 'develop');
  const before = G(bare, 'rev-parse', 'develop');
  assert.match((await runGit('deploy.mjs', 'run', ...args, '--answer=merge:develop')).error, /충돌/);
  assert.equal(G(bare, 'rev-parse', 'develop'), before);
  assert.equal(G(work, 'worktree', 'list').split('\n').length, 1);
  // master에서는 테스트 브랜치에 올리지 않는다, 클론이 없으면 받기를 안내
  G(work, 'checkout', '-q', 'master');
  assert.deepEqual((await runGit('deploy.mjs', 'run', ...args)).ask.choices.map(c => c.value.split(':')[0]), ['tag']);
  assert.match((await runGit('deploy.mjs', 'run', '--path=-', `--deploy=${deploy}`)).error, /\[받기\]/);
});
