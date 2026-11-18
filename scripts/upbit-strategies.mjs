#!/usr/bin/env node
// 지표 백테스터(junhosoft/stock-backtest)의 코인 리서치 결과에서 업비트 퀀트 플러그인의 전략 등록부를 만든다.
//   node scripts/upbit-strategies.mjs [--from=<stock-backtest 폴더>] [--combos=5] [--min=60]
//   node scripts/upbit-strategies.mjs --add="or:keltner-breakout(period=20,mult=2.5)+disparity" --interval=1h     직접 고른 전략을 더한다(--remove=같은 표기 로 뺀다)
// 직접 더한 전략은 scripts/upbit-strategies.extra.json에 적혀서, 등록부를 다시 만들어도 남는다. 표기는 백테스터 주소의 combo= 값 그대로다:
//   "방식:전략+전략"(혼합) 또는 "전략"(단일), 전략 뒤 괄호는 그 전략 지표의 파라미터 덮어쓰기 — 백테스터의 parseMember·overrideParams와 같은 규칙.
// 읽는 것: research/report.coin.json(전략 정의·선정 점수) · research/validation.coin.json(표본 외 검증 판정) · server/indicators.js
// 쓰는 것: plugins/upbit-quant/scripts/strategies.mjs(등록부) · plugins/upbit-quant/scripts/indicators.mjs(지표 계산 사본)
// 고르는 기준: 표본 외 검증이 pass·partial이고 최종 점수(min 이상)가 되는 단일 전략 전부 + pass인 혼합 전략 중 최종 점수 상위 N개. 5분봉이 대표인 전략은 뺀다(플러그인이 5분마다 확인한다).
// 등록부는 플러그인이 승인받는 스크립트라, 다시 만들면 플러그인 버전을 올리고 다시 승인해야 돈다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.match(/^--([^=]+)=?([\s\S]*)$/)).filter(Boolean).map(m => [m[1], m[2]]));
const here = path.dirname(fileURLToPath(import.meta.url));
const FROM = path.resolve((args.from || '~/Documents/obsidian-sync/junhosoft/stock-backtest').replace(/^~/, os.homedir()));
const OUT = path.resolve(here, '..', 'plugins', 'upbit-quant', 'scripts');
const COMBOS = Number(args.combos ?? 5), MIN = Number(args.min ?? 60);
const EXTRA_FILE = path.join(here, 'upbit-strategies.extra.json');
const OK_IV = ['1h', '4h', '1d'];

const json = f => JSON.parse(fs.readFileSync(path.join(FROM, f), 'utf8'));
const report = json('research/report.coin.json'), validation = json('research/validation.coin.json');
const defs = new Map(report.strategies.map(s => [s.id, s]));
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o && o[k] != null).map(k => [k, o[k]]));
const strat = id => { const d = defs.get(id); if (!d) throw new Error(`리포트에 없는 전략: ${id}`); return pick(d.strategy, ['buy', 'sell', 'buyLogic', 'sellLogic', 'maxBars', 'stopLossPct', 'takeProfitPct']); };

function entry(c){
  const d = defs.get(c.id), base = {
    id: c.id, name: c.name, kind: c.kind, interval: c.is.interval,
    grade: c.is.grade, score: c.finalScore, verdict: c.verdict,
    // 표본 외 검증(선정에 안 쓴 10종목)의 숫자 — 선정 데이터의 숫자보다 덜 부풀려져 있다
    stats: pick(c.symbols, ['n', 'expectancyPct', 'edgePct', 'edgeTStat', 'avgDaysHeld', 'avgMddPct'])
  };
  if (c.kind === 'combo') return { ...base, mode: c.mode, members: c.members.map(id => ({ id, name: defs.get(id).name, strategy: strat(id) })),
    idea: `${c.members.map(id => defs.get(id).name).join(c.mode === 'and' ? ' 그리고 ' : ' 또는 ')} — ${c.mode === 'and' ? '모두 보유 신호일 때만 보유' : '하나라도 보유 신호면 보유'}`,
    source: [...new Set(c.members.map(id => defs.get(id).source))].join(' / ') };
  return { ...base, category: d.category, idea: d.idea, source: d.source, strategy: strat(c.id) };
}

