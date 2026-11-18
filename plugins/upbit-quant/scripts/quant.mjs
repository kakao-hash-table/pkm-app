#!/usr/bin/env node
// 업비트 퀀트 — 등록된 전략으로 업비트 원화 마켓에서 사고판다. 결과는 JSON 한 줄.
// 목록(피드)
//   signals      지금 조건이 맞은 것(매수: 방금 닫힌 봉에서 신호가 난 것만 · 매도: 들고 있는 것 중 매도 조건이 온 것)
//   watch        감시 중 — 켜 둔 전략 × 코인마다 지금 값과 남은 조건(얼마 더 오르거나 내리면 사고파는지), 값과 조건 선을 그린 그래프
//   status       누적 손익(그래프)·계좌·마지막 확인 · positions  들고 있는 것 · trades  거래 내역 · strategies  등록된 전략 · account  연결 확인 줄
// 워크플로우
//   order --side=bid|ask --sid --market --bar [--mode]   조건을 다시 확인하고 지정가 주문(매수는 매도 1호가, 매도는 매수 1호가) → pid
//   settle --pid                                        체결 확인. 정한 시간 안에 다 체결되지 않으면 취소하고 시장가로 마저(매수는 허용 슬리피지 안에서만, 매도는 늘)
//   sell-now --mode --sid --market [--answer=sell]      들고 있는 것을 지금 시장가로 팔기(한 번 묻는다)
//   toggle --sid                                        전략 켜고 끄기 · doctor  업비트 연결·권한 확인(실제 주문 없음)
// 공통 설정: --live=true|false --markets=줄들 --strategies=id,id --budget=2000000(굴릴 금액 — 적으면 복리) --order-krw=10000 --max-positions=5 --slippage=0.5 --wait=20
// 테스트용: --profile=폴더 --now=ISO --cache=폴더 --api=http://127.0.0.1:포트 --poll=ms
// 저장: <프로필>/_플러그인/.data/upbit-quant/ledger.json(장부 — 포지션·거래·손익 곡선. 비밀값은 없다, 프로필과 함께 동기화) · 봉 캐시는 이 컴퓨터의 ~/.pkm-app/cache/upbit-quant/
// 모의(paper)와 실제(live)는 장부에서 따로 센다. '실제 돈으로 사기'는 새로 사는 것만 정한다 — 이미 실제로 산 것은 꺼도 실제로 판다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as E from './engine.mjs';
import { client, API, STEP_SEC } from './upbit.mjs';
import { STRATEGIES, META } from './strategies.mjs';

