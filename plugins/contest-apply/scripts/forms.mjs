// 구글 폼·네이버 폼 — 문항을 읽고(readForm) 답을 검사해(checkAnswers) 제출한다(submitForm). fetch는 주입받는다.
// 캡차·로그인·본인확인은 넘지 않고 reason으로 알린다. 쿠키·토큰은 제출하는 그 호출 안에서만 쓰고 form에 남기지 않는다.
// 구글 제출 형식은 널리 쓰이는 방식이고 실제 서버 제출로 확인하지 않았다 — 확인 화면을 못 보면 sure: false.
// 유형·설정마다 무엇을 근거로 했는지(실제 표본·nform.js 코드·추정)는 docs/contest-forms.md에 적어 둔다.
import crypto from 'node:crypto';

const UA = 'pkm-contest/0.4 (personal use)';
const G = 'https://docs.google.com/forms/d', NAPI = 'https://survey-api.naver.com/api/form', NPAGE = 'https://form.naver.com/response';
const SHORT = new Set(['forms.gle', 'naver.me']);
const PICK = new Set(['choice', 'multi', 'dropdown', 'scale', 'agree', 'category']), TEXT = new Set(['short', 'long']), LINES = new Set(['multi', 'grid', 'category']);
const EMAIL = /^[\w.+-]+@([\w-]+\.)+[\w-]{2,}$/;
const host = u => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const cut = (s, n) => String(s ?? '').trim().slice(0, n);
const err = (error, reason = 'unknown') => ({ error, reason });
const no = (reason, message, sent = false) => ({ ok: false, sent, reason, message });
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const decode = s => String(s || '').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENT[e]);
const esc = s => String(s).replace(/[&<>"']/g, c => `&${Object.keys(ENT).find(k => ENT[k] === c)};`);

export const kindOf = url => {
  let u; try { u = new URL(url); } catch { return ''; }
  const h = u.hostname.toLowerCase();
  if (!/^https?:$/.test(u.protocol)) return '';
  if (h === 'forms.gle' || (h === 'docs.google.com' && u.pathname.startsWith('/forms/'))) return 'google';
  return h === 'form.naver.com' || h === 'naver.me' ? 'naver' : '';
};

/* ---------- 요청 ---------- */
const call = (fetch, url, opt = {}) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...opt, headers: { 'user-agent': UA, ...opt.headers } });
const cookieOf = r => (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
const withCookie = cookie => cookie ? { cookie } : {};
// 짧은 주소(forms.gle·naver.me)는 Location만 읽는다 — naver.me는 아무 데로나 갈 수 있어 끝까지 따라가지 않는다
async function expand(fetch, url){
  for (let i = 0; i < 4 && SHORT.has(host(url)); i++){
    const r = await call(fetch, url), loc = r.headers.get('location');
    await r.body?.cancel();
    if (!loc) return '';
    url = new URL(loc, url).href;
  }
  return SHORT.has(host(url)) ? '' : url;
}

/* ---------- 문항 꼴 맞추기 ---------- */
// '(500자 이내)'·'150자 미만' 같은 안내가 하나뿐이면 글자 수 제한으로 읽는다
const hint = s => { const m = [...String(s || '').matchAll(/(\d[\d,]*)\s*자\s*(이내|이하|까지|미만)/g)]; return m.length === 1 ? Number(m[0][1].replace(/,/g, '')) - (m[0][2] === '미만' ? 1 : 0) : 0; };
const limitOf = (cap, title, desc) => { const h = hint(title) || hint(desc); return cap && h ? Math.min(cap, h) : cap || h; };
const countRule = (min, max) => min && max ? (min === max ? `${min}개 고르기` : `${min}개 이상 ${max}개 이하 고르기`) : min ? `${min}개 이상 고르기` : max ? `${max}개까지 고르기` : '';
const scaleRule = (opts, low, high) => opts.length ? `${opts[0]}${low ? `(${low})` : ''}~${opts.at(-1)}${high ? `(${high})` : ''}` : '';
const JUMP = '이동 규칙을 확신하지 못하는 폼이에요(뒤로 돌아가거나 모르는 곳으로 가는 이동)';
// 문항 하나 — rows·many는 표·여러 개 고르는 유형에만 붙는다
const ask = (id, o) => ({ id, title: String(o.title || '').trim(), desc: cut(o.desc, 600), type: o.type, field: o.field || '', required: !!o.required, options: o.options || [], other: !!o.other, limit: o.limit || 0, page: o.page,
  ...(o.rows ? { rows: o.rows } : {}), ...(o.many != null ? { many: !!o.many } : {}), rule: o.rule || '' });
const sigOf = (kind, id, qs) => crypto.createHash('sha256').update(JSON.stringify([kind, id, qs.map(q => [q.title, q.type, q.required, q.options, q.other, q.rows || [], !!q.many, q.rule])])).digest('hex').slice(0, 12);
function shape({ kind, id, url, title, description, closed = '', login = false, blockers = [], pages = 0, questions = [], raw = {} }){
  const why = [...(closed ? [closed] : []), ...(login ? [`${kind === 'google' ? '구글' : '네이버'} 로그인이 필요한 폼이에요`] : []), ...new Set(blockers)];
  return { kind, id, url, title: cut(title, 300), description: cut(description, 3000), open: !closed, closed, login, blockers: why, pages, questions, sig: sigOf(kind, id, questions), raw };
}

/* ---------- 구글 폼 ---------- */
// FB_PUBLIC_LOAD_DATA_: d[1][1] 항목 [id, 제목, 설명, 유형, [[entryId, 보기, 필수, 라벨, 검증, …]], 섹션 이동], d[1][10] 응답 설정, d[14] 'e/<폼 id>'
// 유형 0 단답 1 장문 2 객관식 3 드롭다운 4 체크박스 5 선형 배율 7 그리드 9 날짜(표본으로 확인) · 10 시간 13 파일 18 평점(표본 없음, 추정)
const GTYPE = { 0: 'short', 1: 'long', 2: 'choice', 3: 'dropdown', 4: 'multi', 5: 'scale', 7: 'grid', 9: 'date', 10: 'time', 13: 'file', 18: 'scale' };
const GSKIP = new Set([6, 8, 11, 12]);   // 제목·섹션·그림·영상은 답을 받지 않는다
const flag = (html, name) => html.includes(`data-${name}="true"`);   // 폼 화면이 상태를 적어 두는 속성
const regex = (p, full) => { try { return String(p).length <= 300 ? new RegExp(full ? `^(?:${p})$` : p) : null; } catch { return null; } };
// 응답 검증 [종류, 조건, [값…], 오류 글] → [읽을 글, 통과 검사]. 표본으로 본 것은 1/9(숫자)·2/102(이메일)·6/202(최대 길이)뿐이고 나머지 번호는 추정
const GRULE = {
  1: { 1: [a => `${a[0]}보다 큰 숫자`, (n, a) => n > a[0]], 2: [a => `${a[0]} 이상인 숫자`, (n, a) => n >= a[0]], 3: [a => `${a[0]}보다 작은 숫자`, (n, a) => n < a[0]], 4: [a => `${a[0]} 이하인 숫자`, (n, a) => n <= a[0]],
    5: [a => `숫자 ${a[0]}`, (n, a) => n === Number(a[0])], 6: [a => `${a[0]}이 아닌 숫자`, (n, a) => n !== Number(a[0])], 7: [a => `숫자 ${a[0]}~${a[1]}`, (n, a) => n >= a[0] && n <= a[1]],
    8: [a => `${a[0]}~${a[1]} 밖의 숫자`, (n, a) => n < a[0] || n > a[1]], 9: [() => '숫자', () => true], 10: [() => '정수', n => Number.isInteger(n)] },
  2: { 100: [a => `'${a[0]}'이 들어가게`, (v, a) => v.includes(a[0])], 101: [a => `'${a[0]}'이 들어가지 않게`, (v, a) => !v.includes(a[0])], 102: [() => '이메일 꼴', v => EMAIL.test(v)], 103: [() => 'URL 꼴', v => /^\S+\.\S+$/.test(v)] },
  4: { 299: [a => `정규식 ${a[0]}이 들어가게`, (v, a) => regex(a[0])?.test(v) ?? true], 300: [a => `정규식 ${a[0]}이 들어가지 않게`, (v, a) => !(regex(a[0])?.test(v) ?? false)],
    301: [a => `정규식 ${a[0]}에 맞게`, (v, a) => regex(a[0], true)?.test(v) ?? true], 302: [a => `정규식 ${a[0]}에 맞지 않게`, (v, a) => !(regex(a[0], true)?.test(v) ?? false)] },
  6: { 203: [a => `${a[0]}자 이상`, (v, a) => v.length >= a[0]] },
};
const passes = ([kind, cond, args], v) => { const f = GRULE[kind]?.[cond]?.[1]; if (!f) return true; if (kind !== 1) return f(v.slice(0, 5000), args || []); return /^-?(\d+\.?\d*|\.\d+)$/.test(v) && f(Number(v), args || []); };
function googleForm(d, html){
  const id = /^e\/([\w-]+)$/.exec(d[14] || '')?.[1], set = d[1][10], items = d[1][1] || [], blockers = [], questions = [], raw = { action: `${G}/e/${id}/formResponse`, confirm: cut(d[1][2]?.[0], 200), after: [], q: {} };
  if (!id) throw new Error('no id');
  // 섹션 항목이 여는 페이지. 섹션의 이동 값은 '그 앞 페이지를 마친 뒤 어디로'다(실제 폼 두 개로 확인) — null·-2 다음, -3 제출, 그 밖은 섹션 항목 id
  const opens = new Map(items.filter(it => it[3] === 8).map((it, i) => [it[0], i + 2]));
  const target = (v, from) => { if (v == null || v === -2) return null; const to = v === -3 ? 0 : opens.get(v); if (to == null || (to && to <= from)) blockers.push(JUMP); return to ?? null; };
  const add = (it, o) => { const q = ask(`q${questions.length + 1}`, o); questions.push(q); raw.q[q.id] = it; };
  // 이메일 수집 '응답자 입력' — 첫 페이지 맨 앞의 필수 칸, emailAddress로 보낸다(화면의 칸은 표본 8개로 확인, 보내는 이름은 추정)
  if (Array.isArray(set) && set[6] === 3) add({ email: true }, { title: '이메일 주소', desc: '이 폼은 응답과 함께 이메일 주소를 받아요', type: 'short', field: 'email', required: true, page: 1 });
  let page = 1;
  for (const it of items){
    const [, title, desc, type, entries] = it;
    if (type === 8){ raw.after[page - 1] = target(it[5], page); page++; continue; }
    if (GSKIP.has(type)) continue;
    const e = entries?.[0] || [], opts = e[1] || [], many = type === 7 ? e[11]?.[0] === 1 : undefined;   // 체크박스 그리드 표시(e[11]=[1])는 추정 — 표본은 [0]과 없음뿐
    let kind = e[0] && (type === 7 || entries.length === 1) ? GTYPE[type] || 'other' : 'other';
    if (kind === 'scale' && !opts.length) kind = 'other';
    if (kind === 'date' && e[7]?.[0] === 1) kind = 'datetime';
    if (kind === 'time' && e[6]?.[0] === 1) kind = 'duration';
    if (kind === 'file') blockers.push('파일 올리기 문항이 있어요');
    if (kind === 'other') blockers.push('자동으로 못 채우는 문항 유형이 있어요');
    const pick = PICK.has(kind), labels = opts.filter(o => o[4] !== 1).map(o => String(o[0] ?? '')), v = (e[4] || [])[0] || [], rule = GRULE[v[0]]?.[v[1]]?.[0];
    const min = v[0] === 7 && v[1] !== 201 ? Number(v[2]?.[0]) || 0 : 0, max = v[0] === 7 && v[1] !== 200 ? Number(v[2]?.[0]) || 0 : 0;   // 체크박스 200 최소·201 최대·204 정확히(추정)
    const go = type === 2 || type === 3 ? opts.filter(o => o[4] !== 1).map(o => target(o[2], page)) : [];
    if (go.some(x => x != null) && questions.some(q => q.page === page && raw.q[q.id].go)) blockers.push('한 페이지에 답에 따른 이동이 둘 이상 걸려 있어요');
    const year = e[7]?.[1] !== 0;
    add({ entry: e[0], ...(kind === 'date' || kind === 'datetime' ? { year } : {}), ...(kind === 'grid' ? { rows: entries.map(x => x[0]) } : {}), ...(go.some(x => x != null) ? { go } : {}),
      ...(rule ? { check: [v[0], v[1], v[2] || []] } : {}), ...(min || max ? { min, max } : {}) },
    { title, desc, type: kind, required: kind === 'grid' ? entries.some(x => x[2] === 1) : e[2] === 1, options: kind === 'grid' ? opts.map(o => String(o[0] ?? '')) : pick ? labels : [], other: pick && opts.some(o => o[4] === 1),
      limit: TEXT.has(kind) ? Number(v[0] === 6 && v[1] === 202 && v[2]?.[0]) || limitOf(0, title, desc) : 0, page, ...(kind === 'grid' ? { rows: entries.map(x => String(x[3]?.[0] ?? '')), many } : {}),
      rule: kind === 'scale' ? scaleRule(labels, e[3]?.[0], e[3]?.[1]) : kind === 'grid' ? (many ? '행마다 여러 개 고를 수 있어요' : '행마다 하나씩 고르기') : kind === 'multi' ? countRule(min, max)
        : kind === 'date' && !year ? '연도 없이 월-일만' : kind === 'file' ? '파일은 폼에서 직접 올려야 해요' : rule ? rule(v[2] || []) : TEXT.has(kind) && v.length && !(v[0] === 6 && v[1] === 202) ? cut(v[3], 80) || '응답 검증이 걸려 있어요' : '' });
    if (kind === 'grid' && new Set(questions.at(-1).rows).size !== entries.length) blockers.push('표의 행 이름이 겹쳐요');
  }
  // 화면의 data-sign-in-to-continue가 확실한 표시. 응답 설정 [0 진행률 표시, 1 응답 1회 제한(로그인), 3 응답 사본(추정), 6 이메일 수집 1 안 함·2 확인된 계정·3 직접 입력] —
  // [1]·d[18]은 표본 40개에서 로그인 표시와 늘 같이 켜졌다. 설정을 읽지 못하면 로그인 필요로 본다
  const login = flag(html, 'sign-in-to-continue') || !Array.isArray(set) || set[1] === 1 || (set[6] !== 1 && set[6] !== 3) || d[18] === 1;
  if (flag(html, 'should-execute-invisible-captcha-on-form-submit') || flag(html, 'should-execute-invisible-captcha-challenge')) blockers.push('사람인지 확인(캡차)을 거치는 폼이에요');
  return shape({ kind: 'google', id, url: `${G}/e/${id}/viewform`, title: d[1][8] || d[3], description: d[1][0], login, blockers, pages: page, questions, raw });
}
async function loadGoogle(url, fetch){
  const m = /^https?:\/\/docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/((?:e\/)?[\w-]+)/.exec(await expand(fetch, url));
  if (!m) return err('구글 폼 주소가 아니에요');
  let at = `${G}/${m[1]}/viewform`, r;
  for (let i = 0; i < 3 && !r; i++){   // 같은 사이트 안의 리다이렉트만 따라간다
    const got = await call(fetch, at, { headers: { 'accept-language': 'ko' } }), loc = got.status >= 300 && got.status < 400 && got.headers.get('location');
    if (!loc) { r = got; break; }
    await got.body?.cancel();
    at = new URL(loc, at).href;
    if (host(at) !== 'docs.google.com') return /(^|\.)google\.com$/.test(host(at)) ? err('구글 로그인이 필요한 폼이라 문항을 읽지 못했어요', 'login') : err('구글 폼이 다른 사이트로 넘겨요');
  }
  if (r?.status !== 200) { await r?.body?.cancel(); return err(r?.status === 404 ? '없는 구글 폼이에요' : `구글 폼을 읽지 못했어요(${r?.status || '리다이렉트가 너무 많아요'})`); }
  const html = await r.text(), json = /FB_PUBLIC_LOAD_DATA_\s*=\s*([\s\S]*?);\s*<\/script>/.exec(html)?.[1];
  if (/\/closedform/.test(at) || (!json && /응답을 받지 않|no longer accepting responses/i.test(html))){
    const id = /\/forms\/d\/e\/([\w-]+)/.exec(at)?.[1] || m[1].replace(/^e\//, '');
    return { form: shape({ kind: 'google', id, url: `${G}/e/${id}/viewform`, title: decode(/<meta property="og:title" content="([^"]*)"/.exec(html)?.[1]), closed: '더 이상 응답을 받지 않는 폼이에요' }), session: {} };
  }
  try { return { form: googleForm(JSON.parse(json), html), session: { cookie: cookieOf(r), fbzx: /name="fbzx" value="(-?\d+)"/.exec(html)?.[1] || '' } }; }
  catch { return err('구글 폼 문항을 읽지 못했어요(형식이 바뀐 것 같아요)'); }
}
// entry.<id>=값 쌍 — 거치는 문항만. 체크박스는 같은 이름 반복, '기타'는 __other_option__ + .other_option_response, 표는 행마다 entry.<행 id>=열,
// 날짜·시간은 _year/_month/_day/_hour/_minute/_second(미리 채우기 주소에서는 한 값)
function googlePairs(form, answers, { prefill = false, skip = [] } = {}){
  const out = [], shown = new Set(visible(form, answers));
  for (const q of form.questions){
    const it = form.raw?.q?.[q.id] || {}, a = answerOf(q, answers), name = `entry.${it.entry}`, n = a.length ? a[0].split(/[-: ]/).map(Number) : [];
    if (!shown.has(q.id) || skip.includes(q.id) || !a.length) continue;
    if (it.email) out.push(['emailAddress', a[0]]);
    else if (!it.entry) continue;
    else if (q.type === 'grid') out.push(...a.map(l => cell(q, l)).filter(c => !c.includes(-1)).map(([r, c]) => [`entry.${it.rows[r]}`, q.options[c]]));
    else if (prefill && /^(date|time|datetime|duration)$/.test(q.type)) out.push([name, a[0]]);
    else if (q.type === 'date' || q.type === 'datetime'){
      const [y, mo, d, h, mi] = n.length === 2 ? [0, ...n] : n;
      out.push(...(it.year ? [[`${name}_year`, y]] : []), [`${name}_month`, mo], [`${name}_day`, d], ...(q.type === 'datetime' ? [[`${name}_hour`, h], [`${name}_minute`, mi]] : []));
    } else if (q.type === 'time' || q.type === 'duration') out.push([`${name}_hour`, n[0]], [`${name}_minute`, n[1]], ...(q.type === 'duration' ? [[`${name}_second`, n[2]]] : []));
    else if (PICK.has(q.type) || TEXT.has(q.type)) for (const v of a){
      if (!PICK.has(q.type) || q.options.includes(v)) out.push([name, prefill ? v : v.replace(/\n/g, '\r\n')]);   // 브라우저는 폼을 보낼 때 줄바꿈을 CRLF로 바꾼다
      else out.push([name, '__other_option__'], [`${name}.other_option_response`, v]);
    }
  }
  return out.map(([k, v]) => [k, String(v)]);
}
async function sendGoogle(form, s, answers, fetch){
  if (!s.fbzx) return no('unknown', '구글 폼에서 제출에 필요한 값을 찾지 못했어요. 브라우저에서 직접 내 주세요');
  // pageHistory는 답에 따라 실제로 거친 페이지만(0부터)
  const body = new URLSearchParams([...googlePairs(form, answers), ['fvv', '1'], ['partialResponse', `[null,null,"${s.fbzx}"]`], ['pageHistory', route(form, answers).map(p => p - 1).join(',')], ['fbzx', s.fbzx]]).toString();
  const r = await call(fetch, form.raw.action, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept-language': 'ko', origin: 'https://docs.google.com', referer: form.url, ...withCookie(s.cookie) } });
  const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') || '' : '', html = loc ? '' : await r.text();
  if (loc) return /accounts\.google\.com/.test(loc) ? no('login', '구글 로그인을 요구해요. 브라우저에서 직접 내 주세요') : /closedform/.test(loc) ? no('closed', '더 이상 응답을 받지 않는 폼이에요') : no('unknown', '제출 뒤에 다른 주소로 넘겨졌어요. 기록됐는지 알 수 없어요 — 다시 보내기 전에 확인해 주세요', 'unknown');
  if (r.status === 429 || flag(html, 'captcha-challenge-failed') || /g-recaptcha|unusual traffic|비정상적인 트래픽/i.test(html)) return no('challenge', '구글이 사람인지 확인을 요구해요. 브라우저에서 직접 내 주세요');
  if (flag(html, 'sign-in-to-continue')) return no('login', '구글 로그인을 요구해요. 브라우저에서 직접 내 주세요');
  if (flag(html, 'too-many-responses')) return no('duplicate', '이미 응답한 폼이에요(한 번만 낼 수 있어요)');
  if (flag(html, 'validation-failed')) return no('invalid', '구글 폼이 답을 받지 않았어요(형식·필수 항목 검증 실패)');
  if (r.status === 400) return no('invalid', '구글 폼이 답을 받지 않았어요(형식·필수 항목 검증 실패)');
  if (r.status === 401) return no('login', '구글 로그인을 요구해요. 브라우저에서 직접 내 주세요');
  if (r.status === 404 || r.status === 410) return no('closed', '폼이 없어졌거나 더 이상 응답을 받지 않아요');
  if (r.status >= 500) return no('unknown', `구글 폼 서버 오류(${r.status})예요. 기록됐는지 알 수 없어요 — 다시 보내기 전에 확인해 주세요`, 'unknown');
  if (r.status !== 200) return no('unknown', `구글 폼이 받지 않았어요(${r.status})`);
  // 폼 화면이 다시 오면(숨은 입력 fbzx가 있다) 확인 화면이 아니다
  if (/name="fbzx"/.test(html)) return no('unknown', '제출 뒤에 폼 화면이 다시 왔어요. 기록되지 않았을 가능성이 높지만 확실하지 않아요 — 브라우저에서 확인해 주세요', 'unknown');
  const first = form.raw.confirm.split('\n')[0].trim();
  const sure = /응답이 기록되었습니다|Your response has been recorded|usp=form_confirm/.test(html) || (first.length >= 6 && (html.includes(first) || html.includes(esc(first))));
  return { ok: true, sure, message: sure ? '제출했어요(확인 화면을 봤어요)' : '보냈지만 확인 화면을 찾지 못했어요. 접수됐는지 직접 확인해 주세요' };
}

/* ---------- 네이버 폼 ---------- */
// 웹 클라이언트(nform 2.10.5)가 보내는 답 item: { questionId, type, refId(보기 id, 글 답은 null), value } — 유형마다 컴포넌트 코드로 확인했다
// [우리 유형, field, 화면이 막는 글자 수]
const NTYPE = { NAME: ['short', 'name', 200], PHONE_NUMBER: ['short', 'phone', 15], EMAIL: ['short', 'email'], SHORT_TEXT: ['short', '', 100], LONG_TEXT: ['long', '', 2000],
  CHOICE: ['choice'], MULTI_CHOICE: ['multi'], DROPDOWN: ['dropdown'], AGREE: ['agree'], AGREE_V2: ['agree'], LIKERT_SCALE: ['scale'], STAR_RATE: ['scale'], GRID: ['grid'],
  CALENDAR: ['date'], NUMERIC: ['number'], NUMERIC_REAL: ['number'], ADDRESS: ['address'], CATEGORY: ['category'] };
// 끝내 자동 제출을 못 하는 유형(파일을 먼저 올리거나 네이버 로그인 정보가 있어야 한다)
const NBLOCK = { UPLOAD_IMAGE: ['file', '사진 올리기 문항이 있어요'], UPLOAD_FILE: ['file', '파일 올리기 문항이 있어요'], AGREE_NVUSER: ['other', '네이버 회원 정보를 불러와 동의하는 문항이 있어요(로그인 필요)'] };
const NAGREE = { Y: '동의합니다', N: '동의하지 않습니다' }, NPART = { item: '수집 항목', purpose: '목적', period: '보유 기간', target: '제공받는 자', trustee: '수탁자', task: '위탁 업무' };
const NCLOSED = { FINISHED: '끝난 설문이에요', PAUSED: '잠시 멈춘 설문이에요', FORCE_PAUSED: '잠시 멈춘 설문이에요' };
const NDATE = { INCLUDE_TIME: 'datetime', ONLY_TIME: 'time' };
const ADDR = "'(우편번호) 도로명주소 | 상세주소' 꼴";
const delta = d => Array.isArray(d) ? d.map(x => typeof x?.insert === 'string' ? x.insert : '').join('') : '';
function naverForm(j, id){
  const pages = j.pages || [], opt = j.options || {}, blockers = [], questions = [], raw = { after: pages.map(() => null), q: {} };
  // 이동: 건너뛸 칸 수(1이 다음 페이지). 끝을 넘으면 제출, 1보다 작으면 믿지 않는다
  const target = (pi, off) => { if (!(off >= 1)) { blockers.push(JUMP); return null; } return pi + off >= pages.length ? 0 : pi + off + 1; };
  pages.forEach((p, pi) => {
    if (pi < pages.length - 1 && (p.nextPageOffset ?? 1) !== 1) raw.after[pi] = target(pi, p.nextPageOffset);
    for (const x of p.questions || []){
      if (x.type === 'INFORM') continue;   // 안내만 하고 답을 받지 않는다
      const P = x.props || {}, cap = NTYPE[x.type]?.[2] || 0, field = NTYPE[x.type]?.[1] || '';
      let type = NTYPE[x.type]?.[0] || NBLOCK[x.type]?.[0] || 'other', items = [], more = {};
      if (!NTYPE[x.type]) blockers.push(NBLOCK[x.type]?.[1] || `자동으로 못 채우는 문항이 있어요: ${x.type}`);
      const many = !!x.options?.multiSelect, picks = (x.items || []).filter(i => i.value !== '' && i.value != null);
      if (x.type === 'CALENDAR') type = NDATE[P.type] || 'date';
      else if (x.type === 'GRID'){
        // 행·열 이름은 props에, 칸의 id는 items('행,열' 1부터)에 있다. 화면은 행마다 하나만 고르게 한다
        const rows = (P.rowHeaders || []).map(String), cols = (P.colHeaders || []).map(String);
        if ([rows, cols].some(h => !h.length || h.includes('') || new Set(h).size !== h.length)) blockers.push('표의 행·열 이름이 비었거나 겹쳐요');
        more = { rows, many: false, options: cols, rule: '행마다 하나씩 고르기', cells: Object.fromEntries((x.items || []).map(i => [i.value, i.id])) };
      } else if (x.type === 'CATEGORY'){
        // 대분류 아래 소분류를 고른다. 값은 '대분류·소분류', refId는 값이 같은 item의 id(없으면 null) — 화면과 같게
        const leaves = (P.categories || []).flatMap(c => (c.next || []).map(s => [c.value, s.value, s.next]));
        if (leaves.some(l => l[2]?.length) || (P.maxLevel ?? 2) !== 2) blockers.push('세 단계가 넘는 카테고리 문항이 있어요');
        items = leaves.filter(l => l[0] && l[1]).map(l => l.slice(0, 2).join('·')).map(v => ({ id: (x.items || []).find(i => i.value === v)?.id ?? null, value: v }));
        more = { many, rule: [many ? '여러 개 고를 수 있어요' : '하나만 고르기', countRule(P.min, P.max)].filter(Boolean).join(' · ') };
      } else if (PICK.has(type)) items = picks;
      const go = /^(CHOICE|AGREE_V2)$/.test(x.type) && !many ? items.map(i => i.skipOffset ? target(pi, i.skipOffset) : null) : [];
      const terms = (P.items || []).map(t => t.description && `${NPART[t.type] || t.title || ''}: ${t.description}`).filter(Boolean).join('\n');
      const desc = [x.description, delta(x.richDescription).trim(), /^AGREE/.test(x.type) ? terms : ''].filter(Boolean).join('\n'), values = items.map(i => String(i.value));
      const rule = more.rule || (x.type === 'LIKERT_SCALE' ? scaleRule(values, P.minValue, P.maxValue) : x.type === 'STAR_RATE' ? `별점 ${values[0]}~${values.at(-1)}` : x.type === 'MULTI_CHOICE' ? countRule(P.min, P.max)
        : x.type === 'NUMERIC' ? ['숫자만(0 이상 정수)', [P.prefix, P.suffix].filter(Boolean).join('…') && `단위 ${[P.prefix, P.suffix].filter(Boolean).join('…')}`].filter(Boolean).join(' · ')
        : x.type === 'NUMERIC_REAL' ? '숫자(음수·소수 가능)' : x.type === 'ADDRESS' ? `${ADDR}. 우편번호를 빼면 제출할 때 주소 검색으로 하나로 정해져야 해요` : type === 'file' ? '파일은 폼에서 직접 올려야 해요' : '');
      const q = ask(`q${questions.length + 1}`, { title: x.title, desc, type, field, required: x.options?.required,
        options: more.options || (x.type === 'AGREE' ? ['동의', '동의하지 않음'] : items.map(i => x.type === 'AGREE_V2' ? NAGREE[String(i.value).toUpperCase()] || String(i.value) : String(i.value))),
        other: (type === 'choice' || type === 'multi') && !!x.options?.customValue, limit: TEXT.has(type) ? limitOf(cap, x.title, desc) : type === 'address' ? 200 : type === 'number' ? 30 : 0, page: pi + 1, rows: more.rows, many: more.many, rule });
      questions.push(q);
      raw.q[q.id] = { qid: x.id, type: x.type, items: items.map(i => ({ id: i.id, value: i.value })), ...(more.cells ? { cells: more.cells } : {}), ...(go.some(g => g != null) ? { go } : {}),
        ...(/^(MULTI_CHOICE|CATEGORY)$/.test(x.type) ? { min: P.min || 0, max: P.max || 0 } : {}) };
    }
  });
  if (j.restricted || opt.allowedUserIds?.length) blockers.push('응답할 수 있는 사람이 정해진 설문이에요');
  return shape({ kind: 'naver', id, url: `${NPAGE}/${id}`, title: j.title, description: [j.description, delta(j.richDescription)].filter(Boolean).join('\n'),
    closed: j.status === 'IN_PROGRESS' ? '' : NCLOSED[j.status] || '설문 기간이 아니에요', login: opt.allowAnonymous !== true || !!opt.allowedUserIds?.length, blockers, pages: pages.length, questions, raw });
}
// 웹 화면과 같은 헤더(origin·referer)로 부른다. 익명 응답자는 access가 주는 anonymous 쿠키로 구분된다(survey_uid 헤더는 로그인한 화면에만 있다)
async function napi(fetch, id, path, { cookie, ...opt } = {}){
  const r = await call(fetch, `${NAPI}${path}`, { ...opt, headers: { accept: 'application/json, text/plain, */*', origin: 'https://form.naver.com', referer: `${NPAGE}/${id}`, ...withCookie(cookie), ...opt.headers } });
  let data = null; try { data = JSON.parse(await r.text()); } catch {}
  return { status: r.status, data, cookie: cookieOf(r) };
}
async function loadNaver(url, fetch){
  const id = /^https?:\/\/form\.naver\.com\/response\/([\w-]+)/.exec(await expand(fetch, url))?.[1];
  if (!id) return err('네이버 폼 응답 주소가 아니에요');
  const a = await napi(fetch, id, `/surveys/${id}/access?ignoreCount=true`);
  if (a.data?.error === 'REDIRECT') return err('로그인해야 볼 수 있는 네이버 폼이에요(없는 폼일 수도 있어요)', 'login');
  if (a.data?.error === 'PII_AUTH') return err('본인 확인을 해야 볼 수 있는 네이버 폼이에요', 'challenge');
  if (a.status !== 200 || !Array.isArray(a.data?.pages)) return err(`네이버 폼을 읽지 못했어요(${a.status})`);
  try { return { form: naverForm(a.data, id), session: { cookie: a.cookie, token: a.data.taToken, at: Date.now() } }; }
  catch { return err('네이버 폼 문항을 읽지 못했어요(형식이 바뀐 것 같아요)'); }
}
const NERR = { DUPLICATED: ['duplicate', '이미 참여한 설문이에요'], LIMIT_EXCEEDED: ['closed', '참여 인원이 다 찼어요'], NOT_IN_PROGRESS: ['closed', '설문 기간이 아니에요'], FINISHED: ['closed', '끝난 설문이에요'],
  INVALID_PARAM: ['invalid', '설문이 바뀌었거나 답 형식이 맞지 않아 네이버 폼이 받지 않았어요'], REDIRECT: ['login', '네이버 로그인을 요구해요. 브라우저에서 직접 내 주세요'], PII_AUTH: ['challenge', '본인 확인을 요구해요. 브라우저에서 직접 내 주세요'] };
const squeeze = v => v.replace(/ +/g, ' ').replace(/\n{3,}/g, '\n\n').trim();   // 화면이 글 답을 보내기 전에 하는 정리
const nNo = (code, status, sent = false) => no(...(NERR[code] || [status === 400 ? 'invalid' : 'unknown', `네이버 폼이 응답을 받지 않았어요(${code || status})`]), sent);
// 날짜 값은 브라우저 현지 시각으로 만든 epoch(ms) 글이다 — 한국 시각(UTC+9)의 브라우저가 만드는 값으로 맞춘다. 날짜만이면 그날 UTC 0시, 시간만이면 1970-01-01의 그 시각
const epoch = (type, s) => { const [y, mo, d, h = 0, mi = 0] = (type === 'time' ? `1970-01-01 ${s}` : s).split(/[- :]/).map(Number); return Date.UTC(y, mo - 1, d, type === 'date' ? 0 : h - 9, mi); };
const addrParts = v => { const [base, ...rest] = v.split('|'); return [base.trim(), rest.join(' ').trim()]; };
function naverItems(form, answers){
  const shown = new Set(visible(form, answers));
  return form.questions.flatMap(q => {
    const it = form.raw.q[q.id], a = shown.has(q.id) ? answerOf(q, answers) : [], head = { questionId: it.qid, type: it.type }, text = v => ({ ...head, refId: null, value: squeeze(String(v)) });
    if (!a.length) return [];
    if (it.type === 'AGREE') return a[0] === q.options[0] ? [text('Y')] : [];   // 체크하지 않으면 item이 없다
    if (it.type === 'GRID') return a.map(l => cell(q, l)).map(([r, c]) => ({ ...head, refId: it.cells[`${r + 1},${c + 1}`] ?? null, value: `'${q.rows[r]}','${q.options[c]}'` }));
    if (it.type === 'CALENDAR') return [text(epoch(q.type, a[0]))];
    if (it.type === 'NUMERIC') return [text(a[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','))];   // 화면은 천 단위 쉼표를 넣은 글을 보낸다
    if (it.type === 'ADDRESS') return [text(addrParts(a[0]).join('|'))];
    if (!PICK.has(q.type)) return [text(a[0])];
    // 보기는 { refId: 보기 id, value: 보기 값 }, 직접 입력('기타')은 refId null. 화면처럼 보기 순서대로, 직접 입력은 맨 뒤
    return [...q.options.flatMap((o, i) => a.includes(o) ? [{ ...head, refId: it.items[i].id, value: it.items[i].value }] : []), ...a.filter(v => !q.options.includes(v)).map(text)];
  });
}
// 우편번호 없이 쓴 주소는 화면의 주소 검색(GET)으로 찾아 하나로 정해질 때만 '(우편번호) 도로명주소 | 상세'로 바꾼다
async function fillAddresses(form, answers, cookie, fetch){
  const out = { ...answers }, shown = new Set(visible(form, answers));
  for (const q of form.questions){
    const a = q.type === 'address' && shown.has(q.id) ? answerOf(q, answers)[0] : '';
    if (!a || /^\(\d{5}\)/.test(a)) continue;
    const [base, detail] = addrParts(a), r = await napi(fetch, form.id, `/address?keyword=${encodeURIComponent(base)}`, { cookie }), hit = r.data?.results || [];
    if (r.status !== 200 || hit.length !== 1 || !(hit[0].roadZipcode || hit[0].zipCode)) return { bad: `${q.id} 주소를 하나로 찾지 못했어요(${hit.length}곳) — ${ADDR}로 써 주세요` };
    out[q.id] = `(${hit[0].roadZipcode || hit[0].zipCode}) ${hit[0].roadAddress || hit[0].jibunAddress} | ${detail}`;
  }
  return { answers: out };
}
// 네이버는 폼을 읽은 직후에 온 답을 INVALID_PARAM('다시 시도')으로 거절한다 — 방금 받은 taToken이 잠깐 뒤에야 통한다(시험 폼으로 확인: 바로 보내면 거절, 1.5초 뒤면 접수).
// 그래서 읽은 뒤 pace.naver만큼 지나서 보내고, 그래도 거절되면 화면이 하듯 새로 읽어 한 번만 더 보낸다(거절은 기록되지 않는다).
export const pace = { naver: 3000 };
const sleep = ms => ms > 0 ? new Promise(r => setTimeout(r, ms)) : null;
async function sendNaver(form, s, answers, fetch){
  // 화면이 폼을 열 때 하는 확인(checkBeforeSubmit) — 이미 냈거나 못 내는 상태면 보내지 않는다
  const down = () => no('network', '네이버 폼 서버에 닿지 않아요. 아직 보내지 않았어요');
  let st, fixed; try { st = await napi(fetch, form.id, `/surveys/${form.id}/answers/status`, { cookie: s.cookie }); } catch { return down(); }
  if (st.data?.answered) return nNo('DUPLICATED');
  if (st.status !== 200 || !st.data?.available) return nNo(st.data?.error, st.status);
  try { fixed = await fillAddresses(form, answers, s.cookie, fetch); } catch { return down(); }
  if (fixed.bad) return no('invalid', fixed.bad);
  const post = token => napi(fetch, form.id, `/surveys/${form.id}/answers`, { cookie: s.cookie, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: naverItems(form, fixed.answers), taToken: token, extras: null }) });
  await sleep(pace.naver - (Date.now() - (s.at || 0)));
  let r = await post(s.token);
  if (r.status === 200 && r.data?.error === 'INVALID_PARAM'){
    const again = await napi(fetch, form.id, `/surveys/${form.id}/access?ignoreCount=true`, { cookie: s.cookie });
    if (again.status === 200 && again.data?.taToken && naverForm(again.data, form.id).sig === form.sig){ await sleep(pace.naver * 2); r = await post(again.data.taToken); }
  }
  if (r.status === 200 && r.data?.success === true) return { ok: true, sure: true, ...(r.data.id ?? r.data.answerId ? { id: String(r.data.id ?? r.data.answerId) } : {}), message: '제출했어요' };
  if (r.status >= 500 || (r.status === 200 && !r.data)) return no('unknown', `네이버 폼이 ${r.status}로 답했어요. 기록됐는지 알 수 없어요 — 다시 보내기 전에 확인해 주세요`, 'unknown');
  return nNo(r.data?.error, r.status);
}

/* ---------- 답 ---------- */
// 답은 글 또는 글 배열. 여러 개 고르는 유형과 표는 한 글에 줄마다 하나씩 써도 된다
const vals = (v, lines) => (Array.isArray(v) ? v : v == null ? [] : [v]).flatMap(x => { const s = String(x).replace(/\r\n?/g, '\n'); return lines ? s.split('\n') : [s]; }).map(s => s.trim()).filter(Boolean);
// 웹 화면이 입력을 다듬는 방식대로: 전화는 숫자만, 이메일은 공백 없이, 단답은 한 줄, 숫자는 쉼표 없이
const tidy = (q, v) => q.field === 'phone' ? v.replace(/\D/g, '') : q.field === 'email' ? v.replace(/\s/g, '') : q.type === 'short' ? v.replace(/\s*\n\s*/g, ' ') : q.type === 'number' ? v.replace(/[,\s]/g, '')
  : q.type === 'datetime' ? v.replace(/[T\s]+/, ' ') : q.type === 'grid' ? v.replace(/\s*::\s*/g, ' :: ') : v;
const answerOf = (q, answers) => [...new Set(vals(answers?.[q.id], LINES.has(q.type)).map(v => tidy(q, v)).filter(Boolean))];
const realDate = s => { const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : NaN; return !isNaN(d) && d.toISOString().slice(0, 10) === s; };
const CLOCK = '([01]?\\d|2[0-3]):[0-5]\\d';
// 표의 한 줄 '행 :: 열' → [행 번호, 열 번호](없으면 -1)
const cell = (q, line) => { const i = line.lastIndexOf('::'); return i < 0 ? [-1, -1] : [q.rows.indexOf(line.slice(0, i).trim()), q.options.indexOf(line.slice(i + 2).trim())]; };
// 답에 따라 실제로 거치는 페이지(1부터). 보기에 걸린 이동이 페이지 뒤 이동보다 앞서고, 한 페이지에 여럿이면 뒤 문항이 이긴다(네이버 화면과 같게)
function route(form, answers){
  const out = [], after = form?.raw?.after || [], last = form?.pages || 0;
  for (let p = last ? 1 : 0; p >= 1 && p <= last && out.length < last; ){
    out.push(p);
    let to = after[p - 1] ?? p + 1;
    for (const q of form.questions){ const go = q.page === p && form.raw.q?.[q.id]?.go, i = go ? q.options.indexOf(answerOf(q, answers)[0]) : -1; if (i >= 0 && go[i] != null) to = go[i]; }
    p = to > p ? to : 0;   // 0은 제출. 뒤로 가는 이동은 읽을 때 blockers로 걸러 둔다
  }
  return out;
}
// 그 답으로 실제 거치는 문항 id — 거치지 않는 문항은 필수로 보지 않고 답도 보내지 않는다
export function visible(form, answers = {}){
  const on = new Set(route(form, answers));
  return (form?.questions || []).filter(q => on.has(q.page)).map(q => q.id);
}

export function checkAnswers(form, answers = {}){
  const out = [], qs = form?.questions || [], shown = new Set(visible(form, answers));
  for (const k of Object.keys(answers || {})) if (!qs.some(q => q.id === k) && vals(answers[k]).length) out.push(`${k} 폼에 없는 문항이에요`);
  for (const q of qs){
    if (!shown.has(q.id)) continue;
    const a = answerOf(q, answers), it = form.raw?.q?.[q.id] || {}, free = a.filter(v => !q.options.includes(v)), one = a[0] || '', push = t => out.push(`${q.id} ${t}`);
    const refused = it.type === 'AGREE' && one === q.options[1];   // 네이버 체크형 동의는 '동의하지 않음'을 보낼 수 없다
    if (!a.length || refused){ if (q.required) push(refused ? '동의해야 낼 수 있는 문항이에요' : '필수인데 비었어요'); continue; }
    if (!LINES.has(q.type) && a.length > 1) push('답은 하나만 넣을 수 있어요');
    if ((q.type === 'category' && !q.many) && a.length > 1) push('답은 하나만 넣을 수 있어요');
    if (q.limit && one.length > q.limit && !PICK.has(q.type) && q.type !== 'grid') push(`글자 수 초과: ${one.length}자(${q.limit}자까지)`);
    if (TEXT.has(q.type)){
      if (q.field === 'email' && !EMAIL.test(one)) push(`이메일 꼴이 아니에요: ${cut(one, 40)}`);
      if (it.check && !passes(it.check, one)) push(`형식이 맞지 않아요: ${q.rule}`);
    } else if (PICK.has(q.type)){
      const room = q.other ? 1 : 0;
      if (free.length > room) push(`보기에 없는 답: ${cut(free.slice(room).join(', '), 60)}`);
      else if (free[0]?.length > 100 && form.kind === 'naver') push('글자 수 초과: 직접 입력은 100자까지');
      if (it.min && a.length < it.min) push(`${it.min}개 이상 골라 주세요`);
      if (it.max && a.length > it.max) push(`${it.max}개까지만 고를 수 있어요`);
    } else if (q.type === 'grid'){
      const cells = a.map(l => cell(q, l)), bad = a.filter((_, i) => cells[i].includes(-1)), per = q.rows.map((_, r) => cells.filter(c => c[0] === r).length);
      if (bad.length) push(`표에 없는 답: ${cut(bad.join(', '), 60)} — 줄마다 '행 :: 열' 꼴로 써 주세요`);
      else if (!q.many && per.some(n => n > 1)) push(`행마다 하나만 고를 수 있어요: ${q.rows[per.findIndex(n => n > 1)]}`);
      else if (q.required && per.includes(0)) push(`답하지 않은 행이 있어요: ${cut(q.rows.filter((_, r) => !per[r]).join(', '), 60)}`);
    } else if (q.type === 'date' && !(realDate(one) || (it.year === false && realDate(`2024-${one}`)))) push('날짜는 2026-11-10 꼴로 써 주세요');
    else if (q.type === 'time' && !new RegExp(`^${CLOCK}$`).test(one)) push('시간은 14:30 꼴로 써 주세요');
    else if (q.type === 'datetime' && !(new RegExp(`^\\d{4}-\\d{2}-\\d{2} ${CLOCK}$`).test(one) && realDate(one.slice(0, 10)))) push('날짜와 시간은 2026-11-10 14:30 꼴로 써 주세요');
    else if (q.type === 'duration' && !/^\d{1,3}:[0-5]?\d:[0-5]?\d$/.test(one)) push('걸린 시간은 1:30:00(시:분:초) 꼴로 써 주세요');
    else if (q.type === 'number' && !(it.type === 'NUMERIC' ? /^\d+$/ : /^-?\d+(\.\d+)?$/).test(one)) push(`숫자만 써 주세요: ${cut(one, 30)}`);
    else if (q.type === 'address' && !/\S/.test(addrParts(one)[0].replace(/^\(\d{5}\)/, ''))) push(`주소는 ${ADDR}로 써 주세요`);
  }
  return out;
}

/* ---------- 읽기·제출 ---------- */
async function load(url, fetch){
  const kind = kindOf(url);
  if (!kind) return err('구글 폼·네이버 폼 주소가 아니에요');
  try { return await (kind === 'google' ? loadGoogle : loadNaver)(String(url), fetch); }
  catch { return err('폼 서버에 닿지 않아요. 인터넷 연결을 확인하고 다시 해 주세요', 'network'); }
}
export async function readForm(url, { fetch = globalThis.fetch } = {}){
  const got = await load(url, fetch);
  return got.error ? got : got.form;
}
// 보내기 직전에 다시 읽어 문항이 그대로일 때만 보낸다(토큰·쿠키도 이때 새로 받는다)
export async function submitForm(form, answers, { fetch = globalThis.fetch } = {}){
  const got = await load(form?.url, fetch);
  if (got.error) return no(got.reason, `보내기 전에 폼을 다시 읽지 못했어요: ${got.error}`);
  const { form: now, session } = got;
  if (!now.open) return no('closed', now.closed);
  if (now.sig !== form.sig) return no('changed', '폼 문항이 그사이 바뀌었어요. 다시 읽고 답을 맞춰 주세요');
  if (now.login) return no('login', '로그인해야 낼 수 있는 폼이에요. 브라우저에서 직접 내 주세요');
  if (now.blockers.length) return no('invalid', `자동으로 낼 수 없는 폼이에요: ${now.blockers.join(', ')}`);
  const bad = checkAnswers(now, answers);
  if (bad.length) return no('invalid', bad.join(' / '));
  try { return await (now.kind === 'google' ? sendGoogle : sendNaver)(now, session, answers, fetch); }
  catch { return no('network', '보내는 중에 연결이 끊겼어요. 서버에 닿았는지 알 수 없어요 — 다시 보내면 중복될 수 있으니 먼저 확인해 주세요', 'unknown'); }
}
// 구글만: 답을 미리 채운 주소. skip의 문항은 넣지 않는다(개인정보를 주소에 싣지 않으려고)
export function prefillUrl(form, answers, { skip = [] } = {}){
  if (form?.kind !== 'google') return '';
  const q = new URLSearchParams([['usp', 'pp_url'], ...googlePairs(form, answers, { prefill: true, skip })]);
  return `${form.url}?${q}`;
}
