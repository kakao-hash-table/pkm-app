#!/usr/bin/env node
// 바뀐 것 모으기 — AI 작업이 끝난 작업 폴더에서 커밋·파일·남은 변경·원격에 올라갔는지를 사람이 볼 수 있게 정리한다(고치지 않는다).
//   node check.mjs --dir=<작업 폴더> --branch=feature/ABC-12 --base=main
import { execFileSync } from 'node:child_process';

const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
const failWith = msg => done({ error: msg }, 1);
const git = (...a) => { try { return execFileSync('git', ['-C', opt.dir, ...a], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim(); } catch { return null; } };

if (git('rev-parse', '--is-inside-work-tree') !== 'true') failWith(`작업 폴더를 찾지 못했어요: ${opt.dir}`);
const head = git('rev-parse', '--abbrev-ref', 'HEAD');
const range = `origin/${opt.base}..HEAD`;
const commits = (git('log', '--format=%h %s', '--no-merges', range) || '').split('\n').filter(Boolean);
const files = (git('diff', '--numstat', `origin/${opt.base}...HEAD`) || '').split('\n').filter(Boolean).map(l => { const [a, d, f] = l.split('\t'); return { file: f, add: Number(a) || 0, del: Number(d) || 0 }; });
const dirty = (git('status', '--porcelain') || '').split('\n').filter(Boolean).length;
const remote = git('ls-remote', '--heads', 'origin', opt.branch);
const warnings = [];
if (head !== opt.branch) warnings.push(`작업 폴더가 ${opt.branch}가 아니라 ${head}에 있어요`);
if (remote) warnings.push('원격에 이 브랜치가 이미 올라가 있어요. AI가 push했을 수 있으니 확인해 주세요');
if (dirty) warnings.push(`커밋하지 않은 파일이 ${dirty}개 남았어요`);
if (remote === null) warnings.push('원격을 확인하지 못했어요(회사망·VPN)');
const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
done({ path: opt.dir, branch: opt.branch, base: opt.base, commits, files: files.slice(0, 40), more_files: Math.max(0, files.length - 40), add, del, dirty, pushed: !!remote, warnings, empty: !commits.length,
  summary: commits.length ? `커밋 ${commits.length}개 · 파일 ${files.length}개 · +${add} −${del}` : 'AI가 커밋한 것이 없어요' });
