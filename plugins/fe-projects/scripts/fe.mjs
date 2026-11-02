#!/usr/bin/env node
// FE 프로젝트 목록 — 맥락노트 묶음(<프로필>/01_지식/맥락노트/<묶음>/*.md)이 원본이다. 레포마다 노트 하나.
// 하루 한 번 팀원들의 GitHub PR을 모아 노트의 '활동' 줄을 고치고, 처음 보는 레포는 노트를 만든다. 결과는 JSON 한 줄.
//   node fe.mjs list    --group="FE 프로젝트" --members=$'hash-table\nzoe-seong' --api=https://github.example.com/api/v3
//                       [--days=183] [--dirs=$'~/code/*'] [--exclude=$'gitops/*'] [--refresh=yes] [--profile=<프로필 폴더>]
//   node fe.mjs refresh --repo=owner/name (나머지는 list와 같다) — [최신화] 버튼: 활동을 지금 다시 모으고 그 레포 노트를 맞춘다
//   node fe.mjs add     --input=<GitHub 주소|owner/name> --group= --api= --dirs= --exclude= — 직접 더하기: 노트를 만들고 빼 둘 레포에서 지운다
//   node fe.mjs remove  --repo=owner/name --group= --exclude= [--answer=yes] — 빼기: 묻고, 노트를 프로필 휴지통으로, 빼 둘 레포에 더한다
//   node fe.mjs add-item — '레포 더하기' 목록의 버튼 줄 하나
//   node fe.mjs get     --repo=owner/name --clone_dir=~/code --group= --api= — 받기: 로컬이 없으면 clone(노트의 로컬 줄을 채운다), 있으면 fetch + 깨끗하고 뒤처졌으면 fast-forward
// 클론은 clone_dir(노트 폴더 밖)에만 둔다 — 프로필은 GitHub로 동기화될 수 있어서 코드가 섞이면 안 된다
// 토큰은 환경 변수 GITHUB_TOKEN. 노트에서 이 스크립트가 고치는 줄은 '활동'·'로컬'뿐이고, 나머지는 사람과 AI가 고친다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const home = p => String(p || '').trim().replace(/^~(?=\/|$)/, os.homedir());
const tilde = p => p.startsWith(os.homedir() + path.sep) ? '~' + p.slice(os.homedir().length) : p;
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const isDir = d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
const lines = s => String(s || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const today = () => new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD, 이 컴퓨터 시간대
export const profileDir = p => p ? path.resolve(home(p)) : path.resolve(here, '..', '..', '..');   // <프로필>/_플러그인/fe-projects/scripts
export const groupDir = (profile, group) => path.join(profile, '01_지식', '맥락노트', String(group || 'FE 프로젝트').replace(/[\\/:*?"<>|]/g, ' ').trim());
export const cachePath = () => path.join(os.homedir(), '.pkm-app', 'fe-projects', 'activity.json');

// ---- 노트: 프런트매터 + "# 한 줄 요약" + "# 내용"의 "- 키: 값" 줄 ----
export const FIELDS = ['레포', '종류', '로컬', '스택', '실행', '배포', '브랜치', '지라', '활동', '확인'];

export function parseNote(text){
  const t = String(text || '').replace(/\r\n/g, '\n');
  const m = t.match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = {};
  if (m) for (const l of m[1].split('\n')){ const i = l.indexOf(':'); if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"(.*)"$/, '$1'); }
  const body = m ? t.slice(m[0].length) : t;
  const summary = ((body.match(/^# 한 줄 요약\n([\s\S]*?)(?=\n# |$)/m) || [])[1] || '').trim();
  const fields = {};
  for (const l of body.split('\n')){ const f = l.match(/^- ([^:\n]{1,8}): ?(.*)$/); if (f && FIELDS.includes(f[1]) && !(f[1] in fields)) fields[f[1]] = f[2].trim(); }
  return { fm, summary, fields };
}

// 줄 하나만 바꾼다(사람이 고친 나머지는 그대로). 없으면 내용의 마지막 "- 키:" 줄 뒤에 넣는다
export function setField(text, key, value){
  const re = new RegExp(`^- ${key}:.*$`, 'm'), line = `- ${key}: ${value}`;
  if (re.test(text)) return text.replace(re, () => line);
  const all = [...text.matchAll(new RegExp(`^- (?:${FIELDS.join('|')}):.*$`, 'gm'))];
  if (all.length){ const last = all.at(-1), at = last.index + last[0].length; return text.slice(0, at) + '\n' + line + text.slice(at); }
  return text.replace(/^# 내용\n/m, m => m + line + '\n');
}

const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
export function newNote({ repo, summary = '', fields = {}, sources = [] }){
  const d = today(), name = repo.split('/').pop();
  const f = { 레포: repo, 종류: '', 로컬: '', 스택: '', 실행: '', 배포: '', 브랜치: '', 지라: '', 활동: '', 확인: '', ...fields };
  return `---\ntype: context\nid: ${newId()}\ntopic: ${name}\ngroup: FE 프로젝트\ncreated: "${d}"\nupdated: "${d}"\nsources: [${sources.map(s => JSON.stringify(s)).join(', ')}]\n---\n\n# 한 줄 요약\n${summary}\n\n# 내용\n`
    + FIELDS.map(k => `- ${k}: ${f[k] || ''}`).join('\n')
    + '\n\n## 문서\n\n## 메모\n';
}
const touch = text => text.replace(/^updated: .*$/m, `updated: "${today()}"`);

export function readNotes(dir){
  let names = []; try { names = fs.readdirSync(dir).filter(n => n.endsWith('.md') && !n.startsWith('.')); } catch {}
  return names.sort((a, b) => a.localeCompare(b)).map(n => { const file = path.join(dir, n), text = fs.readFileSync(file, 'utf8'); return { file, text, ...parseNote(text) }; })
    .filter(n => n.fields.레포);
}

// ---- 로컬 클론: 폴더의 .git/config에서 origin 주소를 읽어 owner/name → 폴더 ----
export function repoOf(url){
  const m = String(url || '').trim().match(/^(?:[\w.-]+@[\w.-]+:|(?:https?|ssh|git):\/\/(?:[^@/]+@)?[\w.-]+(?::\d+)?\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : '';
}
export function clones(dirLines){
  const out = {};
  const look = d => {
    const cfg = (() => { try { return fs.readFileSync(path.join(d, '.git', 'config'), 'utf8'); } catch { return ''; } })();
    const sec = cfg.match(/\[remote "origin"\]([\s\S]*?)(?=\n\[|$)/), url = sec && (sec[1].match(/^\s*url\s*=\s*(.+)$/m) || [])[1];
    const r = repoOf(url); if (r && !out[r.toLowerCase()]) out[r.toLowerCase()] = d;
  };
  for (const l of lines(dirLines)){
    if (/\/\*$/.test(l)){
      const parent = path.resolve(home(l.slice(0, -2)));
      let subs = []; try { subs = fs.readdirSync(parent).filter(n => !n.startsWith('.')).sort(); } catch {}
      for (const n of subs) if (isDir(path.join(parent, n))) look(path.join(parent, n));
    } else look(path.resolve(home(l)));
  }
  return out;
}

// ---- GitHub: 팀원마다 기간 안에 만든 PR → 레포별 개수·사람·마지막 ----
export const webOf = api => { const u = String(api || '').replace(/\/+$/, ''); return u === 'https://api.github.com' ? 'https://github.com' : u.replace(/\/api\/v3$/, ''); };
// GitHub 로그인에는 점이 없다 — 사내 아이디(hash.table)를 적어도 하이픈(hash-table)으로 찾는다
export const handles = s => [...new Set(lines(s).map(l => l.replace(/^@/, '').replace(/\./g, '-')))];

export async function collect({ api, token, members, days = 183, fetchImpl = fetch }){
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10), repos = {};
  for (const who of members){
    for (let page = 1; page <= 10; page++){
      const q = encodeURIComponent(`is:pr author:${who} created:>=${since}`);
      const r = await fetchImpl(`${String(api).replace(/\/+$/, '')}/search/issues?q=${q}&per_page=100&page=${page}`, { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } });
      if (r.status === 401) throw new Error('GitHub 토큰이 맞지 않아요. 플러그인 설정에서 토큰을 다시 넣어 주세요');
      if (r.status === 422) break;   // 없는 아이디
      if (!r.ok) throw new Error(`GitHub에서 PR을 가져오지 못했어요(${r.status})`);
      const j = await r.json(), items = j.items || [];
      for (const it of items){
        const repo = String(it.repository_url || '').split('/repos/')[1]; if (!repo) continue;
        const x = repos[repo] ||= { n: 0, users: {}, last: '' };
        x.n++; x.users[who] = (x.users[who] || 0) + 1;
        const at = String(it.updated_at || it.created_at || '').slice(0, 10); if (at > x.last) x.last = at;
      }
      if (items.length < 100) break;
    }
  }
  return { at: new Date().toISOString(), since, members, repos };
}
export const activityLine = a => `PR ${a.n}건 · 마지막 ${a.last.slice(5)} · ${Object.entries(a.users).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([u, n]) => `${u.split('-')[0]} ${n}`).join(', ')}`;
const globRe = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$', 'i');

// 노트를 활동·로컬로 맞춘다. 바뀐 노트만 쓴다(동기화가 매일 흔들리지 않게)
export function sync({ dir, act, local, exclude = [] }){
  fs.mkdirSync(dir, { recursive: true });
  const notes = readNotes(dir), known = new Set(notes.map(n => n.fields.레포.toLowerCase())), skip = exclude.map(globRe);
  let made = 0, changed = 0;
  for (const n of notes){
    const a = act && act.repos[Object.keys(act.repos).find(r => r.toLowerCase() === n.fields.레포.toLowerCase())];
    let t = n.text;
    if (act) t = setField(t, '활동', a ? activityLine(a) : `최근 ${Math.round((Date.now() - Date.parse(act.since)) / 864e5 / 30)}개월 PR 없음`);
    const l = local[n.fields.레포.toLowerCase()];
    if (l && !n.fields.로컬) t = setField(t, '로컬', tilde(l));
    if (t !== n.text){ fs.writeFileSync(n.file, touch(t)); changed++; }
  }
  if (act) for (const [repo, a] of Object.entries(act.repos)){
    if (known.has(repo.toLowerCase()) || skip.some(r => r.test(repo))) continue;
    const name = repo.split('/').pop();
    let file = path.join(dir, `${name}.md`), k = 2; while (fs.existsSync(file)) file = path.join(dir, `${name} (${k++}).md`);
    fs.writeFileSync(file, newNote({ repo, fields: { 활동: activityLine(a), 로컬: local[repo.toLowerCase()] ? tilde(local[repo.toLowerCase()]) : '' } }));
    made++;
  }
  return { made, changed };
}

// 로컬 클론의 origin 호스트 — API 주소를 아직 안 적었어도 링크가 그 회사 GitHub로 가게
export function originHost(dir){
  let cfg = ''; try { cfg = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8'); } catch { return ''; }
  const sec = cfg.match(/\[remote "origin"\]([\s\S]*?)(?=\n\[|$)/), url = (sec && (sec[1].match(/^\s*url\s*=\s*(.+)$/m) || [])[1]) || '';
  return (url.match(/^[\w.-]+@([\w.-]+):/) || url.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([\w.-]+)/) || [])[1] || '';
}
// 노트 "실행" 줄의 "포트 8090"
export const portOf = s => { const p = Number((String(s || '').match(/포트\s*(\d{2,5})\b/) || [])[1]); return p > 0 && p < 65536 ? p : null; };

// 실행 줄 "`pnpm dev` · 설명 (관례)" → 명령
export const commandOf = s => (String(s || '').match(/`([^`]+)`/) || [])[1] || '';
const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const short = (s, n = 34) => clip(String(s || '').replace(/`/g, '').split(/ · | — /)[0], n);   // 첫 마디만

export function item(n, web){
  const f = n.fields, repo = f.레포, name = repo.split('/').pop(), local = f.로컬 ? path.resolve(home(f.로컬)) : '';
  const host = local && isDir(local) ? originHost(local) : '';
  if (host && (!web || web === 'https://github.com')) web = `https://${host}`;
  const todo = !f.실행 && !f.배포 && !f.브랜치;
  return {
    id: repo, title: name, url: web ? `${web}/${repo}` : '',
    meta: todo ? [f.활동 && clip(f.활동, 40), '실행·배포·브랜치 조사 전'].filter(Boolean)
      : [f.실행 && `실행 ${short(f.실행)}`, f.배포 && `배포 ${short(f.배포)}`, f.브랜치 && `브랜치 ${short(f.브랜치)}`, f.활동 && clip(f.활동, 40)].filter(Boolean),
    tags: [todo && '조사 전', f.종류 && f.종류 !== '서비스' && f.종류, local && !isDir(local) && '로컬 없음'].filter(Boolean),
    at: n.fm.updated || '',
    detail: n.summary ? [{ text: n.summary }] : [],
    // path·command·port는 띄우기(devserver.mjs)가, deploy는 배포(deploy.mjs)가 쓴다. 비우지 않는 값은 '-'(채우지 못한 자리로 멈추지 않게)
    vars: { repo, name, note: n.file, local: local && isDir(local) ? local : '', path: local && isDir(local) ? local : '-', command: commandOf(f.실행) || '-', port: portOf(f.실행) ? String(portOf(f.실행)) : '', deploy: f.배포 || '', web: web || '' }
  };
}

// 사람이 적은 레포: https://host/owner/name(/tree/…), git@host:owner/name.git, owner/name
export function parseRepo(input){
  const t = String(input || '').trim().replace(/[?#].*$/, '');
  const web = t.match(/^https?:\/\/[^/\s]+\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/);
  if (web) return `${web[1]}/${web[2]}`;
  return repoOf(t) || (/^[\w.-]+\/[\w.-]+$/.test(t) ? t.replace(/\.git$/, '') : '');
}
// 빼 둘 레포 줄 고치기 — 더할 땐 그 레포 줄을 지우고, 뺄 땐 (이미 걸리지 않으면) 한 줄 더한다
export function excludeWith(text, repo, on){
  const ls = String(text || '').split('\n').map(l => l.trim()).filter(Boolean), same = l => l.toLowerCase() === repo.toLowerCase();
  if (!on) return ls.filter(l => !same(l)).join('\n');
  return ls.some(l => !l.startsWith('#') && globRe(l).test(repo)) ? ls.join('\n') : [...ls, repo].join('\n');
}
export function trash(profile, file){
  let to = path.join(profile, '.trash', path.relative(profile, file));
  if (fs.existsSync(to)) to = to.replace(/\.md$/, ` ${Date.now()}.md`);
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(file, to);
  return to;
}

async function main(){
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
  const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
  const token = process.env.GITHUB_TOKEN;
  if (!['list', 'refresh', 'add', 'remove', 'add-item', 'get'].includes(cmd)) done({ error: '명령은 list, refresh, add, remove, add-item, get이에요' }, 1);
  if (cmd === 'add-item') done({ items: [{ id: 'add', title: 'GitHub 레포 직접 더하기', meta: ['주소나 owner/name을 적으면 노트를 만들고 AI가 실행·배포·브랜치를 채워요'], vars: {} }] });
  const profile = profileDir(opt.profile);

  if (cmd === 'remove'){
    const n = readNotes(groupDir(profile, opt.group)).find(n => n.fields.레포.toLowerCase() === String(opt.repo || '').toLowerCase());
    if (!n) done({ error: `${opt.repo || '(레포 없음)'} 노트를 찾지 못했어요` }, 1);
    if (opt.answer !== 'yes') done({ ask: { question: `${n.fields.레포}를 목록에서 뺄까요?`, hint: '노트는 프로필 휴지통(.trash)으로 옮기고, "빼 둘 레포"에 더해 다시 만들지 않아요. 다시 넣으려면 [레포 더하기]', choices: [{ value: 'yes', label: '빼기', recommended: true }], inline: true } });
    trash(profile, n.file);
    done({ removed: n.fields.레포, settings_patch: { exclude: excludeWith(opt.exclude, n.fields.레포, true) }, outcome: { title: '뺐어요', text: n.fields.레포 }, summary: `${n.fields.레포}를 뺐어요` });
  }

  if (cmd === 'get'){
    const n = readNotes(groupDir(profile, opt.group)).find(n => n.fields.레포.toLowerCase() === String(opt.repo || '').toLowerCase());
    if (!n) done({ error: `${opt.repo || '(레포 없음)'} 노트를 찾지 못했어요` }, 1);
    const git = (args, cwd, timeout = 600000) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
    const why = e => String((e.stderr || e.message || '')).trim().split('\n').slice(-3).join('\n');
    const local = n.fields.로컬 && path.resolve(home(n.fields.로컬));
    if (local && isDir(path.join(local, '.git'))){
      try { git(['fetch', '--prune', 'origin'], local); } catch (e) { done({ error: `fetch하지 못했어요(VPN·SSH 키 확인):\n${why(e)}` }, 1); }
      const branch = (() => { try { return git(['symbolic-ref', '--short', '-q', 'HEAD'], local); } catch { return ''; } })();
      let ahead = 0, behind = 0; try { [ahead, behind] = git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], local).split(/\s+/).map(Number); } catch {}
      const dirty = git(['status', '--porcelain'], local) !== '';
      if (branch && behind && !ahead && !dirty){
        try { git(['merge', '--ff-only', '@{u}'], local); } catch (e) { done({ error: `fast-forward하지 못했어요:\n${why(e)}` }, 1); }
        done({ path: local, summary: `${branch}를 최신으로(${behind}개 커밋 받음) · ${tilde(local)}` });
      }
      done({ path: local, summary: `받아 왔어요(fetch) · ${branch || 'HEAD 분리'}${behind ? ` · ${behind}개 뒤처짐` : ''}${ahead ? ` · 안 올린 커밋 ${ahead}개` : ''}${dirty ? ' · 고친 파일이 있어서 merge는 안 했어요' : ''}` });
    }
    // 처음 받기 — 노트 폴더(프로필) 안에는 두지 않는다
    const root = path.resolve(home(opt.clone_dir || '~/code'));
    if (!root || root === '/' || (root + path.sep).startsWith(profile + path.sep) || profile.startsWith(root + path.sep)) done({ error: `받을 폴더(${tilde(root)})가 노트 폴더와 겹쳐요. 플러그인 설정의 "받을 폴더"를 노트 밖으로 바꿔 주세요` }, 1);
    const web = webOf(opt.api);
    const host = web.replace(/^https?:\/\//, '');
    const name = n.fields.레포.split('/').pop();
    let dest = path.join(root, name), k = 2;
    while (fs.existsSync(dest) && fs.readdirSync(dest).length) dest = path.join(root, `${name}-${k++}`);
    fs.mkdirSync(root, { recursive: true });
    try { git(['clone', `git@${host}:${n.fields.레포}.git`, dest], root, 1800000); }
    catch (e) { try { fs.rmSync(dest, { recursive: true, force: true }); } catch {} done({ error: `clone하지 못했어요(VPN·SSH 키 확인):\n${why(e)}` }, 1); }
    fs.writeFileSync(n.file, touch(setField(fs.readFileSync(n.file, 'utf8'), '로컬', tilde(dest))));
    done({ path: dest, summary: `받았어요 · ${tilde(dest)}` });
  }

  if (cmd === 'add'){
    let repo = parseRepo(opt.input), summary = '';
    if (!repo) done({ error: `레포를 알아보지 못했어요: "${String(opt.input || '').slice(0, 80)}". https://github…/owner/name 이나 owner/name으로 적어 주세요` }, 1);
    // 토큰이 있으면 정말 있는 레포인지 보고, 대소문자·설명을 GitHub 것으로
    if (token && opt.api){
      try {
        const r = await fetch(`${String(opt.api).replace(/\/+$/, '')}/repos/${repo}`, { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } });
        if (r.status === 404) done({ error: `${repo} 레포가 없거나 이 토큰으로 볼 수 없어요` }, 1);
        if (r.ok){ const j = await r.json(); repo = j.full_name || repo; summary = String(j.description || '').trim(); }
      } catch {}
    }
    const dir = groupDir(profile, opt.group), patch = { exclude: excludeWith(opt.exclude, repo, false) };
    fs.mkdirSync(dir, { recursive: true });
    const had = readNotes(dir).find(n => n.fields.레포.toLowerCase() === repo.toLowerCase());
    const local = clones(opt.dirs)[repo.toLowerCase()] || '';
    if (had) done({ note: had.file, repo: had.fields.레포, local: had.fields.로컬 ? path.resolve(home(had.fields.로컬)) : '', settings_patch: patch, summary: `${had.fields.레포}는 이미 있어요. 노트를 최신화해요` });
    const act = readJSON(cachePath()), a = act && act.repos && act.repos[Object.keys(act.repos).find(r => r.toLowerCase() === repo.toLowerCase())];
    const name = repo.split('/').pop();
    let file = path.join(dir, `${name}.md`), k = 2; while (fs.existsSync(file)) file = path.join(dir, `${name} (${k++}).md`);
    fs.writeFileSync(file, newNote({ repo, summary, fields: { 로컬: local ? tilde(local) : '', 활동: a ? activityLine(a) : '' } }));
    done({ note: file, repo, local, settings_patch: patch, summary: `${repo} 노트를 만들었어요${local ? ` · 로컬 ${tilde(local)}` : ''}` });
  }

  if (cmd === 'refresh') opt.refresh = 'yes';
  const dir = groupDir(profileDir(opt.profile), opt.group), members = handles(opt.members), notes = [];
  const days = Math.min(Math.max(Number(opt.days) || 183, 7), 730);

  // 활동은 하루 한 번만 새로 모은다(피드는 더 자주 돌아도 GitHub는 덜 친다). 팀원·기간이 바뀌면 바로
  let act = readJSON(cachePath());
  const stale = !act || Date.now() - Date.parse(act.at) > 20 * 3600e3 || String(act.members) !== String(members) || act.days !== days || opt.refresh === 'yes';
  if (stale && token && members.length && opt.api){
    try { act = { ...(await collect({ api: opt.api, token, members, days })), days }; fs.mkdirSync(path.dirname(cachePath()), { recursive: true }); fs.writeFileSync(cachePath(), JSON.stringify(act) + '\n'); }
    catch (e) { notes.push(`활동을 새로 모으지 못했어요: ${e.cause && e.cause.code ? '서버에 닿지 않아요(VPN 확인)' : e.message}`); }
  } else if (stale && members.length && !token) notes.push('GitHub 토큰이 없어서 활동은 지난 값 그대로예요');
  if (act && String(act.members) !== String(members)) act = null;   // 다른 팀원으로 모은 옛 값은 쓰지 않는다

  const r = sync({ dir, act, local: clones(opt.dirs), exclude: lines(opt.exclude) });
  if (r.made) notes.push(`새 레포 ${r.made}개의 노트를 만들었어요. [최신화]로 실행·배포·브랜치를 채워 주세요`);
  // 최신화는 활동을 못 모아도 멈추지 않는다 — 다음 단계(AI가 문서 찾기)는 그대로 한다
  if (cmd === 'refresh'){
    const n = readNotes(dir).find(n => n.fields.레포.toLowerCase() === String(opt.repo || '').toLowerCase());
    if (!n) done({ error: `${opt.repo || '(레포 없음)'} 노트를 찾지 못했어요` }, 1);
    done({ note: n.file, repo: n.fields.레포, local: n.fields.로컬 && isDir(path.resolve(home(n.fields.로컬))) ? path.resolve(home(n.fields.로컬)) : '', activity: n.fields.활동, summary: notes.length ? notes.join(' · ') : `활동 ${n.fields.활동 || '없음'}` });
  }
  const items = readNotes(dir).map(n => item(n, webOf(opt.api)));
  if (!items.length && !members.length) notes.push('플러그인 설정의 "팀원"에 GitHub 아이디를 적으면 레포를 모아 와요');
  done({ items, ...(notes.length ? { note: notes.join(' · ') } : {}) });
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main();
