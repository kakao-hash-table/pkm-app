import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createChatMedia } from '../server/chat-media.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-media-test-'));
after(() => fs.rmSync(root, { recursive:true, force:true }));
const media = createChatMedia(path.join(root, 'media'));
const req = (file, mime) => Object.assign(Readable.from([fs.readFileSync(file)]), { headers:{ 'content-type':mime } });
const png = path.join(root, 'test.png'), mp4 = path.join(root, 'test.mp4');
execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=red:s=160x90','-frames:v','1',png]);
execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc=size=160x90:rate=4','-t','2','-pix_fmt','yuv420p',mp4]);
let photo, video;

test('사진을 JPEG로 정규화하고 방별 id로 복원한다', async () => {
  photo = await media.upload('개인', 'data', req(png, 'image/png'), '<사진>.png');
  assert.equal(photo.kind, 'image'); assert.equal(photo.frames, 1); assert.equal(photo.name, '<사진>.png');
  assert.equal('images' in photo, false, '브라우저에 로컬 경로를 노출하지 않는다');
  const r = media.resolve('개인', 'data', [photo.id]);
  assert.equal(r.images[0].mime, 'image/jpeg'); assert.ok(fs.existsSync(r.images[0].path));
  assert.equal(fs.readFileSync(r.images[0].path)[0], 255);
  assert.throws(() => media.resolve('회사', 'data', [photo.id]), { status:404 });
  assert.throws(() => media.resolve('개인', 'other', [photo.id]), { status:404 });
  assert.throws(() => media.resolve('개인', 'data', ['../../etc/passwd']), { status:400 });
});

test('영상 전체에서 시간순 장면을 추출하고 음성 제외를 명시한다', async () => {
  video = await media.upload('개인', 'data', req(mp4, 'video/mp4'), '영상.mp4');
  assert.equal(video.kind, 'video'); assert.equal(video.duration, 2); assert.equal(video.frames, 2);
  const r = media.resolve('개인', 'data', [photo.id, video.id]);
  assert.equal(r.images.length, 3); assert.deepEqual(r.images.slice(1).map(i => i.at), [0, 1]);
  assert.match(r.text, /0.00초, 1.00초/); assert.match(r.text, /음성은 포함되지/);
  const restored = createChatMedia(path.join(root, 'media'));
  assert.deepEqual(restored.resolve('개인', 'data', [video.id]), media.resolve('개인', 'data', [video.id]));
});

test('형식·개수·크기·없는 파일 검사와 실패한 업로드 정리', async () => {
  await assert.rejects(media.upload('개인','data',req(png,'text/html'),'bad'), { status:400 });
  const huge = Object.assign(Readable.from([]), { headers:{'content-type':'video/mp4','content-length':101 * 1024 * 1024} });
  await assert.rejects(media.upload('개인','data',huge,'big.mp4'), { status:413 });
  const invalid = Object.assign(Readable.from(['broken']), { headers:{'content-type':'image/png'} });
  await assert.rejects(media.upload('개인','data',invalid,'bad.png'), { status:400 });
  assert.throws(() => media.resolve('개인','data',[photo.id,photo.id]), { status:400 });
  assert.throws(() => media.resolve('개인','data',Array(9).fill(photo.id)), { status:400 });
});

test('미리보기·원본 재생과 영상 Range 요청을 제공한다', async t => {
  const server = http.createServer((req,res) => {
    try { media.serve('개인','data', req.url.startsWith('/photo') ? photo.id : video.id, req, res); }
    catch(e){res.writeHead(e.status || 500);res.end();}
  });
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let r = await fetch(base+'/photo?preview=1'); assert.equal(r.status,200); assert.equal(r.headers.get('content-type'),'image/jpeg'); await r.arrayBuffer();
  r = await fetch(base+'/video',{headers:{range:'bytes=0-99'}}); assert.equal(r.status,206); assert.equal((await r.arrayBuffer()).byteLength,100);
  assert.match(r.headers.get('content-range'),/^bytes 0-99\//);
  r = await fetch(base+'/video',{headers:{range:'bytes=-32'}}); assert.equal((await r.arrayBuffer()).byteLength,32);
  r = await fetch(base+'/video',{headers:{range:'bytes=999999999-'}}); assert.equal(r.status,416);
});
