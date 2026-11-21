// 업비트 퀀트 — 신호 엔진. 네트워크·파일을 쓰지 않는 순수 계산만 둔다(테스트하기 쉽게).
// 백테스터(stock-backtest/server/backtest.js)의 runBacktest·runCombo와 같은 규칙으로 "지금 들고 있어야 하나"를 구한다:
//   신호는 닫힌 봉의 종가로 판단하고, 체결은 다음 봉 시가 — 실거래에서는 '봉이 닫힌 직후 지금'이 그 다음 봉 시가다.
import { INDICATORS, computeIndicator, seriesOf, specKey, specLabel } from './indicators.mjs';

const OPS = {
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  crossBelow: (a, b, pa, pb) => pa >= pb && a < b,
  crossAbove: (a, b, pa, pb) => pa <= pb && a > b
};
const OP_LABELS = { '<': '<', '>': '>', crossBelow: '아래로 돌파', crossAbove: '위로 돌파' };
const isSpec = x => x && typeof x === 'object' && x.type;

export const INTERVALS = { '1h': { sec: 3600, label: '1시간봉', bars: 1000 }, '4h': { sec: 14400, label: '4시간봉', bars: 800 }, '1d': { sec: 86400, label: '1일봉', bars: 600 } };

function buildConditions(conds, bars, cache){
  const resolve = spec => {
    if (!INDICATORS[spec.type]) throw new Error(`알 수 없는 지표: ${spec.type}`);
    const key = specKey(spec);
    if (!cache.has(key)) cache.set(key, computeIndicator(spec, bars));
    return seriesOf(spec, cache.get(key));
  };
  return (conds || []).map(c => {
    if (!OPS[c.op]) throw new Error(`알 수 없는 비교 연산: ${c.op}`);
    const left = resolve(c.left), right = isSpec(c.right) ? resolve(c.right) : Number(c.right);
    if (!isSpec(c.right) && !Number.isFinite(right)) throw new Error('비교 값이 숫자가 아닙니다');
    const at = i => typeof right === 'number' ? right : right[i];
    const label = `${specLabel(c.left)} ${OP_LABELS[c.op]} ${isSpec(c.right) ? specLabel(c.right) : right}`;
    const test = i => {
      const a = left[i], b = at(i);
      if (a == null || b == null) return false;
      if (c.op.startsWith('cross')){
        if (i === 0) return false;
        const pa = left[i - 1], pb = at(i - 1);
        if (pa == null || pb == null) return false;
        return OPS[c.op](a, b, pa, pb);
      }
      return OPS[c.op](a, b);
    };
    return { label, test };
  });
}
const combine = (conds, logic) => !conds.length ? () => false : logic === 'or' ? i => conds.some(c => c.test(i)) : i => conds.every(c => c.test(i));

/* 전략 하나를 봉 처음부터 다시 돌려 본다. hold[i] = 봉 i가 닫힌 뒤(=봉 i+1 동안) 들고 있어야 하면 1.
   runBacktest의 루프와 같은 순서다: ① 앞 봉의 주문을 이 봉 시가에 체결 ② 손절·익절(봉 안 저가·고가, 둘 다 닿으면 손절) ③ 종가로 신호.
   why[i]는 그 봉에서 상태를 바꾼 이유(매수 조건 글, 'signal'·'maxBars'·'stopLoss'·'takeProfit'). */
