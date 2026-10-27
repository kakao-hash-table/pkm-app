// AI 예약 작업 — 언제 돌지(cron 부분집합, 쉬는 날)와 설정에서 읽기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { due, jobsOf } from '../server/jobs.js';

test('정한 분에만 돈다 — 평일·시간 간격·마지막 ○요일', () => {
  assert.equal(due('0 9 * * 1-5', new Date(2026, 9, 27, 9, 0)), true);    // 화요일 9:00
  assert.equal(due('0 9 * * 1-5', new Date(2026, 9, 27, 9, 1)), false);
  assert.equal(due('0 9 * * 1-5', new Date(2026, 9, 25, 9, 0)), false);   // 일요일
  assert.equal(due('0 10-22/2 * * *', new Date(2026, 9, 27, 12, 0)), true);
  assert.equal(due('0 10-22/2 * * *', new Date(2026, 9, 27, 13, 0)), false);
  assert.equal(due('0 17 * * 4L', new Date(2026, 9, 29, 17, 0)), true);    // 10월 마지막 목요일
  assert.equal(due('0 17 * * 4L', new Date(2026, 9, 22, 17, 0)), false);
  assert.equal(due('0 9 1 * *', new Date(2026, 10, 1, 9, 0)), true);
});

test('쉬는 날에는 평일 일만 쉰다', () => {
  const off = [{ date:'2026-08-14', label:'휴가' }];
  assert.equal(due('0 9 * * 1-5', new Date(2026, 7, 14, 9, 0), off), false);
  assert.equal(due('0 9 * * *', new Date(2026, 7, 14, 9, 0), off), true);
});

test('설정에서 읽을 때 빠진 값을 채우고 모르는 모드는 대화로', () => {
  const j = jobsOf({ ai_jobs:[{ id:'a', prompt:'p', cron:'0 9 * * *', mode:'zzz' }, { id:'b' }, null] });
  assert.equal(j.length, 1);
  assert.deepEqual(j[0], { id:'a', name:'a', prompt:'p', cron:'0 9 * * *', mode:'chat', provider:'claude', on:true });
});
