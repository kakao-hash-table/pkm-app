// 휴대폰 알림(웹 푸시) — 홈 화면에 추가한 웹앱(iOS 16.4+)과 브라우저에 AI 챗봇 소식을 보낸다. 의존성 없이 node:crypto로 한다.
// 서명 키(VAPID)와 기기별 구독은 이 컴퓨터에만 둔다(~/.pkm-app/push.json). 알림은 기기 회사의 푸시 서버(Apple·Google·Mozilla)를 거치고, 내용은 기기만 풀 수 있게 암호화한다(RFC 8291).
// 알림 종류: ask(내 답이 필요할 때) · done(답이 끝났거나 멈췄을 때) · run(시작했을 때, 기본 끔). 그 기기로 앱을 보고 있으면 보내지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const HOME = process.env.PKM_HOME ? path.resolve(process.env.PKM_HOME) : path.join(os.homedir(), '.pkm-app');
const FILE = path.join(HOME, 'push.json');
const SUB = process.env.PKM_PUSH_SUB || 'mailto:pkm-app@users.noreply.github.com';
export const KINDS = { ask: true, done: true, run: false };
const SEEN_MS = 70000;   // 앱이 보인다고 알린 뒤 이만큼은 그 기기에 보내지 않는다(화면이 켜져 있으면 30초마다 다시 알린다)
const b64u = b => Buffer.from(b).toString('base64url');
const fail = (status, message) => Object.assign(new Error(message), { status });
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
export const devOf = endpoint => crypto.createHash('sha256').update(String(endpoint)).digest('base64url').slice(0, 16);

// 페이로드 암호화(aes128gcm, 레코드 하나). 브라우저 구독의 p256dh(65바이트 공개키)·auth(16바이트)를 쓴다
export function encrypt(sub, payload, { salt = crypto.randomBytes(16), ecdh = null } = {}){
  const ua = Buffer.from(sub.keys.p256dh, 'base64url'), auth = Buffer.from(sub.keys.auth, 'base64url');
  if (ua.length !== 65 || auth.length !== 16) throw fail(400, '구독 키가 맞지 않아요');
  const e = ecdh || crypto.createECDH('prime256v1'); if (!ecdh) e.generateKeys();
  const as = e.getPublicKey(), shared = e.computeSecret(ua);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([as.length]), as, body]);
}

export function createPush({ file = FILE, fetchImpl = (...a) => fetch(...a), log = m => console.log(m) } = {}){
  let st = null;
  const seen = new Map();   // 기기(dev) → 앱이 보인다고 알린 시각
  function load(){
    if (st) return st;
    try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { st = null; }
    if (!st || !st.vapid || !st.vapid.d){
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const jwk = privateKey.export({ format: 'jwk' });
      st = { v: 1, vapid: { x: jwk.x, y: jwk.y, d: jwk.d }, subs: (st && st.subs) || [] };
      write();
    }
    if (!Array.isArray(st.subs)) st.subs = [];
    return st;
  }
  function write(){
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(st, null, 1) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  const publicKey = () => { const v = load().vapid; return b64u(Buffer.concat([Buffer.from([4]), Buffer.from(v.x, 'base64url'), Buffer.from(v.y, 'base64url')])); };
  const privKey = () => { const v = load().vapid; return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', ...v }, format: 'jwk' }); };
  function jwt(aud){
    const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUB }));
    const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key: privKey(), dsaEncoding: 'ieee-p1363' });
    return `${head}.${claims}.${b64u(sig)}`;
  }
  const view = s => s ? { dev: s.dev, kinds: s.kinds, created: s.created, label: s.label } : null;
  const okEndpoint = u => { try { const x = new URL(u); return x.protocol === 'https:'; } catch { return false; } };

  function status(p, endpoint){
    const s = load(), mine = endpoint ? s.subs.find(x => x.endpoint === endpoint && x.profile === p) : null;
    return { key: publicKey(), sub: view(mine), devices: s.subs.filter(x => x.profile === p).length };
  }
  function subscribe(p, { subscription: sub, kinds, label } = {}){
    if (!sub || !okEndpoint(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw fail(400, '알림 구독 정보가 맞지 않아요');
    encrypt(sub, 'x');   // 키 모양 확인
    const s = load(), k = Object.fromEntries(Object.keys(KINDS).map(n => [n, kinds && typeof kinds[n] === 'boolean' ? kinds[n] : KINDS[n]]));
    let x = s.subs.find(z => z.endpoint === sub.endpoint);
    if (!x){ x = { endpoint: sub.endpoint, created: new Date().toISOString() }; s.subs.push(x); }
    Object.assign(x, { profile: p, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, kinds: k, dev: devOf(sub.endpoint), label: String(label || '').slice(0, 80) });
    if (s.subs.length > 50) s.subs.splice(0, s.subs.length - 50);
    write();
    return view(x);
  }
  function unsubscribe(p, endpoint){
    const s = load(), n = s.subs.length;
    s.subs = s.subs.filter(x => !(x.endpoint === endpoint && x.profile === p));
    if (s.subs.length !== n) write();
    return { removed: n - s.subs.length };
  }
  function mark(dev, visible){ if (!dev) return; if (visible) seen.set(String(dev), Date.now()); else seen.delete(String(dev)); }

  // 하나 보내기 — 404·410이면 그 구독은 사라진 것이라 지운다
  async function deliver(x, msg){
    const body = encrypt(x, JSON.stringify(msg));
    const r = await fetchImpl(x.endpoint, { method: 'POST', body, signal: AbortSignal.timeout(15000), headers: {
      authorization: `vapid t=${jwt(new URL(x.endpoint).origin)}, k=${publicKey()}`,
      'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: msg.kind === 'ask' ? 'high' : 'normal',
      ...(msg.tag ? { topic: crypto.createHash('sha256').update(msg.tag).digest('base64url').slice(0, 32) } : {}) } });
    if (r.status === 404 || r.status === 410){ const s = load(); s.subs = s.subs.filter(z => z !== x); write(); return { ok: false, gone: true }; }
    if (!r.ok){ const t = await r.text().catch(() => ''); return { ok: false, status: r.status, error: t.slice(0, 200) }; }
    return { ok: true };
  }
  // 프로필의 구독 중 그 종류를 켠 기기에, 지금 앱을 보고 있지 않으면 보낸다
  async function notify(p, msg){
    const s = load(), at = Date.now();
    const to = s.subs.filter(x => x.profile === p && x.kinds && x.kinds[msg.kind] && !(at - (seen.get(x.dev) || 0) < SEEN_MS));
    return Promise.all(to.map(x => deliver(x, msg).catch(e => ({ ok: false, error: e.message })).then(r => { if (!r.ok && !r.gone) log(`알림을 보내지 못했어요(${new URL(x.endpoint).host}): ${r.status || ''} ${r.error || ''}`); return r; })));
  }
  async function test(p, endpoint){
    const x = load().subs.find(z => z.endpoint === endpoint && z.profile === p);
    if (!x) throw fail(404, '이 기기는 알림을 켜지 않았어요');
    const r = await deliver(x, { kind: 'test', title: 'PKM 알림 테스트', body: '이렇게 알려 드려요. 누르면 앱이 열려요.', tag: 'pkm-test', url: '/' });
    if (r.gone) throw fail(410, '이 기기의 알림 구독이 끝났어요. 알림을 다시 켜 주세요');
    if (!r.ok) throw fail(502, `푸시 서버가 받지 않았어요(${r.status || r.error})`);
    return { ok: true };
  }
  return { status, subscribe, unsubscribe, mark, notify, test, publicKey, jwt };
}