export function replay(bars, strat, { noStops = false } = {}){
  const { buy = [], sell = [], buyLogic = 'and', sellLogic = 'and', maxBars = 0 } = strat;
  const stopLossPct = noStops ? 0 : Number(strat.stopLossPct) || 0, takeProfitPct = noStops ? 0 : Number(strat.takeProfitPct) || 0;
  if (!buy.length) throw new Error('매수 조건이 필요합니다');
  if (!sell.length && !(stopLossPct > 0) && !(takeProfitPct > 0) && !(maxBars > 0)) throw new Error('매도 조건, 손절/익절, 최대 보유 중 하나가 필요합니다');
  const cache = new Map(), buyC = buildConditions(buy, bars, cache), sellC = buildConditions(sell, bars, cache);
  const buyTest = combine(buyC, buyLogic), sellTest = combine(sellC, sellLogic);
  const hold = new Uint8Array(bars.length), why = new Array(bars.length).fill('');
  let pos = null, pending = null;
  for (let i = 0; i < bars.length; i++){
    const b = bars[i];
    if (pending){ pos = pending === 'buy' ? { entryIdx: i, entryPrice: b.o } : null; pending = null; }
    if (pos){
      const stop = stopLossPct > 0 ? pos.entryPrice * (1 - stopLossPct / 100) : null, take = takeProfitPct > 0 ? pos.entryPrice * (1 + takeProfitPct / 100) : null;
      if (stop != null && b.l <= stop){ pos = null; why[i] = 'stopLoss'; }
      else if (take != null && b.h >= take){ pos = null; why[i] = 'takeProfit'; }
    }
    const timeUp = pos && maxBars > 0 && i - pos.entryIdx + 1 >= maxBars;
    const buyNow = buyTest(i), sellNow = sellC.length && sellTest(i);
    if (!pos && buyNow){ pending = 'buy'; why[i] = buyC.filter(c => c.test(i)).map(c => c.label).join(' / '); }
    else if (pos && (sellNow || timeUp)){ pending = 'sell'; why[i] = sellNow ? 'signal' : 'maxBars'; }
    hold[i] = pending ? (pending === 'buy' ? 1 : 0) : pos ? 1 : 0;
  }
  return { hold, why, conditions: { buy: buyC.map(c => c.label), sell: sellC.map(c => c.label) } };
}

/* 등록된 전략(단일 또는 혼합)의 보유 상태. 혼합은 구성 전략을 각각 돌린 뒤(손절·익절 없이 — runCombo와 같다) 봉마다 합친다.
   and: 모두 보유 중일 때만 / or: 하나라도 보유 중이면 */
export function holdOf(bars, entry){
  if (entry.members){
    if (!['and', 'or'].includes(entry.mode)) throw new Error('혼합 방식은 and 또는 or');
    if (entry.members.length < 2) throw new Error('혼합하려면 전략이 2개 이상 필요합니다');
    const rs = entry.members.map(m => replay(bars, m.strategy, { noStops: true }));
    const hold = new Uint8Array(bars.length);
    for (let i = 0; i < bars.length; i++) hold[i] = (entry.mode === 'and' ? rs.every(r => r.hold[i]) : rs.some(r => r.hold[i])) ? 1 : 0;
    // 보유로 바뀐 이유 — 그 봉에서 보유인 구성 전략의 이름(방금 조건이 맞은 것은 그 조건도)
    const EXIT = ['signal', 'maxBars', 'stopLoss', 'takeProfit'];
    return { hold, why: i => !hold[i] ? '' : rs.map((r, j) => r.hold[i] ? `${entry.members[j].name || `전략 ${j + 1}`}${r.why[i] && !EXIT.includes(r.why[i]) ? `(${r.why[i]})` : ''}` : '').filter(Boolean).join(entry.mode === 'and' ? ' 그리고 ' : ' / '),
      conditions: { buy: rs.map(r => `(${r.conditions.buy.join(' & ')})`), sell: rs.map(r => `(${r.conditions.sell.join(' & ')})`) } };
  }
  const r = replay(bars, entry.strategy);
  return { hold: r.hold, why: i => r.why[i], conditions: r.conditions };
}

/* 닫힌 봉까지 보고 지금 상태를 정한다.
   hold: 지금 들고 있어야 하나 · fresh: 방금 닫힌 봉에서 바뀌었나(늦은 매수를 막는 데 쓴다) · since: 바뀐 봉의 시각 · price: 그 봉 종가(신호 가격) */
export function desired(bars, entry){
  const n = bars.length;
  if (n < 2) return { hold: false, fresh: false, since: null, price: null, reason: '', bar: n ? bars[n - 1].t : null, ready: false };
  const h = holdOf(bars, entry), last = n - 1;
  let k = last;
  while (k > 0 && h.hold[k - 1] === h.hold[last]) k--;
  const flipped = k > 0;   // 창 안에서 한 번도 안 바뀌었으면 창 앞의 상태를 모른다 — 보유로 나와도 '방금'이 아니다
  const w = h.why(k);
  return { hold: !!h.hold[last], fresh: flipped && k === last, since: flipped ? bars[k].t : null, price: bars[k].c, bar: bars[last].t,
    reason: h.hold[last] ? (w && !['signal', 'maxBars', 'stopLoss', 'takeProfit'].includes(w) ? w : h.conditions.buy.join(' & ')) : ({ maxBars: '최대 보유 봉 수를 채움', stopLoss: '손절선에 닿음', takeProfit: '익절선에 닿음' }[w] || h.conditions.sell.join(' & ') || '매도 조건'),
    ready: true };
}

