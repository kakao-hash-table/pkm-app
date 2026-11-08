// 휴대폰 알림(웹 푸시) — 브라우저처럼 풀어 보는 암호화 왕복, VAPID 서명, 종류·보는 중 거르기, 사라진 구독 지우기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createPush, encrypt, devOf } from '../server/push.js';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-push-'));
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
// 브라우저 쪽 — 구독 키를 만들고, 받은 본문을 RFC 8291대로 푼다
function browser(){
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const keys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  const decrypt = buf => {
    const salt = buf.subarray(0, 16), idlen = buf[20], as = buf.subarray(21, 21 + idlen), ct = buf.subarray(21 + idlen);
    const ua = ecdh.getPublicKey(), shared = ecdh.computeSecret(as);
    const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as, Buffer.from([1])]));
    const prk = hmac(salt, ikm);
    const d = crypto.createDecipheriv('aes-128-gcm', hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16), hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12));
    d.setAuthTag(ct.subarray(ct.length - 16));
    const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    assert.equal(pt[pt.length - 1], 2);   // 마지막 레코드 표시
    return JSON.parse(pt.subarray(0, -1).toString());
  };
  return { keys, decrypt };
}

test('암호화 — 브라우저가 자기 키로 풀 수 있고, 머리에 레코드 크기와 보내는 쪽 공개키가 있다', () => {
  const b = browser(), buf = encrypt({ keys: b.keys }, JSON.stringify({ title: '안녕' }));
  assert.equal(buf.readUInt32BE(16), 4096); assert.equal(buf[20], 65); assert.equal(buf[21], 4);
  assert.deepEqual(b.decrypt(buf), { title: '안녕' });
  assert.throws(() => encrypt({ keys: { p256dh: 'AAAA', auth: b.keys.auth } }, 'x'), /구독 키/);
});

test('구독·보내기 — VAPID 서명, 종류와 보는 중 거르기, 404·410이면 구독을 지운다', async () => {
  const sent = [];
  let status = 201;
  const push = createPush({ file: path.join(T, 'push.json'), log: () => {}, fetchImpl: async (url, opt) => { sent.push({ url, opt }); return new Response('', { status }); } });
  const a = browser(), b = browser();
  const st = push.status('개인');
  assert.equal(Buffer.from(st.key, 'base64url').length, 65); assert.equal(st.sub, null);
  assert.equal(fs.statSync(path.join(T, 'push.json')).mode & 0o777, 0o600);
  await assert.rejects(async () => push.subscribe('개인', { subscription: { endpoint: 'http://x', keys: a.keys } }), /구독 정보/);
  const sa = push.subscribe('개인', { subscription: { endpoint: 'https://web.push.apple.com/a', keys: a.keys } });
  assert.deepEqual(sa.kinds, { ask: true, done: true, run: false }); assert.equal(sa.dev, devOf('https://web.push.apple.com/a'));
  push.subscribe('개인', { subscription: { endpoint: 'https://fcm.googleapis.com/b', keys: b.keys }, kinds: { done: false } });
  push.subscribe('회사', { subscription: { endpoint: 'https://fcm.googleapis.com/c', keys: b.keys } });

  await push.notify('개인', { kind: 'ask', title: '확인 요청', body: 'Write', tag: 'data:1' });
  assert.deepEqual(sent.map(x => x.url).sort(), ['https://fcm.googleapis.com/b', 'https://web.push.apple.com/a']);
  const h = sent.find(x => x.url.includes('apple')).opt;
  assert.equal(h.headers['content-encoding'], 'aes128gcm'); assert.equal(h.headers.urgency, 'high'); assert.ok(h.headers.topic.length <= 32);
  assert.deepEqual(a.decrypt(h.body), { kind: 'ask', title: '확인 요청', body: 'Write', tag: 'data:1' });
  // 서명: aud는 푸시 서버 출처, k는 공개키, ES256으로 검증된다
  const [, t, k] = h.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, st.key);
  const [hd, cl, sig] = t.split('.'), claims = JSON.parse(Buffer.from(cl, 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com'); assert.match(claims.sub, /^mailto:/); assert.ok(claims.exp > Date.now() / 1000);
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(k, 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(k, 'base64url').subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${hd}.${cl}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));

  sent.length = 0;
  await push.notify('개인', { kind: 'done', title: '끝' });   // b는 done을 껐다
  assert.deepEqual(sent.map(x => x.url), ['https://web.push.apple.com/a']);
  sent.length = 0;
  push.mark(sa.dev, true);   // a로 앱을 보는 중
  await push.notify('개인', { kind: 'ask', title: '확인' });
  assert.deepEqual(sent.map(x => x.url), ['https://fcm.googleapis.com/b']);
  push.mark(sa.dev, false);
  await push.test('개인', 'https://web.push.apple.com/a');   // 테스트는 거르지 않는다
  await assert.rejects(push.test('개인', 'https://nope'), /켜지 않았어요/);

  status = 410; sent.length = 0;
  await push.notify('개인', { kind: 'ask', title: '확인' });
  assert.equal(sent.length, 2);
  assert.equal(push.status('개인', 'https://web.push.apple.com/a').sub, null);
  assert.equal(push.status('개인').devices, 0); assert.equal(push.status('회사').devices, 1);

  // 다시 켜도 같은 서명 키(구독이 그대로 유효하게)
  assert.equal(createPush({ file: path.join(T, 'push.json') }).publicKey(), st.key);
  assert.deepEqual(push.unsubscribe('회사', 'https://fcm.googleapis.com/c'), { removed: 1 });
});
