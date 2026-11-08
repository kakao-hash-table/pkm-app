// 문제 수집기 엔진 — pkm에 묶이지 않는 순수 로직. 글 분석 결과 다듬기, 묶음 합치기, 점수, 단계(후보→검증→공사→건물), 보기 거르기.
// 파일 입출력은 collector.mjs가 맡는다. 원문은 받지 않는다 — 요약·분야·점수·링크만 다룬다.

export const STAGES = ['후보', '검증', '공사', '건물'];
export const STAGE_ICON = { 후보: '🔍', 검증: '🧪', 공사: '🏗️', 건물: '🏢' };
export const RESULTS = { none: '문의 0', ask: '문의 있음', paid: '결제됨' };
export const WEIGHTS = { money: 35, repeat: 20, auto: 20, build: 15, pain: 10 };
export const BUILDING = { profit: 50000, hours: 1 };   // 건물: 월 순이익 5만원 이상, 손 월 1시간 이하

export const str = (v, n = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = v => Array.isArray(v) ? v : [];
const lvl = v => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.max(0, Math.min(5, x)) : 0; };
const num = (v, d = 0) => { const x = Number(String(v ?? '').replace(/[, ]/g, '')); return String(v ?? '').trim() && Number.isFinite(x) ? x : d; };
export const money = n => `${Math.round(n).toLocaleString('ko-KR')}원`;

// 비중 설정 "35,20,20,15,10"(돈·반복·자동화·내가 만들 수 있나·고통)
export function weights(text){
  const n = String(text || '').split(/[,\s]+/).filter(Boolean).map(Number);
  if (n.length !== 5 || n.some(x => !Number.isFinite(x) || x < 0) || !n.reduce((a, b) => a + b, 0)) return { ...WEIGHTS };
  const [money, repeat, auto, build, pain] = n;
  return { money, repeat, auto, build, pain };
}

