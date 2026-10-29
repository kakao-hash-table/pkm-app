#!/usr/bin/env node
// 작업할 저장소 찾기 — 규칙(지라 프로젝트 키·제목 [태그] → 저장소 폴더, 여러 개 가능) → 브랜치 이력 → 그래도 모르면 사람에게 묻는다.
//   node project.mjs --key=ABC-12 --summary="[웹] 버튼 고치기" --repos=~/code --rules="ABC → web, api (기준 develop)" [--answer=web | --answer=*]
// 결과: { dir, name, base, how, lane, change, fork } 또는 { ask: { question, choices } }.
// 후보가 하나면 그대로, 여럿이면 묻는다. --answer=* 는 모든 저장소에서 다시 고르기(저장소 바꾸기·다른 저장소에서도 작업).
// 사람이 고른 저장소는 그 프로젝트 키 규칙에 더해 기억한다(덮어쓰지 않음, settings_patch).
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

// 규칙 한 줄: "ABC → web (기준 develop)" · "[웹] → web" · "ABC, [웹] → web, api"
const rules = String(opt.rules || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
  const m = l.match(/^(.+?)\s*(?:→|->)\s*(.+?)(?:\s*\(\s*기준\s+([^)\s]+)\s*\))?$/);
  return m ? { line: l, keys: m[1].split(',').map(s => s.trim()).filter(Boolean), repos: m[2].split(',').map(s => s.trim()).filter(Boolean), base: m[3] || '' } : null;
}).filter(Boolean);
const tags = [...summary.matchAll(/\[([^\]]+)\]/g)].map(m => `[${m[1].trim()}]`);

// 결과에 저장소 바꾸기·다른 저장소에서도 작업 버튼을 남긴다(앱이 그린다). lane은 같은 티켓에서 갈래를 가르는 이름
const out = (dir, base, how, extra = {}) => done({ dir, name: path.basename(dir), base: base || '', how, summary: `${path.basename(dir)} (${how})`, lane: path.basename(dir),
  change: { label: '저장소 바꾸기', value: '*' }, fork: { label: '다른 저장소에서도 작업', value: '*' }, ...extra });
// 고른 저장소를 그 프로젝트 키 규칙 줄에 더한다 — 이미 연결돼 있으면 그대로, 줄이 없으면 새 줄
const remember = dir => {
  if (rules.some(r => r.keys.includes(project) && r.repos.some(n => byName(n) === dir))) return {};
  const name = path.basename(dir), text = String(opt.rules || '').trim(), own = rules.find(r => r.keys.length === 1 && r.keys[0] === project);
  const line = own ? own.line.replace(/(?:→|->)\s*(.+?)(\s*\(\s*기준\s+[^)\s]+\s*\))?$/, (m, list, b) => `→ ${list}, ${name}${b || ''}`) : `${project} → ${name}`;
  const projects = own ? text.split('\n').map(l => l.trim() === own.line ? line : l).join('\n') : [text, line].filter(Boolean).join('\n');
  return { settings_patch: { projects }, remembered: line };
};
const ask = (question, hint, first, recommend) => {
  const top = first.filter((d, i) => first.indexOf(d) === i), ranked = [...top, ...all.filter(d => !top.includes(d))];
  if (!ranked.length) failWith(`${repos} 바로 아래에 git 저장소가 없어요`);
  done({ ask: { question, hint, choices: ranked.slice(0, 20).map(d => ({ value: path.basename(d), label: path.basename(d), hint: top.includes(d) ? `${project}에 연결됨` : '', recommended: d === recommend })) } });
};

// 규칙 후보 — 제목 [태그] 규칙이 맞으면 그것만, 아니면 프로젝트 키 규칙
const byTag = rules.filter(r => r.keys.some(k => tags.includes(k))), matched = byTag.length ? byTag : rules.filter(r => r.keys.includes(project));
const cands = [];
for (const r of matched) for (const n of r.repos){
  const dir = byName(n);
  if (!dir) failWith(`저장소 규칙 "${r.line}"의 ${n}이 git 저장소가 아니에요`);
  if (!cands.some(c => c.dir === dir)) cands.push({ dir, base: r.base });
}

if (opt.answer === '*') ask(`${key}를 어느 저장소에서 작업할까요?`, cands.length ? `${project}에 연결된 저장소가 위에 있어요. 다른 저장소를 고르면 ${project}에 더해 기억해요` : `고른 저장소는 ${project}에 더해 기억해요`, cands.map(c => c.dir), null);
if (opt.answer){
  const dir = byName(opt.answer);
  if (!dir) failWith(`git 저장소가 아니에요: ${opt.answer}`);
  out(dir, (cands.find(c => c.dir === dir) || {}).base, '내가 고름', remember(dir));
}
if (cands.length === 1) out(cands[0].dir, cands[0].base, '규칙');
if (cands.length > 1) ask(`${key}는 어느 저장소에서 작업할까요?`, `${project}에 연결된 저장소가 ${cands.length}곳이에요. 다른 저장소에서도 하려면 시작한 뒤 [다른 저장소에서도 작업]을 눌러요`, cands.map(c => c.dir), cands[0].dir);

// 브랜치 이력 — 이 지라 프로젝트 키가 들어간 브랜치가 있는 저장소
const git = (d, ...a) => { try { return execFileSync('git', ['-C', d, ...a], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const hits = all.map(d => ({ d, n: git(d, 'for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes').split('\n').filter(b => b.includes(`${project}-`)).length })).filter(x => x.n).sort((a, b) => b.n - a.n);
if (hits.length === 1) out(hits[0].d, '', `브랜치 이력 ${hits[0].n}개`, remember(hits[0].d));
if (!all.length) failWith(`${repos} 바로 아래에 git 저장소가 없어요`);
// 근거(이 프로젝트 키의 브랜치)가 가장 많은 한 곳만 추천 — 근거가 없으면 아무것도 미리 고르지 않는다(답은 규칙으로 기억되니까)
ask(`${key}는 어느 저장소에서 작업할까요?`, hits.length ? `${project}- 브랜치가 있는 저장소가 ${hits.length}곳이에요` : `${project} 프로젝트는 처음 봐요. 고른 답은 저장소 규칙에 더해서 다음부터는 묻지 않아요`, hits.map(h => h.d), hits.length ? hits[0].d : null);
