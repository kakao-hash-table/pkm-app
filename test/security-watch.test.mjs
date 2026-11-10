// 보안 공지 대응 플러그인(plugins/security-watch) — 아지트 공지 고르기, 작업 폴더 준비, report.json 정리, 검사기 통과
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-security-watch-')));
const HOME = path.join(tmp, 'home');
fs.mkdirSync(HOME);
const PLUGIN = new URL('../plugins/security-watch/', import.meta.url).pathname;
const SCRIPT = path.join(PLUGIN, 'scripts/notice.mjs');
const N = await import(SCRIPT);

let server, base, route = () => [404, {}];
before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const [status, body] = route({ path: u.pathname, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization || '' });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function run(args, env = {}){
  return new Promise(ok => execFile(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, HOME, ...env }, timeout: 20000 }, (err, stdout) => {
    ok({ code: err ? err.code : 0, out: JSON.parse(String(stdout).trim().split('\n').pop()) });
  }));
}
const repo = name => { const d = path.join(tmp, 'code', name); fs.mkdirSync(d, { recursive: true }); execFileSync('git', ['init', '-q', d]); return d; };
const now = Math.floor(Date.now() / 1000);

test('제목 줄: 멘션·이스케이프·굵게를 걷고 규칙에 맞는 첫 줄', () => {
  const re = /보안\s*공지/;
  assert.equal(N.titleOf('[@group](https://kakao.agit.in/g/433912) \n# \\[보안공지\\] Brotli RCE 취약점(CVE-2026-111497) 대응 안내\n본문', re), '[보안공지] Brotli RCE 취약점(CVE-2026-111497) 대응 안내');
  assert.equal(N.titleOf('*\\[긴급 보안 공지\\]* Next.js RCE 취약점', re), '[긴급 보안 공지] Next.js RCE 취약점');
  assert.equal(N.titleOf('안녕하세요\nTopview 베타 오픈', re), null);
  assert.equal(N.slugOf(1, 'x CVE-2026-111497 y cve-2026-1'), 'cve-2026-111497');
  assert.equal(N.slugOf(475, '공지'), 'agit-475');
});

test('list: 규칙에 맞는 부모 글만, 기간 안, 수정 시각이 version', async () => {
  route = r => {
    assert.equal(r.auth, 'Bearer tok');
    assert.equal(r.query.is_parent, 'true');
    return [200, { wall_messages: [
      { id: 3, text: '# \\[보안공지\\] Brotli CVE-2026-111497', created_time: now - 86400, modified_time: now },
      { id: 2, text: '공지 아님', created_time: now - 100 },
      { id: 1, text: '[보안 공지] 옛 글', created_time: now - 86400 * 40 }
    ] }];
  };
  const { code, out } = await run(['list', `--api=${base}`, '--web=https://kakao.agit.in', '--groups=4', '--days=14'], { AGIT_TOKEN: 'tok' });
  assert.equal(code, 0, JSON.stringify(out));
  assert.deepEqual(out.items.map(i => [i.id, i.title, i.url, i.tags, i.version]), [['3', '[보안공지] Brotli CVE-2026-111497', 'https://kakao.agit.in/g/4/wall/3', ['CVE-2026-111497'], String(now)]]);
  assert.match(out.items[0].meta.join(' '), /수정/);
  const none = await run(['list', `--api=${base}`]);
  assert.match(none.out.error, /토큰이 없어요/);
});

