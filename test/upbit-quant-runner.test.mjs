// 업비트 퀀트를 실제 실행기(server/runner.js)로 — 처음 본 신호는 자동으로 시작하지 않고, 자동 시작을 켠 뒤 새로 들어온 신호만 주문 → 체결 확인까지 간다(모의 거래).
// 가짜 pkm-ai-server는 스크립트를 그 자리에서 실행하고, 가짜 업비트(시세만)의 주소·시각을 인자로 덧붙인다. 실제 업비트에는 닿지 않는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-upbit-run-'));
Object.assign(process.env, { PKM_HOME: path.join(T, 'home'), PKM_HOST_NAME: '집맥', PKM_RUNNER_TICK: '999999' });
const DATA = path.join(T, 'data'), P = '개인', ID = 'upbit-quant', H = 3600, T0 = Date.UTC(2026, 9, 1) / 1000;
fs.mkdirSync(path.join(DATA, P), { recursive: true });
fs.writeFileSync(path.join(DATA, P, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');

const M = { bars: [], ask: 90.1, bid: 89.9, private: 0 };
const flat = n => Array.from({ length: n }, (_, i) => ({ t: T0 + i * H, o: 100, h: 100.5, l: 99.5, c: 100 }));
const dip = n => { const b = flat(n); b[n - 1] = { ...b[n - 1], l: 89, c: 90 }; return b; };
const nowOf = () => new Date((M.bars[M.bars.length - 1].t + H + 120) * 1000).toISOString();
const upbit = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), send = b => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (u.pathname === '/v1/market/all') return send([{ market: 'KRW-BTC', korean_name: '비트코인' }]);
  if (u.pathname === '/v1/ticker') return send(u.searchParams.get('markets').split(',').map(m => ({ market: m, trade_price: 90 })));
  if (u.pathname === '/v1/orderbook') return send([{ orderbook_units: [{ ask_price: M.ask, bid_price: M.bid }] }]);
  if (u.pathname === '/v1/candles/minutes/60'){
    const to = u.searchParams.get('to') ? Date.parse(u.searchParams.get('to')) / 1000 : Infinity;
    return send(M.bars.filter(b => b.t < to).slice(-200).reverse().map(b => ({ candle_date_time_utc: new Date(b.t * 1000).toISOString().slice(0, 19), opening_price: b.o, high_price: b.h, low_price: b.l, trade_price: b.c, candle_acc_trade_volume: 1 })));
  }
  M.private++; res.writeHead(401); res.end('{}');   // 모의 거래는 계정이 필요한 곳을 부르지 않는다
});
const jobs = new Map(), calls = []; let n = 0;
const ai = http.createServer(async (req, res) => {
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/v1/plugins') return req.method === 'POST' ? send(201, { plugin: body }) : send(200, { plugins: [] });
  if (u.pathname === '/v1/secrets') return send(200, { secrets: [] });
  if (u.pathname === '/v1/jobs' && req.method === 'POST'){
    const id = `job${++n}`; calls.push(body.args);
    const extra = [`--api=http://127.0.0.1:${upbit.address().port}`, `--cache=${path.join(T, 'cache')}`, `--now=${nowOf()}`, '--poll=20'];
    const stdout = await new Promise(r => execFile(process.execPath, [path.join(body.plugin.root, body.plugin_script), ...body.args, ...extra], { encoding: 'utf8', env: { ...process.env, UPBIT_ACCESS_KEY: '', UPBIT_SECRET_KEY: '' } }, (e, out) => r(out)));
    const ok = !/^\{"error"/.test(stdout.trim());
    const job = { id, status: ok ? 'done' : 'error', result: { exit_code: ok ? 0 : 1, stdout, stderr: '' } }; jobs.set(id, job); return send(201, { job });
  }
  const m = u.pathname.match(/^\/v1\/jobs\/(\w+)$/);
  if (m) return send(200, { job: jobs.get(m[1]) });
  send(404, {});
});
let runner; const pushed = [];
before(async () => {
  await new Promise(r => ai.listen(0, '127.0.0.1', r));
  await new Promise(r => upbit.listen(0, '127.0.0.1', r));
  const plugins = await import('../server/plugins.js');
  const { createRunner } = await import('../server/runner.js');
  const ins = await plugins.inspect({ local: new URL('../plugins/upbit-quant/', import.meta.url).pathname });
  assert.equal(ins.ok, true, ins.errors.join());
  await plugins.install(path.join(DATA, P), ins.stage);
  runner = createRunner({ DATA, listProfiles: async () => [{ name: P }], onNotify: (p, m) => { pushed.push(m); } });
  await runner.setRunner(P, { on: true, ai: { url: `http://127.0.0.1:${ai.address().port}`, token: 'test-token-0123456789' } });
  await runner.setLocal(P, ID, { settings: { markets: 'KRW-BTC', strategies: 'disparity', wait_sec: '1' } });
});
after(() => { ai.close(); upbit.close(); fs.rmSync(T, { recursive: true, force: true }); });
const state = async () => (await runner.status(P)).plugins[ID].state;
const ledger = () => JSON.parse(fs.readFileSync(path.join(DATA, P, '_플러그인/.data/upbit-quant/ledger.json'), 'utf8'));
// 실행기를 켜면 뒤에서 첫 차례가 돌고 있을 수 있다 — 그 차례와 겹치면 tick이 건너뛰므로 조건이 될 때까지 돌린다
async function waitFor(fn, label){
  for (let i = 0; i < 100; i++){ await runner.tick(); const s = await state(); if (fn(s)) return s; await new Promise(r => setTimeout(r, 20)); }
  assert.fail(`${label}: ${JSON.stringify(Object.fromEntries(Object.entries((await state()).feeds).map(([k, f]) => [k, f.ok === false ? f.error : (f.items || []).length])))}`);
}
async function until(wf, fn, label){
  for (let i = 0; i < 60; i++){ await runner.tick(); const r = (await state()).runs.find(r => r.workflow === wf); if (r && fn(r)) return r; }
  const r = (await state()).runs.find(r => r.workflow === wf); assert.fail(`${label}: ${r && r.status} ${JSON.stringify(r && r.steps.map(s => [s.key, s.status, s.error]))}`);
}

test('처음 본 신호는 자동으로 사지 않고, 자동 시작을 켠 뒤 새로 들어온 신호만 주문 → 체결 확인까지 간다', async () => {
  M.bars = dip(60);
  let st = await waitFor(s => ['신호', '전략', '손익'].every(f => s.feeds[f] && s.feeds[f].at), '첫 목록');
  assert.deepEqual(st.feeds['신호'].items.map(i => i.title), ['비트코인 매수 신호']);
  assert.deepEqual(st.feeds['전략'].items.find(i => i.id === 'disparity').tags.slice(0, 1), ['켜짐']);
  assert.equal(st.feeds['손익'].items[0].title, '모의 거래 누적 손익 0원 (-)'.replace('(-)', '(0.00%)'));
  // 자동 시작이 꺼진 채 새 신호가 오면 사지 않고, 알림에 꺼져 있다고 적는다
  M.bars = [...flat(60), ...dip(30).map((b, i) => ({ ...b, t: T0 + (60 + i) * H }))];
  fs.rmSync(path.join(T, 'cache'), { recursive: true, force: true });
  await runner.act(P, ID, { type: 'refresh', feed: '신호' }); await runner.tick();
  st = await state();
  assert.equal(st.runs.length, 0); assert.equal(st.notes[0].text, '신호에 새로 올라왔어요 · 자동 시작이 꺼져 있어 시작하지 않았어요');
  assert.deepEqual(pushed.map(m => [m.title, m.text]), [['비트코인 매수 신호', '신호에 새로 올라왔어요 · 자동 시작이 꺼져 있어 시작하지 않았어요']], '신호가 뜨면 휴대폰으로도 알린다(notify: push)');
  pushed.length = 0;
  await runner.setLocal(P, ID, { auto: true });
  await runner.act(P, ID, { type: 'refresh', feed: '신호' }); await runner.tick();
  assert.equal((await state()).runs.length, 0, '켜기 전에 와 있던 신호는 자동 시작하지 않는다');
  // 값이 돌아왔다가 다시 떨어져 신호가 새로 난다
  const end = M.bars[M.bars.length - 1].t;
  M.bars = [...M.bars, ...Array.from({ length: 25 }, (_, i) => ({ t: end + (i + 1) * H, o: 100, h: 100.5, l: 99.5, c: 100 })), { t: end + 26 * H, o: 100, h: 100, l: 89, c: 90 }];
  fs.rmSync(path.join(T, 'cache'), { recursive: true, force: true });
  await new Promise(r => setTimeout(r, 5));
  await runner.act(P, ID, { type: 'refresh', feed: '신호' });
  const r = await until('자동 매매', r => ['done', 'stopped'].includes(r.status), '끝까지 간다');
  assert.equal(r.status, 'done', JSON.stringify(r.steps.map(s => [s.key, s.status, s.error])));
  assert.equal(r.by, 'auto');
  assert.match(r.steps[0].output.summary, /\(모의\) 비트코인 지정가 매수 주문/);
  assert.match(r.steps[1].output.verdict.title, /\(모의\) 비트코인 .*원어치를 샀어요/);
  assert.deepEqual(Object.keys(ledger().positions), ['paper|disparity|KRW-BTC']);
  assert.equal(M.private, 0, '모의 거래는 계정이 필요한 업비트 API를 부르지 않는다');
  // 체결되면 휴대폰 알림 한 번(사지 않은 것·신호만 뜬 것은 알리지 않는다)
  await runner.tick();
  assert.deepEqual(pushed.map(m => m.title), ['비트코인 매수 신호', '(모의) 비트코인 매수 체결'], '신호 한 번, 체결 한 번 — 끝남 알림은 체결 알림과 겹쳐 보내지 않는다');
  assert.deepEqual([pushed[1].plugin, pushed[1].name, pushed[1].run], [ID, '업비트 퀀트', r.id]);
  assert.match(pushed[1].text, /원어치 · 평균 90\.10원 · 모의 체결$/);
  // 볼 코인(여러 줄 설정)과 켜 둔 전략이 인자 하나로 넘어간다
  const order = calls.find(a => a[0] === 'order');
  assert.ok(order.includes('--markets=KRW-BTC') && order.includes('--strategies=disparity') && order.includes('--live=false') && order.includes('--order-krw=10000'));
  // 거래 뒤에는 목록을 바로 새로 가져온다(다음 주기를 기다리지 않는다)
  st = await waitFor(s => (s.feeds['거래 내역'].items || []).length && !s.feeds['신호'].items.length, '거래 뒤 목록');
  assert.match(st.feeds['거래 내역'].items[0].title, /^매수 BTC /);
  assert.match(st.feeds['들고 있는 것'].items[0].title, /^비트코인 /);
  assert.equal(st.feeds['신호'].items.length, 0);
});

test('전략 켜고 끄기 — 설정이 바뀌고 목록에 바로 보인다. 지금 팔기는 한 번 묻는다', async () => {
  await runner.act(P, ID, { type: 'start', feed: '전략', item: 'rsi2-extreme', workflow: '켜고 끄기' });
  const r = await until('켜고 끄기', r => ['done', 'stopped'].includes(r.status), '켜기');
  assert.equal(r.status, 'done', JSON.stringify(r.steps.map(s => [s.key, s.status, s.error])));
  await waitFor(s => s.feeds['전략'].items.find(i => i.id === 'rsi2-extreme').tags[0] === '켜짐', '켠 뒤 목록');
  const pl = (await runner.status(P)).plugins[ID];
  assert.equal(pl.local.settings.strategies, 'disparity, rsi2-extreme');
  assert.deepEqual(pl.state.feeds['전략'].items.find(i => i.id === 'rsi2-extreme').tags.slice(0, 1), ['켜짐']);
  const pos = pl.state.feeds['들고 있는 것'].items.find(i => i.vars.sid === 'disparity');
  await runner.act(P, ID, { type: 'start', feed: '들고 있는 것', item: pos.id, workflow: '지금 팔기' });
  const s = await until('지금 팔기', r => ['input', 'stopped', 'done'].includes(r.status), '묻는다');
  assert.equal(s.status, 'input'); assert.match(s.steps[0].ask.question, /지금 시장가로 팔까요/);
  await runner.act(P, ID, { type: 'answer', run: s.id, step: '팔기', value: 'sell' });
  const done = await until('지금 팔기', r => ['done', 'stopped'].includes(r.status), '판다');
  assert.equal(done.status, 'done', JSON.stringify(done.steps.map(x => [x.key, x.status, x.error])));
  assert.match(done.steps[0].output.verdict.title, /\(모의\) 비트코인을 팔았어요/);
  assert.equal(ledger().positions['paper|disparity|KRW-BTC'], undefined);   // 방금 켠 전략은 같은 봉의 신호로 따로 살 수 있다(자동 시작이 켜져 있다)
});

test('할 일이 없는 차례에는 상태 파일을 다시 쓰지 않는다(시각만 바뀐 파일로 동기화·화면 다시 그리기가 돌지 않게)', async () => {
  const f = path.join(DATA, P, '_플러그인/.state', `${ID}.json`);
  for (let i = 0; i < 3; i++) await runner.tick();   // 남은 일을 다 끝낸다
  const before = fs.readFileSync(f, 'utf8'), m = fs.statSync(f).mtimeMs;
  await new Promise(r => setTimeout(r, 15));
  await runner.tick(); await runner.tick();
  assert.equal(fs.readFileSync(f, 'utf8'), before); assert.equal(fs.statSync(f).mtimeMs, m);
});
