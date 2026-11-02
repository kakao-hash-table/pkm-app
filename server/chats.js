// AI 챗봇 — chats/를 선언한 플러그인(ai-chat)을 설치한 프로필에서, 이 pkm 서버가 같은 컴퓨터의 pkm-ai-server로 대화형 에이전트를 돌린다.
// 방(room): 프로필 데이터 방 하나(scope: profile) + 단기 카드마다 하나(scope: card). 방 안의 말은 차례로, 방끼리는 동시에 돈다.
// 대화는 에이전트 세션(--resume)으로 이어 가고, 에이전트가 사람에게 묻는 도구 사용(승인 채널)은 방에 띄워 답을 돌려보낸다.
// 기록은 이 컴퓨터에만 둔다(~/.pkm-app/chats/<프로필>.json) — 세션이 이 컴퓨터의 Claude Code에 있어서 다른 기기로 동기화해도 쓸 수 없다.
// 로컬 전용: pkm 서버의 AI 연결이 루프백 주소이고, pkm-ai-server가 알려 준 컴퓨터·사용자 이름이 이 서버와 같을 때만 연다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as plugins from './plugins.js';

const P = createRequire(import.meta.url)('../web/js/pkm-plugin.js');
const HOME = process.env.PKM_HOME ? path.resolve(process.env.PKM_HOME) : path.join(os.homedir(), '.pkm-app');
const DIR = path.join(HOME, 'chats');
const KEEP_TURNS = 100, KEEP_LOG = 200, KEEP_ROOMS = 200;
const FINAL = new Set(['done', 'error', 'canceled']);
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const home = p => String(p || '').replace(/^~(?=$|\/)/, os.homedir());
// 말마다 한두 줄 요약 — 답 끝에 AI가 붙인 <pkm-summary>를 떼어 턴에 둔다(다음 날 이어 할 때 요약 보기로 훑는다)
const SUM_RE = /<pkm-summary>([\s\S]*?)(?:<\/pkm-summary>|$)/;
const SUM_ASK = `\n\n## 대화 요약(앱이 읽는다)
답을 마칠 때마다 맨 끝에 아래 모양을 그대로 붙인다. 사용자에게는 보이지 않고, 다음 날 이 대화를 이어 할 때 훑는 요약 로그가 된다.
읽는 사람은 ADHD라 한눈에 들어와야 한다: 줄마다 40자 안, 키워드만(문장·존댓말·인사·배경 설명 빼기), 결론 먼저. 남은 일이 있으면 답 줄 끝에 "→ 다음: 할 일".
<pkm-summary>
질문: 핵심 요청 + 꼭 넣은 조건 (예: 테스트 실패 원인, 네트워크 제외)
답: 결론 · 남은 일 (예: 날짜 버그 고침, 통과 → 다음: 문서)
</pkm-summary>`;
export function splitSummary(text){
  const s = String(text ?? ''), m = s.match(SUM_RE);
  if (!m) return { text: s, summary: null };
  const line = k => { const x = m[1].match(new RegExp(`^\\s*${k}\\s*[:：]\\s*(.+)$`, 'm')); return x ? clip(x[1].trim(), 120) : ''; };
  const q = line('질문'), a = line('답');
  return { text: (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trimEnd(), summary: q || a ? { q, a } : null };
}

export function createChats({ DATA, readConf, findCard, findProject = async () => null }){
  /* ---------- pkm-ai-server ---------- */
  async function ai(conn, pathname, opt = {}){
    let r;
    try { r = await fetch(conn.url + pathname, { ...opt, headers: { authorization: `Bearer ${conn.token}`, 'content-type': 'application/json' }, signal: opt.signal || AbortSignal.timeout(15000) }); }
    catch (e) { if (e.name === 'AbortError' && opt.signal) throw e; throw fail(502, `AI 서버(${conn.url})에 닿지 않아요. 이 컴퓨터에서 pkm-ai-server가 켜져 있는지 확인해 주세요`); }
    if (opt.raw && r.ok) return r;
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw fail(r.status === 401 ? 409 : r.status, b.error || `AI 서버 오류 ${r.status}`);
    return b;
  }
  // 이 서버와 같은 컴퓨터의 pkm-ai-server인지 — 30초 동안 기억한다
  let loc = { key: '', at: 0, v: null };
  async function locality(){
    const conn = readConf().ai;
    if (!conn || !conn.url || !conn.token) return { ok: false, reason: 'none', message: '이 pkm 서버에 AI 연결이 없어요' };
    const key = `${conn.url}|${conn.token.slice(-6)}`;
    if (loc.key === key && Date.now() - loc.at < 30000) return loc.v;
    let v;
    try {
      const host = new URL(conn.url).hostname;
      if (!LOOPBACK.has(host)) v = { ok: false, reason: 'remote', message: `AI 연결(${conn.url})이 다른 컴퓨터예요. pkm 서버와 같은 컴퓨터에 띄운 pkm-ai-server(127.0.0.1)에 연결해야 써요` };
      else {
        const me = await ai(conn, '/v1/me').catch(e => { if (e.status === 404) throw fail(409, 'pkm-ai-server가 채팅을 모르는 옛 버전이에요. 업데이트한 뒤 다시 켜 주세요'); throw e; });
        if (me.host !== os.hostname() || me.user !== os.userInfo().username) v = { ok: false, reason: 'other', message: `AI 연결이 다른 컴퓨터(${me.host})의 pkm-ai-server예요` };
        else {
          const claude = ((await ai(conn, '/v1/providers')).providers || []).find(x => x.id === 'claude');
          if (!claude || !claude.installed || !claude.logged_in) v = { ok: false, reason: 'claude', message: '이 컴퓨터에 Claude Code가 없거나 로그인돼 있지 않아요' };
          else if (!claude.agent || !claude.agent.approvals) v = { ok: false, reason: 'old', message: 'pkm-ai-server가 채팅 승인을 모르는 옛 버전이에요. 업데이트한 뒤 다시 켜 주세요' };
          else v = { ok: true, full: claude.agent.modes.includes('full'), concurrency: claude.agent.concurrency || 1, blocked: claude.blocked || null };
        }
      }
    } catch (e) { v = { ok: false, reason: 'error', message: e.message }; }
    loc = { key, at: Date.now(), v };
    return v;
  }

  /* ---------- 플러그인: chats/를 선언한 것 ---------- */
  async function chatPlugin(p){
    const x = (await plugins.list(path.join(DATA, p))).find(z => z.ok && z.manifest && (z.chats || []).length);
    if (!x) return null;
    const c = ((readConf().profiles || {})[p] || {}).plugins || {}, v = (c[x.id] || {}).settings || {};
    const settings = Object.fromEntries(x.manifest.settings.map(s => [s.key, v[s.key] ?? s.default]));
    return { id: x.id, name: x.manifest.name, path: x.path, chats: x.chats, settings };
  }
  // 프로젝트 방은 플러그인에 project 채팅이 없으면 카드 채팅 설정을 빌려 쓴다(옛 ai-chat도 돈다)
  const scopeOf = (pl, kind) => kind === 'project' ? pl.chats.find(c => c.scope === 'project') || pl.chats.find(c => c.scope === 'card') : pl.chats.find(c => c.scope === (kind === 'data' ? 'profile' : 'card'));
  const isWork = r => r.kind === 'card' || r.kind === 'project';   // 작업 폴더를 고르는 방

  /* ---------- 상태 파일 ---------- */
  const ST = {};   // 프로필 → { rev, rooms: [] }
  const file = p => path.join(DIR, `${encodeURIComponent(p)}.json`);
  function state(p){
    if (ST[p]) return ST[p];
    let s; try { s = JSON.parse(fs.readFileSync(file(p), 'utf8')); } catch { s = null; }
    ST[p] = s && Array.isArray(s.rooms) ? { rev: 0, rooms: s.rooms, recent: Array.isArray(s.recent) ? s.recent : [] } : { rev: 0, rooms: [], recent: [] };
    for (const r of ST[p].rooms) if (!('read' in r)) r.read = r.updated;   // 읽은 시각이 없던 옛 방은 다 읽은 것으로
    return ST[p];
  }
  const timers = {};
  function touch(p, soon = false){
    const s = state(p); s.rev++;
    clearTimeout(timers[p]);
    const write = () => {
      fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
      const tmp = `${file(p)}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, rooms: s.rooms, recent: s.recent }, null, 1) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file(p));
    };
    if (soon) write(); else timers[p] = setTimeout(write, 400);
  }
  const roomOf = (p, id) => { const r = state(p).rooms.find(r => r.id === id); if (!r) throw fail(404, '없는 채팅이에요'); return r; };
  const lastTurn = r => r.turns[r.turns.length - 1] || null;
  // 방 상태 — idle(대화 없음·그만둠) · run(하는 중) · ask(확인 요청) · new(새 답, 안 읽음) · reply(답을 읽음, 내 차례) · bad(멈춤)
  const unreadOf = r => { const t = lastTurn(r); return !!t && ['done', 'error'].includes(t.status) && !!t.finished && (!r.read || t.finished > r.read); };
  const stateOf = r => {
    const t = lastTurn(r);
    if (!t) return 'idle';
    if ((t.pending || []).length) return 'ask';
    if (!FINAL.has(t.status)) return 'run';
    if (t.status === 'error') return 'bad';
    if (t.status === 'done') return unreadOf(r) ? 'new' : 'reply';
    return 'idle';
  };
  const summary = r => {
    const t = lastTurn(r);
    return { id: r.id, kind: r.kind, card: r.card, cwd: r.cwd, memo: r.memo || null, created: r.created, updated: r.updated, turns: r.turns.length,
      status: t ? t.status : null, state: stateOf(r), unread: unreadOf(r), read: r.read || null, finished: t ? t.finished : null,
      pending: t ? (t.pending || []).length : 0, last: t ? clip(t.reply || t.error || t.text, 120) : '' };
  };

  /* ---------- 열기·지우기 ---------- */
  async function need(p){
    const pl = await chatPlugin(p);
    if (!pl) throw fail(404, 'AI 챗봇 플러그인이 설치돼 있지 않아요');
    const l = await locality();
    if (!l.ok) throw fail(409, l.message);
    return pl;
  }
  async function status(p){
    const pl = await chatPlugin(p);
    if (!pl) return { plugin: null, rev: state(p).rev };
    const l = await locality();
    return { plugin: { id: pl.id, name: pl.name, scopes: pl.chats.map(c => ({ scope: c.scope, name: c.name, label: c.label, description: c.description })) },
      ...l, home: os.homedir(), card_cwd: defaultCwd(pl), recent: state(p).recent, rev: state(p).rev, rooms: state(p).rooms.map(summary) };
  }
  function room(p, id){ return roomOf(p, id); }
  // 카드 세션의 기본 작업 폴더(플러그인 설정) — 고를 때 먼저 보일 곳일 뿐, 저절로 정하지 않는다
  const defaultCwd = pl => { const sc = scopeOf(pl, 'card'), v = sc && sc.cwd ? home(sc.cwd.replace(/\{([a-z_]+)\}/g, (m, k) => pl.settings[k] ?? '')) : ''; return v ? path.resolve(v) : null; };
  const isDir = d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
  function checkDir(cwd){
    const dir = path.resolve(home(String(cwd)));
    if (!path.isAbsolute(home(String(cwd))) || !isDir(dir)) throw fail(400, `작업 폴더가 없어요: ${dir}`);
    return dir;
  }
  function remember(p, dir){ const s = state(p); s.recent = [dir, ...s.recent.filter(x => x !== dir)].slice(0, 8); }
  async function open(p, { card, project, cwd } = {}){
    const pl = await need(p), s = state(p);
    if (project){   // 프로젝트마다 방 하나 — 처음 열 때 작업 폴더는 그 프로젝트의 AI 작업 폴더
      const sc = scopeOf(pl, 'project'); if (!sc) throw fail(400, '이 플러그인에는 카드·프로젝트 채팅이 없어요');
      const id = `project-${String(project)}`;
      let r = s.rooms.find(r => r.id === id);
      if (r) return r;
      const pj = await findProject(p, String(project));
      if (!pj) throw fail(404, '프로젝트를 찾지 못했어요');
      const dir = cwd ? checkDir(cwd) : pj.work && isDir(pj.work) ? pj.work : null;
      if (dir) remember(p, dir);
      r = { id, kind: 'project', card: { id: pj.id, title: pj.title }, cwd: dir, session: null, created: now(), updated: now(), read: now(), turns: [] };
      s.rooms.push(r);
      if (s.rooms.length > KEEP_ROOMS) s.rooms.splice(1, s.rooms.length - KEEP_ROOMS);
      touch(p, true);
      return r;
    }
    if (!card){
      if (!scopeOf(pl, 'data')) throw fail(400, '이 플러그인에는 데이터 채팅이 없어요');
      let r = s.rooms.find(r => r.kind === 'data');
      if (!r){ r = { id: 'data', kind: 'data', card: null, cwd: path.join(DATA, p), session: null, created: now(), updated: now(), read: now(), turns: [] }; s.rooms.unshift(r); touch(p, true); }
      return r;
    }
    const sc = scopeOf(pl, 'card'); if (!sc) throw fail(400, '이 플러그인에는 카드 채팅이 없어요');
    const id = `card-${String(card)}`;
    let r = s.rooms.find(r => r.id === id);
    if (r) return r;
    const c = await findCard(p, String(card));
    if (!c) throw fail(404, '단기 카드를 찾지 못했어요');
    const dir = cwd ? checkDir(cwd) : null;   // 프로젝트가 아닌 카드도 많다 — 폴더는 채팅 창에서 필요할 때 고른다
    if (dir) remember(p, dir);
    r = { id, kind: 'card', card: { id: c.id, title: c.title }, cwd: dir, session: null, created: now(), updated: now(), read: now(), turns: [] };
    s.rooms.push(r);
    if (s.rooms.length > KEEP_ROOMS) s.rooms.splice(1, s.rooms.length - KEEP_ROOMS);
    touch(p, true);
    return r;
  }
  // 카드 세션의 작업 폴더 고르기·바꾸기·비우기. Claude 세션은 폴더에 묶여 있어 바꾸면 새 세션으로 하고, 다음 말에 앞선 대화를 붙인다
  async function setCwd(p, id, cwd){
    await need(p);
    const r = roomOf(p, id);
    if (!isWork(r)) throw fail(400, '작업 폴더는 카드·프로젝트 세션에서만 골라요');
    if (r.turns.some(t => !FINAL.has(t.status))) throw fail(409, '하는 중에는 작업 폴더를 바꿀 수 없어요. 끝나거나 그만둔 뒤에 바꿔 주세요');
    const dir = cwd ? checkDir(cwd) : null;
    if (dir === r.cwd) return r;
    if (r.session){ r.session = null; r.carry = true; }
    r.cwd = dir; r.updated = now();
    if (dir) remember(p, dir);
    touch(p, true);
    return r;
  }
  // 폴더 고르기 화면 — 그 폴더의 하위 폴더(숨김·node_modules 빼고). 프로젝트(git)인지도 알려 준다
  async function dirs(p, at){
    await need(p);
    const dir = path.resolve(home(at || os.homedir()));
    if (!isDir(dir)) throw fail(404, `폴더가 없어요: ${dir}`);
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { throw fail(403, `이 폴더는 열어 볼 수 없어요: ${dir}`); }
    const list = ents.filter(e => (e.isDirectory() || (e.isSymbolicLink() && isDir(path.join(dir, e.name)))) && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map(e => ({ name: e.name, path: path.join(dir, e.name), git: fs.existsSync(path.join(dir, e.name, '.git')) }))
      .sort((a, b) => (b.git - a.git) || a.name.localeCompare(b.name, 'ko')).slice(0, 300);
    return { path: dir, parent: path.dirname(dir) !== dir ? path.dirname(dir) : null, home: os.homedir(), git: fs.existsSync(path.join(dir, '.git')), dirs: list };
  }
  // 메모 — 마지막으로 하려던 일을 사람이 적어 두는 칸. AI에게는 보내지 않는다. 데이터 방은 아직 없으면 만든다
  async function setMemo(p, id, text){
    const v = String(text ?? '').replace(/\r/g, '').trim();
    if (v.length > 2000) throw fail(400, '메모가 너무 길어요(2천 자까지)');
    const r = id === 'data' && !state(p).rooms.some(x => x.id === 'data') ? await open(p) : roomOf(p, id);
    r.memo = v ? { text: v, at: now() } : null;
    touch(p, true);
    return r;
  }
  // 읽음 — 채팅 창에서 그 방의 끝난 답을 본 시각. 카드에서 '새 답'과 '내 차례'를 가른다
  function markRead(p, id){
    const r = roomOf(p, id);
    if (unreadOf(r)){ r.read = now(); touch(p, true); }
    return summary(r);
  }
  async function remove(p, id){
    const r = roomOf(p, id);
    await cancel(p, id).catch(() => {});
    const s = state(p); s.rooms = s.rooms.filter(x => x !== r);
    touch(p, true);
    return { removed: id };
  }
  // 새 대화 — 기록과 세션을 비운다(카드 방은 그대로 둔다)
  async function reset(p, id){
    const r = roomOf(p, id);
    await cancel(p, id).catch(() => {});
    Object.assign(r, { session: null, turns: [], updated: now(), read: now() });
    touch(p, true);
    return r;
  }

  /* ---------- 말 보내기 → 차례로 실행 ---------- */
  async function send(p, id, { id: tid, text } = {}){
    await need(p);
    const r = roomOf(p, id), msg = String(text || '').trim();
    if (!msg) throw fail(400, '보낼 말을 적어 주세요');
    if (msg.length > 20000) throw fail(400, '말이 너무 길어요(2만 자까지)');
    const key = /^[\w-]{6,64}$/.test(String(tid || '')) ? String(tid) : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dup = r.turns.find(t => t.id === key);
    if (dup){ if (dup.text !== msg) throw fail(409, '같은 요청 id로 다른 말을 보냈어요'); return dup; }   // 다시 보내기 — 한 번만
    const t = { id: key, text: msg, status: 'queued', created: now(), started: null, finished: null, job: null, reply: '', log: [], pending: [], error: null, until: null };
    r.turns.push(t); if (r.turns.length > KEEP_TURNS) r.turns.splice(0, r.turns.length - KEEP_TURNS);
    r.updated = r.read = now(); touch(p, true);
    pump(p);
    return t;
  }
  async function cancel(p, id){
    const r = roomOf(p, id), conn = readConf().ai;
    for (const t of r.turns){
      if (t.status === 'queued'){ Object.assign(t, { status: 'canceled', finished: now() }); continue; }
      if (!FINAL.has(t.status) && t.job && conn) await ai(conn, `/v1/jobs/${t.job}`, { method: 'DELETE' }).catch(() => {});
    }
    r.updated = now(); touch(p, true);
    return r;
  }
  async function answer(p, id, { request_id, allow, input } = {}){
    const r = roomOf(p, id), t = r.turns.find(t => (t.pending || []).some(q => q.id === request_id));
    if (!t) throw fail(409, '이미 답했거나 끝난 확인 요청이에요');
    const conn = readConf().ai; if (!conn) throw fail(409, '이 pkm 서버에 AI 연결이 없어요');
    const j = (await ai(conn, `/v1/jobs/${t.job}/answer`, { method: 'POST', body: JSON.stringify({ request_id, allow: allow === true, input: input && typeof input === 'object' ? input : undefined, message: allow ? '' : '사용자가 채팅에서 거절했어요' }) })).job;
    const q = t.pending.find(q => q.id === request_id);
    note(t, allow ? `허락함 · ${q.title || q.tool}` : `거절함 · ${q.title || q.tool}`);
    applyJob(r, t, j); touch(p, true);
    return t;
  }

  const running = new Set();   // 프로필|방 — 방마다 한 번에 하나
  function pump(p){
    for (const r of state(p).rooms){
      const k = `${p}|${r.id}`;
      if (running.has(k)) continue;
      const t = r.turns.find(t => ['running', 'waiting'].includes(t.status) && t.job) || r.turns.find(t => t.status === 'queued');
      if (!t) continue;
      running.add(k);
      run(p, r, t).catch(e => { Object.assign(t, { status: 'error', error: clip(e.message, 500), finished: now(), pending: [] }); touch(p); })
        .finally(() => { running.delete(k); if (state(p).rooms.includes(r)) pump(p); });
    }
  }

  function note(t, text){ t.log.push({ at: now(), kind: 'note', text: clip(text, 300) }); if (t.log.length > KEEP_LOG) t.log.splice(0, t.log.length - KEEP_LOG); }
  function applyJob(r, t, j){
    if (j.session && r.session !== j.session) r.session = j.session;   // 중간에 멈춰도 같은 세션에서 이어 가게
    t.pending = (j.pending || []).map(q => ({ id: q.id, tool: q.tool, title: q.title, description: q.description, input: q.input, at: q.at }));
    if (j.status === 'waiting') Object.assign(t, { status: 'waiting', until: j.until || null, error: j.message || null });
    else if (j.status === 'queued' || j.status === 'running') Object.assign(t, { status: j.status, until: null });
    else if (j.status === 'done'){
      const { text, summary } = splitSummary((j.result && j.result.text) || t.reply || '');
      Object.assign(t, { status: 'done', reply: text, finished: now(), pending: [], until: null });
      if (summary) t.summary = summary;
    }
    else if (j.status === 'canceled') Object.assign(t, { status: 'canceled', finished: now(), pending: [] });
    else if (j.status === 'error') Object.assign(t, { status: 'error', error: clip(j.error || '실패했어요', 500), finished: now(), pending: [] });
    if (j.result && j.result.session) r.session = j.result.session;
    r.updated = now();
  }

  async function context(p, pl, r){
    const sc = scopeOf(pl, r.kind), vars = { profile: p, profile_dir: path.join(DATA, p), data_dir: DATA, today: ymd(new Date()), cwd: r.cwd || path.join(DATA, p),
      work_dir: r.cwd || '아직 고르지 않았어요. 카드 파일과 이 프로필의 노트만 다루고, 이 컴퓨터의 다른 폴더에서 할 일이면 채팅 창의 [작업 폴더 고르기]로 골라 달라고 해' };
    if (r.kind === 'card'){
      const c = await findCard(p, r.card.id);
      if (c) r.card.title = c.title;
      Object.assign(vars, { card_id: r.card.id, card_title: r.card.title, card_status: c ? c.status : '찾지 못함(지워졌을 수 있음)', card_file: c ? path.join(DATA, p, c.path) : '', card_body: c ? c.body : '' });
    }
    if (r.kind === 'project'){
      const pj = await findProject(p, r.card.id);
      if (pj) r.card.title = pj.title;
      const cards = pj ? pj.cards.map(c => `- [${c.status}] ${c.title} — ${path.join(DATA, p, c.path)}${c.open.length ? `\n${c.open.map(x => `  - [ ] ${x}`).join('\n')}` : ''}`).join('\n') : '';
      Object.assign(vars, { project_id: r.card.id, project_title: r.card.title, project_goal: pj ? pj.goal : '찾지 못함(지워졌을 수 있음)', project_status: pj ? pj.status : '',
        project_file: pj ? pj.file : '', project_hub: pj && pj.hub ? pj.hub : '없음', project_cards: cards || '없음',
        // 프로젝트 채팅이 없는 옛 플러그인은 카드 프롬프트를 쓴다 — 카드 자리를 프로젝트로 채운다
        card_id: r.card.id, card_title: `프로젝트 ${r.card.title}`, card_status: pj ? pj.status : '', card_file: pj && pj.hub ? pj.hub : '', card_body: `목표: ${pj ? pj.goal : ''}\n\n이 프로젝트의 단기 카드:\n${cards}` });
    }
    const tpl = sc && sc.prompt ? fs.readFileSync(path.join(pl.path, sc.prompt), 'utf8') : '';
    return { system: tpl.replace(/\{([a-z_]+)\}/g, (m, k) => vars[k] ?? m) + SUM_ASK, mode: (sc && sc.mode) || 'auto' };
  }

  async function run(p, r, t){
    const conn = readConf().ai;
    if (!t.job){
      const pl = await need(p), l = await locality(), ctx = await context(p, pl, r);
      const mode = ctx.mode === 'full' && !l.full ? 'auto' : ctx.mode;   // full을 허용하지 않은 서버면 자동 권한 모드로(물을 것은 채팅으로 온다)
      const prof = path.join(DATA, p);
      const agent = isWork(r) ? { cwd: r.cwd || prof, add_dirs: r.cwd ? [prof] : [] } : { cwd: r.cwd, add_dirs: [DATA] };
      Object.assign(agent, { mode, approvals: true, ...(r.session ? { session: r.session } : {}) });
      Object.assign(t, { status: 'running', started: now(), mode });
      if (mode !== ctx.mode) note(t, 'pkm-ai-server가 full 모드를 허용하지 않아 자동 권한 모드로 해요');
      let prompt = t.text;
      if (r.carry && !r.session){   // 작업 폴더를 바꿔 새 세션 — 앞선 대화를 짧게 붙여 맥락을 잇는다
        const prev = r.turns.filter(x => x !== t && x.status === 'done').slice(-6).map(x => `사용자: ${clip(x.text, 600)}\nAI: ${clip(x.reply, 1200)}`).join('\n\n');
        if (prev) prompt = `(작업 폴더를 ${r.cwd || '고르지 않음'}(으)로 바꿔 새로 시작해요. 앞선 대화:\n${prev}\n)\n\n${t.text}`;
        r.carry = false;
      }
      const body = { plugin: { id: pl.id, root: pl.path }, provider: 'claude', prompt, system: ctx.system, tag: `plugin:${pl.id}`, agent };
      const j = (await ai(conn, '/v1/jobs', { method: 'POST', body: JSON.stringify(body) })).job;
      t.job = j.id; applyJob(r, t, j); touch(p, true);
    }
    // 끝날 때까지 진행 상황을 받는다. 스트림이 끊기면 상태를 다시 읽고 이어 받는다(이 서버를 다시 켜도 같은 작업에 다시 붙는다)
    for (let tries = 0; !FINAL.has(t.status) && state(p).rooms.includes(r); tries++){
      try {
        const res = await ai(conn, `/v1/jobs/${t.job}/events`, { raw: true, signal: AbortSignal.timeout(6 * 3600000) });
        const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
        for (;;){
          const { value, done } = await rd.read(); if (done) break;
          buf += dec.decode(value, { stream: true }); let i;
          while ((i = buf.indexOf('\n\n')) >= 0){
            const line = buf.slice(0, i).split('\n').find(l => l.startsWith('data: ')); buf = buf.slice(i + 2);
            if (!line) continue;
            let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
            if (ev.type === 'status'){ applyJob(r, t, ev.job); touch(p, FINAL.has(t.status) || !!t.pending.length); }
            else if (ev.type === 'text' && ev.text){ const x = splitSummary(ev.text).text; if (x.trim()) t.log.push({ at: now(), kind: 'text', text: clip(x, 4000) }); touch(p); }
            else if (ev.type === 'tool'){ t.log.push({ at: now(), kind: 'tool', tool: clip(ev.tool, 60), text: clip(ev.summary, 300) }); touch(p); }
            if (t.log.length > KEEP_LOG) t.log.splice(0, t.log.length - KEEP_LOG);
          }
        }
      } catch (e) { if (e.status === 404){ Object.assign(t, { status: 'error', error: 'AI 서버에서 이 작업을 찾지 못했어요', finished: now(), pending: [] }); touch(p); return; } }
      if (FINAL.has(t.status)) break;
      try { applyJob(r, t, (await ai(conn, `/v1/jobs/${t.job}`)).job); touch(p); } catch {}
      if (!FINAL.has(t.status)) await new Promise(res => setTimeout(res, Math.min(30000, 1000 * 2 ** Math.min(tries, 5))));
    }
    touch(p, true);
  }

  // 서버를 켤 때 — 돌던 말은 같은 작업에 다시 붙고, 기다리던 말은 차례대로
  function start(profiles){
    for (const p of profiles){
      const s = state(p);
      for (const r of s.rooms) for (const t of r.turns) if (['running', 'waiting'].includes(t.status) && !t.job) Object.assign(t, { status: 'error', error: 'pkm 서버가 다시 켜져 멈췄어요. 다시 보내 주세요', finished: now() });
      pump(p);
    }
  }
  const forget = () => { loc = { key: '', at: 0, v: null }; };   // AI 연결을 바꾼 뒤 바로 다시 확인
  return { status, room, open, remove, reset, send, cancel, answer, setCwd, setMemo, markRead, dirs, start, locality, forget };
}