test('fetch: 공지 폴더에 본문·프로젝트, 비면 개발 도구 프로젝트, 뺄 것은 빼기', async () => {
  repo('web'); repo('phocus'); fs.mkdirSync(path.join(tmp, 'code', 'not-git'));
  fs.mkdirSync(path.join(HOME, '.pkm-app'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.pkm-app', 'runner.json'), JSON.stringify({ profiles: { 회사: { plugins: { 'dev-tools': { settings: { projects: `${path.join(tmp, 'code')}/*` } } } } } }));
  route = r => r.path === '/wall_messages/9' ? [200, { wall_message: { id: 9, text: '# 보안공지 CVE-2026-1234\nNode 22.23.4 미만' } }] : [404, {}];
  const { code, out } = await run(['fetch', `--api=${base}`, '--id=9', '--title=보안공지 테스트', '--projects=', '--exclude=phocus', `--worktrees=${path.join(tmp, 'wt')}`], { AGIT_TOKEN: 'tok' });
  assert.equal(code, 0, JSON.stringify(out));
  assert.equal(out.dir, path.join(tmp, 'wt', 'cve-2026-1234'));
  assert.equal(out.branch, 'security/cve-2026-1234');
  assert.equal(out.names, 'web');
  assert.match(out._text, /22\.23\.4/);
  assert.match(fs.readFileSync(path.join(out.dir, 'notice.md'), 'utf8'), /Node 22\.23\.4 미만/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out.dir, 'projects.json'), 'utf8')).map(p => p.name), ['web']);
});

test('report: 해당 없음 판정, 결과 파일 없으면 실패, 고친 레포를 먼저', async () => {
  const no = await run(['report', '--dir=/nowhere', '--relevant=false', '--reason=서버 OS 공지']);
  assert.equal(no.out.verdict.tone, 'ok');
  assert.match(no.out.verdict.title, /해당 없어요/);
  const dir = path.join(tmp, 'wt', 'r');
  fs.mkdirSync(dir, { recursive: true });
  assert.match((await run(['report', `--dir=${dir}`, '--relevant=true'])).out.error, /결과 파일/);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ summary: '3개 중 1개 고침', repos: [
    { name: 'map', status: 'ok', risk: 'none', problem: '빌드 단계만 node:24 메이저 태그' },
    { name: 'place-web', path: '/c/place-web', status: 'fixed', risk: 'server', problem: 'Dockerfile:1 node:24.14.1 (취약)', changes: [{ file: 'Dockerfile', line: 1, before: 'node:24.14.1-alpine', after: 'node:24.22.1-alpine' }], base: 'origin/master', branch: 'security/x', commit: 'a483b79', tests: 'jest 1052 통과', todo: '재배포' },
    { name: 'dmaps', status: 'skip', risk: 'none', problem: 'Node 없음' }
  ] }));
  const { out } = await run(['report', `--dir=${dir}`, '--relevant=true']);
  assert.equal(out.verdict.tone, 'bad');
  assert.match(out.verdict.title, /레포 1개에 수정 커밋/);
  assert.deepEqual(out.findings.map(f => [f.where, f.tag]), [['place-web · 서버', '고침'], ['map', '괜찮음'], ['dmaps', '해당 없음']]);
  assert.match(out.findings[0].text, /고친 곳: Dockerfile:1  전 node:24\.14\.1-alpine  후 node:24\.22\.1-alpine/);
  assert.match(out.findings[0].text, /할 일: 재배포/);
  assert.equal(out.findings[0].copy, 'git -C /c/place-web show security/x');
  assert.equal(out.summary, '고침 1 · 괜찮음 1 · 해당 없음 1');
});

test('검사기가 보안 공지 대응 플러그인을 받는다', () => {
  const P = createRequire(import.meta.url)('../web/js/pkm-plugin.js');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const r = P.validate(walk(PLUGIN).map(f => ({ path: path.relative(PLUGIN, f), size: fs.statSync(f).size, text: fs.readFileSync(f, 'utf8') })));
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.manifest.id, 'security-watch');
  assert.deepEqual(r.manifest.permissions.secrets, ['AGIT_TOKEN']);
  assert.deepEqual(r.feeds.map(f => [f.name, f.starts, f.start_mode, f.notify]), [['보안 공지', ['보안 공지 대응'], 'auto', true]]);
  assert.deepEqual(r.workflows.map(w => [w.name, w.steps.map(x => x.kind)]), [['보안 공지 대응', ['script', 'ai', 'agent', 'script', 'manual']]]);
  const agent = r.workflows[0].steps[2];
  assert.equal(agent.when, '{판단.relevant}');
  assert.equal(agent.cwd, '{공지.dir}');
});
