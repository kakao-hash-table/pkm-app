// 구글 캘린더 양방향 동기화 — 약속(03_행동/약속보드) ↔ 구글 캘린더 일정. 의존성 없음.
// 연결: 내 구글 클라우드 프로젝트의 OAuth 클라이언트(데스크톱 앱)로 로그인 → refresh token을 ~/.pkm-app/gcal.json(0600)에 둔다.
//   데이터 폴더는 GitHub로 올라갈 수 있어 토큰을 절대 그 안에 두지 않는다.
// 맞추는 것: 제목·시작·끝·장소. 메모는 pkm에만, 참석자는 캘린더 → pkm으로만(남에게 초대 메일이 가지 않게).
// 하루 종일 일정은 가져오지 않는다(약속은 시각이 있는 일).
// 충돌하면 캘린더 쪽이 이긴다. 연결하기 전에 만든 약속은 캘린더로 보내지 않는다(처음 동기화 때 목록을 적어 둔다).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const HOME = process.env.PKM_APP_HOME ? path.resolve(process.env.PKM_APP_HOME) : path.join(os.homedir(), '.pkm-app');
const STORE = path.join(HOME, 'gcal.json');
const AUTH_URL = process.env.PKM_GCAL_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = process.env.PKM_GCAL_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const REVOKE_URL = process.env.PKM_GCAL_REVOKE_URL || 'https://oauth2.googleapis.com/revoke';
const API = process.env.PKM_GCAL_API || 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'openid email https://www.googleapis.com/auth/calendar.events';
const PAST_DAYS = 30, FUTURE_DAYS = 180;   // 이 기간의 일정만 맞춘다
const MAX_REMOTE_DELETES = 10;             // 한 번에 이보다 많이 지워야 하면 멈추고 알린다

const err = (msg, extra) => Object.assign(new Error(msg), extra || {});

