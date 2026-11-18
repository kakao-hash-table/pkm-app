// 업비트 포켓 이전 스크립트(scripts/upbit-pocket.mjs) — 가짜 업비트로 메인 → 서브 원화 이전의 요청 꼴·서명·확인 절차를 본다. 실제 업비트에는 닿지 않는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const KEY = 'main-access-1234', SECRET = 'main-secret-abcdefgh', MAIN = '11111111-aaaa', SUB = '22222222-bbbb';
const M = { krw: { [MAIN]: 500000, [SUB]: 0 }, posts: [], transfers: [], scope: true };
const hash = s => crypto.createHash('sha512').update(s, 'utf8').digest('hex');
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), send = (c, b) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  let raw = ''; req.on('data', d => raw += d); req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null, query = body ? Object.entries(body).map(([k, v]) => `${k}=${v}`).join('&') : decodeURIComponent(u.search.slice(1));
    const [h, p, s] = String(req.headers.authorization || '').replace(/^Bearer /, '').split('.'), pay = JSON.parse(Buffer.from(p || 'e30', 'base64url'));
    if (crypto.createHmac('sha512', SECRET).update(`${h}.${p}`).digest('base64url') !== s || pay.access_key !== KEY || (query ? pay.query_hash !== hash(query) : pay.query_hash != null)) return send(401, { error: { name: 'jwt_verification' } });
    if (!M.scope) return send(403, { error: { name: 'out_of_scope' } });
    if (u.pathname === '/v1/pockets') return send(200, [{ uuid: MAIN, name: '메인포켓', type: 'main' }, { uuid: SUB, name: '퀀트', type: 'user_spot_trading' }]);
    if (u.pathname === '/v1/accounts') return send(200, [{ currency: 'KRW', balance: String(M.krw[MAIN]), locked: '0' }]);
    if (u.pathname === '/v1/pockets/assets') return send(200, [{ currency: 'KRW', balance: String(M.krw[u.searchParams.get('uuid')]), locked: '0' }]);
    if (u.pathname === '/v1/pockets/universal_transfers' && req.method === 'POST'){
      M.posts.push(body); M.krw[body.from] -= Number(body.amount); M.krw[body.to] += Number(body.amount);
      const t = { uuid: `t${M.posts.length}`, ...body, state: 'processing' }; M.transfers.push(t); return send(201, t);
    }
    if (u.pathname === '/v1/pockets/universal_transfers') return send(200, M.transfers.map(t => ({ ...t, state: 'done' })));
    send(404, {});
  });
});
let api;
before(async () => { await new Promise(r => server.listen(0, '127.0.0.1', r)); api = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const run = (...a) => new Promise(r => execFile(process.execPath, [new URL('../scripts/upbit-pocket.mjs', import.meta.url).pathname, `--api=${api}`, '--poll=10', ...a],
  { encoding: 'utf8', env: { ...process.env, UPBIT_MAIN_ACCESS_KEY: KEY, UPBIT_MAIN_SECRET_KEY: SECRET } }, (e, out, err) => r({ code: e ? e.code : 0, out, err })));

test('포켓 목록과 원화 잔고를 보이고, 메인 → 서브로 옮긴 뒤 끝난 것을 확인한다', async () => {
  const list = await run('--list');
  assert.match(list.out, /메인  메인포켓  원화 500,000원/); assert.match(list.out, /서브 1  퀀트  원화 0원/); assert.equal(M.posts.length, 0);
  const r = await run('--amount=200,000', '--yes');
  assert.equal(r.code, 0, r.err);
  assert.equal(M.posts.length, 1);
  assert.deepEqual({ ...M.posts[0], identifier: '' }, { from: MAIN, to: SUB, currency: 'KRW', amount: '200000', identifier: '' }); assert.match(M.posts[0].identifier, /^pkm_\d+$/);
  assert.match(r.out, /옮겼어요 · 퀀트 원화 200,000원/);
  const back = await run('--to=퀀트', '--amount=50000', '--back', '--yes');
  assert.deepEqual([M.posts[1].from, M.posts[1].to, M.posts[1].amount], [SUB, MAIN, '50000']); assert.match(back.out, /옮겼어요 · 메인포켓 원화 350,000원/);
});

test('잔고보다 많으면 보내지 않고, 권한이 없으면 무엇을 고칠지 알린다. 업비트가 아닌 주소로는 보내지 않는다', async () => {
  const n = M.posts.length;
  const over = await run('--amount=9000000', '--yes');
  assert.equal(over.code, 1); assert.match(over.err, /메인포켓의 원화\(350,000원\)보다 많아요/); assert.equal(M.posts.length, n);
  M.scope = false;
  const no = await run('--list');
  assert.equal(no.code, 1); assert.match(no.err, /메인포켓에서 발급한 키인지, \[포켓관리\] 권한을 켰는지/);
  const evil = await new Promise(r => execFile(process.execPath, [new URL('../scripts/upbit-pocket.mjs', import.meta.url).pathname, '--api=https://example.com', '--list'], { encoding: 'utf8' }, (e, out, err) => r({ code: e ? e.code : 0, err })));
  assert.equal(evil.code, 1); assert.match(evil.err, /업비트가 아닌 주소/);
});
