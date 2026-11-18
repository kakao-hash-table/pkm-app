// 보안 공지 대응 플러그인의 올리기(scripts/ship.mjs) — 레포마다 티켓·커밋 메시지·브랜치·push·PR·담당자, 다시 눌러도 두 번 만들지 않기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
const PLUGIN = new URL('../plugins/security-watch/', import.meta.url).pathname;
const SCRIPT = path.join(PLUGIN, 'scripts/ship.mjs');
const S = await import(SCRIPT);
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sw-ship-')));
const calls = []; let server, base, failPR = false, n = 100, prs = [];
before(async () => {
  server = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d).on('end', () => {
    const u = new URL(req.url, 'http://x'), body = b ? JSON.parse(b) : null; calls.push({ m: req.method, p: u.pathname, body, auth: req.headers.authorization });
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/rest/api/2/myself') return send(200, { accountId: 'acc1' });
    if (u.pathname === '/rest/api/2/issue/createmeta/MCLP/issuetypes') return send(200, { issueTypes: [{ id: '10189', name: '작업', subtask: false }, { id: '9', name: '하위 작업', subtask: true }] });
    if (u.pathname === '/rest/api/2/issue' && req.method === 'POST') return send(201, { key: `MCLP-${++n}` });
    if (u.pathname === '/api/v3/user') return send(200, { login: 'hash-table' });
    if (/\/pulls$/.test(u.pathname) && req.method === 'GET') return send(200, []);
    if (/\/pulls$/.test(u.pathname) && req.method === 'POST'){ if (failPR && /\/b\//.test(u.pathname)) return send(422, { message: 'Validation Failed' }); prs.push(body); return send(201, { number: prs.length, html_url: `http://gh/${u.pathname.split('/')[4]}/${u.pathname.split('/')[5]}/pull/${prs.length}` }); }
    if (/\/assignees$/.test(u.pathname)) return send(201, {});
    send(404, {});
  }); });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
const dir = path.join(tmp, 'wt', 'cve-1');
// 원격(bare) 127.0.0.1/web/<name>.git 꼴 경로 — remoteOf가 host를 읽게 url은 설정으로 바꾼다
function repo(name, { develop = false } = {}){
  const bare = path.join(tmp, 'remotes', `${name}.git`), src = path.join(tmp, 'code', name);
  fs.mkdirSync(bare, { recursive: true }); execFileSync('git', ['init', '-q', '--bare', '-b', 'master', bare]);
  fs.mkdirSync(src, { recursive: true }); execFileSync('git', ['init', '-q', '-b', 'master', src]);
  fs.writeFileSync(path.join(src, '.nvmrc'), '24.22.1\n'); g(src, 'add', '.'); g(src, 'commit', '-qm', 'init');
  g(src, 'remote', 'add', 'origin', bare); g(src, 'push', '-q', 'origin', 'master');
  let from = 'master';
  if (develop){ g(src, 'checkout', '-qb', 'develop'); fs.writeFileSync(path.join(src, 'x'), '1'); g(src, 'add', '.'); g(src, 'commit', '-qm', 'dev work'); g(src, 'push', '-q', 'origin', 'develop'); from = 'develop'; }
  g(src, 'fetch', '-q', 'origin');
  const wt = path.join(dir, name); fs.mkdirSync(dir, { recursive: true });
  g(src, 'worktree', 'add', '-q', wt, '-b', 'security/cve-1', `origin/${from}`);
  fs.writeFileSync(path.join(wt, '.nvmrc'), '24.22.3\n'); g(wt, 'add', '.'); g(wt, 'commit', '-qm', 'chore(security): node 24.22.3');
  // push는 bare로 가되, 주소는 사내 깃헙 꼴로 보이게
  g(src, 'remote', 'set-url', 'origin', `git@127.0.0.1:web/${name}.git`); g(src, 'remote', 'set-url', '--push', 'origin', bare);
  return { name, path: src, status: 'fixed', risk: 'server', problem: `.nvmrc:1 Node 24.22.1 [취약]`, changes: [{ file: '.nvmrc', line: 1, before: '24.22.1', after: '24.22.3' }], base: `origin/${from}`, branch: 'security/cve-1', worktree: wt, commit: 'abc', tests: 'jest 10 통과', todo: '재배포' };
}
const run = (args, env = { JIRA_TOKEN: 'jt', GITHUB_TOKEN: 'gt' }) => new Promise(ok => execFile(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, HOME: tmp, GIT_CONFIG_GLOBAL: '/dev/null', ...env }, timeout: 60000 }, (err, stdout, stderr) => {
  let out; try { out = JSON.parse(String(stdout).trim().split('\n').pop()); } catch { out = { raw: stdout, stderr }; } ok({ code: err ? err.code : 0, out }); }));
