// 지표 백테스터(junhosoft/stock-backtest)의 server/indicators.js를 그대로 옮긴 것 — 실거래 신호가 백테스트와 같은 숫자로 계산되게 고치지 않는다.
// 백테스터 쪽이 바뀌면 pkm-app의 scripts/upbit-strategies.mjs가 이 파일도 다시 옮긴다.
// 지표 계산. 모든 결과는 봉 배열과 같은 길이이고, 값이 정해지기 전 구간은 null.
// 지표 스펙: { type, ...params, output? }  예) { type: "rsi", period: 14 }

export const INDICATORS = {
  price: { label: "종가", overlay: true, params: {} },
  rsi: { label: "RSI", overlay: false, params: { period: 14 } },
  sma: { label: "SMA", overlay: true, params: { period: 20 } },
  ema: { label: "EMA", overlay: true, params: { period: 20 } },
  macd: {
    label: "MACD",
    overlay: false,
    params: { fast: 12, slow: 26, signal: 9 },
    outputs: ["macd", "signal", "hist"],
  },
  bb: {
    label: "볼린저밴드",
    overlay: true,
    params: { period: 20, mult: 2 },
    outputs: ["upper", "middle", "lower", "percentB"],
  },
  stoch: { label: "스토캐스틱", overlay: false, params: { k: 14, d: 3 }, outputs: ["k", "d"] },
  willr: { label: "Williams %R", overlay: false, params: { period: 14 } },
  cci: { label: "CCI", overlay: false, params: { period: 20 } },
  roc: { label: "ROC(%)", overlay: false, params: { period: 12 } },
  adx: { label: "ADX", overlay: false, params: { period: 14 }, outputs: ["adx", "plusDI", "minusDI"] },
  // 직전 N봉(현재 봉 제외)의 최고가·최저가 — 현재 종가가 이를 넘으면 신고가 돌파
  donchian: { label: "돈치안채널", overlay: true, params: { period: 20 }, outputs: ["upper", "lower", "middle"] },
  keltner: { label: "켈트너채널", overlay: true, params: { period: 20, mult: 2 }, outputs: ["upper", "middle", "lower"] },
  atr: { label: "ATR", overlay: false, params: { period: 14 } },
  ibs: { label: "IBS", overlay: false, params: {} },
  mfi: { label: "MFI", overlay: false, params: { period: 14 } },
  obv: { label: "OBV", overlay: false, params: { period: 20 }, outputs: ["obv", "ma"] },
  disparity: { label: "이격도", overlay: false, params: { period: 20 } },
};

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) { sum = 0; count = 0; continue; }
    sum += v; count++;
    if (count > period) sum -= values[i - period];
    if (count >= period) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null, seed = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      seed.push(v);
      if (seed.length === period) prev = seed.reduce((a, b) => a + b, 0) / period;
      else continue;
    } else prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Wilder 방식 RSI
export function rsi(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  const val = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = val();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = val();
  }
  return out;
}

// Wilder 평활(RMA): 첫 값은 단순평균, 이후 (prev*(n-1)+v)/n
function rma(values, period) {
  const out = new Array(values.length).fill(null);
  let prev = null, seed = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      seed.push(v);
      if (seed.length < period) continue;
      prev = seed.reduce((a, b) => a + b, 0) / period;
    } else prev = (prev * (period - 1) + v) / period;
    out[i] = prev;
  }
  return out;
}

function trueRange(bars) {
  return bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
}

function rolling(bars, period, i, pick, cmp) {
  let best = pick(bars[i - period + 1]);
  for (let j = i - period + 2; j <= i; j++) best = cmp(best, pick(bars[j]));
  return best;
}

function stdev(values, period, means) {
  return values.map((_, i) => {
    if (means[i] == null) return null;
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (values[j] - means[i]) ** 2;
    return Math.sqrt(s / period);
  });
}

