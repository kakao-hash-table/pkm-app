#!/usr/bin/env node
// 보안 공지 대응 — 고친 레포마다 지라 티켓을 만들고, 티켓 번호 브랜치로 push하고, PR을 올린다. 결과는 JSON 한 줄.
//   node ship.mjs --dir=<공지 작업 폴더> --url=<공지 링크> --title=<공지 제목> --jira_url=https://x.atlassian.net --jira_email=me@x.com
//                 --jira_project=MCLP --jira_type=작업 --summary="[Web][{repo}] 보안이슈 대응" --branch="feature/{key}" --pr_base=master
//                 --github_api=https://github.example.com/api/v3 [--assignee=<GitHub 아이디>] [--answer=ship:<레포>|ship|done]
// 답 없이 부르면 고친 레포(짚은 곳)마다 [티켓 만들고 PR 올리기] 버튼을 두고 묻는다. --answer=ship:<레포>면 그 레포 하나만, --answer=ship이면 남은 레포를 모두
// 티켓 → 커밋 메시지 첫 줄을 "<티켓 번호>: <티켓 제목>"으로 → 브랜치 이름 바꾸기 → push → PR(제목도 같은 꼴) → 담당자 순서로 한다. 올리지 않은 레포가 남아 있으면 다시 묻는다.
// 한 일은 작업 폴더의 ship.json에 바로 적어서, 중간에 실패해 다시 눌러도 티켓·PR을 두 번 만들지 않는다. 강제 push는 하지 않는다.
// 토큰은 환경 변수 JIRA_TOKEN, GITHUB_TOKEN.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarize, coreOf } from './notice.mjs';

const argval = v => { const s = String(v ?? ''); return s.startsWith('@file:') ? fs.readFileSync(s.slice(6), 'utf8') : s; };
const home = p => String(p || '').trim().replace(/^~(?=\/|$)/, os.homedir());
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const fillName = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
const KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;

