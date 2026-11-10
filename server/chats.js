// AI 챗봇 — chats/를 선언한 플러그인(ai-chat)을 설치한 프로필에서, 이 pkm 서버가 같은 컴퓨터의 pkm-ai-server로 대화형 에이전트를 돌린다.
// 방(room): 프로필 데이터 방 하나(scope: profile) + 단기 카드마다 하나(scope: card). 방 안의 말은 차례로, 방끼리는 동시에 돈다.
// 대화는 에이전트 세션(--resume)으로 이어 가고, 에이전트가 사람에게 묻는 도구 사용(승인 채널)은 방에 띄워 답을 돌려보낸다.
// 기록은 이 컴퓨터에만 둔다(~/.pkm-app/chats/<프로필>.json) — 세션이 이 컴퓨터의 AI CLI에 있어서 다른 기기로 동기화해도 쓸 수 없다.
// 로컬 전용: pkm 서버의 AI 연결이 루프백 주소이고, pkm-ai-server가 알려 준 컴퓨터·사용자 이름이 이 서버와 같을 때만 연다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as plugins from './plugins.js';
import { createChatMedia } from './chat-media.js';

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

export function createChats({ DATA, readConf, findCard, findProject = async () => null, onPush = null }){
  const media = createChatMedia(path.join(DIR, 'media'));
  async function upload(p, id, req, name){ await need(p); roomOf(p, id); return media.upload(p, id, req, name); }
  function attachment(p, id, aid, req, res){ roomOf(p, id); return media.serve(p, id, aid, req, res); }
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
          const providers = ((await ai(conn, '/v1/providers')).providers || []).filter(x => x.enabled !== false && x.installed && x.logged_in && x.agent);
          if (!providers.length) v = { ok: false, reason: 'provider', message: '이 컴퓨터에 로그인된 AI 에이전트가 없어요. AI 연결에서 상태를 확인해 주세요' };
          else v = { ok: true, providers, full: providers.some(x => x.agent.modes.includes('full')), concurrency: Math.max(...providers.map(x => x.agent.concurrency || 1)) };
        }
      }
    } catch (e) { v = { ok: false, reason: 'error', message: e.message }; }
    loc = { key, at: Date.now(), v };
    return v;
  }

  async function selection(provider, model, effort){
    const l = await locality();
    if (!l.ok) throw fail(409, l.message);
    const p = l.providers.find(x => x.id === provider);
    if (!p) throw fail(409, '선택한 AI를 쓸 수 없어요. AI 연결에서 설치·로그인 상태를 확인해 주세요');
    if (model !== 'default' && (!/^[\w.\-:@/]{1,80}$/.test(model) || (p.models && !p.models.some(x => x.id === model)))) throw fail(400, '선택한 AI의 모델이 아니에요. AI 연결에서 다시 골라 주세요');
    if (effort != null && !(p.efforts || []).includes(effort)) throw fail(400, '선택한 AI의 생각하는 정도를 다시 골라 주세요');
    return p;
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
  const lastTurn = r => {
    const active = r.turns.filter(t => !FINAL.has(t.status));
    // 우선 실행으로 완료 순서가 달라져도 방 목록에는 지금 하는 일·가장 최근 답을 보여 준다.
    return active.find(t => t.job) || active[active.length - 1] || r.turns.filter(t => t.cancel_kind !== 'send')
      .sort((a, b) => String(b.finished || b.created).localeCompare(String(a.finished || a.created)))[0] || r.turns[r.turns.length - 1] || null;
  };
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
      pending: t ? (t.pending || []).length : 0, last: t ? clip(t.reply || t.error || t.text, 120) : '', ...live(t) };
  };
  // 실시간 현황 — 하는 중인 말의 시작 시각·보낸 말·지금 하는 일(마지막 진행 한 줄)·확인 요청 제목
  const live = t => {
    if (!t || FINAL.has(t.status)) return {};
    const l = [...(t.log || [])].reverse().find(x => x.kind === 'tool' || x.kind === 'text'), q = (t.pending || [])[0];
    const doing = !l ? '' : l.kind === 'tool' ? `${l.tool}${l.text ? ` · ${l.text}` : ''}` : String(l.text).trim().split('\n').pop();
    return { started: t.started || t.created, asked: clip(t.text, 80), doing: clip(doing, 100), until: t.until || null,
      question: q ? clip(q.tool === 'AskUserQuestion' ? ((q.input && q.input.questions && q.input.questions[0] && q.input.questions[0].question) || '물어볼 게 있어요') : (q.description || q.title || q.tool), 100) : '' };
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
      ...l, queue_controls: true, home: os.homedir(), card_cwd: defaultCwd(pl), recent: state(p).recent, rev: state(p).rev, rooms: state(p).rooms.map(summary) };
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
  async function send(p, id, { id: tid, text, attachments = [], provider = 'claude', model = 'default', effort = null } = {}){
    await need(p);
    const r = roomOf(p, id), msg = String(text || '').trim();
    if (!msg && (!Array.isArray(attachments) || !attachments.length)) throw fail(400, '보낼 말이나 사진·영상을 첨부해 주세요');
    if (msg.length > 20000) throw fail(400, '말이 너무 길어요(2만 자까지)');
    const key = /^[\w-]{6,64}$/.test(String(tid || '')) ? String(tid) : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const dup = r.turns.find(t => t.id === key);
    if (dup){ if (dup.text !== msg || JSON.stringify((dup.attachments || []).map(a => a.id)) !== JSON.stringify(attachments)) throw fail(409, '같은 요청 id로 다른 말을 보냈어요'); return dup; }   // 다시 보내기 — 한 번만
    const chosen = await selection(provider, model, effort);
    const resolved = media.resolve(p, id, attachments);
    if (resolved.images.length && !['claude', 'codex'].includes(provider)) throw fail(400, '사진·영상은 Claude 또는 GPT를 골라 보내 주세요');
    if (resolved.images.length && !chosen.input_images) throw fail(409, 'AI 서버가 이미지 입력을 지원하지 않는 버전이에요. pkm-ai-server를 업데이트·다시 켠 뒤 보내 주세요');
    const t = { id: key, text: msg, attachments:resolved.attachments, provider, model, effort, status: 'queued', created: now(), started: null, finished: null, job: null, reply: '', log: [], pending: [], error: null, until: null };
    r.turns.push(t); if (r.turns.length > KEEP_TURNS) r.turns.splice(0, r.turns.length - KEEP_TURNS);
    r.updated = r.read = now(); touch(p, true);
    pump(p);
    return t;
  }
  async function cancel(p, id){
    const r = roomOf(p, id), conn = readConf().ai;
    for (const t of r.turns){
      if (t.status === 'queued' && !t.job){ Object.assign(t, { status: 'canceled', finished: now() }); continue; }
      if (!FINAL.has(t.status) && t.job && conn) await ai(conn, `/v1/jobs/${t.job}`, { method: 'DELETE' }).catch(() => {});
    }
    r.updated = now(); touch(p, true);
    return r;
  }
  // 대기 요청 하나를 다른 AI로 잇는다. 원본은 취소 기록으로 남기고 새 턴을 바로 다음에 둔다.
  // 같은 방의 다음 요청이 먼저 시작하지 않게 전환 동안 pump를 잠깐 막는다.
  const switching = new Set();
  // 전체 그만두기와 별개로 대기 메시지 하나만 취소한다. 실행이 시작됐다면 취소하지 않는다.
  async function cancelTurn(p, id, { turn_id } = {}){
    const r = roomOf(p, id), key = `${p}|${id}`, t = r.turns.find(t => t.id === turn_id);
    if (!t) throw fail(404, '취소할 메시지를 찾지 못했어요');
    if (t.status === 'canceled') return t;
    if (switching.has(key)) throw fail(409, '메시지를 처리 중이에요. 잠시 뒤 다시 해 주세요');
    switching.add(key);
    try {
      if (!['queued', 'waiting'].includes(t.status)) throw fail(409, '이미 실행을 시작한 메시지예요. 진행 중인 작업은 그만두기로 멈춰 주세요');
      if (t.job) await stopTurn(r, t, readConf().ai, true);
      Object.assign(t, { status: 'canceled', cancel_kind: 'send', finished: now(), pending: [], until: null });
      if (r.priority_turn === t.id) delete r.priority_turn;
      r.updated = now(); touch(p, true);
      return t;
    } finally { switching.delete(key); pump(p); }
  }
  async function stopTurn(r, t, conn, idleOnly = false){
    if (!conn?.url || !conn.token) throw fail(409, '작업을 중단하려면 AI 서버 연결이 필요해요');
    // run()이 작업 생성 요청 중이면 job id를 받을 때까지 기다린다. 중단 확인 전에는 새 작업을 시작하지 않는다.
    for (let checks = 0; !t.job && !FINAL.has(t.status) && checks < 75; checks++) await new Promise(resolve => setTimeout(resolve, 200));
    if (!t.job){ if (FINAL.has(t.status)) return; throw fail(409, '작업 시작을 확인 중이에요. 잠시 뒤 다시 눌러 주세요'); }
    let j = (await ai(conn, `/v1/jobs/${t.job}`)).job;
    if (idleOnly && !['queued', 'waiting'].includes(j?.status)) throw fail(409, '이미 실행을 시작한 메시지예요. 새 상태를 확인해 주세요');
    if (!FINAL.has(j?.status)) j = (await ai(conn, `/v1/jobs/${t.job}${idleOnly ? '?idle_only=1' : ''}`, { method: 'DELETE' })).job;
    for (let checks = 0; j && !FINAL.has(j.status) && checks < 50; checks++){
      await new Promise(resolve => setTimeout(resolve, 200));
      j = (await ai(conn, `/v1/jobs/${t.job}`)).job;
    }
    if (!j || !FINAL.has(j.status) || (idleOnly && j.status !== 'canceled')) throw fail(409, '작업의 중단을 확인하지 못했어요. 새 작업은 시작하지 않았어요');
    applyJob(r, t, j);
  }
  async function runNow(p, id, { turn_id } = {}){
    const r = roomOf(p, id), key = `${p}|${id}`, t = r.turns.find(t => t.id === turn_id);
    if (!t) throw fail(404, '반영할 메시지를 찾지 못했어요');
    if (t.immediate) return t;   // 같은 버튼 재요청은 한 번만 반영
    if (switching.has(key)) throw fail(409, '메시지를 처리 중이에요. 잠시 뒤 다시 해 주세요');
    switching.add(key);
    try {
      if (t.status !== 'queued' || t.job) throw fail(409, '아직 실행하지 않은 대기 메시지만 바로 반영할 수 있어요');
      await need(p);
      const chosen = await selection(t.provider || 'claude', t.model || 'default', t.effort || null);
      if (chosen.blocked) throw fail(409, '이 메시지의 AI가 사용 한도·로그인 문제로 대기 중이에요. 다른 AI로 이어서를 이용해 주세요');
      const active = r.turns.find(x => x !== t && !FINAL.has(x.status) && (x.status === 'running' || x.status === 'waiting' || x.job));
      const inherited = active ? [...(active.attachments || []), ...(active.immediate?.attachments || [])] : [];
      if ((inherited.length || t.attachments?.length) && (!chosen.input_images || !['claude', 'codex'].includes(t.provider))) throw fail(409, '기존 첨부를 읽을 수 있는 Claude·GPT로 메시지를 보내 주세요');
      if (active) await stopTurn(r, active, readConf().ai);
      if (!state(p).rooms.includes(r) || !r.turns.includes(t) || t.status !== 'queued' || t.job) throw fail(409, '대기 메시지의 상태가 바뀌었어요. 새 상태를 확인해 주세요');
      const history = r.turns.filter(x => x !== t && x !== active && x.status === 'done').slice(-6).map(x => `사용자: ${clip(x.text, 1000)}\nAI: ${clip(x.reply, 2000)}`).join('\n\n');
      const previous = active ? `${active.immediate?.prompt || active.handoff?.prompt || active.text}\n\n최근 진행:\n${(active.log || []).slice(-20).map(l => `${l.tool || l.kind}: ${clip(l.text, 800)}`).join('\n')}${active.reply ? `\nAI 답변:\n${clip(active.reply, 6000)}` : ''}` : '';
      const context = `${history}\n\n${previous}`;
      const bounded = context.length > 150000 ? `${context.slice(0, 50000)}\n[중간 진행 기록 생략]\n${context.slice(-100000)}` : context;
      t.immediate = { from_turn: active?.id || null, attachments: inherited, prompt: `진행 중인 응답을 중지하고 추가 지시를 지금 반영합니다. 기존 사용자 목표와 제약은 유지하고, 아래 추가 지시가 바꾸는 부분을 우선 적용하세요. 현재 파일·실행 상태를 확인하고 이미 끝낸 작업은 반복하지 마세요.\n\n기존 대화·작업:\n${bounded}\n\n지금 반영할 사용자 추가 지시:\n${t.text || '첨부한 사진·영상을 확인해 주세요.'}` };
      if (active?.status === 'canceled'){ active.interrupted_by = t.id; note(active, '추가 지시를 지금 반영하기 위해 응답을 중지했어요'); }
      // 화면의 메시지 순서는 유지하고 실행 우선순위만 바꾼다. 나머지 대기 메시지는 그대로 둔다.
      r.priority_turn = t.id;
      r.updated = r.read = now(); touch(p, true);
      return t;
    } finally { switching.delete(key); pump(p); }
  }
  async function handoff(p, id, { id: tid, turn_id, provider, model = 'default', effort = null } = {}){
    const r = roomOf(p, id), key = `${p}|${id}`;
    if (!/^[\w-]{6,64}$/.test(String(tid || ''))) throw fail(400, '전환 요청 id가 필요해요');
    const dup = r.turns.find(t => t.id === tid);
    if (dup){
      if (dup.handoff?.from_turn !== turn_id || dup.provider !== provider || dup.handoff.target_model !== model || dup.effort !== effort) throw fail(409, '같은 요청 id로 다른 전환을 보냈어요');
      return dup;
    }
    if (switching.has(key)) throw fail(409, '이 대화를 다른 AI로 넘기는 중이에요');
    switching.add(key);
    try {
      await need(p);
      const chosen = await selection(provider, model, effort);
      if (chosen.blocked) throw fail(409, '선택한 AI도 대기 중이에요. 사용할 수 있는 AI를 고른 뒤 다시 눌러 주세요');
      const source = r.turns.find(t => t.id === turn_id);
      if (!source || source.continued_by || !['queued', 'waiting'].includes(source.status)) throw fail(409, '대기 중인 요청만 다른 AI로 이어갈 수 있어요');
      if (source.attachments?.length && !chosen.input_images) throw fail(409, '첨부파일을 읽을 수 있는 Claude·GPT로 골라 주세요. AI 서버 업데이트·다시 켜기가 필요할 수 있어요');
      const from = source.provider || 'claude';
      if (from === provider) throw fail(400, '이미 같은 AI의 요청이에요');
      const history = r.turns.slice(0, r.turns.indexOf(source) + 1).map(t => {
        const progress = (t.log || []).slice(-20).map(l => `${l.tool || l.kind}: ${clip(l.text, 800)}`).join('\n');
        return `사용자 지시:\n${t.text}\nAI 답변:\n${clip(t.reply || '', 6000)}${t.summary ? `\n요약: ${t.summary.q || ''} / ${t.summary.a || ''}` : ''}${progress ? `\n최근 진행:\n${progress}` : ''}`;
      }).join('\n\n---\n\n');
      const context = history.length > 160000 ? `${history.slice(0, 60000)}\n[중간 기록 생략: 원래 대화와 파일을 확인하세요]\n${history.slice(-100000)}` : history;
      const prompt = `다른 AI가 진행하다 대기 중이던 요청을 이어받습니다. 아래의 원래 사용자 지시와 제한을 유지하세요. 먼저 현재 작업 폴더의 파일·git 상태와 진행 기록을 확인하고, 이미 끝낸 일을 반복하지 말고 남은 작업만 마무리하세요. 이전 AI의 내부 세션은 전달되지 않으므로 기록에서 확인할 수 없는 것은 파일에서 확인하세요.\n\n${context}`;
      if (source.job){
        const conn = readConf().ai;
        const live = (await ai(conn, `/v1/jobs/${source.job}`)).job;
        if (!['waiting', 'queued'].includes(live?.status)) throw fail(409, '이미 실행 중이거나 끝난 작업이에요. 대기 중일 때만 다른 AI로 넘길 수 있어요');
        let stopped = (await ai(conn, `/v1/jobs/${source.job}?idle_only=1`, { method: 'DELETE' })).job;
        // idle_only를 아직 모르는 서버와도 호환: 삭제 직전 실행이 시작됐어도 종료 확인 전에는 새 AI를 부르지 않는다.
        for (let checks = 0; stopped && !FINAL.has(stopped.status) && checks < 50; checks++){
          await new Promise(resolve => setTimeout(resolve, 200));
          stopped = (await ai(conn, `/v1/jobs/${source.job}`)).job;
        }
        if (stopped?.status !== 'canceled') throw fail(409, '기존 요청의 중단을 확인하지 못해 다른 AI를 시작하지 않았어요');
        applyJob(r, source, stopped);
      }
      Object.assign(source, { status: 'canceled', finished: now(), pending: [], until: null, continued_by: tid });
      note(source, '다른 AI로 이어서 실행하도록 대기 요청을 취소했어요');
      const t = { id: tid, text: source.text, attachments:source.attachments || [], provider, model, effort, status: 'queued', created: now(), started: null, finished: null, job: null, reply: '', log: [], pending: [], error: null, until: null,
        handoff: { from_turn: source.id, from_provider: from, from_job: source.job, target_model: model, prompt } };
      r.turns.splice(r.turns.indexOf(source) + 1, 0, t);
      r.updated = r.read = now(); touch(p, true);
      return t;
    } finally { switching.delete(key); pump(p); }
  }
  async function answer(p, id, { request_id, allow, input } = {}){
    const r = roomOf(p, id), t = r.turns.find(t => (t.pending || []).some(q => q.id === request_id));
    if (!t) throw fail(409, '이미 답했거나 끝난 확인 요청이에요');
    const conn = readConf().ai; if (!conn) throw fail(409, '이 pkm 서버에 AI 연결이 없어요');
    const j = (await ai(conn, `/v1/jobs/${t.job}/answer`, { method: 'POST', body: JSON.stringify({ request_id, allow: allow === true, input: input && typeof input === 'object' ? input : undefined, message: allow ? '' : '사용자가 채팅에서 거절했어요' }) })).job;
    const q = t.pending.find(q => q.id === request_id);
    note(t, allow ? `허락함 · ${q.title || q.tool}` : `거절함 · ${q.title || q.tool}`);
    applyJob(r, t, j); emit(p, r, t); touch(p, true);
    return t;
  }

  const running = new Set();   // 프로필|방 — 방마다 한 번에 하나
  function pump(p){
    for (const r of state(p).rooms){
      const k = `${p}|${r.id}`;
      if (running.has(k) || switching.has(k)) continue;
      const t = r.turns.find(t => ['running', 'waiting'].includes(t.status) && t.job) || r.turns.find(t => t.id === r.priority_turn && t.status === 'queued') || r.turns.find(t => t.status === 'queued');
      if (!t) continue;
      if (t.id === r.priority_turn) delete r.priority_turn;
      running.add(k);
      run(p, r, t).catch(e => { Object.assign(t, { status: 'error', error: clip(e.message, 500), finished: now(), pending: [] }); emit(p, r, t); touch(p); })
        .finally(() => { running.delete(k); if (state(p).rooms.includes(r)) pump(p); });
    }
  }

  // 알림(server/push.js) — 말마다 한 번씩만: 새 확인 요청, 시작, 끝(답·멈춤). 기록에 남겨 서버를 다시 켜도 또 보내지 않는다
  function emit(p, r, t){
    if (!onPush) return;
    const pu = t.pushed || (t.pushed = {}), name = r.kind === 'data' ? '데이터 관리' : r.card ? r.card.title : r.id;
    const say = (kind, title, body) => Promise.resolve().then(() => onPush(p, { kind, title, body: clip(body, 160), room: r.id, tag: `${r.id}:${t.id}`, url: `/?chat=${encodeURIComponent(r.id)}&profile=${encodeURIComponent(p)}` })).catch(() => {});
    const fresh = (t.pending || []).filter(q => !(pu.ask || []).includes(q.id));
    if (fresh.length){
      pu.ask = [...(pu.ask || []), ...fresh.map(q => q.id)].slice(-20);
      const q = fresh[0], inp = q.input || {};
      say('ask', `답해 주세요 · ${name}`, q.tool === 'AskUserQuestion' ? `질문이 있어요 — ${(inp.questions && inp.questions[0] && inp.questions[0].question) || '열어서 골라 주세요'}`
        : `허락이 필요해요 — ${q.description || inp.command || inp.file_path || q.title || q.tool}`);
    }
    if (!pu.run && ['running', 'waiting'].includes(t.status)){ pu.run = true; say('run', `시작했어요 · ${name}`, t.text); }
    if (!pu.end && (t.status === 'done' || t.status === 'error')){
      pu.end = pu.run = true;
      if (t.status === 'done') say('done', `답이 왔어요 · ${name}`, (t.summary && t.summary.a) || t.reply || '끝났어요');
      else say('done', `멈췄어요 · ${name}`, `${clip(t.error || '', 100)} 열어서 다시 보내 주세요`.trim());
    }
  }
  function note(t, text){ t.log.push({ at: now(), kind: 'note', text: clip(text, 300) }); if (t.log.length > KEEP_LOG) t.log.splice(0, t.log.length - KEEP_LOG); }
  function applyJob(r, t, j){
    if (FINAL.has(t.status) && !FINAL.has(j.status)) return;   // 중단 뒤 늦게 온 진행 이벤트로 되살리지 않는다
    t.provider = j.provider || t.provider || 'claude';
    if (j.result?.model) t.model = j.result.model;
    if (j.session){ r.session = j.session; r.sessionProvider = t.provider; }   // 중간에 멈춰도 같은 AI 세션에서 이어 가게
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
      t.status = 'running'; t.started = now(); touch(p);
      const pl = await need(p), provider = t.provider || 'claude', chosen = await selection(provider, t.model || 'default', t.effort || null), ctx = await context(p, pl, r);
      const mode = ctx.mode === 'full' && !chosen.agent.modes.includes('full') ? 'auto' : ctx.mode;
      const changed = r.session && (r.sessionProvider || 'claude') !== provider;
      if (changed){ r.session = null; r.carry = true; }
      if (t.handoff){ r.session = null; r.carry = false; }
      const prof = path.join(DATA, p);
      const agent = isWork(r) ? { cwd: r.cwd || prof, add_dirs: r.cwd ? [prof] : [] } : { cwd: r.cwd, add_dirs: [DATA] };
      Object.assign(agent, { mode, ...(chosen.agent.approvals ? { approvals: true } : {}), ...(r.session ? { session: r.session } : {}) });
      Object.assign(t, { status: 'running', started: now(), mode });
      if (mode !== ctx.mode) note(t, 'pkm-ai-server가 full 모드를 허용하지 않아 자동 권한 모드로 해요');
      let prompt = t.immediate?.prompt || t.handoff?.prompt || t.text || '첨부한 사진·영상의 내용을 설명해 주세요.';
      if (r.carry && !r.session && !t.immediate){   // AI·작업 폴더를 바꾼 새 세션은 앞선 대화로 맥락을 잇는다
        const prev = r.turns.filter(x => x !== t && x.status === 'done').slice(-6).map(x => `사용자: ${clip(x.text, 600)}\nAI: ${clip(x.reply, 1200)}`).join('\n\n');
        if (prev) prompt = `(${changed ? 'AI를 바꿔' : `작업 폴더를 ${r.cwd || '고르지 않음'}(으)로 바꿔`} 새로 시작해요. 앞선 대화:\n${prev}\n)\n\n${t.text}`;
      }
      const attached = media.resolve(p, r.id, [...new Set([...(t.attachments || []), ...(t.immediate?.attachments || [])].map(a => a.id))]);
      if (attached.images.length && !['claude', 'codex'].includes(provider)) throw fail(400, '첨부파일은 Claude 또는 GPT에서 읽을 수 있어요');
      if (attached.images.length && !chosen.input_images) throw fail(409, '이미지 입력을 지원하는 pkm-ai-server로 업데이트·다시 켜 주세요');
      if (attached.text) prompt += `\n\n첨부 이미지 순서:\n${attached.text}`;
      const body = { plugin: { id: pl.id, root: pl.path }, provider, model: t.model || 'default', ...(t.effort ? { effort: t.effort } : {}), ...(attached.images.length ? { images:attached.images.map(({ path, mime }) => ({ path, mime })) } : {}), prompt, system: ctx.system, tag: `plugin:${pl.id}`, agent };
      const j = (await ai(conn, '/v1/jobs', { method: 'POST', body: JSON.stringify(body) })).job;
      r.carry = false;
      t.job = j.id; applyJob(r, t, j); emit(p, r, t); touch(p, true);
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
            if (ev.type === 'status'){ applyJob(r, t, ev.job); emit(p, r, t); touch(p, FINAL.has(t.status) || !!t.pending.length); }
            else if (ev.type === 'text' && ev.text){ const x = splitSummary(ev.text).text; if (x.trim()) t.log.push({ at: now(), kind: 'text', text: clip(x, 4000) }); touch(p); }
            else if (ev.type === 'tool'){ t.log.push({ at: now(), kind: 'tool', tool: clip(ev.tool, 60), text: clip(ev.summary, 300) }); touch(p); }
            if (t.log.length > KEEP_LOG) t.log.splice(0, t.log.length - KEEP_LOG);
          }
        }
      } catch (e) { if (e.status === 404){ Object.assign(t, { status: 'error', error: 'AI 서버에서 이 작업을 찾지 못했어요', finished: now(), pending: [] }); emit(p, r, t); touch(p); return; } }
      if (FINAL.has(t.status)) break;
      try { applyJob(r, t, (await ai(conn, `/v1/jobs/${t.job}`)).job); emit(p, r, t); touch(p); } catch {}
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
  return { status, room, open, remove, reset, send, handoff, cancel, cancelTurn, runNow, answer, setCwd, setMemo, markRead, dirs, start, locality, forget, upload, attachment };
}
