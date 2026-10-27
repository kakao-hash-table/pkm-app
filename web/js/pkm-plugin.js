/* pkm 플러그인 규격 검사 — 브라우저와 Node가 함께 쓴다. 규격 문서: docs/PLUGIN.md
   플러그인은 선언형이다. 마크다운(매니페스트·워크플로우·프롬프트)과 선언한 스크립트만 받고, 화면에서 실행되는 코드는 받지 않는다. */
(function (root){
  const MD = typeof module !== 'undefined' && module.exports ? require('./pkm-md.js') : root.PKMMD;
  const SPEC = 1;
  const DIR = '_플러그인';
  const MODES = ['read', 'auto', 'full'];
  const AI = ['chat', 'agent'];
  const DOC_EXT = /\.(md|json|ya?ml|txt)$/i, IMG_EXT = /\.(png|jpe?g|gif|webp)$/i, SCRIPT_EXT = /\.(mjs|cjs|js|sh|py)$/i;
  const LIMITS = { files: 200, file: 1024 * 1024, total: 5 * 1024 * 1024 };
  const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/, NAME_RE = /^[\w.-]{1,40}$/, KEY_RE = /^[a-z_][a-z0-9_]{0,40}$/, SECRET_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
  const SETTING_TYPES = ['text', 'lines', 'path', 'toggle'];
  const HOURS_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
  const ignored = p => p.split('/').some(s => s.startsWith('.')) || /(^|\/)(node_modules|__pycache__)\//.test(p);

  /* 워크플로우 문서: "## 이름" 아래 "- [키] 단계명 · 종류 [in 폴더]: 내용" (종류 = manual | ask | script | ai | agent(read|auto|full)). ask는 사람에게 글을 받는다(내용 = 예시 문구) */
  function parseWorkflows(text){
    const out = []; let cur = null, step = null;
    for (const line of String(text || '').split('\n')){
      const h = line.match(/^##\s+(.+?)\s*$/);
      if (h){ cur = { name: h[1], steps: [] }; out.push(cur); step = null; continue; }
      const m = line.match(/^-\s+\[([^\]]+)\]\s+(.+?)\s+·\s+(manual|ask|script|ai|agent)(?:\((read|auto|full)\))?(?:\s+in\s+(\S+?))?\s*(?::\s*(.*))?$/);
      if (m && cur){ step = { key: m[1].trim(), name: m[2].trim(), kind: m[3], mode: m[4] || null, cwd: m[5] || null, body: (m[6] || '').trim() }; cur.steps.push(step); continue; }
      if (step && /^\s{2,}\S/.test(line)) step.body += (step.body ? '\n' : '') + line.trim();   // 두 칸 들여 쓴 줄은 앞 단계 내용에 이어 붙인다
    }
    return out;
  }

  /* 피드 문서: "## 이름" 아래 "- 키: 값" 줄. 키 = run(필수) · every(분) · days(weekdays|daily) · hours(09:00-18:00) · start(워크플로우) · start_mode(auto|button) · empty. 다른 줄은 설명 */
  function parseFeeds(text){
    const out = []; let cur = null;
    for (const line of String(text || '').split('\n')){
      const h = line.match(/^##\s+(.+?)\s*$/);
      if (h){ cur = { name: h[1], description: '' }; out.push(cur); continue; }
      if (!cur) continue;
      const m = line.match(/^-\s+([a-z_]+):\s*(.*?)\s*$/);
      if (m) cur[m[1]] = m[2];
      else if (line.trim()) cur.description += (cur.description ? ' ' : '') + line.trim();
    }
    return out;
  }

  /* 검색·편집기 문서도 피드와 같은 꼴: "## 이름" 아래 "- 키: 값" 줄, 다른 줄은 설명 */
  const parseSearches = parseFeeds, parseEditors = parseFeeds;
  const startsOf = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  const reOk = v => { try { new RegExp(v); return true; } catch { return false; } };

  /* files: [{ path, size, text? }] — text는 문서·스크립트만. 돌려주는 값: { ok, manifest, workflows, scripts, errors, warnings } */
  function validate(files){
    const errors = [], warnings = [], err = m => errors.push(m), warn = m => warnings.push(m);
    const list = files.filter(f => !ignored(f.path));
    const byPath = Object.fromEntries(list.map(f => [f.path, f]));
    if (list.length > LIMITS.files) err(`파일이 너무 많아요(${LIMITS.files}개까지)`);
    if (list.reduce((n, f) => n + (f.size || 0), 0) > LIMITS.total) err('플러그인 전체가 5MB를 넘어요');
    for (const f of list) if ((f.size || 0) > LIMITS.file) err(`${f.path}: 1MB를 넘어요`);

    const mf = byPath['plugin.md'];
    if (!mf){ err('plugin.md가 없어요'); return { ok: false, manifest: null, workflows: [], scripts: [], errors, warnings }; }
    const doc = MD.parseDoc(mf.text || ''), fm = doc.fm || {};
    if (fm.pkm_plugin !== SPEC) err(`pkm_plugin이 ${SPEC}이어야 해요(지금 ${fm.pkm_plugin ?? '없음'})`);
    if (!ID_RE.test(String(fm.id || ''))) err('id는 소문자·숫자·-로 2~41자예요');
    if (!fm.name) err('name이 없어요');
    if (!/^\d+\.\d+\.\d+/.test(String(fm.version || ''))) err('version은 1.2.3 형식이에요');

    const perm = fm.permissions || {};
    const ai = Array.isArray(perm.ai) ? perm.ai.map(String) : [];
    for (const a of ai) if (!AI.includes(a)) err(`permissions.ai에 모르는 값: ${a}`);
    const mode = perm.agent_mode == null ? 'read' : String(perm.agent_mode);
    if (!MODES.includes(mode)) err(`permissions.agent_mode는 ${MODES.join(', ')}`);
    const scripts = (Array.isArray(perm.scripts) ? perm.scripts : []).map(String);
    for (const s of scripts) if (!NAME_RE.test(s)) err(`permissions.scripts 이름 형식이 맞지 않아요: ${s}`);
    const bundled = (Array.isArray(perm.bundled) ? perm.bundled : []).map(String);
    const secretsDecl = (Array.isArray(perm.secrets) ? perm.secrets : []).map(x => typeof x === 'string' ? { name: x } : x && typeof x === 'object' ? x : {});
    for (const x of secretsDecl) if (!SECRET_RE.test(String(x.name || ''))) err(`permissions.secrets 이름은 영문 대문자·숫자·_예요: ${x.name || JSON.stringify(x)}`);
    const secrets = secretsDecl.filter(x => SECRET_RE.test(String(x.name || ''))).map(x => ({ name: String(x.name), label: String(x.label || x.name), hint: x.hint ? String(x.hint) : '', url: /^https:\/\//.test(String(x.url || '')) ? String(x.url) : '' }));
    for (const b of bundled){
      if (!/^scripts\//.test(b) || !SCRIPT_EXT.test(b) || b.split('/').includes('..')) err(`가져오는 스크립트는 scripts/ 아래 .mjs·.js·.sh·.py여야 해요: ${b}`);
      else if (!byPath[b]) err(`선언한 스크립트 파일이 없어요: ${b}`);
    }
    const settings = (Array.isArray(fm.settings) ? fm.settings : []).filter(x => x && typeof x === 'object');
    for (const s of settings){
      if (!KEY_RE.test(String(s.key || '')) || !s.label) err(`settings 항목에는 key(영문 소문자)와 label이 있어야 해요: ${JSON.stringify(s)}`);
      if (s.type != null && !SETTING_TYPES.includes(String(s.type))) err(`settings ${s.key}: type은 ${SETTING_TYPES.join(', ')}`);
    }
    const collects = fm.collects && typeof fm.collects === 'object' ? { tag: fm.collects.tag ? String(fm.collects.tag) : null, area: fm.collects.area ? String(fm.collects.area) : null } : null;

    // 파일 종류 — 문서·이미지·선언한 스크립트만
    for (const f of list){
      if (DOC_EXT.test(f.path) || IMG_EXT.test(f.path)) continue;
      if (bundled.includes(f.path)) continue;
      err(SCRIPT_EXT.test(f.path) ? `permissions.bundled에 선언하지 않은 스크립트예요: ${f.path}` : `받을 수 없는 파일 종류예요: ${f.path}`);
    }

    // 워크플로우 — 단계가 선언한 권한 안에 있는지
    const workflows = [];
    for (const f of list.filter(f => /^workflows\/[^/]+\.md$/.test(f.path))){
      for (const w of parseWorkflows(f.text)){
        workflows.push({ ...w, file: f.path });
        for (const s of w.steps){
          const where = `${f.path} › ${w.name} › [${s.key}]`;
          if (s.kind === 'script'){
            const ref = s.body.split(/\s+/)[0] || '';
            if (/^scripts\//.test(ref) ? !bundled.includes(ref) : !scripts.includes(ref)) err(`${where}: 선언하지 않은 스크립트 "${ref}"`);
          }
          if ((s.kind === 'ai' || s.kind === 'agent') && !ai.includes(s.kind === 'ai' ? 'chat' : 'agent')) err(`${where}: permissions.ai에 ${s.kind === 'ai' ? 'chat' : 'agent'}가 없어요`);
          if (s.kind === 'agent' && MODES.indexOf(s.mode || 'read') > MODES.indexOf(mode)) err(`${where}: 에이전트 모드 ${s.mode}가 상한 ${mode}보다 높아요`);
          if ((s.kind === 'ai' || s.kind === 'agent') && /^prompts\/\S+\.md$/.test(s.body) && !byPath[s.body]) err(`${where}: 프롬프트 파일이 없어요 ${s.body}`);
          if (!['manual', 'ask'].includes(s.kind) && !s.body) err(`${where}: 내용이 비어 있어요`);
        }
      }
    }
    // 피드 — 주기적으로 가져올 목록. 실행하는 것은 선언한 스크립트뿐이다
    const feeds = [];
    for (const f of list.filter(f => /^feeds\/[^/]+\.md$/.test(f.path))){
      for (const d of parseFeeds(f.text)){
        const where = `${f.path} › ${d.name}`, ref = String(d.run || '').split(/\s+/)[0];
        if (!ref) err(`${where}: run이 없어요`);
        else if (!bundled.includes(ref)) err(`${where}: permissions.bundled에 선언하지 않은 스크립트 "${ref}"`);
        const every = d.every == null ? 60 : Number(String(d.every).replace(/분$/, ''));
        if (!(every >= 5 && every <= 1440)) err(`${where}: every는 5~1440분이에요`);
        if (d.days && !['weekdays', 'daily'].includes(d.days)) err(`${where}: days는 weekdays 또는 daily`);
        if (d.hours && !HOURS_RE.test(d.hours)) err(`${where}: hours는 09:00-18:00 형식이에요`);
        if (d.start_mode && !['auto', 'button'].includes(d.start_mode)) err(`${where}: start_mode는 auto 또는 button`);
        const starts = startsOf(d.start);   // "실행, 멈추기" — 항목마다 버튼 하나씩, 첫 번째가 주 버튼
        for (const w of starts) if (!workflows.some(x => x.name === w)) err(`${where}: 워크플로우 "${w}"가 없어요`);
        if (feeds.some(x => x.name === d.name)) err(`${where}: 피드 이름이 겹쳐요`);
        feeds.push({ name: d.name, file: f.path, description: d.description, run: String(d.run || ''), every: every || 60, days: d.days || 'daily', hours: d.hours || null,
          start: starts[0] || null, starts, start_mode: starts.length ? d.start_mode || 'button' : null, empty: d.empty || '', count: d.count || null });
      }
    }
    // 검색 — 찾기 화면에서 사람이 누를 때만. {q}가 찾는 말
    const searches = [];
    for (const f of list.filter(f => /^searches\/[^/]+\.md$/.test(f.path))){
      for (const d of parseSearches(f.text)){
        const where = `${f.path} › ${d.name}`, ref = String(d.run || '').split(/\s+/)[0];
        if (!ref) err(`${where}: run이 없어요`);
        else if (!bundled.includes(ref)) err(`${where}: permissions.bundled에 선언하지 않은 스크립트 "${ref}"`);
        if (!String(d.run || '').includes('{q}')) err(`${where}: run에 찾는 말 자리 {q}가 없어요`);
        const limit = d.limit == null ? 8 : Number(d.limit);
        if (!(limit >= 1 && limit <= 30)) err(`${where}: limit은 1~30이에요`);
        if (searches.some(x => x.name === d.name)) err(`${where}: 검색 이름이 겹쳐요`);
        searches.push({ name: d.name, file: f.path, description: d.description, run: String(d.run || ''), limit: limit || 8 });
      }
    }
    // 편집기 — 노트를 제목 줄 단위 칸으로 나눠 글자 수를 세며 고친다. 실행되는 것은 없다
    const editors = [];
    for (const f of list.filter(f => /^editors\/[^/]+\.md$/.test(f.path))){
      for (const d of parseEditors(f.text)){
        const where = `${f.path} › ${d.name}`;
        if (!d.note) err(`${where}: note(고칠 노트 제목)가 없어요`);
        if (!/^#{2,6}$/.test(String(d.block || ''))) err(`${where}: block은 ## ~ ###### 중 하나예요`);
        if (d.group && !/^#{1,5}$/.test(d.group)) err(`${where}: group은 # ~ ##### 중 하나예요`);
        for (const k of ['within', 'body_start', 'body_end', 'count']) if (d[k] && !reOk(d[k])) err(`${where}: ${k} 정규식이 맞지 않아요`);
        for (const k of ['title', 'body']) if (d[k] != null && d[k] !== '' && !(Number(d[k]) > 0)) err(`${where}: ${k}는 글자 수(숫자)예요`);
        if (editors.some(x => x.name === d.name)) err(`${where}: 편집기 이름이 겹쳐요`);
        editors.push({ name: d.name, file: f.path, description: d.description, note: String(d.note || ''), block: String(d.block || ''), group: d.group || null, within: d.within || null,
          title: d.title ? Number(d.title) : null, body: d.body ? Number(d.body) : null, body_start: d.body_start || null, body_end: d.body_end || null, count: d.count || null,
          fields: String(d.fields || '').split(',').map(x => x.trim()).filter(Boolean) });
      }
    }
    if (!workflows.length && !feeds.length && !searches.length && !editors.length) warn('워크플로우·피드·검색·편집기가 하나도 없어요(workflows/ feeds/ searches/ editors/)');
    if (mode === 'full') warn('에이전트가 모든 확인을 건너뛰는 full 모드를 요구해요');

    const manifest = { spec: SPEC, id: String(fm.id || ''), name: String(fm.name || ''), version: String(fm.version || ''), description: String(fm.description || doc.pre || '').slice(0, 500),
      author: fm.author ? String(fm.author) : null, homepage: fm.homepage ? String(fm.homepage) : null, requires: fm.requires || {},
      collects, permissions: { ai, agent_mode: mode, scripts, bundled, secrets: secrets.map(x => x.name) }, secrets,
      settings: settings.map(s => ({ key: String(s.key), label: String(s.label), hint: s.hint ? String(s.hint) : '', type: SETTING_TYPES.includes(String(s.type)) ? String(s.type) : 'text',
        default: s.default == null ? (s.type === 'toggle' ? false : '') : s.type === 'toggle' ? s.default === true : String(s.default), placeholder: s.placeholder ? String(s.placeholder) : '' })) };
    return { ok: !errors.length, manifest, workflows, feeds, searches, editors, scripts: bundled, errors, warnings };
  }

  const api = { SPEC, DIR, MODES, LIMITS, validate, parseWorkflows, parseFeeds, parseSearches, parseEditors, startsOf, ignored, DOC_EXT, SCRIPT_EXT, IMG_EXT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PKMPlugin = api;
})(typeof self !== 'undefined' ? self : this);