/* ---------- 직접 더한 전략 ---------- */
// 백테스터(server/backtest.js)의 parseMember·overrideParams와 같은 규칙: 괄호 안 값은 그 전략의 지표 중 같은 이름의 파라미터를 가진 것 전부에 덮어쓴다
function parseMember(text){
  const m = /^([\w-]+)(?:\(([^()]*)\))?$/.exec(String(text).trim());
  if (!m) throw new Error(`구성 전략 표기가 올바르지 않아요: ${text}`);
  const params = {};
  for (const pair of (m[2] ?? '').split(',').filter(Boolean)){
    const [k, v] = pair.split('=').map(x => x.trim());
    if (!k || !(Number(v) > 0)) throw new Error(`파라미터는 이름=양수 꼴이어야 해요: ${pair}`);
    params[k] = Number(v);
  }
  return { id: m[1], params };
}
function overrideParams(strategy, params){
  if (!Object.keys(params).length) return strategy;
  let used = false;
  const spec = x => { if (!x || typeof x !== 'object' || !x.type) return x; const next = { ...x }; for (const [k, v] of Object.entries(params)) if (k in next && k !== 'type' && k !== 'output'){ next[k] = v; used = true; } return next; };
  const side = conds => (conds ?? []).map(c => ({ ...c, left: spec(c.left), right: spec(c.right) }));
  const out = { ...strategy, buy: side(strategy.buy), sell: side(strategy.sell) };
  if (!used) throw new Error(`이 전략에 없는 파라미터예요: ${Object.keys(params).join(', ')}`);
  return out;
}
const tune = (() => { try { return json('research/tune-keltner.coin.json'); } catch { return null; } })();
// 직접 더한 전략의 백테스트 숫자 — 표본 외 검증에 있으면 그것, 켈트너 파라미터 탐색에 같은 조합이 있으면 그것(다른 종목 숫자), 없으면 비워 둔다
function statsFor(spec, mode, members, interval){
  const plain = validation.candidates.find(c => c.id === spec && c.is.interval === interval);
  if (plain) return { from: '표본 외 검증', stats: pick(plain.symbols, ['n', 'expectancyPct', 'edgePct', 'edgeTStat', 'avgDaysHeld', 'avgMddPct']) };
  const kel = members.find(m => m.id === 'keltner-breakout'), rest = members.filter(m => m !== kel);
  if (tune && kel && rest.every(m => !Object.keys(m.params).length) && rest.length <= 1){
    const key = `${kel.params.period ?? tune.default.period}/${kel.params.mult ?? tune.default.mult}/${tune.default.exit}`;
    const o = rest.length ? ((tune.combos[interval] || []).find(r => r.variant === key && r.partner === rest[0].id && r.mode === mode) || {}).oos : ((tune.variants[key] || {}).oos || {})[interval];
    if (o && o.n) return { from: '켈트너 파라미터 탐색', stats: { n: o.n, expectancyPct: o.exp, edgePct: o.edge, edgeTStat: o.t, avgDaysHeld: o.days, avgMddPct: o.mdd } };
  }
  return { from: '', stats: {} };
}
function extraEntry({ spec, interval }){
  if (!OK_IV.includes(interval)) throw new Error(`${spec}: 봉 단위는 ${OK_IV.join('·')} 중 하나(--interval=1h)`);
  const [mode, body] = spec.includes(':') ? spec.split(':') : [null, spec];
  const members = body.split('+').map(parseMember);
  if (mode ? !['and', 'or'].includes(mode) || members.length < 2 : members.length !== 1) throw new Error(`${spec}: "and:a+b"·"or:a+b"(혼합) 또는 "a"(단일) 꼴이에요`);
  const label = m => `${defs.get(m.id).name}${Object.keys(m.params).length ? ` [${Object.entries(m.params).map(([k, v]) => `${k}=${v}`).join(', ')}]` : ''}`;   // 백테스터 화면과 같은 이름
  const tag = m => m.id + Object.entries(m.params).map(([k, v]) => `_${k}${v}`).join('');   // 쉼표·괄호 없는 id(설정에 쉼표로 적는다)
  for (const m of members) if (!defs.has(m.id)) throw new Error(`리포트에 없는 전략: ${m.id}`);
  const made = members.map(m => ({ id: tag(m), name: label(m), strategy: overrideParams(strat(m.id), m.params) }));
  const { from, stats } = statsFor(spec, mode, members, interval);
  const base = { id: `${mode ? `${mode}:` : ''}${made.map(m => m.id).join('+')}`, name: made.map(m => m.name).join(mode === 'and' ? ' ∧ ' : ' ∨ '), kind: mode ? 'combo' : 'single', interval,
    grade: null, score: null, verdict: 'added', spec, stats, stats_from: from, source: [...new Set(members.map(m => defs.get(m.id).source))].join(' / ') };
  return mode ? { ...base, mode, members: made, idea: `${made.map(m => m.name).join(mode === 'and' ? ' 그리고 ' : ' 또는 ')} — ${mode === 'and' ? '모두 보유 신호일 때만 보유' : '하나라도 보유 신호면 보유'}` }
    : { ...base, category: defs.get(members[0].id).category, idea: defs.get(members[0].id).idea, strategy: made[0].strategy };
}
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // 한국 날짜
let extra = (() => { try { return JSON.parse(fs.readFileSync(EXTRA_FILE, 'utf8')); } catch { return []; } })();
if (args.remove) extra = extra.filter(x => x.spec !== args.remove);
if (args.add){ extra = extra.filter(x => x.spec !== args.add); extra.push({ spec: args.add, interval: args.interval || '1h', added: today }); }
const added = extra.map(extraEntry);   // 틀린 표기는 여기서 던진다 — 파일에 적기 전에
if (args.add || args.remove) fs.writeFileSync(EXTRA_FILE, JSON.stringify(extra, null, 2) + '\n');

