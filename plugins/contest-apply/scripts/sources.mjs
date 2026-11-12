// 공모전 사이트 4곳(위비티·씽굿·콘테스트코리아·링커리어)에서 네이밍·슬로건 분야 목록과 상세를 가져온다.
// parse*는 순수 함수, fetch*는 fetchText(url, opt)를 주입받는다. fetchList는 사이트 하나가 실패하면 throw하니, 부르는 쪽이 사이트별로 잡아 이름과 이유를 남긴다.
export const SITES = {
  wevity: { name: '위비티', base: 'https://www.wevity.com' },
  thinkcontest: { name: '씽굿', base: 'https://www.thinkcontest.com' },
  contestkorea: { name: '콘테스트코리아', base: 'https://www.contestkorea.com' },
  linkareer: { name: '링커리어', base: 'https://linkareer.com', api: 'https://api.linkareer.com/graphql' },
};

/* ---------- 글자 다듬기 ---------- */
const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", middot: '·', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', bull: '•', times: '×', rarr: '→', larr: '←' };
const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m);
export const htmlText = (html, max = 12000) => decode(String(html || '')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d|table|ul|ol)>/gi, '\n').replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/t[dh]>/gi, ' ')
  .replace(/<[^>]+>/g, ''))
  .replace(/[ \t ​]+/g, ' ').split('\n').map(l => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const one = s => htmlText(s).replace(/\s+/g, ' ').trim();
const pick = (re, s) => (re.exec(s) || [])[1] || '';
const ymd = s => { const m = /(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/.exec(s || ''); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : ''; };
const dates = s => { const d = (String(s || '').match(/\d{4}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}/g) || []).map(ymd); return d.length > 1 ? [d[0], d.at(-1)] : ['', d[0] || '']; };
const kst = ms => ms ? new Date(Number(ms) + 9 * 3600e3).toISOString().slice(0, 10) : '';
const today = (now, tz = 9) => new Date(now.getTime() + tz * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
// 'D-7' → 오늘+7, 'D+3' → 오늘-3, 'D-day'·'D-0' → 오늘
const fromDday = (dday, now, tz) => { const m = /D\s*([-+])\s*(\d+|day)/i.exec(dday || ''); return m ? addDays(today(now, tz), m[2].toLowerCase() === 'day' ? 0 : (m[1] === '-' ? 1 : -1) * Number(m[2])) : ''; };
// '11.16' → 오늘에 가장 가까운 해의 날짜
const fromMonthDay = (md, now) => {
  const m = /(\d{1,2})\.(\d{1,2})/.exec(md || ''); if (!m) return '';
  const y = Number(today(now).slice(0, 4)), at = yy => `${yy}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return [y - 1, y, y + 1].map(at).sort((a, b) => Math.abs(Date.parse(a) - now) - Math.abs(Date.parse(b) - now))[0];
};
const abs = (u, base) => { try { return u && !/^javascript:/i.test(u) ? new URL(decode(u), base).href : ''; } catch { return ''; } };
const links = (html, base) => [...String(html || '').matchAll(/<a\b[^>]*?href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({ name: one(m[2]), url: abs(m[1], base) }));
const IMG = /\.(jpe?g|png|gif|webp|bmp)$/i, DOC = /\.(hwpx?|pdf|docx?|xlsx?|pptx?|zip|txt|odt)(\?|$)/i;
const att = (name, url, opt, more) => ({ name, url, ...(opt ? { opt } : {}), ...(IMG.test(name) ? { kind: 'image' } : {}), ...more });
// 본문에 문서 파일로 바로 걸린 링크(요강·신청서)
const docLinks = (html, base) => links(html, base).filter(l => l.url && (DOC.test(l.url) || DOC.test(l.name))).map(l => att(l.name || l.url.split('/').pop(), l.url));
const uniq = xs => xs.filter((x, i) => xs.findIndex(y => y.url === x.url && y.opt?.body === x.opt?.body) === i);
const item = (site, id, o) => ({ source: SITES[site].name, site, key: `${site}:${id}`, title: '', url: '', organizer: '', deadline: '', category: '', ...o });
const detail = o => ({ text: '', deadline: '', start: '', announce: '', prize: '', eligibility: '', method: '', homepage: '', organizer: '', category: '', attachments: [], ...o });
const fail = site => { throw new Error(`모르는 사이트: ${site}`); };
const nextData = html => JSON.parse(pick(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/, html) || 'null');

/* ---------- 요청 ---------- */
const LK_LIST = 'query($p:Int!){ activities(filterBy:{activityTypeID:"3",status:OPEN,categoryIDs:["32"]},orderBy:{field:CREATED_AT,direction:DESC},pagination:{page:$p,pageSize:20}){ totalCount nodes { id title organizationName recruitStartAt recruitCloseAt categories { name } } } }';
const json = body => ({ method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body) });
export const listUrls = (site, pages = 2) => Array.from({ length: Math.max(1, pages) }, (_, i) => i + 1).map(p => ({
  // 위비티 분야 cidx=25, 씽굿 contest_field=CCFD006, 콘테스트코리아 Txt_bcode=030210001, 링커리어 categoryIDs 32 (모두 '네이밍/슬로건')
  wevity: { url: `${SITES.wevity.base}/?c=find&s=1&gub=1&cidx=25&gp=${p}` },
  thinkcontest: { url: `${SITES.thinkcontest.base}/thinkgood/user/contest/subList.do`, opt: json({ recordsPerPage: 10, currentPageNo: p, contest_field: 'CCFD006', host_organ: '', enter_qualified: '', award_size: '', searchStatus: 'Y', sidx: 'putup_sdt', sord: 'DESC' }) },
  contestkorea: { url: `${SITES.contestkorea.base}/sub/list.php?int_gbn=1&Txt_bcode=030210001&page=${p}` },
  linkareer: { url: SITES.linkareer.api, opt: json({ query: LK_LIST, variables: { p } }) },
})[site] || fail(site));

/* ---------- 목록 ---------- */
const ok = (j, bad) => { const why = bad(j); if (why) throw new Error(why); return j; };   // API가 오류를 200으로 돌려줄 때
const LIST = {
  wevity: (b, now) => [...b.matchAll(/<li\b[^>]*>\s*(?:<!--[\s\S]*?-->\s*)?<div class="tit">([\s\S]*?)<\/li>/g)].map(([, li]) => {
    const ix = pick(/[?&]ix=(\d+)/, li); if (!ix) return null;
    const dday = one(pick(/<div class="day">\s*([^<]*)/, li));
    // 위비티의 D-day는 UTC 날짜 기준으로 셈한다(정확한 마감일은 상세의 접수기간)
    return item('wevity', ix, { title: one(pick(/<a [^>]*>([\s\S]*?)<\/a>/, li).replace(/<span[\s\S]*?<\/span>/g, '')), url: `${SITES.wevity.base}/?c=find&s=1&gub=1&cidx=25&gbn=viewok&ix=${ix}`,
      organizer: one(pick(/<div class="organ">([\s\S]*?)<\/div>/, li)), deadline: fromDday(dday, now, 0), category: one(pick(/<div class="sub-tit">([\s\S]*?)<\/div>/, li)).replace(/^분야\s*:\s*/, ''), dday });
  }),
  thinkcontest: b => (ok(JSON.parse(b), j => j.status != 1 && j.msg).listJsonData || []).map(x => item('thinkcontest', x.contest_pk, { title: one(x.program_nm), url: `${SITES.thinkcontest.base}/thinkgood/user/contest/view.do?contest_pk=${x.contest_pk}`,
    organizer: one(x.host_company || ''), deadline: ymd(x.finish_dt), category: x.contest_field_nm || '', ...(x.dday ? { dday: x.dday } : {}) })),
  contestkorea: (b, now) => (b.split('<div class="list_style_2">')[1] || '').split(/<li\b[^>]*>\s*(?=(?:<!--[\s\S]*?-->\s*)*<div class="title">)/).slice(1).map(li => {
    const no = pick(/view\.php\?[^"]*str_no=(\d+)/, li); if (!no) return null;
    const dday = one(pick(/<span class="day"[^>]*>([\s\S]*?)<\/span>/, li)), end = pick(/<em>접수<\/em>\s*[\d.]+\s*~\s*([\d.]+)/, li);
    return item('contestkorea', no, { title: one(pick(/<span class="txt">([\s\S]*?)<\/span>/, li)), url: `${SITES.contestkorea.base}/sub/view.php?int_gbn=1&Txt_bcode=030210001&str_no=${no}`,
      organizer: one(pick(/<strong>주최<\/strong>\s*\.?([\s\S]*?)<\/li>/, li)), deadline: fromMonthDay(end, now) || fromDday(dday, now),
      category: [...li.matchAll(/<span class="category">([\s\S]*?)<\/span>/g)].map(m => one(m[1])).join(', '), ...(dday ? { dday } : {}) });
  }),
  linkareer: b => (ok(JSON.parse(b), j => !j.data && j.errors?.[0]?.message).data?.activities?.nodes || []).map(x => item('linkareer', x.id, { title: one(x.title), url: `${SITES.linkareer.base}/activity/${x.id}`,
    organizer: x.organizationName || '', deadline: kst(x.recruitCloseAt), category: (x.categories || []).map(c => c.name).join(', ') })),
};
export const parseList = (site, body, { now = new Date() } = {}) => (LIST[site] || fail(site))(String(body || ''), now).filter(x => x && x.title && x.url);

/* ---------- 상세 ---------- */
const rows = (html, re) => [...String(html || '').replace(/<!--[\s\S]*?-->/g, '').matchAll(re)].map(m => [one(m[1]), m[2]]);
const byLabel = (rs, re) => (rs.find(([k]) => re.test(k)) || [])[1] || '';
const DETAIL = {
  wevity: b => {
    const rs = rows(pick(/<ul class="cd-info-list">([\s\S]*?)<li class="sns">/, b), /<span class="tit">([^<]*)<\/span>([\s\S]*?)<\/li>/g), [start, deadline] = dates(one(byLabel(rs, /접수기간/)));
    const prize = [['총 상금', /^총\s*상금/], ['1등', /^1등/]].map(([n, re]) => one(byLabel(rs, re)) && `${n} ${one(byLabel(rs, re))}`).filter(Boolean).join(' · ');
    const body = pick(/<div class="comm-desc" id="viewContents">([\s\S]*?)<a name="interview">/, b);
    // 첨부는 fDown(ix) → filedown_contest.php에 ix를 POST해야 받히고, 파일 이름은 주석에 있다
    const files = [...pick(/<span class="tit">첨부파일<\/span>([\s\S]*?)<\/li>/, b).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, a, t]) => {
      const ix = pick(/fDown\(\s*'?(\d+)/, a), name = pick(/<!--\s*([\s\S]*?)\s*-->/, t) || one(t);
      return ix ? att(name, `${SITES.wevity.base}/common/modules/filedown_contest.php`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `ix=${ix}` }) : att(name, abs(pick(/href="([^"]*)"/, a), SITES.wevity.base));
    }).filter(x => x.url);
    return detail({ text: htmlText(body), start, deadline, prize, eligibility: one(byLabel(rs, /응모대상/)),
      organizer: one(byLabel(rs, /주최/)).replace(/\s*\/\s*$/, ''), category: one(byLabel(rs, /^분야/)), homepage: links(byLabel(rs, /홈페이지/), SITES.wevity.base)[0]?.url || '',
      attachments: uniq([...files, ...docLinks(body, SITES.wevity.base)]) });
  },
  thinkcontest: b => {
    const rs = rows(pick(/<div class="info position-relative[^"]*">([\s\S]*?)<div class="mt_30 view-tab">/, b), /<div class="tit">([\s\S]*?)<\/div>\s*<div class="txt[^"]*">([\s\S]*?)<\/div>/g), [start, deadline] = dates(byLabel(rs, /접수기간/));
    const list = re => htmlText(byLabel(rs, re)).split('\n').map(x => x.replace(/^-\s*/, '').trim()).filter(Boolean).join(', ');
    const body = pick(/<div id="contest_content"[^>]*>([\s\S]*?)<\/div>\s*<naver-content/, b), cell = byLabel(rs, /첨부/);
    // 파일 하나면 data-file_key로 filedown.do, 여럿이면 zipfiledown.do로 한 zip에 묶여 온다(담긴 파일 이름은 툴팁에)
    const pk = pick(/changeUrl\(`\/thinkgood\/user\/contest\/view\.do\?contest_pk=(\d+)/, b), zipName = decode(pick(/name="zipfilename" value="([^"]*)"/, b));
    const files = [...cell.matchAll(/<a\b([^>]*attechFile[^>]*)>([\s\S]*?)<\/a>/g)].map(([, a, t]) => {
      const key = pick(/data-file_key="([^"]+)"/, a), name = one(t.replace(/<span class="vol">[\s\S]*?<\/span>/, ''));
      if (key) return att(name, `${SITES.thinkcontest.base}/thinkgood/common/filedown.do?file_key=${encodeURIComponent(key)}`);
      const contains = htmlText(pick(/<span class="tooltiptext[^"]*">([\s\S]*?)<\/span>/, cell)).split('\n').map(x => x.replace(/^-\s*/, '').trim()).filter(Boolean);
      return pk && att(`${zipName || name.replace(/\.zip$/i, '')}.zip`, `${SITES.thinkcontest.base}/thinkgood/common/zipfiledown.do?zipfile_nm=${encodeURIComponent(zipName)}&page_gubun=contest&gubun_fk=${pk}`, null, contains.length ? { contains } : {});
    }).filter(Boolean);
    return detail({ text: htmlText(body), start, deadline, prize: list(/시상금|총상금/) && `${byLabel(rs, /1등/) ? '1등 ' : ''}${list(/시상금|총상금/)}`,
      eligibility: list(/참가자격|응모자격/), method: list(/접수방법/), homepage: links(byLabel(rs, /홈페이지/), SITES.thinkcontest.base)[0]?.url || '', organizer: list(/^주최$/), category: list(/응모분야/),
      attachments: uniq([...files, ...docLinks(body, SITES.thinkcontest.base)]) });
  },
  contestkorea: b => {
    const rs = rows(pick(/<div class="txt_area">([\s\S]*?)<\/table>/, b), /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)(?=<\/td>|<\/tr>)/g), [start, deadline] = dates(byLabel(rs, /접수기간/));
    const area = pick(/<div class="view_detail_area">([\s\S]*?)<!-- \/\/세부요강 -->/, b), box = pick(/<div class="attachments">([\s\S]*?)<\/div>/, area);
    const body = area.replace(/<div class="attachments">[\s\S]*?<\/div>/, '').replace(/<h2 class="tip\d"[\s\S]*?<\/h2>/g, '').replace(/<p class="tip_box\d"[\s\S]*?<\/p>/g, '');
    const files = links(box, `${SITES.contestkorea.base}/sub/`).filter(l => l.url).map(l => att(l.name, l.url));
    return detail({ text: htmlText(body), start, deadline, announce: ymd(byLabel(rs, /발표/)), prize: one(byLabel(rs, /시상/)), eligibility: one(byLabel(rs, /참가대상|응모대상/)).replace(/\s*,\s*/g, ', ').replace(/,\s*$/, ''),
      method: one(byLabel(rs, /접수방법/)), homepage: links(byLabel(rs, /홈페이지/) || byLabel(rs, /접수하기/), SITES.contestkorea.base)[0]?.url || '',
      organizer: one(byLabel(rs, /주최/)), category: one(byLabel(rs, /분야/)), attachments: uniq([...files, ...docLinks(body, SITES.contestkorea.base)]) });
  },
  linkareer: b => {
    const st = nextData(b)?.props?.pageProps?.__APOLLO_STATE__ || {}, ref = r => (r && st[r.__ref]) || r || {};
    const a = ref(Object.entries(st.ROOT_QUERY || {}).find(([k]) => k.startsWith('activity('))?.[1]), names = xs => (xs || []).map(x => ref(x).name).filter(Boolean).join(', ');
    const prize = (a.integers || []).map(ref).map(i => { const t = ref(i.type); return i.integer && `${t.name || ''} ${i.integer}${t.unit || ''}`.trim(); }).filter(Boolean).join(' · ');
    const files = (a.files || []).map(ref).filter(f => f.url && ref(f.type).name !== '썸네일');
    return detail({ text: htmlText(ref(a.detailText).text), start: kst(a.recruitStartAt), deadline: kst(a.recruitCloseAt), prize, eligibility: names(a.targets), method: names(a.applyTypes),
      homepage: a.homepageURL || (/^https?:\/\//.test(a.applyDetail || '') ? a.applyDetail : ''), organizer: a.organizationName || '', category: names(a.categories),
      attachments: uniq([...files.map(f => att(f.filename || ref(f.type).name || 'file', f.url, null, ref(f.type).name ? { label: ref(f.type).name } : {})), ...docLinks(ref(a.detailText).text, SITES.linkareer.base)]) });
  },
};
export const parseDetail = (site, body) => (DETAIL[site] || fail(site))(String(body || ''));

