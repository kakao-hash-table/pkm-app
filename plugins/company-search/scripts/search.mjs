#!/usr/bin/env node
// 사내 검색 — 위키(Confluence)·지라·아지트를 REST로 읽기만 한다. 결과는 pkm 검색 형식 { items: [...], note? } JSON 한 줄.
//   node search.mjs wiki --url=https://your-team.atlassian.net/wiki [--email=me@example.com] --q="배포 절차" [--limit=8]
//   node search.mjs jira --url=https://your-team.atlassian.net [--email=me@example.com] --q=ABC-12
//   node search.mjs agit [--url=https://api.agit.in/v2] [--web=https://your-team.agit.in] --q=회고
// 토큰은 환경 변수. 위키·지라는 ATLASSIAN_TOKEN(이메일이 있으면 Cloud: 이메일+API 토큰, 없으면 Server·Data Center: PAT), 아지트는 AGIT_TOKEN.
const [cmd, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
const failWith = msg => done({ error: msg }, 1);

const NAME = { wiki: '위키', jira: '지라', agit: '아지트' }[cmd];
if (!NAME) failWith('명령은 wiki, jira, agit 중 하나예요');
const Q = String(opt.q || '').trim();
const LIMIT = Math.min(30, Math.max(1, parseInt(opt.limit, 10) || 8));
if (!Q) done({ items: [] });

const esc = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');   // CQL·JQL 따옴표 안에 넣을 말
const ymd = v => {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : NaN;
  const d = new Date(Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : String(v));   // 초·밀리초·ISO 모두
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const iso = v => { const s = ymd(v); if (!s) return null; const n = /^\d+$/.test(String(v)) ? Number(v) : NaN; return new Date(Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : String(v)).toISOString(); };
const baseOf = (u, what) => {
  const b = String(u || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/.test(b)) failWith(`${what} 주소가 비어 있어요. 플러그인 설정에서 ${what} 주소를 적어 주세요`);
  try { return { base: b, url: new URL(b) }; } catch { return failWith(`${what} 주소가 맞지 않아요: ${b}`); }
};

// 400은 검색어를 받지 않은 것이라 { bad }로 돌려주고, 나머지 실패는 여기서 멈춘다. 한 번에 15초까지 — 찾기는 60초 안에 끝나야 한다
async function call(url, headers, authMsg){
  const host = new URL(url).host;
  let r;
  try { r = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15000) }); }
  catch (e) { failWith(e && e.name === 'TimeoutError' ? `${NAME}(${host})가 15초 안에 답하지 않았어요. 잠시 뒤 다시 찾아 주세요` : `${NAME}(${host})에 닿지 않아요. 회사망·VPN 연결을 확인해 주세요`); }
  if (r.status === 401 || r.status === 403) failWith(authMsg);
  if (r.status === 400) return { bad: (await r.text()).slice(0, 300) };
  if (!r.ok){ process.stderr.write((await r.text()).slice(0, 2000) + '\n'); failWith(r.status >= 500 ? `${NAME}가 지금 답하지 않아요(오류 ${r.status}). 잠시 뒤 다시 찾아 주세요` : `${NAME}가 요청을 받지 않았어요(오류 ${r.status}). 주소가 맞는지 확인해 주세요`); }
  const t = await r.text();
  try { return { data: t ? JSON.parse(t) : {} }; }
  catch { return failWith(`${NAME} 응답을 읽지 못했어요(JSON이 아니에요). 주소가 맞는지 확인해 주세요`); }
}

// 위키·지라 공통 — Atlassian. 이메일이 있으면 Basic(이메일:API 토큰), 없으면 Bearer(PAT)
function atlassian(){
  const { base, url } = baseOf(opt.url, NAME);
  const token = process.env.ATLASSIAN_TOKEN;
  if (!token) failWith(`${NAME} 토큰이 없어요. 플러그인 설정에서 넣어 주세요`);
  const cloud = opt.cloud === '1' || (opt.cloud !== '0' && /\.atlassian\.net$/.test(url.hostname));   // --cloud는 테스트용 덮어쓰기
  if (cloud && !opt.email) failWith(`${NAME}(Atlassian Cloud)는 로그인 이메일이 필요해요. 플러그인 설정에서 이메일을 적어 주세요`);
  const authorization = opt.email ? `Basic ${Buffer.from(`${opt.email}:${token}`).toString('base64')}` : `Bearer ${token}`;
  const authMsg = `${NAME} 토큰이 맞지 않거나 만료됐어요${opt.email ? '(이메일도 확인해 주세요)' : ''}. 플러그인 설정에서 다시 넣어 주세요`;
  return { base, cloud, get: p => call(`${base}${p}`, { authorization }, authMsg) };
}
const refused = () => failWith(`${NAME}가 이 검색어를 받지 않았어요. 특수문자를 빼고 다시 찾아 주세요`);

