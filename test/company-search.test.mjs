// 사내 검색 플러그인 — scripts/search.mjs를 가짜 위키·지라·아지트 서버에 돌려 본다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';

const SCRIPT = new URL('../plugins/company-search/scripts/search.mjs', import.meta.url).pathname;
let server, base, seen = [], route = () => [404, {}];

before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const r = { path: u.pathname, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization || '' };
    seen.push(r);
    const [status, body] = route(r);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// 같은 프로세스의 서버가 답해야 하니 비동기로 돌린다
function run(args, env = {}){
  seen = [];
  return new Promise(ok => execFile(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env }, timeout: 20000 }, (err, stdout) => {
    ok({ code: err ? err.code : 0, out: JSON.parse(String(stdout).trim().split('\n').pop()) });
  }));
}
const TOKEN = { ATLASSIAN_TOKEN: 'test-token' };
const page = (id, title, extra = {}) => ({ id: String(id), title, space: { key: 'ENG', name: '개발' }, version: { number: 3, when: '2026-10-20T12:00:00.000Z' }, _links: { webui: `/display/ENG/${id}` }, ...extra });
const issue = (key, summary) => ({ key, fields: { summary, status: { name: '진행 중' }, assignee: { displayName: '홍길동' }, updated: '2026-10-21T12:00:00.000+0000', issuetype: { name: '버그' } } });

test('위키 — 제목에서 먼저, 모자라면 본문에서 더 찾고 겹치는 건 뺀다', async () => {
  route = r => [200, { results: /title ~/.test(r.query.cql) ? [page(1, '배포 절차')] : [page(1, '배포 절차'), page(2, '배포 회고')] }];
  const { code, out } = await run(['wiki', `--url=${base}`, '--q=배포 "절차"', '--limit=5'], TOKEN);
  assert.equal(code, 0);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].path, '/rest/api/content/search');
  assert.equal(seen[0].query.cql, 'type = page AND title ~ "배포 \\"절차\\"" ORDER BY lastmodified DESC');
  assert.equal(seen[1].query.cql, 'type = page AND text ~ "배포 \\"절차\\""');
  assert.equal(seen[0].query.limit, '5');
  assert.equal(seen[0].query.expand, 'space,version');
  assert.equal(seen[0].auth, 'Bearer test-token');   // 이메일이 없으면 PAT
  assert.deepEqual(out.items.map(i => i.id), ['1', '2']);
  assert.deepEqual(out.items[0], { id: '1', title: '배포 절차', url: `${base}/display/ENG/1`, at: '2026-10-20T12:00:00.000Z', meta: ['개발', 'v3', '2026-10-20'] });
});

test('위키 — 제목만으로 다 차면 본문은 찾지 않는다', async () => {
  route = () => [200, { results: [page(1, 'a'), page(2, 'b')] }];
  const { out } = await run(['wiki', `--url=${base}`, '--q=a', '--limit=2'], TOKEN);
  assert.equal(seen.length, 1);
  assert.equal(out.items.length, 2);
});

test('위키 Cloud — /wiki 아래로 부르고, 이메일+토큰으로, 링크에 /wiki가 겹치지 않게', async () => {
  route = () => [200, { results: [page(7, 'c', { _links: { webui: '/spaces/ENG/pages/7/c' } }), page(8, 'd', { _links: { webui: '/wiki/spaces/ENG/pages/8/d' } })] }];
  const { code, out } = await run(['wiki', `--url=${base}/`, '--email=me@example.com', '--cloud=1', '--q=c', '--limit=2'], TOKEN);
  assert.equal(code, 0);
  assert.equal(seen[0].path, '/wiki/rest/api/content/search');
  assert.equal(seen[0].auth, `Basic ${Buffer.from('me@example.com:test-token').toString('base64')}`);
  assert.deepEqual(out.items.map(i => i.url), [`${base}/wiki/spaces/ENG/pages/7/c`, `${base}/wiki/spaces/ENG/pages/8/d`]);
  const again = await run(['wiki', `--url=${base}/wiki`, '--email=me@example.com', '--cloud=1', '--q=c', '--limit=2'], TOKEN);
  assert.equal(seen[0].path, '/wiki/rest/api/content/search');
  assert.equal(again.out.items[1].url, `${base}/wiki/spaces/ENG/pages/8/d`);
});

test('위키 Cloud인데 이메일이 없으면 부르지 않고 알려 준다', async () => {
  const { code, out } = await run(['wiki', `--url=${base}`, '--email=', '--cloud=1', '--q=c'], TOKEN);
  assert.equal(code, 1);
  assert.match(out.error, /이메일이 필요해요/);
  assert.equal(seen.length, 0);
});

test('지라 — 키처럼 생기면 키로 찾고(대문자로), Server는 /search', async () => {
  route = () => [200, { issues: [issue('ABC-12', '로그인 오류')] }];
  const { code, out } = await run(['jira', `--url=${base}`, '--q=abc-12'], TOKEN);
  assert.equal(code, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].path, '/rest/api/2/search');
  assert.equal(seen[0].query.jql, 'key = ABC-12');
  assert.equal(seen[0].query.maxResults, '8');
  assert.equal(seen[0].query.fields, 'summary,status,assignee,updated,issuetype');
  assert.deepEqual(out.items[0], { id: 'ABC-12', title: 'ABC-12 로그인 오류', url: `${base}/browse/ABC-12`, at: '2026-10-21T12:00:00.000+0000', meta: ['진행 중', '홍길동', '2026-10-21'], tags: ['버그'] });
});