const args = Object.fromEntries(process.argv.slice(3).map(a => a.match(/^--([^=]+)=([\s\S]*)$/)).filter(Boolean).map(m => [m[1], m[2]]));
const NOW = args.now && !Number.isNaN(Date.parse(args.now)) ? Date.parse(args.now) : Date.now();
const AT = new Date(NOW).toISOString(), NOW_SEC = Math.floor(NOW / 1000);
const fail = msg => { throw Object.assign(new Error(msg), { user: true }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = (v, d, lo, hi) => { const n = Number(String(v ?? '').replace(/[,\s원%초개]/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? Math.min(hi, Math.max(lo, n)) : d; };
const dec = v => Number(v).toFixed(8).replace(/\.?0+$/, '');   // 주문에 넣는 숫자 글(지수 표기 없이)

/* ---------- 설정 ---------- */
const DEFAULT_MARKETS = ['KRW-BTC', 'KRW-ETH', 'KRW-XRP', 'KRW-ADA', 'KRW-XLM'];
const LIVE = args.live === 'true', MODE = LIVE ? 'live' : 'paper', MODE_LABEL = { live: '실제', paper: '모의' };
const listOf = v => String(v || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean);
const MARKETS = (() => { const m = [...new Set(listOf(args.markets).map(x => x.toUpperCase()).map(x => x.startsWith('KRW-') ? x : `KRW-${x}`).filter(x => /^KRW-[A-Z0-9]{1,15}$/.test(x)))].slice(0, 20); return m.length ? m : DEFAULT_MARKETS; })();
const REG = new Map(STRATEGIES.map(s => [s.id, s]));
const ACTIVE = [...new Set(listOf(args.strategies))].filter(id => REG.has(id));
const ORDER_KRW = num(args['order-krw'], 10000, 0, 100000000), MAX_POS = Math.round(num(args['max-positions'], 5, 1, 50)), BUDGET = num(args.budget, 0, 0, 10000000000);
// 이번에 살 금액 — 굴릴 금액을 적었으면 복리((굴릴 금액 + 판 손익) ÷ 칸 수), 아니면 한 번에 살 금액
const sizing = (db, mode) => E.sizeOf({ budget: BUDGET, orderKrw: ORDER_KRW, maxPos: MAX_POS, fee: FEE,
  realized: E.statsOf(db.trades.filter(t => t.mode === mode)).realized, deployed: Object.values(db.positions).filter(p => p.mode === mode).reduce((a, p) => a + p.cost, 0) });
const SLIP = num(args.slippage, 0.5, 0, 5), WAIT = num(args.wait, 20, 1, 120), POLL = num(args.poll, 1500, 10, 5000);
const FEE = 0.0005;   // 원화 마켓 수수료(모의 거래 계산용. 실제 거래는 업비트가 알려 준 수수료를 쓴다)
const LATE = 0.25;    // 봉이 닫히고 봉 길이의 이만큼이 지나면 그 매수 신호는 늦은 것으로 본다(1시간봉 15분)

const here = path.dirname(fileURLToPath(import.meta.url));
const profile = args.profile ? path.resolve(args.profile) : path.resolve(here, '..', '..', '..');   // <프로필>/_플러그인/upbit-quant/scripts
const DATA = path.join(profile, '_플러그인', '.data', 'upbit-quant'), LEDGER = path.join(DATA, 'ledger.json'), LOCK = path.join(DATA, 'ledger.lock');
const CACHE = args.cache ? path.resolve(args.cache) : path.join(os.homedir(), '.pkm-app', 'cache', 'upbit-quant');
let up;   // main에서 만든다 — 주소가 틀리면 여기서 던지고, 그 말을 결과로 돌려준다

/* ---------- 장부 ---------- */
const readJSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function writeAtomic(f, t){
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = path.join(path.dirname(f), `.${path.basename(f)}.${process.pid}.tmp`);
  try { fs.writeFileSync(tmp, t); fs.renameSync(tmp, f); } finally { fs.rmSync(tmp, { force: true }); }
}
const EMPTY = () => ({ v: 1, positions: {}, pending: {}, trades: [], skipped: [], skips: {}, equity: { paper: [], live: [] }, checked: null });
function load(){
  if (!fs.existsSync(LEDGER)) return EMPTY();
  const db = readJSON(LEDGER);
  if (!db || typeof db !== 'object') fail('장부(ledger.json)를 읽지 못했어요. 동기화 충돌이 있는지 봐 주세요');   // 돈이 걸린 기록이라 빈 장부로 덮어쓰지 않는다
  return { ...EMPTY(), ...db, equity: { paper: [], live: [], ...(db.equity || {}) } };
}
/* 목록 스크립트와 주문 단계가 동시에 돌 수 있다 — 읽고 고쳐 쓰는 동안만 잠근다(네트워크를 기다리는 동안은 잡지 않는다) */
function withLedger(fn){
  fs.mkdirSync(DATA, { recursive: true });
  for (let i = 0; ; i++){
    try { fs.mkdirSync(LOCK); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 30000) fs.rmSync(LOCK, { recursive: true, force: true }); } catch {}
      if (i > 300) fail('장부가 잠겨 있어요. 잠시 뒤 다시 해 주세요');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try { const db = load(), r = fn(db); writeAtomic(LEDGER, JSON.stringify(db, null, 1) + '\n'); return r; }
  finally { fs.rmSync(LOCK, { recursive: true, force: true }); }
}
const keyOf = (mode, sid, market) => `${mode}|${sid}|${market}`;
const nameOf = sid => (REG.get(sid) || {}).name || sid;
const short = (s, n = 28) => s.length > n ? `${s.slice(0, n - 1)}…` : s;

/* ---------- 봉(이 컴퓨터에 캐시) ---------- */
async function barsOf(market, interval){
  const want = E.INTERVALS[interval].bars, step = STEP_SEC[interval], f = path.join(CACHE, `${market}-${interval}.json`);
  const cached = (readJSON(f) || {}).bars || [];
  if (cached.length >= 2 && cached[cached.length - 1].t + 2 * step > NOW_SEC) return cached.filter(b => b.t + step <= NOW_SEC);   // 마지막으로 닫힌 봉까지 이미 있다
  const since = cached.length >= want / 2 ? cached[cached.length - 1].t - 3 * step : 0;   // 겹쳐 받아 이어 붙인다
  const got = await up.candles(market, interval, { want, since, now: NOW });
  const byT = new Map(cached.map(b => [b.t, b])); for (const b of got) byT.set(b.t, b);
  const bars = [...byT.values()].sort((a, b) => a.t - b.t).slice(-want);
  if (got.length){ try { writeAtomic(f, JSON.stringify({ bars })); } catch {} }
  return bars;
}
let NAMES = null;
async function coinName(market){
  if (!NAMES){
    const f = path.join(CACHE, 'markets.json'), c = readJSON(f);
    if (c && NOW - Date.parse(c.at) < 86400000 && NOW >= Date.parse(c.at)) NAMES = c.names;
    else { try { NAMES = Object.fromEntries((await up.markets()).filter(m => String(m.market).startsWith('KRW-')).map(m => [m.market, m.korean_name])); writeAtomic(f, JSON.stringify({ at: AT, names: NAMES })); } catch { NAMES = (c && c.names) || {}; } }
  }
  return NAMES[market] || E.coinOf(market);
}
async function bestOf(market){
  const ob = await up.orderbook([market]), u = ob && ob[0] && ob[0].orderbook_units && ob[0].orderbook_units[0];
  if (!u || !(u.ask_price > 0) || !(u.bid_price > 0)) fail(`${E.coinOf(market)} 호가를 받지 못했어요`);
  return { ask: u.ask_price, bid: u.bid_price };
}
/* 호가 단위 — 못 받으면 0(허용 슬리피지만 쓴다) */
async function tickOf(market){
  try { const r = await up.instruments([market]), t = Number(r && r[0] && r[0].tick_size); return t > 0 ? t : 0; } catch { return 0; }
}
const slipText = (signal, tick) => tick > signal * SLIP / 100 ? `허용 ${SLIP}% 또는 호가 한 칸 ${tick >= 1 ? tick.toLocaleString('ko-KR') : String(tick)}원` : `허용 ${SLIP}%`;
const lateSec = (d, interval) => NOW_SEC - (d.bar + STEP_SEC[interval]);   // 신호 봉이 닫힌 뒤 지난 시간

/* 들고 있는 것을 지금 팔아야 하나 — 전략이 '보유 아님'이거나, 실제 매수가 기준 손절·익절·최대 보유에 닿았다 */
function exitOf(pos, entry, d, cur){
  if (!entry) return '전략이 등록부에서 빠져 정리해요';
  if (!d.ready) return '';
  if (!d.hold) return d.reason || '매도 조건';
  const s = entry.strategy || {};
  if (s.stopLossPct > 0 && cur != null && cur <= pos.price * (1 - s.stopLossPct / 100)) return `손절선(-${s.stopLossPct}%)에 닿음`;
  if (s.takeProfitPct > 0 && cur != null && cur >= pos.price * (1 + s.takeProfitPct / 100)) return `익절선(+${s.takeProfitPct}%)에 닿음`;
  if (s.maxBars > 0 && (NOW_SEC - Date.parse(pos.at) / 1000) / STEP_SEC[entry.interval] >= s.maxBars) return `최대 보유(${s.maxBars}봉)를 채움`;
  return '';
}
async function priceMap(markets){
  const out = {}; if (!markets.length) return out;
  try { for (const t of await up.ticker([...new Set(markets)])) out[t.market] = t.trade_price; } catch {}
  return out;
}

/* ---------- 체결 마무리: 주문 하나(pending)를 끝까지 본다 ---------- */
const filled = o => ({ fills: (o && Array.isArray(o.trades) ? o.trades : []).map(t => ({ price: Number(t.price), volume: Number(t.volume), funds: Number(t.funds) })), fee: Number((o && o.paid_fee) || 0) });
async function orderBy(p){
  try { return await up.getOrder(p.uuid ? { uuid: p.uuid } : { identifier: p.pid }); }
  catch (e) { if (e.code === 'order_not_found') return null; throw e; }   // 주문이 들어가지 않았다
}
async function waitOrder(p, ms, done = o => !o || ['done', 'cancel'].includes(o.state)){
  const t0 = Date.now(); let o = await orderBy(p);
  while (!done(o) && Date.now() - t0 < ms){ await sleep(POLL); o = await orderBy(p); }
  return o;
}
/* wait: 지정가를 기다릴 시간(초) · chase: 덜 체결된 매수를 시장가로 마저 살지(늦게 발견한 주문은 사지 않는다). 매도는 늘 시장가로 마저 판다 */
async function finish(p, { wait, chase }){
  const entry = REG.get(p.sid), notes = [], uuids = [];
  let fills = [], fee = 0, how = 'limit', dust = false;
  if (p.mode === 'paper'){
    if (p.side === 'bid' && !chase) notes.push('체결 확인이 끊겨 사지 않은 것으로 봐요');
    else { const b = await bestOf(p.market), price = p.side === 'bid' ? b.ask : b.bid, volume = p.side === 'bid' ? E.floor8(p.krw / price) : p.volume;
      fills = [{ price, volume, funds: price * volume }]; fee = price * volume * FEE; }
    how = 'paper';
  } else if (p.immediate){   // 지금 팔기 — 시장가 주문 하나
    const o = await waitOrder(p, 15000); if (o) uuids.push(o.uuid);
    ({ fills, fee } = filled(o)); how = 'market';
    if (o && o.state === 'wait') fail('시장가 주문이 아직 끝나지 않았어요. 다음 확인 때 다시 봐요');   // 장부에 남겨 두고 다음에 마저 본다
  } else {
    let o = await waitOrder(p, wait * 1000);
    if (o && o.state === 'wait'){   // 다 체결되지 않았다 — 남은 것을 취소한다
      try { await up.cancel(o.uuid); } catch (e) { if (e.code === 'network') throw e; }   // 그 사이 체결됐거나 이미 취소됐으면 거절된다 — 아래에서 주문 상태를 다시 본다
      o = await waitOrder({ ...p, uuid: o.uuid }, 8000);
      if (o && o.state === 'wait') fail('주문 취소를 확인하지 못했어요. 업비트에서 미체결 주문을 확인해 주세요');
    }
    if (o) uuids.push(o.uuid);
    ({ fills, fee } = filled(o));
    const got = E.fillOf(fills), best = await bestOf(p.market), tick = p.side === 'bid' ? await tickOf(p.market) : 0;
    let left = false;   // 덜 체결돼 남은 것이 있나
    const body = p.side === 'bid'
      ? (() => { const rest = Math.floor(p.krw - got.funds);
          if (rest < E.MIN_ORDER) return null;
          left = true;
          if (!chase){ notes.push('늦게 확인한 주문이라 나머지는 사지 않았어요'); return null; }
          if (E.overCap(best.ask, p.signal_price, SLIP, tick)){ notes.push(`값이 신호가보다 ${E.pct((best.ask / p.signal_price - 1) * 100)} 올라(${slipText(p.signal_price, tick)}) 나머지는 사지 않았어요`); return null; }
          return { market: p.market, side: 'bid', ord_type: 'price', price: String(rest), identifier: `${p.pid}m` }; })()
      : (() => { const rest = E.floor8(p.volume - got.volume);
          if (rest <= 0) return null;
          left = true;
          if (rest * best.bid < E.MIN_ORDER){ dust = true; notes.push(`남은 ${dec(rest)}개는 최소 주문 금액(5,000원)보다 적어 팔지 못했어요`); return null; }
          return { market: p.market, side: 'ask', ord_type: 'market', volume: dec(rest), identifier: `${p.pid}m` }; })();
    if (left){   // 시장가로 마저. 앞서 넣은 시장가 주문이 있었는지도 본다(넣다가 끊겼을 수 있다 — 같은 identifier로 찾는다)
      let o2 = null;
      if (body){
        try { o2 = await up.order(body); }
        catch (e) { if (!e.unsure && e.code !== 'duplicated_identifier') notes.push(`시장가 주문을 넣지 못했어요: ${e.message}`); }
      }
      o2 = await waitOrder({ pid: `${p.pid}m`, uuid: o2 && o2.uuid }, body ? 15000 : 0);   // 시장가 매수는 잔돈이 남으면 cancel로 끝난다 — 체결은 trades로 본다
      if (o2 && o2.state === 'wait') fail('시장가 주문이 아직 끝나지 않았어요. 다음 확인 때 다시 봐요');
      if (o2){ const f2 = filled(o2); uuids.push(o2.uuid); if (f2.fills.length) how = fills.length ? 'limit+market' : 'market'; fills = [...fills, ...f2.fills]; fee += f2.fee; }
    }
  }
  const got = E.fillOf(fills), coin = E.coinOf(p.market), key = keyOf(p.mode, p.sid, p.market);
  return withLedger(db => {
    delete db.pending[p.pid];
    if (!(got.volume > 0)){
      const reason = notes[0] || (p.side === 'bid' ? '지정가가 체결되지 않아 사지 않았어요' : '체결되지 않았어요. 다음 확인 때 다시 팔아요');
      if (p.side === 'bid') skip(db, p, reason);
      return { none: true, reason, side: p.side };
    }
    const t = { id: p.pid, at: AT, side: p.side, sid: p.sid, name: nameOf(p.sid), market: p.market, mode: p.mode, price: got.price, volume: got.volume, funds: got.funds, fee, how, bar: p.bar,
      ...(p.immediate ? { manual: true } : {}), signal_price: p.signal_price ?? null, slip_pct: p.signal_price ? (got.price / p.signal_price - 1) * 100 : null, why: p.why || '', uuids, notes };
    if (p.side === 'bid'){
      db.positions[key] = { mode: p.mode, sid: p.sid, market: p.market, interval: entry ? entry.interval : p.interval, volume: got.volume, cost: got.funds + fee, price: got.price, at: AT, bar: p.bar, signal_price: p.signal_price ?? null };
    } else {
      const pos = db.positions[key];
      if (pos){
        const part = Math.min(1, got.volume / pos.volume), cost = pos.cost * part;
        t.pnl = got.funds - fee - cost; t.ret_pct = cost > 0 ? t.pnl / cost * 100 : null; t.held_h = (NOW - Date.parse(pos.at)) / 3600e3; t.entry_price = pos.price;
        if (part > 1 - 1e-6) delete db.positions[key];
        else { pos.volume = E.floor8(pos.volume - got.volume); pos.cost -= cost; if (dust) pos.stuck = 'min'; }   // 남은 자투리가 최소 주문 금액보다 적으면 자동으로는 못 판다
      }
    }
    db.trades.push(t); db.trades = db.trades.slice(-2000);
    return { trade: t, coin };
  });
}
function skip(db, p, reason){
  db.skips[`${keyOf(p.mode, p.sid, p.market)}|${p.bar}`] = AT;
  for (const k of Object.keys(db.skips)) if (NOW - Date.parse(db.skips[k]) > 14 * 86400000) delete db.skips[k];
  db.skipped.push({ at: AT, side: p.side, sid: p.sid, name: nameOf(p.sid), market: p.market, mode: p.mode, bar: p.bar, reason }); db.skipped = db.skipped.slice(-200);
}
const REFRESH = { settings_patch: {} };   // 장부가 바뀌었다 — 설정은 그대로 두고 이 플러그인의 목록(손익·들고 있는 것·거래 내역)을 바로 다시 가져오게 한다
const HOW = { limit: '지정가로 체결', 'limit+market': '지정가 일부 + 나머지 시장가', market: '시장가로 체결', paper: '모의 체결' };
// 휴대폰 알림 한 줄 — 무엇을 얼마에 사고팔았는지(팔 때는 손익)
function noticeOf(r){
  const t = r.trade, buy = t.side === 'bid', tag = t.mode === 'paper' ? '(모의) ' : '';
  return { title: `${tag}${r.coin} ${buy ? '매수' : '매도'} 체결`, text: [buy ? `${E.won(t.funds)}어치` : t.pnl != null ? `${E.signed(t.pnl)} (${E.pct(t.ret_pct)})` : E.won(t.funds), `평균 ${E.priceText(t.price)}원`, HOW[t.how]].join(' · ') };
}
function report(r){
  if (r.none && r.side === 'ask') fail(`아직 팔지 못했어요 — ${r.reason}`);   // 멈춘 것으로 보이게(다음 봉이 닫히면 다시 판다)
  if (r.none) return { summary: r.reason, verdict: { tone: 'ok', title: '사지 않았어요', text: r.reason }, ...REFRESH };
  const t = r.trade, buy = t.side === 'bid', tag = t.mode === 'paper' ? '(모의) ' : '';
  const title = buy ? `${tag}${r.coin} ${E.won(t.funds)}어치를 샀어요` : `${tag}${r.coin}을 팔았어요 · ${t.pnl != null ? `${E.signed(t.pnl)} (${E.pct(t.ret_pct)})` : E.won(t.funds)}`;
  const text = [`평균 ${E.priceText(t.price)}원 × ${dec(t.volume)}개`, HOW[t.how], `수수료 ${E.won(t.fee)}`, t.slip_pct != null ? `신호가 대비 ${E.pct(t.slip_pct)}` : '', ...t.notes].filter(Boolean).join(' · ');
  return { summary: title, verdict: { tone: 'ok', title, text }, outcome: { title: buy ? '샀어요' : '팔았어요', text: '' }, ...REFRESH, notify: noticeOf(r),
    findings: t.uuids.map(u => ({ where: `주문 ${u}`, title: '업비트 주문 번호', text: '업비트 앱의 거래 내역에서 같은 주문을 볼 수 있어요' })) };
}
/* 끝맺지 못한 주문(스크립트가 중간에 죽었거나 주문이 들어갔는지 몰랐던 것)을 정리한다. 방금 넣은 주문은 체결 단계가 보고 있으니 건드리지 않는다 */
async function reconcile(only){
  const db = load(), out = [];
  for (const p of Object.values(db.pending)){
    const mine = only && keyOf(p.mode, p.sid, p.market) === only;
    if (!mine && NOW - Date.parse(p.at) < (WAIT + 120) * 1000) continue;
    try { out.push(await finish(p, { wait: 0, chase: false })); } catch (e) { out.push({ error: e.message }); }
  }
  return out;
}

/* ---------- 목록 ---------- */
async function signals(){
  const warn = [], late = await reconcile().catch(e => { warn.push(e.message); return []; });
  for (const r of late) if (r.trade) r.coin = await coinName(r.trade.market);
  const found = late.filter(r => r.trade).map(noticeOf);   // 끊겼던 주문을 지금 찾아 정리했다 — 체결된 것이 있으면 알린다
  const db = load(), items = [], busy = new Set(Object.values(db.pending).map(p => keyOf(p.mode, p.sid, p.market)));
  const cur = await priceMap(Object.values(db.positions).map(p => p.market));
  const item = async (side, mode, entry, sid, market, d, why) => ({
    id: `${side}|${mode}|${sid}|${market}|${d.bar}`, title: `${await coinName(market)} ${side === 'bid' ? '매수' : '매도'} 신호`, tags: [MODE_LABEL[mode]],
    meta: [short(nameOf(sid)), entry ? `${E.INTERVALS[entry.interval].label} ${E.kst((d.bar + STEP_SEC[entry.interval]) * 1000)} 마감` : '', side === 'bid' ? `신호가 ${E.priceText(d.price)}원` : ''].filter(Boolean),
    detail: [{ kind: '조건', text: why }], at: AT, vars: { side, mode, sid, market, bar: String(d.bar) } });
  for (const [key, pos] of Object.entries(db.positions)){   // 매도 — 들고 있는 것 전부(꺼 둔 전략·다른 모드 것도)
    if (pos.stuck || busy.has(key)) continue;
    const entry = REG.get(pos.sid);
    try {
      const d = entry ? E.desired(await barsOf(pos.market, entry.interval), entry) : { ready: true, hold: false, bar: Math.floor(NOW_SEC / 3600) * 3600 - 3600, price: null };
      const why = exitOf(pos, entry, d, cur[pos.market]);
      if (why) items.push(await item('ask', pos.mode, entry, pos.sid, pos.market, d, why));
    } catch (e) { warn.push(`${E.coinOf(pos.market)}: ${e.message}`); }
  }
  for (const sid of ACTIVE){   // 매수 — 켜 둔 전략 × 볼 코인, 방금 닫힌 봉에서 신호가 난 것만
    const entry = REG.get(sid);
    for (const market of MARKETS){
      const key = keyOf(MODE, sid, market);
      if (db.positions[key] || busy.has(key)) continue;
      try {
        const d = E.desired(await barsOf(market, entry.interval), entry);
        if (d.hold && d.fresh && lateSec(d, entry.interval) <= STEP_SEC[entry.interval] * LATE && !db.skips[`${key}|${d.bar}`]) items.push(await item('bid', MODE, entry, sid, market, d, d.reason));
      } catch (e) { warn.push(`${E.coinOf(market)}: ${e.message}`); }
    }
  }
  withLedger(d => { d.checked = { at: AT, strategies: ACTIVE.length, markets: MARKETS.length, mode: MODE, warn: warn.slice(0, 3) }; });
  const note = !ACTIVE.length ? "켜 둔 전략이 없어요. '전략' 탭에서 켜 주세요" : `${E.kst(NOW)} 확인 · 전략 ${ACTIVE.length}개 × 코인 ${MARKETS.length}개 · ${MODE_LABEL[MODE]} 거래${warn.length ? ` · 확인 못 한 것: ${warn[0]}` : ''}`;
  return { items, note, ...(found.length ? { notify: { title: found.length > 1 ? `뒤늦게 확인한 체결 ${found.length}건` : found[0].title, text: found.map(n => found.length > 1 ? `${n.title} ${n.text}` : n.text).join(' / ') } } : {}) };
}

function modeSummary(db, mode, cur){
  const trades = db.trades.filter(t => t.mode === mode), pos = Object.values(db.positions).filter(p => p.mode === mode), st = E.statsOf(trades);
  const unreal = pos.reduce((a, p) => a + (cur[p.market] != null ? cur[p.market] * p.volume * (1 - FEE) - p.cost : 0), 0);
  return { trades, pos, st, unreal, pnl: st.realized + unreal };
}
async function status(){
  const db0 = load(), cur = await priceMap(Object.values(db0.positions).map(p => p.market)), cap = BUDGET > 0 ? BUDGET : ORDER_KRW * MAX_POS, items = [];
  const db = withLedger(d => {   // 손익 곡선에 점 하나 — 10분에 한 번, 또는 거래가 생겼을 때
    for (const mode of ['live', 'paper']){
      const s = modeSummary(d, mode, cur), eq = d.equity[mode], last = eq[eq.length - 1];
      if (!s.trades.length && !s.pos.length) continue;
      if (!last || NOW - Date.parse(last.t) >= 9 * 60000 || last.n !== s.trades.length) eq.push({ t: AT, pnl: Math.round(s.pnl), n: s.trades.length });
      d.equity[mode] = E.thin(eq, 1500);
    }
    return d;
  });
  for (const mode of ['live', 'paper']){
    const s = modeSummary(db, mode, cur);
    if (mode !== MODE && !s.trades.length && !s.pos.length) continue;
    const eq = E.thin(db.equity[mode], 120), ret = cap > 0 ? s.pnl / cap * 100 : null;
    items.push({ id: `pnl-${mode}`, title: `${MODE_LABEL[mode]} 거래 누적 손익 ${E.signed(s.pnl)} (${E.pct(ret)})`, tags: [mode === MODE ? '지금 모드' : '지난 기록'],
      meta: [`판 것 ${E.signed(s.st.realized)}`, `들고 있는 것 ${E.signed(s.unreal)}`, `${BUDGET > 0 ? '굴릴 금액' : '운용 한도'} ${E.won(cap)} 기준`, s.st.closed ? `끝난 거래 ${s.st.closed}건 · 승률 ${Math.round(s.st.win_rate)}% · 평균 ${E.pct(s.st.avg_ret)}` : '끝난 거래 없음'],
      ...(eq.length >= 2 ? { chart: { label: `${MODE_LABEL[mode]} 거래 누적 손익`, unit: '원', signed: true, points: eq.map(p => ({ t: p.t, v: p.pnl })) } } : {}),
      detail: [...(mode === MODE ? [{ kind: '다음에 살 금액', text: (z => z.compound ? `${E.won(z.krw)} — 지금 굴리는 돈 ${E.won(z.equity)}(굴릴 금액 ${E.won(BUDGET)} ${E.signed(z.equity - BUDGET)})을 ${MAX_POS}칸으로 나눠요. 이익이 나면 다음에 더 많이, 손실이 나면 더 적게 사요${z.free < z.equity / MAX_POS ? ` · 지금 남은 돈 ${E.won(z.free)}` : ''}` : `${E.won(z.krw)} — 한 번에 살 금액 그대로예요. 복리로 굴리려면 설정에서 '굴릴 금액'을 적어요`)(sizing(db, mode)) }] : []),
        { kind: '보는 법', text: eq.length >= 2 ? `수익률은 ${BUDGET > 0 ? '굴릴 금액' : '운용 한도(한 번에 살 금액 × 동시에 가질 수 있는 수)'} 대비예요. 수수료는 뺀 숫자예요${s.st.fallbacks ? ` · 지정가가 덜 체결돼 시장가로 마저 한 거래 ${s.st.fallbacks}건` : ''}` : '거래가 쌓이면 여기에 손익 그래프가 생겨요' }] });
  }
  if (up.hasKeys){
    try {
      const krw = (await up.accounts()).find(a => a.currency === 'KRW') || { balance: 0, locked: 0 };
      items.push({ id: 'account', title: `업비트 원화 잔고 ${E.won(Number(krw.balance) + Number(krw.locked))}`, meta: [`주문 가능 ${E.won(Number(krw.balance))}`, Number(krw.locked) > 0 ? `주문에 묶인 ${E.won(Number(krw.locked))}` : ''].filter(Boolean) });
    } catch (e) { items.push({ id: 'account', title: '업비트 계정을 확인하지 못했어요', tags: ['오류'], meta: [e.message] }); }
  } else items.push({ id: 'account', title: '업비트 계정 정보가 아직 없어요', meta: ['설정에서 Access key와 Secret key를 넣으면 잔고가 보여요', '모의 거래는 키 없이도 돼요'] });
  const c = db.checked;
  items.push({ id: 'checked', title: c ? `마지막 조건 확인 ${E.kst(c.at)}` : '아직 조건을 확인하지 않았어요', meta: c ? [`전략 ${c.strategies}개 × 코인 ${c.markets}개`, `${MODE_LABEL[c.mode]} 거래`, ...(c.warn || [])] : ["'할 일' 탭의 목록을 가져오면 확인해요"], ...(c && (c.warn || []).length ? { tags: ['오류'] } : {}) });
  return { items, note: LIVE ? '실제 돈으로 사고 있어요' : "모의 거래예요. 실제로 사려면 설정에서 '실제 돈으로 사기'를 켜요" };
}
async function positions(){
  const db = load(), list = Object.values(db.positions), cur = await priceMap(list.map(p => p.market)), items = [];
  for (const p of list.sort((a, b) => String(b.at).localeCompare(String(a.at)))){
    const c = cur[p.market], value = c != null ? c * p.volume : null, pnl = value != null ? value * (1 - FEE) - p.cost : null;
    items.push({ id: keyOf(p.mode, p.sid, p.market), title: `${await coinName(p.market)} ${pnl != null ? `${E.signed(pnl)} (${E.pct(pnl / p.cost * 100)})` : ''}`.trim(), tags: [MODE_LABEL[p.mode], ...(p.stuck ? ['직접 정리 필요'] : [])],
      meta: [short(nameOf(p.sid)), `${E.priceText(p.price)}원에 삼${c != null ? ` → 지금 ${E.priceText(c)}원` : ''}`, value != null ? `평가 ${E.won(value)}` : '', `${E.kst(p.at)}부터`].filter(Boolean),
      detail: p.stuck ? [{ kind: '알림', text: '평가액이 최소 주문 금액(5,000원)보다 적어 자동으로 팔 수 없어요. 업비트에서 직접 정리해 주세요' }] : [],
      at: p.at, vars: { mode: p.mode, sid: p.sid, market: p.market } });
  }
  return { items };
}
async function trades(){
  const db = load(), rows = [];
  for (const t of db.trades.slice(-150)){
    const buy = t.side === 'bid';
    rows.push({ at: t.at, item: { id: `t-${t.id}`, title: `${buy ? '매수' : '매도'} ${E.coinOf(t.market)} ${E.won(t.funds)}${!buy && t.pnl != null ? ` · ${E.signed(t.pnl)} (${E.pct(t.ret_pct)})` : ''}`,
      tags: [MODE_LABEL[t.mode], ...(t.how === 'limit+market' || (t.how === 'market' && !t.manual) ? ['시장가 전환'] : [])],
      meta: [E.kst(t.at), `${E.priceText(t.price)}원 × ${dec(t.volume)}`, short(t.name || t.sid, 22), `수수료 ${E.won(t.fee)}`], at: t.at,
      detail: [{ kind: '체결', text: [HOW[t.how], t.slip_pct != null ? `신호가 대비 ${E.pct(t.slip_pct)}` : '', t.why, ...(t.notes || []), (t.uuids || []).length ? `주문 ${t.uuids.join(', ')}` : ''].filter(Boolean).join(' · ') }] } });
  }
  for (const s of db.skipped.slice(-50)) rows.push({ at: s.at, item: { id: `s-${s.at}-${s.sid}-${s.market}`, title: `${s.side === 'bid' ? '사지 않음' : '팔지 못함'} ${E.coinOf(s.market)}`, tags: [MODE_LABEL[s.mode], '건너뜀'], meta: [E.kst(s.at), short(s.name || s.sid, 22)], at: s.at, detail: [{ kind: '이유', text: s.reason }] } });
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { items: rows.slice(0, 150).map(r => r.item), note: db.trades.length ? `거래 ${db.trades.length}건` : '' };
}
const VERDICT = { pass: '검증 통과', partial: '검증 부분 통과', added: '직접 고른 전략' };
function strategies(){
  const db = load(), on = new Set(ACTIVE);
  const items = STRATEGIES.map(s => {
    const held = Object.values(db.positions).filter(p => p.sid === s.id).length, st = s.stats || {};
    const conds = s.members ? s.members.map(m => `${m.name}`).join(s.mode === 'and' ? ' 그리고 ' : ' 또는 ') : '';
    return { id: s.id, title: s.name, tags: [on.has(s.id) ? '켜짐' : '꺼짐', ...(s.score != null ? [`${s.grade} · ${Math.round(s.score)}점`] : [])],
      meta: [E.INTERVALS[s.interval].label, VERDICT[s.verdict] || s.verdict, st.expectancyPct != null ? `거래당 ${E.pct(st.expectancyPct)} (${st.n}건)` : '', held ? `보유 ${held}개` : ''].filter(Boolean),
      detail: [{ who: '어떤 전략', text: `${s.idea}${conds && !s.idea.includes(conds) ? ` (${conds})` : ''}` },
        { who: '백테스트', text: st.n == null ? '등록부에 백테스트 숫자가 없어요. 지표 백테스터에서 직접 확인해 주세요' : `${s.verdict === 'added' ? `표본 외 검증의 판정·점수는 없어요(${s.stats_from || '직접 더함'}에서 가져온 숫자). ` : ''}선정에 쓰지 않은 코인 10종목에서 ${st.n}건, 거래당 평균 ${E.pct(st.expectancyPct)}, 평균 보유 ${Number(st.avgDaysHeld).toFixed(1)}일, 평균 최대 낙폭 ${Number(st.avgMddPct).toFixed(1)}% (수수료 ${META.costs.feeBps}bp + 슬리피지 ${META.costs.slippageBps}bp 가정, ${String(META.generatedAt).slice(0, 10)} 기준). 지난 숫자예요 — 앞으로의 수익을 보장하지 않아요` },
        { who: '출처', text: s.source }],
      vars: { sid: s.id } };
  });
  return { items, note: `켜 둔 전략 ${on.size}개 · 등록 ${STRATEGIES.length}개(지표 백테스터 코인 리서치 ${String(META.generatedAt).slice(0, 10)})` };
}
/* 감시 중 — "지금 무엇을 기다리고, 왜 아직 아닌가"에 답한다: 코인마다 지금 값, 조건이 되는 값, 거기까지 남은 폭. 그래프는 최근 종가와 조건 선 */
const MARKS = '①②③④⑤';
async function watch(){
  const db = load(), pairs = [], rows = [];
  for (const sid of ACTIVE) for (const market of MARKETS) pairs.push({ sid, market, pos: db.positions[keyOf(MODE, sid, market)] || null });
  for (const pos of Object.values(db.positions)) if (!pairs.some(x => x.pos === pos)) pairs.push({ sid: pos.sid, market: pos.market, pos });   // 꺼 둔 전략·다른 모드로 들고 있는 것
  let base = null; const warn = [];
  for (const { sid, market, pos } of pairs){
    const entry = REG.get(sid); if (!entry) continue;
    try {
      const bars = await barsOf(market, entry.interval), w = E.watchOf(bars, entry), name = await coinName(market), step = STEP_SEC[entry.interval], iv = E.INTERVALS[entry.interval].label;
      base ||= { iv, close: (w.bar + step) * 1000, next: (w.bar + 2 * step) * 1000 };
      // own 들고 있다 · fresh 방금 매수 신호가 났다(위 '신호' 목록에 있다) · missed 신호가 났지만 사지 않고 지나갔다 · flat 신호를 기다린다
      const live = w.hold && w.fresh && lateSec(w, entry.interval) <= step * LATE && !db.skips[`${keyOf(MODE, sid, market)}|${w.bar}`];
      const state = pos ? 'own' : live ? 'fresh' : w.hold ? 'missed' : 'flat', verb = { own: '팔아요', fresh: '구간이 끝나요', missed: '구간이 끝나요', flat: '사요' }[state];
      const conds = w.wait.flatMap(p => p.conds), n = conds.length;
      const line = (c, i) => { const m = n > 1 ? `${MARKS[i] || '·'} ` : '';
        if (c.kind === 'level') return c.met ? `${m}${c.name}(${E.priceText(c.target)}원) ${c.above ? '위' : '아래'}에 이미 있어요${c.cross ? ' — 돌아왔다가 다시 넘어야 해요' : ''}`
          : `${m}${E.pct(c.gap_pct, 1)} ${c.above ? '오르면' : '내리면'} ${verb} (${E.priceText(c.target)}원 · ${c.name})`;
        const f = v => Number(v).toFixed(Math.abs(v) < 10 ? 2 : 1);
        return c.met ? `${m}${c.name} 조건은 이미 맞았어요(지금 ${f(c.now)})` : `${m}${c.name} 지금 ${f(c.now)} → ${f(c.target)} ${c.above ? '위로 올라가면' : '아래로 내려가면'} ${verb}`; };
      const how = n <= 1 ? '아래가 되면' : w.need === 'all' || (w.wait.length === 1 && w.wait[0].logic === 'all') ? '아래가 모두 되면' : w.wait.every(p => p.conds.length <= 1 || p.logic === 'any') ? '아래 중 하나가 되면' : '아래 조건이 맞으면';
      const cur = `지금 ${E.priceText(w.close)}원`;
      const pnl = pos ? (w.close * pos.volume * (1 - FEE) - pos.cost) / pos.cost * 100 : null;
      const head = state === 'own' ? `${cur} · ${E.priceText(pos.price)}원에 샀어요 · ${how} ${verb}`
        : state === 'missed' ? `${cur} · ${how} ${verb}. 그 뒤 새 신호부터 사요` : state === 'fresh' ? `${cur} · 위 '신호' 목록에 올라왔어요. 자동 시작이 켜져 있으면 곧 주문해요` : `${cur} · ${how} ${verb}`;
      // 지난 신호를 사지 않은 이유 — 건너뛴 기록이 있으면 그 이유, 없으면 그때 주문 단계가 돌지 않은 것
      const why = state === 'missed' ? ((db.skipped.find(s => s.sid === sid && s.market === market && s.bar === w.since && s.mode === MODE) || {}).reason || '그때 자동 시작이 꺼져 있었거나 이 컴퓨터가 확인하지 못했어요') : '';
      const N = 72, off = Math.max(0, bars.length - N), levels = conds.map((c, i) => ({ c, i })).filter(x => x.c.kind === 'level').slice(0, 3);
      const near = Math.min(...conds.filter(c => c.kind === 'level' && !c.met).map(c => Math.abs(c.gap_pct)), Infinity);
      rows.push({ rank: { fresh: 0, own: 1 }[state] ?? 2, near, item: {
        id: `w|${pos ? pos.mode : MODE}|${sid}|${market}`, at: new Date((w.bar + step) * 1000).toISOString(),
        title: state === 'own' ? `${name} · 들고 있어요 ${E.pct(pnl)}` : state === 'fresh' ? `${name} · 방금 매수 신호가 났어요` : state === 'missed' ? `${name} · 지난 매수 신호는 지나갔어요` : `${name} · 매수 신호를 기다려요`,
        tags: [MODE_LABEL[pos ? pos.mode : MODE], ...(ACTIVE.length > 1 || !ACTIVE.includes(sid) ? [short(nameOf(sid), 24)] : [])],
        meta: [head, ...(state === 'fresh' ? [`조건: ${w.reason}`] : conds.slice(0, 3).map(line))],
        detail: why ? [{ kind: '사지 않은 이유', text: `${w.since != null ? `${E.kst((w.since + step) * 1000)} 신호(${E.priceText(w.price)}원): ` : ''}${why}` }] : [],
        chart: { label: `${name} ${iv} 종가`, unit: '원', zero: false, points: bars.slice(off).map(b => ({ t: new Date((b.t + step) * 1000).toISOString(), v: b.c })),
          lines: levels.map(({ c, i }) => ({ label: `${n > 1 ? `${MARKS[i] || '·'} ` : ''}${c.name}`, values: c.values.slice(off) })) } } });
    } catch (e) { warn.push(`${E.coinOf(market)}: ${e.message}`); }
  }
  rows.sort((a, b) => a.rank - b.rank || a.near - b.near);
  const note = !pairs.length ? "켜 둔 전략이 없어요. '전략' 탭에서 켜 주세요" : base ? `${base.iv} ${E.kst(base.close)} 마감 기준 · 다음 봉은 ${E.kst(base.next, false)}에 닫히고, 닫힌 뒤 5분 안에 확인해요${warn.length ? ` · 확인 못 한 것: ${warn[0]}` : ''}` : (warn[0] || '');
  return { items: rows.map(r => r.item), note };
}
const account = () => ({ items: [{ id: 'doctor', title: '업비트 연결 확인', meta: [up.hasKeys ? '키 권한(자산조회·주문조회·주문하기)과 허용 IP를 확인해요' : '설정에서 Access key와 Secret key를 먼저 넣어 주세요', '실제 주문은 넣지 않아요'], vars: {} }] });

/* ---------- 워크플로우 ---------- */
const out = (title, text, extra = {}) => ({ summary: title, verdict: { tone: 'ok', title, text }, pid: '', ...extra });
async function order(){
  const side = args.side, sid = String(args.sid || ''), market = String(args.market || ''), bar = Number(args.bar), mode = side === 'ask' && ['live', 'paper'].includes(args.mode) ? args.mode : MODE;
  if (!['bid', 'ask'].includes(side) || !/^KRW-[A-Z0-9]{1,15}$/.test(market) || !sid) fail('주문할 항목을 읽지 못했어요');
  const key = keyOf(mode, sid, market), entry = REG.get(sid), coin = await coinName(market);
  await reconcile(key);   // 같은 자리의 끝맺지 못한 주문부터 정리한다(두 번 사지 않게)
  const db = load(), pos = db.positions[key], p0 = { side, sid, market, mode, bar };
  const pass = (title, reason, record) => { if (record) withLedger(d => skip(d, p0, reason)); return out(title, reason, record ? REFRESH : {}); };
  let p;
  if (side === 'bid'){
    if (!entry || !ACTIVE.includes(sid)) return pass('사지 않았어요', '전략이 꺼져 있어요');
    if (pos) return pass('사지 않았어요', '이미 들고 있어요');
    const count = Object.values(db.positions).filter(x => x.mode === mode).length;
    if (count >= MAX_POS) return pass('사지 않았어요', `동시에 가질 수 있는 수(${MAX_POS}개)를 채웠어요`, true);
    const size = sizing(db, mode); let krw = size.krw;
    if (!size.compound && krw < E.MIN_ORDER) fail('한 번에 살 금액이 업비트 최소 주문 금액(5,000원)보다 적어요. 설정에서 고쳐 주세요');
    if (size.compound && krw < E.MIN_ORDER) return pass('사지 않았어요', `굴릴 돈이 모자라요 — 지금 굴리는 돈 ${E.won(size.equity)} 중 남은 것이 ${E.won(size.free)}이에요(최소 주문 5,000원)`, true);
    const d = E.desired(await barsOf(market, entry.interval), entry);
    if (!(d.hold && d.fresh && d.bar === bar)) return pass('사지 않았어요', '신호가 지나갔어요 — 다음 봉이 닫혔거나 조건이 풀렸어요');
    if (lateSec(d, entry.interval) > STEP_SEC[entry.interval] * LATE) return pass('사지 않았어요', `신호가 난 지 ${Math.round(lateSec(d, entry.interval) / 60)}분이 지나 사지 않았어요`, true);
    const { ask } = await bestOf(market), tick = await tickOf(market);
    if (E.overCap(ask, d.price, SLIP, tick)) return pass('사지 않았어요', `값이 신호가(${E.priceText(d.price)}원)보다 ${E.pct((ask / d.price - 1) * 100)} 올라 사지 않았어요(${slipText(d.price, tick)})`, true);
    if (mode === 'live'){
      const have = Number(((await up.accounts()).find(a => a.currency === 'KRW') || {}).balance || 0), can = Math.floor(have / (1 + FEE));
      // 복리로 굴릴 때는 계좌 원화가 조금 모자라면 있는 만큼만 산다(절반도 안 되면 사지 않는다). 금액을 정해 둔 때는 그 금액이 안 되면 사지 않는다
      if (can < krw && !(size.compound && can >= krw / 2 && can >= E.MIN_ORDER)) return pass('사지 않았어요', `원화가 모자라요(주문 가능 ${E.won(have)}, 필요 ${E.won(krw * (1 + FEE))})`, true);
      krw = Math.min(krw, can);
    }
    p = { ...p0, price: ask, volume: E.floor8(krw / ask), krw, signal_price: d.price, why: d.reason, interval: entry.interval };
  } else {
    if (!pos) return out('팔 것이 없어요', '이미 정리됐어요');
    const cur = (await priceMap([market]))[market];
    const d = entry ? E.desired(await barsOf(market, entry.interval), entry) : { ready: true, hold: false };
    const why = exitOf(pos, entry, d, cur);
    if (!why) return out('팔지 않았어요', '매도 조건이 풀렸어요');
    p = await sellPlan(pos, p0, why); if (p.done) return p.done;
  }
  return place(p, coin);
}
/* 팔 수량과 값 — 실제 계좌에 그만큼 없으면(직접 팔았다) 있는 만큼만. 최소 주문 금액보다 적으면 자동으로는 못 판다 */
async function sellPlan(pos, p0, why){
  const { bid } = await bestOf(pos.market), key = keyOf(pos.mode, pos.sid, pos.market);
  let volume = pos.volume;
  if (pos.mode === 'live'){
    const have = Number(((await up.accounts()).find(a => a.currency === E.coinOf(pos.market)) || {}).balance || 0);
    if (have < volume * 0.999) volume = E.floor8(have);
    if (volume * bid < 1){ withLedger(d => { delete d.positions[key]; d.skipped.push({ at: AT, side: 'ask', sid: pos.sid, name: nameOf(pos.sid), market: pos.market, mode: pos.mode, bar: p0.bar, reason: '업비트에 이 코인이 없어 장부에서만 정리했어요(직접 파신 것으로 봐요)' }); });
      return { done: out('장부에서 정리했어요', '업비트에 이 코인이 없어요. 직접 파신 것으로 보고 장부에서만 뺐어요') }; }
  }
  if (volume * bid < E.MIN_ORDER){ withLedger(d => { if (d.positions[key]) d.positions[key].stuck = 'min'; });
    return { done: { summary: '팔지 못했어요', pid: '', verdict: { tone: 'bad', title: '팔지 못했어요', text: `평가액(${E.won(volume * bid)})이 최소 주문 금액(5,000원)보다 적어요. 업비트에서 직접 정리해 주세요` } } }; }
  return { ...p0, price: bid, volume, signal_price: null, why, interval: pos.interval };
}
/* 장부에 먼저 적고 주문을 넣는다 — 주문이 들어갔는지 모르게 끊겨도 identifier(pid)로 다시 찾을 수 있게 */
async function place(p, coin){
  p.pid = `q${crypto.randomBytes(8).toString('hex')}`; p.at = AT; p.uuid = null;
  withLedger(d => { d.pending[p.pid] = p; });
  if (p.mode === 'live'){
    const body = p.immediate ? { market: p.market, side: 'ask', ord_type: 'market', volume: dec(p.volume), identifier: p.pid }
      : { market: p.market, side: p.side, ord_type: 'limit', price: dec(p.price), volume: dec(p.volume), identifier: p.pid };
    try { const o = await up.order(body); withLedger(d => { if (d.pending[p.pid]) d.pending[p.pid].uuid = o.uuid; }); p.uuid = o.uuid; }
    catch (e) {
      if (e.unsure) fail('주문이 들어갔는지 확인하지 못했어요. 다음 확인 때 업비트에서 찾아 정리해요');
      withLedger(d => { delete d.pending[p.pid]; if (p.side === 'bid') skip(d, p, e.message); });
      if (p.side === 'bid' && ['insufficient_funds_bid', 'under_min_total_bid', 'market_offline'].includes(e.code)) return out('사지 않았어요', e.message);
      fail(e.message);
    }
  }
  const what = p.immediate ? '시장가 매도' : `지정가 ${p.side === 'bid' ? '매수' : '매도'}`;
  return { summary: `${p.mode === 'paper' ? '(모의) ' : ''}${coin} ${what} 주문 · ${E.priceText(p.price)}원 × ${dec(p.volume)}개`, pid: p.pid };
}
async function settle(){
  const pid = String(args.pid || ''), db = load(), p = db.pending[pid];
  if (!p){   // 이미 끝낸 주문 — 같은 결과를 다시 보인다
    const t = db.trades.find(x => x.id === pid);
    return t ? report({ trade: t, coin: await coinName(t.market) }) : { summary: '확인할 주문이 없어요', verdict: { tone: 'ok', title: '확인할 주문이 없어요', text: '이미 정리됐어요' } };
  }
  const r = await finish(p, { wait: WAIT, chase: true });
  if (r.trade) r.coin = await coinName(r.trade.market);
  return report(r);
}
async function sellNow(){
  const mode = args.mode, sid = String(args.sid || ''), market = String(args.market || ''), key = keyOf(mode, sid, market);
  await reconcile(key);
  const pos = load().positions[key], coin = await coinName(market);
  if (!pos) return { summary: '팔 것이 없어요', verdict: { tone: 'ok', title: '팔 것이 없어요', text: '이미 정리됐어요' } };
  if (args.answer !== 'sell'){
    if (args.answer === 'keep') return { summary: '그대로 뒀어요', verdict: { tone: 'ok', title: '그대로 뒀어요', text: '매도 조건이 오면 팔아요' } };
    const cur = (await priceMap([market]))[market], pnl = cur != null ? cur * pos.volume * (1 - FEE) - pos.cost : null;
    return { summary: '팔지 확인', ask: { question: `${coin}을 지금 시장가로 팔까요?${pnl != null ? ` 지금 팔면 약 ${E.signed(pnl)} (${E.pct(pnl / pos.cost * 100)})` : ''}`, inline: true,
      choices: [{ value: 'sell', label: '지금 팔기', confirm: `${coin} ${dec(pos.volume)}개를 ${pos.mode === 'live' ? '실제로 ' : '모의로 '}시장가에 팔아요. 되돌릴 수 없어요` }, { value: 'keep', label: '그대로 두기' }] } };
  }
  const plan = await sellPlan(pos, { side: 'ask', sid, market, mode, bar: Math.floor(NOW_SEC / 60) * 60 }, '직접 지금 팔기'); if (plan.done) return plan.done;
  const placed = await place({ ...plan, immediate: true }, coin);
  const r = await finish(load().pending[placed.pid], { wait: 0, chase: false });
  r.coin = coin;
  return report(r);
}
function toggle(){
  const sid = String(args.sid || ''), s = REG.get(sid);
  if (!s) fail('등록부에 없는 전략이에요');
  const on = ACTIVE.includes(sid), next = on ? ACTIVE.filter(x => x !== sid) : [...ACTIVE, sid];
  const held = Object.values(load().positions).filter(p => p.sid === sid).length;
  const title = on ? '껐어요' : '켰어요', text = on ? (held ? `새로 사지 않아요. 들고 있는 ${held}개는 매도 조건이 오면 팔아요` : '이 전략으로 새로 사지 않아요') : `${E.INTERVALS[s.interval].label}이 닫힐 때마다 코인 ${MARKETS.length}개에서 조건을 봐요`;
  return { summary: `${s.name} ${title}`, settings_patch: { strategies: next.join(', ') }, verdict: { tone: 'ok', title: `${s.name} — ${title}`, text }, outcome: { title, text: '' } };
}
async function doctor(){
  const finds = [], add = (ok, where, title, text) => finds.push({ where, tag: ok ? '' : '안 됨', note: ok ? '됨' : '', title, text });
  let bad = 0;
  try { const t = await up.ticker(['KRW-BTC']); add(true, '시세', '업비트에 닿아요', `비트코인 지금 ${E.priceText(t[0].trade_price)}원`); }
  catch (e) { bad++; add(false, '시세', '업비트에 닿지 않아요', e.message); }
  if (!up.hasKeys){ bad++; add(false, '계정 정보', 'Access key와 Secret key가 없어요', '준비와 설정에서 넣어 주세요. 모의 거래는 키 없이도 돼요'); }
  else {
    const tryIt = async (where, okTitle, f) => { try { add(true, where, okTitle, await f()); } catch (e) { bad++; add(false, where, `${where} 권한을 확인하지 못했어요`, e.message); } };
    await tryIt('자산조회', '잔고를 볼 수 있어요', async () => `원화 주문 가능 ${E.won(Number(((await up.accounts()).find(a => a.currency === 'KRW') || {}).balance || 0))}`);
    await tryIt('주문조회', '주문 정보를 볼 수 있어요', async () => { const c = await up.chance('KRW-BTC'); return `수수료 매수 ${Number(c.bid_fee) * 100}% · 매도 ${Number(c.ask_fee) * 100}% · 최소 주문 ${E.won(Number(c.market.bid.min_total))}`; });
    await tryIt('주문하기', '주문을 넣을 수 있어요', async () => {   // 업비트의 주문 검사(/v1/orders/test) — 실제 주문은 만들어지지 않는다
      try { await up.orderTest({ market: 'KRW-BTC', side: 'bid', ord_type: 'price', price: '5000' }); return '주문 검사만 했어요. 실제 주문은 넣지 않았어요'; }
      catch (e) { if (e.code === 'insufficient_funds_bid') return '주문 권한은 있어요. 원화가 5,000원보다 적어요'; throw e; } });
  }
  const title = bad ? `확인할 것이 ${bad}개 있어요` : LIVE ? '연결됐어요 — 실제 주문을 넣을 수 있어요' : '연결됐어요';
  return { summary: title, verdict: { tone: bad ? 'bad' : 'ok', title, text: LIVE ? "'실제 돈으로 사기'가 켜져 있어요" : "지금은 모의 거래예요. 실제로 사려면 설정에서 '실제 돈으로 사기'를 켜요" }, findings: finds };
}

const CMD = { signals, watch, status, positions, trades, strategies, account, order, settle, 'sell-now': sellNow, toggle, doctor };
async function main(){
  if (!fs.existsSync(path.join(profile, '_설정.md'))) return { error: `프로필 폴더를 찾지 못했어요: ${profile}` };
  const f = CMD[process.argv[2]];
  up = client({ access: process.env.UPBIT_ACCESS_KEY || '', secret: process.env.UPBIT_SECRET_KEY || '', base: args.api || API });
  return f ? await f() : { error: `모르는 명령이에요: ${process.argv[2]}` };
}
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))){
  let r, code = 0;
  try { r = await main(); if (r && r.error) code = 1; } catch (e) { code = 1; r = { error: e.user ? e.message : `처리하다 문제가 생겼어요(${e.message}). 이 단계를 다시 해 주세요` }; }
  // 주문·체결 단계가 멈추면 알린다 — 돈이 걸린 일이 조용히 멈춰 있지 않게
  if (r.error && ['order', 'settle', 'sell-now'].includes(process.argv[2])) r.notify = { title: [E.coinOf(args.market || ''), { bid: '매수', ask: '매도' }[args.side] || '', '주문이 멈췄어요'].filter(Boolean).join(' '), text: r.error };
  process.stdout.write(JSON.stringify(r) + '\n');
  process.exitCode = code;
}
