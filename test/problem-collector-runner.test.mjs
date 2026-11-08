// 문제 수집기를 실제 실행기(server/runner.js)로 — 붙여 넣기(원문이 상태 파일에 남지 않는지)와 자동 수집(RSS robots.txt·Reddit 공식 API·이미 본 글 건너뛰기).
// 가짜 pkm-ai-server: 스크립트는 그 자리에서 실행하고(비밀값은 환경 변수로), AI는 프롬프트를 보고 정해 둔 답을 낸다. 가짜 RSS·Reddit 서버도 같은 프로세스에서 돈다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-collector-run-'));
Object.assign(process.env, { PKM_HOME: path.join(T, 'home'), PKM_HOST_NAME: '집맥', PKM_RUNNER_TICK: '999999' });
const DATA = path.join(T, 'data'), P = '개인', ID = 'problem-collector';
fs.mkdirSync(path.join(DATA, P), { recursive: true });
fs.writeFileSync(path.join(DATA, P, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');
const RAW = '숨고에서 본 글인데요 https://soomgo.com/r/9 세무 기장 맡겼는데 매달 영수증 정리를 제가 다 해서 넘겨야 해요. 주말마다 3시간씩 날아가요. 원문표시-붙여넣기';
const PROBLEM = { title: '영수증 정리', who: '개인사업자, 매달 기장 전', loss: '주말 3시간', workaround: '손으로 정리해 세무사에게 넘김', summary: '기장을 맡겨도 영수증 정리는 직접 한다.', domain: '회계·세무', qualifies: true, reject_why: '', money: 3, money_why: '기장료를 이미 냄', pain: 3, auto: 4, build: 4, out_of_scope: false, scope_why: '', match: '' };

// 가짜 RSS·Reddit
const web = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), xml = t => { res.writeHead(200, { 'content-type': 'text/xml' }); res.end(t); };
  if (u.pathname === '/robots.txt') return xml('User-agent: *\nDisallow: /blocked\n');
  if (u.pathname === '/rss') return xml('<rss><channel><item><title>배달앱 리뷰 답글 너무 힘들어요</title><link>https://www.ppomppu.co.kr/zboard/view.php?id=a&amp;no=1</link><description><![CDATA[<p>가게 하는데 리뷰 답글을 매일 30개씩 손으로 달아요. 원문표시-RSS</p>]]></description><guid>p1</guid></item><item><title>오늘 날씨</title><link>https://www.ppomppu.co.kr/zboard/view.php?id=a&amp;no=2</link><description>맑음</description></item></channel></rss>');
  if (u.pathname === '/blocked/rss') return xml('<rss><item><title>막힌 글</title><link>https://x.com/b</link></item></rss>');
  if (u.pathname === '/auth'){ assert.match(req.headers.authorization, /^Basic /); res.end(JSON.stringify({ access_token: 'tok' })); return; }
  if (u.pathname === '/r/smallbusiness/new'){ assert.equal(req.headers.authorization, 'Bearer tok'); res.end(JSON.stringify({ data: { children: [{ data: { id: 'r1', permalink: '/r/smallbusiness/comments/r1/x/', title: 'Invoicing takes my whole Friday', selftext: 'I chase unpaid invoices by hand. 원문표시-Reddit' } }, { data: { id: 'r2', stickied: true, title: 'rules', permalink: '/r/x' } }] } })); return; }
  res.writeHead(404); res.end();
});
const prompts = [];
const jobs = new Map(); let n = 0;
const ai = http.createServer(async (req, res) => {
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/v1/plugins') return req.method === 'POST' ? send(201, { plugin: body }) : send(200, { plugins: [] });
  if (u.pathname === '/v1/secrets') return send(200, { secrets: [] });
  if (u.pathname === '/v1/jobs' && req.method === 'POST'){
    const id = `job${++n}`; let result;
    if ((body.args || []).some(a => typeof a !== 'string' || a.length > 2000)) return send(400, { error: 'args는 문자열 배열이어야 해요' });
    if (body.plugin_script){
      const env = { ...process.env, REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'sec', PC_GAP_MS: '0', PC_REDDIT_BASE: base, PC_REDDIT_AUTH: `${base}/auth` };
      result = { exit_code: 0, stdout: (await exec(process.execPath, [path.join(body.plugin.root, body.plugin_script), ...body.args], { encoding: 'utf8', env })).stdout, stderr: '' };
    } else {
      const p = body.prompt; prompts.push(p);
      if (/붙여 넣은 글|글 여러 개/.test(p) && /오늘 모은 글/.test(p)) result = { text: '', structured: { _analysis: { problems: [{ ...PROBLEM, post: 0, title: '리뷰 답글', domain: '요식업' }, { ...PROBLEM, post: 2, title: 'Invoice chasing', domain: '회계·세무' }], note: '' } } };
      else if (/돈이 될 만한 문제/.test(p)) result = { text: '', structured: { _analysis: { problems: [PROBLEM], note: '' } } };
      else result = { text: '모르는 프롬프트' };
    }
    const job = { id, status: 'done', result }; jobs.set(id, job); return send(201, { job });
  }
  const m = u.pathname.match(/^\/v1\/jobs\/(\w+)$/);
  if (m) return send(200, { job: jobs.get(m[1]) });
  send(404, {});
});
let runner, base;
before(async () => {
  await new Promise(r => ai.listen(0, '127.0.0.1', r));
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${web.address().port}`;
  const plugins = await import('../server/plugins.js');
  const { createRunner } = await import('../server/runner.js');
  const ins = await plugins.inspect({ local: new URL('../plugins/problem-collector/', import.meta.url).pathname });
  assert.equal(ins.ok, true, ins.errors.join());
  await plugins.install(path.join(DATA, P), ins.stage);
  runner = createRunner({ DATA, listProfiles: async () => [{ name: P }] });
  await runner.setRunner(P, { on: true, ai: { url: `http://127.0.0.1:${ai.address().port}`, token: 'test-token-0123456789' } });
  await runner.setLocal(P, ID, { settings: { rss: `${base}/rss\n${base}/blocked/rss`, subs: 'r/smallbusiness', daily_limit: '20' } });
});
after(() => { ai.close(); web.close(); fs.rmSync(T, { recursive: true, force: true }); });

