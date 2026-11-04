#!/usr/bin/env node
// 배포 — 노트의 '배포' 줄에서 올릴 곳을 찾아 고르게 묻고, 고른 것만 한다. 결과는 JSON 한 줄.
//   node deploy.mjs run --path=<로컬 클론> --deploy=<노트의 배포 줄> --repo=owner/name --web=https://github.example.com [--answer=merge:sandbox|tag:v26.11.02]
// 할 수 있는 것은 두 가지뿐이다(나머지 — PR·Actions 수동 실행·ArgoCD Sync — 는 링크만 준다):
//   merge:<브랜치>  지금 브랜치를 테스트 브랜치(sandbox·develop·qa·cbtqa·deploy/* …)에 머지해 push. 임시 worktree에서 하고, 충돌이면 멈춘다
//   tag:<이름>      기본 브랜치(origin) 끝에 운영 태그(vYY.MM.DD[.N])를 달아 push
// force push는 하지 않는다. 내 작업 폴더의 브랜치·파일은 건드리지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const home = p => String(p || '').trim().replace(/^~(?=\/|$)/, os.homedir());
export const TEST_BRANCHES = ['sandbox', 'develop', 'dev', 'qa', 'cbtqa', 'deploy/sandbox', 'deploy/develop', 'deploy/dev', 'deploy/qa', 'deploy/cbtqa'];
const MAIN = /^(master|main|release.*|deploy\/prod.*|deploy\/production)$/;

const git = (cwd, args, timeout = 300000) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
const why = e => String(e.stderr || e.message || '').trim().split('\n').slice(-4).join('\n');

// 배포 줄에 이름이 나온 테스트 브랜치만(노트가 말하지 않은 곳에는 올리지 않는다)
export function mentioned(text){
  const t = String(text || '');
  return TEST_BRANCHES.filter(b => new RegExp(`(^|[^\\w/-])${b.replace('/', '\\/')}(?=$|[^\\w/-])`).test(t));
}
// "v{yy.mm.dd}" "vYY.MM.DD" "v{yy}.{mm}.{dd}" — 운영 태그를 다는 레포인지
export const tagStyle = text => /v\{?yy\}?\.\{?mm\}?\.\{?dd\}?/i.test(String(text || ''));
export function tagName(existing, date = new Date()){
  const p = n => String(n).padStart(2, '0'), base = `v${p(date.getFullYear() % 100)}.${p(date.getMonth() + 1)}.${p(date.getDate())}`;
  if (!existing.includes(base)) return base;
  for (let i = 1; ; i++) if (!existing.includes(`${base}.${i}`)) return `${base}.${i}`;
}

function links(web, repo, branch){
  if (!web || !repo) return [];
  return [
    { where: 'GitHub Actions', url: `${web}/${repo}/actions`, text: '배포 워크플로가 도는지 여기서 봐요' },
    branch && !MAIN.test(branch) ? { where: `PR 만들기 · ${branch}`, url: `${web}/${repo}/compare/${encodeURIComponent(branch)}?expand=1`, text: 'CBT·PROD처럼 PR로 나가는 배포는 여기서 PR을 열어요' } : null
  ].filter(Boolean);
}

