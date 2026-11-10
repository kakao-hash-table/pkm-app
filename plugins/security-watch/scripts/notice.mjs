#!/usr/bin/env node
// 보안 공지 대응 — 아지트 보안 공지를 가져오고, 공지마다 작업 폴더를 준비하고, 에이전트가 남긴 report.json을 사람이 볼 모양으로 정리한다. 결과는 JSON 한 줄.
//   node notice.mjs list   --api=https://api.agit.in/v2 --web=https://kakao.agit.in --groups=4 --match='보안\s*공지' --days=14
//   node notice.mjs fetch  --api=… --id=<글 번호> --title=<제목> --projects=$'~/code/*' --exclude=$'phocus' --worktrees=~/.pkm-worktrees/security
//   node notice.mjs report --dir=<공지 작업 폴더> --relevant=true|false --reason=<판단 이유>
// 아지트 토큰은 환경 변수 AGIT_TOKEN. 읽기만 하고 아지트에 아무것도 쓰지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const opt = argv => Object.fromEntries(argv.filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
const argval = v => { const s = String(v ?? ''); return s.startsWith('@file:') ? fs.readFileSync(s.slice(6), 'utf8') : s; };   // 큰 인자는 실행기가 파일로 넘긴다
const home = p => String(p || '').trim().replace(/^~(?=\/|$)/, os.homedir());
const lines = v => argval(v).split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const isDir = d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
const epoch = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : null; };
const ymd = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// 글 본문 → 제목 줄. 첫 몇 줄에서 멘션 링크·마크다운 기호를 걷어 내고, 규칙에 맞는 첫 줄을 제목으로 본다
export const plain = s => String(s || '')
  .replace(/\[(@@?[^\]]*)\]\([^)]*\)/g, ' ')        // [@group](…) 같은 멘션
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')          // 나머지 링크는 글자만
  .replace(/\\([[\]()*_#>`~\\-])/g, '$1')           // \[ \] 같은 이스케이프
  .replace(/\*+/g, '')
  .replace(/^[#>\s*_]+|[*_\s]+$/g, '')
  .replace(/\s+/g, ' ').trim();
export function titleOf(text, re){
  const rows = String(text || '').split('\n').map(plain).filter(Boolean).slice(0, 5);
  return rows.find(r => re.test(r)) || null;
}
export const cves = text => [...new Set((String(text || '').match(/CVE-\d{4}-\d{4,}/gi) || []).map(s => s.toUpperCase()))];
// 공지마다 같은 이름: CVE가 있으면 그것, 없으면 아지트 글 번호
export const slugOf = (id, text) => { const c = cves(text)[0]; return c ? c.toLowerCase() : `agit-${String(id).replace(/[^\w-]/g, '')}`; };

// 프로젝트 목록: 설정(한 줄에 폴더 하나, "폴더/*"는 그 아래 git 저장소 모두) → 비면 개발 도구 플러그인의 프로젝트 칸
export function devToolsProjects(conf){
  for (const prof of Object.values((conf && conf.profiles) || {})){
    const v = prof && prof.plugins && prof.plugins['dev-tools'] && prof.plugins['dev-tools'].settings && prof.plugins['dev-tools'].settings.projects;
    if (v && String(v).trim()) return String(v);
  }
  return '';
}
export function resolveProjects(spec, exclude){
  const skip = new Set(exclude.map(s => path.basename(home(s))));
  const out = [], seen = new Set();
  const add = d => { const r = path.resolve(d); if (seen.has(r) || !fs.existsSync(path.join(r, '.git'))) return; if (skip.has(path.basename(r))) return; seen.add(r); out.push({ name: path.basename(r), path: r }); };
  for (const l of spec){
    const p = home(l);
    if (/\/\*$/.test(p)){ const root = p.slice(0, -2); let subs = []; try { subs = fs.readdirSync(root).filter(n => !n.startsWith('.')).sort(); } catch {} for (const n of subs) if (isDir(path.join(root, n))) add(path.join(root, n)); }
    else if (isDir(p)) add(p);
  }
  return out;
}

// report.json → 판정과 레포별 짚은 곳. 고친 것·실패를 먼저, 괜찮은 것은 뒤로
const STATUS = { fixed: '고침', failed: '실패', ok: '괜찮음', skip: '해당 없음' };
const RISK = { server: '서버', ci: 'CI 빌드', none: '' };
export function summarize(report){
  const repos = (report && Array.isArray(report.repos) ? report.repos : []).filter(r => r && typeof r === 'object' && r.name);
  const order = { fixed: 0, failed: 1, ok: 2, skip: 3 };
  repos.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  const n = s => repos.filter(r => r.status === s).length;
  const fixed = n('fixed'), failed = n('failed');
  const findings = repos.map(r => {
    const rows = [];
    for (const c of (Array.isArray(r.changes) ? r.changes : []).slice(0, 12)) if (c && c.file) rows.push(`고친 곳: ${c.file}${c.line ? `:${c.line}` : ''}  전 ${c.before ?? ''}  후 ${c.after ?? ''}`);
    if (r.tests) rows.push(`검증: ${r.tests}`);
    if (r.base || r.commit) rows.push(`브랜치: ${[r.branch, r.base && `(기준 ${r.base})`, r.commit].filter(Boolean).join(' ')}`);
    if (r.todo) rows.push(`할 일: ${r.todo}`);
    const where = [r.name, RISK[r.risk]].filter(Boolean).join(' · ');
    const f = { where, tag: STATUS[r.status] || String(r.status || ''), title: String(r.problem || '').slice(0, 300), text: rows.join('\n').slice(0, 1500) };
    if (r.status === 'fixed' && r.path && r.branch) f.copy = `git -C ${r.path} show ${r.branch}`;
    return f;
  });
  const counts = [fixed && `고침 ${fixed}`, failed && `실패 ${failed}`, n('ok') && `괜찮음 ${n('ok')}`, n('skip') && `해당 없음 ${n('skip')}`].filter(Boolean).join(' · ');
  const verdict = fixed || failed
    ? { tone: 'bad', title: `레포 ${fixed}개에 수정 커밋을 만들었어요${failed ? `, ${failed}개는 고치지 못했어요` : ''}`, text: String(report.summary || counts) }
    : { tone: 'ok', title: '고칠 곳이 없어요', text: String(report.summary || counts || '점검한 레포가 없어요') };
  return { verdict, findings, fixed, failed, summary: counts || '점검 결과 없음' };
}

async function agit(api, p){
  const token = process.env.AGIT_TOKEN;
  if (!token) throw new Error('아지트 토큰이 없어요. 플러그인 설정에서 넣어 주세요');
  let r;
  try { r = await fetch(`${api}${p}`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new Error(e && e.name === 'TimeoutError' ? '아지트가 20초 안에 답하지 않았어요' : '아지트에 닿지 않아요. 회사망·VPN 연결을 확인해 주세요'); }
  if (r.status === 401 || r.status === 403) throw new Error('아지트 토큰이 맞지 않거나 만료됐어요. 플러그인 설정에서 다시 넣어 주세요');
  if (!r.ok) throw new Error(`아지트가 ${r.status}로 답했어요`);
  return r.json();
}

async function main(){
  const [cmd, ...rest] = process.argv.slice(2);
  const o = opt(rest);
  const done = obj => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(0); };
  const failWith = msg => { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(1); };
  const api = String(o.api || 'https://api.agit.in/v2').trim().replace(/\/+$/, '');
  try {
    if (cmd === 'list'){
      let re; try { re = new RegExp(o.match || '보안\\s*공지'); } catch { failWith(`공지 제목 규칙이 정규식이 아니에요: ${o.match}`); }
      const since = Date.now() - Math.max(1, parseInt(o.days, 10) || 14) * 86400000;
      const web = /^https?:\/\/[^/\s]+/.test(String(o.web || '').trim()) ? String(o.web).trim().replace(/\/+$/, '') : '';
      const groups = String(o.groups || '4').split(/[,\s]+/).filter(g => /^\d+$/.test(g));
      if (!groups.length) failWith('볼 그룹 번호를 적어 주세요');
      const items = [];
      for (const g of groups){
        let latest = null;
        for (let page = 0; page < 10; page++){   // 20개씩, 기간을 넘거나 10쪽까지
          const d = await agit(api, `/wall_messages?group_id=${g}&limit=20&is_parent=true${latest ? `&latest=${latest}` : ''}`);
          const list = (d && d.wall_messages) || [];
          for (const m of list){
            const at = epoch(m.created_time);
            if (at && at < since) continue;
            const title = titleOf(m.text, re);
            if (!title) continue;
            const edited = epoch(m.modified_time);
            items.push({ id: String(m.id), title: title.slice(0, 200), url: web ? `${web}/g/${g}/wall/${m.id}` : '', at: at ? new Date(at).toISOString() : null,
              meta: [at && ymd(at), edited && at && edited - at > 60000 && `${ymd(edited)} 수정`].filter(Boolean), tags: cves(m.text).slice(0, 2),
              version: String(m.modified_time || m.created_time || ''), vars: { group: g } });
          }
          const last = list[list.length - 1];
          if (list.length < 20 || !last || (epoch(last.created_time) || 0) < since) break;
          latest = last.id;
        }
      }
      items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      done({ items });
    }

    if (cmd === 'fetch'){
      if (!/^\d+$/.test(String(o.id || ''))) failWith('공지 글 번호가 없어요');
      const d = await agit(api, `/wall_messages/${o.id}`);
      const m = (d && d.wall_message) || {};
      const text = String(m.text || '');
      if (!text.trim()) failWith('공지 본문이 비어 있어요');
      const root = home(o.worktrees || '~/.pkm-worktrees/security');
      if (!path.isAbsolute(root)) failWith(`작업 폴더를 만들 곳이 절대 경로가 아니에요: ${o.worktrees}`);
      const slug = slugOf(o.id, `${o.title || ''}\n${text}`);
      const dir = path.join(root, slug);
      fs.mkdirSync(dir, { recursive: true });
      const spec = lines(o.projects);
      const projects = resolveProjects(spec.length ? spec : lines(devToolsProjects(readJSON(path.join(os.homedir(), '.pkm-app', 'runner.json')))), lines(o.exclude));
      if (!projects.length) failWith('점검할 프로젝트가 없어요. 플러그인 설정의 "점검할 프로젝트"나 개발 도구의 프로젝트 칸을 채워 주세요');
      const title = String(o.title || plain(text.split('\n').find(l => plain(l)) || '') || `아지트 글 ${o.id}`);
      fs.writeFileSync(path.join(dir, 'notice.md'), `# ${title}\n\n- 글 번호: ${o.id}\n- 가져온 때: ${new Date().toISOString()}\n\n${text}\n`);
      fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify(projects, null, 2));
      try { fs.rmSync(path.join(dir, 'report.json')); } catch {}   // 지난 실행의 결과를 새 결과로 착각하지 않게
      done({ dir, branch: `security/${slug}`, title, names: projects.map(p => p.name).join(', '), count: projects.length, _text: text.slice(0, 20000),
        summary: `프로젝트 ${projects.length}개 · 브랜치 security/${slug}` });
    }

    if (cmd === 'report'){
      if (String(o.relevant) !== 'true') done({ verdict: { tone: 'ok', title: 'FE 프로젝트에 해당 없어요', text: String(o.reason || '') }, findings: [], summary: '해당 없음' });
      const file = path.join(home(o.dir), 'report.json');
      const report = readJSON(file);
      if (!report) failWith(`에이전트가 결과 파일을 남기지 않았어요: ${file}`);
      const s = summarize(report);
      done({ verdict: s.verdict, findings: s.findings, fixed: s.fixed, failed: s.failed, summary: s.summary });
    }

    failWith('명령은 list, fetch, report 중 하나예요');
  } catch (e) { failWith(e.message || String(e)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