const args = extra => [`--dir=${dir}`, '--url=https://kakao.agit.in/g/4/wall/9', '--title=[보안공지] Node.js 취약점', `--jira_url=${base}`, '--jira_email=', '--jira_project=MCLP', '--jira_type=작업', '--summary=[Web][{repo}] 보안이슈 대응', '--branch=feature/{key}', '--pr_base=master', `--github_api=${base}/api/v3`, '--assignee=', ...extra];

test('글 바꾸기: 아지트 마크다운 → 지라 위키, 원격 주소 읽기', () => {
  assert.equal(S.toWiki('[@group](https://a/g/4) \n## \\[보안공지\\] 제목\n> - 요약 {x}\n- [KISA](https://boho.or.kr/a?b=1)'), 'h4. \\[보안공지\\] 제목\n- 요약 \\{x\\}\n- [KISA|https://boho.or.kr/a?b=1]');
  assert.deepEqual(S.remoteOf('git@github.daumkakao.com:webtech/kakaomap-pc.git'), { host: 'github.daumkakao.com', owner: 'webtech', name: 'kakaomap-pc' });
  assert.deepEqual(S.remoteOf('git@github.daumkakao.com:kakaomap-web/kakaomap-web'), { host: 'github.daumkakao.com', owner: 'kakaomap-web', name: 'kakaomap-web' });
  assert.deepEqual(S.remoteOf('https://github.com/a/b.git'), { host: 'github.com', owner: 'a', name: 'b' });
});

test('고친 레포가 없으면 묻지 않고 끝, 토큰이 없으면 한 번에 알림', async () => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ repos: [{ name: 'x', status: 'ok' }] }));
  const a = await run(args([])); assert.equal(a.code, 0); assert.equal(a.out.summary, '올릴 것이 없어요'); assert.equal(a.out.ask, undefined);
  fs.rmSync(path.join(dir, 'report.json'));
  const b = await run(args([])); assert.equal(b.out.summary, '올릴 것이 없어요');
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ repos: [{ name: 'x', status: 'fixed' }] }));
  const c = await run(args([]), {}); assert.equal(c.code, 1); assert.match(c.out.error, /Jira 토큰, GitHub 토큰/);
});

