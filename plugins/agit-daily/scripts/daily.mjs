#!/usr/bin/env node
// 아지트 데일리 — 이 프로필의 데일리노트(오늘 계획)·약속·단기보드·쉬는 날로 아지트에 붙여 넣을 데일리 글을 만든다. 결과는 JSON 한 줄.
//   node daily.mjs today [--tag=hash] [--jira=https://…/browse/] [--agit=https://…] [--profile=폴더] [--date=YYYY-MM-DD]
//   node daily.mjs draft --date=YYYY-MM-DD [--answer=doing|plain|done|done+doing] …
// 한 일 = 직전 근무일(주말·쉬는 날, 기록이 빈 날은 건너뜀)의 약속과 계획, 할 일 = 오늘 약속과 계획(+ 고르면 진행 중 카드).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const WD = '일월화수목금토';
const DEFAULT_FOLDERS = { daily:'02_시간/데일리', project:'03_행동/단기보드', appointment:'03_행동/약속보드' };
const two = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const dayOf = s => new Date(`${s}T00:00:00`);
const md = s => { const d = dayOf(s); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const mdFiles = dir => { try { return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => path.join(dir, f)); } catch { return []; } };

/* ---------- 마크다운 읽기: 이 스크립트에 필요한 만큼만 ---------- */
const unquote = v => { v = String(v ?? '').trim(); if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } } return /^'.*'$/.test(v) ? v.slice(1, -1) : v; };
const fmBlock = text => (String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/) || [, ''])[1];
const fmValue = (block, key) => { const m = block.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm')); return m ? unquote(m[1]) : ''; };
// key: 아래 들여 쓴 줄들
const fmNested = (block, key) => { const lines = block.split(/\r?\n/), i = lines.findIndex(l => l.startsWith(`${key}:`)), out = []; if (i < 0) return out; for (let j = i + 1; j < lines.length && (/^\s/.test(lines[j]) || !lines[j].trim()); j++) out.push(lines[j]); return out; };

export function readSettings(profile){
  const block = fmBlock(read(path.join(profile, '_설정.md')));
  const folders = { ...DEFAULT_FOLDERS };
  for (const l of fmNested(block, 'folders')) { const m = l.match(/^ {2}(daily|project|appointment):\s*(.+)$/); if (m) folders[m[1]] = unquote(m[2]); }
  // offdays: - { date: "2026-11-03", label: 휴가 } — 한 줄 값([…])도 같은 모양으로 본다
  const offText = [fmValue(block, 'offdays'), ...fmNested(block, 'offdays')].join('\n');
  const offdays = [...offText.matchAll(/date:\s*"?(\d{4}-\d{2}-\d{2})"?(?:\s*,\s*label:\s*("[^"]*"|[^,}\n]*))?/g)].map(m => ({ date:m[1], label:unquote(m[2] || '') }));
  return { folders, offdays };
}

// 데일리노트의 '# 오늘 계획' — ## 시각 아래 - [ ] [[제목]] · 30분
export function planOf(profile, folders, date){
  const text = read(path.join(profile, folders.daily, `${date}.md`)) || '';
  const body = text.replace(/^---[\s\S]*?\n---[ \t]*\r?\n/, '');
  const sec = (body.match(/^# 오늘 계획[ \t]*\r?\n([\s\S]*?)(?=^# |(?![\s\S]))/m) || [, ''])[1];
  return sec.split(/\r?\n/).map(l => l.match(/^\s*-\s+\[( |x|X)\]\s+(.+?)\s*$/)).filter(Boolean)
    .map(m => ({ title:m[2].replace(/\s*·\s*\d+분$/, '').replace(/^\[\[(.+?)(?:\|.*)?\]\]$/, '$1').trim(), done:m[1] !== ' ' })).filter(x => x.title);
}

// 약속보드 — start: "2026-10-29T13:30"(종일은 날짜만)
export function apptsOf(profile, folders, date){
  return mdFiles(path.join(profile, folders.appointment)).map(f => fmBlock(read(f))).map(b => ({ title:fmValue(b, 'title'), start:fmValue(b, 'start') }))
    .filter(a => a.title && a.start.slice(0, 10) === date).sort((a, b) => a.start.localeCompare(b.start))
    .map(a => ({ title:a.title, time:a.start.slice(11, 16) }));
}

export function cardsOf(profile, folders){
  return mdFiles(path.join(profile, folders.project)).map(f => fmBlock(read(f))).map(b => ({ title:fmValue(b, 'title'), status:fmValue(b, 'status') })).filter(c => c.title);
}

/* ---------- 데일리 글 ---------- */
const KEY = /\b[A-Z][A-Z0-9]+-\d+\b/;
// 지라 키가 있으면 [키](주소) 나머지 — ww 데일리와 같은 모양
export const jiraMd = (title, jira) => { const k = (title.match(KEY) || [])[0]; return k && jira ? `[${k}](${jira}${k}) ${title.replace(k, '').trim()}`.trim() : title; };
const isOff = (s, offs) => { const d = dayOf(s).getDay(); return d === 0 || d === 6 || offs.has(s); };
const uniq = list => { const seen = new Set(); return list.filter(x => { const k = x.trim(); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };

export function collect(profile, date){
  const { folders, offdays } = readSettings(profile), offs = new Set(offdays.map(o => o.date));
  const dayItems = d => [...apptsOf(profile, folders, d).map(a => a.time ? `${a.title} (${a.time})` : a.title), ...planOf(profile, folders, d).map(p => p.title)];
  // 직전 근무일 — 주말·쉬는 날을 건너뛰고, 쉬는 날로 안 적힌 공휴일처럼 기록이 빈 날은 기록이 있는 날까지 더 거슬러 간다(최대 6번)
  const prevWork = s => { const d = dayOf(s); for (let i = 0; i < 14; i++){ d.setDate(d.getDate() - 1); if (!isOff(ymd(d), offs)) return ymd(d); } return ymd(d); };
  let prev = prevWork(date), done = dayItems(prev);
  for (let i = 0, c = prev; i < 6 && !done.length; i++){ c = prevWork(c); const x = dayItems(c); if (x.length){ prev = c; done = x; } }
  const todo = uniq(dayItems(date)), cards = cardsOf(profile, folders);
  return {
    date, prev, off:isOff(date, offs), done:uniq(done), todo,
    doing:cards.filter(c => c.status === 'doing' && !todo.includes(c.title)).map(c => c.title),   // 오늘 계획에 없는 진행 중 카드만
    soon:offdays.filter(o => o.date >= date).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2),
    cards
  };
}

export function render(c, { tag = 'hash', jira = '', withDoing = false } = {}){
  const card = t => c.cards.some(x => x.title === t) || KEY.test(t) ? jiraMd(t, jira) : t;
  const done = c.done.map(card), todo = uniq([...c.todo, ...(withDoing ? c.doing : [])]).map(card);
  const d = dayOf(c.date), ym = `${d.getFullYear()}${two(d.getMonth() + 1)}`;
  const week = Math.ceil((d.getDate() + (new Date(d.getFullYear(), d.getMonth(), 1).getDay() + 6) % 7) / 7);   // 월요일 시작, 1일이 든 주가 1주차
  const tags = tag ? [`[#${tag}${ym}](https://kakao.agit.in/search?q=%23${tag}${ym})`, `[#${tag}${ym}${two(week)}](https://kakao.agit.in/search?q=%23${tag}${ym}${two(week)})`].join(' ') : '';
  return [
    '**한 일**', ...(done.length ? done.map(t => `- [x] ${t}`) : ['- [x] ']), '',
    '**할 일**', ...(todo.length ? todo.map(t => `- [ ] ${t}`) : ['- [ ] ']), '',
    '**이슈**', `- ${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일입니다.`,
    ...c.soon.map(o => `- ${md(o.date)} ${String(o.label || '').split('(')[0].trim()}`.trimEnd()),   // 괄호 안 메모는 뺀다
    ...(tags ? ['', tags] : [])
  ].join('\n');
}

/* ---------- 명령 ---------- */
const args = Object.fromEntries(process.argv.slice(3).map(a => a.match(/^--([^=]+)=([\s\S]*)$/)).filter(Boolean).map(m => [m[1], m[2]]));
const here = path.dirname(fileURLToPath(import.meta.url));
export const profileDir = p => p ? path.resolve(p) : path.resolve(here, '..', '..', '..');   // <프로필>/_플러그인/agit-daily/scripts

function main(){
  const cmd = process.argv[2], profile = profileDir(args.profile);
  if (!fs.existsSync(path.join(profile, '_설정.md'))) return { error:`프로필 폴더를 찾지 못했어요: ${profile}` };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(args.date || '') ? args.date : ymd(new Date());
  const opts = { tag:args.tag ?? 'hash', jira:args.jira ?? '', agit:/^https?:\/\//.test(args.agit || '') ? args.agit : '' };
  const c = collect(profile, date);
  if (cmd === 'today'){
    if (c.off) return { items:[], note:`${md(date)}은 쉬는 날이에요` };
    const text = render(c, opts);
    return { items:[{ id:date, title:`${md(date)} 데일리`, url:opts.agit, at:`${date}T00:00:00`,
      meta:[`한 일 ${md(c.prev)} ${c.done.length}건`, `할 일 ${c.todo.length}건`, ...(c.doing.length ? [`진행 중 카드 ${c.doing.length}개`] : [])],
      version:crypto.createHash('sha1').update(text + c.doing.join('\n')).digest('hex').slice(0, 12), vars:{ date } }] };
  }
  if (cmd === 'draft'){
    const ans = String(args.answer || ''), withDoing = /doing$/.test(ans), text = render(c, { ...opts, withDoing });
    const out = {
      summary:`한 일 ${c.done.length} · 할 일 ${c.todo.length + (withDoing ? c.doing.length : 0)}`,
      verdict:{ tone:'ok', title:`${md(date)} 데일리`, text:`한 일은 ${md(c.prev)} 약속과 계획, 할 일은 오늘 약속과 계획${withDoing ? '과 진행 중 카드' : ''}이에요. 붙여 넣은 뒤 아지트에서 고쳐도 돼요.` },
      findings:[{ title:'아지트에 붙여 넣을 글', copy:text, ...(opts.agit ? { where:'아지트 열기', url:opts.agit } : {}) }]
    };
    if (ans.startsWith('done')) return { ...out, outcome:{ title:'다 썼어요', text:'' } };
    const toggle = c.doing.length ? [withDoing ? { value:'plain', label:'진행 중 카드 빼기' } : { value:'doing', label:`진행 중 카드 ${c.doing.length}개 더하기` }] : [];
    return { ...out, ask:{ question:'아지트에 붙여 넣었나요?', inline:true, choices:[{ value:withDoing ? 'done+doing' : 'done', label:'다 썼어요', recommended:true }, ...toggle] } };
  }
  return { error:`모르는 명령이에요: ${cmd}` };
}

const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))){
  let r; try { r = main(); } catch (e) { r = { error:String(e && e.message || e) }; }
  process.stdout.write(JSON.stringify(r) + '\n');
}
