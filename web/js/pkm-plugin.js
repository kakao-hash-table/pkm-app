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
  const SETTING_TYPES = ['text', 'lines', 'path', 'toggle', 'pairs'];
  const PAIR_CHECKS = ['regex', 'url'];
  /* pairs 설정의 두 칸: [{ label, placeholder, check(regex|url) }]. 값은 한 줄에 한 쌍, 두 칸을 탭으로 나눈 글 */
  const pairColumns = s => (Array.isArray(s.columns) ? s.columns : []).map(c => typeof c === 'string' ? { label: c } : c && typeof c === 'object' ? c : {})
    .map(c => ({ label: String(c.label || ''), placeholder: c.placeholder ? String(c.placeholder) : '', check: PAIR_CHECKS.includes(String(c.check)) ? String(c.check) : null }));
  const HOURS_RE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
  const ignored = p => p.split('/').some(s => s.startsWith('.')) || /(^|\/)(node_modules|__pycache__)\//.test(p);

  /* 워크플로우 문서: "## 이름" 아래 (설명 줄) "- [키] 단계명 · 종류 [when {단계.필드}] [in 폴더]: 내용" (종류 = manual | ask | script | ai | agent(read|auto|full) | browser({단계.필드})). ask는 사람에게 글을 받는다(내용 = 예시 문구).
     browser는 브라우저 도구만 가진 에이전트 단계 — 괄호 안은 앞 스크립트 단계가 낸 옵션 객체({ vars, allow, files, tab })의 자리, 비우면 옵션 없음 */
  function parseWorkflows(text){
    const out = []; let cur = null, step = null;
    for (const line of String(text || '').split('\n')){
      const h = line.match(/^##\s+(.+?)\s*$/);
      if (h){ cur = { name: h[1], steps: [] }; out.push(cur); step = null; continue; }
      const ok = line.match(/^-\s+ok:\s*(.+?)\s*$/);   // 시작할 때 묻는 창의 확인 버튼 글자(첫 단계 앞에서만)
      if (ok && cur && !cur.steps.length){ cur.ok = ok[1].slice(0, 20); continue; }
      const m = line.match(/^-\s+\[([^\]]+)\]\s+(.+?)\s+·\s+(?:(manual|ask|script|ai|agent)(?:\((read|auto|full)\))?|(browser)(?:\(\s*(\{[^{}\s]+\})?\s*\))?)(?:\s+when\s+(\{[^{}\s]+\}))?(?:\s+in\s+(\S+?))?\s*(?::\s*(.*))?$/);
      if (m && cur){ step = { key: m[1].trim(), name: m[2].trim(), kind: m[3] || m[5], mode: m[4] || null, ...(m[5] ? { browser: m[6] || null } : {}), when: m[7] || null, cwd: m[8] || null, body: (m[9] || '').trim() }; cur.steps.push(step); continue; }
      if (step && /^\s{2,}\S/.test(line)) step.body += (step.body ? '\n' : '') + line.trim();   // 두 칸 들여 쓴 줄은 앞 단계 내용에 이어 붙인다
      else if (cur && !cur.steps.length && line.trim() && !/^-\s/.test(line)) cur.note = (cur.note ? cur.note + ' ' : '') + line.trim();   // 단계 앞 줄은 설명 — 시작할 때 묻는 창에 보인다
    }
    return out;
  }

  /* 피드 문서: "## 이름" 아래 "- 키: 값" 줄. 키 = run(필수) · every(분) · days(weekdays|daily) · hours(09:00-18:00) · start(워크플로우) · start_mode(auto|button)
     · view(sections|inline|cards — inline이면 항목 자리에서 진행 상태를, cards면 항목마다 카드 한 장에 다 보이고 끝나면 사라진다) · reveal(cards에서 [이 kind 보기]를 누른 뒤에 보일 detail kind) · undo·undo_for(cards에서 끝난 뒤 토스트 [되돌리기]로 돌릴 워크플로우와 그 대상) · start_label(시작 버튼 글자) · sort(이름=키, 이름=-키 — 설명 아래 정렬 칩, 항목 sort[키]로 브라우저에서 정렬) · reask(yes — 항목 version이 바뀌면 내 확인을 기다리던 스크립트 단계를 다시 돌려 새로 묻는다) · search(검색 칸 안내 글 — 적으면 목록 위에 찾는 칸) · dismiss(yes — 확인하고 닫기) · count · notify(yes — 사이드바 알림) · empty. 다른 줄은 설명 */
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
  const parseSearches = parseFeeds, parseEditors = parseFeeds, parseChats = parseFeeds, parseLinks = parseFeeds;
  const CHAT_SCOPES = ['profile', 'card', 'project'];
  const startsOf = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  /* 정렬: "마감 임박=deadline, 상금 큰=-prize" → [{ label, key, desc }]. 값은 항목 vars[key]에서 읽는다. 틀린 조각은 bad에 */
  const sortsOf = v => startsOf(v).map(x => { const m = x.match(/^(.{1,12}?)\s*=\s*(-?)([a-z_][a-z0-9_]{0,40})$/); return m ? { label: m[1].trim(), key: m[3], desc: !!m[2] } : { bad: x }; });
  const reOk = v => { try { new RegExp(v); return true; } catch { return false; } };
  const LOGINS_MAX = 6;
  const httpsUrl = v => { try { return new URL(String(v)).protocol === 'https:' && String(v).length <= 500; } catch { return false; } };
  /* 편집기 고를 값: "진행상태=진행 예정|진행중|중단됨|진행 완료; 하이라이트=체크|없음" → { 진행상태: [...], 하이라이트: [...] } */
  function parseChoices(v){
    const out = {};
    for (const part of String(v || '').split(';')){ const m = part.match(/^\s*([^=]+?)\s*=\s*(.+?)\s*$/); if (m) out[m[1]] = m[2].split('|').map(x => x.trim()).filter(Boolean); }
    return out;
  }
  /* 체크인 점검 규칙: 한 줄에 "정규식<탭>안내" 또는 "정규식 → 안내". #으로 시작하는 줄·빈 줄은 건너뛴다 */
  function parseLintRules(text){
    return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(line => {
      const m = line.match(/^(.+?)\t+\s*(.+)$/) || line.match(/^(.+?)\s+(?:→|->)\s+(.+)$/);
      if (!m) return { line, bad: '"정규식 → 안내" 꼴이 아니에요' };
      if (!reOk(m[1])) return { line, bad: '정규식이 맞지 않아요' };
      return { line, re: m[1], msg: m[2] };
    });
  }

  /* 퀵링크 규칙: 한 줄에 "정규식<탭>주소"(pairs 설정이 저장하는 꼴) 또는 "정규식 → 주소"(->도 됨). 주소의 $&·$1~$9는 맞은 글자로 바뀐다. 설정 자리({rules})는 검사하지 않는다(값은 설치 뒤 채운다) */
  function parseLinkRules(text){
    return String(text || '').split(/\r?\n|\\n/).map(l => l.trim()).filter(Boolean).map(line => {
      if (/^\{[a-z_][a-z0-9_]*\}$/.test(line)) return { line, setting: line.slice(1, -1) };
      const m = line.match(/^(.+?)\t+\s*(\S+)$/) || line.match(/^(.+?)\s+(?:→|->)\s+(\S+)$/);
      if (!m) return { line, bad: '"정규식 → 주소" 꼴이 아니에요' };
      if (!reOk(m[1])) return { line, bad: '정규식이 맞지 않아요' };
      if (!/^https?:\/\//.test(m[2])) return { line, bad: '주소는 http(s)://로 시작해요' };
      return { line, re: m[1], url: m[2] };
    });
  }

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
    if (perm.browser != null && typeof perm.browser !== 'boolean') err('permissions.browser는 true나 false예요');
    const browser = perm.browser === true;   // 에이전트가 이 컴퓨터의 브라우저(로그인이 남는 전용 프로필)를 쓴다
    if (browser && !ai.includes('agent')) err('permissions.browser를 쓰려면 permissions.ai에 agent가 있어야 해요');
    const secretsDecl = (Array.isArray(perm.secrets) ? perm.secrets : []).map(x => typeof x === 'string' ? { name: x } : x && typeof x === 'object' ? x : {});
    for (const x of secretsDecl) if (!SECRET_RE.test(String(x.name || ''))) err(`permissions.secrets 이름은 영문 대문자·숫자·_예요: ${x.name || JSON.stringify(x)}`);
    const secrets = secretsDecl.filter(x => SECRET_RE.test(String(x.name || ''))).map(x => ({ name: String(x.name), label: String(x.label || x.name), hint: x.hint ? String(x.hint) : '', url: /^https:\/\//.test(String(x.url || '')) ? String(x.url) : '', ...(x.optional === true ? { optional: true } : {}), ...(x.plain === true ? { plain: true } : {}) }));   // optional: 그 기능을 쓸 때만 넣는 값 — 비어도 '준비가 남았어요'에 세지 않는다. plain: 계정 이름처럼 비밀이 아닌 값 — 스크립트 출력에서 가리지 않는다
    for (const b of bundled){
      if (!/^scripts\//.test(b) || !SCRIPT_EXT.test(b) || b.split('/').includes('..')) err(`가져오는 스크립트는 scripts/ 아래 .mjs·.js·.sh·.py여야 해요: ${b}`);
      else if (!byPath[b]) err(`선언한 스크립트 파일이 없어요: ${b}`);
    }
    const settings = (Array.isArray(fm.settings) ? fm.settings : []).filter(x => x && typeof x === 'object');
    for (const s of settings){
      if (!KEY_RE.test(String(s.key || '')) || !s.label) err(`settings 항목에는 key(영문 소문자)와 label이 있어야 해요: ${JSON.stringify(s)}`);
      if (s.type != null && !SETTING_TYPES.includes(String(s.type))) err(`settings ${s.key}: type은 ${SETTING_TYPES.join(', ')}`);
      if (s.type === 'pairs' && (pairColumns(s).length !== 2 || pairColumns(s).some(c => !c.label))) err(`settings ${s.key}: pairs는 columns에 label이 있는 칸 두 개를 적어요`);
    }
    const collects = fm.collects && typeof fm.collects === 'object' ? { tag: fm.collects.tag ? String(fm.collects.tag) : null, area: fm.collects.area ? String(fm.collects.area) : null } : null;
    // 브라우저 로그인 — 미리 로그인해 둘 곳. 화면이 [로그인하러 가기]로 그 주소를 pkm 전용 브라우저에 연다(로그인 여부는 보지 않는다)
    if (fm.logins != null && !Array.isArray(fm.logins)) err('logins는 { name, url } 목록이에요');
    const loginsDecl = Array.isArray(fm.logins) ? fm.logins : [];
    if (loginsDecl.length && !browser) err('logins를 쓰려면 permissions.browser: true가 있어야 해요');
    if (loginsDecl.length > LOGINS_MAX) err(`logins는 ${LOGINS_MAX}개까지예요`);
    const loginOk = x => !!x && typeof x === 'object' && !!String(x.name || '').trim() && String(x.name).length <= 20 && httpsUrl(x.url);
    for (const x of loginsDecl) if (!loginOk(x)) err(`logins 항목은 name(20자까지)과 https:// 주소(url)예요: ${JSON.stringify(x)}`);
    const logins = loginsDecl.filter(loginOk).slice(0, LOGINS_MAX).map(x => ({ name: String(x.name).trim(), url: String(x.url) }));

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
          if (s.kind === 'browser'){
            if (!browser) err(`${where}: browser 단계를 쓰려면 permissions.browser: true가 있어야 해요`);
            if (!ai.includes('agent')) err(`${where}: browser 단계를 쓰려면 permissions.ai에 agent가 있어야 해요`);
            if (s.cwd) err(`${where}: browser 단계에는 in 폴더를 쓰지 않아요(브라우저 도구만 써요)`);
            // 옵션(내 정보·갈 수 있는 곳·올릴 파일)은 승인한 스크립트가 낸 값만 — AI가 낸 값으로 정하지 않는다
            const from = s.browser && w.steps.slice(0, w.steps.indexOf(s)).find(z => z.key === s.browser.slice(1, -1).split('.')[0]);
            if (s.browser && (!s.browser.includes('.') || !from || from.kind !== 'script')) err(`${where}: browser(${s.browser})는 앞 스크립트 단계의 결과({단계.필드})여야 해요`);
          }
          if (['ai', 'agent', 'browser'].includes(s.kind) && /^prompts\/\S+\.md$/.test(s.body) && !byPath[s.body]) err(`${where}: 프롬프트 파일이 없어요 ${s.body}`);
          if (!['manual', 'ask'].includes(s.kind) && !s.body) err(`${where}: 내용이 비어 있어요`);
          if (s.when && !w.steps.slice(0, w.steps.indexOf(s)).some(z => z.key === s.when.slice(1, -1).split('.')[0])) err(`${where}: when의 ${s.when}는 앞 단계 결과여야 해요`);
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
        if (d.view && !['inline', 'sections', 'cards'].includes(d.view)) err(`${where}: view는 inline·sections·cards 중 하나`);
        if (['inline', 'cards'].includes(d.view) && !d.start) err(`${where}: view: ${d.view}은 start와 함께 써요`);
        if (d.reveal && d.view !== 'cards') err(`${where}: reveal은 view: cards에서만 써요`);
        if (d.undo && !workflows.some(x => x.name === d.undo)) err(`${where}: undo 워크플로우 "${d.undo}"가 없어요`);
        if (d.undo && d.view !== 'cards') err(`${where}: undo는 view: cards에서만 써요`);
        for (const w of startsOf(d.undo_for)) if (!starts.includes(w)) err(`${where}: undo_for의 "${w}"는 start에 없어요`);
        if (d.controls && d.controls !== 'project') err(`${where}: controls는 project만 써요`);
        if (d.controls && d.view !== 'inline') err(`${where}: controls는 view: inline과 함께 써요`);
        if (d.inputs && startsOf(d.inputs).some(k => !KEY_RE.test(k))) err(`${where}: inputs는 변수 이름을 쉼표로 나눠요`);
        if (d.dismiss && d.dismiss !== 'yes') err(`${where}: dismiss는 yes만 써요`);
        if (d.dismiss && d.start) err(`${where}: dismiss는 start가 없는 목록에만 써요`);
        if (d.notify && !['yes', 'no'].includes(d.notify)) err(`${where}: notify는 yes 또는 no`);
        if (d.reask && (d.reask !== 'yes' || !d.start)) err(`${where}: reask는 yes만, start가 있는 목록에 써요`);
        const sorts = sortsOf(d.sort);
        for (const x of sorts.filter(x => x.bad)) err(`${where}: sort는 "이름=키" 또는 "이름=-키"(큰 것부터)를 쉼표로 이어 써요: ${x.bad}`);
        if (sorts.length > 4) err(`${where}: sort는 4개까지예요`);
        if (sorts.length && ['inline', 'cards'].includes(d.view)) err(`${where}: sort는 view: ${d.view}에서 쓰지 않아요(항목 자리가 고정이에요)`);
        if (d.tab != null && (!String(d.tab).trim() || String(d.tab).length > 20)) err(`${where}: tab은 탭 이름 20자까지예요`);   // 플러그인 화면에서 이 목록을 따로 볼 탭(없으면 첫 탭 '할 일')
        if (feeds.some(x => x.name === d.name)) err(`${where}: 피드 이름이 겹쳐요`);
        feeds.push({ name: d.name, file: f.path, description: d.description, run: String(d.run || ''), every: every || 60, days: d.days || 'daily', hours: d.hours || null,
          ...(d.tab ? { tab: String(d.tab).trim().slice(0, 20) } : {}), start: starts[0] || null, starts, start_mode: starts.length ? d.start_mode || 'button' : null, empty: d.empty || '', count: d.count || null, notify: d.notify === 'yes' });
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
        for (const k of ['within', 'body_start', 'body_end', 'count', 'only']) if (d[k] && !reOk(d[k])) err(`${where}: ${k} 정규식이 맞지 않아요`);
        for (const k of ['title', 'body']) if (d[k] != null && d[k] !== '' && !(Number(d[k]) > 0)) err(`${where}: ${k}는 글자 수(숫자)예요`);
        if (d.combine != null && d.combine !== '' && !(Number(d.combine) > 0)) err(`${where}: combine은 글자 수(숫자)예요`);
        const choices = parseChoices(d.choices), check = parseChoices(d.check);
        for (const [k, v] of Object.entries({ ...choices, ...check })) if (v.length < 2) err(`${where}: ${k}의 고를 값은 |로 두 개 이상이에요`);
        for (const [k, v] of Object.entries(check)) if (v.length !== 2) err(`${where}: check ${k}는 "켬|끔" 두 값이에요`);
        if (editors.some(x => x.name === d.name)) err(`${where}: 편집기 이름이 겹쳐요`);
        const list_ = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
        editors.push({ name: d.name, file: f.path, description: d.description, note: String(d.note || ''), block: String(d.block || ''), group: d.group || null, within: d.within || null,
          title: d.title ? Number(d.title) : null, body: d.body ? Number(d.body) : null, body_start: d.body_start || null, body_end: d.body_end || null, count: d.count || null,
          fields: list_(d.fields), after: list_(d.after), only: d.only || null, choices, check, period: list_(d.period), combine: d.combine ? Number(d.combine) : null });
      }
    }
    // 체크인 — 편집기 두 개(주요 업무·과제)를 한 화면으로 묶어 제출 미리보기·점검·점수·카드에서 넣기를 더한다. 앱이 화면을 그리고 AI는 도구 없는 AI(chat)만 쓴다
    const checkins = [];
    for (const f of list.filter(f => /^checkins\/[^/]+\.md$/.test(f.path))){
      for (const d of parseFeeds(f.text)){
        const where = `${f.path} › ${d.name}`, ed = n => editors.find(x => x.name === n);
        if (!d.main || !ed(d.main)) err(`${where}: main(주요 업무 편집기 이름)이 이 플러그인 편집기에 없어요`);
        if (!d.tasks || !ed(d.tasks)) err(`${where}: tasks(과제 편집기 이름)가 이 플러그인 편집기에 없어요`);
        if (d.mirror && !reOk(d.mirror)) err(`${where}: mirror 정규식이 맞지 않아요`);
        const prompts = {};
        for (const k of ['style', 'lint', 'score', 'intake', 'polish']){
          if (!d[k]) continue;
          if (!/^prompts\/\S+\.md$/.test(d[k]) || !byPath[d[k]]) { err(`${where}: ${k} 프롬프트 파일이 없어요 ${d[k]}`); continue; }
          prompts[k] = String(byPath[d[k]].text || '');
        }
        if (['score', 'intake', 'polish'].some(k => d[k]) && !ai.includes('chat')) err(`${where}: score·intake·polish를 쓰려면 permissions.ai에 chat이 있어야 해요`);
        if (prompts.lint) for (const r of parseLintRules(prompts.lint)) if (r.bad) err(`${where}: lint 규칙 "${r.line}" — ${r.bad}`);
        const num = (k, dv) => { if (d[k] == null || d[k] === '') return dv; const n = Number(d[k]); if (!(n >= 1 && n <= 50)) err(`${where}: ${k}는 1~50이에요`); return n || dv; };
        if (checkins.some(x => x.name === d.name)) err(`${where}: 체크인 이름이 겹쳐요`);
        checkins.push({ name: d.name, file: f.path, description: d.description, main: String(d.main || ''), tasks: String(d.tasks || ''), mirror: d.mirror || null,
          rubric: d.rubric ? String(d.rubric) : null, form: d.form ? String(d.form) : null, rules: d.rules ? String(d.rules) : null, card: d.card ? String(d.card) : null,
          main_rec: num('main_rec', 3), main_max: num('main_max', 5), highlight_max: num('highlight_max', 3), prompts });
      }
    }
    // 채팅 — 오른쪽 아래 AI 챗봇 창(profile: 프로필 데이터 고치기, card: 단기 카드마다 세션). 앱이 화면을 그리고,
    // 에이전트는 pkm 서버와 같은 컴퓨터에 띄운 pkm-ai-server에서만 돈다(로컬 전용)
    const chats = [];
    for (const f of list.filter(f => /^chats\/[^/]+\.md$/.test(f.path))){
      for (const d of parseChats(f.text)){
        const where = `${f.path} › ${d.name}`, cmode = d.mode || 'auto';
        if (!CHAT_SCOPES.includes(d.scope)) err(`${where}: scope는 ${CHAT_SCOPES.join(' 또는 ')}예요`);
        if (!ai.includes('agent')) err(`${where}: permissions.ai에 agent가 없어요`);
        if (!MODES.includes(cmode)) err(`${where}: mode는 ${MODES.join(', ')}`);
        else if (MODES.indexOf(cmode) > MODES.indexOf(mode)) err(`${where}: 에이전트 모드 ${cmode}가 상한 ${mode}보다 높아요`);
        if (d.prompt && (!/^prompts\/\S+\.md$/.test(d.prompt) || !byPath[d.prompt])) err(`${where}: 프롬프트 파일이 없어요 ${d.prompt}`);
        if (chats.some(x => x.scope === d.scope)) err(`${where}: scope ${d.scope} 채팅이 이미 있어요`);
        chats.push({ name: d.name, file: f.path, description: d.description, scope: d.scope, mode: cmode, prompt: d.prompt || null, cwd: d.cwd || null, label: d.label || null });
      }
    }
    // 퀵링크 — 카드 제목 맨 앞이 규칙의 정규식에 맞으면 그 부분을 링크로 그린다. 실행되는 것은 없다
    const links = [];
    for (const f of list.filter(f => /^links\/[^/]+\.md$/.test(f.path))){
      for (const d of parseLinks(f.text)){
        const where = `${f.path} › ${d.name}`;
        if (!d.rules) err(`${where}: rules(링크 규칙)가 없어요`);
        else for (const r of parseLinkRules(d.rules)) if (r.bad) err(`${where}: 규칙 "${r.line}" — ${r.bad}`);
        if (links.some(x => x.name === d.name)) err(`${where}: 퀵링크 이름이 겹쳐요`);
        links.push({ name: d.name, file: f.path, description: d.description, rules: String(d.rules || '') });
      }
    }
    if (!workflows.length && !feeds.length && !searches.length && !editors.length && !chats.length && !links.length) warn('워크플로우·피드·검색·편집기·채팅·퀵링크가 하나도 없어요(workflows/ feeds/ searches/ editors/ chats/ links/)');
    if (mode === 'full') warn('에이전트가 모든 확인을 건너뛰는 full 모드를 요구해요');

    const manifest = { spec: SPEC, id: String(fm.id || ''), name: String(fm.name || ''), version: String(fm.version || ''), description: String(fm.description || doc.pre || '').slice(0, 500),
      author: fm.author ? String(fm.author) : null, homepage: fm.homepage ? String(fm.homepage) : null, requires: fm.requires || {},
      collects, permissions: { ai, agent_mode: mode, scripts, bundled, secrets: secrets.map(x => x.name), ...(secrets.some(x => x.plain) ? { plain: secrets.filter(x => x.plain).map(x => x.name) } : {}), browser }, secrets, logins,
      settings: settings.map(s => ({ key: String(s.key), label: String(s.label), hint: s.hint ? String(s.hint) : '', type: SETTING_TYPES.includes(String(s.type)) ? String(s.type) : 'text',
        default: s.default == null ? (s.type === 'toggle' ? false : '') : s.type === 'toggle' ? s.default === true : String(s.default), placeholder: s.placeholder ? String(s.placeholder) : '',
        ...(s.type === 'pairs' ? { columns: pairColumns(s) } : {}) })) };
    return { ok: !errors.length, manifest, workflows, feeds, searches, editors, checkins, chats, links, scripts: bundled, errors, warnings };
  }

  /* 누른 항목의 실행 — 같은 목록·항목·워크플로우에서 누른 뒤에 만든 것 중 가장 새것(누르기 전에 있던 skip은 빼고). 시계 차이는 1분까지 본다 */
  function runOf(runs, t){
    const since = t.at - 60000;
    return (runs || []).filter(r => r.feed === t.feed && r.item && r.item.id === t.item && (!t.workflow || r.workflow === t.workflow) && !(t.skip || []).includes(r.id) && Date.parse(r.created) >= since)
      .sort((a, b) => String(b.created).localeCompare(String(a.created)))[0] || null;
  }
  /* 누른 항목 자리에 보일 한 줄 — phase: busy(짧은 처리)·ai(AI가 하는 중)·input(내 확인)·failed(멈춤)·done·canceled */
  function runFeedback(r, now = Date.now()){
    if (!r) return null;
    const steps = r.steps || [], cur = steps.find(s => !['done', 'skipped'].includes(s.status)) || steps[steps.length - 1] || {};
    const line = v => String(v || '').trim().split('\n')[0].slice(0, 160);
    if (['queued', 'running', 'waiting'].includes(r.status)){
      if (r.status === 'waiting') return { phase: 'ai', text: cur.reason === 'limit' ? 'AI 한도라 기다리는 중 · 풀리면 이어서 해요' : cur.reason === 'login' ? 'AI 로그인을 기다려요' : '기다리는 중 · 이어서 해요' };
      if (!['ai', 'agent', 'browser'].includes(cur.kind)) return { phase: 'busy', text: '처리하는 중…' };
      const min = cur.started ? Math.floor((now - Date.parse(cur.started)) / 60000) : 0;
      return { phase: 'ai', text: `AI가 하는 중 · ${min >= 1 ? `${min}분째` : '몇 분 걸려요'}` };
    }
    if (r.status === 'input'){ const q = cur.ask && cur.ask.type !== 'confirm' && line(cur.ask.question); return { phase: 'input', text: `${cur.ask && cur.ask.type === 'value' ? '알려 주세요' : '내 확인이 필요해요'}${q ? ` · ${q}` : ''}`, step: cur.key }; }   // 무엇을 묻는지 목록 줄에서 바로 보이게
    if (r.status === 'stopped'){ const why = line(cur.status === 'failed' ? cur.error : r.note || cur.error); return { phase: 'failed', text: `멈췄어요${why ? ` · ${why}` : ''}`, step: cur.key }; }
    if (r.status === 'canceled') return { phase: 'canceled', text: '그만뒀어요' };
    for (let i = steps.length - 1; i >= 0; i--){
      const o = steps[i].output; if (!o || typeof o !== 'object') continue;
      const v = o.verdict && typeof o.verdict === 'object' ? o.verdict : null, oc = o.outcome && typeof o.outcome === 'object' ? o.outcome : null;
      if (v && line(v.title)) return { phase: 'done', tone: v.tone === 'bad' ? 'bad' : 'ok', text: [line(v.title), line(v.text)].filter(Boolean).join(' · ') };
      if (oc && line(oc.title)) return { phase: 'done', tone: 'ok', text: [line(oc.title), line(oc.text)].filter(Boolean).join(' · ') };
    }
    return { phase: 'done', tone: 'ok', text: '끝났어요' };
  }

  const api = { SPEC, DIR, MODES, LIMITS, validate, runOf, runFeedback, parseWorkflows, parseFeeds, parseSearches, parseEditors, parseChats, parseLinks, parseLinkRules, parseChoices, parseLintRules, startsOf, sortsOf, ignored, DOC_EXT, SCRIPT_EXT, IMG_EXT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PKMPlugin = api;
})(typeof self !== 'undefined' ? self : this);
