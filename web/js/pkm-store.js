/* 저장소 — 파일 지도({경로: 마크다운})를 어디에 두는지만 다룬다. 형식은 pkm-md.js.
   server : 로컬 서버(npm start·scripts/serve.sh)로 열었을 때. 데이터 폴더의 <프로필>/ 파일에 바로 쓴다(storage: github 이면 서버가 git 커밋·푸시).
   github : 서버 없이(정적 웹으로) 열었을 때. 내 저장소의 프로필 폴더(<프로필>/ 또는 data/<프로필>/)에 GitHub API로 직접. 토큰은 이 브라우저에만.
   노트를 브라우저에 저장하는 방식은 두지 않는다 — 기기마다 갈라지고 지우면 사라지기 때문. */
(function (root) {
  'use strict';
  const LS = {
    get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const K = { gh:'pkm:v1:github', repo:'pkm:v1:gh-repo', shas:p => `pkm:v1:gh-sha:${p}`, prefix:p => `pkm:v1:gh-prefix:${p}` };
  const err = (msg, extra) => Object.assign(new Error(msg), extra || {});

  /* ---------- 로컬 서버 ---------- */
  const server = {
    kind:'server',
    async json(path, opt){
      const r = await fetch(path, opt);
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw err(b.error || `서버 오류(${r.status})`, { status:r.status });
      return b;
    },
    async profiles(){ return (await this.json('/api/profiles')).profiles; },
    async load(p){ return this.json(`/api/profile/${encodeURIComponent(p)}`); },
    async version(p){ return this.json(`/api/profile/${encodeURIComponent(p)}/version`); },
    async save(p, change){ return this.json(`/api/profile/${encodeURIComponent(p)}/save`, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(change) }); },
    async create(name){ await this.json('/api/profiles', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ name }) }); },
    async syncNow(p){ return this.json(`/api/profile/${encodeURIComponent(p)}/sync`, { method:'POST' }); }
  };

  /* ---------- GitHub (브라우저에서 직접) ---------- */
  const b64e = s => btoa(unescape(encodeURIComponent(s)));
  const b64d = s => decodeURIComponent(escape(atob(String(s).replace(/\n/g, ''))));
  const github = {
    kind:'github',
    auth(){ return LS.get(K.gh, null); },                       // { token, login }
    repo(){ return LS.get(K.repo, ''); },
    setRepo(r){ LS.set(K.repo, r); },
    ready(){ return !!(this.auth() && this.repo()); },
    async connect(token){
      const r = await fetch('https://api.github.com/user', { headers:{ authorization:`Bearer ${token}`, accept:'application/vnd.github+json' } });
      if (!r.ok) throw err(r.status === 401 ? '토큰이 맞지 않거나 만료됐어요' : `GitHub에 연결하지 못했어요(${r.status})`);
      const u = await r.json(); LS.set(K.gh, { token, login:u.login }); return u.login;
    },
    disconnect(){ try { localStorage.removeItem(K.gh); localStorage.removeItem(K.repo); } catch (e) {} },
    async branch(repo){ return (await this.call(`/repos/${repo}`)).default_branch; },
    // 저장소에서 프로필 폴더를 찾는다: <이름>/_설정.md 또는 data/<이름>/_설정.md
    async profiles(){
      const repo = this.repo(), tree = await this.call(`/repos/${repo}/git/trees/${encodeURIComponent(await this.branch(repo))}?recursive=1`);
      const names = new Set();
      for (const x of tree.tree){ const m = x.type === 'blob' && x.path.match(/^(?:data\/)?([^/]+)\/_설정\.md$/); if (m && !/^[_.]/.test(m[1])) names.add(m[1]); }
      return [...names].sort().map(name => ({ name, storage:'github', repo }));
    },
    async version(){ const repo = this.repo(); return { version:(await this.call(`/repos/${repo}/git/trees/${encodeURIComponent(await this.branch(repo))}`)).sha }; },
    async create(name, files){ LS.set(K.prefix(name), `${name}/`); LS.set(K.shas(name), {}); await this.save(name, { writes:files, deletes:[] }); },
    async call(path, opt = {}){
      const a = this.auth(); if (!a) throw err('GitHub에 연결돼 있지 않아요');
      const r = await fetch(`https://api.github.com${path}`, { ...opt, headers:{ authorization:`Bearer ${a.token}`, accept:'application/vnd.github+json', 'content-type':'application/json', ...(opt.headers || {}) } });
      if (r.status === 409 || r.status === 422) throw err('다른 곳에서 먼저 고쳤어요. 최신 내용을 불러온 뒤 다시 저장해 주세요', { conflict:true });
      if (!r.ok) throw err(`GitHub 오류(${r.status})`, { status:r.status });
      return r.status === 204 ? {} : r.json();
    },
    async repos(){ return (await this.call('/user/repos?per_page=100&sort=updated')).map(x => ({ full:x.full_name, private:x.private })); },
    async load(p, repo = this.repo()){
      const branch = await this.branch(repo);
      const tree = await this.call(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
      // 로컬 서버와 같은 저장소를 쓸 수 있게, 프로필 폴더가 저장소 바로 아래(<프로필>/)인지 data/<프로필>/인지 찾는다. 없으면 바로 아래에 만든다.
      const has = pre => tree.tree.some(x => x.path === `${pre}_설정.md`);
      const pre = has(`${p}/`) ? `${p}/` : has(`data/${p}/`) ? `data/${p}/` : `${p}/`;
      LS.set(K.prefix(p), pre);
      const cache = LS.get(K.shas(p), {}), files = {}, shas = {};
      for (const t of tree.tree.filter(x => x.type === 'blob' && x.path.startsWith(pre) && x.path.endsWith('.md') && !x.path.includes('/.trash/'))){
        const rel = t.path.slice(pre.length);
        if (cache[rel] && cache[rel].sha === t.sha){ files[rel] = cache[rel].text; }
        else files[rel] = b64d((await this.call(`/repos/${repo}/git/blobs/${t.sha}`)).content);
        shas[rel] = { sha:t.sha, text:files[rel] };
      }
      LS.set(K.shas(p), shas);
      return { files, version:tree.sha, branch };
    },
    async save(p, { writes = {}, deletes = [] }, repo = this.repo()){
      const shas = LS.get(K.shas(p), {}), branch = await this.branch(repo), pre = LS.get(K.prefix(p), `${p}/`);
      for (const [rel, text] of Object.entries(writes)){
        const r = await this.call(`/repos/${repo}/contents/${encodeURI(`${pre}${rel}`)}`, { method:'PUT', body:JSON.stringify({ message:`pkm(${p}): ${rel}`, content:b64e(text), branch, ...(shas[rel] ? { sha:shas[rel].sha } : {}) }) });
        shas[rel] = { sha:r.content.sha, text };
      }
      for (const rel of deletes){
        if (!shas[rel]) continue;
        await this.call(`/repos/${repo}/contents/${encodeURI(`${pre}${rel}`)}`, { method:'DELETE', body:JSON.stringify({ message:`pkm(${p}): 휴지통 ${rel}`, sha:shas[rel].sha, branch }) });
        delete shas[rel];
      }
      LS.set(K.shas(p), shas);
      return this.version();
    }
  };

  async function detect(){
    if (document.documentElement.dataset.server !== '1') return github;
    try { await server.profiles(); return server; } catch (e) { return github; }
  }

  /* ---------- zip 내보내기(압축 없이 저장만 — 의존성 없이) ---------- */
  function crc32(buf){
    let c, crc = -1;
    for (let i = 0; i < buf.length; i++){ c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
    return (crc ^ -1) >>> 0;
  }
  function zip(files){
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for (const [name, text] of Object.entries(files)){
      const nb = enc.encode(name), db = enc.encode(text), crc = crc32(db);
      const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0)];
      parts.push(new Uint8Array(head), nb, db);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
      off += head.length + nb.length + db.length;
    }
    const csize = central.reduce((n, x) => n + x.length, 0), count = Object.keys(files).length;
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(csize), ...u32(off), ...u16(0)]);
    return new Blob([...parts, ...central, end], { type:'application/zip' });
  }

  root.PKMStore = { server, github, detect, zip, LS };
})(typeof self !== 'undefined' ? self : this);
