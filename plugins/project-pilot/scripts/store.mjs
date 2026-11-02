// 프로젝트 파일럿 저장소 — pkm 프로필(카드·장기·루틴·맥락노트)과 AI 작업 폴더를 읽고 쓴다.
// 프로젝트 기록: <프로필>/_플러그인/.data/project-pilot/<pid>.json (프로필과 함께 동기화, 앱 화면에는 안 보임)
// AI 작업 폴더: <작업 폴더>/<날짜-이름>/ — 에이전트가 초안·도구를 만드는 곳. 그 안 .pilot/ 에 맥락(brief.md)·조사(research.md)·루프 결과(out/*.json)
// 프로필 파일은 새로 만들거나, 파일럿이 만든 것에 줄을 더하기만 한다. 사용자가 고친 카드 내용을 덮어쓰지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_FOLDERS = { project: '03_행동/단기보드', area: '03_행동/장기보드', routine: '03_행동/루틴보드', context: '01_지식/맥락노트' };
export const GROUP = '프로젝트 파일럿';   // 맥락노트 묶음(하위 폴더)
const here = path.dirname(fileURLToPath(import.meta.url));
export const pluginDir = path.resolve(here, '..');
export const profileDir = p => p ? path.resolve(p) : path.resolve(here, '..', '..', '..');   // <프로필>/_플러그인/project-pilot/scripts
export const expand = p => String(p || '').replace(/^~(?=$|\/)/, os.homedir());

const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
// 임시 파일은 '.'으로 시작 — 중간에 죽어도 앱·동기화가 노트로 보지 않는다
export function writeAtomic(f, t){
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = path.join(path.dirname(f), `.${path.basename(f)}.${process.pid}.tmp`);
  try { fs.writeFileSync(tmp, t); fs.renameSync(tmp, f); } finally { fs.rmSync(tmp, { force: true }); }
}
// 노트 칸 안에 넣는 여러 줄 글 — 줄 머리 '# '는 칸 제목이 되어 앱이 다시 저장할 때 버려진다. 한 단계 낮춘다
export const safeBody = t => String(t ?? '').replace(/^# /gm, '## ');
export const hash = t => crypto.createHash('sha1').update(String(t ?? '')).digest('hex').slice(0, 12);
const mdFiles = dir => { try { return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => path.join(dir, f)); } catch { return []; } };
export const rid = (pre, n = 7) => pre + crypto.randomBytes(8).toString('hex').replace(/[^a-z0-9]/g, '').slice(0, n);