/* ---------- 감시: 지금 무엇을 기다리고, 얼마나 남았나 ---------- */
// 조건 하나를 "값이 어느 선을 위로/아래로 넘으면"으로 푼다. 가격으로 바꿔 말할 수 있으면 level(그 선의 값들 — 그래프에 긋는다), 아니면 value(지표 숫자 그대로).
//   가격 vs 가격 위에 그리는 지표(켈트너 상단 등) → 그 지표가 선 · 이격도(n) vs k → n봉 평균의 k% · 볼린저 %B vs k → 하단 + k × (상단 − 하단)
const LEVEL_NAMES = {
  keltner: { upper: () => '켈트너 상단', middle: () => '켈트너 중심선', lower: () => '켈트너 하단' },
  bb: { upper: () => '볼린저 상단', middle: () => '볼린저 중심선', lower: () => '볼린저 하단' },
  donchian: { upper: p => `${p.period}봉 최고가`, lower: p => `${p.period}봉 최저가`, middle: p => `${p.period}봉 고저 중간` },
  sma: { value: p => `${p.period}봉 평균` }, ema: { value: p => `${p.period}봉 지수평균` }
};
const paramsOf = spec => ({ ...INDICATORS[spec.type].params, ...spec });
const outOf = spec => INDICATORS[spec.type].outputs ? spec.output || INDICATORS[spec.type].outputs[0] : 'value';
const levelName = spec => { const f = (LEVEL_NAMES[spec.type] || {})[outOf(spec)]; return f ? f(paramsOf(spec)) : specLabel(spec); };
const isLevel = spec => isSpec(spec) && spec.type !== 'price' && !!(LEVEL_NAMES[spec.type] || {})[outOf(spec)];
function condView(c, bars, cache){
  const series = spec => { const key = specKey(spec); if (!cache.has(key)) cache.set(key, computeIndicator(spec, bars)); return seriesOf(spec, cache.get(key)); };
  const last = bars.length - 1, close = bars[last].c, up = c.op === '>' || c.op === 'crossAbove', cross = c.op.startsWith('cross');
  const L = isSpec(c.left) ? series(c.left) : null, R = isSpec(c.right) ? series(c.right) : null, rNum = isSpec(c.right) ? null : Number(c.right);
  const a = L[last], b = R ? R[last] : rNum, met = a != null && b != null && (up ? a > b : a < b);
  let level = null;   // { name, values } — 가격이 넘어야 하는 선
  if (c.left.type === 'price' && isLevel(c.right)) level = { name: levelName(c.right), values: R, above: up };
  else if (isLevel(c.left) && isSpec(c.right) && c.right.type === 'price') level = { name: levelName(c.left), values: L, above: !up };
  else if (c.left.type === 'disparity' && rNum != null){ const m = series({ type: 'sma', period: paramsOf(c.left).period }); level = { name: rNum === 100 ? `${paramsOf(c.left).period}봉 평균` : `${paramsOf(c.left).period}봉 평균의 ${rNum}%`, values: m.map(v => v == null ? null : v * rNum / 100), above: up }; }
  else if (c.left.type === 'bb' && outOf(c.left) === 'percentB' && rNum != null){ const u = series({ ...c.left, output: 'upper' }), lo = series({ ...c.left, output: 'lower' });
    level = { name: rNum === 0 ? '볼린저 하단' : rNum === 1 ? '볼린저 상단' : rNum === 0.5 ? '볼린저 중심선' : `볼린저 %B ${rNum}`, values: u.map((v, i) => v == null ? null : lo[i] + rNum * (v - lo[i])), above: up }; }
  if (level && level.values[last] != null) return { kind: 'level', name: level.name, above: level.above, cross, met, now: close, target: level.values[last], gap_pct: (level.values[last] / close - 1) * 100, values: level.values };
  return { kind: 'value', name: specLabel(c.left), above: up, cross, met, now: a, target: b, target_name: R ? specLabel(c.right) : null };
}
/* 등록 전략 하나를 이 봉들로 본 지금 상태와, 상태가 바뀌려면 남은 조건.
   hold: 전략상 지금 들고 있는 구간인가 · parts: 구성 전략마다 { name, hold, conds } — 들고 있지 않으면 매수 조건, 들고 있으면 매도 조건
   need: 'any'(하나만 되면) | 'all'(모두 돼야) — 지금 상태가 바뀌려면 parts의 조건 중 얼마나 돼야 하나 · wait: 그 조건을 봐야 하는 parts */