if (cmd === 'wiki'){
  const A = atlassian();
  const pre = A.cloud && !/\/wiki$/.test(A.base) ? '/wiki' : '';   // Cloud 위키는 /wiki 아래에 있다
  const root = A.base + pre;
  const q = esc(Q), pages = new Map();
  const cql = async c => { const r = await A.get(`${pre}/rest/api/content/search?cql=${encodeURIComponent(c)}&limit=${LIMIT}&expand=space,version`); return r.bad != null ? null : (r.data.results || []); };
  const byTitle = await cql(`type = page AND title ~ "${q}" ORDER BY lastmodified DESC`);
  for (const p of byTitle || []) pages.set(String(p.id), p);
  let byText = [];
  if (pages.size < LIMIT){
    byText = await cql(`type = page AND text ~ "${q}"`);
    for (const p of byText || []) if (!pages.has(String(p.id))) pages.set(String(p.id), p);
  }
  if (byTitle === null && byText === null) refused();
  const link = p => {
    const ui = p._links && p._links.webui;
    if (!ui) return `${root}/pages/viewpage.action?pageId=${encodeURIComponent(p.id)}`;
    if (/^https?:\/\//.test(ui)) return ui;
    return /\/wiki$/.test(root) && /^\/wiki\//.test(ui) ? root.replace(/\/wiki$/, '') + ui : root + ui;
  };
  done({ items: [...pages.values()].slice(0, LIMIT).map(p => {
    const when = p.version && p.version.when, space = p.space && (p.space.name || p.space.key);
    return { id: String(p.id), title: p.title || String(p.id), url: link(p), at: when || null,
      meta: [space, p.version && p.version.number != null ? `v${p.version.number}` : '', ymd(when)].filter(Boolean) };
  }) });
}

if (cmd === 'jira'){
  const A = atlassian();
  const path = A.cloud ? '/rest/api/2/search/jql' : '/rest/api/2/search';   // Cloud는 /search가 없어졌다
  const find = async jql => { const r = await A.get(`${path}?jql=${encodeURIComponent(jql)}&maxResults=${LIMIT}&fields=summary,status,assignee,updated,issuetype`); return r.bad != null ? null : (r.data.issues || []); };
  const q = esc(Q), key = /^[A-Z][A-Z0-9]+-\d+$/i.test(Q) ? Q.toUpperCase() : null;
  // 키처럼 생겼으면 키로, 아니면 본문 → 제목 순. 없는 키는 지라가 400을 주니 글로 다시 찾는다
  const tries = [...(key ? [`key = ${key}`] : []), `text ~ "${q}" ORDER BY updated DESC`, `summary ~ "${q}" ORDER BY updated DESC`];
  let issues = null;
  for (const jql of tries){ const r = await find(jql); if (r === null) continue; issues = r; if (r.length) break; }
  if (issues === null) refused();
  done({ items: issues.slice(0, LIMIT).map(({ key: k, fields: f = {} }) => ({
    id: k, title: `${k} ${f.summary || ''}`.trim(), url: `${A.base}/browse/${k}`, at: f.updated || null,
    meta: [f.status && f.status.name, (f.assignee && f.assignee.displayName) || '담당 없음', ymd(f.updated)].filter(Boolean),
    tags: [f.issuetype && f.issuetype.name].filter(Boolean)
  })) });
}

if (cmd === 'agit'){
  const { base: api } = baseOf(opt.url || 'https://api.agit.in/v2', '아지트 API');
  const token = process.env.AGIT_TOKEN;
  if (!token) failWith('아지트 토큰이 없어요. 플러그인 설정에서 넣어 주세요');
  const web = /^https?:\/\/[^/\s]+/.test(String(opt.web || '').trim()) ? String(opt.web).trim().replace(/\/+$/, '') : '';
  const r = await call(`${api}/search/total?q=${encodeURIComponent(Q)}&page=1`, { authorization: `Bearer ${token}` }, '아지트 토큰이 맞지 않거나 만료됐어요. 플러그인 설정에서 다시 넣어 주세요');
  if (r.bad != null) refused();
  // 응답 모양을 믿지 않는다 — wall_messages가 배열이거나, { list | items | … } 안에 배열이 있다
  const listOf = d => {
    for (const box of [d, d && d.data, d && d.result]){
      const w = box && typeof box === 'object' ? box.wall_messages : undefined;
      if (Array.isArray(w)) return w;
      if (w && typeof w === 'object') for (const k of ['list', 'items', 'data', 'results', 'messages', 'contents']) if (Array.isArray(w[k])) return w[k];
    }
    return null;
  };
  const list = listOf(r.data);
  if (!list) done({ items: [], note: '아지트 응답에서 글 목록(wall_messages)을 찾지 못했어요' });
  const pick = (...vs) => vs.find(v => v != null && v !== '');
  done({ items: list.filter(m => m && typeof m === 'object').slice(0, LIMIT).map((m, i) => {
    const id = pick(m.id, m.message_id, m.wall_message_id);
    const text = String(pick(m.text, m.content, m.body, m.message) || '').replace(/<[^>]*>/g, ' ');
    const line = (text.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).find(Boolean) || '').slice(0, 80);
    const u = m.user || m.author || m.writer || {};
    const who = pick(u.name, u.display_name, u.nickname, m.user_name, m.author_name);
    const at = pick(m.created_at, m.createdAt, m.created, m.updated_at);
    const group = pick(m.group_id, m.groupId, m.group && m.group.id);   // 없으면 링크를 지어내지 않는다
    const given = pick(m.url, m.permalink, m.web_url);
    const url = /^https?:\/\//.test(String(given || '')) ? String(given) : web && group != null && id != null ? `${web}/g/${encodeURIComponent(group)}/wall/${encodeURIComponent(id)}` : '';
    return { id: String(id ?? `agit-${i}`), title: line || '(본문 없음)', url, at: iso(at), meta: [who, ymd(at)].filter(Boolean) };
  }) });
}