/* ---------- 주최 홈페이지 공고의 첨부 ---------- */
const SIZE = /\s*[\[(]\s*[\d.,]+\s*(?:bytes?|[kmg]b?)\s*[\])]\s*$/i, FILE = /\.(hwpx?|pdf|docx?|xlsx?|pptx?|zip|txt|odt|jpe?g|png|gif|webp|bmp)$/i, DOWN = /download|filedown|atchfile|attach|file_dn/i;
const noHash = u => String(u || '').replace(/#.*$/, '');
const urlFile = u => { const f = new URL(u).pathname.split('/').pop(); try { return decodeURIComponent(f); } catch { return f; } };
const anchors = html => [...String(html || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(([, a, t]) => ({ a, href: pick(/\bhref\s*=\s*"([^"]*)"/i, a) || pick(/\bhref\s*=\s*'([^']*)'/i, a), text: one(t).replace(SIZE, '') }));
export function parseHomeAttachments(html, pageUrl){
  const base = noHash(pageUrl), out = [];
  // KISA: 본문 첨부 영역(board_detail_attach)의 fnPostAttachDownload(menuSeq, postSeq, attachSeq, lang) → /post/fileDownload. 영역 밖의 소개자료 링크는 뺀다
  for (const x of anchors(pick(/class="board_detail_attach"([\s\S]*?)<\/ul>/, html))){
    const m = /fnPostAttachDownload\(\s*'?(\d+)'?\s*,\s*'?(\d+)'?\s*,\s*'?(\d+)'?\s*,\s*'?(\w+)'?/.exec(x.a);
    const url = m && abs(`/post/fileDownload?menuSeq=${m[1]}&postSeq=${m[2]}&attachSeq=${m[3]}&lang_type=${m[4]}`, base);
    if (url && x.text) out.push(att(x.text, url));
  }
  // 일반: 주소가 문서 파일로 끝나거나, 링크 글자가 파일 이름인 내려받기 주소
  for (const x of anchors(html)){
    if (!x.href || /^\s*(#|javascript:|mailto:|tel:)/i.test(x.href)) continue;
    const url = noHash(abs(x.href, base)); if (!/^https?:/.test(url)) continue;
    const byUrl = DOC.test(url), file = byUrl ? urlFile(url) : '';
    if (byUrl) out.push(att(!x.text ? file : FILE.test(x.text) ? x.text : x.text + pick(/(\.\w+)$/, file), url));
    else if (FILE.test(x.text) && DOWN.test(url)) out.push(att(x.text, url));
  }
  return uniq(out).slice(0, 10);
}

/* ---------- 받아도 되는 주소인지 ---------- */
// robots.txt — 우리 이름(ua)의 묶음이 있으면 그것, 없으면 * 묶음. 가장 길게 맞는 규칙이 이기고, 같으면 Allow
export function robotsAllowed(txt, ua, pathAndQuery){
  const groups = []; let cur = null, lastUa = false;
  for (const raw of String(txt || '').split(/\r?\n/)){
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(raw.replace(/#.*/, '').trim()); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent'){ if (!lastUa) groups.push(cur = { agents: [], rules: [] }); cur.agents.push(v.toLowerCase()); lastUa = true; continue; }
    lastUa = false;
    if (cur && v && (k === 'allow' || k === 'disallow')) cur.rules.push({ allow: k === 'allow', path: v });   // "Disallow:" 빈 값은 모두 허용
  }
  const name = String(ua).toLowerCase().split('/')[0];
  const mine = groups.filter(g => g.agents.some(a => a !== '*' && name.includes(a))), use = mine.length ? mine : groups.filter(g => g.agents.includes('*'));
  const re = p => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  let best = null;
  for (const r of use.flatMap(g => g.rules)) if (re(r.path).test(pathAndQuery) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  return !best || best.allow;
}
// 홈페이지 주소는 외부 데이터라, 내 컴퓨터·사설망으로 가는 주소는 요청하지 않는다(이름·IP 글자만 본다)
const privateV4 = ([a, b]) => a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
export const isPublicUrl = url => {
  let u; try { u = new URL(url); } catch { return false; }
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!/^https?:$/.test(u.protocol) || !h || h === 'localhost' || /\.(localhost|local)$/.test(h)) return false;
  if (/^[\d.]+$/.test(h)) return !privateV4(h.split('.').map(Number));
  if (!h.startsWith('[')) return true;
  const v6 = h.slice(1, -1), m = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(v6);   // IPv4를 감싼 주소
  if (m) return !privateV4([parseInt(m[1], 16) >> 8, parseInt(m[1], 16) & 255]);
  return !(v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6));
};

/* ---------- 가져오기 ---------- */
const UA = 'pkm-contest-apply/0.1 (personal use)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0;
const turn = async () => { const wait = last + Number(process.env.CA_GAP_MS ?? 1500) - Date.now(); if (wait > 0) await sleep(wait); last = Date.now(); };   // 요청 사이 간격
export async function defaultFetchText(url, opt = {}){
  await turn();
  const r = await fetch(url, { ...opt, headers: { 'user-agent': UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${new URL(url).host}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const cs = (pick(/charset=["']?([\w-]+)/i, r.headers.get('content-type') || '') || pick(/<meta[^>]+charset=["']?([\w-]+)/i, new TextDecoder('latin1').decode(buf.slice(0, 4096))) || 'utf-8').toLowerCase();
  return new TextDecoder(/euc-?kr|ks_c_5601|cp949|x-windows-949/.test(cs) ? 'euc-kr' : 'utf-8').decode(buf);
}
export async function fetchList(site, { fetchText = defaultFetchText, pages = 2, now = new Date() } = {}){
  const out = new Map();
  for (const { url, opt } of listUrls(site, pages)){
    const got = parseList(site, await fetchText(url, opt), { now });
    const before = out.size;
    for (const x of got) if (!out.has(x.key)) out.set(x.key, x);
    if (!got.length || out.size === before) break;
  }
  return [...out.values()];
}
export const fetchDetail = async (item, { fetchText = defaultFetchText } = {}) => parseDetail(item.site, await fetchText(item.url));
const robotsCache = new Map();   // 사이트마다 robots.txt는 한 번만
async function robotsOk(url, fetchText){
  const { origin, pathname, search } = new URL(url);
  // 없음(4xx)은 허용, 못 읽음(5xx·연결 실패)은 막힌 것으로
  if (!robotsCache.has(origin)) robotsCache.set(origin, Promise.resolve().then(() => fetchText(`${origin}/robots.txt`)).catch(e => /^4\d\d\b/.test(e?.message || '') ? '' : null));
  const txt = await robotsCache.get(origin);
  return txt != null && robotsAllowed(txt, UA, pathname + search);
}
// 공고 페이지가 robots.txt로 막혀 있거나 내부 주소면 요청하지 않고 []. 내려받기 주소가 막힌 첨부는 blocked: true(부르는 쪽이 사람에게 링크로 보여 준다)
export async function fetchHomeAttachments(pageUrl, { fetchText = defaultFetchText } = {}){
  const url = noHash(pageUrl);
  if (!isPublicUrl(url) || !(await robotsOk(url, fetchText))) return [];
  const list = parseHomeAttachments(await fetchText(url), url).filter(a => isPublicUrl(a.url));
  for (const a of list) if (!(await robotsOk(a.url, fetchText))) a.blocked = true;
  return list;
}

// 페이지 안의 구글 폼·네이버 폼 주소(링크와 글 어디에 있든). 요강에 폼 주소가 빠진 공모전의 접수 폼을 찾을 때 쓴다 — 어느 폼이 이 공모전 것인지는 부르는 쪽이 가린다
const FORM_LINK = /https?:(?:\/\/|\\\/\\\/)(?:form\.naver\.com(?:\/|\\\/)response|naver\.me|forms\.gle|docs\.google\.com(?:\/|\\\/)forms)(?:\/|\\\/)[^\s"'<>)\\]*(?:\\\/[^\s"'<>)\\]*)*/gi;
export const parseFormLinks = html => [...new Set((String(html || '').match(FORM_LINK) || []).map(u => u.replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/[.,]+$/, '')))].slice(0, 8);
export async function fetchFormLinks(pageUrl, { fetchText = defaultFetchText, robots = true } = {}){
  const url = noHash(pageUrl);
  if (!isPublicUrl(url) || (robots && !(await robotsOk(url, fetchText)))) return [];
  return parseFormLinks(await fetchText(url));
}

/* ---------- 첨부 받기 ---------- */
const MAX = 10 * 1024 * 1024;
const TYPES = { hwp: 'application/x-hwp', hwpx: 'application/hwp+zip', pdf: 'application/pdf', zip: 'application/zip', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
export const safeName = s => String(s || '').replace(/\.\.+/g, '').replace(/[\/\\\x00-\x1f]/g, '').trim();
const pctBytes = s => Buffer.from(s.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
const bytesText = (buf, cs = '') => { if (!/euc-?kr|cp949|ks_c/i.test(cs)) try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {} return new TextDecoder('euc-kr').decode(buf); };
// Content-Disposition → 파일 이름. filename*=UTF-8''…(RFC 5987), 퍼센트 인코딩(UTF-8·EUC-KR), 날 바이트(fetch는 latin1 글자로 준다) 모두
export const fileNameFrom = cd => {
  const star = /filename\*\s*=\s*"?([\w-]*)'[^']*'([^;"]+)/i.exec(cd || '');
  if (star) return safeName(bytesText(pctBytes(star[2].trim()), star[1]));
  const m = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(cd || ''); if (!m) return '';
  const raw = (m[1] ?? m[2]).trim();
  return safeName(/[^\x00-\xff]/.test(raw) ? raw : bytesText(/%[0-9a-f]{2}/i.test(raw) ? pctBytes(raw) : Buffer.from(raw, 'latin1')));
};
export async function defaultFetchBytes(url, opt = {}){
  await turn();
  const r = await fetch(url, { ...opt, headers: { 'user-agent': UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${new URL(url).host}`);
  const big = () => new Error('첨부가 10MB를 넘어요');
  if (Number(r.headers.get('content-length')) > MAX) { await r.body?.cancel(); throw big(); }
  const parts = []; let n = 0;
  for await (const c of r.body || []){ n += c.length; if (n > MAX) throw big(); parts.push(c); }
  return { bytes: Buffer.concat(parts), type: (r.headers.get('content-type') || '').split(';')[0].trim(), name: fileNameFrom(r.headers.get('content-disposition')) };
}
export async function fetchFile(att, { fetchBytes = defaultFetchBytes } = {}){
  if (att.blocked) throw new Error('주최 홈페이지가 자동 내려받기를 막아 두었어요');
  if (!isPublicUrl(att.url)) throw new Error('내부 주소라 받지 않아요');
  const r = await fetchBytes(att.url, att.opt);
  let bytes = Buffer.from(r.bytes), type = r.type || '';
  // 씽굿 zip 묶음은 base64를 JSON 문자열로 감싸 보낸다
  if (bytes[0] === 0x22 && bytes.subarray(1, 5).toString() === 'UEsD') { bytes = Buffer.from(JSON.parse(bytes.toString()), 'base64'); type = 'application/zip'; }
  const name = safeName(r.name || att.name) || 'attachment', ext = pick(/\.(\w+)$/, name).toLowerCase();
  if (!type || /octet-stream|unknown/i.test(type)) type = TYPES[ext] || 'application/octet-stream';
  return { name, bytes, type };
}