// 아지트 글(마크다운) → 지라 위키 문법. 제목·링크·인용만 옮기고, 대괄호 이스케이프(\[)는 두 문법이 같아 그대로 둔다
export const toWiki = md => String(md || '').split('\n').map(l => l
  .replace(/\[@@?[^\]]*\]\([^)]*\)\s*/g, '')                                   // [@group](…) 멘션
  .replace(/(?<!\\)\[((?:\\.|[^\]\\])*)\]\((https?:[^)\s]+)\)/g, (m, t, u) => `[${t.replace(/\|/g, '/')}|${u}]`)
  .replace(/^\s*>\s?/, '')
  .replace(/^(#{1,6})\s+/, (m, h) => `h${Math.min(6, h.length + 2)}. `)
  .replace(/([{}])/g, '\\$1')).join('\n').replace(/\n{3,}/g, '\n\n').trim();

const changeRows = r => (Array.isArray(r.changes) ? r.changes : []).filter(c => c && c.file).slice(0, 20);
// 지라 설명: 어느 공지 때문에 이 레포에서 무엇을 고치는지 먼저, 공지 본문은 아래에
export function jiraBody({ repo, url, title, notice }){
  const rows = changeRows(repo).map(c => `# ${c.file}${c.line ? `:${c.line}` : ''} {{${String(c.before ?? '').replace(/[{}]/g, '')}}}에서 {{${String(c.after ?? '').replace(/[{}]/g, '')}}}으로`);
  return [`보안 공지에 맞춰 ${repo.name} 레포를 고칩니다.`, '',
    `* 공지: ${url ? `[${String(title).replace(/([\[\]|{}])/g, '\\$1')}|${url}]` : String(title).replace(/([\[\]{}])/g, '\\$1')}`,
    `* 레포: ${repo.name}`, '',
    'h3. 이 레포에서 고칠 것', String(repo.problem || '').replace(/([\[\]{}])/g, '\\$1'), ...rows, '',
    'h3. 공지 내용', toWiki(notice).slice(0, 24000)].join('\n').slice(0, 30000);
}
// PR 본문: 팀 PR 관례(JIRA·Agit 줄)를 맨 위에, 그 아래 바꾼 것·확인한 것·머지 뒤 할 일
export function prBody({ repo, key, keyUrl, url, title, note }){
  const rows = changeRows(repo).map((c, i) => `${i + 1}. \`${c.file}${c.line ? `:${c.line}` : ''}\` \`${String(c.before ?? '').replace(/`/g, '')}\`에서 \`${String(c.after ?? '').replace(/`/g, '')}\`으로`);
  return [`- JIRA: [${key}](${keyUrl})`, url ? `- Agit: [${String(title).replace(/[\[\]]/g, '')}](${url})` : `- 공지: ${title}`, '',
    '## 무엇을 바꿨나', String(repo.problem || ''), '', ...rows,
    ...(repo.tests ? ['', '## 확인한 것', String(repo.tests)] : []),
    ...(repo.todo ? ['', '## 머지 뒤 할 일', String(repo.todo)] : []),
    ...(note ? ['', '## 참고', note] : [])].join('\n').slice(0, 60000);
}
// origin 주소 → { host, owner, name }
export function remoteOf(u){
  const m = String(u || '').trim().match(/^(?:ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[:/](?:\d+\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/) || String(u || '').trim().match(/^https?:\/\/(?:[^@/]+@)?([\w.-]+)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? { host: m[1].toLowerCase(), owner: m[2], name: m[3] } : null;
}
// Jira 로그인 이메일을 비워 두면 지라 자동 작업 플러그인의 설정을 빌려 쓴다(같은 것을 두 번 적지 않게)
export function autopilotEmail(conf){
  for (const prof of Object.values((conf && conf.profiles) || {})){
    const v = prof && prof.plugins && prof.plugins['jira-autopilot'] && prof.plugins['jira-autopilot'].settings && prof.plugins['jira-autopilot'].settings.jira_email;
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}
const webOf = api => { const u = new URL(api); return u.hostname === 'api.github.com' ? 'github.com' : u.hostname.toLowerCase(); };

async function main(){
  const o = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), argval(a.slice(i + 1))]; }));
  const done = obj => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(0); };
  const failWith = msg => { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); };

  const dir = path.resolve(home(o.dir));
  const report = readJSON(path.join(dir, 'report.json'));
  const fixed = ((report && Array.isArray(report.repos)) ? report.repos : []).filter(r => r && r.name && r.status === 'fixed');
  if (!fixed.length) done({ summary: '올릴 것이 없어요' });   // 해당 없음·고친 곳 없음 — 묻지 않고 끝낸다
  const base = summarize(report);
  const stateFile = path.join(dir, 'ship.json');
  const state = readJSON(stateFile) || {};
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  const left = fixed.filter(r => !(state[r.name] && state[r.name].pr_url));
  const title = String(o.title || '보안 공지');

  const project = String(o.jira_project || '').trim().toUpperCase();
  const shipConfirm = name => `${name} 레포에 ${project} 티켓을 만들고, ${fillName(o.branch || 'feature/{key}', { key: `${project}-번호` })} 브랜치로 push하고, ${o.pr_base || 'master'}로 PR을 올려요. 팀에 보이는 일이라 되돌리기 어려워요.`.slice(0, 200);
  const baseOf = name => base.findings.find(f => f.where === name || String(f.where).startsWith(`${name} · `));
  // 결과 줄: 올린 레포는 PR 링크. 아직 안 올린 레포는 점검 결과 그대로에 그 줄의 [티켓 만들고 PR 올리기] 버튼(ask가 true일 때)과, 실패했으면 멈춘 곳
  const shipFinds = ask => [...fixed.map(r => {
    const s = state[r.name] || {};
    const rows = [s.key && `티켓: ${s.key_url}`, s.branch && `브랜치: ${s.branch}${s.pushed ? ' (push함)' : ' (push 전)'}`, s.pr_url && `PR: ${s.pr_url} (${s.base} ← ${s.branch})`, s.assignee && `담당자: ${s.assignee}`, s.note && `참고: ${s.note}`, s.error && `멈춘 곳: ${s.error}`].filter(Boolean);
    if (s.pr_url) return { where: r.name, url: s.pr_url, tag: s.error ? '확인 필요' : 'PR 올림', title: [coreOf(r), s.key, `PR #${s.pr}`, s.base !== (o.pr_base || 'master') && `${s.base}으로`].filter(Boolean).join(' · '), text: [rows.join('\n'), (baseOf(r.name) || {}).text].filter(Boolean).join('\n').slice(0, 1800), more: true };
    const b = baseOf(r.name) || { where: r.name, title: String(r.problem || '').slice(0, 200), text: '' };
    return { ...b, ...(s.key_url ? { url: s.key_url } : {}), tag: s.error ? '실패' : b.tag || '올리기 전', title: s.error ? String(s.error).split('\n')[0].slice(0, 120) : b.title, text: [...rows, b.text].filter(Boolean).join('\n').slice(0, 1800), more: true,
      ...(ask ? { choose: { value: `ship:${r.name}`, label: s.error ? '다시 올리기' : '티켓 만들고 PR 올리기', confirm: shipConfirm(r.name) } } : {}) };
  }), ...base.findings.filter(f => !fixed.some(r => baseOf(r.name) === f))];
  const FOLD = '고칠 곳이 없는 레포';
  const shipped = () => fixed.filter(r => state[r.name] && state[r.name].pr_url).length;

  if (o.answer === 'done'){
    const n = shipped();
    done(n ? { verdict: { tone: n === fixed.length ? 'ok' : 'bad', title: `PR ${n}개를 올렸어요${n < fixed.length ? `, ${fixed.length - n}개는 올리지 않았어요` : ''}`, text: '' }, fold_label: FOLD, findings: shipFinds(false), outcome: { title: `PR ${n}개 올림` }, summary: `PR ${n}개 올림` }
      : { verdict: base.verdict, fold_label: FOLD, findings: base.findings, outcome: { title: '올리지 않고 끝냄' }, summary: '올리지 않고 끝냄' });
  }

  // 준비: 모자란 것은 한 번에 모아서 알린다
  const jiraUrl = String(o.jira_url || '').trim().replace(/\/+$/, ''), api = String(o.github_api || '').trim().replace(/\/+$/, '');
  const miss = [];
  if (!process.env.JIRA_TOKEN) miss.push('Jira 토큰');
  if (!process.env.GITHUB_TOKEN) miss.push('GitHub 토큰');
  if (!/^https?:\/\/[^/\s]+/.test(jiraUrl)) miss.push('Jira 주소');
  if (!/^https?:\/\/[^/\s]+/.test(api)) miss.push('GitHub API 주소');
  if (!/^[A-Z][A-Z0-9_]+$/.test(project)) miss.push('티켓을 만들 지라 프로젝트');
  const cloud = /^https?:\/\/[^/\s]+/.test(jiraUrl) && /\.atlassian\.net$/.test(new URL(jiraUrl).hostname);
  const email = String(o.jira_email || '').trim() || autopilotEmail(readJSON(path.join(os.homedir(), '.pkm-app', 'runner.json')));   // 비우면 지라 자동 작업 플러그인에 적어 둔 이메일
  if (cloud && !email) miss.push('Jira 로그인 이메일');
  if (miss.length) failWith(`티켓과 PR을 올리려면 플러그인 설정에 넣어 주세요: ${miss.join(', ')}${miss.some(m => /토큰/.test(m)) ? '' : ' (토큰이 아니라 설정 칸이에요)'}`);

  // 묻기: 짚은 곳(레포)마다 버튼. 아래 버튼은 남은 것 모두(둘 이상 남았을 때)와 끝내기
  const askLeft = () => {
    const rest = fixed.filter(r => !(state[r.name] && state[r.name].pr_url)), names = rest.map(r => r.name), n = shipped();
    return { batch: true, question: n ? `남은 레포 ${rest.length}개도 올릴까요?` : `올릴 레포를 골라 주세요`, hint: `레포마다 [티켓 만들고 PR 올리기]를 눌러요 · ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` 외 ${names.length - 8}개` : ''}`, inline: true,
      choices: [...(rest.length > 1 ? [{ value: 'ship', label: `남은 ${rest.length}개 모두 올리기`,
        confirm: `레포 ${rest.length}개마다 ${project} 티켓을 만들고, ${fillName(o.branch || 'feature/{key}', { key: `${project}-번호` })} 브랜치로 push하고, ${o.pr_base || 'master'}로 PR을 올려요. 팀에 보이는 일이라 되돌리기 어려워요.` }] : []),
      { value: 'done', label: n ? '이대로 끝내기' : '올리지 않고 끝내기' }] };
  };
  // 답은 여러 줄일 수 있다(도는 중에 누른 레포를 실행기가 한 번에 넘긴다, ask.batch): ship:<레포> 줄마다 그 레포, ship이 있으면 남은 것 모두
  const answers = String(o.answer || '').split('\n').map(v => v.trim()).filter(Boolean), names = answers.filter(v => v.startsWith('ship:')).map(v => v.slice(5));
  const one = names.length ? names.join(', ') : null;
  const todo = answers.includes('ship') ? left : left.filter(r => names.includes(r.name));
  if (!todo.length){
    const n = shipped();
    if (!left.length) done({ verdict: { tone: 'ok', title: `티켓과 PR ${n}개를 올렸어요`, text: '' }, fold_label: FOLD, findings: shipFinds(false), outcome: { title: `PR ${n}개 올림` }, summary: `PR ${n}개 올림` });
    done({ verdict: n ? { tone: 'bad', title: `PR ${n}개를 올렸고 ${left.length}개가 남았어요`, text: one !== null ? `${one}은 이미 올렸거나 고친 레포가 아니에요` : '' } : base.verdict, fold_label: FOLD, findings: shipFinds(true), ask: askLeft(), summary: `올릴 레포 ${left.length}개` });
  }

  /* ---------- 올리기 ---------- */
  const noticeFile = (() => { try { return fs.readFileSync(path.join(dir, 'notice.md'), 'utf8'); } catch { return ''; } })();
  const notice = noticeFile.replace(/^# .*\n+(?:- .*\n)*\n?/, '');   // fetch가 붙인 머리(제목·글 번호·가져온 때)는 뺀다
  const jAuth = email ? `Basic ${Buffer.from(`${email}:${process.env.JIRA_TOKEN}`).toString('base64')}` : `Bearer ${process.env.JIRA_TOKEN}`;
  const call = async (what, url, headers, init = {}) => {
    let r;
    try { r = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...headers }, signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error(`${what}(${new URL(url).host})에 닿지 않아요. 회사망·VPN 연결을 확인해 주세요`); }
    const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch {}
    if (r.status === 401) throw new Error(`${what} 토큰이 맞지 않거나 만료됐어요. 플러그인 설정에서 다시 넣어 주세요`);
    if (!r.ok){ const e = new Error(`${what} 오류 ${r.status}: ${(d && (d.message || (d.errorMessages || []).join(' ') || JSON.stringify(d.errors || ''))) || t.slice(0, 200)}`.slice(0, 400)); e.status = r.status; e.data = d; throw e; }
    return d;
  };
  const jira = (p, init) => call('Jira', `${jiraUrl}/rest/api/2${p}`, { authorization: jAuth }, init);
  const gh = (p, init) => call('GitHub', `${api}${p}`, { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' }, init);
  const git = (cwd, args, timeout = 60000) => new Promise((ok, no) => execFile('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout, maxBuffer: 8 << 20,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes' } },
    (e, out, err) => e ? no(new Error(String(err || e.message).trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300))) : ok(String(out).trim())));
  const tryGit = (cwd, args) => git(cwd, args).catch(() => null);

  // 레포와 상관없는 것은 먼저 한 번: 내 계정, 이슈 타입
  let me, ghMe, typeId;
  try {
    [me, ghMe] = await Promise.all([jira('/myself'), gh('/user')]);
    const meta = await jira(`/issue/createmeta/${project}/issuetypes`);
    const types = ((meta && (meta.issueTypes || meta.values)) || []).filter(t => !t.subtask);
    const want = String(o.jira_type || '작업').trim().toLowerCase(), alias = { task: '작업', '작업': 'task', bug: '버그', '버그': 'bug', story: '스토리', '스토리': 'story' };
    const hit = types.find(t => String(t.name).toLowerCase() === want) || types.find(t => String(t.name).toLowerCase() === alias[want]);
    if (!hit) failWith(`${project}에 "${o.jira_type || '작업'}" 이슈 타입이 없어요. 쓸 수 있는 것: ${types.map(t => t.name).join(', ') || '없음'}`);
    typeId = hit.id;
  } catch (e) { failWith(e.message); }
  const assignee = String(o.assignee || '').trim() || ghMe.login;
  const apiHost = webOf(api);

  async function ship(r){
    const s = state[r.name] ||= {};
    s.error = null;
    const wt = path.resolve(home(r.worktree || path.join(dir, r.name)));
    if (!(wt + path.sep).startsWith(dir + path.sep) || !fs.existsSync(wt)) throw new Error(`작업 폴더를 찾지 못했어요: ${wt}`);
    if (await tryGit(wt, ['rev-parse', '--is-inside-work-tree']) !== 'true') throw new Error(`git 작업 폴더가 아니에요: ${wt}`);
    const rem = remoteOf(await tryGit(wt, ['remote', 'get-url', 'origin']));
    if (!rem) throw new Error('origin 원격 주소를 읽지 못했어요');
    if (rem.host !== apiHost) throw new Error(`원격(${rem.host})이 설정한 GitHub(${apiHost})과 달라요`);
    const dirty = ((await git(wt, ['status', '--porcelain'])) || '').split('\n').filter(Boolean).length;
    if (dirty) throw new Error(`커밋하지 않은 파일이 ${dirty}개 있어요. 작업 폴더에서 커밋하거나 되돌린 뒤 다시 눌러 주세요`);
    const cur = await git(wt, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (cur === 'HEAD') throw new Error('작업 폴더가 브랜치 위에 있지 않아요');

    // PR을 보낼 브랜치: 설정한 곳(master)
    const from = String(r.base || '').replace(/^origin\//, ''), want = String(o.pr_base || 'master').trim();
    const has = async b => !!b && (await tryGit(wt, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${b}`])) !== null;
    const count = async b => Number(await git(wt, ['rev-list', '--count', `origin/${b}..HEAD`]));
    let target = want;
    if (!(await has(want))){ if (!(await has(from))) throw new Error(`원격에 ${want} 브랜치가 없어요`); target = from; s.note = `원격에 ${want}가 없어서 ${from}으로 PR을 올렸어요`; }
    else if (from && from !== want && await has(from) && (await count(want)) > (await count(from))){
      // 다른 브랜치(develop 등)에서 갈라진 수정 — 수정 커밋만 want(master) 위로 옮긴다. 이미 push한 브랜치는 덮어쓰지 않는다(강제 push 안 함)
      if (s.pushed){ target = from; s.note = `${from}에서 갈라진 채로 이미 push해서 ${from}으로 PR을 올렸어요`; }
      else {
        let moved = true;
        try { await git(wt, ['rebase', '--onto', `origin/${want}`, `origin/${from}`], 120000); }
        catch { await tryGit(wt, ['rebase', '--abort']); moved = false; }   // 충돌 — master에는 고칠 곳이 다르게 생겼다. 검증한 수정 그대로 갈라진 브랜치로 보낸다
        if (moved){ r.base = `origin/${want}`; r.commit = await git(wt, ['rev-parse', '--short', 'HEAD']); s.note = null; }
        else { target = from; s.note = `${from}에서 만든 수정을 ${want} 위로 옮기면 충돌이 나서 ${from}으로 PR을 올렸어요(${want}에는 고칠 곳이 다르게 생겼어요)`; }
        try { fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2)); } catch {}
      }
    }
    else s.note = null;
    if (!(await count(target))) throw new Error(`${target}보다 앞선 커밋이 없어요`);
    s.base = target;

    // 1. 지라 티켓
    if (!s.key){
      const made = await jira('/issue', { method: 'POST', body: JSON.stringify({ fields: { project: { key: project }, issuetype: { id: typeId }, summary: fillName(o.summary || '[Web][{repo}] 보안이슈 대응', { repo: r.name }).slice(0, 250),
        description: jiraBody({ repo: r, url: o.url, title, notice }), ...(me.accountId ? { assignee: { accountId: me.accountId } } : me.name ? { assignee: { name: me.name } } : {}) } }) });
      if (!made || !KEY_RE.test(made.key)) throw new Error('Jira가 티켓 번호를 돌려주지 않았어요');
      Object.assign(s, { key: made.key, key_url: `${jiraUrl}/browse/${made.key}` }); save();
    }
    // 커밋 메시지 첫 줄과 PR 제목은 같은 꼴: "<티켓 번호>: <티켓 제목>". 본문(바뀐 파일 요약)은 그대로 둔다
    const subject = `${s.key}: ${fillName(o.summary || '[Web][{repo}] 보안이슈 대응', { repo: r.name })}`.slice(0, 250);
    if (!s.pushed && (await git(wt, ['log', '-1', '--format=%s'])) !== subject){
      if ((await count(target)) === 1){
        const body = await git(wt, ['log', '-1', '--format=%b']);
        await git(wt, ['commit', '--amend', '--no-edit', '--allow-empty', '-m', subject, ...(body ? ['-m', body] : [])], 240000).catch(e => { throw new Error(`커밋 메시지를 "${subject}"로 바꾸지 못했어요: ${e.message}`); });
        r.commit = await git(wt, ['rev-parse', '--short', 'HEAD']);
      } else s.note = [s.note, `커밋이 여러 개라 커밋 메시지는 그대로 뒀어요(PR 제목만 "${subject}")`].filter(Boolean).join(' · ');
    }
    // 2. 티켓 번호 브랜치로 push
    const branch = fillName(o.branch || 'feature/{key}', { key: s.key }).trim();
    if (cur !== branch){
      await git(wt, ['check-ref-format', '--branch', branch]).catch(() => { throw new Error(`브랜치 이름이 맞지 않아요: ${branch}`); });
      if ((await tryGit(wt, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) !== null) throw new Error(`${branch} 브랜치가 이미 있어요. 그 브랜치를 확인해 주세요`);
      await git(wt, ['branch', '-m', cur, branch]);
    }
    s.branch = branch; r.branch = branch; save();
    if (!s.pushed){
      // husky 8: 훅이 .husky/_/husky.sh를 부르는데, 에이전트가 HUSKY=0으로 설치해 작업 폴더에는 그 파일이 없다. 훅을 건너뛰지 않고 파일을 만들어 준다
      const hook = path.join(wt, '.husky', 'pre-push'), bin = path.join(wt, 'node_modules', '.bin', 'husky');
      if (fs.existsSync(hook) && /_\/husky\.sh/.test(fs.readFileSync(hook, 'utf8')) && !fs.existsSync(path.join(wt, '.husky', '_', 'husky.sh')) && fs.existsSync(bin))
        await new Promise(ok => execFile(bin, ['install'], { cwd: wt, timeout: 60000 }, () => ok()));
      await git(wt, ['push', '-u', 'origin', `${branch}:${branch}`], 240000); s.pushed = true; save();
    }
    // 3. PR과 담당자
    const repoPath = `/repos/${rem.owner}/${rem.name}`;
    if (!s.pr_url){
      const open = await gh(`${repoPath}/pulls?state=open&head=${encodeURIComponent(`${rem.owner}:${branch}`)}&base=${encodeURIComponent(target)}`);
      const pr = (Array.isArray(open) && open[0]) || await gh(`${repoPath}/pulls`, { method: 'POST', body: JSON.stringify({ title: subject, head: branch, base: target,
        body: prBody({ repo: r, key: s.key, keyUrl: s.key_url, url: o.url, title, note: s.note }) }) });
      Object.assign(s, { pr: pr.number, pr_url: pr.html_url }); save();
    }
    if (!s.assignee){
      try { await gh(`${repoPath}/issues/${s.pr}/assignees`, { method: 'POST', body: JSON.stringify({ assignees: [assignee] }) }); s.assignee = assignee; }
      catch (e) { s.error = `PR은 올렸지만 담당자(${assignee})를 넣지 못했어요: ${e.message}`; }
      save();
    }
  }

  // 레포 셋씩 함께(스크립트는 10분 안에 끝나야 한다). 한 레포가 실패해도 나머지는 이어서 한다
  const queue = [...todo];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let r; (r = queue.shift());){
      try { await ship(r); } catch (e) { (state[r.name] ||= {}).error = String(e.message || e).slice(0, 400); }
      save();
    }
  }));
  try { fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2)); } catch {}   // 바뀐 브랜치 이름을 결과 파일에도

  const n = shipped(), rest = fixed.filter(r => !(state[r.name] && state[r.name].pr_url)), bad = todo.filter(r => !(state[r.name] && state[r.name].pr_url)), warn = fixed.filter(r => state[r.name] && state[r.name].pr_url && state[r.name].error);
  const moved = fixed.filter(r => state[r.name] && state[r.name].pr_url && state[r.name].note).length;
  const text = [moved && `${moved}개는 ${o.pr_base || 'master'}가 아닌 브랜치로 보냈어요`, warn.length && `${warn.length}개는 담당자를 넣지 못했어요`].filter(Boolean).join(' · ');
  if (rest.length) done({ verdict: { tone: 'bad', title: bad.length ? `${bad.map(r => r.name).slice(0, 3).join(', ')}${bad.length > 3 ? ` 외 ${bad.length - 3}개` : ''} 레포를 올리지 못했어요 · PR ${n}개 올림` : `PR ${n}개를 올렸고 ${rest.length}개가 남았어요`, text }, fold_label: FOLD, findings: shipFinds(true), ask: askLeft(),
    summary: `PR ${n}개 올림 · 남음 ${rest.length}${bad.length ? ` · 실패 ${bad.length}` : ''}` });
  done({ verdict: { tone: 'ok', title: `티켓과 PR ${n}개를 올렸어요`, text }, fold_label: FOLD, findings: shipFinds(false), outcome: { title: `PR ${n}개 올림` }, summary: `PR ${n}개 올림` });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
