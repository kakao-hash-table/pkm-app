#!/usr/bin/env node
// 작업할 저장소 찾기 — 규칙(지라 프로젝트 키·제목 [태그] → 저장소 폴더) → 브랜치 이력 → 그래도 모르면 사람에게 묻는다.
//   node project.mjs --key=ABC-12 --summary="[웹] 버튼 고치기" --repos=~/code --rules="ABC → web (기준 develop)" [--answer=web]
// 결과: { dir, name, base, how } 또는 { ask: { question, choices } }. 사람이 고른 답은 규칙에 한 줄 더해 기억한다(settings_patch).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
const failWith = msg => done({ error: msg }, 1);
const home = p => String(p || '').replace(/^~(?=\/|$)/, os.homedir());

const key = String(opt.key || ''), project = key.split('-')[0], summary = String(opt.summary || '');
const repos = home(opt.repos);
if (!repos) failWith('저장소가 모여 있는 폴더를 플러그인 설정에 적어 주세요');
if (!fs.existsSync(repos) || !fs.statSync(repos).isDirectory()) failWith(`저장소 폴더가 없어요: ${repos}`);
const isRepo = d => fs.existsSync(path.join(d, '.git'));
const all = fs.readdirSync(repos, { withFileTypes: true }).filter(e => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.')).map(e => path.join(repos, e.name)).filter(isRepo);
const byName = n => { const d = path.isAbsolute(home(n)) ? home(n) : path.join(repos, n); return isRepo(d) ? d : null; };

// 규칙 한 줄: "ABC → web (기준 develop)" · "[웹] → web" · "ABC, [웹] → web"
const rules = String(opt.rules || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
  const m = l.match(/^(.+?)\s*(?:→|->)\s*(.+?)(?:\s*\(\s*기준\s+([^)\s]+)\s*\))?$/);
  return m ? { keys: m[1].split(',').map(s => s.trim()).filter(Boolean), repo: m[2].trim(), base: m[3] || '' } : null;
}).filter(Boolean);
const tags = [...summary.matchAll(/\[([^\]]+)\]/g)].map(m => `[${m[1].trim()}]`);
const out = (dir, base, how, extra = {}) => done({ dir, name: path.basename(dir), base: base || '', how, summary: `${path.basename(dir)} (${how})`, ...extra });

if (opt.answer){
  const dir = byName(opt.answer);
  if (!dir) failWith(`git 저장소가 아니에요: ${opt.answer}`);
  const line = `${project} → ${path.basename(dir)}`;
  const known = rules.some(r => r.keys.includes(project) && byName(r.repo) === dir);
  out(dir, '', '내가 고름', known ? {} : { settings_patch: { projects: [String(opt.rules || '').trim(), line].filter(Boolean).join('\n') }, remembered: line });
}

for (const r of rules){
  if (!r.keys.some(k => k === project || tags.includes(k))) continue;
  const dir = byName(r.repo);
  if (!dir) failWith(`저장소 규칙 "${r.keys.join(', ')} → ${r.repo}"의 폴더가 git 저장소가 아니에요`);
  out(dir, r.base, '규칙');
}

// 브랜치 이력 — 이 지라 프로젝트 키가 들어간 브랜치가 있는 저장소
const git = (d, ...a) => { try { return execFileSync('git', ['-C', d, ...a], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const hits = all.map(d => ({ d, n: git(d, 'for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes').split('\n').filter(b => b.includes(`${project}-`)).length })).filter(x => x.n).sort((a, b) => b.n - a.n);
if (hits.length === 1) out(hits[0].d, '', `브랜치 이력 ${hits[0].n}개`, { settings_patch: { projects: [String(opt.rules || '').trim(), `${project} → ${path.basename(hits[0].d)}`].filter(Boolean).join('\n') }, remembered: `${project} → ${path.basename(hits[0].d)}` });
if (!all.length) failWith(`${repos} 바로 아래에 git 저장소가 없어요`);

const ranked = [...hits.map(h => h.d), ...all.filter(d => !hits.some(h => h.d === d))];
done({ ask: {
  question: `${key}는 어느 저장소에서 작업할까요?`,
  hint: hits.length ? `${project}- 브랜치가 있는 저장소가 ${hits.length}곳이에요` : `${project} 프로젝트는 처음 봐요. 고른 답은 저장소 규칙에 더해서 다음부터는 묻지 않아요`,
  // 근거(이 프로젝트 키의 브랜치)가 가장 많은 한 곳만 추천 — 근거가 없으면 아무것도 미리 고르지 않는다(답은 규칙으로 기억되니까)
  choices: ranked.slice(0, 20).map((d, i) => { const h = hits.find(x => x.d === d); return { value: path.basename(d), label: path.basename(d), hint: h ? `${project}- 브랜치 ${h.n}개` : '', recommended: !!h && i === 0 }; })
} });
