// 공모전 신청 플러그인의 사이트 모듈(plugins/contest-apply/scripts/sources.mjs) — 저장해 둔 실제 응답으로 목록·상세 파싱만 본다(네트워크 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as S from '../plugins/contest-apply/scripts/sources.mjs';
import { FX_DIR, HAS_FX, NO_FX } from './contest-fixtures.mjs';

if (!HAS_FX) test(NO_FX, { skip: true }, () => {});
else {

const FIX = FX_DIR;
const read = f => fs.readFileSync(FIX + f, 'utf8');
const NOW = new Date('2026-11-09T16:10:00Z');   // fixture를 받은 시각
const LIST = { wevity: 'wevity-list.html', thinkcontest: 'thinkcontest-list.json', contestkorea: 'contestkorea-list.html', linkareer: 'linkareer-list.json' };

for (const site of Object.keys(S.SITES)){
  test(`${S.SITES[site].name}: 목록에서 제목·주소·키·마감일을 뽑는다`, () => {
    const list = S.parseList(site, read(LIST[site]), { now: NOW });
    assert.ok(list.length >= 1);
    for (const x of list){
      assert.equal(x.site, site);
      assert.equal(x.source, S.SITES[site].name);
      assert.ok(x.title && !/[<>]/.test(x.title), x.title);
      assert.match(x.url, /^https:\/\//);
      assert.match(x.key, new RegExp(`^${site}:\\w+$`));
      assert.match(x.deadline, /^(\d{4}-\d{2}-\d{2})?$/);
    }
    assert.equal(new Set(list.map(x => x.key)).size, list.length);
    assert.ok(list.some(x => x.deadline));
  });

  test(`${S.SITES[site].name}: 상세에서 태그 없는 본문과 접수기간을 뽑는다`, () => {
    const d = S.parseDetail(site, read(`${site}-detail.html`));
    assert.ok(d.text.length > 100);
    assert.ok(d.text.length <= 12000);
    assert.doesNotMatch(d.text, /<\/?[a-z][^>]*>|&(nbsp|amp|lt|gt|quot);/i);
    assert.match(d.deadline, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(d.start, /^\d{4}-\d{2}-\d{2}$/);
    for (const k of ['announce', 'prize', 'eligibility', 'method', 'homepage', 'organizer', 'category']) assert.equal(typeof d[k], 'string', k);
    assert.ok(Array.isArray(d.attachments));
    if (d.homepage) assert.match(d.homepage, /^https?:\/\//);
  });
}

test('사이트별 상세 표의 값을 그대로 옮긴다', () => {
  const w = S.parseDetail('wevity', read('wevity-detail.html'));
  assert.equal(w.deadline, '2026-11-18');
  assert.equal(w.category, '네이밍/슬로건');
  assert.match(w.prize, /1등 300만원/);
  const t = S.parseDetail('thinkcontest', read('thinkcontest-detail.html'));
  assert.equal(t.method, '접수폼');
  assert.equal(t.homepage, 'https://forms.gle/kZd1UsysL9jrrsbG7');
  const c = S.parseDetail('contestkorea', read('contestkorea-detail.html'));
  assert.equal(c.method, '온라인접수');
  assert.doesNotMatch(c.text, /AI 3줄 요약|AI 해시태그/);
  const l = S.parseDetail('linkareer', read('linkareer-detail.html'));
  assert.equal(l.deadline, '2026-11-18');
  assert.equal(l.method, '접수페이지');
  assert.ok(l.attachments.every(a => a.url.startsWith('https://')));
});

test('목록 요청은 사이트마다 페이지 수만큼, 같은 글은 한 번만', async () => {
  for (const site of Object.keys(S.SITES)) assert.equal(S.listUrls(site, 2).length, 2);
  assert.throws(() => S.listUrls('nope'));
  const calls = [];
  const fetchText = async (url, opt) => { calls.push({ url, opt }); return read(LIST.thinkcontest); };
  const list = await S.fetchList('thinkcontest', { fetchText, pages: 2 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].opt.method, 'POST');
  assert.equal(list.length, new Set(list.map(x => x.key)).size);
  const d = await S.fetchDetail(list[0], { fetchText: async url => { assert.equal(url, list[0].url); return read('thinkcontest-detail.html'); } });
  assert.ok(d.text);
});

test('글자 다듬기: 태그·엔티티를 풀고 빈 줄을 정리한다', () => {
  assert.equal(S.htmlText('<p>가&nbsp;나&amp;다</p><p><br></p><p><br></p><div>라 &#49;&#x32;</div><script>x()</script>'), '가 나&다\n\n라 12');
});

test('첨부: 사이트마다 바로 받을 수 있는 요청 꼴로 뽑는다', () => {
  const w = S.parseDetail('wevity', read('wevity-detail-files.html')).attachments;
  assert.deepEqual(w, [{ name: '20261109111745_ea8e1641.hwp', url: 'https://www.wevity.com/common/modules/filedown_contest.php', opt: { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'ix=112247' } }]);
  const [t] = S.parseDetail('thinkcontest', read('thinkcontest-detail-files.html')).attachments;
  assert.match(t.url, /^https:\/\/www\.thinkcontest\.com\/thinkgood\/common\/zipfiledown\.do\?zipfile_nm=.+&page_gubun=contest&gubun_fk=112488$/);
  assert.equal(t.name, '강남구중독관리통합지원센터 캐릭터 공모전.zip');
  assert.deepEqual(t.contains, ['강남구중독관리통합지원센터 캐릭터 공모전 신청서 양식.hwpx', '강남구중독관리통합지원센터 캐릭터 공모전 참가자 모집 안내문.pdf']);
  const c = S.parseDetail('contestkorea', read('contestkorea-detail-files.html'));
  assert.equal(c.attachments.length, 3);
  assert.equal(c.attachments[0].name, '2027 도서관의 날·도서관주간 공식주제 공모전 신청서.hwp');
  assert.equal(c.attachments[0].url, 'https://www.contestkorea.com/sub/file_dn.php?str_gbn=3&str_no=202611090006');
  assert.doesNotMatch(c.text, /신청 시 유의사항\.hwp/);
  const [l] = S.parseDetail('linkareer', read('linkareer-detail.html')).attachments;
  assert.equal(l.kind, 'image');
  assert.equal(l.label, '포스터');
});

test('Content-Disposition에서 파일 이름을 풀고 경로 문자는 지운다', () => {
  const latin1 = s => Buffer.from(s, 'utf8').toString('latin1');   // fetch는 날 바이트를 latin1 글자로 준다
  assert.equal(S.fileNameFrom("attachment; filename*=UTF-8''%EC%8B%A0%EC%B2%AD%EC%84%9C.hwp"), '신청서.hwp');
  assert.equal(S.fileNameFrom("attachment; filename*=EUC-KR''%BD%C5%C3%BB%BC%AD.hwp"), '신청서.hwp');
  assert.equal(S.fileNameFrom('attachment;filename="%BD%C5%C3%BB%BC%AD.hwp"'), '신청서.hwp');
  assert.equal(S.fileNameFrom(latin1('attachment;filename="2027 신청서.hwp"')), '2027 신청서.hwp');
  assert.equal(S.fileNameFrom(Buffer.from([...Buffer.from('attachment; filename="'), 0xBD, 0xC5, 0xC3, 0xBB, 0xBC, 0xAD, ...Buffer.from('.hwp"')]).toString('latin1')), '신청서.hwp');
  assert.equal(S.fileNameFrom(latin1('attachment; filename="../..\\신청서.hwp"; filename*=UTF-8\'\'..%2F%2E%2E%2Fa.hwp')), 'a.hwp');
  assert.equal(S.fileNameFrom('attachment; filename=plain.hwp'), 'plain.hwp');
  assert.equal(S.fileNameFrom('inline'), '');
});

test('fetchFile: 응답 이름을 우선하고, 씽굿의 base64 zip을 풀고, 형식을 채운다', async () => {
  const zip = Buffer.from('PK\x03\x04rest', 'latin1');
  const calls = [];
  const fetchBytes = async (url, opt) => { calls.push({ url, opt }); return { bytes: Buffer.from(JSON.stringify(zip.toString('base64'))), type: 'application/octet-stream', name: '' }; };
  const r = await S.fetchFile({ name: '묶음.zip', url: 'https://x/zip' }, { fetchBytes });
  assert.deepEqual(r, { name: '묶음.zip', bytes: zip, type: 'application/zip' });
  const opt = { method: 'POST', body: 'ix=1' };
  const h = await S.fetchFile({ name: 'a.hwp', url: 'https://x/d', opt }, { fetchBytes: async (url, o) => { calls.push({ url, opt: o }); return { bytes: Buffer.from('HWP'), type: 'file/unknown', name: '../신청서.hwp' }; } });
  assert.deepEqual([h.name, h.type], ['신청서.hwp', 'application/x-hwp']);
  assert.equal(calls.at(-1).opt, opt);
});

test('defaultFetchBytes: 10MB를 넘으면 멈추고, 이름은 헤더에서', async () => {
  const real = globalThis.fetch, gap = process.env.CA_GAP_MS;
  process.env.CA_GAP_MS = '0';
  const MB = 1024 * 1024;
  const stream = (n, size) => new ReadableStream({ pull(c){ if (n-- > 0) c.enqueue(new Uint8Array(size)); else c.close(); } });
  try {
    globalThis.fetch = async () => new Response(stream(1, 10), { headers: { 'content-length': String(11 * MB) } });
    await assert.rejects(S.defaultFetchBytes('https://x/a'), /첨부가 10MB를 넘어요/);
    globalThis.fetch = async () => new Response(stream(11, MB));
    await assert.rejects(S.defaultFetchBytes('https://x/b'), /첨부가 10MB를 넘어요/);
    let seen;
    globalThis.fetch = async (url, o) => { seen = o; return new Response(stream(2, 3), { headers: { 'content-type': 'file/unknown', 'content-disposition': "attachment; filename*=UTF-8''%EC%96%91%EC%8B%9D.hwpx" } }); };
    const r = await S.defaultFetchBytes('https://x/c', { method: 'POST', body: 'ix=1' });
    assert.deepEqual([r.name, r.type, r.bytes.length], ['양식.hwpx', 'file/unknown', 6]);
    assert.equal(seen.method, 'POST');
    assert.match(seen.headers['user-agent'], /pkm-contest-apply/);
    globalThis.fetch = async () => new Response('no', { status: 404 });
    await assert.rejects(S.defaultFetchBytes('https://x/d'), /404/);
  } finally {
    globalThis.fetch = real;
    if (gap == null) delete process.env.CA_GAP_MS; else process.env.CA_GAP_MS = gap;
  }
});

test('신청서 양식 fixture가 HWP·HWPX 파일이다', () => {
  assert.equal(fs.readFileSync(FIX + 'form-contestkorea.hwp').subarray(0, 4).toString('hex'), 'd0cf11e0');
  assert.equal(fs.readFileSync(FIX + 'form-thinkcontest.hwpx').subarray(0, 4).toString('hex'), '504b0304');
});

test('홈페이지 공고(KISA): 본문 첨부 영역의 문서 3개와 이미지 1개만, 소개자료 링크는 뺀다', () => {
  const list = S.parseHomeAttachments(read('home-kisa.html'), 'https://www.kisa.or.kr/401/form?postSeq=3791&page=1#fnPostAttachDownload');
  assert.deepEqual(list.map(a => a.name), ['[붙임1] 모두의 KISA 공고.pdf', '[붙임2] 모두의 KISA 국민제안서 양식 모음.hwpx', '[붙임3] 모두의 KISA 개인정보 수집·이용 동의서.hwpx', '[붙임4] 모두의 KISA 홍보 포스터.png']);
  assert.deepEqual(list.map(a => a.kind), [undefined, undefined, undefined, 'image']);
  assert.equal(list[1].url, 'https://www.kisa.or.kr/post/fileDownload?menuSeq=401&postSeq=3791&attachSeq=2&lang_type=KO');
  assert.ok(list.every(a => !a.url.includes('99999999') && !a.url.includes('#') && !a.opt));
});

test('홈페이지 공고(경남도청): 내려받기 주소 + 파일 이름 글자, 크기 표시는 떼고 바로보기 링크는 뺀다', () => {
  const list = S.parseHomeAttachments(read('home-gyeongnam.html'), 'https://www.gyeongnam.go.kr/board/view.gyeong?menuCd=DOM_000000135002001000&boardId=BBS_0000060&dataSid=42423792');
  assert.deepEqual(list.map(a => [a.name, a.kind]), [['1103 보도자료(통합복지플랫폼 네이밍공모)-통합돌봄과.hwp', undefined], ['1103 보도자료(통합복지플랫폼 네이밍공모)-통합돌봄과.pdf', undefined], ['홍보물.png', 'image']]);
  assert.equal(list[0].url, 'https://www.gyeongnam.go.kr/board/download.gyeong?boardId=BBS_0000060&menuCd=DOM_000000135002001000&paging=ok&startPage=1&dataSid=42423792&command=update&fileSid=5469481');
});

test('홈페이지 공고(일반 꼴): 문서 주소·내려받기 링크만, 상대 주소는 절대 주소로, 같은 파일은 한 번', () => {
  const html = `
    <a href="files/form.hwp">참가신청서 양식</a>
    <a href='/data/%EC%8B%A0%EC%B2%AD%EC%84%9C.hwpx'><img src="/i/hwp.png" alt="내려받기"></a>
    <a href="../notice/guide.pdf#page=2">공모 요강.pdf [1.2MB]</a>
    <a href="/cmm/fms/FileDown.do?atchFileId=F1&amp;fileSn=0">동의서.docx (33 kb)</a>
    <a href="/cmm/fms/FileDown.do?atchFileId=F1&amp;fileSn=0">동의서.docx</a>
    <a href="//cdn.example.org/bbs/attachDown?no=7">포스터.JPG (2MB)</a>
    <a href="/bbs/view?id=3">지난 공고문.hwp</a>
    <a href="/bbs/download?id=9">내려받기</a>
    <a href="#fnPostAttachDownload" onclick="fnPostAttachDownload(99999999, 1, 1, 'KO');">소개자료.pdf</a>
    <a href="javascript:void(0)" onclick="down('a.hwp')">양식.hwp</a>
    <a href="mailto:a@example.org">문의.pdf</a>`;
  assert.deepEqual(S.parseHomeAttachments(html, 'https://example.org/bbs/list/view.do?id=1#top'), [
    { name: '참가신청서 양식.hwp', url: 'https://example.org/bbs/list/files/form.hwp' },
    { name: '신청서.hwpx', url: 'https://example.org/data/%EC%8B%A0%EC%B2%AD%EC%84%9C.hwpx' },
    { name: '공모 요강.pdf', url: 'https://example.org/bbs/notice/guide.pdf' },
    { name: '동의서.docx', url: 'https://example.org/cmm/fms/FileDown.do?atchFileId=F1&fileSn=0' },
    { name: '포스터.JPG', url: 'https://cdn.example.org/bbs/attachDown?no=7', kind: 'image' },
  ]);
  const many = Array.from({ length: 14 }, (_, i) => `<a href="/f/${i}.pdf">${i}</a>`).join('');
  assert.equal(S.parseHomeAttachments(many, 'https://example.org/').length, 10);
  assert.deepEqual(S.parseHomeAttachments('', 'https://example.org/'), []);
});

test('fetchHomeAttachments: 주소 꼬리의 #…는 떼고 받고, http(s)가 아니면 받지 않는다', async () => {
  const calls = [];
  const fetchText = async url => { calls.push(url); if (url.endsWith('/robots.txt')) throw new Error('403 www.kisa.or.kr'); return read('home-kisa.html'); };   // KISA는 robots.txt가 403 → 허용
  const list = await S.fetchHomeAttachments('https://www.kisa.or.kr/401/form?postSeq=3791&page=1#fnPostAttachDownload', { fetchText });
  assert.deepEqual(calls, ['https://www.kisa.or.kr/robots.txt', 'https://www.kisa.or.kr/401/form?postSeq=3791&page=1']);
  assert.equal(list.length, 4);
  assert.ok(list.every(a => !a.blocked));
  assert.deepEqual(await S.fetchHomeAttachments('', { fetchText }), []);
  assert.deepEqual(await S.fetchHomeAttachments('mailto:a@example.org', { fetchText }), []);
  assert.equal(calls.length, 2);
  const got = [];
  const file = await S.fetchFile(list[1], { fetchBytes: async (url, opt) => { got.push([url, opt]); return { bytes: Buffer.from('PK'), type: 'application/octet-stream', name: '[붙임2] 모두의 KISA 국민제안서 양식 모음.hwpx' }; } });
  assert.deepEqual(got, [['https://www.kisa.or.kr/post/fileDownload?menuSeq=401&postSeq=3791&attachSeq=2&lang_type=KO', undefined]]);
  assert.deepEqual([file.name, file.type], ['[붙임2] 모두의 KISA 국민제안서 양식 모음.hwpx', 'application/hwp+zip']);
});

const GN_ROBOTS = `User-agent: *
Disallow: /


Allow: /$
Allow: /index.gyeong
Allow: /gsndlri/ 
Allow: /board/list.gyeong?boardId=BBS_0000060&menuCd=DOM_000000135002001000*
Allow: /board/view.gyeong?boardId=BBS_0000060&menuCd=DOM_000000135002001000*
#Disallow: /tour.gyeongnam.go.kr/
`;
const UA = 'pkm-contest-apply/0.1 (personal use)';

test('robotsAllowed: 가장 길게 맞는 규칙이 이기고, 우리 이름의 묶음이 * 묶음보다 먼저', () => {
  const ok = (txt, p) => S.robotsAllowed(txt, UA, p);
  // 경남도청 꼴: 모두 막고 목록만 허용 — 공고 보기는 되고 내려받기는 안 된다
  assert.equal(ok(GN_ROBOTS, '/'), true);
  assert.equal(ok(GN_ROBOTS, '/board/view.gyeong?boardId=BBS_0000060&menuCd=DOM_000000135002001000&dataSid=42423792'), true);
  assert.equal(ok(GN_ROBOTS, '/board/view.gyeong?menuCd=DOM_000000135002001000&boardId=BBS_0000060&dataSid=42423792'), false);
  assert.equal(ok(GN_ROBOTS, '/board/download.gyeong?boardId=BBS_0000060&menuCd=DOM_000000135002001000&dataSid=42423792&fileSid=5469481'), false);
  assert.equal(ok(GN_ROBOTS, '/gsndlri/a'), true);
  assert.equal(ok(GN_ROBOTS, '/tour'), false);
  for (const empty of ['', '# 비어 있음\n', 'User-agent: *\nDisallow:\n', '<html>없는 페이지</html>']) assert.equal(ok(empty, '/any/path?x=1'), true);
  const wild = 'User-agent: *\nDisallow: /*.php$\nDisallow: /private*/\nAllow: /private-open/\nDisallow: /a\nAllow: /a';
  assert.equal(ok(wild, '/x/down.php'), false);
  assert.equal(ok(wild, '/x/down.php?id=1'), true);
  assert.equal(ok(wild, '/private1/x'), false);
  assert.equal(ok(wild, '/private-open/x'), true);
  assert.equal(ok(wild, '/a'), true);   // 길이가 같으면 Allow
  const named = 'User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nUser-agent: pkm-contest-apply\nDisallow: /secret\n';
  assert.equal(ok(named, '/files/a.hwp'), true);
  assert.equal(ok(named, '/secret/a.hwp'), false);
  assert.equal(S.robotsAllowed(named, 'other-bot/1.0', '/files/a.hwp'), false);
});

test('isPublicUrl: 내 컴퓨터·사설망·링크로컬 주소와 http(s)가 아닌 주소는 막는다', () => {
  for (const u of ['https://www.kisa.or.kr/401/form?postSeq=3791', 'http://8.8.8.8/a', 'http://172.32.0.1/', 'http://[2001:db8::1]/', 'http://[::ffff:8.8.8.8]/', 'https://localhost.example.org/']) assert.equal(S.isPublicUrl(u), true, u);
  for (const u of ['http://localhost:5270/api', 'http://LOCALHOST./', 'http://app.localhost/', 'http://nas.local/', 'http://127.0.0.1/', 'http://127.1.2.3:8080/', 'http://10.0.0.5/', 'http://172.16.0.1/', 'http://172.31.255.1/',
    'http://192.168.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://0.0.0.0/', 'http://2130706433/', 'http://0x7f.1/', 'http://[::1]/', 'http://[fc00::1]/', 'http://[fd12:3456::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:192.168.0.1]/',
    'file:///etc/passwd', 'ftp://example.org/a.hwp', 'javascript:alert(1)', 'not a url', '']) assert.equal(S.isPublicUrl(u), false, u);
});

test('fetchHomeAttachments: robots.txt가 막은 공고는 받지 않고, 막힌 첨부에는 blocked를 붙인다', async () => {
  const calls = [];
  const site = (robots, page = read('home-gyeongnam.html')) => async url => { calls.push(url); if (url.endsWith('/robots.txt')) { if (robots instanceof Error) throw robots; return robots; } return page; };
  // 경남도청 꼴: 허용된 주소의 공고는 읽되 내려받기는 막힘. 같은 사이트의 robots.txt는 한 번만
  const gn = site(GN_ROBOTS);
  const list = await S.fetchHomeAttachments('https://gn.example/board/view.gyeong?boardId=BBS_0000060&menuCd=DOM_000000135002001000&dataSid=42423792', { fetchText: gn });
  assert.deepEqual(list.map(a => [a.name.slice(-4), a.blocked]), [['.hwp', true], ['.pdf', true], ['.png', true]]);
  assert.deepEqual(await S.fetchHomeAttachments('https://gn.example/board/view.gyeong?menuCd=DOM_000000135002001000&boardId=BBS_0000060&dataSid=42423792', { fetchText: gn }), []);
  assert.deepEqual(calls.map(u => new URL(u).pathname), ['/robots.txt', '/board/view.gyeong']);
  await assert.rejects(S.fetchFile(list[0], { fetchBytes: async () => assert.fail('받으면 안 된다') }), /주최 홈페이지가 자동 내려받기를 막아 두었어요/);
  // robots.txt 없음(404)은 허용, 5xx·연결 실패는 막힘
  const page = '<a href="/files/form.hwp">신청서</a>';
  assert.deepEqual(await S.fetchHomeAttachments('https://none.example/notice/1', { fetchText: site(new Error('404 none.example'), page) }), [{ name: '신청서.hwp', url: 'https://none.example/files/form.hwp' }]);
  calls.length = 0;
  assert.deepEqual(await S.fetchHomeAttachments('https://down.example/notice/1', { fetchText: site(new Error('503 down.example'), page) }), []);
  assert.deepEqual(await S.fetchHomeAttachments('https://dead.example/notice/1', { fetchText: site(new TypeError('fetch failed'), page) }), []);
  assert.deepEqual(calls, ['https://down.example/robots.txt', 'https://dead.example/robots.txt']);
  // 첨부가 다른 사이트에 있으면 그 사이트의 robots.txt를 본다
  const cdn = async url => url === 'https://cdn.example/robots.txt' ? 'User-agent: *\nDisallow: /private/' : url.endsWith('/robots.txt') ? '' : '<a href="https://cdn.example/private/a.hwp">a</a><a href="https://cdn.example/open/b.pdf">b</a>';
  assert.deepEqual(await S.fetchHomeAttachments('https://host.example/n', { fetchText: cdn }), [{ name: 'a.hwp', url: 'https://cdn.example/private/a.hwp', blocked: true }, { name: 'b.pdf', url: 'https://cdn.example/open/b.pdf' }]);
});

test('내부 주소: 공고 주소면 아무것도 요청하지 않고, 첨부 주소면 목록에서 빼고 받지도 않는다', async () => {
  const calls = [];
  const fetchText = async url => { calls.push(url); return url.endsWith('/robots.txt') ? '' : '<a href="http://localhost:5270/api/x.hwp">a</a><a href="http://192.168.0.10/share/b.pdf">b</a><a href="/files/c.hwp">c</a>'; };
  for (const u of ['http://localhost:5270/notice', 'http://127.0.0.1/n', 'http://192.168.0.1/n', 'http://[::1]/n', 'http://printer.local/n']) assert.deepEqual(await S.fetchHomeAttachments(u, { fetchText }), []);
  assert.deepEqual(calls, []);
  assert.deepEqual(await S.fetchHomeAttachments('https://inner.example/n', { fetchText }), [{ name: 'c.hwp', url: 'https://inner.example/files/c.hwp' }]);
  assert.deepEqual(calls, ['https://inner.example/robots.txt', 'https://inner.example/n']);
  await assert.rejects(S.fetchFile({ name: 'x.hwp', url: 'http://localhost:5270/api/x.hwp' }, { fetchBytes: async () => assert.fail('받으면 안 된다') }), /내부 주소라 받지 않아요/);
});
}
