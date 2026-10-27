// 플러그인 규격 검사 — 받을 것과 거절할 것
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../web/js/pkm-plugin.js');

const dir = new URL('./fixtures/plugin-ok/', import.meta.url).pathname;
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const base = () => walk(dir).map(f => ({ path: path.relative(dir, f), size: fs.statSync(f).size, text: fs.readFileSync(f, 'utf8') }));
const withFile = (files, p, text) => [...files.filter(f => f.path !== p), { path: p, size: Buffer.byteLength(text), text }];
const manifest = mut => withFile(base(), 'plugin.md', mut(fs.readFileSync(path.join(dir, 'plugin.md'), 'utf8')));

test('예시 플러그인을 받는다', () => {
  const r = P.validate(base());
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.manifest.id, 'deploy-loop');
  assert.deepEqual(r.manifest.permissions, { ai: ['chat', 'agent'], agent_mode: 'read', scripts: ['jira'], bundled: ['scripts/pr-body.mjs'], secrets: [] });
  assert.equal(r.workflows[0].steps.length, 5);
  assert.equal(r.workflows[0].steps[3].body, '이 카드의 경로에서 바뀐 파일을 읽고\n위험한 부분만 짧게 알려 줘');
});

test('plugin.md가 없거나 규격 버전이 다르면 거절', () => {
  assert.match(P.validate(base().filter(f => f.path !== 'plugin.md')).errors[0], /plugin.md가 없어요/);
  assert.match(P.validate(manifest(t => t.replace('pkm_plugin: 1', 'pkm_plugin: 2'))).errors.join(), /pkm_plugin이 1/);
  assert.match(P.validate(manifest(t => t.replace('id: deploy-loop', 'id: Deploy Loop'))).errors.join(), /id는/);
});

test('선언하지 않은 스크립트·화면 코드는 거절', () => {
  assert.match(P.validate(withFile(base(), 'scripts/evil.sh', 'rm -rf ~')).errors.join(), /선언하지 않은 스크립트예요: scripts\/evil.sh/);
  assert.match(P.validate(withFile(base(), 'view.html', '<script>alert(1)</script>')).errors.join(), /받을 수 없는 파일 종류예요: view.html/);
  assert.match(P.validate(manifest(t => t.replace('bundled: [scripts/pr-body.mjs]', 'bundled: [../outside.mjs]'))).errors.join(), /scripts\/ 아래/);
});

test('워크플로우가 권한을 넘으면 거절', () => {
  const wf = (body) => withFile(base(), 'workflows/배포.md', `## 배포\n${body}\n`);
  assert.match(P.validate(wf('- [x] 몰래 · script: ghe create-pr')).errors.join(), /선언하지 않은 스크립트 "ghe"/);
  assert.match(P.validate(wf('- [x] 고치기 · agent(auto): 다 고쳐 줘')).errors.join(), /상한 read보다 높아요/);
  const noAgent = manifest(t => t.replace('ai: [chat, agent]', 'ai: [chat]'));
  assert.match(P.validate(noAgent).errors.join(), /permissions.ai에 agent가 없어요/);
});

test('숨김 파일(.git 등)은 보지 않는다', () => {
  const r = P.validate([...base(), { path: '.git/config', size: 10, text: '' }, { path: '.DS_Store', size: 10 }]);
  assert.equal(r.ok, true, r.errors.join('\n'));
});

test('플러그인 폴더의 문서는 노트로 읽지 않는다', () => {
  const MD = require('../web/js/pkm-md.js');
  const r = MD.parse({ '_플러그인/deploy-loop/plugin.md': '---\ntype: inbox\n---\n몰래', '00_인박스/a.md': '---\ntype: inbox\n---\n진짜' });
  assert.deepEqual(r.db.inbox.map(x => x.text), ['진짜']);
});

test('피드·비밀값·단계 폴더 — 선언한 스크립트로만 가져오고, 비밀값은 이름만 받는다', () => {
  const withSecrets = t => t.replace('bundled: [scripts/pr-body.mjs]', 'bundled: [scripts/pr-body.mjs]\n  secrets:\n    - { name: DEMO_TOKEN, label: 데모 토큰, url: "https://example.com/tokens" }\n    - OTHER_TOKEN');
  const feed = body => withFile(manifest(withSecrets), 'feeds/목록.md', body);
  const ok = P.validate(feed('## 내 할 일\n바뀐 것만 가져와요.\n- run: scripts/pr-body.mjs list {jira_project}\n- every: 30\n- days: weekdays\n- hours: 08:30-18:00\n- start: 배포\n- start_mode: auto\n'));
  assert.equal(ok.ok, true, ok.errors.join('\n'));
  assert.deepEqual(ok.manifest.permissions.secrets, ['DEMO_TOKEN', 'OTHER_TOKEN']);
  assert.deepEqual(ok.manifest.secrets[0], { name: 'DEMO_TOKEN', label: '데모 토큰', hint: '', url: 'https://example.com/tokens' });
  assert.deepEqual(ok.feeds[0], { name: '내 할 일', file: 'feeds/목록.md', description: '바뀐 것만 가져와요.', run: 'scripts/pr-body.mjs list {jira_project}', every: 30, days: 'weekdays', hours: '08:30-18:00', start: '배포', start_mode: 'auto', empty: '' });
  assert.match(P.validate(feed('## a\n- run: scripts/none.mjs\n')).errors.join(), /선언하지 않은 스크립트 "scripts\/none.mjs"/);
  assert.match(P.validate(feed('## a\n- run: scripts/pr-body.mjs\n- every: 1\n- start: 없는것\n')).errors.join(), /every는 5~1440분[\s\S]*워크플로우 "없는것"가 없어요/);
  assert.match(P.validate(manifest(t => t.replace('bundled: [scripts/pr-body.mjs]', 'bundled: [scripts/pr-body.mjs]\n  secrets: [token]'))).errors.join(), /영문 대문자/);
  const wf = P.parseWorkflows('## a\n- [구현] 고치기 · agent(read) in {프로젝트.dir}: 고쳐 줘\n- [확인] 보기 · manual');
  assert.deepEqual(wf[0].steps.map(s => [s.kind, s.mode, s.cwd, s.body]), [['agent', 'read', '{프로젝트.dir}', '고쳐 줘'], ['manual', null, null, '']]);
});