/* ---------- 프런트매터: 앱(pkm-md.js)과 같은 규칙으로 쓰고, 필요한 만큼만 읽는다 ---------- */
const needsQuote = s => s === '' || /^[\s]|[\s]$|^[-?:,\[\]{}#&*!|>'"%@`]|: | #|^(true|false|null|yes|no|on|off|~)$|^[+-]?\d/i.test(s) || /[\n\r]/.test(s);
const yScalar = v => v === null || v === undefined ? '' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : needsQuote(String(v)) ? JSON.stringify(String(v)) : String(v);
const yLine = (k, v) => Array.isArray(v) ? `${k}: [${v.map(x => JSON.stringify(String(x))).join(', ')}]` : (s => s === '' ? `${k}:` : `${k}: ${s}`)(yScalar(v));
export const writeDoc = (fm, sections) => `---\n${Object.entries(fm).filter(([, v]) => v !== undefined).map(([k, v]) => yLine(k, v)).join('\n')}\n---\n\n${sections.map(([t, v]) => `# ${t}\n${v ? safeBody(v).trim() + '\n' : ''}`).join('\n')}`;
const unquote = v => { v = String(v ?? '').trim(); if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } } return /^'.*'$/.test(v) ? v.slice(1, -1) : v; };
const fmBlock = t => (String(t || '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/) || [, ''])[1];
export const fmValue = (t, key) => { const m = fmBlock(t).match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm')); return m ? unquote(m[1].replace(/\s+#\s.*$/, '')) : ''; };
// "# 제목" 칸의 본문
export const section = (t, name) => { const body = String(t || '').replace(/^---[\s\S]*?\n---[ \t]*\r?\n/, ''); const m = body.match(new RegExp(`^# ${name}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^# |(?![\\s\\S]))`, 'm')); return m ? m[1].trim() : ''; };
// 칸 경계(줄 번호) — [제목 줄, 다음 칸 제목 줄). 코드 블록 안의 '# '는 칸 제목이 아니다
function bounds(L, name){
  let fence = false, i = -1;
  for (let k = 0; k < L.length; k++){
    if (/^\s*(```|~~~)/.test(L[k])) fence = !fence;
    if (fence || !/^# /.test(L[k])) continue;
    if (i >= 0) return [i, k];
    if (L[k].trim() === `# ${name}`) i = k;
  }
  return i >= 0 ? [i, L.length] : null;
}
// 칸 끝에 줄을 더한다(칸이 없으면 만든다)
export function appendToSection(t, name, lines){
  const L = String(t).split('\n'), b = bounds(L, name);
  if (!b) return `${String(t).trimEnd()}\n\n# ${name}\n${lines.join('\n')}\n`;
  let k = b[1] - 1; while (k > b[0] && !L[k].trim()) k--;
  L.splice(k + 1, 0, ...lines);
  return L.join('\n');
}
// 칸 본문을 통째로 바꾼다
export function replaceSection(t, name, body){
  const L = String(t).split('\n'), b = bounds(L, name);
  if (!b) return `${String(t).trimEnd()}\n\n# ${name}\n${body}\n`;
  L.splice(b[0] + 1, b[1] - b[0] - 1, ...String(body).split('\n'), ...(b[1] < L.length ? [''] : []));
  return L.join('\n');
}
export const clean = s => String(s || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '제목 없음';

/* ---------- 프로필 ---------- */
export function folders(profile){
  const block = fmBlock(read(path.join(profile, '_설정.md')));
  const f = { ...DEFAULT_FOLDERS };
  for (const k of Object.keys(f)){ const m = block.match(new RegExp(`^ {2}${k}:\\s*(.+)$`, 'm')); if (m) f[k] = unquote(m[1]); }
  const offText = (block.match(/^offdays:[\s\S]*?(?=^\S|(?![\s\S]))/m) || [''])[0];
  const offdays = [...offText.matchAll(/date:\s*"?(\d{4}-\d{2}-\d{2})/g)].map(m => m[1]);
  return { ...f, offdays };
}
// 같은 이름 파일이 있으면 " (2)"를 붙인다
function freePath(dir, name){
  let p = path.join(dir, `${clean(name)}.md`), n = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${clean(name)} (${n++}).md`);
  return p;
}
const rel = (profile, f) => path.relative(profile, f).split(path.sep).join('/');

export function createCard(profile, F, { title, status = 'todo', area, todos = [], done = [], memo = '', created }){
  const id = rid('t'), f = freePath(path.join(profile, F.project), title);
  writeAtomic(f, writeDoc({ type: 'project', id, title, status, area: area ? `[[${clean(area)}]]` : null, due: null, estimate: null, created: created || null },
    [['할 일', todos.join('\n')], ['완료 조건', done.map(x => `- ${x}`).join('\n')], ['메모', memo]]));
  return { id, title, path: rel(profile, f) };
}
const UNIT = { 시간: 'hours', 권: 'books', 회: 'times', 기록만: 'entries' };   // 앱이 영어 키로 저장하는 단위
export function createArea(profile, F, { title, metric, unit, why }){
  const f = freePath(path.join(profile, F.area), title), name = path.basename(f, '.md'), id = rid('L', 6);
  writeAtomic(f, writeDoc({ type: 'area', id, title: name, metric, unit: UNIT[unit] || unit }, [['왜 관리하나', why], ['누적 기록', '| 날짜 | 양 | 메모 | 출처 |\n|---|---|---|---|'], ['회고', '']]));
  return { id, title: name, path: rel(profile, f) };
}
// 프런트매터 id로 파일 찾기 — 앱·Obsidian에서 이름을 바꿔도 따라간다. ref.path를 고쳐 둔다
export function findById(profile, dir, ref){
  if (!ref) return null;
  const p = ref.path && path.join(profile, ref.path);
  if (p && (!ref.id || fmValue(read(p), 'id') === ref.id) && fs.existsSync(p)) return p;
  if (!ref.id) return null;
  const walk = d => { for (const e of (() => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } })()){
    if (e.name.startsWith('.')) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()){ const r = walk(f); if (r) return r; }
    else if (e.name.endsWith('.md') && fmValue(read(f), 'id') === ref.id) return f;
  } return null; };
  const f = walk(path.join(profile, dir));
  if (f){ ref.path = rel(profile, f); ref.title = path.basename(f, '.md'); }
  return f;
}
export function createRoutine(profile, F, { title, cron, duration, area, content }){
  const f = freePath(path.join(profile, F.routine), title);
  writeAtomic(f, writeDoc({ type: 'routine', id: rid('R', 6), title: path.basename(f, '.md'), enabled: true, cron, duration, block: null, area: area ? `[[${clean(area)}]]` : null, amount: null }, [['루틴 내용', content]]));
  return { title: path.basename(f, '.md'), path: rel(profile, f) };
}
// 맥락노트 — 파일럿이 쓰는 노트(설계·운영 일지). 있으면 '내용'만 바꾸고 '바뀐 기록'에 한 줄 더한다
// ref: { id, path, hash } — hash는 파일럿이 마지막으로 쓴 '내용'. 사람이 고쳤으면(hash가 다르면) 내용을 덮지 않고 kept: true
export function upsertContext(profile, F, { ref, title, summary, body, what, why = '', today }){
  const found = ref && findById(profile, F.context, ref);
  const f = found || freePath(path.join(profile, F.context, GROUP), title);
  const old = found ? read(f) : null;
  const kept = !!(old && ref.hash && hash(section(old, '내용')) !== ref.hash);
  if (kept) body = section(old, '내용');
  const hist = old ? section(old, '바뀐 기록') : '| 날짜 | 무엇이 바뀌었나 | 왜 |\n|---|---|---|';
  const id = (old && fmValue(old, 'id')) || rid('c', 6), created = (old && fmValue(old, 'created')) || today;
  const name = path.basename(f, '.md');
  writeAtomic(f, writeDoc({ type: 'context', id, topic: (old && fmValue(old, 'topic')) || name, group: GROUP, created, updated: today, sources: [] },
    [['한 줄 요약', summary], ['내용', body], ['바뀐 기록', `${hist}${what ? `\n| ${today} | ${cellText(what)}${kept ? ' (직접 고친 내용이 있어 내용은 그대로 둠)' : ''} | ${cellText(why)} |` : ''}`]]));
  return { id, path: rel(profile, f), title: name, hash: hash(section(read(f), '내용')), kept };
}
const cellText = s => String(s || '').replace(/\|/g, '/').replace(/\n/g, ' ');
export function appendContextBody(profile, F, ref, lines, today){
  const f = findById(profile, F.context, ref), t = f && read(f); if (!t) return false;
  const next = appendToSection(t, '내용', safeBody(lines.join('\n')).split('\n')).replace(/^updated:.*$/m, `updated: ${yScalar(today)}`);
  writeAtomic(f, next); ref.hash = hash(section(next, '내용'));
  return true;
}

// 카드 찾기 — 기록한 경로가 바뀌었으면(Obsidian에서 이름 바꾸기 등) id로 다시 찾는다
export function findCard(profile, F, card){
  const p = card.path && path.join(profile, card.path);
  if (p && fmValue(read(p), 'id') === card.id) return p;
  for (const f of mdFiles(path.join(profile, F.project))) if (fmValue(read(f), 'id') === card.id){ card.path = rel(profile, f); return f; }
  return null;
}
export function readCard(profile, F, card){
  const f = findCard(profile, F, card), t = f && read(f);
  if (!t) return null;
  const todos = section(t, '할 일').split('\n').map(l => l.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/)).filter(Boolean).map(m => ({ text: m[2].trim(), done: m[1] !== ' ' }));
  return { id: card.id, title: fmValue(t, 'title') || card.title, status: fmValue(t, 'status') || 'todo', todos, memo: section(t, '메모') };
}
export function addTodos(profile, F, card, lines){
  const f = findCard(profile, F, card); if (!f) return false;
  writeAtomic(f, appendToSection(read(f), '할 일', lines)); return true;
}
// 할 일 체크 — '할 일' 칸 안의 mark(🤖 AI 몫 · 🙋 내 몫) 줄 중 글이 정확히 같은 첫 줄만. AI는 🙋을 체크하지 못한다
export function checkTodo(profile, F, card, text, mark = '🤖'){
  const key = String(text || '').replace(/^\s*(🤖|🙋)\s*/u, '').replace(/\s+/g, ' ').trim();
  if (key.length < 2) return false;
  const f = findCard(profile, F, card); if (!f) return false;
  const L = read(f).split('\n'), b = bounds(L, '할 일'); if (!b) return false;
  for (let k = b[0] + 1; k < b[1]; k++){
    const m = L[k].match(new RegExp(`^(\\s*-\\s+)\\[ \\](\\s+)${mark}\\s*(.*)$`, 'u'));
    if (m && m[3].replace(/\s+/g, ' ').trim() === key){ L[k] = `${m[1]}[x]${m[2]}${mark} ${m[3].trim()}`; writeAtomic(f, L.join('\n')); return true; }
  }
  return false;
}
// 🙋 줄을 끝난 것으로 두고 뒤에 메모를 붙인다(다르게 할래요로 넘긴 할 일 — 목록에서 내리되 이유를 남긴다)
export function markTodo(profile, F, card, text, note){
  const f = findCard(profile, F, card); if (!f) return false;
  const L = read(f).split('\n'), b = bounds(L, '할 일'); if (!b) return false;
  for (let k = b[0] + 1; k < b[1]; k++){
    const m = L[k].match(/^(\s*-\s+)\[ \](\s+)🙋\s*(.*)$/u);
    if (m && m[3].replace(/\s*\(\d+분\)$/, '').trim() === String(text).trim()){ L[k] = `${m[1]}[x]${m[2]}🙋 ${m[3].trim()} (${String(note).replace(/[\r\n]+/g, ' ').slice(0, 200)})`; writeAtomic(f, L.join('\n')); return true; }
  }
  return false;
}
// 아직 안 한 🙋(내 몫) 할 일 — [{ text, minutes }]
export function openMine(profile, F, card){
  const f = findCard(profile, F, card), t = f && read(f); if (!t) return [];
  return section(t, '할 일').split('\n').map(l => l.match(/^\s*-\s+\[ \]\s+🙋\s*(.*)$/u)).filter(Boolean)
    .map(m => { const x = m[1].trim(), mm = x.match(/\s*\((\d+)분\)$/); return { line: x, text: mm ? x.slice(0, mm.index) : x, minutes: mm ? Number(mm[1]) : 0 }; });
}
export function appendMemo(profile, F, card, line){
  const f = findCard(profile, F, card); if (!f) return false;
  writeAtomic(f, appendToSection(read(f), '메모', [line])); return true;
}

/* 장기 누적 기록 — | 날짜 | 양 | 메모 | 출처 | 표에 한 줄 */
const AREA_HEAD = '| 날짜 | 양 | 메모 | 출처 |\n|---|---|---|---|';
export function areaRecords(profile, F, ref){
  const f = findById(profile, F.area, ref), t = f && read(f); if (!t) return [];
  return section(t, '누적 기록').split('\n').map(l => l.split('|').map(c => c.trim())).filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c[1] || '')).map(c => ({ date: c[1], amt: Number(c[2]) || 0, memo: c[3] || '', src: c[4] || '' }));
}
export function addAreaRecord(profile, F, ref, { date, amt, memo, src = '프로젝트 파일럿' }){
  const f = findById(profile, F.area, ref), t = f && read(f); if (!t) return false;
  const row = `| ${date} | ${amt} | ${String(memo || '').replace(/\|/g, '/')} | ${src} |`;
  const rows = section(t, '누적 기록').split('\n').filter(l => /^\|\s*\d{4}-\d{2}-\d{2}/.test(l));
  const table = [AREA_HEAD, ...rows, row].join('\n');
  writeAtomic(f, replaceSection(t, '누적 기록', table));
  return true;
}

// 설계해 달라고 표시한 단기 카드 — 메모나 할 일에 #설계. 이미 파일럿이 맡은 카드는 뺀다
export function flaggedCards(profile, F, taken = new Set()){
  const out = [];
  for (const f of mdFiles(path.join(profile, F.project))){
    const t = read(f); if (!t || fmValue(t, 'type') !== 'project') continue;
    const id = fmValue(t, 'id'), status = fmValue(t, 'status');
    if (!id || taken.has(id) || status === 'done' || fmValue(t, 'archived')) continue;
    const body = `${section(t, '메모')}\n${section(t, '할 일')}\n${section(t, '완료 조건')}`;
    if (!/(^|\s)#설계(?![\p{L}\p{N}_])/u.test(body)) continue;
    out.push({ id, title: fmValue(t, 'title') || path.basename(f, '.md'), path: rel(profile, f), text: body.replace(/(^|\s)#설계/gu, '$1').trim() });
  }
  return out;
}

/* ---------- 프로젝트 기록 ---------- */
export const dataDir = profile => path.join(profile, '_플러그인', '.data', 'project-pilot');
export function listProjects(profile){
  try { return fs.readdirSync(dataDir(profile)).filter(f => /^p[\w-]+\.json$/.test(f)).map(f => loadProject(profile, f.slice(0, -5))).filter(Boolean).sort((a, b) => String(a.created).localeCompare(String(b.created))); }
  catch { return []; }
}
export function loadProject(profile, pid){
  if (!/^p[\w-]{2,40}$/.test(String(pid))) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dataDir(profile), `${pid}.json`), 'utf8')); } catch { return null; }
}
export function saveProject(profile, pr){
  pr.updated = new Date().toISOString();
  writeAtomic(path.join(dataDir(profile), `${pr.id}.json`), JSON.stringify(pr, null, 1) + '\n');
}
export function logTo(pr, kind, text){ (pr.log ||= []).push({ at: new Date().toISOString(), kind, text: String(text).slice(0, 400) }); pr.log = pr.log.slice(-200); }

/* ---------- AI 작업 폴더 ---------- */
export function workDir(pr, root){
  const base = expand(root || '~/pkm-projects');
  // 동기화된 기록의 경로는 이 컴퓨터의 작업 폴더 안일 때만 쓴다(다른 기기에서 고친 경로로 에이전트를 움직이지 못하게)
  const inside = pr.work && path.resolve(pr.work).startsWith(path.resolve(base) + path.sep);
  const dir = inside && fs.existsSync(pr.work) ? pr.work : path.join(base, path.basename(String(pr.work_name || pr.id)));
  fs.mkdirSync(path.join(dir, '.pilot', 'out'), { recursive: true });
  return dir;
}
// 에이전트 경계 — 작업 폴더의 Claude Code 설정. 노트 폴더 쓰기와 외부로 내보내는 명령을 막는다
export function guardWork(dir, profile){
  const deny = [`Edit(/${profile}/**)`, `Write(/${profile}/**)`, 'Bash(git push:*)', 'Bash(gh:*)', 'Bash(curl -X POST:*)', 'Bash(curl --data:*)', 'Bash(curl -d:*)', 'Bash(npm publish:*)', 'Bash(ssh:*)', 'Bash(scp:*)'];
  const f = path.join(dir, '.claude', 'settings.json');
  let cur = {}; try { cur = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  const have = new Set(((cur.permissions || {}).deny) || []);
  if (deny.every(d => have.has(d))) return;
  writeAtomic(f, JSON.stringify({ ...cur, permissions: { ...(cur.permissions || {}), deny: [...have, ...deny.filter(d => !have.has(d))] } }, null, 1) + '\n');
}
export const pilotFile = (dir, name) => path.join(dir, '.pilot', name);
export const readText = read;
