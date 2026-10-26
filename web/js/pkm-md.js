/* PKM 데이터 ↔ 마크다운 파일. 브라우저(window.PKMMD)와 Node(require)가 같은 코드를 쓴다.
   한 프로필 = 파일 지도 { '상대 경로': '마크다운' }. 저장 값은 영어 키(SPEC §0), 화면 값은 한국어 — 여기서 바꾼다.
   링크는 Obsidian에서 읽히게 [[제목]]으로 쓰고, 읽을 때 제목으로 다시 id를 찾는다. */
(function (root) {
  'use strict';

  /* ---------- 값 사전: 화면 이름 ↔ 저장 키 ---------- */
  const pair = o => ({ k2v: o, v2k: Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k])) });
  const STATUS = pair({ todo:'대기', doing:'진행', waiting:'기다림', done:'완료' });
  const RSTATUS = pair({ to_read:'읽을것', reading:'읽는중', processed:'정리완료' });
  const FORMAT = pair({ book:'책', article:'아티클', video:'영상' });
  const UNIT = pair({ hours:'시간', books:'권', times:'회' });
  const toKey = (p, v) => (v == null || v === '' ? v : p.v2k[v] || v);
  const toVal = (p, k) => (k == null || k === '' ? k : p.k2v[k] || k);

  const DEFAULT_FOLDERS = {
    inbox:'00_인박스', reference:'01_지식/참조노트', fleeting:'01_지식/임시노트', permanent:'01_지식/영구노트', context:'01_지식/맥락노트', textbook:'01_지식/교과서', cards:'01_지식/교과서 카드',
    daily:'02_시간/데일리', project:'03_행동/단기보드', area:'03_행동/장기보드', routine:'03_행동/루틴보드', appointment:'03_행동/약속보드',
    templates:'_템플릿'
  };
  const SETTINGS = '_설정.md';
  const FORMAT_VERSION = 1;   // 저장 형식이 바뀌면 올리고, parse 에서 옛 형식을 옮겨 읽는다

  /* ---------- YAML(프런트매터) 작은 부분집합 ---------- */
  const needsQuote = s => s === '' || /^[\s]|[\s]$|^[-?:,\[\]{}#&*!|>'"%@`]|: | #|^(true|false|null|yes|no|on|off|~)$|^[+-]?\d/i.test(s) || /[\n\r]/.test(s);
  const q = s => JSON.stringify(String(s));
  function yScalar(v){
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    const s = String(v);
    return needsQuote(s) ? q(s) : s;
  }
  const yFlowItem = v => (v && typeof v === 'object' && !Array.isArray(v)) ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${Array.isArray(x) ? yFlowList(x) : yScalar(x) || '""'}`).join(', ')} }` : (yScalar(v) || '""');
  const yFlowList = a => `[${a.map(yFlowItem).join(', ')}]`;
  function yLine(k, v, ind = ''){
    if (Array.isArray(v)) return v.length && v.some(x => x && typeof x === 'object') ? `${ind}${k}:\n${v.map(x => `${ind}  - ${yFlowItem(x)}`).join('\n')}` : `${ind}${k}: ${yFlowList(v)}`;
    if (v && typeof v === 'object') return `${ind}${k}:\n${Object.entries(v).map(([kk, vv]) => yLine(kk, vv, ind + '  ')).join('\n')}`;
    const s = yScalar(v);
    return s === '' ? `${ind}${k}:` : `${ind}${k}: ${s}`;
  }
  function stripComment(s){
    let inq = null;
    for (let i = 0; i < s.length; i++){
      const c = s[i];
      if (inq){ if (c === '\\' && inq === '"'){ i++; continue; } if (c === inq) inq = null; continue; }
      if (c === '"' || c === "'") inq = c;
      else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
    }
    return s.trimEnd();
  }
  function parseScalar(s){
    s = s.trim();
    if (s === '' || s === '~' || s === 'null') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (s[0] === '"'){ try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); } }
    if (s[0] === "'") return s.slice(1, -1).replace(/''/g, "'");
    if (s[0] === '[' || s[0] === '{') return parseFlow(s);
    return s;
  }
  function parseFlow(s){   // [a, "b", {k: v}] · {k: v, k2: [..]}
    let i = 0;
    const ws = () => { while (/\s/.test(s[i] || '')) i++; };
    function val(){
      ws();
      if (s[i] === '['){ i++; const a = []; ws(); if (s[i] === ']'){ i++; return a; } for (;;){ a.push(val()); ws(); if (s[i] === ','){ i++; continue; } if (s[i] === ']'){ i++; return a; } return a; } }
      if (s[i] === '{'){ i++; const o = {}; ws(); if (s[i] === '}'){ i++; return o; } for (;;){ ws(); let k = ''; while (s[i] && s[i] !== ':') k += s[i++]; i++; o[k.trim()] = val(); ws(); if (s[i] === ','){ i++; continue; } if (s[i] === '}'){ i++; return o; } return o; } }
      if (s[i] === '"'){ let j = i + 1; while (j < s.length && s[j] !== '"'){ if (s[j] === '\\') j++; j++; } const t = s.slice(i, j + 1); i = j + 1; try { return JSON.parse(t); } catch (e) { return t.slice(1, -1); } }
      let t = ''; while (i < s.length && !',]}'.includes(s[i])) t += s[i++];
      return parseScalar(t);
    }
    return val();
  }
  function parseYaml(text){
    const lines = text.split('\n'), out = {};
    let i = 0;
    const ind = l => l.match(/^ */)[0].length;
    function block(level, target){
      while (i < lines.length){
        const raw = lines[i];
        if (!raw.trim() || /^\s*#/.test(raw)){ i++; continue; }
        if (ind(raw) < level) return;
        const line = stripComment(raw.slice(level));
        const m = line.match(/^([^:\s][^:]*):(?:\s+(.*))?$/) || line.match(/^([^:\s][^:]*):$/);
        if (!m){ i++; continue; }
        const key = m[1].trim(), rest = (m[2] || '').trim();
        i++;
        if (rest !== ''){ target[key] = parseScalar(rest); continue; }
        // 아래 줄을 본다: 목록이거나 하위 맵이거나 빈 값
        let j = i; while (j < lines.length && (!lines[j].trim() || /^\s*#/.test(lines[j]))) j++;
        if (j >= lines.length || ind(lines[j]) <= level && !/^\s*- /.test(lines[j].slice(level))){ target[key] = null; continue; }
        const childInd = ind(lines[j]);
        if (/^-\s/.test(lines[j].trim()) || lines[j].trim() === '-'){
          const arr = []; i = j;
          while (i < lines.length){
            const r = lines[i];
            if (!r.trim() || /^\s*#/.test(r)){ i++; continue; }
            if (ind(r) < childInd || !/^-(\s|$)/.test(r.trim())) break;
            arr.push(parseScalar(stripComment(r.trim().slice(1)))); i++;
          }
          target[key] = arr;
        } else if (childInd > level){
          const sub = {}; i = j; block(childInd, sub); target[key] = sub;
        } else target[key] = null;
      }
    }
    block(0, out);
    return out;
  }

  /* ---------- 마크다운 문서: 프런트매터 + "# 제목" 칸 ---------- */
  function parseDoc(text){
    text = String(text || '').replace(/\r\n/g, '\n');
    let fm = {}, body = text;
    const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
    if (m){ fm = parseYaml(m[1]); body = text.slice(m[0].length); }
    const sections = {}, order = [];
    let cur = null, buf = [], pre = [];
    for (const line of body.split('\n')){
      const h = line.match(/^# (.+?)\s*$/);
      if (h){ if (cur !== null) sections[cur] = buf.join('\n').trim(); cur = h[1]; order.push(cur); buf = []; }
      else (cur === null ? pre : buf).push(line);
    }
    if (cur !== null) sections[cur] = buf.join('\n').trim();
    return { fm, sections, order, pre:pre.join('\n').trim(), body:body.trim() };
  }
  function writeDoc(fm, sections, pre){
    const head = Object.entries(fm).filter(([, v]) => v !== undefined).map(([k, v]) => yLine(k, v)).join('\n');
    const secs = (sections || []).map(([t, v]) => `# ${t}\n${v ? v.trim() + '\n' : ''}`).join('\n');
    return `---\n${head}\n---\n${pre ? '\n' + pre.trim() + '\n' : ''}${secs ? '\n' + secs : ''}`;
  }

  /* ---------- 파일 이름 ---------- */
  const clean = s => String(s || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '제목 없음';
  const link = t => (t ? `[[${clean(t)}]]` : '');   // 파일 이름과 같게 — Obsidian에서 바로 열린다
  const same = (x, t) => { t = String(t).split('/').pop(); return x === t || clean(x) === t; };   // [[폴더/이름]]도 이름으로 맞춘다
  const linkIn = (dir, t) => `[[${dir}/${clean(t)}]]`;   // 이름이 겹칠 수 있는 기록·약속은 폴더까지 적는다
  const apptName = a => `${a.start.slice(0, 10)} ${a.title}`;
  const recName = m => `${m.date} ${m.title}`;
  const unlink = v => (v == null ? '' : String(v).replace(/^\[\[|\]\]$/g, '').replace(/\|.*$/, '').trim());
  const listLines = s => String(s || '').split('\n').map(l => l.replace(/^\s*[-*]\s?/, '').trim()).filter(Boolean);
  const firstLine = s => String(s || '').split('\n')[0].trim();

  /* ---------- 직렬화: 프로필 하나 → 파일 지도 ---------- */
  function serialize(P){
    const D = P.db, F = Object.assign({}, DEFAULT_FOLDERS, (P.settings && P.settings.folders) || {});
    const files = {}, used = new Set(), index = {};
    const place = (dir, name, id) => { let p = `${dir}/${clean(name)}.md`, n = 2; while (used.has(p)) p = `${dir}/${clean(name)} (${n++}).md`; used.add(p); if (id) index[id] = p; return p; };
    Object.defineProperty(files, 'index', { value:index, enumerable:false });   // id → 파일 경로 (Obsidian에서 열기용, 저장되지 않음)
    const byId = (arr, id) => (arr || []).find(x => x.id === id);
    const sortById = a => (a || []).slice().sort((x, y) => String(x.id).localeCompare(String(y.id)));

    sortById(D.inbox).forEach(x => { files[place(F.inbox, `${x.created.slice(0, 10)} ${firstLine(x.text).slice(0, 40)}`, x.id)] = writeDoc({ type:'inbox', id:x.id, captured:x.created }, [], x.text); });
    sortById(D.fleeting).forEach(x => { files[place(F.fleeting, `${x.created.slice(0, 10)} ${firstLine(x.text).slice(0, 40)}`, x.id)] = writeDoc({ type:'fleeting', id:x.id, created:x.created }, [], x.text); });
    sortById(D.refs).forEach(r => {
      const fm = { type:'reference', id:r.id, format:toKey(FORMAT, r.type), title:r.title, status:toKey(RSTATUS, r.status) };
      ['author', 'source', 'channel', 'publisher', 'url', 'published', 'length', 'captured', 'started', 'finished'].forEach(k => { if (r[k]) fm[k] = r[k]; });
      const quotesTitle = ['책', '아티클'].includes(r.type) ? '인상 깊은 문장' : '인상 깊은 장면·말';
      const ideas = (r.ideas || []).map(it => {
        const to = it.perm ? byId(D.perms, it.perm) : it.ctx ? byId(D.ctxs, it.ctx) : null;
        return `- ${it.text}${to ? ` → ${link(to.title)}` : ''}`;
      }).join('\n');
      files[place(`${F.reference}/${r.type}`, r.title, r.id)] = writeDoc(fm, [['한 줄 요약', r.summary], ['핵심 내용', Array.isArray(r.points) ? r.points.join('\n') : r.points], [quotesTitle, r.quotes], ['내 생각 → 영구노트 후보', ideas]]);
    });
    sortById(D.perms).forEach(p => {
      files[place(F.permanent, p.title, p.id)] = writeDoc({ type:'permanent', id:p.id, title:p.title, created:p.created, links:(p.links || []).map(id => byId(D.perms, id)).filter(Boolean).map(x => link(x.title)), sources:(p.sources || []).map(id => byId(D.refs, id) || byId(D.textbooks, id)).filter(Boolean).map(x => link(x.title)) }, [], p.body);
    });
    sortById(D.ctxs).forEach(c => {
      const hist = ['| 날짜 | 무엇이 바뀌었나 | 왜 |', '|---|---|---|', ...(c.history || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map(h => `| ${h.date} | ${cell(h.what)} | ${cell(h.why)} |`)].join('\n');
      files[place(F.context, c.title, c.id)] = writeDoc({ type:'context', id:c.id, topic:c.title, created:c.created, updated:c.updated, sources:c.sources || [] }, [['한 줄 요약', c.summary], ['내용', c.body], ['바뀐 기록', hist]]);
    });
    // 교과서(D.textbooks)는 읽기전용이라 쓰지 않는다 — 파일 지도에 없으니 저장이 고치지도 지우지도 않는다
    // 데일리 — 계획·메모·회고·체크한 루틴이 있을 때만 파일을 만든다
    const days = new Set([...Object.keys(D.dailies || {}), ...Object.keys(D.routineDone || {})]);
    [...days].sort().forEach(d => {
      const x = (D.dailies || {})[d] || {}, rd = (D.routineDone || {})[d] || {};
      // 하루 여러 번 도는 루틴의 회차('id@시각')는 시각을 별칭으로 — [[물 250ml|12:00]]
      const rLink = k => { const [id, t] = k.split('@'), r = byId(D.routines, id); return r ? (t ? `[[${clean(r.title)}|${t}]]` : link(r.title)) : ''; };
      const done = Object.keys(rd).filter(k => rd[k]).sort().map(rLink).filter(Boolean);
      const plan = x.plan || {};
      const planText = Object.keys(plan).sort().filter(k => plan[k].length).map(k => `## ${k}\n${plan[k].map(e => { const t = byId(D.tasks, e.id); return t ? `- [${e.done ? 'x' : ' '}] ${link(t.title)}${e.min ? ` · ${e.min}분` : ''}` : ''; }).filter(Boolean).join('\n')}`).join('\n\n');
      const skipped = (x.skipped || []).map(rLink).filter(Boolean);
      if (!x.memo && !x.retro && !planText && !done.length && !x.start && !skipped.length) return;
      index[d] = `${F.daily}/${d}.md`;
      files[`${F.daily}/${d}.md`] = writeDoc({ type:'daily', date:d, start:x.start || undefined, routines:done, skipped:skipped.length ? skipped : undefined }, [['오늘 계획', planText], ['메모', x.memo], ['한 줄 회고', x.retro]]);
    });
    // 기록(종류별 폴더)
    const kinds = D.kinds || [];
    sortById(D.meetings).forEach(m => {
      const k = kinds.find(x => x.id === (m.kind || 'meeting')) || { name:'기록', fields:[], people:true, todos:true };
      const appt = m.appt && byId(D.appts, m.appt);
      const todos = (m.todos || []).map(t => { const task = t.task && byId(D.tasks, t.task); return `- [${task ? 'x' : ' '}] ${t.t}${task ? ` → ${link(task.title)}` : ''}`; }).join('\n');
      const secs = (k.fields || []).map(([fk, label]) => [label, m[fk] || '']);
      if (k.todos) secs.push(['할 일', todos]);
      files[place(k.folder || `02_시간/${clean(k.name)}`, `${m.date} ${m.title}`, m.id)] = writeDoc({ type:'record', id:m.id, kind:k.name, title:m.title, date:m.date, time:m.time, people:k.people ? (m.attendees || []) : undefined, appointment:appt ? linkIn(F.appointment, apptName(appt)) : undefined, draft:m.draft ? true : undefined }, secs);
    });
    sortById(D.tasks).forEach(t => {
      const from = t.from && byId(D.meetings, t.from);
      files[place(F.project, t.title, t.id)] = writeDoc({
        type:'project', id:t.id, title:t.title, status:toKey(STATUS, t.status), area:t.area ? link(t.area) : null, due:t.due || null,
        estimate:t.estimate || null, result:t.result || undefined, done_at:t.doneAt || undefined, created:t.created || null,
        waiting_on:t.waitOn || undefined, waiting_since:t.waitSince || undefined, from:from ? linkIn(((D.kinds || []).find(k => k.id === (from.kind || 'meeting')) || {}).folder || `02_시간/${clean(((D.kinds || []).find(k => k.id === (from.kind || 'meeting')) || { name:'기록' }).name)}`, recName(from)) : undefined
      }, [['할 일', (t.todos || []).map(x => `- [${x.d ? 'x' : ' '}] ${x.t}`).join('\n')], ['완료 조건', (t.done || []).filter(Boolean).map(x => `- ${x}`).join('\n')], ['메모', t.memo]]);
    });
    sortById(D.longs).forEach(L => {
      const recs = ['| 날짜 | 양 | 메모 | 출처 |', '|---|---|---|---|', ...(L.records || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map(r => `| ${r.date} | ${r.amt} | ${cell(r.memo)} | ${cell(r.src)} |`)].join('\n');
      files[place(F.area, L.title, L.id)] = writeDoc({ type:'area', id:L.id, title:L.title, metric:L.metric, unit:toKey(UNIT, L.unit) }, [['왜 관리하나', L.why], ['누적 기록', recs], ['회고', L.retro]]);
    });
    sortById(D.routines).forEach(r => {
      files[place(F.routine, r.title, r.id)] = writeDoc({ type:'routine', id:r.id, title:r.title, enabled:!!r.enabled, cron:r.cron, duration:r.duration || 30, block:r.block || null, area:r.area ? link(r.area) : null, amount:r.amount == null ? null : r.amount }, [['루틴 내용', r.content]]);
    });
    sortById(D.appts).forEach(a => {
      files[place(F.appointment, `${a.start.slice(0, 10)} ${a.title}`, a.id)] = writeDoc({ type:'appointment', id:a.id, title:a.title, start:a.start, end:a.end, location:a.location || null, attendees:a.attendees || [], gcal_id:a.gcal_id || null }, [['메모', a.memo]]);
    });
    files[SETTINGS] = settingsDoc(P, F);
    return files;
  }
  const cell = s => String(s || '').replace(/\|/g, '/').replace(/\n/g, ' ');

  function settingsDoc(P, F){
    const S = P.settings || {}, D = P.db;
    const records = Object.fromEntries((D.kinds || []).map(k => [k.name, k.folder || `02_시간/${clean(k.name)}`]));
    const fm = {
      type:'settings', format:FORMAT_VERSION, storage:S.storage || 'device', repo:S.repo || undefined, locale:S.locale || 'ko',
      folders:Object.assign({}, F, { records }),
      record_kinds:(D.kinds || []).map(k => ({ id:k.id, name:k.name, fields:(k.fields || []).map(f => f[1]), keys:(k.fields || []).map(f => f[0]), people:!!k.people, todos:!!k.todos })),
      reference_formats:(D.formats || ['책', '아티클', '영상']).map(f => toKey(FORMAT, f)),
      week_start:S.week_start ?? 1, day_start:S.day_start || '09:00', day_end:S.day_end || '18:00',
      blocked:(S.blocked || []).map(b => ({ days:b.days, from:b.from, to:b.to, label:b.label || '' })),
      fill_ratio:S.fill_ratio ?? 0.75, max_block:S.max_block ?? 120, default_block:S.default_block ?? 60,
      gcal_account:S.gcal_account || null, gcal_task_blocks:!!S.gcal_task_blocks, onboarded:S.onboarded !== false,
      menu_order:S.menu_order && S.menu_order.length ? S.menu_order : undefined, menu_hidden:S.menu_hidden && S.menu_hidden.length ? S.menu_hidden : undefined
    };
    return writeDoc(fm, []);
  }

  /* ---------- 읽기: 파일 지도 → 프로필 하나 ---------- */
  function emptyDb(){ return { inbox:[], refs:[], fleeting:[], perms:[], ctxs:[], textbooks:[], tbCards:[], dailies:{}, kinds:[], meetings:[], tasks:[], longs:[], routines:[], appts:[], routineDone:{}, formats:['책', '아티클', '영상'] }; }
  let seq = 0;
  const newId = p => p + Date.now().toString(36).slice(-4) + (seq++).toString(36);

  function parse(files){
    const D = emptyDb(), settings = {};
    const docs = Object.entries(files).filter(([p]) => p.endsWith('.md') && !p.startsWith('_템플릿/') && !p.startsWith('_플러그인/') && !p.includes('/.trash/') && !p.startsWith('.trash/')).map(([p, t]) => ({ path:p, ...parseDoc(t) }));
    // 설정 먼저
    const sdoc = docs.find(d => d.path === SETTINGS);
    if (sdoc){
      const s = sdoc.fm;
      Object.assign(settings, {
        storage:s.storage || 'device', repo:s.repo || '', locale:s.locale || 'ko', week_start:s.week_start ?? 1,
        day_start:s.day_start || '09:00', day_end:s.day_end || '18:00',
        blocked:(s.blocked || []).filter(b => b && typeof b === 'object').map(b => ({ days:String(b.days ?? '*'), from:String(b.from), to:String(b.to), label:b.label || '' })),
        fill_ratio:s.fill_ratio ?? 0.75, max_block:s.max_block ?? 120, default_block:s.default_block ?? 60,
        gcal_account:s.gcal_account || '', gcal_task_blocks:!!s.gcal_task_blocks,
        onboarded:s.onboarded === false ? false : s.onboarded === true ? true : null,   // null = 적힌 적 없음(앱이 정한다)
        menu_order:Array.isArray(s.menu_order) ? s.menu_order.map(String) : [], menu_hidden:Array.isArray(s.menu_hidden) ? s.menu_hidden.map(String) : []
      });
      const folders = Object.assign({}, s.folders || {}); const recMap = folders.records || {}; delete folders.records;
      settings.folders = folders;
      if (Array.isArray(s.record_kinds) && s.record_kinds.length){
        D.kinds = s.record_kinds.filter(Boolean).map(k => ({ id:String(k.id || newId('k')), name:String(k.name), fields:(k.fields || []).map((l, i) => [String((k.keys || [])[i] || 'f' + i), String(l)]), people:!!k.people, todos:k.todos !== false, folder:recMap[k.name] || undefined }));
      } else if (recMap && Object.keys(recMap).length){
        D.kinds = Object.entries(recMap).map(([name, folder]) => ({ id:name === '회의록' ? 'meeting' : newId('k'), name, folder, fields:[], people:true, todos:true }));
      }
      if (Array.isArray(s.reference_formats)) D.formats = s.reference_formats.map(f => toVal(FORMAT, String(f)));
    }
    const kindByName = n => D.kinds.find(k => k.name === n);
    const paths = {};   // id → 읽어 온 파일 경로 (사용자가 Obsidian에서 이름을 바꿨으면 저장 때 옛 파일을 정리한다)
    const later = [];   // 제목 링크는 모두 읽은 뒤에 id로 바꾼다
    const tbDir = ((settings.folders || {}).textbook || DEFAULT_FOLDERS.textbook) + '/';
    const cardDir = ((settings.folders || {}).cards || DEFAULT_FOLDERS.cards) + '/';
    for (const d of docs){
      const f = d.fm, S = d.sections, type = d.path.startsWith(tbDir) ? 'textbook' : d.path.startsWith(cardDir) ? 'cards' : f.type;
      const id = f.id != null ? String(f.id) : null;
      const n0 = Object.values(D).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
      if (type === 'inbox') D.inbox.push({ id:id || newId('i'), text:d.body, created:String(f.captured || f.created || '') });
      else if (type === 'fleeting') D.fleeting.push({ id:id || newId('f'), text:d.body, created:String(f.created || '') });
      else if (type === 'reference'){
        const r = { id:id || newId('r'), type:toVal(FORMAT, String(f.format || f.type_label || '아티클')), title:String(f.title || base(d.path)), status:toVal(RSTATUS, f.status || 'to_read'),
          summary:S['한 줄 요약'] || '', points:S['핵심 내용'] || '', quotes:S['인상 깊은 문장'] || S['인상 깊은 장면·말'] || '', ideas:[] };
        ['author', 'source', 'channel', 'publisher', 'url', 'published', 'length', 'captured', 'started', 'finished'].forEach(k => { r[k] = f[k] == null ? '' : String(f[k]); });
        const ideaLines = String(S['내 생각 → 영구노트 후보'] || '').split('\n').filter(l => /^\s*-\s+\S/.test(l));
        later.push(() => { r.ideas = ideaLines.map(l => { const m = l.replace(/^\s*-\s+/, '').match(/^(.*?)(?:\s*→\s*\[\[(.+?)\]\])?$/); const t = m[2]; const p = t && D.perms.find(x => same(x.title, t)), c = t && !p && D.ctxs.find(x => same(x.title, t)); return { text:m[1].trim(), perm:p ? p.id : null, ctx:c ? c.id : null }; }); });
        D.refs.push(r);
      }
      else if (type === 'permanent'){
        const p = { id:id || newId('p'), title:String(f.title || base(d.path)), created:String(f.created || ''), links:[], sources:[], body:d.body };
        later.push(() => { p.links = (f.links || []).map(unlink).map(t => (D.perms.find(x => same(x.title, t)) || {}).id).filter(Boolean); p.sources = (f.sources || []).map(unlink).map(t => (D.refs.find(x => same(x.title, t)) || D.textbooks.find(x => same(x.title, t)) || {}).id).filter(Boolean); });
        D.perms.push(p);
      }
      else if (type === 'context'){
        D.ctxs.push({ id:id || newId('c'), title:String(f.topic || f.title || base(d.path)), created:String(f.created || ''), updated:String(f.updated || f.created || ''), sources:f.sources || [], summary:S['한 줄 요약'] || '', body:S['내용'] || '',
          history:tableRows(S['바뀐 기록']).map(([date, what, why]) => ({ date, what, why:why || '' })).filter(h => h.date) });
      }
      else if (type === 'daily'){
        const date = String(f.date || base(d.path));
        const x = { memo:S['메모'] || '', retro:S['한 줄 회고'] || '', did:[], plan:{} };
        if (/^\d{1,2}:\d{2}$/.test(String(f.start || ''))) x.start = String(f.start).padStart(5, '0');   // 그날만 하루 시작을 옮긴 시각
        D.dailies[date] = x;
        const planText = S['오늘 계획'] || '';
        later.push(() => {
          let key = null;
          planText.split('\n').forEach(l => {
            const h = l.match(/^##\s+(\d{1,2}:\d{2})/); if (h){ key = h[1].padStart(5, '0'); x.plan[key] = []; return; }
            const m = l.match(/^\s*-\s+\[( |x|X)\]\s+\[\[(.+?)\]\](?:\s*·\s*(\d+)분)?/); if (!m || !key) return;
            const t = D.tasks.find(y => same(y.title, m[2])); if (t) x.plan[key].push({ id:t.id, min:m[3] ? Number(m[3]) : null, done:m[1] !== ' ' });
          });
          const rKey = v => { const r = D.routines.find(y => same(y.title, unlink(v))), t = (String(v).match(/\|\s*(\d{1,2}:\d{2})\s*\]\]$/) || [])[1]; return r ? (t ? `${r.id}@${t.padStart(5, '0')}` : r.id) : null; };   // [[물 250ml|12:00]] → 'id@12:00'
          const rd = {}; (f.routines || []).map(rKey).filter(Boolean).forEach(k => rd[k] = true);
          if (Object.keys(rd).length) D.routineDone[date] = rd;
          const sk = (f.skipped || []).map(rKey).filter(Boolean);
          if (sk.length) x.skipped = sk;
        });
      }
      else if (type === 'record'){
        let k = kindByName(String(f.kind || '기록'));
        if (!k){ k = { id:String(f.kind) === '회의록' ? 'meeting' : newId('k'), name:String(f.kind || '기록'), fields:[], people:true, todos:true }; D.kinds.push(k); }
        // 설정에 칸이 없던 종류는 문서의 제목들로 칸을 만든다
        if (!k.fields.length) k.fields = d.order.filter(t => t !== '할 일').map((t, i) => ['f' + i, t]);
        const m = { id:id || newId('m'), kind:k.id, title:String(f.title || base(d.path).replace(/^\d{4}-\d{2}-\d{2}\s+/, '')), date:String(f.date || ''), time:String(f.time || '00:00'), attendees:(f.people || []).map(String), appt:null, todos:[], draft:!!f.draft };
        k.fields.forEach(([fk, label]) => { m[fk] = S[label] || ''; });
        const todoLines = String(S['할 일'] || '').split('\n').filter(l => /^\s*-\s+\[/.test(l));
        later.push(() => {
          const at = unlink(f.appointment); if (at){ const a = D.appts.find(x => same(apptName(x), at)) || D.appts.find(x => same(x.title, at)); if (a) m.appt = a.id; }
          m.todos = todoLines.map(l => { const mm = l.replace(/^\s*-\s+\[.\]\s+/, '').match(/^(.*?)(?:\s*→\s*\[\[(.+?)\]\])?$/); const t = mm[2] && D.tasks.find(x => same(x.title, mm[2])); return { t:mm[1].trim(), task:t ? t.id : null }; });
        });
        D.meetings.push(m);
      }
      else if (type === 'project'){
        const t = { id:id || newId('t'), title:String(f.title || base(d.path)), status:toVal(STATUS, f.status || 'todo'), area:unlink(f.area), due:f.due ? String(f.due) : '', estimate:f.estimate ? Number(f.estimate) : null,
          result:f.result ? String(f.result) : '', doneAt:f.done_at ? String(f.done_at) : '', created:f.created ? String(f.created) : '', waitOn:f.waiting_on ? String(f.waiting_on) : '', waitSince:f.waiting_since ? String(f.waiting_since) : '',
          todos:String(S['할 일'] || '').split('\n').map(l => l.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/)).filter(Boolean).map(m => ({ t:m[2].trim(), d:m[1] !== ' ' })),
          done:listLines(S['완료 조건']), memo:S['메모'] || '' };
        const fromT = unlink(f.from);
        if (fromT) later.push(() => { const m = D.meetings.find(x => same(recName(x), fromT) || same(x.title, fromT)); if (m) t.from = m.id; });
        D.tasks.push(t);
      }
      else if (type === 'area'){
        D.longs.push({ id:id || newId('L'), title:String(f.title || base(d.path)), metric:String(f.metric || ''), unit:toVal(UNIT, f.unit || 'times'), why:S['왜 관리하나'] || '', retro:S['회고'] || '',
          records:tableRows(S['누적 기록']).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r[0])).map(([date, amt, memo, src]) => ({ date, amt:Number(amt) || 0, memo:memo || '', src:src || '직접' })) });
      }
      else if (type === 'routine'){
        D.routines.push({ id:id || newId('R'), title:String(f.title || base(d.path)), enabled:f.enabled !== false, cron:String(f.cron || '0 9 * * *'), duration:Number(f.duration) || 30, block:f.block || null, area:unlink(f.area), amount:f.amount == null ? null : Number(f.amount), content:S['루틴 내용'] || '' });
      }
      else if (type === 'textbook'){
        // 읽기전용(SPEC §0-1) — 읽어서 보여 주기만 하고 serialize 는 쓰지 않는다. 경로를 그대로 들고 있는다
        const rel = d.path.startsWith(tbDir) ? d.path.slice(tbDir.length) : d.path;
        D.textbooks.push({ id:id || 'B' + pathId(rel), title:String(f.title || base(d.path)), book:String(f.book || rel.split('/')[0]), kind:String(f.kind || 'note'), chapter:f.chapter == null ? '' : String(f.chapter),
          order:f.order == null ? 9999 : Number(f.order), path:d.path, source:f.source ? String(f.source) : '', updated:f.updated ? String(f.updated).slice(0, 10) : '', body:d.body });
      }
      else if (type === 'cards'){
        // 교과서 노트 하나를 짧은 카드 여러 장으로 다시 쓴 것(SPEC §0-2) — 읽기전용, `## 카드 제목` 하나가 카드 한 장
        const cards = [...('\n' + d.body).matchAll(/\n## +(.+)\n([\s\S]*?)(?=\n## |$)/g)].map(m => { const q = m[2].match(/^\s*> \[!question\] *(.+)\n?/); return { title:m[1].trim(), q:q ? q[1].trim() : '', body:(q ? m[2].slice(q[0].length) : m[2]).trim() }; });   // 카드 바로 아래 > [!question] 줄 = 복습 질문
        D.tbCards.push({ id:id || 'C' + pathId(d.path), from:String(f.from || ''), fromHash:String(f.from_hash || ''), title:String(f.title || base(d.path)), book:String(f.book || ''), path:d.path, cards });
      }
      else if (type === 'appointment'){
        D.appts.push({ id:id || newId('a'), title:String(f.title || base(d.path)), start:String(f.start || ''), end:String(f.end || f.start || ''), location:f.location ? String(f.location) : '', attendees:(f.attendees || []).map(String), gcal_id:f.gcal_id ? String(f.gcal_id) : '', memo:S['메모'] || '' });
      }
      if (type === 'daily') paths[String(f.date || base(d.path))] = d.path;
      else if (Object.values(D).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0) > n0){
        const arr = { inbox:D.inbox, fleeting:D.fleeting, reference:D.refs, permanent:D.perms, context:D.ctxs, record:D.meetings, project:D.tasks, area:D.longs, routine:D.routines, appointment:D.appts }[type];
        if (arr && arr.length) paths[arr[arr.length - 1].id] = d.path;
      }
    }
    // 설정에 칸이 없는 기록 종류는 그 종류의 템플릿(_템플릿/기록_<이름>.md) 제목들로 칸을 만든다
    D.kinds.forEach(k => {
      if (k.fields.length) return;
      const tpl = files[`_템플릿/기록_${k.name}.md`]; if (!tpl) return;
      const td = parseDoc(tpl);
      k.fields = td.order.filter(t => t !== '할 일').map((t, i) => [k.id === 'meeting' ? ['agenda', 'talk', 'decisions'][i] || 'f' + i : 'f' + i, t]);
      k.people = 'people' in td.fm; k.todos = td.order.includes('할 일');
    });
    later.forEach(fn => fn());
    const realArea = t => { if (!t) return ''; const L = D.longs.find(x => same(x.title, t)); return L ? L.title : t; };
    D.tasks.forEach(t => { t.area = realArea(t.area); }); D.routines.forEach(r => { r.area = realArea(r.area); });
    if (!D.kinds.length) D.kinds = [{ id:'meeting', name:'회의록', fields:[['agenda', '안건'], ['talk', '논의'], ['decisions', '결정']], people:true, todos:true }];
    return { db:D, settings, paths };
  }
  const base = p => p.split('/').pop().replace(/\.md$/, '');
  const pathId = p => { let h = 2166136261; for (const c of p) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(36); };   // id 없는 교과서 파일 — 경로가 같으면 같은 id
  function tableRows(s){
    return String(s || '').split('\n').filter(l => /^\s*\|/.test(l) && !/^\s*\|\s*-/.test(l)).slice(1).map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
  }

  /* ---------- 바뀐 것만 고르기 ---------- */
  function diff(prev, next){
    const writes = {}, deletes = [];
    for (const [p, t] of Object.entries(next)) if (prev[p] !== t) writes[p] = t;
    for (const p of Object.keys(prev)) if (!(p in next) && !p.startsWith('_템플릿/')) deletes.push(p);
    return { writes, deletes, empty:!Object.keys(writes).length && !deletes.length };
  }

  const textHash = pathId;   // 카드가 만들어진 뒤 원본 노트가 바뀌었는지 — 같은 함수를 브라우저와 Node가 함께 쓴다
  const api = { FORMAT_VERSION, textHash, serialize, parse, diff, parseDoc, writeDoc, parseYaml, emptyDb, DEFAULT_FOLDERS, SETTINGS, STATUS, RSTATUS, FORMAT, UNIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PKMMD = api;
})(typeof self !== 'undefined' ? self : this);
