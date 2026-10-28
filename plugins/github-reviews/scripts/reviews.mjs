#!/usr/bin/env node
// 코드 리뷰 — GitHub(또는 GitHub Enterprise). 결과는 JSON 한 줄.
//   node reviews.mjs requested|mine|replies --api=https://api.github.com [--repos="owner/a\nowner/b"]   피드 { items: [...] } — 읽기만
//   node reviews.mjs diff --api=… --repo=owner/name --number=12                                         AI에게 넘길 diff(새 파일 줄 번호를 붙여서)
//   node reviews.mjs decide --api=… --repo=… --number=… --head=<검토한 커밋> --verdict=ok|block --findings=<JSON> --lines=<JSON> [--answer=approve|done]
//     답 없이 부르면 판정과 문제 위치를 정리해 묻고, --answer=approve면 검토한 커밋에 승인을 남긴다(GitHub에 쓰는 것은 이것 하나)
// 토큰은 환경 변수 GITHUB_TOKEN(pkm-ai-server가 승인한 플러그인에만 넣어 준다).
const [cmd, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const API = String(opt.api || 'https://api.github.com').replace(/\/+$/, '');
const REPOS = String(opt.repos || '').split(/[\n,]+/).map(s => s.trim()).filter(s => /^[\w.-]+\/[\w.-]+$/.test(s));
const TOKEN = process.env.GITHUB_TOKEN;
const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
const failWith = msg => done({ error: msg }, 1);

if (!['requested', 'mine', 'replies', 'diff', 'decide'].includes(cmd)) failWith('명령은 requested, mine, replies, diff, decide 중 하나예요');
if (!TOKEN) failWith('GitHub 토큰이 없어요. 플러그인 설정에서 토큰을 넣어 주세요');
const host = (() => { try { return new URL(API).host; } catch { return failWith(`GitHub API 주소가 맞지 않아요: ${API}`); } })();

async function gh(p, params = {}, init = {}){
  const qs = new URLSearchParams(params).toString();
  let r;
  try { r = await fetch(`${API}${p}${qs ? `?${qs}` : ''}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', ...(init.body ? { 'content-type': 'application/json' } : {}) }, signal: AbortSignal.timeout(20000) }); }
  catch { failWith(`GitHub(${host})에 닿지 않아요. 회사망·VPN 연결을 확인해 주세요`); }
  if (r.status === 401) failWith('GitHub 토큰이 맞지 않거나 만료됐어요. 플러그인 설정에서 토큰을 다시 넣어 주세요');
  if (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0') failWith('GitHub 요청 한도에 걸렸어요. 잠시 뒤 다시 가져올게요');
  if (init.method === 'POST' && (r.status === 403 || r.status === 404)) failWith('토큰에 리뷰를 남길 권한이 없어요. classic 토큰이면 repo, fine-grained면 Pull requests 쓰기 권한을 주고 토큰을 다시 넣어 주세요');
  if (init.method === 'POST' && r.status === 422){ const e = await r.json().catch(() => ({})); failWith(`GitHub가 승인을 받지 않았어요: ${(Array.isArray(e.errors) ? e.errors.join(' ') : e.message) || '내 PR이거나 이미 닫힌 PR일 수 있어요'}`); }
  if (!r.ok) failWith(`GitHub 오류 ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
const scope = REPOS.map(r => ` repo:${r}`).join('');
const search = q => gh('/search/issues', { q: q + scope, per_page: 50, sort: 'updated' }).then(d => d.items || []);
const repoOf = it => String(it.repository_url || '').split('/repos/')[1];
const days = iso => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const ago = iso => { const d = days(iso); return d === 0 ? '오늘' : `${d}일 전`; };
const waited = iso => days(iso) === 0 ? '오늘부터 기다림' : `${days(iso)}일 기다림`;
const short = (s, n = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const me = ['diff', 'decide'].includes(cmd) ? null : (await gh('/user')).login;
const REPO = String(opt.repo || ''), NUM = String(opt.number || '');
if (['diff', 'decide'].includes(cmd) && (!/^[\w.-]+\/[\w.-]+$/.test(REPO) || !/^\d+$/.test(NUM))) failWith('--repo=owner/name과 --number가 필요해요');
const inBatches = async (list, fn, n = 5) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(...await Promise.all(list.slice(i, i + n).map(fn))); return out; };

// 사람마다 마지막 판정 — COMMENTED는 판정이 아니라 승인·변경 요청을 덮지 않는다
function verdicts(reviews){
  const v = {}, commented = new Set();
  for (const r of reviews){
    const u = r.user && r.user.login; if (!u) continue;
    if (r.state === 'COMMENTED') commented.add(u);
    else if (r.state === 'DISMISSED') delete v[u];
    else if (r.state !== 'PENDING') v[u] = r.state;
  }
  return { v, commented, by: s => Object.keys(v).filter(u => v[u] === s) };
}

if (cmd === 'requested'){
  const [req, inv] = await Promise.all([search(`is:pr is:open review-requested:${me}`), search(`is:pr is:open involves:${me} -author:${me}`)]);
  const reqIds = new Set(req.map(i => i.id));
  const enrich = async (it, asked) => {
    const r = repoOf(it), [pr, reviews] = await Promise.all([gh(`/repos/${r}/pulls/${it.number}`), gh(`/repos/${r}/pulls/${it.number}/reviews`, { per_page: 100 })]);
    const { v, commented, by } = verdicts(reviews), mine = v[me] || (commented.has(me) ? 'COMMENTED' : null);
    if (!asked && mine !== 'COMMENTED') return null;   // 요청 목록 밖이면 코멘트만 남긴(판정 안 한) PR만
    const tags = [];
    if (!asked) tags.push('코멘트만 남김');
    else if (mine) tags.push('다시 요청됨');
    if (by('CHANGES_REQUESTED').length) tags.push(`변경 요청 ${by('CHANGES_REQUESTED').length}`);
    if (pr.draft) tags.push('초안');
    const others = (pr.requested_reviewers || []).map(u => u.login).filter(u => u !== me);
    return { id: pr.html_url, title: pr.title, url: pr.html_url, at: pr.created_at, version: pr.head && pr.head.sha,
      meta: [`${r}#${pr.number}`, pr.user.login, `열린 지 ${days(pr.created_at)}일`, `+${pr.additions} −${pr.deletions}`, others.length ? `남은 리뷰어 ${others.length}` : '나만 남음'], tags,
      vars: { repo: r, number: String(pr.number), author: pr.user.login, branch: pr.head && pr.head.ref } };
  };
  const items = [...await inBatches(req, it => enrich(it, true)), ...await inBatches(inv.filter(i => !reqIds.has(i.id)), it => enrich(it, false))].filter(Boolean);
  items.sort((a, b) => a.tags.includes('초안') - b.tags.includes('초안') || a.at.localeCompare(b.at));   // 초안은 뒤로, 오래된 것 먼저
  done({ items, note: `${me} · ${REPOS.length ? `저장소 ${REPOS.length}개` : '볼 수 있는 저장소 전체'}` });
}

if (cmd === 'mine'){
  const list = await search(`is:pr is:open author:${me}`);
  const items = await inBatches(list, async it => {
    const r = repoOf(it), [pr, reviews] = await Promise.all([gh(`/repos/${r}/pulls/${it.number}`), gh(`/repos/${r}/pulls/${it.number}/reviews`, { per_page: 100 })]);
    const { by } = verdicts(reviews.filter(x => x.user && x.user.login !== me));
    const waiting = [...(pr.requested_reviewers || []).map(u => u.login), ...(pr.requested_teams || []).map(t => `@${t.slug}`)];
    const ok = by('APPROVED'), no = by('CHANGES_REQUESTED'), tags = [];
    if (no.length) tags.push(`변경 요청 ${no.length}`);
    if (ok.length && !waiting.length && !no.length) tags.push('승인 받음');
    if (pr.draft) tags.push('초안');
    return { id: pr.html_url, title: pr.title, url: pr.html_url, at: pr.updated_at, version: `${pr.head && pr.head.sha}:${ok.join()}:${no.join()}:${waiting.join()}`,
      meta: [`${r}#${pr.number}`, `승인 ${ok.length}`, waiting.length ? `기다리는 리뷰어 ${waiting.join(', ')}` : '기다리는 리뷰어 없음', `갱신 ${ago(pr.updated_at)}`], tags,
      detail: [...no.map(u => ({ who: u, kind: '변경 요청', text: '' })), ...ok.map(u => ({ who: u, kind: '승인', text: '' }))],
      vars: { repo: r, number: String(pr.number), branch: pr.head && pr.head.ref } };
  });
  done({ items });
}

// 답할 차례 — 판정 기준은 내 마지막 발언 시각 하나. 그 뒤에 남이 한 말이 있으면 공이 내게 있다
const BOT_RE = /\[bot\]$|^(jenkins|sonarqube|sonar|codecov|dependabot|renovate)/i;
const APPLAUSE = /^(lgtm|ok(ay)?|good|nice|굿+|좋(아요|네요|습니다)|확인(했습니다|했어요|)|고생(하셨습니다|하셨어요|많으셨습니다)|수고(하셨습니다|하셨어요)|감사(합니다|해요)|넵+|네+)$/i;
const TAG_RE = /\[(질문|의견|확인|제안|궁금|필수|요청|논의)/;
const stripDeco = s => String(s || '').replace(/\p{Extended_Pictographic}/gu, '').replace(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu, '').replace(/[\s~!.,)(\-…:;'"`]/g, '');
function substantive(e){
  if (e.reply_to_me || e.kind === '변경 요청') return true;   // 내 코멘트에 달린 답장은 짧아도 알린다
  const b = String(e.text || '');
  if (/[?？]/.test(b) || TAG_RE.test(b)) return true;
  const core = stripDeco(b);
  return !!core && !APPLAUSE.test(core) && core.length >= 6;
}
async function events(r, n){
  const [ic, rc, rv] = await Promise.all([gh(`/repos/${r}/issues/${n}/comments`, { per_page: 100 }), gh(`/repos/${r}/pulls/${n}/comments`, { per_page: 100 }), gh(`/repos/${r}/pulls/${n}/reviews`, { per_page: 100 })]);
  const out = [], add = (kind, c, extra = {}) => {
    const u = c.user && c.user.login, at = c.created_at || c.submitted_at;
    if (!u || !at || (u !== me && BOT_RE.test(u))) return;
    out.push({ kind, who: u, at, text: short(c.body), url: c.html_url, mentions_me: new RegExp(`@${me}\\b`, 'i').test(String(c.body || '')), ...extra });
  };
  for (const c of ic) add('대화', c);
  for (const c of rc) add('인라인', c, { id: c.id, path: c.path });
  // 남의 리뷰는 본문이 있어야 대화다. 내 판정은 본문이 없어도 센다(승인하면 내 차례는 끝난 것)
  for (const v of rv) if ((v.body || '').trim() || v.state === 'CHANGES_REQUESTED' || (v.user && v.user.login === me && /^(APPROVED|CHANGES_REQUESTED|COMMENTED)$/.test(v.state)))
    add(v.state === 'CHANGES_REQUESTED' ? '변경 요청' : v.state === 'APPROVED' ? '승인' : '리뷰', v);
  // 인라인 스레드에서 내가 낀 뒤 남이 단 것 = 내게 온 답장
  const threads = new Map();
  for (const c of rc){ const root = c.in_reply_to_id || c.id; threads.set(root, [...(threads.get(root) || []), c]); }
  const toMe = new Set();
  for (const list of threads.values()){
    const mineAt = list.filter(c => c.user && c.user.login === me).map(c => c.created_at).sort().pop();
    if (mineAt) for (const c of list) if (c.user && c.user.login !== me && c.created_at > mineAt) toMe.add(c.id);
  }
  for (const e of out) if (e.id && toMe.has(e.id)) e.reply_to_me = true;
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

if (cmd === 'replies'){
  const [mine, commented] = await Promise.all([search(`is:pr is:open author:${me}`), search(`is:pr is:open commenter:${me} -author:${me}`)]);
  const build = mode => async it => {
    const r = repoOf(it), ev = await events(r, it.number);
    const lastMine = ev.filter(e => e.who === me).map(e => e.at).pop() || null;
    const after = ev.filter(e => e.who !== me && (!lastMine || e.at > lastMine));
    const open = (mode === 'mine' ? after : after.filter(e => e.reply_to_me || e.mentions_me)).filter(substantive);
    if (!open.length) return null;
    const tags = [mode === 'mine' ? '내 PR' : '내 코멘트에 답장'];
    if (open.some(e => e.kind === '변경 요청')) tags.push('변경 요청');
    if (open.some(e => e.mentions_me)) tags.push('나를 부름');
    return { id: it.html_url, title: it.title, url: it.html_url, at: open[0].at, version: open[open.length - 1].at,
      meta: [`${r}#${it.number}`, `안 답한 말 ${open.length}`, [...new Set(open.map(e => e.who))].join(', '), waited(open[0].at)], tags,
      detail: open.slice(-8).map(e => ({ who: e.who, at: e.at, kind: e.path ? `${e.kind} · ${e.path.split('/').pop()}` : e.kind, text: e.text, url: e.url })),
      vars: { repo: r, number: String(it.number) } };
  };
  const items = [...await inBatches(mine, build('mine')), ...await inBatches(commented, build('replies'))].filter(Boolean);
  items.sort((a, b) => a.at.localeCompare(b.at));   // 오래 기다린 것 먼저
  done({ items });
}

/* ---------- AI 리뷰: diff → (AI 판정) → decide ---------- */
// 사람이 읽지 않는 파일(잠금 파일·빌드 결과·이미지·스냅숏)은 AI에게도 넘기지 않는다
const SKIP_RE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock)$|(^|\/)(dist|build|out|coverage|\.next|vendor|node_modules)\/|\.(min\.(js|css)|map|snap|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp4|pdf|zip)$|\.generated\.|(^|\/)__generated__\//i;
const MAX_DIFF = 150000;   // 이보다 크면 앞에서부터 이만큼만 보고, 본 부분만이라고 알린다

// patch에 새 파일 기준 줄 번호를 붙이고, 추가된 줄 범위를 모은다. 지운 줄은 번호 없이 '-'
function annotate(patch){
  const out = [], added = [];
  let n = 0;
  for (const line of String(patch || '').split('\n')){
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h){ n = Number(h[1]); out.push(line); continue; }
    if (line.startsWith('-')){ out.push(`     │${line}`); continue; }
    if (line.startsWith('\\')) continue;   // "\ No newline at end of file"
    const plus = line.startsWith('+');
    if (plus){ const last = added[added.length - 1]; if (last && last[1] === n - 1) last[1] = n; else added.push([n, n]); }
    out.push(`${String(n).padStart(5)}│${plus ? '+' : ' '}${line.slice(1)}`);
    n++;
  }
  return { text: out.join('\n'), added };
}
const webBase = () => /^api\.github\.com$/i.test(host) ? 'https://github.com' : API.replace(/\/api\/v3$/, '');

if (cmd === 'diff'){
  const pr = await gh(`/repos/${REPO}/pulls/${NUM}`);
  const files = [];
  for (let page = 1; page <= 10; page++){ const d = await gh(`/repos/${REPO}/pulls/${NUM}/files`, { per_page: 100, page }); files.push(...d); if (d.length < 100) break; }
  const skipped = [], lines = {}, parts = [];
  let size = 0, truncated = false;
  for (const f of files){
    if (SKIP_RE.test(f.filename)){ skipped.push(f.filename); continue; }
    if (f.status === 'removed'){ parts.push(`### ${f.filename} (지움)`); continue; }
    if (!f.patch){ skipped.push(f.filename); continue; }   // 바이너리이거나 너무 커서 GitHub가 patch를 주지 않은 파일
    const a = annotate(f.patch), block = `### ${f.filename}${f.previous_filename ? ` (이름 바꿈: ${f.previous_filename})` : ''}\n${a.text}`;
    if (size + block.length > MAX_DIFF){ truncated = true; skipped.push(f.filename); continue; }
    size += block.length; parts.push(block); lines[f.filename] = a.added;
  }
  const seen = Object.keys(lines).length;
  done({
    summary: `파일 ${seen}개를 봐요 · +${pr.additions} −${pr.deletions}${skipped.length ? ` · ${skipped.length}개 뺌` : ''}${truncated ? ' · 커서 앞부분만' : ''}`,
    head: pr.head.sha, truncated, skipped: skipped.slice(0, 50),
    _diff: parts.join('\n\n') || '(볼 수 있는 코드 변경이 없어요)', _body: short(pr.body, 3000) || '(설명 없음)', _lines: lines
  });
}

const CATS = { security: '보안', logic: '로직 오류', react_hooks: '훅 규칙', memory_leak: '누수', error_handling: '에러 처리', type_safety: '타입 안전성', accessibility: '접근성', performance: '성능', accidental_code: '실수로 넣은 코드' };
const parseJSON = (s, d) => { try { return JSON.parse(String(s)); } catch { return d; } };

if (cmd === 'decide'){
  const head = String(opt.head || ''), verdict = String(opt.verdict || ''), answer = opt.answer == null ? null : String(opt.answer);
  if (!/^[0-9a-f]{7,40}$/.test(head)) failWith('검토한 커밋(--head)이 없어요');
  if (answer != null && !['approve', 'done'].includes(answer)) failWith(`모르는 답이에요: ${answer}`);
  const lines = parseJSON(opt.lines, {}), raw = parseJSON(opt.findings, []);
  const inDiff = (p, a, b) => (lines[p] || []).some(([s, e]) => a <= e && b >= s);
  // 범주 밖·확신이 낮은 것·diff에 없는 파일은 버린다(오탐을 줄인다). 많아도 5개까지
  const findings = (Array.isArray(raw) ? raw : []).filter(f => f && CATS[f.category] && Number(f.confidence) >= 0.8 && lines[f.path]).slice(0, 5).map(f => {
    const a = Math.max(1, Math.floor(Number(f.start_line) || 1)), b = Math.max(a, Math.floor(Number(f.end_line) || a));
    return {
      where: `${f.path}:${a === b ? a : `${a}-${b}`}`, url: `${webBase()}/${REPO}/blob/${head}/${f.path.split('/').map(encodeURIComponent).join('/')}#L${a}${b > a ? `-L${b}` : ''}`,
      tag: CATS[f.category], title: short(f.title, 120), text: short(f.scenario, 400), copy: String(f.comment || '').trim().slice(0, 2000),
      note: inDiff(f.path, a, b) ? '' : '바뀐 줄 밖이에요'
    };
  });
  const truncated = String(opt.truncated) === 'true', summary = short(opt.summary, 300);
  const clean = verdict !== 'block' || !findings.length;
  const judged = clean
    ? { summary: truncated ? '본 부분에는 큰 문제가 없어요' : '큰 문제가 없어요',
        verdict: { tone: 'ok', title: truncated ? '본 부분에는 큰 문제 없음' : '큰 문제 없음', text: `${summary}${truncated ? ' PR이 커서 앞부분만 봤어요.' : ''}` } }
    : { summary: `문제 ${findings.length}개`, verdict: { tone: 'bad', title: `큰 문제 ${findings.length}개`, text: summary }, findings };
  if (answer === 'done') done({ ...judged, outcome: { title: '직접 리뷰함' } });
  if (answer === 'approve'){
    const pr = await gh(`/repos/${REPO}/pulls/${NUM}`);
    if (pr.state !== 'open') failWith('이미 닫힌 PR이에요');
    if (pr.head.sha !== head) failWith(`검토한 뒤에 새 커밋이 올라왔어요(${head.slice(0, 7)} → ${pr.head.sha.slice(0, 7)}). 다시 검토해 주세요`);
    await gh(`/repos/${REPO}/pulls/${NUM}/reviews`, {}, { method: 'POST', body: JSON.stringify({ commit_id: head, event: 'APPROVE' }) });
    done({ ...judged, approved: true, outcome: { title: '승인함', text: `${head.slice(0, 7)}에 승인을 남겼어요` } });
  }
  done({ ...judged, ask: clean
    ? { question: '승인할까요?', inline: true, choices: [{ value: 'approve', label: truncated ? '본 부분만 보고 승인' : '승인하기', recommended: !truncated }] }
    : { question: '리뷰를 남겨 주세요', inline: true, choices: [{ value: 'done', label: '리뷰 남겼어요' }, { value: 'approve', label: '그래도 승인', confirm: 'AI가 큰 문제로 짚은 곳이 있어요. 직접 확인했으면 승인해요.' }] } });
}