test('묻기 → 올리기: 티켓·브랜치·push·PR·담당자, develop에서 갈라진 것은 master 위로 옮겨서, 다시 눌러도 두 번 만들지 않음', async () => {
  const a = repo('a'), b = repo('b', { develop: true });
  fs.writeFileSync(path.join(dir, 'notice.md'), '# 제목\n\n- 글 번호: 9\n- 가져온 때: x\n\n## \\[보안공지\\] Node\n본문 CVE-2026-1\n');
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ summary: '2개 고침', repos: [a, b, { name: 'c', status: 'skip' }] }));
  const q = await run(args([]));
  assert.equal(q.code, 0, JSON.stringify(q.out));
  assert.equal(q.out.ask.inline, true); assert.deepEqual(q.out.ask.choices.map(c => c.value), ['ship', 'done']);
  assert.match(q.out.ask.choices[0].confirm, /MCLP 티켓.*feature\/MCLP-번호.*master/);
  assert.match(q.out.verdict.title, /레포 2개에 수정 커밋/); assert.equal(q.out.findings.length, 3);
  assert.equal(calls.filter(c => c.m === 'POST').length, 0);   // 묻기만 — 아무것도 쓰지 않는다

  const one = await run(args(['--answer=ship:a'])); assert.equal(one.code, 0, JSON.stringify(one.out)); assert.equal(prs.length, 1); assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'ship.json'), 'utf8'))), ['a']); assert.equal(one.out.findings.find(f => f.where.startsWith('b')).choose.value, 'ship:b'); assert.equal(one.out.findings.find(f => f.where === 'a').choose, undefined); failPR = true;
  const r1 = await run(args(['--answer=ship']));
  assert.equal(r1.code, 0, JSON.stringify(r1.out));
  assert.match(r1.out.verdict.title, /b 레포를 올리지 못했어요/);
  
  const st1 = JSON.parse(fs.readFileSync(path.join(dir, 'ship.json'), 'utf8'));
  assert.match(st1.a.key, /^MCLP-10\d$/); assert.equal(st1.a.branch, `feature/${st1.a.key}`); assert.equal(st1.a.base, 'master'); assert.equal(st1.a.assignee, 'hash-table');
  assert.equal(g(a.worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), st1.a.branch);
  assert.match(execFileSync('git', ['--git-dir', path.join(tmp, 'remotes', 'a.git'), 'branch'], { encoding: 'utf8' }), new RegExp(st1.a.branch));
  assert.ok(st1.b.key && st1.b.pushed && !st1.b.pr_url); assert.match(st1.b.error, /422/);
  const issue = calls.find(c => c.p === '/rest/api/2/issue' && c.body.fields.summary === '[Web][a] 보안이슈 대응');
  assert.equal(issue.auth, 'Bearer jt'); assert.equal(issue.body.fields.issuetype.id, '10189'); assert.equal(issue.body.fields.assignee.accountId, 'acc1');
  assert.match(issue.body.fields.description, /\[\\\[보안공지\\\] Node.js 취약점\|https:\/\/kakao\.agit\.in\/g\/4\/wall\/9\]/);
  assert.match(issue.body.fields.description, /본문 CVE-2026-1/); assert.doesNotMatch(issue.body.fields.description, /글 번호/);
  assert.equal(prs[0].base, 'master'); assert.equal(prs[0].title, `${st1.a.key}: [Web][a] 보안이슈 대응`);
  assert.match(prs[0].body, new RegExp(`- JIRA: \\[${st1.a.key}\\]`)); assert.match(prs[0].body, /- Agit: \[보안공지 Node.js 취약점\]\(https:\/\/kakao.agit.in\/g\/4\/wall\/9\)/); assert.match(prs[0].body, /`\.nvmrc:1` `24\.22\.1`에서 `24\.22\.3`으로/);

  failPR = false; const tickets = calls.filter(c => c.p === '/rest/api/2/issue').length;
  const r2 = await run(args(['--answer=ship:b']));
  assert.equal(r2.code, 0, JSON.stringify(r2.out)); 
  assert.equal(calls.filter(c => c.p === '/rest/api/2/issue').length, tickets);
  assert.equal(prs.length, 2); assert.equal(prs[1].base, 'master');
  const r3 = await run(args(['--answer=ship'])); assert.equal(prs.length, 2);
  const c = repo('c', { develop: true }); const rep = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')); rep.repos.push(c); fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(rep));
  const r4 = await run(args(['--answer=ship:c'])); assert.equal(r4.code, 0, JSON.stringify(r4.out));
  const sc = JSON.parse(fs.readFileSync(path.join(dir, 'ship.json'), 'utf8')).c;
  assert.equal(sc.base, 'master'); assert.equal(sc.note, null); assert.equal(prs[2].base, 'master');
  assert.equal(g(c.worktree, 'rev-list', '--count', 'origin/master..HEAD'), '1'); assert.equal(g(c.worktree, 'log', '-1', '--format=%s'), `${sc.key}: [Web][c] 보안이슈 대응`);
  assert.equal(execFileSync('git', ['--git-dir', path.join(tmp, 'remotes', 'c.git'), 'rev-list', '--count', `master..${sc.branch}`], { encoding: 'utf8' }).trim(), '1');
  const d = await run(args(['--answer=done'])); assert.equal(d.out.outcome.title, 'PR 3개 올림');
});

