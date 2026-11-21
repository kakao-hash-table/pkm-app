// 업비트 퀀트 플러그인(plugins/upbit-quant) — 이 컴퓨터에 띄운 가짜 업비트 서버로 신호 → 주문 → 체결 확인 → 장부까지 본다.
// 실제 업비트에는 닿지 않는다(스크립트는 --api로 127.0.0.1만 받는다). 가짜 서버는 JWT 서명과 query_hash도 문서 규칙대로 검사한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import * as plugins from '../server/plugins.js';
import * as E from '../plugins/upbit-quant/scripts/engine.mjs';
import { client, token, queryOf } from '../plugins/upbit-quant/scripts/upbit.mjs';
import { STRATEGIES } from '../plugins/upbit-quant/scripts/strategies.mjs';

const PLUGIN = new URL('../plugins/upbit-quant/', import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-upbit-'));
const KEY = 'access-key-1234', SECRET = 'secret-key-abcdefgh';
const H = 3600, T0 = Date.UTC(2026, 9, 1) / 1000;

/* ---------- 가짜 업비트 ---------- */
const M = { bars: [], ask: 90.1, bid: 89.9, krw: 1000000, coins: {}, orders: new Map(), posts: [], fill: 'full', auth: true };
const hash = s => crypto.createHash('sha512').update(s, 'utf8').digest('hex');
function checkJwt(req, query){
  const [h, p, s] = String(req.headers.authorization || '').replace(/^Bearer /, '').split('.');
  if (!h || crypto.createHmac('sha512', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return 'jwt_verification';
  const head = JSON.parse(Buffer.from(h, 'base64url')), pay = JSON.parse(Buffer.from(p, 'base64url'));
  if (head.alg !== 'HS512' || pay.access_key !== KEY || !pay.nonce) return 'invalid_access_key';
  if (query ? pay.query_hash !== hash(query) || pay.query_hash_alg !== 'SHA512' : pay.query_hash != null) return 'invalid_query_payload';
  return '';
}
const view = o => ({ uuid: o.uuid, identifier: o.identifier, market: o.market, side: o.side, ord_type: o.ord_type, state: o.state, price: o.price, volume: o.volume,
  executed_volume: String(o.trades.reduce((a, t) => a + Number(t.volume), 0)), paid_fee: String(o.trades.reduce((a, t) => a + Number(t.funds), 0) * 0.0005), trades: o.trades });
function fillOrder(o, share){
  const coin = o.market.replace('KRW-', '');
  if (o.side === 'bid'){
    const price = o.ord_type === 'price' ? M.ask : Number(o.price), volume = o.ord_type === 'price' ? Math.floor(Number(o.price) / price * 1e8) / 1e8 : Number(o.volume) * share;
    o.trades.push({ market: o.market, price: String(price), volume: String(volume), funds: String(price * volume), side: 'bid' });
    M.krw -= price * volume * 1.0005; M.coins[coin] = (M.coins[coin] || 0) + volume;
  } else {
    const price = o.ord_type === 'market' ? M.bid : Number(o.price), volume = Number(o.volume) * share;
    o.trades.push({ market: o.market, price: String(price), volume: String(volume), funds: String(price * volume), side: 'ask' });
    M.krw += price * volume * 0.9995; M.coins[coin] = (M.coins[coin] || 0) - volume;
  }
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), q = decodeURIComponent(u.search.slice(1)), send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const err = (code, name) => send(code, { error: { name, message: name } });
  let raw = ''; req.on('data', d => raw += d); req.on('end', () => {
    const p = u.pathname;
    if (p === '/v1/market/all') return send(200, [{ market: 'KRW-BTC', korean_name: '비트코인' }, { market: 'KRW-ETH', korean_name: '이더리움' }]);
    if (p === '/v1/ticker') return send(200, u.searchParams.get('markets').split(',').map(m => ({ market: m, trade_price: (M.ask + M.bid) / 2 })));
    if (p === '/v1/orderbook/instruments') return M.tick ? send(200, [{ market: u.searchParams.get('markets'), quote_currency: 'KRW', tick_size: String(M.tick) }]) : err(404, '404');
    if (p === '/v1/orderbook') return send(200, [{ market: u.searchParams.get('markets'), orderbook_units: [{ ask_price: M.ask, bid_price: M.bid, ask_size: 1, bid_size: 1 }] }]);
    if (p === '/v1/candles/minutes/60'){
      const to = u.searchParams.get('to') ? Date.parse(u.searchParams.get('to')) / 1000 : Infinity;
      return send(200, M.bars.filter(b => b.t < to).slice(-Number(u.searchParams.get('count'))).reverse().map(b => ({ candle_date_time_utc: new Date(b.t * 1000).toISOString().slice(0, 19), opening_price: b.o, high_price: b.h, low_price: b.l, trade_price: b.c, candle_acc_trade_volume: 10 })));
    }
    const body = raw ? JSON.parse(raw) : null, bad = M.auth ? checkJwt(req, body ? queryOf(body) : q) : 'no_authorization_ip';
    if (bad) return err(401, bad);
    if (p === '/v1/accounts') return send(200, [{ currency: 'KRW', balance: String(M.krw), locked: '0', avg_buy_price: '0' }, ...Object.entries(M.coins).map(([c, v]) => ({ currency: c, balance: String(v), locked: '0', avg_buy_price: '90' }))]);
    if (p === '/v1/orders/chance') return send(200, { bid_fee: '0.0005', ask_fee: '0.0005', market: { bid: { min_total: '5000' }, ask: { min_total: '5000' } } });
    if (p === '/v1/orders/test') return send(201, { uuid: 'test', state: 'wait' });
    if (p === '/v1/orders' && req.method === 'POST'){
      M.posts.push(body);
      if ([...M.orders.values()].some(o => o.identifier === body.identifier)) return err(400, 'duplicated_identifier');
      const o = { ...body, uuid: `u${M.orders.size + 1}`, state: 'wait', trades: [] };
      M.orders.set(o.uuid, o);
      if (['price', 'market'].includes(o.ord_type)){ fillOrder(o, 1); o.state = o.ord_type === 'price' ? 'cancel' : 'done'; }   // 시장가 매수는 잔돈이 남아 cancel로 끝난다
      else if (M.fill === 'full'){ fillOrder(o, 1); o.state = 'done'; }
      else if (M.fill === 'partial') fillOrder(o, 0.4);
      return send(201, view(o));
    }
    if (p === '/v1/order'){
      const o = M.orders.get(u.searchParams.get('uuid')) || [...M.orders.values()].find(x => x.identifier === u.searchParams.get('identifier'));
      if (!o) return err(404, 'order_not_found');
      if (req.method === 'DELETE'){ if (o.state !== 'wait') return err(400, 'done_order'); o.state = 'cancel'; }
      return send(200, view(o));
    }
    err(404, '404');
  });
});
let api;
before(async () => { await new Promise(r => server.listen(0, '127.0.0.1', r)); api = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

/* 100원에서 옆으로 가다가 마지막 봉에서 90원으로 — 이격도(20) 95 아래로 돌파(매수 신호). recover면 한 봉 더: 101원(이격도 100 위로 — 매도 신호) */
const flat = (n = 60) => Array.from({ length: n }, (_, i) => ({ t: T0 + i * H, o: 100, h: 100.5, l: 99.5, c: 100 }));
const dip = () => { const b = flat(); b[b.length - 1] = { ...b[b.length - 1], l: 89, c: 90 }; return b; };
const recover = () => { const b = dip(); return [...b, { t: b[b.length - 1].t + H, o: 90, h: 102, l: 90, c: 101 }]; };
const nowAt = (bars, min = 2) => new Date((bars[bars.length - 1].t + H + min * 60) * 1000).toISOString();
let n = 0;
function world({ keys = true } = {}){
  const dir = path.join(tmp, `w${++n}`), profile = path.join(dir, '개인');
  fs.mkdirSync(profile, { recursive: true }); fs.writeFileSync(path.join(profile, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');
  Object.assign(M, { bars: dip(), ask: 90.1, bid: 89.9, tick: 0, krw: 1000000, coins: {}, orders: new Map(), posts: [], fill: 'full', auth: true });
  const base = { profile, cache: path.join(dir, 'cache'), api, poll: 20, wait: 1, markets: 'KRW-BTC', strategies: 'disparity', 'order-krw': 10000, 'max-positions': 5, slippage: 0.3 };
  const run = (cmd, a = {}) => new Promise(resolve => execFile(process.execPath, [path.join(PLUGIN, 'scripts/quant.mjs'), cmd, ...Object.entries({ ...base, now: nowAt(M.bars), ...a }).map(([k, v]) => `--${k}=${v}`)],
    { encoding: 'utf8', env: { ...process.env, UPBIT_ACCESS_KEY: keys ? KEY : '', UPBIT_SECRET_KEY: keys ? SECRET : '' } }, (e, stdout) => resolve(JSON.parse(stdout.trim().split('\n').pop()))));
  const ledger = () => JSON.parse(fs.readFileSync(path.join(profile, '_플러그인/.data/upbit-quant/ledger.json'), 'utf8'));
  return { run, ledger };
}
const vars = it => it.vars;

test('규격 검사를 통과하고, 등록부의 전략은 모두 엔진이 읽는다', async () => {
  const r = await plugins.inspect({ local: PLUGIN });
  assert.equal(r.ok, true, (r.errors || []).join('\n'));
  assert.deepEqual(r.feeds.map(f => [f.name, f.tab || '']), [['신호', ''], ['감시 중', ''], ['손익', '상태'], ['들고 있는 것', '상태'], ['연결', '상태'], ['거래 내역', '거래 내역'], ['전략', '전략']]);
  assert.deepEqual(r.manifest.permissions.secrets, ['UPBIT_ACCESS_KEY', 'UPBIT_SECRET_KEY']);
  assert.ok(STRATEGIES.length >= 2);
  for (const s of STRATEGIES){ assert.ok(E.checkEntry(s), s.id); assert.ok(['pass', 'partial', 'added'].includes(s.verdict)); assert.doesNotMatch(s.id, /[,\s]/, '설정에 쉼표로 나눠 적으니 id에 쉼표·공백이 없다'); }
  const kd = STRATEGIES.find(s => s.id === 'or:keltner-breakout_period20_mult2.5+disparity');   // 직접 더한 전략 — 켈트너 배수 2.5가 상단·중심선 둘 다에 들어갔다
  assert.equal(kd.name, '켈트너 상단 돌파 / 중심선 이탈 [period=20, mult=2.5] ∨ 이격도 95 매수 / 100 매도'); assert.deepEqual([kd.interval, kd.mode, kd.verdict], ['1h', 'or', 'added']);
  assert.deepEqual([kd.members[0].strategy.buy[0].right, kd.members[0].strategy.sell[0].right], [{ type: 'keltner', period: 20, mult: 2.5, output: 'upper' }, { type: 'keltner', period: 20, mult: 2.5, output: 'middle' }]);
  assert.ok(STRATEGIES.some(s => s.id === r.manifest.settings.find(x => x.key === 'strategies').default), '기본으로 켜 둔 전략이 등록부에 있다');
  assert.equal(r.manifest.settings.find(x => x.key === 'live').default, false, '처음에는 모의 거래');
});

test('엔진 — 닫힌 봉으로 지금 들고 있어야 하는지, 방금 바뀌었는지', () => {
  const c = (left, op, right) => ({ left, op, right }), price = { type: 'price' };
  const bars = cs => cs.map((v, i) => ({ t: i * H, o: i ? cs[i - 1] : v, h: Math.max(v, i ? cs[i - 1] : v), l: Math.min(v, i ? cs[i - 1] : v), c: v, v: 1 }));
  const up = { id: 'x1', interval: '1h', strategy: { buy: [c(price, 'crossAbove', 100)], sell: [c(price, 'crossBelow', 95)] } };
  assert.deepEqual(E.replay(bars([90, 99, 101, 102, 94, 96, 101]), up.strategy).hold.join(''), '0011001');
  let d = E.desired(bars([90, 99, 101]), up);
  assert.deepEqual([d.hold, d.fresh, d.since, d.price], [true, true, 2 * H, 101]);
  d = E.desired(bars([90, 99, 101, 102]), up); assert.deepEqual([d.hold, d.fresh, d.since], [true, false, 2 * H], '한 봉 지난 신호는 방금이 아니다');
  d = E.desired(bars([90, 99, 101, 94]), up); assert.deepEqual([d.hold, d.fresh], [false, true]);
  assert.match(d.reason, /아래로 돌파 95/);
  d = E.desired(bars([101, 102, 103]), up); assert.deepEqual([d.hold, d.fresh, d.since], [false, false, null], '창 안에서 바뀐 적이 없으면 신호가 아니다');
  // 손절 — 봉 안 저가가 닿으면 나온다. 최대 보유 봉 수
  const stop = { buy: [c(price, 'crossAbove', 100)], sell: [c(price, 'crossBelow', 50)], stopLossPct: 5 };
  assert.equal(E.replay(bars([90, 101, 101, 95, 96]), stop).hold.join(''), '01100');
  assert.equal(E.replay(bars([90, 101, 101, 101, 101, 101]), { buy: [c(price, 'crossAbove', 100)], maxBars: 2 }).hold.join(''), '011000');
  // 혼합 — and는 모두, or는 하나라도
  const a = { strategy: { buy: [c(price, '>', 100)], sell: [c(price, '<', 100)] } }, b = { strategy: { buy: [c(price, '>', 110)], sell: [c(price, '<', 110)] } };
  const cs = bars([90, 105, 115, 105, 90]);
  assert.equal(E.holdOf(cs, { mode: 'and', members: [a, b] }).hold.join(''), '00100');
  assert.equal(E.holdOf(cs, { mode: 'or', members: [a, b] }).hold.join(''), '01110');
  assert.throws(() => E.checkEntry({ id: 'bad', interval: '1h', strategy: { buy: [c({ type: 'nope' }, '>', 1)], sell: [c(price, '<', 1)] } }), /알 수 없는 지표/);
  assert.throws(() => E.checkEntry({ id: 'm5', interval: '5m', strategy: up.strategy }), /봉 단위/);
  // 돈 계산
  assert.deepEqual(E.fillOf([{ price: 100, volume: 1, funds: 100 }, { price: 110, volume: 1 }]), { volume: 2, funds: 210, price: 105 });
  const st = E.statsOf([{ side: 'bid', fee: 5 }, { side: 'ask', pnl: 100, ret_pct: 1, fee: 5, how: 'limit+market' }, { side: 'ask', pnl: -40, ret_pct: -0.4, fee: 5, how: 'limit' }]);
  assert.deepEqual([st.closed, st.wins, st.win_rate, st.realized, st.fees, st.fallbacks], [2, 1, 50, 60, 15, 1]);
  const pts = Array.from({ length: 500 }, (_, i) => ({ t: new Date(Date.UTC(2026, 0, 1) + i * 600000).toISOString(), pnl: i }));
  const th = E.thin(pts, 120); assert.ok(th.length <= 120); assert.equal(th[th.length - 1].pnl, 499);
});

test('업비트 클라이언트 — JWT(HS512)·query_hash, 업비트가 아닌 주소로는 보내지 않는다', async () => {
  const q = queryOf({ market: 'KRW-BTC', side: 'bid', volume: null, price: '5000' });
  assert.equal(q, 'market=KRW-BTC&side=bid&price=5000');
  const [h, p, s] = token(KEY, SECRET, q).split('.'), pay = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).alg, 'HS512');
  assert.equal(pay.query_hash, hash(q)); assert.equal(pay.query_hash_alg, 'SHA512'); assert.equal(pay.access_key, KEY);
  assert.equal(s, crypto.createHmac('sha512', SECRET).update(`${h}.${p}`).digest('base64url'));
  assert.equal(JSON.parse(Buffer.from(token(KEY, SECRET).split('.')[1], 'base64url')).query_hash, undefined);
  assert.throws(() => client({ base: 'https://example.com' }), /업비트가 아닌 주소/);
  assert.throws(() => client({ base: 'http://127.0.0.1:80/x' }), /업비트가 아닌 주소/);
  await assert.rejects(client({ base: api }).accounts(), /계정 정보/);
  Object.assign(M, { krw: 5, coins: {}, auth: true });
  assert.equal((await client({ access: KEY, secret: SECRET, base: api }).accounts())[0].balance, '5');
  await assert.rejects(client({ access: KEY, secret: 'wrong-secret', base: api }).accounts(), /Secret key가 맞지 않아요/);
});

test('모의 거래 — 신호 → 사기 → 들고 있는 것 → 매도 신호 → 팔기. 키 없이 돌고 업비트에 주문하지 않는다', async () => {
  const w = world({ keys: false });
  const sig = await w.run('signals');
  assert.equal(sig.items.length, 1);
  assert.equal(sig.items[0].title, '비트코인 매수 신호'); assert.deepEqual(sig.items[0].tags, ['모의']);
  assert.match(sig.items[0].detail[0].text, /이격도\(20\) 아래로 돌파 95/); assert.match(sig.note, /전략 1개 × 코인 1개 · 모의 거래/);
  const o = await w.run('order', vars(sig.items[0]));
  assert.match(o.summary, /\(모의\) 비트코인 지정가 매수 주문/); assert.ok(o.pid);
  const s = await w.run('settle', { pid: o.pid });
  assert.match(s.verdict.title, /\(모의\) 비트코인 .*원어치를 샀어요/); assert.match(s.verdict.text, /모의 체결/); assert.deepEqual(s.settings_patch, {});
  assert.equal(M.posts.length, 0, '업비트에 주문하지 않았다');
  assert.deepEqual((await w.run('settle', { pid: o.pid })).verdict.title, s.verdict.title, '같은 단계를 다시 해도 한 번만 산다');
  let db = w.ledger();
  assert.deepEqual(Object.keys(db.positions), ['paper|disparity|KRW-BTC']); assert.equal(db.trades.length, 1); assert.deepEqual(db.pending, {});
  assert.equal((await w.run('signals')).items.length, 0, '들고 있으면 같은 신호로 또 사지 않는다');
  const pos = await w.run('positions');
  assert.match(pos.items[0].title, /^비트코인 [+-]/); assert.deepEqual(pos.items[0].vars, { mode: 'paper', sid: 'disparity', market: 'KRW-BTC' });
  // 값이 돌아왔다 — 이격도 100 위로
  M.bars = recover(); M.ask = 101.1; M.bid = 100.9;
  const sig2 = await w.run('signals');
  assert.equal(sig2.items[0].title, '비트코인 매도 신호'); assert.equal(sig2.items[0].vars.side, 'ask');
  const s2 = await w.run('settle', { pid: (await w.run('order', vars(sig2.items[0]))).pid });
  assert.match(s2.verdict.title, /\(모의\) 비트코인을 팔았어요 · \+1,[0-9]{3}원 \(\+1[0-9]\.[0-9]+%\)/);
  db = w.ledger();
  assert.deepEqual(db.positions, {}); assert.equal(db.trades.length, 2); assert.ok(db.trades[1].pnl > 1000);
  // 상태 — 손익 한 줄(그래프는 점이 둘 이상일 때), 거래 내역, 전략
  const st1 = await w.run('status'), st2 = await w.run('status', { now: nowAt(M.bars, 20) });
  assert.match(st1.items[0].title, /^모의 거래 누적 손익 \+1,[0-9]{3}원 \(\+2\.[0-9]+%\)$/, '운용 한도 5만 원 대비');
  assert.equal(st1.items[0].chart, undefined); assert.equal(st2.items[0].chart.points.length, 2); assert.deepEqual(Object.keys(st2.items[0].chart.points[0]), ['t', 'v']); assert.equal(st2.items[0].chart.unit, '원');
  assert.match(st2.items.find(i => i.id === 'account').title, /계정 정보가 아직 없어요/);
  const tr = await w.run('trades');
  assert.equal(tr.items.length, 1, '사고판 것은 카드 한 장');
  assert.match(tr.note, /^모의 거래 끝난 것 1번 · 이익 1 · 손해 0 · 합계 \+1,[0-9]{3}원$/);
  const card = tr.items[0];
  assert.match(card.title, /^비트코인 \+1,[0-9]{3}원 \(\+1[0-9]\.[0-9]+%\)$/); assert.equal(card.tone, 'up'); assert.deepEqual(card.tags, ['모의', '끝', '이익']);
  assert.match(card.meta[0], /^매수 \d+\/\d+ \d\d:\d\d · 평단 90\.1원$/); assert.match(card.meta[1], /^매도 \d+\/\d+ \d\d:\d\d · 100\.9원$/); assert.match(card.meta[2], /^10,005원 · /);
  assert.deepEqual(card.detail.map(d => d.kind), ['사고판 것', '요약']); assert.match(card.detail[0].text, /^삼 .*\n팖 .* · \+1,[0-9]{3}원$/);
  const sg = await w.run('strategies');
  assert.equal(sg.items.length, STRATEGIES.length); assert.deepEqual(sg.items.find(i => i.id === 'disparity').tags.slice(0, 1), ['켜짐']);
  assert.match(sg.items[0].detail[1].text, /앞으로의 수익을 보장하지 않아요/);
});

test('실제 거래 — 지정가가 바로 체결되면 그대로 끝난다(주문 본문·서명 확인)', async () => {
  const w = world();
  const sig = await w.run('signals', { live: true });
  assert.deepEqual(sig.items[0].tags, ['실제']);
  const o = await w.run('order', { ...vars(sig.items[0]), live: true });
  assert.deepEqual(M.posts, [{ market: 'KRW-BTC', side: 'bid', ord_type: 'limit', price: '90.1', volume: '110.98779134', identifier: o.pid }]);
  const s = await w.run('settle', { pid: o.pid, live: true });
  assert.match(s.verdict.title, /^비트코인 10,000원어치를 샀어요$/);
  assert.deepEqual(s.notify, { title: '비트코인 매수 체결', text: '10,000원어치 · 평균 90.10원 · 지정가로 체결' }); assert.match(s.verdict.text, /지정가로 체결 · 수수료 5원 · 신호가 대비 \+0\.11%/);
  assert.deepEqual(s.findings.map(f => f.where), ['주문 u1']);
  const db = w.ledger(), pos = db.positions['live|disparity|KRW-BTC'];
  assert.equal(db.trades[0].how, 'limit'); assert.ok(Math.abs(pos.cost - 10005) < 1); assert.equal(pos.volume, 110.98779134);
});

test('실제 거래 — 지정가가 체결되지 않으면 취소하고 시장가로 마저 산다. 일부만 체결돼도 나머지를 채운다', async () => {
  let w = world(); M.fill = 'none';
  let sig = await w.run('signals', { live: true });
  let o = await w.run('order', { ...vars(sig.items[0]), live: true });
  let s = await w.run('settle', { pid: o.pid, live: true });
  assert.match(s.verdict.text, /시장가로 체결/);
  assert.equal(M.orders.get('u1').state, 'cancel'); assert.deepEqual(M.posts[1], { market: 'KRW-BTC', side: 'bid', ord_type: 'price', price: '10000', identifier: `${o.pid}m` });
  assert.deepEqual(w.ledger().trades[0].uuids, ['u1', 'u2']); assert.equal(w.ledger().trades[0].how, 'market');
  const open = (await w.run('trades', { live: true })).items[0];
  assert.deepEqual(open.tags, ['실제', '진행 중', '손해', '시장가 전환'], '아직 들고 있으면 진행 중 카드'); assert.equal(open.tone, 'down'); assert.match(open.meta[1], /^지금 90\.00원 · 들고 있어요$/);
  assert.equal(open.detail[1].text, '매도 조건이 오면 저절로 팔아요');

  w = world(); M.fill = 'partial';
  sig = await w.run('signals', { live: true });
  o = await w.run('order', { ...vars(sig.items[0]), live: true });
  s = await w.run('settle', { pid: o.pid, live: true });
  assert.match(s.verdict.text, /지정가 일부 \+ 나머지 시장가/);
  assert.equal(M.posts[1].price, '6000', '체결된 4,000원을 뺀 나머지');
  const t = w.ledger().trades[0];
  assert.equal(t.how, 'limit+market'); assert.ok(Math.abs(t.funds - 10000) < 1);
});

test('슬리피지 — 값이 신호가보다 허용치 넘게 올랐으면 사지 않고 이유를 남긴다. 지정가가 안 된 뒤 값이 올랐으면 시장가로 쫓아가지 않는다', async () => {
  let w = world(); M.ask = 91;
  const sig = await w.run('signals', { live: true });
  let o = await w.run('order', { ...vars(sig.items[0]), live: true });
  assert.equal(o.pid, ''); assert.equal(o.verdict.title, '사지 않았어요'); assert.match(o.verdict.text, /\+1\.11% 올라 사지 않았어요\(허용 0\.3%\)/);
  assert.equal(o.notify, undefined, '사지 않은 것은 알리지 않는다');
  assert.equal(M.posts.length, 0);
  assert.equal((await w.run('signals', { live: true })).items.length, 0, '같은 봉의 신호를 다시 올리지 않는다');
  const tr = await w.run('trades', { live: true });
  assert.equal(tr.items[0].title, '사지 않음 BTC'); assert.deepEqual(tr.items[0].tags, ['실제', '건너뜀']);

  w = world(); M.fill = 'none';
  const sig2 = await w.run('signals', { live: true });
  o = await w.run('order', { ...vars(sig2.items[0]), live: true });
  M.ask = 91;   // 기다리는 동안 값이 올랐다
  const s = await w.run('settle', { pid: o.pid, live: true });
  assert.equal(s.verdict.title, '사지 않았어요'); assert.match(s.verdict.text, /나머지는 사지 않았어요/);
  assert.equal(M.posts.length, 1); assert.equal(M.orders.get('u1').state, 'cancel'); assert.deepEqual(w.ledger().positions, {}); assert.deepEqual(w.ledger().pending, {});
});

test('슬리피지 — 호가 한 칸까지는 허용치를 넘어도 산다(값이 싼 코인은 한 칸이 허용치보다 크다). 두 칸이면 사지 않는다', async () => {
  assert.equal(E.overCap(91, 90, 0.3, 1), false); assert.equal(E.overCap(92, 90, 0.3, 1), true);
  assert.equal(E.overCap(90.27, 90, 0.3, 0), false); assert.equal(E.overCap(90.28, 90, 0.3, 0), true);
  assert.equal(E.overCap(1.235, 1.234, 0, 0.001), false, '소수 호가 단위도 한 칸은 넘지 않은 것으로 본다');
  assert.equal(E.overCap(100500, 100000, 0.5, 50), false); assert.equal(E.overCap(100600, 100000, 0.5, 50), true, '한 칸이 허용치보다 작으면 허용치를 쓴다');

  let w = world(); M.tick = 1; M.ask = 91;   // 신호가 90원, 허용 0.3%(90.27원)보다 한 칸(91원)이 크다
  let sig = await w.run('signals', { live: true });
  let o = await w.run('order', { ...vars(sig.items[0]), live: true });
  assert.ok(o.pid); assert.equal(M.posts[0].price, '91');

  w = world(); M.tick = 1; M.ask = 92;
  sig = await w.run('signals', { live: true });
  o = await w.run('order', { ...vars(sig.items[0]), live: true });
  assert.equal(o.pid, ''); assert.match(o.verdict.text, /\+2\.22% 올라 사지 않았어요\(허용 0\.3% 또는 호가 한 칸 1원\)/);
  assert.equal(M.posts.length, 0);
});

test('사지 않는 경우 — 늦은 신호, 원화 부족, 포지션 한도, 꺼진 전략', async () => {
  let w = world();
  assert.equal((await w.run('signals', { now: nowAt(M.bars, 20) })).items.length, 0, '봉이 닫히고 15분이 지나면 늦은 신호');
  const sig = await w.run('signals', { live: true }), v = vars(sig.items[0]);
  assert.match((await w.run('order', { ...v, live: true, now: nowAt(M.bars, 20) })).verdict.text, /20분이 지나 사지 않았어요/);
  w = world(); M.krw = 3000;
  assert.match((await w.run('order', { ...v, live: true })).verdict.text, /원화가 모자라요\(주문 가능 3,000원/);
  w = world();
  await w.run('settle', { pid: (await w.run('order', { ...v, live: true })).pid, live: true });   // 하나를 들고 있다
  assert.match((await w.run('order', { ...v, market: 'KRW-ETH', live: true, markets: 'KRW-BTC,KRW-ETH', 'max-positions': 1 })).verdict.text, /동시에 가질 수 있는 수\(1개\)를 채웠어요/);
  M.posts.length = 0;
  assert.match((await w.run('order', { ...v, live: true, strategies: 'rsi2-extreme' })).verdict.text, /전략이 꺼져 있어요/);
  const eth = { ...v, market: 'KRW-ETH', markets: 'KRW-BTC,KRW-ETH', live: true };
  assert.match((await w.run('order', { ...v, live: true })).verdict.text, /이미 들고 있어요/);
  assert.deepEqual((await w.run('order', { ...eth, 'order-krw': 3000 })).notify.title, 'ETH 매수 주문이 멈췄어요');
  assert.match((await w.run('order', { ...eth, 'order-krw': 3000 })).error, /최소 주문 금액\(5,000원\)보다 적어요/);
  assert.match((await w.run('order', { ...eth, bar: Number(v.bar) - H })).verdict.text, /신호가 지나갔어요/);
  assert.equal(M.posts.length, 0);
});

test('팔기 — 지정가가 안 되면 시장가로 판다. 전략을 꺼도 들고 있는 것은 판다. 직접 판 코인은 장부에서만 정리한다', async () => {
  const w = world();
  const sig = await w.run('signals', { live: true });
  await w.run('settle', { pid: (await w.run('order', { ...vars(sig.items[0]), live: true })).pid, live: true });
  M.bars = recover(); M.ask = 101.1; M.bid = 100.9; M.fill = 'none';
  const sig2 = await w.run('signals', { live: false, strategies: '' });   // 전략을 끄고 모의로 바꿔도
  assert.equal(sig2.items.length, 1); assert.deepEqual([sig2.items[0].vars.side, sig2.items[0].vars.mode], ['ask', 'live']);
  const o = await w.run('order', { ...vars(sig2.items[0]), strategies: '' });
  assert.deepEqual(M.posts[1], { market: 'KRW-BTC', side: 'ask', ord_type: 'limit', price: '100.9', volume: '110.98779134', identifier: o.pid });
  const s = await w.run('settle', { pid: o.pid });
  assert.match(s.verdict.title, /^비트코인을 팔았어요 · \+1,1[0-9]{2}원/); assert.match(s.verdict.text, /시장가로 체결/);
  assert.equal(s.notify.title, '비트코인 매도 체결'); assert.match(s.notify.text, /^\+1,1[0-9]{2}원 \(\+1[0-9]\.[0-9]+%\) · 평균 101원 · 시장가로 체결$/);   // 100.9원 → 100원 이상은 원 단위로 보인다
  assert.deepEqual(M.posts[2], { market: 'KRW-BTC', side: 'ask', ord_type: 'market', volume: '110.98779134', identifier: `${o.pid}m` });
  assert.deepEqual(w.ledger().positions, {});

  const w2 = world();
  const sg = await w2.run('signals', { live: true });
  await w2.run('settle', { pid: (await w2.run('order', { ...vars(sg.items[0]), live: true })).pid, live: true });
  M.coins.BTC = 0; M.bars = recover();   // 업비트 앱에서 직접 팔았다
  const sg2 = await w2.run('signals', { live: true });
  const o2 = await w2.run('order', { ...vars(sg2.items[0]), live: true });
  assert.equal(o2.verdict.title, '장부에서 정리했어요'); assert.equal(o2.pid, ''); assert.deepEqual(w2.ledger().positions, {}); assert.equal(M.posts.length, 1);
});

test('끊긴 주문 — 체결 확인 없이 남은 주문은 다음 확인 때 찾아서 정리한다(취소하고, 체결된 만큼만 장부에)', async () => {
  const w = world(); M.fill = 'partial';
  const sig = await w.run('signals', { live: true });
  const o = await w.run('order', { ...vars(sig.items[0]), live: true });
  assert.equal(Object.keys(w.ledger().pending).length, 1);
  assert.equal((await w.run('signals', { live: true })).items.length, 0, '방금 넣은 주문은 건드리지 않고, 같은 자리를 또 올리지도 않는다');
  assert.equal(M.orders.get('u1').state, 'wait');
  const lateSig = await w.run('signals', { live: true, now: nowAt(M.bars, 10) });
  assert.equal(lateSig.notify.title, '비트코인 매수 체결'); assert.match(lateSig.notify.text, /^4,000원어치/);
  assert.equal(M.orders.get('u1').state, 'cancel'); assert.equal(M.posts.length, 1, '늦게 찾은 매수는 시장가로 쫓아가지 않는다');
  const db = w.ledger();
  assert.deepEqual(db.pending, {}); assert.ok(Math.abs(db.trades[0].funds - 4000) < 1); assert.match(db.trades[0].notes.join(), /늦게 확인한 주문/);
  assert.ok(Math.abs(db.positions['live|disparity|KRW-BTC'].volume - 110.98779134 * 0.4) < 1e-6);
  assert.match((await w.run('settle', { pid: o.pid, live: true })).verdict.title, /4,000원어치를 샀어요/, '뒤늦게 체결 단계를 다시 해도 같은 결과');
});

test('지금 팔기 — 한 번 묻고 시장가로. 전략 켜고 끄기. 연결 확인은 실제 주문을 넣지 않는다', async () => {
  const w = world();
  const sig = await w.run('signals', { live: true });
  await w.run('settle', { pid: (await w.run('order', { ...vars(sig.items[0]), live: true })).pid, live: true });
  const pv = (await w.run('positions')).items[0].vars;
  const q = await w.run('sell-now', pv);
  assert.match(q.ask.question, /비트코인을 지금 시장가로 팔까요\? 지금 팔면 약 -/); assert.equal(q.ask.inline, true);
  assert.match(q.ask.choices[0].confirm, /실제로 시장가에 팔아요. 되돌릴 수 없어요/);
  assert.equal((await w.run('sell-now', { ...pv, answer: 'keep' })).verdict.title, '그대로 뒀어요'); assert.equal(M.posts.length, 1);
  const sold = await w.run('sell-now', { ...pv, answer: 'sell' });
  assert.match(sold.verdict.title, /^비트코인을 팔았어요 · -/); assert.equal(M.posts[1].ord_type, 'market');
  assert.deepEqual(w.ledger().positions, {}); assert.equal(w.ledger().trades[1].manual, true);
  assert.equal((await w.run('sell-now', { ...pv, answer: 'sell' })).verdict.title, '팔 것이 없어요');

  const on = await w.run('toggle', { sid: 'rsi2-extreme' });
  assert.deepEqual(on.settings_patch, { strategies: 'disparity, rsi2-extreme' }); assert.match(on.verdict.title, /켰어요$/);
  const off = await w.run('toggle', { sid: 'disparity' });
  assert.deepEqual(off.settings_patch, { strategies: '' }); assert.match(off.verdict.title, /껐어요$/);
  assert.match((await w.run('toggle', { sid: 'nope' })).error, /등록부에 없는 전략/);

  const before = M.posts.length, ok = await w.run('doctor', { live: true });
  assert.equal(ok.verdict.title, '연결됐어요 — 실제 주문을 넣을 수 있어요'); assert.deepEqual(ok.findings.map(f => f.where), ['시세', '자산조회', '주문조회', '주문하기']);
  assert.equal(M.posts.length, before, '실제 주문 없음');
  M.auth = false;
  const bad = await w.run('doctor');
  assert.equal(bad.verdict.tone, 'bad'); assert.match(bad.findings[1].text, /허용 IP에 없어요/);
  assert.match((await world({ keys: false }).run('doctor')).findings[1].title, /Access key와 Secret key가 없어요/);
  assert.match((await w.run('order', { side: 'bid', sid: 'disparity', market: 'KRW-BTC', bar: 1, api: 'https://example.com' })).error, /업비트가 아닌 주소/);
});

test('더 사기 — 굴릴 금액을 늘리면 모자란 만큼 더 사서 같은 포지션에 합치고(평균 단가), 팔 때 한꺼번에 판다', async () => {
  assert.deepEqual([E.avgText(320.95015576), E.avgText(325), E.avgText(123456789.4), E.avgText(0.012345)], ['320.95', '325', '123,456,789', '0.01235']);
  assert.deepEqual([E.qtyText(6228.3814608), E.qtyText(0.00012345)], ['6,228.38', '0.00012345']);
  // 거래 묶기 — 사고, 더 사고, 판 수량이 산 수량에 닿으면 닫는다. 다른 자리는 따로, 다시 사면 새 묶음
  const T = (side, v, k = 'A', extra = {}) => ({ side, volume: v, mode: 'live', sid: 's', market: `KRW-${k}`, ...extra });
  const trips = E.tripsOf([T('bid', 10), T('bid', 5, 'A', { add: true }), T('bid', 3, 'B'), T('ask', 15), T('bid', 7), T('ask', 1, 'C')]);
  assert.deepEqual(trips.map(t => [t.market, t.buys.length, t.sells.length, t.closed]), [['KRW-A', 2, 1, true], ['KRW-B', 1, 0, false], ['KRW-A', 1, 0, false], ['KRW-C', 0, 1, true]]);
  assert.deepEqual([E.heldText(45 * 60000), E.heldText(130 * 60000), E.heldText(22 * 3600000), E.heldText(50 * 3600000)], ['45분', '2시간 10분', '22시간', '2일 2시간']);
  assert.equal(E.eul('주피터'), '주피터를'); assert.equal(E.eul('비트코인'), '비트코인을'); assert.equal(E.eul('JUP'), 'JUP을');
  const w = world(), cfg = { live: true, budget: 20000, 'max-positions': 2 };
  const sig = await w.run('signals', cfg);
  await w.run('settle', { pid: (await w.run('order', { ...vars(sig.items[0]), ...cfg })).pid, ...cfg });
  const key = 'live|disparity|KRW-BTC', first = w.ledger().positions[key];
  assert.ok(Math.abs(first.cost - 10000) < 1);
  const pv = (await w.run('positions')).items[0].vars, more = { ...pv, ...cfg, budget: 40000 };   // 굴릴 금액 2만 → 4만(한 칸 1만 → 2만)

  const q = await w.run('buy-more', more);
  assert.equal(q.ask.question, '비트코인을 얼마나 더 살까요?');
  assert.equal(q.ask.hint, '들어간 돈 10,000원 · 한 칸 20,000원 · 더 넣을 수 있는 돈 29,985원');
  assert.deepEqual([q.ask.inline, q.ask.free, q.ask.free_type, q.ask.free_label], [true, true, 'number', '금액 확인'], '목록 줄에 적는 칸(숫자 자판)');
  assert.deepEqual(q.ask.choices.map(c => [c.value, c.label]), [['amt:9995', '모자란 만큼 9,995원'], ['keep', '그만두기']]);
  const over = await w.run('buy-more', { ...more, answer: '50000' });
  assert.equal(over.ask.question, q.ask.question, '굴릴 금액을 넘으면 같은 질문을 이유와 함께 다시');
  assert.match(over.ask.hint, /^굴릴 금액 안에서 더 넣을 수 있는 돈은 29,985원이에요/); assert.equal(over.ask.value, '50000', '적은 값은 칸에 남긴다');
  assert.match((await w.run('buy-more', { ...more, answer: '3000' })).ask.hint, /5,000원 이상/);
  const typed = await w.run('buy-more', { ...more, answer: '15,000원' });
  assert.equal(typed.ask.question, '비트코인 15,000원어치를 더 살까요?');
  assert.match(typed.ask.hint, /^지금 90\.10원 · 약 166개\n합치면 277개 · 평단 약 90\.1원 · 들어간 돈 25,00[0-9]원\n실제 돈으로 사요/);
  assert.deepEqual(typed.ask.choices.map(c => c.value), ['buy:15000', 'edit', 'keep']); assert.equal(typed.ask.choices[0].confirm, undefined, '확인 단계가 확인이라 창을 또 띄우지 않는다');
  assert.equal((await w.run('buy-more', { ...more, answer: 'edit' })).ask.question, q.ask.question, '금액 바꾸기 → 처음 질문');
  assert.deepEqual((await w.run('buy-more', { ...more, answer: 'amt:9995' })).ask.choices[0].value, 'buy:9995', '모자란 만큼도 확인을 거친다');
  assert.match((await w.run('buy-more', { ...more, answer: 'buy:99999' })).ask.hint, /더 넣을 수 있는 돈은/, '확인 뒤에도 금액을 다시 본다');
  assert.equal((await w.run('buy-more', { ...more, answer: 'keep' })).verdict.title, '그대로 뒀어요');
  assert.equal((await w.run('buy-more', { ...more, live: false })).verdict.title, '더 사지 않았어요', "'실제 돈으로 사기'가 꺼져 있으면 실제로 산 것을 더 사지 않는다");
  assert.equal(M.posts.length, 1, '확인하기 전에는 주문하지 않는다');

  M.ask = 95;   // 값이 올랐다
  const r = await w.run('buy-more', { ...more, answer: 'buy:9995' });
  assert.match(r.verdict.title, /^비트코인 9,995원어치를 더 샀어요$/); assert.match(r.verdict.text, /합쳐서 [0-9.,]+개 · 평단 92\.[0-9]{1,2}원 · 들어간 돈 20,000원/);
  assert.equal(r.notify.title, '비트코인 추가 매수 체결');
  assert.deepEqual(M.posts[1], { market: 'KRW-BTC', side: 'bid', ord_type: 'limit', price: '95', volume: String(E.floor8(9995 / 95)), identifier: M.posts[1].identifier });
  const db = w.ledger(), pos = db.positions[key];
  assert.deepEqual(Object.keys(db.positions), [key], '포지션은 하나 그대로');
  assert.equal(pos.volume, E.floor8(first.volume + 9995 / 95)); assert.ok(Math.abs(pos.cost - 20000) < 1); assert.ok(Math.abs(pos.price - (first.price * first.volume + 9995) / pos.volume) < 1e-6);
  assert.equal(pos.at, first.at, '산 시각은 처음 것'); assert.equal(pos.adds, 1); assert.equal(db.trades[1].add, true);
  const held = (await w.run('positions')).items[0], avg = E.avgText(pos.price);
  assert.equal(held.meta[0], `평단 ${avg}원 → 지금 ${E.priceText((95 + M.bid) / 2)}원`, '평단은 반올림하지 않는다(업비트 앱과 같게)'); assert.match(avg, /^92\.\d\d$/);
  assert.match(held.meta[1], /^216\.\d{1,2}개 · 평가 /); assert.match(held.meta[2], / · 2번 나눠 삼$/);
  assert.equal(held.detail[0].kind, '산 것'); assert.match(held.detail[0].text, /90\.1원 × 110\.93개 \(9,995원\)\n.*95원 × 105\.21개 \(9,995원\)\n평단 92\.\d\d원 · 수수료 포함 들어간 돈 20,000원$/);
  const trip = (await w.run('trades')).items[0];
  assert.match(trip.meta[0], /^매수 .* · 평단 92\.\d\d원 \(2번\)$/, '더 산 것도 같은 카드'); assert.match(trip.detail[0].text, /^삼 .*\n더 삼 .*95원 × 105\.21개/); assert.equal(trip.tags[1], '진행 중');
  assert.equal((await w.run('buy-more', more)).ask.choices.length, 1, '한 칸을 채웠으면 모자란 만큼은 없다');

  M.bars = recover(); M.ask = 101.1; M.bid = 100.9;
  assert.match((await w.run('buy-more', more)).verdict.text, /보유 상태가 아니에요/, '곧 팔 것은 더 사지 않는다');
  const sell = (await w.run('signals', cfg)).items[0];
  await w.run('settle', { pid: (await w.run('order', { ...vars(sell), ...cfg })).pid, ...cfg });
  assert.equal(Number(M.posts[2].volume), pos.volume, '합친 수량을 한꺼번에 판다');
  assert.deepEqual(w.ledger().positions, {}); assert.ok(Math.abs(w.ledger().trades[2].pnl - (pos.volume * 100.9 * 0.9995 - pos.cost)) < 1);
});

test('굴릴 금액(복리) — (굴릴 금액 + 판 손익) ÷ 칸 수만큼 사고, 수수료까지 합쳐 그 돈을 넘지 않는다. 이익이 나면 다음에 더 많이 산다', async () => {
  // 계산만
  assert.deepEqual(E.sizeOf({ orderKrw: 10000, maxPos: 5 }), { compound: false, krw: 10000, equity: 50000, free: null });
  assert.deepEqual(E.sizeOf({ budget: 2000000, maxPos: 2 }), { compound: true, krw: 999500, equity: 2000000, free: 2000000 });   // 999,500 + 수수료 0.05% ≈ 1,000,000
  assert.equal(E.sizeOf({ budget: 2000000, maxPos: 2, realized: 100000 }).krw, 1049475, '이익 10만 원 → 한 칸 105만 원');
  assert.equal(E.sizeOf({ budget: 2000000, maxPos: 2, realized: -200000 }).krw, 899550, '손실이 나면 줄어든다');
  assert.equal(E.sizeOf({ budget: 2000000, maxPos: 2, realized: 100000, deployed: 1500000 }).krw, 599700, '남은 돈(60만 원)을 넘지 않는다');
  assert.equal(E.sizeOf({ budget: 100000, maxPos: 2, realized: -150000 }).krw, 0);
  // 모의로 한 바퀴: 10만 원을 2칸으로 → 49,975원어치(+수수료 = 5만 원). 팔아서 이익이 나면 다음 칸이 커진다
  const w = world({ keys: false }), a = { budget: 100000, 'max-positions': 2 };
  let sig = await w.run('signals', a);
  await w.run('settle', { pid: (await w.run('order', { ...vars(sig.items[0]), ...a })).pid, ...a });
  let db = w.ledger();
  assert.ok(Math.abs(db.trades[0].funds - 49975) < 1 && Math.abs(db.positions['paper|disparity|KRW-BTC'].cost - 50000) < 1, `${db.trades[0].funds}`);
  M.bars = recover(); M.ask = 101.1; M.bid = 100.9;
  sig = await w.run('signals', a);
  await w.run('settle', { pid: (await w.run('order', { ...vars(sig.items[0]), ...a })).pid, ...a });
  const pnl = w.ledger().trades[1].pnl; assert.ok(pnl > 5000, `${pnl}`);
  const st = await w.run('status', a);
  assert.match(st.items[0].title, new RegExp(`\\(\\+${(pnl / 100000 * 100).toFixed(2)}%\\)$`), '수익률은 굴릴 금액 대비');
  assert.match(st.items[0].meta[2], /^굴릴 금액 100,000원 기준$/);
  assert.match(st.items[0].detail[0].text, new RegExp(`^${Math.floor((100000 + pnl) / 2 / 1.0005).toLocaleString('ko-KR')}원 — 지금 굴리는 돈`));
  // 다시 떨어져 새 신호 → 이번에는 (10만 + 이익) ÷ 2
  const last = M.bars[M.bars.length - 1].t;
  M.bars = [...M.bars, ...Array.from({ length: 25 }, (_, i) => ({ t: last + (i + 1) * H, o: 100, h: 100.5, l: 99.5, c: 100 })), { t: last + 26 * H, o: 100, h: 100, l: 89, c: 90 }];
  M.ask = 90.1; M.bid = 89.9;
  sig = await w.run('signals', a);
  assert.equal(sig.items[0].vars.side, 'bid');
  await w.run('settle', { pid: (await w.run('order', { ...vars(sig.items[0]), ...a })).pid, ...a });
  db = w.ledger();
  assert.ok(Math.abs(db.trades[2].funds - Math.floor((100000 + pnl) / 2 / 1.0005)) < 1, `${db.trades[2].funds}`);
  // 실제 거래: 계좌 원화가 조금 모자라면 있는 만큼만, 절반도 안 되면 사지 않는다
  const w2 = world(); M.krw = 49000;
  const sg = await w2.run('signals', { ...a, live: true });
  const o = await w2.run('order', { ...vars(sg.items[0]), ...a, live: true });
  assert.equal(M.posts[0].volume, String(Math.floor(Math.floor(49000 / 1.0005) / 90.1 * 1e8) / 1e8), '49,000원에서 수수료 몫을 뺀 만큼');
  assert.ok(o.pid);
  const w3 = world(); M.krw = 20000;
  const sg3 = await w3.run('signals', { ...a, live: true });
  assert.match((await w3.run('order', { ...vars(sg3.items[0]), ...a, live: true })).verdict.text, /원화가 모자라요\(주문 가능 20,000원, 필요 50,000원\)/);
  assert.equal(M.posts.length, 0);
});

test('감시 중 — 코인마다 지금 값과 남은 조건(얼마 더 오르거나 내리면 사고파는지), 값과 조건 선의 그래프', async () => {
  // 엔진: 조건을 "어느 값을 위로/아래로"로 푼다
  const c = (left, op, right) => ({ left, op, right }), price = { type: 'price' };
  const bars = flat(60), kd = STRATEGIES.find(s => s.id === 'or:keltner-breakout_period20_mult2.5+disparity');
  const w0 = E.watchOf(bars, kd);
  assert.deepEqual([w0.hold, w0.need, w0.wait.length, w0.close], [false, 'any', 2, 100]);
  const [k, dsp] = w0.wait.map(p => p.conds[0]);
  assert.deepEqual([k.kind, k.name, k.above, k.met], ['level', '켈트너 상단', true, false]); assert.ok(k.target > 100 && k.gap_pct > 0);
  assert.deepEqual([dsp.kind, dsp.name, dsp.above, dsp.target], ['level', '20봉 평균의 95%', false, 95]); assert.ok(Math.abs(dsp.gap_pct + 5) < 1e-9);
  assert.equal(dsp.values.length, bars.length); assert.equal(dsp.values[10], null, '평균이 정해지기 전은 비운다');
  const held = E.watchOf(dip(), kd);   // 이격도 쪽이 보유 구간 — 끝나려면 20봉 평균(이격도 100) 위로
  assert.deepEqual([held.hold, held.need, held.wait.map(p => p.conds[0].name), held.wait[0].conds[0].above], [true, 'all', ['20봉 평균'], true]);
  const rsi = E.watchOf(bars, { id: 'x', interval: '1h', strategy: { buy: [c(price, '>', { type: 'sma', period: 50 }), c({ type: 'rsi', period: 2 }, '<', 10)], sell: [c(price, '>', { type: 'sma', period: 5 })] } });
  assert.deepEqual(rsi.wait[0].conds.map(x => [x.kind, x.name]), [['level', '50봉 평균'], ['value', 'RSI(2)']]); assert.equal(rsi.wait[0].logic, 'all');
  // 목록: 기다리는 중 → 신호 → 사지 않고 지나감 → 들고 있음
  const wf = world({ keys: false }); M.bars = flat(60); M.ask = 100.1; M.bid = 99.9;
  const A = { strategies: kd.id };   // 켈트너 ∨ 이격도
  let r = await wf.run('watch', A);
  assert.equal(r.items.length, 1); assert.equal(r.items[0].title, '비트코인 · 매수 신호를 기다려요');
  assert.equal(r.items[0].meta[0], '지금 100원 · 아래 중 하나가 되면 사요');
  assert.match(r.items[0].meta[1], /^① \+[0-9.]+% 오르면 사요 \([0-9.]+원 · 켈트너 상단\)$/); assert.equal(r.items[0].meta[2], '② -5.0% 내리면 사요 (95.00원 · 20봉 평균의 95%)');
  assert.equal(r.items[0].chart.zero, false); assert.equal(r.items[0].chart.points.length, 60); assert.deepEqual(r.items[0].chart.lines.map(l => l.label), ['① 켈트너 상단', '② 20봉 평균의 95%']);
  assert.equal(r.items[0].chart.lines[1].values.length, 60); assert.equal(r.items[0].chart.points.at(-1).v, 100);
  assert.match(r.note, /^1시간봉 .* 마감 기준 · 다음 봉은 [0-9:]+에 닫히고, 닫힌 뒤 5분 안에 확인해요$/);
  const w = world({ keys: false });   // 마지막 봉에서 떨어졌다(새 봉 캐시)
  r = await w.run('watch', A);
  assert.equal(r.items[0].title, '비트코인 · 방금 매수 신호가 났어요'); assert.match(r.items[0].meta[1], /^조건: .*이격도/);
  r = await w.run('watch', { ...A, now: nowAt(M.bars, 30) });   // 15분이 지나도록 사지 않았다
  assert.equal(r.items[0].title, '비트코인 · 지난 매수 신호는 지나갔어요');
  assert.match(r.items[0].meta[0], /아래가 되면 구간이 끝나요\. 그 뒤 새 신호부터 사요$/); assert.match(r.items[0].meta[1], /^\+[0-9.]+% 오르면 구간이 끝나요 \(.*20봉 평균\)$/);
  assert.match(r.items[0].detail[0].text, /신호\(90\.00원\): 그때 자동 시작이 꺼져 있었거나 이 컴퓨터가 확인하지 못했어요$/);
  const sig = await w.run('signals', A);
  await w.run('settle', { pid: (await w.run('order', { ...vars(sig.items[0]), ...A })).pid });
  r = await w.run('watch', A);
  assert.match(r.items[0].title, /^비트코인 · 들고 있어요 -0\.[0-9]+%$/); assert.match(r.items[0].meta[0], /평단 90\.1원 · 아래가 되면 팔아요$/);
  assert.match(r.items[0].meta[1], /^\+[0-9.]+% 오르면 팔아요 \(.*20봉 평균\)$/); assert.deepEqual(r.items[0].chart.lines.map(l => l.label), ['20봉 평균']);
  // 슬리피지로 건너뛴 신호는 그 이유를 보인다
  const w2 = world(); M.ask = 91;
  const s2 = await w2.run('signals', { live: true });
  await w2.run('order', { ...vars(s2.items[0]), live: true });
  assert.match((await w2.run('watch', { live: true })).items[0].detail[0].text, /올라 사지 않았어요\(허용 0\.3%\)$/);
});
