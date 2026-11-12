// 공모전 신청 — 저장·네트워크 없는 순수 함수. contest.mjs가 부른다
export const str = (v, n = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const text = (v, n = 2000) => String(v ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
export const day = v => { const m = String(v || '').match(/(\d{4})[-.\/년\s]+(\d{1,2})[-.\/월\s]+(\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : ''; };
export const ddays = (d, today) => d ? Math.round((Date.parse(d) - Date.parse(today)) / 86400000) : null;
export function won(n){
  n = Number(n) || 0;
  if (!n) return '';
  if (n >= 1e8) return `${+(n / 1e8).toFixed(1)}억원`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만원`;
  return `${n.toLocaleString('ko-KR')}원`;
}
export const METHODS = { email: '이메일', form: '구글 폼', nform: '네이버 폼', oform: '온라인 폼', site: '홈페이지', youtube: '유튜브', sns: 'SNS', post: '우편', visit: '방문', etc: '기타' };
// 폼 접수는 어느 폼인지 글에 드러난 대로만 부른다 — 네이버·구글이 안 보이면 그냥 '온라인 폼'(AI는 폼을 모두 form으로 준다)
const FORMS = ['form', 'nform', 'oform'];
export const formOf = s => /form\.naver\.com|naver\.me\/|네이버\s*폼/i.test(s = String(s || '')) ? 'nform' : /forms\.gle|docs\.google\.com\/forms|구글\s*(?:폼|설문)/i.test(s) ? 'form' : 'oform';
export const fixMethod = submit => { if (submit && FORMS.includes(submit.method)) submit.method = formOf(`${submit.how} ${submit.to}`); return submit; };
export function methodOf(s){
  s = String(s || '');
  if (/form\.naver\.com|네이버\s*폼/i.test(s)) return 'nform';
  if (/forms\.gle|docs\.google\.com\/forms|구글\s*(?:폼|설문)/i.test(s)) return 'form';
  if (/youtube|youtu\.be|유튜브/i.test(s)) return 'youtube';
  if (/instagram|인스타|페이스북|facebook|블로그|틱톡|sns/i.test(s)) return 'sns';
  if (/[\w.+-]+@[\w-]+\.[\w.]+|e-?mail|이메일|메일/i.test(s)) return 'email';
  if (/우편|등기|택배/.test(s)) return 'post';
  if (/방문/.test(s)) return 'visit';
  if (/홈페이지|온라인|사이트|접수\s*페이지|https?:\/\//i.test(s)) return 'site';
  return s.trim() ? 'etc' : '';
}
// 접수 주소 — 요강이 'www.example.kr/…'처럼 적어도 링크가 되게
export const urlOf = to => { to = String(to || '').trim(); return /^https?:\/\//i.test(to) ? to : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(to) ? `https://${to}` : ''; };
export const firstEmail = s => (String(s || '').match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [''])[0];

export const lines = v => String(v || '').split(/\r?\n|,/).map(x => x.trim()).filter(x => x && !x.startsWith('#'));
export const cut = (v, n) => { v = str(v, 2000); return v.length > n ? v.slice(0, n - 1) + '…' : v; };
export const kday = d => d ? `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일` : '';

/* AI가 상세를 읽고 정리한 것 → 저장할 꼴. 칸마다 글자 상한(목록 한 줄에 펼치지 않고 다 보이게) */
const ok3 = v => ['yes', 'no', 'unsure'].includes(v) ? v : 'unsure';
const int = (v, max = 1e12) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
export function normalizeFit(a){
  const list = Array.isArray(a && a.contests) ? a.contests : [];
  return { note: str(a && a.note, 300), contests: list.map(c => {
    const how = cut(c.submit_how, 120), to = str(c.submit_to, 300);
    return {
      i: Number.isInteger(c.i) ? c.i : -1, unreadable: c.unreadable === true, doubt: cut(c.doubt, 30),
      target: c.is_target === true, target_why: cut(c.target_why, 40),
      kinds: (Array.isArray(c.kinds) ? c.kinds : []).map(k => str(k, 20)).filter(Boolean).slice(0, 4),
      prize: { text: cut(c.prize_text, 120), total: int(c.prize_total), first: int(c.prize_first), goods: c.first_is_goods === true,
        awards: (Array.isArray(c.awards) ? c.awards : []).map(x => cut(x, 40)).filter(Boolean).slice(0, 8) },
      deadline: day(c.deadline), announce: day(c.announce), announce_text: cut(c.announce_text, 20),
      submit: { what: cut(c.submit_what, 40), allow: Math.max(1, int(c.allow, 20)), desc_limit: int(c.desc_limit, 5000), note: cut(c.form_note, 40),
        fields: (Array.isArray(c.submit_fields) ? c.submit_fields : []).map(f => str(f, 30)).filter(Boolean).slice(0, 12),
        method: FORMS.includes(c.method) ? formOf(`${how} ${to}`) : METHODS[c.method] ? c.method : methodOf(`${how} ${to}`), to, how, subject: str(c.mail_subject, 120) },
      eligibility: { text: cut(c.eligibility_text, 30), ok: ok3(c.eligible), why: cut(c.eligible_why, 15) },
      ai: { rule: ['limited', 'banned'].includes(c.ai_rule) ? c.ai_rule : 'none', text: cut(c.ai_rule_text, 30) }
    };
  }) };
}
export function normalizeDraft(a){
  const items = (Array.isArray(a && a.candidates) ? a.candidates : []).map(c => ({ kind: str(c.kind, 20), text: str(c.text, 60), read: str(c.read, 40), why: text(c.why, 2000),
    form: (Array.isArray(c.form) ? c.form : []).map(v => ({ label: str(v && v.label, 120), value: text(v && v.value, 2000) })).filter(v => v.label && v.value).slice(0, 20) })).filter(c => c.text).slice(0, 10);
  return { items, note: str(a && a.note, 200) };
}

// AI가 세운 양식 채우기 계획 — 문서마다 쓰임(응모작마다·한 부·안 냄), 고칠 자리(id)와 넣을 글(자리표시 포함), 뺄 블록, 손으로 할 일. 후보마다 쓴 글(extras)
// 뺄 블록 — 'b4'나 범위 'b4-b9'
const dropIds = list => { const out = new Set(); for (const v of list.map(String)){ const m = v.trim().match(/^b(\d+)(?:\s*[-~–]\s*b?(\d+))?$/); if (!m) continue; const from = Number(m[1]), to = Math.min(m[2] == null ? from : Number(m[2]), from + 200); for (let i = from; i <= to; i++) out.add(`b${i}`); } return [...out].slice(0, 200); };
export function normalizePlan(a, nDocs, nCands){
  const seen = new Set(), arr = v => Array.isArray(v) ? v : [];
  return { note: str(a && a.note, 200),
    docs: arr(a && a.docs).filter(d => d && Number.isInteger(d.doc) && d.doc >= 0 && d.doc < nDocs && !seen.has(d.doc) && seen.add(d.doc)).map(d => ({ doc: d.doc, use: ['per_pick', 'once'].includes(d.use) ? d.use : 'skip', title: cut(d.title, 16) || '서류',
      fills: arr(d.fills).filter(x => x && /^b\d+(\.[rcp]\d+)*$/.test(String(x.id))).map(x => ({ id: String(x.id), text: String(x.text ?? '').replace(/\r/g, '').slice(0, 3000) })).slice(0, 80),
      drop: dropIds(arr(d.drop)), hand: d.hand === true, manual: arr(d.manual).map(m => cut(m, 40)).filter(Boolean).slice(0, 6) })),
    extras: extrasOf(a, nCands) };
}
const extrasOf = (a, nCands) => (Array.isArray(a && a.extras) ? a.extras : []).filter(e => e && Number.isInteger(e.cand) && e.cand >= 0 && e.cand < nCands)
  .map(e => ({ cand: e.cand, values: (Array.isArray(e.values) ? e.values : []).map(v => ({ name: str(v && v.name, 40), value: text(v && v.value, 3000) })).filter(v => v.name && v.value).slice(0, 12) }));
// 폼 답 계획 — 폼에 있는 문항만. 동의·서약은 AI가 표시했거나 유형이 동의이거나 제목에 동의·서약이 있으면 consent(응모자가 직접 정한다)
export function normalizeFormPlan(a, form, nCands){
  const qs = new Map((form.questions || []).map(q => [q.id, q])), seen = new Set();
  return { note: str(a && a.note, 200),
    answers: (Array.isArray(a && a.answers) ? a.answers : []).filter(x => x && qs.has(String(x.id)) && !seen.has(String(x.id)) && seen.add(String(x.id))).map(x => { const q = qs.get(String(x.id));
      return { id: q.id, text: String(x.text ?? '').replace(/\r/g, '').slice(0, 3000), consent: x.consent === true || q.type === 'agree' || /동의|서약/.test(q.title) || (q.options.length > 0 && q.options.every(o => /동의|서약|확인하였|확인했/.test(o))), ...(x.format === 'digits' ? { format: 'digits' } : {}) }; }),
    extras: extrasOf(a, nCands) };
}

// 브라우저 에이전트가 돌려준 제출 결과 — 낸 것이 확실할 때만 yes. 모르는 값은 unknown(냈다고 적지 않는다)
export function normalizeBrowse(a){
  const r = (a && a._result) || a || {};
  return { sent: ['yes', 'no'].includes(r.sent) ? r.sent : 'unknown', reason: str(r.reason, 300), proof: text(r.proof, 500),
    did: (Array.isArray(r.did) ? r.did : []).map(x => str(x, 120)).filter(Boolean).slice(0, 20),
    need: (Array.isArray(r.need) ? r.need : []).map(x => typeof x === 'string' ? { name: x } : x || {}).map(x => ({ name: str(x.name, 30).replace(/[{}:：]/g, '').trim(), question: str(x.question, 160),
      options: (Array.isArray(x.options) ? x.options : []).map(o => str(o, 60)).filter(Boolean).slice(0, 20) })).filter((x, i, a) => x.name && a.findIndex(y => y.name === x.name) === i).slice(0, 12) };   // 양식이 요구했는데 없던 응모자 정보 이름
}

/* 상태: new(정리 전) → ready | out(분야·조건) → submitted → won | lost. dropped는 사람이 뺀 것, dup은 다른 사이트에 같이 올라온 것 */
export function statusOf(c, today){
  if (c.dup_of) return 'dup';
  if (c.result) return c.result;
  if (c.submitted) return 'submitted';
  if (c.dropped) return 'dropped';
  if (!c.fit) return 'new';
  if (!c.forced && (!c.fit.target || c.fit.eligibility.ok === 'no')) return 'out';
  return c.deadline && c.deadline < today ? 'expired' : 'ready';
}

/* 화면 글 */
export function prizeLine(f){
  if (!f) return '';
  const p = f.prize, first = p.first ? `1등 ${p.goods ? '상품권 ' : ''}${won(p.first)}` : '', total = p.total && p.total !== p.first ? `총 ${won(p.total)}` : '';
  return [first, total].filter(Boolean).join(' · ') || '상금 요강 확인';
}
export function deadlineLine(d, today){
  const n = ddays(d, today);
  return n == null ? '마감일 요강 확인' : n === 0 ? '마감 오늘' : n === 1 ? `마감 내일 · ${kday(d)}` : n > 0 ? `마감 D-${n} · ${kday(d)}` : `마감 지남 · ${kday(d)}`;
}
export function announceLine(f, today, dday = false){
  if (!f || (!f.announce && !f.announce_text)) return '발표 미정';
  if (!f.announce) return `발표 ${f.announce_text}`;
  if (!dday) return `발표 ${kday(f.announce)}`;
  const n = ddays(f.announce, today);
  return n === 0 ? '발표 오늘' : n > 0 ? `발표 D-${n} · ${kday(f.announce)}` : `발표 지남 · ${kday(f.announce)}`;
}
export const verdictWord = ok => ({ yes: '돼요', no: '안 돼요', unsure: '확인 필요' })[ok];
const KINDS = ['네이밍', '슬로건'];
export const kindLabel = f => { const k = KINDS.filter(x => (f.kinds || []).some(y => y.includes(x))); return k.length ? k.join('·') : (f.kinds[0] || ''); };

// 정렬 값 — 화면의 정렬 칩이 읽는다. 상금은 1등 금액(없으면 총상금), 발표가 '12월 중'처럼 달만 있으면 그달 안의 날로, 모르면 null
export function sortOf(c){
  const f = c.fit, p = f && (f.prize.first || f.prize.total);
  let a = f && f.announce || null;
  const m = !a && f && String(f.announce_text).match(/(\d{1,2})\s*월/);
  if (m){
    const base = c.deadline || '2000-01-01', y = Number(base.slice(0, 4)) + (Number(m[1]) < Number(base.slice(5, 7)) ? 1 : 0);
    const end = new Date(Date.UTC(y, Number(m[1]), 0)).toISOString().slice(0, 10), part = String(f.announce_text);
    a = /초/.test(part) ? `${end.slice(0, 8)}10` : /중/.test(part) ? `${end.slice(0, 8)}20` : end;   // 초 10일 · 중 20일 · 말·그 밖 말일
  }
  return { deadline: c.deadline || null, prize: p || null, announce: a };
}

export function methodStats(cs){
  const n = {};
  for (const c of cs) if (c.fit && c.fit.target && !c.dup_of && c.fit.submit.method) n[c.fit.submit.method] = (n[c.fit.submit.method] || 0) + 1;
  const top = Object.entries(n).filter(([k]) => k !== 'etc').sort((a, b) => b[1] - a[1]), rest = top.slice(3).reduce((a, [, v]) => a + v, n.etc || 0);   // 넷째부터와 '기타'는 '기타' 하나로
  return [...top.slice(0, 3).map(([k, v]) => `${METHODS[k]} ${v}`), ...(rest ? [`기타 ${rest}`] : [])].join(' · ');
}
export const names = d => d.items.map(x => x.text).join(' · ');

// 사이트마다 제목이 달라도 같은 공모전이면 하나로 — 주최·마감일이 같고, 제목이 비슷하거나(한쪽이 다른 쪽을 품거나 두 글자 묶음이 절반 넘게 겹침)
// 받는 작품과 접수처가 같을 때만. 정보가 많은 쪽을 남기고 나머지는 dup_of로 숨긴다(사람이 손댄 것은 그대로). 확신이 없으면 둘 다 남긴다
const org = v => String(v || '').replace(/\(.*?\)|주식회사|\(주\)|[^\p{L}\p{N}]/gu, '').toLowerCase();
const norm = t => String(t || '').replace(/\d{4}년?|제\s*\d+\s*회|공모전?|[^\p{L}\p{N}]/gu, '').toLowerCase();
const grams = t => { const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
export function similar(a, b){
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const x = grams(a), y = grams(b), both = [...x].filter(g => y.has(g)).length;
  return both / Math.min(x.size, y.size) >= 0.5;
}
// 목록 단계(요강을 받기 전): 마감일이 같거나 하루 차이(위비티는 D-day로 계산해 하루 어긋날 수 있다)이고, 제목이 비슷하고, 주최가 둘 다 있으면 한쪽이 다른 쪽을 품을 때.
// 마감일을 모르는 쪽이 있으면 제목이 완전히 같을 때만 — 해마다 같은 이름으로 여는 공모전을 잘못 묶지 않게
const exact = t => String(t || '').replace(/\d{4}년?|제\s*\d+\s*회|[^\p{L}\p{N}]/gu, '').toLowerCase();
export function sameListing(a, b){
  const strict = t => String(t || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();   // 연도까지 같아야
  if (!a.deadline || !b.deadline) return !!strict(a.title) && strict(a.title) === strict(b.title);
  if (Math.abs(Date.parse(a.deadline) - Date.parse(b.deadline)) > 86400000) return false;
  const oa = org(a.organizer), ob = org(b.organizer);
  if (oa && ob && !oa.includes(ob) && !ob.includes(oa)) return exact(a.title) === exact(b.title);
  return similar(a.title, b.title);
}
const sameEntry = (a, b) => similar(a.title, b.title) || (!!a.fit.submit.to && a.fit.submit.to === b.fit.submit.to && kindLabel(a.fit) === kindLabel(b.fit));
const KNOWN = ['email', 'form', 'nform', 'oform', 'site', 'post', 'youtube', 'sns', 'visit'];
// 접수 방식이나 접수처를 아직 모른다 — 다른 사이트의 같은 공모전에서 채워 볼 것
export const weak = f => !f.submit.to || !KNOWN.includes(f.submit.method);
const richness = c => (c.fit.announce ? 2 : 0) + (c.fit.submit.to ? 2 : 0) + (KNOWN.includes(c.fit.submit.method) ? 1 : 0) + (c.fit.prize.total ? 1 : 0);
// 남길 것: 낸 것 > AI 안이 있는 것 > 다시 넣은 것 > 낼 수 있는 것 > 정보가 많은 것. 내가 뺀 것은 맨 뒤(중복이라 뺀 쪽을 남기지 않게)
const rank = c => (c.submitted ? 200 : 0) + (c.draft ? 40 : 0) + (c.forced ? 20 : 0) + (c.fit.target && c.fit.eligibility.ok !== 'no' ? 10 : 0) - (c.dropped ? 100 : 0) + richness(c);
// 이미 있는 기록에서 같은 공모전을 하나로 — 목록 단계와 같은 눈(sameListing)으로, 제목이 달라도 주최·마감이 같고 받는 작품·접수처가 같으면.
// 나머지는 dup_of로 숨기고, 숨긴 쪽만 아는 접수처·발표일·AI 안은 남긴 쪽에 옮긴다. 낸 기록은 숨기지 않는다
export function mergeDups(cs){
  const kept = [];
  let n = 0;
  for (const c of cs.filter(c => c.fit && !c.dup_of).sort((a, b) => rank(b) - rank(a))){
    const keep = c.submitted ? null : kept.find(k => sameListing(k, c) || (!!c.deadline && k.deadline === c.deadline && !!org(c.organizer) && org(k.organizer) === org(c.organizer) && sameEntry(k, c)));
    if (!keep){ kept.push(c); continue; }
    c.dup_of = keep.key; n++;
    keep.also = [...(keep.also || []), { key: c.key, source: c.source, url: c.url }, ...(c.also || [])].filter((a, i, all) => a.key !== keep.key && all.findIndex(b => b.key === a.key) === i);
    if (!keep.fit.announce && c.fit.announce){ keep.fit.announce = c.fit.announce; keep.fit.announce_text = ''; }
    if (weak(keep.fit) && (!weak(c.fit) || (c.fit.submit.to && !keep.fit.submit.to))) Object.assign(keep.fit.submit, { method: c.fit.submit.method, to: c.fit.submit.to, how: c.fit.submit.how || keep.fit.submit.how, subject: c.fit.submit.subject || keep.fit.submit.subject });
    if (!keep.draft && c.draft) keep.draft = c.draft;
  }
  return n;
}