// 출처 — 주소로 가린다. 주소가 없으면 붙여 넣기
const HOSTS = [
  [/(^|\.)kmong\.com$/, '크몽'], [/(^|\.)soomgo\.com$/, '숨고'],
  [/(^|\.)(clien\.net|dcinside\.com|fmkorea\.com|ppomppu\.co\.kr|theqoo\.net|teamblind\.com|blind\.com|ruliweb\.com|naver\.com|daum\.net|okky\.kr|disquiet\.io)$/, '국내 커뮤니티'],
  [/^(apps\.apple\.com|play\.google\.com)$/, '앱 리뷰'], [/(^|\.)reddit\.com$/, 'Reddit']
];
export function sourceOf(url){
  try { const h = new URL(url).hostname.toLowerCase(); for (const [re, name] of HOSTS) if (re.test(h)) return name; return '기타 사이트'; }
  catch { return '붙여 넣기'; }
}
export const firstUrl = t => (String(t || '').match(/https?:\/\/[^\s<>"')\]]+/) || [''])[0];

/* ---------- AI 분석 결과 다듬기: 믿지 않는 입력으로 보고 모양·범위를 맞춘다 ---------- */
export function normalizeAnalysis(a){
  a = a && typeof a === 'object' ? a : {};
  const problems = list(a.problems).slice(0, 8).map(p => {
    p = p && typeof p === 'object' ? p : {};
    const who = str(p.who, 120), loss = str(p.loss, 200), workaround = str(p.workaround, 200);
    const ok = p.qualifies !== false && !!(who && loss && workaround);   // 누가/상황 + 잃는 것 + 지금 버티는 방법 — 셋 다 있어야 문제
    return {
      title: str(p.title, 80) || '이름 없는 문제', who, loss, workaround, summary: str(p.summary, 300),
      domain: str(p.domain, 20) || '기타', qualifies: ok,
      reject_why: ok ? '' : str(p.reject_why, 200) || '누가·잃는 것·지금 버티는 방법 중 빠진 게 있어요',
      money: lvl(p.money), money_why: str(p.money_why, 200), pain: lvl(p.pain), auto: lvl(p.auto), build: lvl(p.build),
      out_of_scope: p.out_of_scope === true, scope_why: str(p.scope_why, 200), match: str(p.match, 40),
      post: Number.isInteger(p.post) ? p.post : -1   // 자동 수집: 몇 번째 글인지
    };
  });
  return { problems, note: str(a.note, 300) };
}

/* ---------- 점수 ---------- */
// 검증 결과로 돈 신호를 실제 값으로 바꾼다 — 결제는 5, 문의는 4 이상, 반응 없음은 한 번마다 30%씩 내린다
export function moneyLevel(c){
  const r = list(c.results);
  if (r.some(x => x.kind === 'paid')) return 5;
  if (r.some(x => x.kind === 'ask')) return Math.max(c.money || 0, 4);
  return (c.money || 0) * Math.pow(0.7, r.filter(x => x.kind === 'none').length);
}
export function repeatLevel(c){
  const n = list(c.posts).length, s = new Set(list(c.posts).map(p => p.source)).size;
  return Math.min(5, n + Math.max(0, s - 1));
}
export function score(c, w = WEIGHTS, { weekHours = 10 } = {}){
  const build = c.out_of_scope ? 0 : c.build || 0;
  const v = { money: moneyLevel(c), repeat: repeatLevel(c), auto: c.auto || 0, build, pain: c.pain || 0 };
  const total = Object.keys(WEIGHTS).reduce((a, k) => a + (w[k] || 0), 0) || 100;
  let s = Object.keys(WEIGHTS).reduce((a, k) => a + (w[k] || 0) * v[k] / 5, 0) * 100 / total;
  const hours = c.solution && num(c.solution.first_hours, 0);
  if (hours && hours > weekHours * 8) s -= 10;   // 첫 버전이 8주를 넘으면 감점
  return Math.max(0, Math.min(100, Math.round(s)));
}

/* ---------- 묶음 ---------- */
// 분석된 문제 하나를 묶음에 넣는다. match가 있는 묶음이면 합치고, 아니면 새 묶음. 같은 주소의 글은 두 번 세지 않는다
export function mergeProblem(db, p, { url, source, at, id }){
  const post = { url: /^https?:\/\//.test(url || '') ? url : '', source, at, summary: p.summary || p.title };
  let c = p.match && db.clusters[p.match];
  if (c){
    if (post.url && c.posts.some(x => x.url === post.url)) return { cluster: c, added: false };
    c.posts.push(post); c.posts = c.posts.slice(-30);
    for (const k of ['money', 'pain', 'auto', 'build']) c[k] = Math.max(c[k] || 0, p[k]);
    if (p.money_why && p.money > (c.money_from || 0)){ c.money_why = p.money_why; c.money_from = p.money; }
    c.out_of_scope = c.out_of_scope && p.out_of_scope;
    c.updated = at;
    return { cluster: c, added: true };
  }
  c = { id, title: p.title, domain: p.domain, who: p.who, loss: p.loss, workaround: p.workaround, summary: p.summary,
    money: p.money, money_why: p.money_why, money_from: p.money, pain: p.pain, auto: p.auto, build: p.build,
    out_of_scope: p.out_of_scope, scope_why: p.scope_why, stage: '후보', posts: [post], results: [], logs: [], created: at, updated: at };
  db.clusters[id] = c;
  return { cluster: c, added: true };
}

/* ---------- 단계 ---------- */
// 해결 카드가 생기면 검증, 결제가 한 번이라도 있으면 공사, 마지막 기록이 순이익 5만원 이상·손 1시간 이하면 건물
export function stageOf(c){
  const last = list(c.logs).at(-1);
  if (list(c.results).some(r => r.kind === 'paid')){
    if (last && last.profit >= BUILDING.profit && last.hours <= BUILDING.hours) return '건물';
    return '공사';
  }
  return c.solution ? '검증' : '후보';
}

/* ---------- 보기 ---------- */
// 필터 글: "전체" | "분야:교육" | "출처:크몽" | "단계:검증" | "범위 밖"
export function parseFilter(t){
  t = str(t, 60);
  const m = t.match(/^(분야|출처|단계):\s*(.+)$/);
  if (m) return { kind: m[1], value: m[2] };
  return { kind: t === '범위 밖' ? '범위 밖' : '전체' };
}
export function applyFilter(clusters, f){
  return clusters.filter(c => {
    if (f.kind === '범위 밖') return c.out_of_scope;
    if (c.out_of_scope) return false;
    if (f.kind === '분야') return c.domain === f.value;
    if (f.kind === '출처') return c.posts.some(p => p.source === f.value);
    if (f.kind === '단계') return c.stage === f.value;
    return true;
  });
}
export const filterLabel = f => f.kind === '전체' || f.kind === '범위 밖' ? f.kind : `${f.kind} ${f.value}`;

/* ---------- 해결 카드 다듬기 ---------- */
const FORMS = ['대행', '도구', '제품'];
export function normalizeSolution(s){
  s = s && typeof s === 'object' ? s : {};
  const forms = FORMS.map(name => {
    const f = list(s.forms).find(x => x && x.form === name) || {};
    return { form: name, offer: str(f.offer, 200), how: str(f.how, 300), weeks: Math.max(0, num(f.weeks, 0)), automation: str(f.automation, 200) };
  });
  const r = s.revenue && typeof s.revenue === 'object' ? s.revenue : {};
  return {
    forms, first_hours: Math.max(0, num(s.first_hours, 0)),
    abroad: list(s.abroad).slice(0, 3).map(x => ({ name: str(x && x.name, 80), how: str(x && x.how, 200), url: /^https?:\/\//.test(String(x && x.url)) ? String(x.url).slice(0, 300) : '' })).filter(x => x.name),
    step: str(s.step, 300), contact: String(s.contact ?? '').trim().slice(0, 1200),
    revenue: { payer: str(r.payer, 120), cost_now: str(r.cost_now, 200), price: str(r.price, 120), channel: str(r.channel, 200), first3: str(r.first3, 300), monthly: str(r.monthly, 200), running_cost: str(r.running_cost, 200) },
    goal: str(s.goal, 200), risks: list(s.risks).map(x => str(x, 200)).filter(Boolean).slice(0, 4)
  };
}

// 해결 카드를 사람이 읽는 글로
export function solutionMarkdown(c){
  const s = c.solution; if (!s) return '';
  const r = s.revenue;
  return [
    `**${c.title}** · ${c.domain} · 점수 ${c.score ?? '-'}`,
    '', '**해결 형태** (대행으로 검증 → 반복되는 일을 자동화)',
    ...s.forms.map((f, i) => `${i + 1}. ${f.form}: ${f.offer || '-'}${f.weeks ? ` (${f.weeks}주)` : ''}${f.automation ? ` — 자동화: ${f.automation}` : ''}`),
    '', '**수익**',
    `- 누가 내나: ${r.payer || '-'}`, `- 지금 치르는 비용: ${r.cost_now || '-'}`, `- 가격: ${r.price || '-'}`,
    `- 파는 곳: ${r.channel || '-'}`, `- 첫 고객 3명: ${r.first3 || '-'}`, `- 월 목표: ${r.monthly || '-'}`, `- 계속 드는 비용: ${r.running_cost || '-'}`,
    ...(s.abroad.length ? ['', '**해외 사례**', ...s.abroad.map(a => `- ${a.name}: ${a.how}${a.url ? ` (${a.url})` : ''}`)] : []),
    ...(s.risks.length ? ['', '**걸리는 점**', ...s.risks.map(x => `- ${x}`)] : []),
    '', `**이번 주 검증 한 걸음**: ${s.step || '-'}`
  ].join('\n');
}

/* ---------- 자동 수집 ---------- */
// robots.txt — 우리 이름(ua)의 묶음이 있으면 그것, 없으면 * 묶음. 가장 길게 맞는 규칙이 이기고, 같으면 Allow
export function robotsAllowed(text, ua, pathq){
  const groups = []; let cur = null, lastUa = false;
  for (const raw of String(text || '').split(/\r?\n/)){
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent'){ if (!lastUa) groups.push(cur = { agents: [], rules: [] }); cur.agents.push(v.toLowerCase()); lastUa = true; continue; }
    lastUa = false;
    if (cur && (k === 'allow' || k === 'disallow')) cur.rules.push({ allow: k === 'allow', path: v });
  }
  const name = String(ua).toLowerCase().split('/')[0];
  const g = groups.filter(g => g.agents.some(a => a !== '*' && name.includes(a))), use = g.length ? g : groups.filter(g => g.agents.includes('*'));
  const re = p => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  let best = null;
  for (const r of use.flatMap(g => g.rules)){
    if (!r.path) continue;   // "Disallow:" 빈 값은 모두 허용
    if (re(r.path).test(pathq) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}
// RSS 2.0 / Atom 항목 — 제목·주소·본문(태그 뺀 글)·고유값
const dec = t => t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const ent = t => dec(dec(String(t || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (x, n) => { const m = x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i')); return m ? m[1] : ''; };
export function parseFeed(xml){
  const out = [];
  for (const m of String(xml || '').matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)){
    const x = m[2];
    let link = ent(tag(x, 'link'));
    if (!link){ const h = x.match(/<link[^>]*href="([^"]+)"/i); link = h ? h[1].replace(/&amp;/g, '&') : ''; }
    const title = ent(tag(x, 'title')), body = ent(tag(x, 'description') || tag(x, 'content:encoded') || tag(x, 'content') || tag(x, 'summary'));
    const id = ent(tag(x, 'guid') || tag(x, 'id')) || link;
    if (title || body) out.push({ id, title: str(title, 200), url: /^https?:\/\//.test(link) ? link : '', text: str(body, 1500) });
  }
  return out;
}
