#!/usr/bin/env node
// 작업 폴더와 브랜치 — 티켓마다 git worktree를 따로 만든다. 내가 쓰는 저장소 폴더(체크아웃·고치던 파일)는 건드리지 않는다.
//   node branch.mjs --dir=~/code/web --key=ABC-12 --branch="feature/{key}" [--base=develop] --bases="main, master, develop" --worktrees=~/.pkm-worktrees
// 결과: { path, branch, base, repo, created }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
const failWith = msg => done({ error: msg }, 1);
const home = p => String(p || '').replace(/^~(?=\/|$)/, os.homedir());
const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
const tryGit = (...a) => { try { return git(...a); } catch { return null; } };
const why = e => String((e.stderr || e.message || '')).trim().split('\n').pop();

const dir = home(opt.dir), key = String(opt.key || '');
if (!dir || !fs.existsSync(path.join(dir, '.git'))) failWith(`git 저장소가 아니에요: ${dir}`);
if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) failWith(`티켓 키 형식이 맞지 않아요: ${key}`);
const branch = String(opt.branch || 'feature/{key}').replaceAll('{key}', key).trim();
try { execFileSync('git', ['check-ref-format', '--branch', branch], { stdio: 'ignore' }); } catch { failWith(`브랜치 이름이 맞지 않아요: ${branch}. 플러그인 설정의 브랜치 이름을 확인해 주세요`); }
const repo = path.basename(dir);
const wt = path.join(home(opt.worktrees || '~/.pkm-worktrees'), `${repo}-${key}`);

// 이미 만든 작업 폴더면 그대로 쓴다(다시 하기)
const list = tryGit('worktree', 'list', '--porcelain') || '';
const existing = list.split('\n\n').map(b => ({ path: (b.match(/^worktree (.+)$/m) || [])[1], branch: ((b.match(/^branch refs\/heads\/(.+)$/m) || [])[1]) })).find(w => w.branch === branch);
if (existing && existing.path){
  const base = (tryGit('config', `branch.${branch}.pkm-base`) || '');
  done({ path: existing.path, branch, base, repo, created: false, summary: `이미 만든 작업 폴더를 써요 · ${branch}` });
}

if (!tryGit('remote', 'get-url', 'origin')) failWith(`${repo}에 origin 원격이 없어요`);
try { git('fetch', 'origin', '--prune'); } catch (e) { failWith(`원격을 받지 못했어요(${why(e)}). 회사망·VPN과 git 로그인을 확인해 주세요`); }
const bases = [opt.base, ...String(opt.bases || 'main, master, develop').split(',')].map(s => String(s || '').trim()).filter(Boolean);
const base = bases.find(b => tryGit('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${b}`) !== null);
if (!base) failWith(`원격에 기준 브랜치가 없어요(찾아본 것: ${[...new Set(bases)].join(', ')}). 저장소 규칙에 (기준 브랜치)를 적어 주세요`);
if (fs.existsSync(wt)) failWith(`작업 폴더 자리에 이미 다른 폴더가 있어요: ${wt}. 지우거나 옮긴 뒤 다시 해 주세요`);
fs.mkdirSync(path.dirname(wt), { recursive: true });
const hasLocal = tryGit('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`) !== null;
try {
  if (hasLocal) git('worktree', 'add', wt, branch);
  else git('worktree', 'add', '--no-track', '-b', branch, wt, `origin/${base}`);
} catch (e) { failWith(`작업 폴더를 만들지 못했어요: ${why(e)}`); }
tryGit('config', `branch.${branch}.pkm-base`, base);   // 다시 하기·검증 때 기준 브랜치를 안다
const before = hasLocal ? Number(tryGit('rev-list', '--count', `origin/${base}..${branch}`) || 0) : 0;
done({ path: wt, branch, base, repo, created: !hasLocal, existing_commits: before, summary: hasLocal ? `있던 ${branch} 브랜치에서 이어 해요${before ? ` · 이전 커밋 ${before}개` : ''}` : `${base}에서 ${branch}를 만들었어요` });
