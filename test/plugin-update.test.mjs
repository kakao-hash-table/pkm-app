// 플러그인 업데이트 — 설치 기록의 출처(앱 내장·로컬 폴더)를 설치한 파일과 견주고, 다시 가져와 바꾸기
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as plugins from '../server/plugins.js';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-plugin-up-'));
const APP = path.join(T, 'app-plugins'), PROFILE = path.join(T, 'data', '회사'), SRC = path.join(APP, 'deploy-loop');
fs.mkdirSync(PROFILE, { recursive: true });
fs.cpSync(new URL('./fixtures/plugin-ok/', import.meta.url).pathname, SRC, { recursive: true });
after(() => fs.rmSync(T, { recursive: true, force: true }));
const recOf = () => JSON.parse(fs.readFileSync(path.join(PROFILE, '_플러그인', 'deploy-loop', '.pkm-install.json'), 'utf8'));

test('앱에 들어 있는 플러그인은 경로 대신 앱 내장으로 기록하고, 같으면 업데이트가 없다', async () => {
  const ins = await plugins.inspect({ local: SRC }, APP);
  assert.equal(ins.source.type, 'bundled'); assert.equal(ins.source.id, 'deploy-loop');
  await plugins.install(PROFILE, ins.stage);
  assert.equal(recOf().source.type, 'bundled');
  assert.deepEqual(await plugins.updates(PROFILE, APP), {});
});

test('정본이 바뀌면 바뀐 파일·버전을 알려 주고, 다시 가져와 바꾸면 업데이트가 사라진다', async () => {
  const mf = path.join(SRC, 'plugin.md');
  fs.writeFileSync(mf, fs.readFileSync(mf, 'utf8').replace('version: 0.1.0', 'version: 0.2.0'));
  fs.appendFileSync(path.join(SRC, 'scripts', 'pr-body.mjs'), '\n// 고침\n');
  fs.writeFileSync(path.join(SRC, 'prompts', '새.md'), '새 프롬프트');
  const u = (await plugins.updates(PROFILE, APP))['deploy-loop'];
  assert.equal(u.kind, 'bundled'); assert.equal(u.from, '0.1.0'); assert.equal(u.to, '0.2.0');
  assert.deepEqual(u.files.map(f => `${f.kind} ${f.path}`), ['바뀜 plugin.md', '새 파일 prompts/새.md', '바뀜 scripts/pr-body.mjs']);
  const r = await plugins.inspectUpdate(PROFILE, 'deploy-loop', APP);
  assert.equal(r.ok, true); assert.equal(r.update.to, '0.2.0'); assert.equal(r.update.changes.length, 3);
  const done = await plugins.install(PROFILE, r.stage);
  assert.equal(done.previous, '0.1.0'); assert.equal(done.version, '0.2.0');
  assert.deepEqual(await plugins.updates(PROFILE, APP), {});
  assert.equal(fs.readdirSync(path.join(PROFILE, '.trash', '_플러그인')).length, 1);   // 이전 것은 휴지통으로
});

test('예전 기록(앱 플러그인 폴더의 로컬 경로)도 앱 내장으로 알아보고, 다른 로컬 폴더는 그 폴더와 견준다', async () => {
  const f = path.join(PROFILE, '_플러그인', 'deploy-loop', '.pkm-install.json'), rec = recOf();
  fs.writeFileSync(f, JSON.stringify({ ...rec, source: { type: 'local', path: SRC } }));
  fs.appendFileSync(path.join(SRC, 'prompts', '새.md'), ' 더');
  assert.equal((await plugins.updates(PROFILE, APP))['deploy-loop'].kind, 'bundled');
  const other = path.join(T, 'my-plugin'); fs.cpSync(SRC, other, { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ ...rec, source: { type: 'local', path: other } }));
  const u = (await plugins.updates(PROFILE, APP))['deploy-loop'];
  assert.equal(u.kind, 'local'); assert.deepEqual(u.files.map(x => x.path), ['prompts/새.md']);
  fs.writeFileSync(f, JSON.stringify({ ...rec, source: { type: 'local', path: path.join(T, '없는 폴더') } }));
  assert.deepEqual(await plugins.updates(PROFILE, APP), {});
  await assert.rejects(plugins.inspectUpdate(PROFILE, 'deploy-loop', APP), /기록이 없거나 그 폴더가 사라졌어요/);
});