const cands = validation.candidates.filter(c => OK_IV.includes(c.is.interval));
const singles = cands.filter(c => c.kind === 'single' && ['pass', 'partial'].includes(c.verdict) && c.finalScore >= MIN);
const combos = cands.filter(c => c.kind === 'combo' && c.verdict === 'pass').sort((a, b) => b.finalScore - a.finalScore).slice(0, COMBOS);
const order = { added: 0, pass: 1, partial: 2 };
const list = [...added, ...[...singles, ...combos].map(entry).filter(e => !added.some(a => a.id === e.id))]
  .sort((a, b) => order[a.verdict] - order[b.verdict] || (b.score ?? 0) - (a.score ?? 0));
if (!list.length) throw new Error('고른 전략이 없어요. --min 을 낮추거나 --add 로 넣어 주세요');

const meta = { from: 'stock-backtest research/report.coin.json · validation.coin.json', generatedAt: validation.generatedAt, importedAt: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10),
  costs: report.costs, universe: report.symbols.map(s => s.symbol || s), rules: validation.rules, min: MIN };
const text = `// 업비트 퀀트 — 전략 등록부. 손으로 고치지 않는다: pkm-app의 scripts/upbit-strategies.mjs가 지표 백테스터의 코인 리서치 결과에서 만든다.
// 전략 꼴은 백테스터의 strategy 형식 그대로(buy·sell 조건)이고, 혼합 전략은 mode(and·or)와 members를 가진다.
// grade·score·verdict·stats는 백테스트 결과다(stats는 선정에 안 쓴 종목의 표본 외 숫자). 앞으로의 수익을 보장하지 않는다.
// verdict가 added인 것은 사람이 직접 더한 전략이다(scripts/upbit-strategies.extra.json) — 표본 외 검증의 판정·점수가 없고, spec은 백테스터 주소의 combo= 값이다.
export const META = ${JSON.stringify(meta, null, 2)};

export const STRATEGIES = ${JSON.stringify(list, null, 2)};
`;
fs.writeFileSync(path.join(OUT, 'strategies.mjs'), text);
const HEAD = '// 지표 백테스터(junhosoft/stock-backtest)의 server/indicators.js를 그대로 옮긴 것 — 실거래 신호가 백테스트와 같은 숫자로 계산되게 고치지 않는다.\n// 백테스터 쪽이 바뀌면 pkm-app의 scripts/upbit-strategies.mjs가 이 파일도 다시 옮긴다.\n';
fs.writeFileSync(path.join(OUT, 'indicators.mjs'), HEAD + fs.readFileSync(path.join(FROM, 'server/indicators.js'), 'utf8'));
console.log(`전략 ${list.length}개를 등록했어요 (${path.relative(process.cwd(), path.join(OUT, 'strategies.mjs'))})`);
for (const s of list) console.log(`  ${{ added: '직접', pass: '통과', partial: '부분' }[s.verdict]}  ${s.grade ?? '-'} ${String(s.score ?? '-').padStart(5)}  ${s.interval}  ${s.id}`);
