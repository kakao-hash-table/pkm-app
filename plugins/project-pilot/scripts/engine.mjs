// 프로젝트 파일럿 엔진 — pkm에 묶이지 않는 순수 로직. 설계(plan) 다듬기, 루프 일정, 사람이 읽을 글(설계 노트·AI에게 줄 맥락) 만들기.
// 파일을 읽고 쓰는 일은 store.mjs(pkm 프로필·작업 폴더)가 맡는다. 다른 플랫폼으로 옮길 때는 이 파일을 그대로 쓰고 store만 바꾼다.

export const LENSES = ['오퍼', '고객유치', '홍보', '전환', '운영툴', '리텐션', '측정', '규정', '제품'];
export const EVERY = { daily: '매일', weekdays: '평일', weekly: '매주', monthly: '매월' };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const LIMIT = { subs: 9, todos: 12, loops: 6, checkins: 3, risks: 8, tree: 10 };

const two = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const hm = d => `${two(d.getHours())}:${two(d.getMinutes())}`;
export const str = (v, n = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const text = (v, n = 4000) => String(v ?? '').trim().slice(0, n);
const num = (v, d = 0) => { const t = String(v ?? '').replace(/[, ]/g, ''); if (!t) return d; const x = Number(t); return Number.isFinite(x) ? x : d; };   // 빈 값은 기본값
const list = v => Array.isArray(v) ? v : [];
export const slug = (s, n = 24) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, n) || 'x';
// 사람이 보고 판단할 파일 — 작업 폴더 기준 상대 경로 3개까지(밖을 가리키는지는 읽을 때 다시 확인한다)
export const seeList = v => list(v).map(x => str(x, 200).replace(/^\.\//, '')).filter(Boolean).slice(0, 3);
const atOk = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : null;

/* ---------- 설계 다듬기: AI가 낸 plan을 믿지 않는 입력으로 보고 모양·개수를 맞춘다 ---------- */
export function normalizePlan(p, { minutes = 10 } = {}){
  p = p && typeof p === 'object' ? p : {};
  const keys = new Set();
  const key = (v, i, pre) => { let k = slug(v || `${pre}${i + 1}`, 20); while (keys.has(k)) k += '-' + (i + 1); keys.add(k); return k; };
  const subs = list(p.subprojects).slice(0, LIMIT.subs).map((s, i) => ({
    key: key(s.key, i, 'sub'), lens: LENSES.includes(s.lens) ? s.lens : str(s.lens, 12) || '기타',
    title: str(s.title, 60) || `서브 프로젝트 ${i + 1}`, why: str(s.why, 300), outcome: str(s.outcome, 300),
    wave: [0, 1, 2, 3].includes(num(s.wave, -1)) ? num(s.wave) : 1,
    done: list(s.done).map(x => str(x, 200)).filter(Boolean).slice(0, 6),
    todos: list(s.todos).slice(0, LIMIT.todos).map(t => { const see = t.who === 'me' ? seeList(t.see) : [];
      return { text: str(t.text ?? t, 200), who: t.who === 'me' ? 'me' : 'ai', minutes: Math.min(120, Math.max(0, Math.round(num(t.minutes)))), ...(see.length ? { see } : {}) }; }).filter(t => t.text)
  }));
  const subKeys = new Set(subs.map(s => s.key));
  const loops = list(p.loops).filter(l => !(l && l.every === 'weekly' && /점검/.test(String(l.title || '')))).slice(0, LIMIT.loops).map((l, i) => normalizeLoop(l, i, subKeys, keys)).filter(Boolean);   // 주간 점검은 시스템이 붙인다
  const checkins = list(p.checkins).slice(0, LIMIT.checkins).map((c, i) => ({
    key: key(c.key, i, 'check'), question: str(c.question, 120) || '이번 주 숫자를 적어 주세요', unit: str(c.unit, 12),
    every: ['weekly', 'monthly'].includes(c.every) ? c.every : 'weekly', dow: clampDow(c.dow, 7), day: clampDay(c.day), at: atOk(c.at) || '20:00',
    to_metric: c.to_metric !== false
  }));
  const metric = p.metric && typeof p.metric === 'object' ? p.metric : {};
  return {
    name: str(p.name, 24) || '새 프로젝트', one_liner: str(p.one_liner, 160), strategy: text(p.strategy, 1500),
    metric: { name: str(metric.name, 30) || '진척', unit: str(metric.unit, 10) || '회', target: num(metric.target, 0), period: /주/.test(String(metric.period || '')) ? '주' : '월' },
    // 확인한 값(assumed: false)은 출처가 있거나 계산값일 때만 — 아니면 가정으로 되돌린다
    tree: list(p.tree).slice(0, LIMIT.tree).map(t => { const url = /^https?:\/\//.test(String(t.source_url || '')) ? String(t.source_url).slice(0, 300) : '';
      return { name: str(t.name, 60), value: str(t.value, 80), assumed: t.assumed !== false && !(t.assumed === false) ? true : !(url || /계산|목표/.test(String(t.note || '') + String(t.value || ''))), note: str(t.note, 200), source_url: url }; }).filter(t => t.name),
    me_minutes: Math.max(0, Math.round(num(p.me_minutes, minutes))) || minutes,
    routine_at: atOk(p.routine_at) || '21:00',
    subprojects: subs, loops, checkins,
    risks: list(p.risks).slice(0, LIMIT.risks).map(r => ({ risk: str(r.risk ?? r, 200), guard: str(r.guard, 200) })).filter(r => r.risk),
    milestones: list(p.milestones).slice(0, 5).map(m => ({ name: str(m.name, 60), target: str(m.target, 60), by: str(m.by, 30), next: str(m.next, 160) })).filter(m => m.name),
    decisions: list(p.decisions).map(x => str(x, 200)).filter(Boolean).slice(0, 6),
    first_week: list(p.first_week).map(x => str(x, 200)).filter(Boolean).slice(0, 8),
    assumptions: list(p.assumptions).map(x => str(x, 200)).filter(Boolean).slice(0, 10),
    sources: list(p.sources).map(s => ({ title: str(s.title, 120), url: /^https?:\/\//.test(String(s.url || '')) ? String(s.url).slice(0, 500) : '' })).filter(s => s.title || s.url).slice(0, 15)
  };
}
const clampDow = (v, d) => { const n = Math.round(num(v, d)); return n >= 1 && n <= 7 ? n : d; };   // 1=월 … 7=일
const clampDay = v => { const n = Math.round(num(v, 1)); return n >= 1 && n <= 28 ? n : 1; };
export function normalizeLoop(l, i, subKeys = new Set(), keys = new Set()){
  if (!l || typeof l !== 'object' || !str(l.task)) return null;
  let k = slug(l.key || `loop${i + 1}`, 20); while (keys.has(k)) k += '-' + (i + 1); keys.add(k);
  const every = EVERY[l.every] ? l.every : 'daily';
  return { key: k, title: str(l.title, 60) || `루프 ${i + 1}`, sub: subKeys.has(l.sub) ? l.sub : null, kind: l.kind === 'review' ? 'review' : 'make',
    every, dow: clampDow(l.dow, 1), day: clampDay(l.day), at: atOk(l.at) || '08:00',
    task: text(l.task, 1500), me: str(l.me, 200), me_minutes: Math.min(60, Math.max(0, Math.round(num(l.me_minutes)))), metric: str(l.metric, 60), on: l.on !== false };
}

/* 기본으로 붙는 루프 — 매주 점검(AI가 카드·숫자·루프 결과를 보고 바꿀 것을 제안) */
export const REVIEW_LOOP = { key: 'review', title: '주간 점검', kind: 'review', every: 'weekly', dow: 7, day: 1, at: '19:00', sub: null,
  task: '이번 주 카드 진행, 루프 결과, 숫자 기록을 보고 잘 되는 것·안 되는 것을 짚고, 다음 주에 바꿀 것을 제안해요.', me: '제안을 보고 [제안대로 바꾸기]나 [그대로 두기]를 눌러요', me_minutes: 2, on: true };

/* ---------- 하루 사람 몫(분) ---------- */
const perDay = { daily: 1, weekdays: 5 / 7, weekly: 1 / 7, monthly: 1 / 30 };
export const meMinutes = plan => Math.round(list(plan.loops).filter(l => l.on !== false).reduce((n, l) => n + (l.me_minutes || 0) * (perDay[l.every] || 0), 0));

/* ---------- 루프 일정: 지금 회차(period)와 그 회차가 열렸는지 ---------- */
export function isoWeek(d){
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${two(Math.ceil(((t - y0) / 86400000 + 1) / 7))}`;
}
// 돌아갈 회차가 열렸으면 { period, at(그 회차 시작 시각) }, 아니면 null. offdays: 평일 루프가 쉬는 날(YYYY-MM-DD 목록)
export function due(loop, now = new Date(), offdays = []){
  const [h, m] = loop.at.split(':').map(Number);
  const at = new Date(now); at.setHours(h, m, 0, 0);
  const day = now.getDay();
  if (loop.every === 'daily') return now >= at ? { period: ymd(now), at } : null;
  if (loop.every === 'weekdays'){
    if (day === 0 || day === 6 || offdays.includes(ymd(now))) return null;
    return now >= at ? { period: ymd(now), at } : null;
  }
  if (loop.every === 'weekly'){
    const mon = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7));   // 이번 주 월요일
    const s = new Date(mon); s.setDate(mon.getDate() + loop.dow - 1); s.setHours(h, m, 0, 0);
    return now >= s ? { period: isoWeek(now), at: s } : null;
  }
  if (loop.every === 'monthly'){
    const s = new Date(now.getFullYear(), now.getMonth(), loop.day, h, m);
    return now >= s ? { period: `${now.getFullYear()}-${two(now.getMonth() + 1)}`, at: s } : null;
  }
  return null;
}
export const whenText = l => l.every === 'weekly' ? `매주 ${WD[l.dow % 7]} ${l.at}` : l.every === 'monthly' ? `매월 ${l.day}일 ${l.at}` : `${EVERY[l.every]} ${l.at}`;

/* ---------- 숫자 ---------- */
export const periodWord = p => p === '주' ? '주' : '달';
export const money = (n, unit) => {
  if (unit === '원' && Math.abs(n) >= 10000) return `${(n / 10000).toFixed(n % 10000 ? 1 : 0).replace(/\.0$/, '')}만원`;
  return `${Number(n).toLocaleString('ko-KR')}${unit || ''}`;
};
// 이번 기간(월/주)에 쌓인 양 — records: [{date, amt}]
export function progress(metric, records, now = new Date()){
  const p = metric.period || '월', from = new Date(now);
  if (/주/.test(p)) from.setDate(now.getDate() - ((now.getDay() + 6) % 7)); else from.setDate(1);
  const since = ymd(from), sum = records.filter(r => r.date >= since).reduce((n, r) => n + (Number(r.amt) || 0), 0);
  return { sum, since, pct: metric.target > 0 ? Math.round(sum / metric.target * 100) : null };
}

/* ---------- 글: 설계 노트(사람용)와 맥락(AI용) ---------- */
export const waveName = w => ['셋업', '1차', '2차', '3차'][w] || `${w}차`;
const whoText = t => t.who === 'me' ? `나 · ${t.text}${t.minutes ? ` (${t.minutes}분)` : ''}` : `AI · ${t.text}`;   // 화면(짚은 곳)용 — 이모지만으로 나누지 않는다
const whoMark = t => t.who === 'me' ? `🙋 ${t.text}${t.minutes ? ` (${t.minutes}분)` : ''}` : `🤖 ${t.text}`;
export const todoLine = (t, done = false) => `- [${done ? 'x' : ' '}] ${whoMark(t)}`;

export function planMarkdown(pr){
  const p = pr.plan, out = [];
  out.push(`**목표** ${pr.goal}`);
  if (p.one_liner) out.push(`**한 줄 전략** ${p.one_liner}`);
  out.push(`**지표** ${p.metric.name} 한 ${periodWord(p.metric.period)} ${money(p.metric.target, p.metric.unit)} · **내 시간** 하루 약 ${meMinutes({ loops: pr.loops || p.loops })}분 (예산 ${pr.brief?.minutes ?? p.me_minutes}분)`);
  if (p.decisions.length) out.push('', '## 결정할 것', ...p.decisions.map(x => `- [ ] ${x}`));
  if (p.strategy) out.push('', '## 전략', p.strategy);
  if (p.milestones.length) out.push('', '## 단계 목표', '| 단계 | 목표 | 언제까지 | 넘어가는 기준 |', '|---|---|---|---|', ...p.milestones.map(m => `| ${cell(m.name)} | ${cell(m.target)} | ${cell(m.by)} | ${cell(m.next)} |`));
  if (p.tree.length) out.push('', '## 목표 숫자 역산', '| 항목 | 값 | 근거 |', '|---|---|---|', ...p.tree.map(t => `| ${cell(t.name)} | ${cell(t.value)} | ${t.assumed ? '가정' : t.source_url ? `[확인](${t.source_url})` : '계산'}${t.note ? ` · ${cell(t.note)}` : ''} |`));
  out.push('', '## 서브 프로젝트');
  for (const s of p.subprojects){
    const card = pr.cards?.[s.key];
    out.push('', `### ${waveName(s.wave)} · ${s.lens} — ${s.title}${card ? ` → [[${card.title}]]` : ''}`, `- 키: ${s.key}`);
    if (s.why) out.push(`- 왜: ${s.why}`);
    if (s.outcome) out.push(`- 나올 것: ${s.outcome}`);
    if (s.done.length) out.push(`- 완료 조건: ${s.done.join(' / ')}`);
    for (const t of s.todos) out.push(`  - ${whoMark(t)}${t.see ? ` — 볼 파일: ${t.see.join(', ')}` : ''}`);
  }
  const loops = pr.loops || p.loops;
  if (loops.length){
    out.push('', '## 자동 루프', '| 언제 | 루프 | AI가 하는 것 | 내 몫 |', '|---|---|---|---|');
    for (const l of loops) out.push(`| ${whenText(l)}${l.on === false ? ' (꺼짐)' : ''} | ${cell(l.title)}${l.metric ? ` · 겨눔: ${cell(l.metric)}` : ''} | ${cell(l.task)} | ${l.me_minutes ? `${cell(l.me)} · ${l.me_minutes}분` : '없음'} |`);
  }
  if (p.checkins.length) out.push('', '## 숫자 기록', ...p.checkins.map(c => `- ${c.every === 'monthly' ? `매월 ${c.day}일` : `매주 ${WD[c.dow % 7]}`} ${c.at} — ${c.question}${c.unit ? ` (${c.unit})` : ''}`));
  if (p.first_week.length) out.push('', '## 첫 주', ...p.first_week.map(x => `- ${x}`));
  if (p.risks.length) out.push('', '## 위험과 막을 장치', ...p.risks.map(r => `- ${r.risk}${r.guard ? ` → ${r.guard}` : ''}`));
  if (p.assumptions.length) out.push('', '## 가정 (2주 안에 숫자로 확인)', ...p.assumptions.map(x => `- ${x}`));
  if (p.sources.length) out.push('', '## 출처', ...p.sources.map(s => s.url ? `- [${s.title || s.url}](${s.url})` : `- ${s.title}`));
  return out.join('\n');
}
const cell = s => String(s || '').replace(/\|/g, '/').replace(/\n/g, ' ');

// AI에게 줄 맥락 — 목표, 조건, 설계, 진행(카드·숫자·최근 루프 결과)
export function contextMarkdown(pr, { cards = [], records = [], now = new Date(), research = '' } = {}){
  const out = [`# 프로젝트: ${pr.plan ? pr.plan.name : pr.goal}`, `오늘: ${ymd(now)} (${WD[now.getDay()]})`, '', `## 목표(사용자 원문)`, pr.goal];
  if (pr.brief) out.push('', '## 조건', '```json', JSON.stringify(pr.brief, null, 1), '```');
  if (pr.plan) out.push('', '## 지금 설계', planMarkdown(pr));
  if (cards.length){
    out.push('', '## 카드 진행');
    for (const c of cards) out.push(`- [${c.status}] ${c.title} — 할 일 ${c.todos.filter(t => t.done).length}/${c.todos.length}${c.todos.filter(t => !t.done).slice(0, 6).map(t => `\n  - [ ] ${t.text}`).join('')}`);
  }
  if (pr.plan){
    const pg = progress(pr.plan.metric, records, now);
    out.push('', `## 숫자 (${pr.plan.metric.name})`, `이번 ${periodWord(pr.plan.metric.period)}: ${money(pg.sum, pr.plan.metric.unit)} / 목표 ${money(pr.plan.metric.target, pr.plan.metric.unit)}${pg.pct == null ? '' : ` (${pg.pct}%)`}`,
      ...records.slice(-12).map(r => `- ${r.date} ${r.amt}${r.memo ? ` · ${r.memo}` : ''}`));
  }
  const rej = list(pr.rejections).slice(-15);
  if (rej.length) out.push('', '## 사람이 거절하거나 바꾼 것 (같은 걸 다시 제안하지 말고, 이유를 보고 대안을 찾아요)', ...rej.map(x => `- ${x.at} [${{ ask: 'AI 요청', decision: '정할 것', todo: '할 일' }[x.kind] || x.kind}] ${x.text} — 이유: ${x.reason}`));
  const log = list(pr.log).slice(-15);
  if (log.length) out.push('', '## 최근 기록', ...log.map(l => `- ${l.at.slice(0, 10)} [${l.kind}] ${l.text}`));
  if (research) out.push('', '## 조사 요약', research.slice(0, 12000));
  return out.join('\n');
}

/* ---------- 설계 검토 화면(판정 상자 + 짚은 곳) ---------- */
export function reviewView(pr){
  const p = pr.plan, mins = meMinutes({ loops: pr.loops || p.loops }), budget = pr.brief?.minutes ?? p.me_minutes;
  const findings = p.decisions.length ? [{ where: '결정할 것', note: '가정으로 채움', title: `AI가 가정으로 정한 것 ${p.decisions.length}가지`, text: p.decisions.map(x => `· ${x}`).join('\n') + '\n다르면 고칠 점에 적어 주세요' }] : [];
  for (const s of p.subprojects){
    const ai = s.todos.filter(t => t.who === 'ai').length, me = s.todos.filter(t => t.who === 'me'), mm = me.reduce((n, t) => n + t.minutes, 0);
    findings.push({ where: `${waveName(s.wave)} · ${s.lens}`, title: s.title, text: `${s.outcome || s.why}\nAI 할 일 ${ai}개 · 내 할 일 ${me.length}개${mm ? `(${mm}분)` : ''}${s.todos.length ? `\n${s.todos.slice(0, 6).map(t => `· ${whoText(t)}`).join('\n')}` : ''}` });
  }
  for (const l of pr.loops || p.loops) findings.push({ where: whenText(l), note: '자동 루프', title: l.title, text: `AI: ${l.task}${l.me_minutes ? `\n나: ${l.me} · ${l.me_minutes}분` : '\n나: 할 것 없음'}` });
  if (p.tree.length) findings.push({ where: '목표 숫자 역산', title: `한 ${periodWord(p.metric.period)} ${money(p.metric.target, p.metric.unit)}까지`, text: p.tree.map(t => `${t.name}: ${t.value}${t.assumed ? ' (가정)' : t.source_url ? ' (확인)' : ' (계산)'}`).join('\n') });
  if (p.milestones.length) findings.push({ where: '단계 목표', title: p.milestones.map(m => m.target || m.name).join(' → '), text: p.milestones.map(m => `${m.name}: ${m.target}${m.by ? ` (${m.by})` : ''}${m.next ? ` — ${m.next}` : ''}`).join('\n') });
  if (p.risks.length) findings.push({ where: '위험', title: `막아 둘 것 ${p.risks.length}가지`, text: p.risks.map(r => `${r.risk}${r.guard ? ` → ${r.guard}` : ''}`).join('\n') });
  const over = budget && mins > budget;
  return {
    verdict: { tone: over ? 'bad' : 'ok', title: `${p.name} — 서브 프로젝트 ${p.subprojects.length}개 · 자동 루프 ${(pr.loops || p.loops).length}개`,
      text: `${p.one_liner ? p.one_liner + '\n' : ''}목표 ${p.metric.name} 한 ${periodWord(p.metric.period)} ${money(p.metric.target, p.metric.unit)} · 내 시간 하루 약 ${mins}분${over ? `\n예산 ${budget}분보다 ${mins - budget}분 많아요 — 줄일 곳을 적어 주세요` : ''}` },
    findings
  };
}
