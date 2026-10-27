#!/usr/bin/env node
// 에이전트 목록 — 폴더(한 줄에 하나)의 Claude Code 에이전트 파일(*.md, 프런트매터 name·description·model·tools)을 피드 항목으로. 결과는 JSON 한 줄.
//   node agents.mjs list --dirs=$'~/.claude/agents\n~/notes/.claude/agents'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const home = p => String(p || '').trim().replace(/^~(?=\/|$)/, os.homedir());
const tilde = p => p === os.homedir() || p.startsWith(os.homedir() + path.sep) ? '~' + p.slice(os.homedir().length) : p;
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const unquote = v => {
  if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map(s => unquote(s.trim())).filter(Boolean).join(', ');
  return v;
};
// 맨 위 --- 사이의 위 수준 키만 읽는다: 한 줄 값, 따옴표, [목록], "- 항목" 목록, | > 여러 줄
export function frontmatter(text){
  const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return {};
  const out = {}, lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++){
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):(?:\s+(.*?))?\s*$/);
    if (!kv) continue;
    const key = kv[1], v = kv[2] || '';
    const more = () => { const b = []; while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || /^-\s/.test(lines[i + 1]) || !lines[i + 1].trim())) b.push(lines[++i]); return b; };
    if (/^[|>][-+]?$/.test(v)) out[key] = more().map(l => l.trim()).join(v[0] === '|' ? '\n' : ' ').trim();
    else if (!v){ const b = more().map(l => l.trim()).filter(Boolean); out[key] = b.every(l => l.startsWith('- ')) ? b.map(l => unquote(l.slice(2).trim())).join(', ') : b.join(' '); }
    else out[key] = unquote(v);
  }
  return out;
}

export function list(dirsText){
  const items = [], missing = [];
  for (const line of String(dirsText || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))){
    const dir = path.resolve(home(line));
    let names;
    try { names = fs.readdirSync(dir).filter(n => n.endsWith('.md') && !n.startsWith('.')); } catch { missing.push(line); continue; }
    for (const n of names.sort()){
      const file = path.join(dir, n);
      let fm = {};
      try { if (!fs.statSync(file).isFile()) continue; fm = frontmatter(fs.readFileSync(file, 'utf8').slice(0, 20000)); } catch { continue; }
      const name = String(fm.name || n.replace(/\.md$/, ''));
      items.push({ id: file, title: name,
        meta: [clip(String(fm.description || '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim(), 80), fm.model ? String(fm.model) : '', tilde(dir)].filter(Boolean),
        vars: { path: file, dir, name } });
    }
  }
  const seen = new Set();
  return { items: items.filter(it => !seen.has(it.id) && seen.add(it.id)).sort((a, b) => a.title.localeCompare(b.title)).slice(0, 200), missing };
}

function main(){
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
  const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };
  if (cmd !== 'list') done({ error: '명령은 list예요' }, 1);
  const { items, missing } = list(opt.dirs);
  done({ items, ...(missing.length ? { note: `찾지 못한 폴더: ${missing.join(', ')}` } : {}) });
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main();
