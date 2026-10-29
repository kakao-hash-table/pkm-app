// 지라 자동 작업 — 저장소 찾기(plugins/jira-autopilot/scripts/project.mjs): 규칙에 저장소 여럿, 다시 고르기(*), 고른 것은 규칙에 더하기
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = new URL('../plugins/jira-autopilot/scripts/project.mjs', import.meta.url).pathname;
const repos = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-jira-project-'));
after(() => fs.rmSync(repos, { recursive: true, force: true }));
for (const n of ['map', 'map-web', 'other']) fs.mkdirSync(path.join(repos, n, '.git'), { recursive: true });   // .git 폴더만 있으면 저장소로 본다

const run = (rules, extra = {}) => {
  const args = { key: 'MPEN-1', summary: '버튼 고치기', repos, rules, ...extra };
  try { return JSON.parse(execFileSync(process.execPath, [SCRIPT, ...Object.entries(args).map(([k, v]) => `--${k}=${v}`)], { encoding: 'utf8' })); }
  catch (e) { return JSON.parse(e.stdout); }
};

test('규칙에 저장소가 하나면 그대로 쓰고, 바꾸기·다른 저장소에서도 작업 버튼을 남긴다', () => {
  const r = run('MPEN → map');
  assert.equal(r.name, 'map'); assert.equal(r.lane, 'map'); assert.equal(r.how, '규칙');
  assert.deepEqual(r.change, { label: '저장소 바꾸기', value: '*' }); assert.deepEqual(r.fork, { label: '다른 저장소에서도 작업', value: '*' });
});

test('규칙에 저장소가 여럿이면 묻고, 연결된 것이 먼저이며 나머지 저장소도 고를 수 있다', () => {
  const r = run('MPEN → map, map-web (기준 develop)');
  assert.deepEqual(r.ask.choices.map(c => c.value), ['map', 'map-web', 'other']);
  assert.equal(r.ask.choices.find(c => c.recommended).value, 'map');
  const a = run('MPEN → map, map-web (기준 develop)', { answer: 'map-web' });
  assert.equal(a.name, 'map-web'); assert.equal(a.base, 'develop'); assert.equal(a.settings_patch, undefined);   // 이미 연결된 것은 규칙을 안 바꾼다
});

test('--answer=* 는 모든 저장소에서 다시 고르게 하고, 새로 고른 것은 그 프로젝트 줄에 더한다(덮어쓰지 않음)', () => {
  const r = run('MPEN → map (기준 develop)\n[웹] → map-web', { answer: '*' });
  assert.deepEqual(r.ask.choices.map(c => c.value), ['map', 'map-web', 'other']);
  assert.equal(r.ask.choices.some(c => c.recommended), false);
  const a = run('MPEN → map (기준 develop)\n[웹] → map-web', { answer: 'other' });
  assert.equal(a.name, 'other');
  assert.equal(a.settings_patch.projects, 'MPEN → map, other (기준 develop)\n[웹] → map-web');
  assert.equal(run('', { answer: 'other' }).settings_patch.projects, 'MPEN → other');
});

test('제목 [태그] 규칙이 맞으면 그것만 본다', () => {
  const r = run('MPEN → map\n[웹] → map-web', { summary: '[웹] 버튼 고치기' });
  assert.equal(r.name, 'map-web');
});