test('지라 Cloud — /search/jql을 부른다', async () => {
  route = () => [200, { issues: [issue('ABC-1', 'x')], isLast: true }];
  const { code } = await run(['jira', `--url=${base}`, '--email=me@example.com', '--cloud=1', '--q=ABC-1'], TOKEN);
  assert.equal(code, 0);
  assert.equal(seen[0].path, '/rest/api/2/search/jql');
});

test('지라 — 본문에서 없으면 제목으로 다시, 없는 키(400)면 글로 다시 찾는다', async () => {
  route = r => [200, { issues: /^summary/.test(r.query.jql) ? [issue('ABC-3', '결제 "버튼"')] : [] }];
  const { out } = await run(['jira', `--url=${base}`, '--q=결제 "버튼"'], TOKEN);
  assert.deepEqual(seen.map(s => s.query.jql), ['text ~ "결제 \\"버튼\\"" ORDER BY updated DESC', 'summary ~ "결제 \\"버튼\\"" ORDER BY updated DESC']);
  assert.deepEqual(out.items.map(i => i.id), ['ABC-3']);

  route = r => /^key/.test(r.query.jql) ? [400, { errorMessages: ["An issue with key 'ZZ-9' does not exist"] }] : [200, { issues: [issue('ABC-4', 'ZZ-9 언급')] }];
  const k = await run(['jira', `--url=${base}`, '--q=ZZ-9'], TOKEN);
  assert.equal(k.code, 0);
  assert.deepEqual(seen.map(s => s.query.jql), ['key = ZZ-9', 'text ~ "ZZ-9" ORDER BY updated DESC']);
  assert.deepEqual(k.out.items.map(i => i.id), ['ABC-4']);
});

test('토큰이 없거나 맞지 않으면 사람에게 보일 말로 실패한다', async () => {
  const w = await run(['wiki', `--url=${base}`, '--q=a']);
  assert.equal(w.code, 1);
  assert.equal(w.out.error, '위키 토큰이 없어요. 플러그인 설정에서 넣어 주세요');
  assert.equal((await run(['jira', `--url=${base}`, '--q=a'])).out.error, '지라 토큰이 없어요. 플러그인 설정에서 넣어 주세요');
  assert.equal((await run(['agit', `--url=${base}`, '--q=a'])).out.error, '아지트 토큰이 없어요. 플러그인 설정에서 넣어 주세요');
  assert.equal(seen.length, 0);

  route = () => [401, { message: 'unauthorized' }];
  const j = await run(['jira', `--url=${base}`, '--q=a'], TOKEN);
  assert.equal(j.code, 1);
  assert.match(j.out.error, /^지라 토큰이 맞지 않거나 만료됐어요/);
  assert.match((await run(['agit', `--url=${base}`, '--q=a'], { AGIT_TOKEN: 't' })).out.error, /^아지트 토큰이 맞지 않거나 만료됐어요/);
  assert.match((await run(['wiki', '--url=', '--q=a'], TOKEN)).out.error, /위키 주소가 비어 있어요/);
  assert.match((await run(['nope', '--q=a'], TOKEN)).out.error, /wiki, jira, agit/);
});

test('아지트 — Bearer로 찾고, 그룹 id가 있을 때만 링크를 만든다', async () => {
  const msgs = [
    { id: 11, group_id: 5, text: '\n  주간 회고  \n둘째 줄', user: { name: '김아무개' }, created_at: 1792900000 },
    { id: 12, text: '그룹 없는 글', user: { name: '이아무개' }, created_at: '2026-10-22T03:00:00Z' }
  ];
  route = () => [200, { wall_messages: msgs }];
  const { code, out } = await run(['agit', `--url=${base}/v2/`, '--web=https://agit.example.test/', '--q=회고'], { AGIT_TOKEN: 'agit-token' });
  assert.equal(code, 0);
  assert.equal(seen[0].path, '/v2/search/total');
  assert.deepEqual(seen[0].query, { q: '회고', page: '1' });
  assert.equal(seen[0].auth, 'Bearer agit-token');
  assert.equal(out.items[0].title, '주간 회고');
  assert.equal(out.items[0].url, 'https://agit.example.test/g/5/wall/11');
  assert.equal(out.items[0].meta[0], '김아무개');
  assert.match(out.items[0].meta[1], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(out.items[0].at, new Date(1792900000 * 1000).toISOString());
  assert.equal(out.items[1].url, '');   // 그룹 id가 없으면 지어내지 않는다

  route = () => [200, { wall_messages: { list: [{ id: 'm1', group_id: 'g1', text: 'x'.repeat(200) }] } }];
  const noWeb = await run(['agit', `--url=${base}`, '--q=x'], { AGIT_TOKEN: 't' });
  assert.equal(noWeb.out.items[0].title.length, 80);
  assert.equal(noWeb.out.items[0].url, '');   // 아지트 주소를 안 적었으면 링크 없이

  route = () => [200, { something: [] }];
  const odd = await run(['agit', `--url=${base}`, '--q=x'], { AGIT_TOKEN: 't' });
  assert.equal(odd.code, 0);
  assert.deepEqual(odd.out.items, []);
  assert.match(odd.out.note, /wall_messages/);
});

test('빈 검색어는 부르지 않고 빈 목록', async () => {
  const { code, out } = await run(['wiki', `--url=${base}`, '--q=  '], TOKEN);
  assert.equal(code, 0);
  assert.deepEqual(out, { items: [] });
  assert.equal(seen.length, 0);
});