const state = async () => (await runner.status(P)).plugins[ID].state;
const stateFile = () => fs.readFileSync(path.join(DATA, P, '_플러그인/.state', `${ID}.json`), 'utf8');
const db = () => JSON.parse(fs.readFileSync(path.join(DATA, P, '_플러그인/.data/problem-collector/db.json'), 'utf8'));
async function until(wf, fn, label){
  for (let i = 0; i < 80; i++){ await runner.tick(); const r = (await state()).runs.find(r => r.workflow === wf); if (r && fn(r)) return r; }
  const r = (await state()).runs.find(r => r.workflow === wf); assert.fail(`${label}: ${r && r.status} ${JSON.stringify(r && r.steps.map(s => [s.key, s.status, s.error]))}`);
}

test('붙여 넣기 — 문제를 묶고, 끝나면 붙여 넣은 원문이 상태 파일에 남지 않는다', async () => {
  await runner.act(P, ID, { type: 'refresh', feed: '붙여 넣기' });
  await runner.act(P, ID, { type: 'start', feed: '붙여 넣기', item: 'paste', answer: RAW });
  const r = await until('붙여 넣기', r => ['done', 'stopped'].includes(r.status), '끝까지 간다');
  assert.equal(r.status, 'done', JSON.stringify(r.steps.map(s => [s.key, s.status, s.error])));
  assert.equal(r.steps.at(-1).output.verdict.title, '문제 1개를 넣었어요');
  assert.ok(prompts.some(p => p.includes('원문표시-붙여넣기')), 'AI는 원문을 받는다');
  assert.equal(r.steps[0].text, '(지웠어요)');
  assert.doesNotMatch(stateFile(), /원문표시/);
  assert.doesNotMatch(JSON.stringify(db()), /원문표시/);
  assert.equal(Object.values(db().clusters)[0].posts[0].url, 'https://soomgo.com/r/9');
});

test('자동 수집 — robots.txt가 막은 RSS는 건너뛰고, Reddit은 공식 API로, 이미 본 글은 다시 모으지 않는다', async () => {
  await runner.act(P, ID, { type: 'refresh', feed: '자동 수집' });
  const it = (await state()).feeds['자동 수집'].items[0];
  assert.match(it.meta[0], /RSS 2곳 · Reddit 1곳/);
  await runner.act(P, ID, { type: 'start', feed: '자동 수집', item: it.id });
  const r = await until('자동 수집', r => ['done', 'stopped'].includes(r.status), '끝까지 간다');
  assert.equal(r.status, 'done', JSON.stringify(r.steps.map(s => [s.key, s.status, s.error])));
  const got = r.steps[0].output;
  assert.equal(got.count, 3, '날씨 글도 AI가 거르도록 넘기고, 고정 글(stickied)은 뺀다');
  assert.match(got.notes, /robots\.txt가 막아서 건너뜀: .*\/blocked\/rss/);
  assert.equal(r.steps.at(-1).output.verdict.title, '글 3개에서 문제 2개를 넣었어요');
  const p = prompts.find(p => /오늘 모은 글/.test(p));
  assert.match(p, /\[0\] \(국내 커뮤니티\) 배달앱 리뷰 답글 너무 힘들어요\n가게 하는데/);
  assert.match(p, /\(Reddit\) Invoicing takes my whole Friday/);
  assert.doesNotMatch(stateFile(), /원문표시/, '끝난 실행에 수집한 원문(_posts)이 남지 않는다');
  assert.doesNotMatch(JSON.stringify(db()), /원문표시/);
  const urls = Object.values(db().clusters).flatMap(c => c.posts.map(x => x.url));
  assert.ok(urls.includes('https://www.ppomppu.co.kr/zboard/view.php?id=a&no=1'));
  assert.ok(urls.includes('https://www.reddit.com/r/smallbusiness/comments/r1/x/'));
  // 같은 날 다시 모으면 새 글이 없어 AI를 부르지 않는다
  const before = prompts.length;
  await runner.act(P, ID, { type: 'start', feed: '자동 수집', item: it.id });
  const again = await until('자동 수집', r2 => r2.id !== r.id && ['done', 'stopped'].includes(r2.status), '두 번째');
  assert.equal(again.steps[0].output.count, 0);
  assert.equal(again.steps[1].status, 'skipped');
  assert.equal(prompts.length, before);
});
