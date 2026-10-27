#!/usr/bin/env node
// 지라 — 내 티켓 가져오기(assigned)와 상태 바꾸기(transition). 결과는 JSON 한 줄.
//   node jira.mjs assigned --url=https://x.atlassian.net [--email=me@x.com] --jql="assignee = currentUser() …"
//   node jira.mjs transition --url=… [--email=…] --key=ABC-1 --to="In Progress"
// 토큰은 환경 변수 JIRA_TOKEN. 이메일이 있으면 Jira Cloud(이메일+API 토큰), 없으면 Server·Data Center(PAT)로 부른다.
const [cmd, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
const failWith = msg => done({ error: msg }, 1);

const BASE = String(opt.url || '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/\s]+/.test(BASE)) failWith('Jira 주소가 비어 있어요. 플러그인 설정에서 Jira 주소를 적어 주세요');
const TOKEN = process.env.JIRA_TOKEN;
if (!TOKEN) failWith('Jira 토큰이 없어요. 플러그인 설정에서 토큰을 넣어 주세요');
const CLOUD = /\.atlassian\.net$/.test(new URL(BASE).hostname);
if (CLOUD && !opt.email) failWith('Jira Cloud는 로그인 이메일이 필요해요. 플러그인 설정에서 이메일을 적어 주세요');
const auth = opt.email ? `Basic ${Buffer.from(`${opt.email}:${TOKEN}`).toString('base64')}` : `Bearer ${TOKEN}`;

async function jira(p, init = {}){
  let r;
  try { r = await fetch(`${BASE}/rest/api/2${p}`, { ...init, headers: { authorization: auth, accept: 'application/json', 'content-type': 'application/json' }, signal: AbortSignal.timeout(20000) }); }
  catch { failWith(`Jira(${new URL(BASE).host})에 닿지 않아요. 회사망·VPN 연결을 확인해 주세요`); }
  if (r.status === 401 || r.status === 403) failWith('Jira 토큰이 맞지 않거나 만료됐어요(이메일도 확인해 주세요). 플러그인 설정에서 다시 넣어 주세요');
  if (!r.ok){ const t = await r.text(); failWith(`Jira 오류 ${r.status}: ${t.slice(0, 300)}`); }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

if (cmd === 'assigned'){
  const jql = opt.jql || 'assignee = currentUser() AND statusCategory != Done ORDER BY created DESC';
  const fields = 'summary,status,issuetype,priority,created,updated,description,project';
  const issues = [];
  if (CLOUD){   // Cloud는 /search가 없어졌다 — /search/jql과 nextPageToken
    let token = '';
    do {
      const d = await jira(`/search/jql?jql=${encodeURIComponent(jql)}&maxResults=50&fields=${fields}${token ? `&nextPageToken=${encodeURIComponent(token)}` : ''}`);
      issues.push(...(d.issues || [])); token = d.isLast ? '' : d.nextPageToken || '';
    } while (token && issues.length < 100);
  } else {
    const d = await jira(`/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=${fields}`);
    issues.push(...(d.issues || []));
  }
  done({ items: issues.map(({ key, fields: f }) => ({
    id: key, title: f.summary || key, url: `${BASE}/browse/${key}`, at: f.created, version: f.updated,
    meta: [key, f.status && f.status.name, f.issuetype && f.issuetype.name, f.priority && f.priority.name].filter(Boolean),
    tags: f.status && f.status.statusCategory && f.status.statusCategory.key === 'indeterminate' ? ['진행 중'] : [],
    vars: { key, summary: f.summary || '', project: key.split('-')[0], status: (f.status && f.status.name) || '', description: String(f.description || '').slice(0, 6000) }
  })) });
}

if (cmd === 'transition'){
  const key = String(opt.key || ''), to = String(opt.to || '').trim();
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) failWith(`티켓 키 형식이 맞지 않아요: ${key}`);
  if (!to) failWith('바꿀 상태 이름이 비어 있어요');
  const [issue, me] = await Promise.all([jira(`/issue/${key}?fields=status,assignee`), jira('/myself')]);
  const now = issue.fields.status && issue.fields.status.name, who = issue.fields.assignee;
  // 기다리는 동안 할당이 풀렸거나 끝난 티켓은 바꾸지 않는다 — 동료 눈에 보이는 변경이다
  const mine = who && ((me.accountId && who.accountId === me.accountId) || (me.name && who.name === me.name) || (me.key && who.key === me.key));
  if (!mine) failWith(`${key} 할당이 풀렸어요(지금 담당: ${(who && who.displayName) || '없음'}). 지라 상태는 바꾸지 않았어요`);
  if (issue.fields.status && issue.fields.status.statusCategory && issue.fields.status.statusCategory.key === 'done') failWith(`${key}이 지라에서 이미 끝났어요(${now}). 지라 상태는 바꾸지 않았어요`);
  if (now && now.toLowerCase() === to.toLowerCase()) done({ key, status: now, changed: false, summary: `이미 ${now}예요` });
  const { transitions } = await jira(`/issue/${key}/transitions`);
  const hit = transitions.find(t => t.name.toLowerCase() === to.toLowerCase() || (t.to && t.to.name.toLowerCase() === to.toLowerCase()));
  if (!hit) failWith(`${key}를 "${to}"로 바꿀 수 없어요. 지금 상태(${now})에서 갈 수 있는 것: ${transitions.map(t => (t.to && t.to.name) || t.name).join(', ') || '없음'}`);
  await jira(`/issue/${key}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: hit.id } }) });
  done({ key, status: (hit.to && hit.to.name) || to, from: now, changed: true, summary: `${now} → ${(hit.to && hit.to.name) || to}` });
}

failWith('명령은 assigned 또는 transition이에요');