export function watchOf(bars, entry){
  const d = desired(bars, entry), last = bars.length - 1;
  const members = entry.members ? entry.members.map(m => ({ name: m.name, strategy: m.strategy })) : [{ name: entry.name, strategy: entry.strategy }];
  const cache = new Map();
  const parts = members.map(m => { const r = replay(bars, m.strategy, { noStops: !!entry.members }), hold = !!r.hold[last], s = m.strategy;
    return { name: m.name, hold, logic: (hold ? s.sellLogic : s.buyLogic) === 'or' ? 'any' : 'all', conds: ((hold ? s.sell : s.buy) || []).map(c => condView(c, bars, cache)) }; });
  // 혼합: or는 하나라도 보유면 보유, and는 모두 보유여야 보유
  const or = !entry.members || entry.mode === 'or';
  const wait = d.hold ? parts.filter(p => p.hold) : parts.filter(p => !p.hold);
  const need = !entry.members ? 'any' : d.hold ? (or ? 'all' : 'any') : (or ? 'any' : 'all');
  return { ...d, close: bars[last].c, parts, wait, need };
}

// 등록 전략 검사 — 틀린 지표·연산이 있으면 던진다
export function checkEntry(entry){
  // id에는 쉼표·공백을 쓰지 않는다(설정에 쉼표로 나눠 적는다)
  if (!entry || !/^[a-z0-9][a-z0-9:+._-]{1,100}$/.test(String(entry.id || ''))) throw new Error(`전략 id가 맞지 않아요: ${entry && entry.id}`);
  if (!INTERVALS[entry.interval]) throw new Error(`${entry.id}: 봉 단위는 ${Object.keys(INTERVALS).join('·')} 중 하나`);
  const bars = Array.from({ length: 320 }, (_, i) => { const c = 100 + Math.sin(i / 7) * 10 + i * 0.05; return { t: i * 3600, o: c - 0.3, h: c + 1, l: c - 1, c, v: 10 + (i % 5) }; });
  holdOf(bars, entry);
  return true;
}

/* ---------- 돈 계산 ---------- */
// 주문 가격은 호가창의 값을 그대로 쓴다(호가 단위에 이미 맞는다) — 가격을 직접 계산해 넣지 않는다
export const floor8 = v => Math.floor(v * 1e8 + 1e-6) / 1e8;
export const MIN_ORDER = 5000;   // 원화 마켓 최소 주문 금액
/* 살 수 있는 가장 높은 값 — 신호가 + 허용 슬리피지와 신호가 + 호가 한 칸 중 큰 것(값이 싼 코인은 한 칸이 허용치보다 커서 한 칸만 올라도 못 사게 된다) */
export const buyCap = (signal, slipPct, tick = 0) => Math.max(signal * (1 + slipPct / 100), signal + (tick > 0 ? tick : 0));
export const overCap = (ask, signal, slipPct, tick = 0) => { const cap = buyCap(signal, slipPct, tick); return ask - cap > cap * 1e-9; };

/* 이번에 살 금액(수수료 빼고 코인에 들어가는 돈).
   굴릴 금액(budget)이 있으면 복리: 지금 굴리는 돈 = 굴릴 금액 + 지금까지 판 손익. 그 돈을 칸 수(maxPos)로 나눈 만큼씩 사되, 이미 들어가 있는 돈(deployed)을 뺀 남은 돈을 넘지 않는다.
   수수료까지 합쳐 한 칸을 넘지 않게 금액에서 수수료 몫을 뺀다 — 그래서 들어간 돈을 다 더해도 굴릴 금액 + 손익을 넘지 않는다.
   굴릴 금액이 없으면 한 번에 살 금액(orderKrw) 그대로(수수료는 그 위에 붙는다). */
export function sizeOf({ budget = 0, orderKrw = 0, maxPos = 1, realized = 0, deployed = 0, fee = 0.0005 }){
  if (!(budget > 0)) return { compound: false, krw: Math.floor(orderKrw), equity: orderKrw * maxPos, free: null };
  const equity = budget + realized, free = Math.max(0, equity - deployed);
  return { compound: true, krw: Math.max(0, Math.floor(Math.min(equity / maxPos, free) / (1 + fee))), equity, free };
}

/* 거래들을 '한 번 사고판 것'으로 묶는다(장부 순서 = 시간 순서). 같은 자리(모드·전략·코인)에서 매수가 열고, 더 사기는 합치고, 판 수량이 산 수량에 닿으면 닫는다.
   앞부분이 잘려 매수 없이 시작하는 매도는 그것만으로 닫힌 묶음. closed: 다 팔았나 */
