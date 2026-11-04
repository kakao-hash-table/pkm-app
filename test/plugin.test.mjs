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
  assert.deepEqual(ok.feeds[0], { name: '내 할 일', file: 'feeds/목록.md', description: '바뀐 것만 가져와요.', run: 'scripts/pr-body.mjs list {jira_project}', every: 30, days: 'weekdays', hours: '08:30-18:00', start: '배포', starts: ['배포'], start_mode: 'auto', empty: '', count: null });
  assert.match(P.validate(feed('## a\n- run: scripts/none.mjs\n')).errors.join(), /선언하지 않은 스크립트 "scripts\/none.mjs"/);
  assert.match(P.validate(feed('## a\n- run: scripts/pr-body.mjs\n- every: 1\n- start: 없는것\n')).errors.join(), /every는 5~1440분[\s\S]*워크플로우 "없는것"가 없어요/);
  assert.match(P.validate(manifest(t => t.replace('bundled: [scripts/pr-body.mjs]', 'bundled: [scripts/pr-body.mjs]\n  secrets: [token]'))).errors.join(), /영문 대문자/);
  const wf = P.parseWorkflows('## a\n- [구현] 고치기 · agent(read) in {프로젝트.dir}: 고쳐 줘\n- [확인] 보기 · manual');
  assert.deepEqual(wf[0].steps.map(s => [s.kind, s.mode, s.cwd, s.body]), [['agent', 'read', '{프로젝트.dir}', '고쳐 줘'], ['manual', null, null, '']]);
});

test('검색·편집기·여러 워크플로우 시작 — 검사기가 받고, 잘못 적으면 막는다', () => {
  const man = '---\npkm_plugin: 1\nid: ext-test\nname: 확장\nversion: 0.1.0\npermissions:\n  bundled: [scripts/s.mjs]\n---\n';
  const wf = '## 실행\n- [a] 시작 · script: scripts/s.mjs go\n## 멈추기\n- [b] 멈춤 · script: scripts/s.mjs stop\n';
  const files = extra => [{ path: 'plugin.md', size: 1, text: man }, { path: 'scripts/s.mjs', size: 1, text: '' }, { path: 'workflows/w.md', size: 1, text: wf }, ...extra];
  const good = P.validate(files([
    { path: 'feeds/f.md', size: 1, text: '## 목록\n- run: scripts/s.mjs list\n- start: 실행, 멈추기\n' },
    { path: 'searches/s.md', size: 1, text: '## 위키\n위키에서 찾아요.\n- run: scripts/s.mjs wiki --q={q}\n- limit: 5\n' },
    { path: 'editors/e.md', size: 1, text: '## 주요 업무\n- note: {main_note}\n- block: ##\n- title: 300\n- body: 300\n- body_end: ^\\(\\d+자\\)\n- fields: 진행기간, 진행상태\n' }
  ]));
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.feeds[0].starts, ['실행', '멈추기']);
  assert.equal(good.feeds[0].start, '실행');
  assert.deepEqual(good.searches[0], { name: '위키', file: 'searches/s.md', description: '위키에서 찾아요.', run: 'scripts/s.mjs wiki --q={q}', limit: 5 });
  assert.equal(good.editors[0].block, '##'); assert.equal(good.editors[0].body, 300); assert.deepEqual(good.editors[0].fields, ['진행기간', '진행상태']);
  const bad = P.validate(files([
    { path: 'feeds/f.md', size: 1, text: '## 목록\n- run: scripts/s.mjs list\n- start: 실행, 없는것\n' },
    { path: 'searches/s.md', size: 1, text: '## 위키\n- run: scripts/s.mjs wiki\n' },
    { path: 'editors/e.md', size: 1, text: '## 칸\n- note: 노트\n- block: #\n- body_end: ([\n' }
  ]));
  assert.ok(bad.errors.some(e => e.includes('"없는것"')));
  assert.ok(bad.errors.some(e => e.includes('{q}')));
  assert.ok(bad.errors.some(e => e.includes('block')));
  assert.ok(bad.errors.some(e => e.includes('body_end')));
});