export function computeIndicator(spec, bars) {
  const def = INDICATORS[spec.type];
  if (!def) throw new Error(`알 수 없는 지표: ${spec.type}`);
  const p = { ...def.params, ...spec };
  for (const k of Object.keys(def.params)) {
    if (!(Number(p[k]) > 0)) throw new Error(`${def.label} ${k} 값이 올바르지 않습니다`);
    p[k] = Number(p[k]);
  }
  const c = bars.map((b) => b.c);

  switch (spec.type) {
    case "price": return { value: c };
    case "rsi": return { value: rsi(c, p.period) };
    case "sma": return { value: sma(c, p.period) };
    case "ema": return { value: ema(c, p.period) };
    case "macd": {
      const f = ema(c, p.fast), s = ema(c, p.slow);
      const line = c.map((_, i) => (f[i] == null || s[i] == null ? null : f[i] - s[i]));
      const sig = ema(line, p.signal);
      return { macd: line, signal: sig, hist: line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i])) };
    }
    case "bb": {
      const mid = sma(c, p.period), sd = stdev(c, p.period, mid);
      const upper = mid.map((m, i) => (m == null ? null : m + p.mult * sd[i]));
      const lower = mid.map((m, i) => (m == null ? null : m - p.mult * sd[i]));
      const percentB = c.map((v, i) => (upper[i] == null || upper[i] === lower[i] ? null : (v - lower[i]) / (upper[i] - lower[i])));
      return { upper, middle: mid, lower, percentB };
    }
    case "stoch": {
      const k = bars.map((_, i) => {
        if (i < p.k - 1) return null;
        let hi = -Infinity, lo = Infinity;
        for (let j = i - p.k + 1; j <= i; j++) { hi = Math.max(hi, bars[j].h); lo = Math.min(lo, bars[j].l); }
        return hi === lo ? 50 : ((bars[i].c - lo) / (hi - lo)) * 100;
      });
      return { k, d: sma(k, p.d) };
    }
    case "willr": return {
      value: bars.map((b, i) => {
        if (i < p.period - 1) return null;
        const hi = rolling(bars, p.period, i, (x) => x.h, Math.max), lo = rolling(bars, p.period, i, (x) => x.l, Math.min);
        return hi === lo ? -50 : ((hi - b.c) / (hi - lo)) * -100;
      }),
    };
    case "cci": {
      const tp = bars.map((b) => (b.h + b.l + b.c) / 3), m = sma(tp, p.period);
      return {
        value: tp.map((v, i) => {
          if (m[i] == null) return null;
          let md = 0;
          for (let j = i - p.period + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]);
          md /= p.period;
          return md === 0 ? 0 : (v - m[i]) / (0.015 * md);
        }),
      };
    }
    case "roc": return { value: c.map((v, i) => (i < p.period ? null : (v / c[i - p.period] - 1) * 100)) };
    case "atr": return { value: rma(trueRange(bars), p.period) };
    case "adx": {
      const plusDM = bars.map((b, i) => {
        if (i === 0) return 0;
        const up = b.h - bars[i - 1].h, down = bars[i - 1].l - b.l;
        return up > down && up > 0 ? up : 0;
      });
      const minusDM = bars.map((b, i) => {
        if (i === 0) return 0;
        const up = b.h - bars[i - 1].h, down = bars[i - 1].l - b.l;
        return down > up && down > 0 ? down : 0;
      });
      const tr = rma(trueRange(bars).slice(1), p.period);
      const pdm = rma(plusDM.slice(1), p.period), mdm = rma(minusDM.slice(1), p.period);
      const plusDI = [null], minusDI = [null], dx = [null];
      for (let i = 0; i < tr.length; i++) {
        const pd = tr[i] ? (pdm[i] / tr[i]) * 100 : null, md = tr[i] ? (mdm[i] / tr[i]) * 100 : null;
        plusDI.push(pd); minusDI.push(md);
        dx.push(pd == null || pd + md === 0 ? null : (Math.abs(pd - md) / (pd + md)) * 100);
      }
      return { adx: rma(dx, p.period), plusDI, minusDI };
    }
    case "donchian": {
      const upper = bars.map((_, i) => (i < p.period ? null : rolling(bars, p.period, i - 1, (x) => x.h, Math.max)));
      const lower = bars.map((_, i) => (i < p.period ? null : rolling(bars, p.period, i - 1, (x) => x.l, Math.min)));
      return { upper, lower, middle: upper.map((u, i) => (u == null ? null : (u + lower[i]) / 2)) };
    }
    case "keltner": {
      const mid = ema(c, p.period), atr = rma(trueRange(bars), p.period);
      return {
        upper: mid.map((m, i) => (m == null || atr[i] == null ? null : m + p.mult * atr[i])),
        middle: mid,
        lower: mid.map((m, i) => (m == null || atr[i] == null ? null : m - p.mult * atr[i])),
      };
    }
    case "ibs": return { value: bars.map((b) => (b.h === b.l ? null : (b.c - b.l) / (b.h - b.l))) };
    case "mfi": {
      const tp = bars.map((b) => (b.h + b.l + b.c) / 3);
      return {
        value: bars.map((_, i) => {
          if (i < p.period) return null;
          let pos = 0, neg = 0;
          for (let j = i - p.period + 1; j <= i; j++) {
            const flow = tp[j] * (bars[j].v || 0);
            if (tp[j] > tp[j - 1]) pos += flow; else if (tp[j] < tp[j - 1]) neg += flow;
          }
          if (pos + neg === 0) return null; // 거래량 정보가 없으면 판단하지 않는다
          return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
        }),
      };
    }
    case "obv": {
      let acc = 0;
      const obv = bars.map((b, i) => {
        if (i > 0) acc += b.c > bars[i - 1].c ? b.v || 0 : b.c < bars[i - 1].c ? -(b.v || 0) : 0;
        return acc;
      });
      return { obv, ma: sma(obv, p.period) };
    }
    case "disparity": {
      const m = sma(c, p.period);
      return { value: c.map((v, i) => (m[i] == null ? null : (v / m[i]) * 100)) };
    }
  }
}

export function specKey(spec) {
  const def = INDICATORS[spec.type];
  const params = Object.keys(def.params).map((k) => spec[k] ?? def.params[k]);
  return `${spec.type}(${params.join(",")})`;
}

export function specLabel(spec) {
  const def = INDICATORS[spec.type];
  const params = Object.keys(def.params).map((k) => spec[k] ?? def.params[k]);
  const out = def.outputs ? `.${spec.output || def.outputs[0]}` : "";
  return `${def.label}${params.length ? `(${params.join(",")})` : ""}${out}`;
}

export function seriesOf(spec, computed) {
  const def = INDICATORS[spec.type];
  const key = def.outputs ? spec.output || def.outputs[0] : "value";
  const s = computed[key];
  if (!s) throw new Error(`${def.label}에 '${key}' 출력이 없습니다 (가능: ${def.outputs?.join(", ")})`);
  return s;
}