/* ---------- 저장(토큰·연결 상태) ---------- */
function load(){ try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return { client:null, profiles:{} }; } }
function persist(s){
  fs.mkdirSync(HOME, { recursive:true, mode:0o700 });
  const tmp = `${STORE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode:0o600 }); fs.renameSync(tmp, STORE);
}

/* ---------- 시각 변환: pkm은 'YYYY-MM-DDTHH:MM'(이 컴퓨터 시간대) ---------- */
const p2 = n => String(n).padStart(2, '0');
const localStr = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const TZ = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
const toGoogle = s => ({ dateTime:`${s.length === 16 ? s + ':00' : s}`, timeZone:TZ() });
const timed = ev => !!(ev.start && ev.start.dateTime && ev.end && ev.end.dateTime);
const fields = a => JSON.stringify([a.title, a.start, a.end, a.location || '']);
const newId = () => 'a' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');

function fromEvent(ev){
  return {
    title:ev.summary || '(제목 없음)', start:localStr(new Date(ev.start.dateTime)), end:localStr(new Date(ev.end.dateTime)),
    location:ev.location || '', attendees:(ev.attendees || []).filter(x => !x.self && !x.resource).map(x => x.displayName || x.email).filter(Boolean),
  };
}
const toEvent = a => ({ summary:a.title, location:a.location || '', start:toGoogle(a.start), end:toGoogle(a.end) });

export function createGcal({ MD, read, write, redirectUri, log = () => {} }){
  const pending = new Map();   // OAuth state → { profile, verifier, at }
  const tokens = {};           // 프로필 → { token, exp }
  const RUN = {};              // 프로필 → { running, again, timer }

  const client = () => load().client;
  const entry = p => load().profiles[p] || null;
  function update(p, fn){ const s = load(); s.profiles[p] = fn(s.profiles[p] || null); if (!s.profiles[p]) delete s.profiles[p]; persist(s); return s.profiles[p]; }

  async function form(url, params){
    const r = await fetch(url, { method:'POST', headers:{ 'content-type':'application/x-www-form-urlencoded' }, body:new URLSearchParams(params) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw err(b.error_description || b.error || `구글 응답 ${r.status}`, { status:r.status, code:b.error });
    return b;
  }

  /* ---------- 연결 ---------- */
  function setClient({ client_id, client_secret }){
    const id = String(client_id || '').trim(), secret = String(client_secret || '').trim();
    if (!id || !secret) throw err('클라이언트 ID와 보안 비밀번호를 모두 적어 주세요', { status:400 });
    const s = load(); s.client = { id, secret }; persist(s);
  }
  function connectUrl(p){
    const c = client(); if (!c) throw err('먼저 구글 OAuth 클라이언트를 등록해 주세요', { status:400 });
    const state = crypto.randomBytes(16).toString('hex'), verifier = crypto.randomBytes(32).toString('base64url');
    pending.set(state, { profile:p, verifier, at:Date.now() });
    for (const [k, v] of pending) if (Date.now() - v.at > 600000) pending.delete(k);
    const q = new URLSearchParams({ client_id:c.id, redirect_uri:redirectUri(), response_type:'code', scope:SCOPE, access_type:'offline', prompt:'consent', include_granted_scopes:'true',
      state, code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256' });
    return `${AUTH_URL}?${q}`;
  }
  async function callback({ code, state, error }){
    if (error) throw err(error === 'access_denied' ? '구글에서 허용하지 않았어요' : `구글 오류: ${error}`);
    const pend = pending.get(state); pending.delete(state);
    if (!pend) throw err('연결 요청이 만료됐어요. pkm에서 다시 연결해 주세요');
    const c = client();
    const t = await form(TOKEN_URL, { code, client_id:c.id, client_secret:c.secret, redirect_uri:redirectUri(), grant_type:'authorization_code', code_verifier:pend.verifier });
    if (!t.refresh_token) throw err('구글이 갱신 토큰을 주지 않았어요. 구글 계정의 연결된 앱에서 pkm을 지운 뒤 다시 연결해 주세요');
    let email = '';
    try { email = JSON.parse(Buffer.from(String(t.id_token).split('.')[1], 'base64url').toString('utf8')).email || ''; } catch {}
    tokens[pend.profile] = { token:t.access_token, exp:Date.now() + (t.expires_in - 60) * 1000 };
    update(pend.profile, () => ({ refresh_token:t.refresh_token, email, calendar:'primary', connected_at:new Date().toISOString(), map:null, skip:[], last:null, error:null }));
    log(`${pend.profile}: 구글 캘린더 연결 (${email || '계정 확인 안 됨'})`);
    sync(pend.profile).catch(() => {});
    return { profile:pend.profile, email };
  }
  async function disconnect(p){
    const e = entry(p); if (!e) return;
    form(REVOKE_URL, { token:e.refresh_token }).catch(() => {});   // 구글 쪽 권한도 거둔다(실패해도 이 컴퓨터에서는 지운다)
    delete tokens[p]; update(p, () => null);
  }

  /* ---------- 구글 API ---------- */
  async function accessToken(p){
    const t = tokens[p]; if (t && t.exp > Date.now()) return t.token;
    const e = entry(p), c = client(); if (!e || !c) throw err('연결돼 있지 않아요');
    try {
      const r = await form(TOKEN_URL, { client_id:c.id, client_secret:c.secret, refresh_token:e.refresh_token, grant_type:'refresh_token' });
      tokens[p] = { token:r.access_token, exp:Date.now() + (r.expires_in - 60) * 1000 };
      return r.access_token;
    } catch (x) {
      if (x.code === 'invalid_grant') throw err('구글 연결이 풀렸어요. 다시 연결해 주세요', { reconnect:true });
      throw x;
    }
  }
  async function call(p, method, rel, body){
    const token = await accessToken(p);
    const r = await fetch(`${API}${rel}`, { method, headers:{ authorization:`Bearer ${token}`, ...(body ? { 'content-type':'application/json' } : {}) }, body:body ? JSON.stringify(body) : undefined });
    if (r.status === 204) return null;
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw err((b.error && b.error.message) || `구글 캘린더 응답 ${r.status}`, { status:r.status });
    return b;
  }
  async function listEvents(p, cal, timeMin, timeMax){
    const out = []; let pageToken = '';
    do {
      const q = new URLSearchParams({ singleEvents:'true', showDeleted:'true', maxResults:'2500', timeMin, timeMax, ...(pageToken ? { pageToken } : {}) });
      const b = await call(p, 'GET', `/calendars/${encodeURIComponent(cal)}/events?${q}`);
      out.push(...(b.items || [])); pageToken = b.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  /* ---------- 동기화 ---------- */
  async function syncOnce(p){
    const e = entry(p); if (!e) return null;
    const cal = e.calendar || 'primary';
    const files = await read(p), P = MD.parse(files), D = P.db;
    const folder = (P.settings.folders && P.settings.folders.appointment) || MD.DEFAULT_FOLDERS.appointment;
    const now = Date.now(), from = new Date(now - PAST_DAYS * 864e5), to = new Date(now + FUTURE_DAYS * 864e5);
    const inWindow = s => s && s >= localStr(from) && s <= localStr(to);
    const remote = await listEvents(p, cal, from.toISOString(), to.toISOString());
    const byRemote = new Map(remote.map(ev => [ev.id, ev]));
    const byLocal = new Map(D.appts.filter(a => a.gcal_id).map(a => [a.gcal_id, a]));
    const first = !e.map, map = e.map || {}, skip = new Set(first ? D.appts.filter(a => !a.gcal_id).map(a => a.id) : e.skip || []);
    const n = { pulled:0, pushed:0, removedLocal:0, removedRemote:0, failed:[] };

    // 로컬 약속을 하나도 못 읽었는데 연결된 일정이 많다면 읽기 문제로 보고 캘린더에서 지우지 않는다
    const suspicious = !D.appts.length && Object.keys(map).length > 3;
    const toRemoveRemote = Object.keys(map).filter(gid => !byLocal.has(gid) && byRemote.get(gid) && byRemote.get(gid).status !== 'cancelled');
    const blockDeletes = suspicious || toRemoveRemote.length > MAX_REMOTE_DELETES;
    if (blockDeletes) n.failed.push(`pkm에서 지운 약속 ${toRemoveRemote.length}개를 캘린더에서 지우지 않았어요(한 번에 너무 많아서). 확인 뒤 캘린더에서 직접 지워 주세요`);

    for (const [gid, m] of Object.entries(map)){
      const a = byLocal.get(gid), ev = byRemote.get(gid);
      const gone = ev ? ev.status === 'cancelled' : !!(a && inWindow(a.start));
      if (!ev && !gone && a) continue;                      // 기간 밖 — 그대로 둔다
      if (!a){                                              // pkm에서 지움 → 캘린더에서도
        if (ev && !gone){
          if (blockDeletes) continue;
          try { await call(p, 'DELETE', `/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(gid)}?sendUpdates=none`); n.removedRemote++; }
          catch (x) { if (![404, 410].includes(x.status)){ n.failed.push(`${ev.summary || gid}: ${x.message}`); continue; } }
        }
        delete map[gid]; continue;
      }
      if (gone){ D.appts = D.appts.filter(x => x !== a); delete map[gid]; n.removedLocal++; continue; }   // 캘린더에서 지움 → pkm에서도(휴지통)
      if (!timed(ev)) continue;
      if (ev.updated !== m.updated){ Object.assign(a, fromEvent(ev)); map[gid] = { updated:ev.updated, hash:fields(a) }; n.pulled++; }
      else if (fields(a) !== m.hash){
        try { const r = await call(p, 'PATCH', `/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(gid)}?sendUpdates=none`, toEvent(a)); map[gid] = { updated:r.updated, hash:fields(a) }; n.pushed++; }
        catch (x) { n.failed.push(`${a.title}: ${x.status === 403 ? '내가 만든 일정이 아니라 캘린더에 반영하지 못했어요' : x.message}`); map[gid] = { ...m, hash:fields(a) }; }
      }
    }
    for (const ev of remote){                               // 캘린더에 새로 생긴 일정 → pkm 약속
      if (ev.status === 'cancelled' || !timed(ev) || map[ev.id]) continue;
      const a = byLocal.get(ev.id);
      if (a){ Object.assign(a, fromEvent(ev)); map[ev.id] = { updated:ev.updated, hash:fields(a) }; continue; }   // 다시 연결한 경우
      const na = { id:newId(), ...fromEvent(ev), gcal_id:ev.id, memo:'' };
      D.appts.push(na); map[ev.id] = { updated:ev.updated, hash:fields(na) }; n.pulled++;
    }
    for (const a of D.appts){                               // pkm에서 새로 만든 약속 → 캘린더
      if (a.gcal_id || skip.has(a.id) || !a.start || !a.end || a.end <= a.start) continue;
      try { const r = await call(p, 'POST', `/calendars/${encodeURIComponent(cal)}/events?sendUpdates=none`, toEvent(a)); a.gcal_id = r.id; map[r.id] = { updated:r.updated, hash:fields(a) }; n.pushed++; }
      catch (x) { n.failed.push(`${a.title}: ${x.message}`); }
    }

    const next = MD.serialize(P), ch = MD.diff(files, next);
    const mine = rel => rel.startsWith(folder + '/');        // 약속 폴더 밖 파일은 건드리지 않는다
    const writes = Object.fromEntries(Object.entries(ch.writes).filter(([rel]) => mine(rel))), deletes = ch.deletes.filter(mine);
    if (Object.keys(writes).length || deletes.length) await write(p, { writes, deletes });
    update(p, cur => cur && { ...cur, map, skip:[...skip], last:new Date().toISOString(), error:n.failed.length ? n.failed.join(' · ') : null, result:n });
    if (n.pulled || n.pushed || n.removedLocal || n.removedRemote) log(`${p}: 구글 캘린더 가져옴 ${n.pulled} · 보냄 ${n.pushed} · pkm에서 지움 ${n.removedLocal} · 캘린더에서 지움 ${n.removedRemote}`);
    return n;
  }
  async function sync(p){
    const r = RUN[p] || (RUN[p] = {});
    if (r.running){ r.again = true; return r.promise; }
    r.running = true;
    r.promise = (async () => {
      try { do { r.again = false; await syncOnce(p); } while (r.again); }
      catch (x) { update(p, cur => cur && { ...cur, error:x.message, last:new Date().toISOString(), reconnect:!!x.reconnect }); }
      finally { r.running = false; }
    })();
    return r.promise;
  }
  function schedule(p, ms = 3000){
    if (!entry(p)) return;
    const r = RUN[p] || (RUN[p] = {});
    clearTimeout(r.timer); r.timer = setTimeout(() => sync(p).catch(() => {}), ms);
  }
  function status(p){
    const e = entry(p);
    return { client:!!client(), redirect:redirectUri(), connected:!!e, email:e?.email || '', calendar:e?.calendar || 'primary', last:e?.last || null, error:e?.error || null,
      reconnect:!!e?.reconnect, skipped:e?.skip?.length || 0, running:!!RUN[p]?.running, result:e?.result || null };
  }
  const connectedProfiles = () => Object.keys(load().profiles || {});

  return { setClient, connectUrl, callback, disconnect, sync, schedule, status, connectedProfiles, HOME };
}