async function main(){
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
  const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
  const fail = msg => done({ error: msg }, 1);
  if (cmd !== 'run') fail('명령은 run이에요');
  const dir = path.resolve(home(opt.path)), answer = String(opt.answer || '').trim();
  if (!opt.path || opt.path === '-' || !fs.existsSync(path.join(dir, '.git'))) fail('로컬 클론이 없어요. 먼저 [받기]로 받아 주세요');
  const web = String(opt.web || '').replace(/\/+$/, ''), repo = String(opt.repo || '');

  try { git(dir, ['fetch', '--prune', '--tags', 'origin']); } catch (e) { fail(`fetch하지 못했어요(VPN·SSH 키 확인):\n${why(e)}`); }
  const branch = (() => { try { return git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']); } catch { return ''; } })();
  const remote = git(dir, ['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin']).split('\n').filter(b => b && b !== 'HEAD');
  const main = (() => { try { return git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, ''); } catch { return remote.includes('master') ? 'master' : remote.includes('main') ? 'main' : ''; } })();
  const tags = git(dir, ['tag', '--list', 'v*']).split('\n').filter(Boolean);
  const targets = mentioned(opt.deploy).filter(b => remote.includes(b) && b !== branch);
  const canMerge = branch && !MAIN.test(branch);
  const tag = tagStyle(opt.deploy) && main ? tagName(tags) : '';

  if (!answer){
    const choices = [
      ...(canMerge ? targets.map(b => ({ value: `merge:${b}`, label: `${b}에 올리기`, hint: `${branch}를 origin/${b}에 머지해 push`, confirm: `${branch}를 ${b}에 머지해 push해요. 되돌리려면 revert 커밋이 필요해요. 할까요?` })) : []),
      ...(tag ? [{ value: `tag:${tag}`, label: `운영 태그 ${tag}`, hint: `origin/${main} 끝에 태그를 달아 push — 운영 배포가 시작될 수 있어요`, confirm: `origin/${main}에 ${tag} 태그를 push해요. 운영 배포가 시작될 수 있어요. 정말 할까요?` }] : [])
    ];
    const findings = links(web, repo, branch);
    if (!choices.length) done({ verdict: { tone: 'bad', title: '여기서 할 수 있는 배포가 없어요', text: !canMerge ? `지금 브랜치(${branch || 'HEAD 분리'})는 테스트 브랜치에 올리지 않아요. 작업 브랜치로 바꾼 뒤 다시 해 주세요` : `노트의 배포 줄에 테스트 브랜치(${TEST_BRANCHES.slice(0, 5).join('·')} 등)나 vYY.MM.DD 태그가 없어요. PR·Actions로 하는 배포는 아래 링크에서 해요` }, findings, summary: '할 수 있는 배포 없음' });
    done({ ask: { question: `${repo || path.basename(dir)} — 어디에 배포할까요?`, hint: `지금 브랜치 ${branch || '(HEAD 분리)'} · 노트: ${String(opt.deploy || '').slice(0, 160)}`, choices, inline: true }, findings });
  }

  const [kind, value] = [answer.split(':')[0], answer.slice(answer.indexOf(':') + 1)];
  if (kind === 'merge'){
    if (!canMerge) fail(`지금 브랜치(${branch || 'HEAD 분리'})는 테스트 브랜치에 올리지 않아요`);
    if (!targets.includes(value)) fail(`${value}는 노트의 배포 줄에 없거나 origin에 없는 브랜치예요`);
    const wt = path.join(os.homedir(), '.pkm-app', 'fe-projects', 'deploy', `${path.basename(dir)}-${Date.now()}`);
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    // process.exit는 finally를 건너뛰므로 실패 이유만 모으고, worktree를 지운 뒤에 멈춘다
    let err = '';
    try {
      git(dir, ['worktree', 'add', '--detach', wt, `origin/${value}`]);
      try { git(wt, ['merge', '--no-ff', '--no-edit', '-m', `Merge branch '${branch}' into ${value}`, branch]); }
      catch (e) { try { git(wt, ['merge', '--abort']); } catch {} throw new Error(`${branch}를 ${value}에 머지하다 충돌이 났어요. 직접 머지해 주세요:\n${why(e)}`); }
      try { git(wt, ['push', 'origin', `HEAD:refs/heads/${value}`]); }
      catch (e) { throw new Error(`push하지 못했어요(그 사이 누가 올렸으면 다시 해 주세요):\n${why(e)}`); }
    } catch (e) { err = e.message.startsWith(branch) || e.message.startsWith('push') ? e.message : `준비하지 못했어요:\n${why(e)}`; }
    try { git(dir, ['worktree', 'remove', '--force', wt]); } catch {}
    try { git(dir, ['worktree', 'prune']); } catch {}
    if (err) fail(err);
    done({ verdict: { tone: 'ok', title: `${value}에 올렸어요`, text: `${branch} → origin/${value}. 배포 워크플로가 끝나면 그 환경에서 확인해 주세요` }, findings: links(web, repo, ''), outcome: { title: `${value}에 올림`, text: branch }, summary: `${branch} → ${value} push` });
  }
  if (kind === 'tag'){
    if (!tag || value !== tag) fail(`태그 이름이 바뀌었어요(지금 달 태그: ${tag || '없음'}). 처음부터 다시 해 주세요`);
    try { git(dir, ['tag', value, `origin/${main}`]); git(dir, ['push', 'origin', `refs/tags/${value}`]); }
    catch (e) { try { git(dir, ['tag', '-d', value]); } catch {} fail(`태그를 올리지 못했어요:\n${why(e)}`); }
    done({ verdict: { tone: 'ok', title: `${value} 태그를 올렸어요`, text: `origin/${main} 끝. 운영 배포 워크플로(필요하면 ArgoCD Sync)를 확인해 주세요` }, findings: links(web, repo, ''), outcome: { title: `${value} 태그`, text: main }, summary: `${value} push` });
  }
  fail(`모르는 선택이에요: ${answer}`);
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main();