export function tripsOf(trades){
  const open = new Map(), out = [];
  for (const t of trades){
    const k = `${t.mode}|${t.sid}|${t.market}`, v = Number(t.volume) || 0;
    let tr = open.get(k);
    if (!tr){ tr = { key: k, mode: t.mode, sid: t.sid, name: t.name, market: t.market, buys: [], sells: [], bought: 0, sold: 0, closed: false }; out.push(tr); if (t.side === 'bid') open.set(k, tr); }
    if (t.side === 'bid'){ tr.buys.push(t); tr.bought += v; }
    else { tr.sells.push(t); tr.sold += v; if (!tr.buys.length || tr.sold >= tr.bought * (1 - 1e-6)){ tr.closed = true; open.delete(k); } }
  }
  return out;
}
export const heldText = ms => { const m = Math.max(0, Math.round(ms / 60000)), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}일${h % 24 ? ` ${h % 24}시간` : ''}` : h ? `${h}시간${m % 60 && h < 6 ? ` ${m % 60}분` : ''}` : `${m}분`; };
/* 체결 묶음 → 평균가·수량·금액. fills: [{ price, volume, funds? }] */
export function fillOf(fills){
  const volume = fills.reduce((a, f) => a + Number(f.volume), 0), funds = fills.reduce((a, f) => a + (f.funds != null ? Number(f.funds) : Number(f.price) * Number(f.volume)), 0);
  return { volume, funds, price: volume > 0 ? funds / volume : 0 };
}

/* 끝난 거래(매도)들의 성과. trades: 장부의 거래 줄 */
export function statsOf(trades){
  const sells = trades.filter(t => t.side === 'ask' && t.ret_pct != null);
  const wins = sells.filter(t => t.pnl > 0);
  return { closed: sells.length, wins: wins.length, win_rate: sells.length ? wins.length / sells.length * 100 : null,
    avg_ret: sells.length ? sells.reduce((a, t) => a + t.ret_pct, 0) / sells.length : null, realized: sells.reduce((a, t) => a + (t.pnl || 0), 0),
    fees: trades.reduce((a, t) => a + (t.fee || 0), 0), fallbacks: trades.filter(t => /market/.test(t.how || '') && /limit/.test(t.how || '')).length };
}

/* 손익 곡선 줄이기 — 그래프는 120점까지만. 오래된 쪽을 하루 한 점으로 줄이고도 넘으면 고르게 솎는다(마지막 점은 남긴다) */
export function thin(points, max = 120){
  if (points.length <= max) return points;
  const day = t => String(t).slice(0, 10), out = [], cut = points.length - Math.floor(max / 2);
  for (let i = 0; i < points.length; i++){
    if (i >= cut || i === points.length - 1 || day(points[i].t) !== day(points[i + 1].t)) out.push(points[i]);
  }
  if (out.length <= max) return out;
  const step = (out.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => out[Math.round(i * step)]);
}

/* ---------- 글 ---------- */
export const won = n => `${n < 0 ? '-' : ''}${Math.round(Math.abs(n)).toLocaleString('ko-KR')}원`;
export const signed = n => `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.round(Math.abs(n)).toLocaleString('ko-KR')}원`;
export const pct = (n, d = 2) => n == null || !Number.isFinite(n) ? '-' : `${n > 0 ? '+' : ''}${n.toFixed(d)}%`;
/* 이름 + 을/를 — 받침이 있으면 을. 한글이 아니면(영문 코드) 을 */
export const eul = w => { const c = String(w).charCodeAt(String(w).length - 1); return `${w}${c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 === 0 ? '를' : '을'}`; };
/* 평단·수량 — 반올림하지 않고(업비트 앱과 같게) 1,000원 아래 평단은 소수 둘째 자리까지 */
const trim = (v, d) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d });
export const avgText = p => p >= 1000 ? trim(p, 0) : p >= 1 ? trim(p, 2) : Number(p).toPrecision(4);
export const qtyText = v => trim(v, v >= 1 ? 2 : 8);
export const priceText = p => p >= 100 ? Math.round(p).toLocaleString('ko-KR') : p >= 1 ? p.toFixed(2) : p.toPrecision(4);
export const kst = (t, withDate = true) => { const d = new Date(new Date(t).getTime() + 9 * 3600e3), p = n => String(n).padStart(2, '0'); return `${withDate ? `${d.getUTCMonth() + 1}/${d.getUTCDate()} ` : ''}${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
export const coinOf = market => String(market).replace(/^KRW-/, '');
