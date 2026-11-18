// 공모전 신청 플러그인의 요강 그림 모듈(plugins/contest-apply/scripts/images.mjs) — 그림 꼴·크기 읽기, 자를 계획, 실제로 자르기(sips·ffmpeg가 있을 때)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import * as I from '../plugins/contest-apply/scripts/images.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-contest-img-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// 줄마다 색이 바뀌는 w×h PNG(압축은 zlib) — 자른 조각이 어디서 왔는지 볼 수 있게
function png(w, h){
  const crc = b => { let c = ~0; for (const x of b){ c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.fill(y % 256, y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('sniff: PNG·JPEG·GIF·WEBP·BMP의 꼴과 크기, 그림이 아니면 null', () => {
  assert.deepEqual(I.sniff(png(740, 1046)), { mime: 'image/png', w: 740, h: 1046 });
  const jpg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffc0001108041602e403012200021101031101', 'hex');
  assert.deepEqual(I.sniff(jpg), { mime: 'image/jpeg', w: 740, h: 1046 });
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0xe4, 0x02, 0x16, 0x04]), Buffer.alloc(20)]);
  assert.deepEqual(I.sniff(gif), { mime: 'image/gif', w: 740, h: 1046 });
  const riff = (k, body) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP' + k), body]);
  const vp8x = Buffer.alloc(18); vp8x.writeUIntLE(739, 8, 3); vp8x.writeUIntLE(1045, 11, 3);
  assert.deepEqual(I.sniff(riff('VP8X', vp8x)), { mime: 'image/webp', w: 740, h: 1046 });
  const vp8l = Buffer.alloc(18); vp8l.writeUInt32LE(739 | (1045 << 14), 5);
  assert.deepEqual(I.sniff(riff('VP8L', vp8l)), { mime: 'image/webp', w: 740, h: 1046 });
  const bmp = Buffer.alloc(30); bmp.write('BM'); bmp.writeInt32LE(740, 18); bmp.writeInt32LE(-1046, 22);
  assert.deepEqual(I.sniff(bmp), { mime: 'image/bmp', w: 740, h: 1046 });
  assert.equal(I.sniff(Buffer.from('<html>요강</html>                    ')), null);
});

test('plan: 한 장에 읽히면 그대로, 긴 포스터는 가로를 줄이고 1,400px씩 겹쳐 자르고, 너무 길면 아래를 버린다', () => {
  assert.deepEqual(I.plan(740, 1046), { sw: 740, sh: 1046, cuts: [{ y: 0, h: 1046 }], cropped: false });
  assert.deepEqual(I.plan(2400, 3000).cuts, [{ y: 0, h: 1375 }], '넓은 그림은 가로 1,100px로 줄이면 한 장');
  const p = I.plan(860, 6000);
  assert.equal(p.sw, 860); assert.equal(p.cuts.length, 5);
  assert.deepEqual([p.cuts[0].y, p.cuts.at(-1).y + p.cuts.at(-1).h], [0, 6000], '맨 위부터 맨 아래까지');
  assert.ok(p.cuts.every((c, i) => !i || p.cuts[i - 1].y + p.cuts[i - 1].h - c.y >= 80), '조각끼리 80px 넘게 겹친다');
  const q = I.plan(860, 9000);
  assert.equal(q.cuts.length, 6); assert.equal(q.cropped, false); assert.ok(q.sw >= 640 && q.sw < 860, '6장에 들게 가로를 줄인다');
  const r = I.plan(860, 30000);
  assert.deepEqual([r.sw, r.cuts.length, r.cropped], [640, 6, true], '640px 밑으로는 줄이지 않고 아래를 버린다');
  assert.equal(I.plan(860, 6000, { max: 2 }).cuts.length, 2);
  assert.equal(I.useful({ w: 120, h: 40 }), false);
  assert.equal(I.useful({ w: 1200, h: 150 }), false, '띠 배너');
  assert.equal(I.useful({ w: 600, h: 750 }), true);
});

test('cut: 읽을 만한 PNG는 그대로 한 장, 아이콘은 버린다', async () => {
  const one = await I.cut(png(740, 1046), path.join(tmp, 'a'), '공모-1');
  assert.deepEqual(one, [{ path: path.join(tmp, 'a', '공모-1-1.png'), mime: 'image/png' }]);
  assert.deepEqual(await I.cut(png(64, 64), path.join(tmp, 'a'), '아이콘'), []);
  assert.deepEqual(await I.cut(png(740, 4184), path.join(tmp, 'b'), '긴', { tool: null }), [], '자를 도구가 없으면 긴 포스터는 보내지 않는다');
});

for (const [name, bin] of [['sips', I.tool() === 'sips' ? 'sips' : null], ['ffmpeg', ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(f => fs.existsSync(f))]]){
  test(`cut(${name}): 긴 포스터를 가로 그대로 1,400px 조각 JPEG로 자르고, 맨 아래 조각도 잘린다`, { skip: !bin && `${name}이 없어요` }, async () => {
    const dir = path.join(tmp, name), out = await I.cut(png(740, 4184), dir, 'wevity-1-1', { tool: bin });   // 플러그인은 영문 키로 이름 짓는다(sips는 한글 이름을 NFD로 쓴다)
    assert.equal(out.length, 4);
    for (const o of out) assert.deepEqual(I.sniff(fs.readFileSync(o.path)), { mime: 'image/jpeg', w: 740, h: 1400 });
    assert.deepEqual(fs.readdirSync(dir).sort(), ['wevity-1-1-1.jpg', 'wevity-1-1-2.jpg', 'wevity-1-1-3.jpg', 'wevity-1-1-4.jpg'], '원본·줄인 그림은 지운다');
  });
}
