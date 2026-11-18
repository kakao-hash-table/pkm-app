// 기억해 둔 내 정보 — 한 번만 쓰는 값·비밀은 기억하지 않고, 다른 데서 받은 플러그인과는 나눠 쓰지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PKM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-mem-'));
const M = await import('../server/memory.js');

test('인증번호·비밀번호·OTP는 기억하지 않는다', () => {
  for (const n of ['인증번호', '휴대폰 인증 코드', 'OTP', '비밀번호', 'verification code', 'PIN']) M.remember('개인', n, '123456', 'contest-apply', true);
  assert.deepEqual(M.list('개인'), []);
  assert.equal(M.recall('개인', '인증번호', 'contest-apply', true), null);
});

test('pkm에 들어 있는 플러그인끼리는 나눠 쓰고, 다른 데서 받은 플러그인은 자기 값만', () => {
  M.remember('개인', '소속', '한빛대학교', 'contest-apply', true);
  M.remember('개인', '닉네임', 'hash', 'outside', false);
  assert.equal(M.recall('개인', '소 속', 'project-pilot', true).value, '한빛대학교', '내장끼리');
  assert.equal(M.recall('개인', '소속', 'outside', false), null, '바깥 플러그인은 내장 값을 못 꺼낸다');
  assert.equal(M.recall('개인', '닉네임', 'outside', false).value, 'hash', '자기 값은 꺼낸다');
  assert.equal(M.recall('개인', '닉네임', 'contest-apply', true), null, '바깥 플러그인이 받은 값은 내장도 안 쓴다');
  assert.equal(M.recall('회사', '소속', 'contest-apply', true), null, '다른 프로필');
  assert.equal(fs.statSync(path.join(process.env.PKM_HOME, 'memory.json')).mode & 0o777, 0o600);
});
