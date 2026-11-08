// AI 연결: 연결 코드 읽기와 내가 정한 한도로 쉬는지 판단.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AI = require('../web/js/pkm-ai.js').PKMAI;

const code = o => 'pkmai1.' + Buffer.from(JSON.stringify(o)).toString('base64url');

test('연결 코드에서 주소와 토큰을 읽는다', () => {
  const c = AI.parseCode(`  ${code({ v:1, urls:['http://127.0.0.1:5280/', 'https://내맥.ts.net'], token:'pkmai_abc' })}\n`);
  assert.deepEqual(c, { urls:['http://127.0.0.1:5280', 'https://내맥.ts.net'], token:'pkmai_abc' });
});

test('연결 코드가 아니거나 잘렸으면 이유를 말한다', () => {
  assert.throws(() => AI.parseCode(''), /붙여 넣어/);
  assert.throws(() => AI.parseCode('pkmai_abc'), /연결 코드가 아니에요/);
  assert.throws(() => AI.parseCode(code({ v:1, urls:['http://x'], token:'t' }).slice(0, 20)), /잘렸거나/);
  assert.throws(() => AI.parseCode(code({ v:2, urls:['http://x'], token:'t' })), /읽지 못했어요/);
});

const P = (o = {}) => ({ id:'claude', label:'Claude', via:'Claude Code', installed:true, logged_in:true, efforts:['low'], blocked:null, today:{ requests:3 },
  usage:{ windows:{ five_hour:{ used:0.5, resets_at:4e12 }, seven_day:{ used:30, resets_at:4e12 } } }, ...o });
const pref = o => ({ provider:'claude', model:'default', effort:null, pause_at:null, daily_max:null, ...o });

test('사용률은 0~1로 맞춘다', () => {
  assert.deepEqual(AI.windows(P()).map(w => w.used), [0.5, 0.3]);
  assert.deepEqual(AI.windows(P({ usage:null })), []);
});

test('쉬어야 하는 이유 — 서버 상태와 내가 정한 한도', () => {
  assert.equal(AI.guard(P(), pref()), null);
  assert.match(AI.guard(null, pref()), /골라/);
  assert.match(AI.guard(P({ installed:false }), pref()), /없어요/);
  assert.match(AI.guard(P({ logged_in:false }), pref()), /로그인돼 있지 않아요/);
  assert.match(AI.guard(P({ blocked:{ reason:'limit' } }), pref()), /한도에 걸려/);
  assert.match(AI.guard(P({ blocked:{ reason:'login' } }), pref()), /로그인이 풀려/);
  assert.match(AI.guard(P(), pref({ pause_at:0.5 })), /50%/);
  assert.equal(AI.guard(P(), pref({ pause_at:0.8 })), null);
  assert.equal(AI.guard(P(), pref({ pause_at:0.5 }), 5e12), null, '리셋 시각이 지난 사용률로는 쉬지 않는다');
  assert.match(AI.guard(P(), pref({ daily_max:3 })), /3회/);
  assert.equal(AI.guard(P({ today:null }), pref({ daily_max:3 })), null);
});

// 저장한 주소에 닿지 않거나(https 화면의 http 주소) 연결이 없으면 pkm 서버(/api/ai)를 거친다. 끊으면 그 길도 쓰지 않는다
async function fresh(fetchImpl, stored){
  const store = new Map(stored ? [['pkm:v1:ai', JSON.stringify(stored)]] : []);
  const g = { localStorage:{ getItem:k => store.has(k) ? store.get(k) : null, setItem:(k, v) => store.set(k, String(v)), removeItem:k => store.delete(k) }, fetch:fetchImpl };
  const src = (await import('node:fs')).readFileSync(new URL('../web/js/pkm-ai.js', import.meta.url), 'utf8');
  const self = {}; new Function('self', 'localStorage', 'fetch', src)(self, g.localStorage, g.fetch);
  return { AI:self.PKMAI, store };
}
const ok = b => ({ ok:true, status:200, json:async () => b });
test('저장한 주소가 안 닿으면 pkm 서버를 거쳐 다시 하고, 연결이 없어도 서버의 AI 연결을 쓴다', async () => {
  const calls = [];
  const f = async (u, o = {}) => { calls.push([u, (o.headers || {}).authorization || null]); if (u.startsWith('http://127.0.0.1')) throw new TypeError('Failed to fetch'); return ok({ providers:[{ id:'claude' }] }); };
  let { AI } = await fresh(f, { url:'http://127.0.0.1:5280', token:'t', urls:['http://127.0.0.1:5280'] });
  assert.deepEqual((await AI.providers()).map(p => p.id), ['claude']);
  assert.equal(AI.via(), 'server');
  assert.deepEqual(calls.at(-1), ['/api/ai/v1/providers', null], '토큰은 브라우저가 붙이지 않는다');
  ({ AI } = await fresh(f, null));
  assert.equal(AI.conn(), null);
  assert.equal(await AI.probe(), true);
  assert.equal(AI.via(), 'server');
  AI.setPrefs({ provider:'claude' });
  assert.equal(AI.prefs().provider, 'claude');
  AI.disconnect();
  assert.equal(AI.conn(), null);
});
test('서버에도 AI 연결이 없으면 원래 오류를 그대로 보인다', async () => {
  const f = async u => { if (u.startsWith('http')) throw new TypeError('x'); return { ok:false, status:409, json:async () => ({}) }; };
  const { AI } = await fresh(f, { url:'http://127.0.0.1:5280', token:'t' });
  await assert.rejects(AI.providers(), /AI 서버\(http:\/\/127\.0\.0\.1:5280\)에 닿지 않아요/);
  assert.equal(AI.via(), 'direct');
});
