// 첨부 원본·모델용 이미지는 로컬 채팅 기록과 함께 보관한다. 클라이언트는 임의 경로 대신 방에 묶인 id만 보낸다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const fail = (status, message) => Object.assign(new Error(message), { status });
const IMAGE_MAX = 20 * 1024 * 1024, VIDEO_MAX = 100 * 1024 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm', 'video/ogg', 'video/x-matroska']);
const FORMATS = { 'image/png':'png_pipe', 'image/jpeg':'jpeg_pipe', 'image/webp':'webp_pipe', 'image/gif':'gif', 'image/heic':'mov', 'image/heif':'mov', 'video/mp4':'mov', 'video/quicktime':'mov', 'video/webm':'matroska', 'video/ogg':'ogg', 'video/x-matroska':'matroska' };
const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
const scale = 'scale=1568:1568:force_original_aspect_ratio=decrease';
export function createChatMedia(root){
  let processing = 0;
  const dir = (p, room) => path.join(root, hash(p), hash(room));
  const folder = (p, room, id) => {
    if (!/^[a-f0-9]{32}$/.test(String(id))) throw fail(400, '첨부 id가 올바르지 않아요');
    return path.join(dir(p, room), id);
  };
  function read(p, room, id){
    try { return JSON.parse(fs.readFileSync(path.join(folder(p, room, id), 'meta.json'), 'utf8')); }
    catch (e) { if (e.status) throw e; throw fail(404, '첨부파일이 없어요. 다시 첨부해 주세요'); }
  }
  const view = m => ({ id:m.id, name:m.name, mime:m.mime, size:m.size, kind:m.kind, duration:m.duration, frames:m.images.length });
  async function upload(p, room, req, name){
    const mime = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
    if (!TYPES.has(mime)) throw fail(400, '사진(PNG·JPG·WebP·GIF·HEIC)이나 영상(MP4·MOV·WebM)을 골라 주세요');
    const video = mime.startsWith('video/'), limit = video ? VIDEO_MAX : IMAGE_MAX;
    if (Number(req.headers['content-length']) > limit) throw fail(413, video ? '영상은 100MB까지 첨부해 주세요' : '사진은 20MB까지 첨부해 주세요');
    if (processing >= 2) throw fail(429, '다른 첨부파일을 처리 중이에요. 잠시 뒤 다시 첨부해 주세요');
    const id = crypto.randomBytes(16).toString('hex'), base = folder(p, room, id);
    fs.mkdirSync(base, { recursive:true, mode:0o700 });
    processing++;
    try {
      const file = path.join(base, 'original'), fd = fs.openSync(file, 'wx', 0o600);
      let size = 0;
      try { for await (const b of req){ size += b.length; if (size > limit) throw fail(413, '첨부파일이 너무 커요'); fs.writeSync(fd, b); } }
      finally { fs.closeSync(fd); }
      if (!size) throw fail(400, '빈 파일은 첨부할 수 없어요');
      let duration = null;
      if (video){
        const { stdout } = await exec('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-f', FORMATS[mime], '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], { timeout:15000, maxBuffer:100000 });
        const info = JSON.parse(stdout); duration = Number(info.format?.duration);
        if (!info.streams?.some(s => s.codec_type === 'video') || !Number.isFinite(duration) || duration <= 0) throw fail(400, '영상 길이를 읽지 못했어요. MP4·MOV·WebM으로 다시 첨부해 주세요');
      }
      const images = [], count = video ? Math.min(12, Math.max(1, Math.ceil(duration))) : 1;
      for (let i = 0; i < count; i++){
        const at = video ? Math.max(0, Math.min(duration - 0.05, duration * i / count)) : null;
        const output = path.join(base, `${i}.jpg`);
        await exec('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-f', FORMATS[mime], ...(video ? ['-ss', String(at)] : []), '-i', file, '-map', '0:v:0', '-frames:v', '1', '-vf', scale, '-q:v', '3', '-threads', '1', output], { timeout:30000, maxBuffer:100000 });
        if (!fs.existsSync(output)) throw fail(400, '영상에서 장면을 읽지 못했어요');
        fs.chmodSync(output, 0o600);
        images.push({ path:output, mime:'image/jpeg', at });
      }
      const m = { id, name:String(name || (video ? '영상' : '사진')).replace(/[\x00-\x1f]/g, '').slice(0, 200), mime, kind:video ? 'video' : 'image', size, duration, images };
      fs.writeFileSync(path.join(base, 'meta.json'), JSON.stringify(m), { mode:0o600 });
      return view(m);
    } catch (e) {
      fs.rmSync(base, { recursive:true, force:true });
      if (e.status) throw e;
      if (e.code === 'ENOENT') throw fail(409, '사진·영상 처리를 위해 이 컴퓨터에 FFmpeg(ffmpeg·ffprobe)가 필요해요');
      throw fail(400, '사진·영상을 읽지 못했어요. 지원되는 형식인지 확인해 주세요');
    } finally { processing--; }
  }
  function resolve(p, room, ids){
    if (!Array.isArray(ids) || ids.length > 8 || new Set(ids).size !== ids.length) throw fail(400, '첨부는 한 번에 서로 다른 파일 8개까지 가능해요');
    const media = ids.map(id => read(p, room, id));
    if (media.reduce((n, m) => n + m.images.length, 0) > 24) throw fail(400, '한 번에 사진·영상 장면 24장까지 보낼 수 있어요. 영상을 나누어 보내 주세요');
    return { attachments:media.map(view), images:media.flatMap(m => m.images), text:media.map(m => m.kind === 'video'
      ? `영상 ${JSON.stringify(m.name)} (${m.duration.toFixed(2)}초): ${m.images.map(x => x.at.toFixed(2) + '초').join(', ')} 순서로 추출한 ${m.images.length}장면. 음성은 포함되지 않았으며 장면 사이의 사건은 확인할 수 없습니다.`
      : `사진 ${JSON.stringify(m.name)}: 이미지 1장${m.mime === 'image/gif' ? ' (GIF 첫 프레임)' : ''}`).join('\n') };
  }
  function serve(p, room, id, req, res){
    const m = read(p, room, id), file = path.join(folder(p, room, id), req.url.includes('preview=1') ? '0.jpg' : 'original');
    const size = fs.statSync(file).size, preview = file.endsWith('.jpg');
    const h = { 'content-type':preview ? 'image/jpeg' : m.mime, 'cache-control':'private, no-store', 'x-content-type-options':'nosniff', 'accept-ranges':'bytes' };
    let start = 0, end = size - 1, status = 200;
    if (req.headers.range){
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { ...h, 'content-range':`bytes */${size}` }); return res.end(); }
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { ...h, 'content-range':`bytes */${size}` }); return res.end(); }
      status = 206; h['content-range'] = `bytes ${start}-${end}/${size}`;
    }
    res.writeHead(status, { ...h, 'content-length':end - start + 1 });
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  }
  return { upload, resolve, serve };
}
