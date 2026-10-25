/* AI 연결 — 내 컴퓨터에 띄운 pkm-ai-server(https://github.com/kakao-hash-table/pkm-ai-server)에 요청을 보낸다.
   웹이 가진 것은 그 서버에 들어가는 접속 토큰뿐이고, Claude 같은 AI 서비스의 로그인 정보는 보지 못한다.
   연결과 고른 모델·한도는 기기마다 다르므로(서버 주소·토큰이 기기마다 다르다) 이 브라우저에만 둔다. */
(function (root) {
  'use strict';
  const K = 'pkm:v1:ai';
  const LS = {
    get(d){ try { const v = localStorage.getItem(K); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(v){ try { localStorage.setItem(K, JSON.stringify(v)); return true; } catch (e) { return false; } },
    clear(){ try { localStorage.removeItem(K); } catch (e) {} }
  };
  const CODE = 'pkmai1.';
  const err = (msg, extra) => Object.assign(new Error(msg), extra || {});
  const DEF_PREFS = () => ({ provider:null, model:'default', effort:null, pause_at:null, daily_max:null });   // pause_at: 사용률(0~1) 이상이면 쉰다 · daily_max: 하루 요청 수

  /* 연결 코드 = 'pkmai1.' + base64url(JSON { v:1, urls:[...], token }) — 서버의 `token create`가 만든다 */
  function parseCode(code){
    const s = String(code || '').trim();
    if (!s) throw err('연결 코드를 붙여 넣어 주세요');
    if (!s.startsWith(CODE)) throw err('연결 코드가 아니에요. pkm-ai-server token create로 만든, pkmai1.로 시작하는 줄을 붙여 넣어 주세요');
    let j;
    try { j = JSON.parse(decodeURIComponent(escape(atob(s.slice(CODE.length).replace(/-/g, '+').replace(/_/g, '/'))))); }
    catch (e) { throw err('연결 코드가 잘렸거나 바뀌었어요. 한 줄 전체를 다시 복사해 주세요'); }
    if (!j || j.v !== 1 || !Array.isArray(j.urls) || !j.urls.length || typeof j.token !== 'string') throw err('연결 코드를 읽지 못했어요. 서버를 최신으로 받아 새로 만들어 주세요');
    return { urls:j.urls.map(u => String(u).replace(/\/+$/, '')), token:j.token };
  }

  const conn = () => { const c = LS.get(null); return c && c.url && c.token ? c : null; };
  const prefs = () => Object.assign(DEF_PREFS(), (LS.get(null) || {}).prefs || {});
  function setPrefs(p){ const c = conn(); if (!c) return; c.prefs = Object.assign(prefs(), p); LS.set(c); }

  async function call(path, opt = {}, c = conn()){
    if (!c) throw err('AI 서버에 연결돼 있지 않아요', { code:'none' });
    let r;
    try { r = await fetch(c.url + path, { ...opt, headers:{ authorization:`Bearer ${c.token}`, ...(opt.body ? { 'content-type':'application/json' } : {}), ...(opt.headers || {}) } }); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      throw err(`AI 서버(${c.url})에 닿지 않아요. 그 컴퓨터에서 pkm-ai-server가 켜져 있는지 확인해 주세요`, { code:'offline' });
    }
    if (opt.raw && r.ok) return r;
    const b = await r.json().catch(() => ({}));
    if (r.status === 401) throw err('접속 토큰이 맞지 않아요. 서버에서 지웠다면 새 연결 코드로 다시 연결해 주세요', { code:'token', status:401 });
    if (r.status === 403) throw err(b.error || '이 웹 주소는 AI 서버의 허용 목록에 없어요', { code:'origin', status:403 });
    if (!r.ok) throw err(b.error || `AI 서버 오류(${r.status})`, { status:r.status });
    return b;
  }

  /* 연결 코드의 주소를 차례로 시험해 처음 닿는 곳을 쓴다(집 맥 로컬 주소, Tailscale 주소 등) */
  async function connect(code){
    const { urls, token } = parseCode(code);
    let last = null;
    for (const url of urls){
      try {
        const b = await call('/v1/providers', {}, { url, token });
        const old = LS.get(null) || {};
        LS.set({ url, urls, token, connected:new Date().toISOString(), prefs:Object.assign(DEF_PREFS(), old.prefs || {}) });
        return { url, providers:b.providers };
      } catch (e) { last = e; if (e.code !== 'offline') break; }
    }
    throw last;
  }
  const disconnect = () => LS.clear();

  /* 저장된 주소가 안 닿으면 연결 코드의 다른 주소로 옮겨 본다 */
  async function providers(refresh){
    const c = conn();
    try { return (await call(`/v1/providers${refresh ? '?refresh=1' : ''}`)).providers; }
    catch (e) {
      if (e.code !== 'offline' || !c || !c.urls || c.urls.length < 2) throw e;
      for (const url of c.urls.filter(u => u !== c.url)){
        try { const b = await call('/v1/providers', {}, { ...c, url }); LS.set({ ...c, url }); return b.providers; } catch (e2) {}
      }
      throw e;
    }
  }
  const usage = () => call('/v1/usage');

  /* 사용률은 0~1. 서버(CLI)가 0~100으로 주면 맞춘다 */
  const ratio = v => v == null ? null : v > 1 ? v / 100 : v;
  function windows(p){
    const w = (p && p.usage && p.usage.windows) || {};
    return Object.entries(w).map(([k, v]) => ({ key:k, used:ratio(v.used), resets_at:v.resets_at || null }));
  }

  /* 내가 정한 한도로 지금 쉬어야 하는지 — 쉬어야 하면 이유, 아니면 null. 서버가 막은 상태(한도·로그인)도 함께 본다 */
  function guard(p, pr = prefs(), now = Date.now()){
    if (!p) return '쓸 AI를 골라 주세요';
    if (!p.installed) return `${p.via}가 그 컴퓨터에 없어요`;
    if (!p.logged_in) return `${p.via}에 로그인돼 있지 않아요`;
    if (p.blocked) return p.blocked.reason === 'login' ? `${p.via} 로그인이 풀려 기다리는 중이에요` : `${p.label} 사용 한도에 걸려 기다리는 중이에요`;
    // 리셋 시각이 지난 창은 빼야 한다 — 쉬는 동안엔 요청이 없어 사용률이 갱신되지 않으므로, 빼지 않으면 영영 쉰다
    if (pr.pause_at != null){ const hi = windows(p).find(w => w.used != null && w.used >= pr.pause_at && !(w.resets_at && w.resets_at <= now)); if (hi) return `사용률이 정해 둔 ${Math.round(pr.pause_at * 100)}%를 넘었어요`; }
    if (pr.daily_max != null && p.today && p.today.requests >= pr.daily_max) return `오늘 요청이 정해 둔 ${pr.daily_max}회에 닿았어요`;
    return null;
  }

  /* 요청 하나 — 고른 AI·모델·effort로 보내고 끝날 때까지 진행 상황을 받는다. 결과는 서버의 job 그대로(status·result·error) */
  async function run({ prompt, system, json_schema, tag, onText, onStatus, signal, force } = {}){
    const pr = prefs(), list = await providers(), p = list.find(x => x.id === pr.provider) || null;
    const why = force ? null : guard(p, pr);
    if (why) throw err(why, { code:'guard' });
    const body = { provider:p.id, prompt, system, json_schema, tag, wait:0 };
    if (pr.model && pr.model !== 'default') body.model = pr.model;
    if (pr.effort && p.efforts.includes(pr.effort)) body.effort = pr.effort;
    let job = (await call('/v1/jobs', { method:'POST', body:JSON.stringify(body), signal })).job;
    if (signal) signal.addEventListener('abort', () => { call(`/v1/jobs/${job.id}`, { method:'DELETE' }).catch(() => {}); }, { once:true });
    const r = await call(`/v1/jobs/${job.id}/events`, { raw:true, signal });
    const rd = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;){
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream:true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0){
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split('\n').find(l => l.startsWith('data: ')); if (!line) continue;
        let ev; try { ev = JSON.parse(line.slice(6)); } catch (e) { continue; }
        if (ev.type === 'text' && onText) onText(ev.text);
        else if (ev.type === 'status'){ job = ev.job; if (onStatus) onStatus(job); }
      }
    }
    return job;
  }

  root.PKMAI = { parseCode, conn, prefs, setPrefs, connect, disconnect, providers, usage, windows, guard, run, ratio };
})(typeof self !== 'undefined' ? self : this);
