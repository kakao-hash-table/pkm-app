// 아지트 데일리 플러그인(plugins/agit-daily) — 임시 프로필의 데일리·약속·단기보드·쉬는 날로 ww 데일리와 같은 글을 만드는지
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as plugins from '../server/plugins.js';

const PLUGIN = new URL('../plugins/agit-daily/', import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-agit-daily-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

// 2026-10-26(월) 기록, 10-27(화) 쉬는 날, 10-28(수) 기록 없음(쉬는 날로 안 적힌 공휴일) → 10-29(목)의 한 일은 10-26
const profile = path.join(tmp, '회사');
write(path.join(profile, '_설정.md'), '---\ntype: settings\nfolders:\n  daily: "02_시간/데일리"\n  project: "03_행동/단기보드"\n  appointment: "03_행동/약속보드"\noffdays:\n  - { date: "2026-10-27", label: 휴가 }\n  - { date: "2026-11-03", label: "연차 (병원)" }\n  - { date: "2026-11-10", label: 워크샵 }\n  - { date: "2026-11-20", label: 늦은 휴가 }\n---\n');
write(path.join(profile, '02_시간/데일리/2026-10-26.md'), '---\ntype: daily\ndate: "2026-10-26"\n---\n\n# 오늘 계획\n## 09:00\n- [x] [[MPEN-1210 [Web][장소상세] CP계정 후기 작성 허용]] · 60분\n- [ ] [[위키 정리]]\n\n# 메모\n- [ ] 메모의 체크박스는 계획이 아니다\n');
write(path.join(profile, '02_시간/데일리/2026-10-29.md'), '---\ntype: daily\ndate: "2026-10-29"\n---\n\n# 오늘 계획\n## 09:05\n- [ ] [[티켓 분할하기]] · 30분\n- [ ] [[위키 정리]] · 30분\n\n# 한 줄 회고\n');
write(path.join(profile, '03_행동/약속보드/2026-10-26 주간회의.md'), '---\ntype: appointment\ntitle: 주간회의\nstart: "2026-10-26T13:30"\n---\n');
write(path.join(profile, '03_행동/약속보드/2026-10-29 웹 개편 논의.md'), '---\ntype: appointment\ntitle: 웹 개편 논의\nstart: "2026-10-29T16:00"\n---\n');
write(path.join(profile, '03_행동/단기보드/a.md'), '---\ntype: project\ntitle: MPEN-1210 [Web][장소상세] CP계정 후기 작성 허용\nstatus: done\n---\n');
write(path.join(profile, '03_행동/단기보드/b.md'), '---\ntype: project\ntitle: 티켓 분할하기\nstatus: doing\n---\n');
write(path.join(profile, '03_행동/단기보드/c.md'), '---\ntype: project\ntitle: MAP-77 로그 정리\nstatus: doing\n---\n');

const run = (...a) => JSON.parse(execFileSync(process.execPath, [path.join(PLUGIN, 'scripts/daily.mjs'), ...a, `--profile=${profile}`, '--tag=hash', '--jira=https://jira.example/browse/', '--agit='], { encoding: 'utf8' }));

test('규격 검사를 통과한다', async () => {
  const r = await plugins.inspect({ local: PLUGIN });
  assert.equal(r.ok, true, (r.errors || []).join('\n'));
});

test('오늘 항목 — 직전 근무일은 쉬는 날과 기록이 빈 날을 건너뛴다', () => {
  const r = run('today', '--date=2026-10-29');
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.items[0].meta, ['한 일 10/26(월) 3건', '할 일 3건', '진행 중 카드 1개']);
  assert.deepEqual(r.items[0].vars, { date: '2026-10-29' });
  assert.equal(run('today', '--date=2026-11-03').items.length, 0);   // 쉬는 날
  assert.equal(run('today', '--date=2026-11-01').items.length, 0);   // 일요일
});

test('ww 데일리와 같은 글 — 약속(시각)과 계획, 지라 링크, 이슈, 월·주차 태그', () => {
  const r = run('draft', '--date=2026-10-29');
  assert.equal(r.findings[0].copy, [
    '**한 일**', '- [x] 주간회의 (13:30)', '- [x] [MPEN-1210](https://jira.example/browse/MPEN-1210) [Web][장소상세] CP계정 후기 작성 허용', '- [x] 위키 정리', '',
    '**할 일**', '- [ ] 웹 개편 논의 (16:00)', '- [ ] 티켓 분할하기', '- [ ] 위키 정리', '',
    '**이슈**', '- 10월 29일 목요일입니다.', '- 11/3(화) 연차', '- 11/10(화) 워크샵', '',
    '[#hash202610](https://kakao.agit.in/search?q=%23hash202610) [#hash20261005](https://kakao.agit.in/search?q=%23hash20261005)'
  ].join('\n'));
  assert.deepEqual(r.ask.choices.map(c => c.value), ['done', 'doing']);
  assert.equal(r.ask.inline, true);
});

test('진행 중 카드 더하기(오늘 계획에 없는 것만) → 다 썼어요로 끝', () => {
  const r = run('draft', '--date=2026-10-29', '--answer=doing');
  assert.match(r.findings[0].copy, /- \[ \] 위키 정리\n- \[ \] \[MAP-77\]\(https:\/\/jira\.example\/browse\/MAP-77\) 로그 정리\n/);
  assert.deepEqual(r.ask.choices.map(c => c.value), ['done+doing', 'plain']);
  const end = run('draft', '--date=2026-10-29', '--answer=done+doing');
  assert.equal(end.ask, undefined);
  assert.equal(end.outcome.title, '다 썼어요');
  assert.match(end.findings[0].copy, /MAP-77/);
});

test('설치된 자리(<프로필>/_플러그인/agit-daily/scripts)에서 프로필을 찾는다', () => {
  const inst = path.join(profile, '_플러그인', 'agit-daily');
  fs.cpSync(PLUGIN, inst, { recursive: true });
  const r = JSON.parse(execFileSync(process.execPath, [path.join(inst, 'scripts/daily.mjs'), 'today', '--date=2026-10-29', '--tag=', '--jira=', '--agit='], { encoding: 'utf8' }));
  assert.equal(r.items[0].title, '10/29(목) 데일리');
});