test('편집기 — 칸으로 나누고, 고친 칸만 끼워 넣고, 글자 수 줄을 고친다', () => {
  const app = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const fn = name => { const i = app.indexOf(`function ${name}(`); let d = 0, j = app.indexOf('{', i); for (; j < app.length; j++){ if (app[j] === '{') d++; else if (app[j] === '}' && --d === 0) break; } return app.slice(i, j + 1); };
  const { pedParse, pedApply } = new Function(`${app.match(/const hLevel = [^\n]+/)[0]}\n${fn('pedParse')}\n${fn('pedApply')}\nreturn { pedParse, pedApply };`)();
  const ed = P.validate([{ path: 'plugin.md', size: 1, text: '---\npkm_plugin: 1\nid: ed-test\nname: 편집\nversion: 0.1.0\n---\n' },
    { path: 'editors/e.md', size: 1, text: '## 주요\n- note: 노트\n- block: ##\n- title: 30\n- body: 50\n- body_end: ^\\(\\d+자\\)\n- count: ^\\((\\d+)자\\)\n\n## 과제\n- note: 노트\n- within: ^## 과제 관리\n- group: ###\n- block: ####\n- fields: 진행상태\n- body_start: ^실행 내용\\s*$\n- body_end: ^- 함께한 사람\\s*:\n' }]).editors;
  const main = '머리말\n\n## 1. 첫 일\n\n첫 본문\n\n(3자) 근거: 가\n\n---\n\n## 메모\n\n글자 수 줄이 없는 칸\n';
  const P1 = pedParse(main, ed[0]);
  assert.deepEqual(P1.blocks.map(b => [b.title, b.body]), [['1. 첫 일', '첫 본문']]);
  assert.equal(pedApply(P1, ed[0], [{ title: '1. 첫 일', body: '첫 본문', fields: [] }]), main);
  const out = pedApply(P1, ed[0], [{ title: '1. 고친 일', body: '고친 본문입니다', fields: [] }]);
  assert.match(out, /^## 1\. 고친 일$/m); assert.match(out, /^고친 본문입니다$/m); assert.match(out, /^\(8자\) 근거: 가$/m); assert.match(out, /글자 수 줄이 없는 칸/);
  const tasks = '## 주요 업무\n#### 밖\n실행 내용\n무시\n- 함께한 사람: 가\n\n## 과제 관리\n\n### A 묶음\n\n#### 1-1. 일\n- 진행상태: 진행 중\n\n실행 내용\n\n가나다\n라마\n\n- 함께한 사람: 나\n\n## 다음\n';
  const P2 = pedParse(tasks, ed[1]);
  assert.equal(P2.blocks.length, 1); assert.equal(P2.blocks[0].group, 'A 묶음'); assert.equal(P2.blocks[0].body, '가나다\n라마'); assert.deepEqual(P2.blocks[0].fields.map(f => [f.name, f.value]), [['진행상태', '진행 중']]);
  const t2 = pedApply(P2, ed[1], [{ title: '1-1. 일', body: '새 본문', fields: ['진행 완료'] }]);
  assert.match(t2, /- 진행상태: 진행 완료\n\n실행 내용\n\n새 본문\n\n- 함께한 사람: 나/); assert.match(t2, /#### 밖\n실행 내용\n무시/);
});

test('체크인 — 편집기 두 개를 묶고, 프롬프트 파일·AI 권한·점검 규칙을 검사한다', () => {
  const man = ai => `---\npkm_plugin: 1\nid: ck-test\nname: 체크인\nversion: 0.1.0\n${ai ? 'permissions:\n  ai: [chat]\n' : ''}---\n`;
  const ed = '## 주요\n- note: 노트\n- block: ##\n- combine: 300\n- only: ^\\d+\\.\n\n## 과제\n- note: 노트\n- block: ####\n- after: 협업 동료\n- choices: 진행상태=진행중|진행 완료\n- check: 하이라이트=체크|없음\n- period: 진행기간\n';
  const files = (ai, ck, extra = []) => [{ path: 'plugin.md', size: 1, text: man(ai) }, { path: 'editors/e.md', size: 1, text: ed }, { path: 'checkins/c.md', size: 1, text: ck },
    { path: 'prompts/style.md', size: 1, text: '문체' }, { path: 'prompts/score.md', size: 1, text: '{rubric}' }, { path: 'prompts/lint.md', size: 1, text: '# 주석\n## AI 티\n· → 가운뎃점\n' }, ...extra];
  const ck = '## 마이노트\n- main: 주요\n- tasks: 과제\n- rubric: {rubric_prefix}\n- style: prompts/style.md\n- score: prompts/score.md\n- lint: prompts/lint.md\n- card: 올해 성과로 넣기\n';
  const good = P.validate(files(true, ck));
  assert.deepEqual(good.errors, []);
  const e = good.editors;
  assert.equal(e[0].combine, 300); assert.equal(e[0].only, '^\\d+\\.');
  assert.deepEqual(e[1].after, ['협업 동료']); assert.deepEqual(e[1].choices, { 진행상태: ['진행중', '진행 완료'] }); assert.deepEqual(e[1].check, { 하이라이트: ['체크', '없음'] }); assert.deepEqual(e[1].period, ['진행기간']);
  const c = good.checkins[0];
  assert.equal(c.main, '주요'); assert.equal(c.card, '올해 성과로 넣기'); assert.equal(c.main_max, 5); assert.equal(c.highlight_max, 3);
  assert.equal(c.prompts.style, '문체'); assert.equal(c.prompts.score, '{rubric}');
  assert.ok(P.validate(files(false, ck)).errors.some(x => x.includes('permissions.ai에 chat')));
  assert.ok(P.validate(files(true, ck.replace('- tasks: 과제', '- tasks: 없는 편집기'))).errors.some(x => x.includes('tasks')));
  assert.ok(P.validate(files(true, ck + '- intake: prompts/none.md\n')).errors.some(x => x.includes('intake 프롬프트 파일이 없어요')));
  assert.ok(P.validate(files(true, ck, [{ path: 'prompts/lint.md', size: 1, text: '규칙이 아닌 줄\n' }])).errors.some(x => x.includes('lint 규칙')));
  assert.ok(P.validate([{ path: 'plugin.md', size: 1, text: man(true) }, { path: 'editors/e.md', size: 1, text: '## 칸\n- note: 노트\n- block: ##\n- check: 하이라이트=체크\n' }]).errors.some(x => x.includes('하이라이트')));
});

test('편집기 — 본문 뒤 칸(after)과 제목 고르기(only)', () => {
  const app = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const fn = name => { const i = app.indexOf(`function ${name}(`); let d = 0, j = app.indexOf('{', i); for (; j < app.length; j++){ if (app[j] === '{') d++; else if (app[j] === '}' && --d === 0) break; } return app.slice(i, j + 1); };
  const { pedParse, pedApply, pedSplit, pedPeriod } = new Function(`${app.match(/const hLevel = [^\n]+/)[0]}\n${app.match(/const pedNorm = [^\n]+/)[0]}\n${app.match(/const PED_PERIOD = [^\n]+/)[0]}\n${fn('pedParse')}\n${fn('pedApply')}\n${fn('pedSplit')}\n${fn('pedPeriod')}\nreturn { pedParse, pedApply, pedSplit, pedPeriod };`)();
  const ed = P.validate([{ path: 'plugin.md', size: 1, text: '---\npkm_plugin: 1\nid: ed-test\nname: 편집\nversion: 0.1.0\n---\n' },
    { path: 'editors/e.md', size: 1, text: '## 주요\n- note: 노트\n- block: ##\n- only: ^\\d+\\.\n- body_end: ^\\(\\d+자\\)\n\n## 과제\n- note: 노트\n- block: ####\n- fields: 진행상태\n- after: 협업 동료\n- body_start: ^실행\\s*$\n- body_end: ^- 협업 동료\\s*:\n' }]).editors;
  const main = '## 1. 일\n\n본문\n\n(2자)\n\n## 참고. 빠진 것\n\n남은 글\n\n(4자)\n';
  assert.deepEqual(pedParse(main, ed[0]).blocks.map(b => b.title), ['1. 일']);
  const tasks = '#### 1-1. 일\n- 진행상태: 진행 완료 (0928 배포)\n\n실행\n\n가나\n\n- 협업 동료: a (가)\n- 8/3 이후 추가: 메모\n';
  const P2 = pedParse(tasks, ed[1]), bk = P2.blocks[0];
  assert.deepEqual(bk.fields.map(f => [f.name, f.after || false]), [['진행상태', false], ['협업 동료', true]]);
  const out = pedApply(P2, ed[1], [{ title: bk.title, body: bk.body, fields: ['진행중 (0928 배포)', 'a (가), b (나)'] }]);
  assert.match(out, /- 진행상태: 진행중 \(0928 배포\)/); assert.match(out, /- 협업 동료: a \(가\), b \(나\)\n- 8\/3 이후 추가: 메모/);
  assert.deepEqual(pedSplit(['진행 예정', '진행중', '진행 완료'], '진행 중 (3단계 중 2단계)'), { opt: '진행중', rest: ' (3단계 중 2단계)' });
  assert.equal(pedSplit(['진행 완료'], '진행 완���').opt, null);
  assert.deepEqual(pedPeriod('2026-03 ~ 2026-07 (공유본은 06)'), { from: '2026-03', to: '2026-07', rest: ' (공유본은 06)' });
  assert.deepEqual(pedPeriod('2026-09 ~ 종료 시점 미정'), { from: '2026-09', to: '', rest: '종료 시점 미정' });
});

test('퀵링크 — 검사기가 규칙을 보고, 화면은 제목 맨 앞만 링크로 바꾼다', () => {
  const man = '---\npkm_plugin: 1\nid: ql-test\nname: 퀵링크\nversion: 0.1.0\nsettings:\n  - { key: rules, label: 규칙, type: lines }\n---\n';
  const files = rules => [{ path: 'plugin.md', size: 1, text: man }, { path: 'links/l.md', size: 1, text: `## 카드 제목\n제목 앞을 링크로.\n- rules: ${rules}\n` }];
  const good = P.validate(files('{rules}'));
  assert.deepEqual(good.errors, []); assert.deepEqual(good.warnings, []);
  assert.deepEqual(good.links, [{ name: '카드 제목', file: 'links/l.md', description: '제목 앞을 링크로.', rules: '{rules}' }]);
  assert.deepEqual(P.validate(files('[A-Z]+-\\d+ → https://x.test/$&')).errors, []);
  assert.deepEqual(P.validate(files('[A-Z]+-\\d+\thttps://x.test/$&')).errors, []);
  assert.match(P.validate(files('([ → https://x.test/')).errors.join(), /정규식이 맞지 않아요/);
  assert.match(P.validate(files('[A-Z]+ → javascript:alert(1)')).errors.join(), /http\(s\)/);
  assert.match(P.validate(files('')).errors.join(), /rules/);
  const bundled = P.validate(['plugin.md', 'links/퀵링크.md'].map(p => { const text = fs.readFileSync(new URL(`../plugins/quicklinks/${p}`, import.meta.url), 'utf8'); return { path: p, size: text.length, text }; }));
  assert.equal(bundled.ok, true, bundled.errors.join('\n'));

  const app = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const fn = name => { const i = app.indexOf(`function ${name}(`); let d = 0, j = app.indexOf('{', i); for (; j < app.length; j++){ if (app[j] === '{') d++; else if (app[j] === '}' && --d === 0) break; } return app.slice(i, j + 1); };
  const { qlParse, qlMatch } = new Function(`${fn('qlParse')}\n${fn('qlMatch')}\nreturn { qlParse, qlMatch };`)();
  const rules = qlParse([bundled.manifest.settings[0].default, '틀린 줄', '([ → https://x.test/', 'gh#(\\d+) -> https://github.test/pr/$1', 'X\tjavascript:alert(1)'].join('\n'));
  assert.equal(rules.length, 2);
  assert.equal(bundled.manifest.settings[0].type, 'pairs'); assert.deepEqual(bundled.manifest.settings[0].columns.map(c => c.check), ['regex', 'url']);
  assert.match(P.validate([{ path: 'plugin.md', size: 1, text: man.replace('type: lines', 'type: pairs, columns: [하나]') }, files('{rules}')[1]]).errors.join(), /칸 두 개/);
  assert.deepEqual(qlMatch('MPEN-1210 로그인 고치기', rules), { key: 'MPEN-1210', url: 'https://kakao.atlassian.net/browse/MPEN-1210', rest: '로그인 고치기' });
  assert.deepEqual(qlMatch('MAP2-7', rules), { key: 'MAP2-7', url: 'https://kakao.atlassian.net/browse/MAP2-7', rest: '' });
  assert.equal(qlMatch('로그인 고치기 MPEN-1210', rules), null);   // 맨 앞만
  assert.equal(qlMatch('MPEN-12ab 고치기', rules), null);
  assert.deepEqual(qlMatch('gh#42 리뷰', rules), { key: 'gh#42', url: 'https://github.test/pr/42', rest: '리뷰' });
});

test('pairs 설정 — 줄을 두 칸으로 나눠 보이고, 저장할 때 탭으로 묶고 틀린 칸을 짚는다', () => {
  const app = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const { plPairRows } = new Function(`${app.match(/const plPairRows = [^\n]+/)[0]}\nreturn { plPairRows };`)();
  assert.deepEqual(plPairRows('a\thttps://x/$&\n\nb → https://y\nc'), [['a', 'https://x/$&'], ['b', 'https://y'], ['c', '']]);
  assert.deepEqual(plPairRows(''), []);
});

test('누른 항목의 진행 — 누른 뒤에 만든 실행을 찾고, 상태마다 그 자리에 보일 한 줄을 정한다', () => {
  const at = Date.parse('2026-01-02T10:00:00Z'), iso = ms => new Date(at + ms).toISOString();
  const run = (o, steps) => ({ id: o.id || 'r1', feed: '할 일', item: { id: 'i1' }, workflow: '했어요', created: iso(1000), status: 'running', steps, ...o });
  const t = { feed: '할 일', item: 'i1', workflow: '했어요', at, skip: ['old'] };
  const runs = [run({ id: 'old', created: iso(500) }, []), run({ id: 'other', item: { id: 'i2' } }, []), run({ id: 'wf', workflow: '다르게 할래요' }, []), run({ id: 'stale', created: iso(-120000) }, []), run({ id: 'mine' }, [])];
  assert.equal(P.runOf(runs, t).id, 'mine');
  assert.equal(P.runOf(runs.slice(0, 4), t), null);   // 누르기 전에 있던 것·다른 항목·다른 워크플로우·오래된 것은 아니다

  const script = { key: 'end', kind: 'script', status: 'running' }, agent = { key: 'ai', kind: 'agent', status: 'running', started: iso(0) };
  assert.deepEqual(P.runFeedback(run({ status: 'queued' }, [{ ...script, status: 'pending' }])), { phase: 'busy', text: '처리하는 중…' });
  assert.equal(P.runFeedback(run({}, [agent]), at + 30000).text, 'AI가 하는 중 · 몇 분 걸려요');
  assert.equal(P.runFeedback(run({}, [agent]), at + 185000).text, 'AI가 하는 중 · 3분째');
  assert.match(P.runFeedback(run({ status: 'waiting' }, [{ ...agent, status: 'waiting', reason: 'limit' }])).text, /풀리면 이어서/);
  assert.deepEqual(P.runFeedback(run({ status: 'input' }, [{ key: 'done1', status: 'done' }, { key: 'res', kind: 'script', status: 'input' }])), { phase: 'input', text: '내 확인이 필요해요', step: 'res' });
  assert.deepEqual(P.runFeedback(run({ status: 'stopped' }, [{ key: 'end', kind: 'script', status: 'failed', error: '카드를 찾지 못했어요\n자세한 내용' }])), { phase: 'failed', text: '멈췄어요 · 카드를 찾지 못했어요', step: 'end' });
  assert.equal(P.runFeedback(run({ status: 'stopped', note: '워크플로우가 사라졌어요' }, [{ key: 'a', status: 'pending' }])).text, '멈췄어요 · 워크플로우가 사라졌어요');
  assert.deepEqual(P.runFeedback(run({ status: 'done' }, [{ key: 'end', status: 'done', output: { verdict: { tone: 'ok', title: '했어요', text: '예시 할 일' }, outcome: { title: '했어요' } } }])), { phase: 'done', tone: 'ok', text: '했어요 · 예시 할 일' });
  assert.equal(P.runFeedback(run({ status: 'done' }, [{ key: 'end', status: 'done', output: { outcome: { title: '뺐어요', text: '' } } }])).text, '뺐어요');
  assert.equal(P.runFeedback(run({ status: 'done' }, [{ key: 'end', status: 'done', output: { summary: 's' } }])).text, '끝났어요');
  assert.equal(P.runFeedback(run({ status: 'done' }, [{ key: 'end', status: 'done', output: { verdict: { tone: 'bad', title: '준비한 게 없어요' } } }])).tone, 'bad');
  assert.equal(P.runFeedback(run({ status: 'canceled' }, [])).phase, 'canceled');
  assert.equal(P.runFeedback(null), null);
});