test('master 위로 옮기다 충돌이 나면 갈라진 브랜치로, husky 훅 파일이 없으면 만들어서 push', async () => {
  const e = repo('e', { develop: true });
  // master에는 같은 줄이 다른 값 — 옮기면 충돌
  const src = e.path; g(src, 'checkout', '-q', 'master'); fs.writeFileSync(path.join(src, '.nvmrc'), '22.12.0\n'); g(src, 'commit', '-qam', 'master differs'); g(src, 'push', '-q', 'origin', 'master'); g(src, 'fetch', '-q', path.join(tmp, 'remotes', 'e.git'), '+refs/heads/*:refs/remotes/origin/*');
  // husky 8 꼴 훅: _/husky.sh가 없으면 push가 실패한다
  const h = repo('h'); fs.mkdirSync(path.join(h.worktree, '.husky')); fs.writeFileSync(path.join(h.worktree, '.husky', 'pre-push'), '#!/bin/sh\n. "$(dirname "$0")/_/husky.sh"\n', { mode: 0o755 });
  fs.mkdirSync(path.join(h.worktree, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(h.worktree, 'node_modules', '.bin', 'husky'), '#!/bin/sh\nmkdir -p .husky/_ && echo "# ok" > .husky/_/husky.sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(h.worktree, '.gitignore'), 'node_modules\n.husky/_\n'); g(h.worktree, 'add', '.'); g(h.worktree, 'commit', '-q', '--amend', '--no-edit'); g(h.path, 'config', 'core.hooksPath', '.husky');
  const rep = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')); rep.repos.push(e, h); fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(rep));
  const before = prs.length;
  const r1 = await run(args(['--answer=ship:e'])); assert.equal(r1.code, 0, JSON.stringify(r1.out));
  const se = JSON.parse(fs.readFileSync(path.join(dir, 'ship.json'), 'utf8')).e;
  assert.equal(se.base, 'develop'); assert.match(se.note, /충돌이 나서 develop으로/); assert.equal(prs[before].base, 'develop');
  assert.equal(g(e.worktree, 'rev-list', '--count', 'origin/develop..HEAD'), '1'); assert.equal(g(e.worktree, 'status', '--porcelain'), '');
  const r2 = await run(args(['--answer=ship:h'])); assert.equal(r2.code, 0, JSON.stringify(r2.out));
  const sh = JSON.parse(fs.readFileSync(path.join(dir, 'ship.json'), 'utf8')).h;
  assert.equal(sh.error, null, JSON.stringify(sh)); assert.ok(sh.pushed && sh.pr_url); assert.ok(fs.existsSync(path.join(h.worktree, '.husky', '_', 'husky.sh')));
});

test('다른 GitHub의 레포와 커밋 안 한 파일은 올리지 않는다', async () => {
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'ship.json'), 'utf8')); delete st.a; st.b.pr_url = 'x'; fs.writeFileSync(path.join(dir, 'ship.json'), JSON.stringify(st));
  fs.writeFileSync(path.join(dir, 'a', 'dirty'), '1');
  const r = await run(args(['--answer=ship'])); assert.match(JSON.parse(fs.readFileSync(path.join(dir, 'ship.json'), 'utf8')).a.error, /커밋하지 않은 파일이 1개/);
  fs.rmSync(path.join(dir, 'a', 'dirty'));
  const r2 = await run([...args(['--answer=ship']).filter(x => !x.startsWith('--github_api')), '--github_api=https://api.github.com']);
  assert.equal(r2.code, 1); // api.github.com에 /user를 못 읽거나(망) 토큰 오류 — 어쨌든 쓰지 않는다
});
