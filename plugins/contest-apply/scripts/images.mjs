// 포스터 그림 → AI가 읽을 조각. AI는 긴 변이 1,568px를 넘으면 줄여 읽어서, 긴 포스터를 통째로 보내면 글자가 뭉개진다.
// 가로를 1,100px 안으로 맞추고 세로 1,400px씩 겹쳐 자른다. sniff·plan은 순수 함수, cut은 macOS sips(없으면 ffmpeg)로 자른다
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

// 그림 꼴과 크기 — PNG·JPEG·GIF·WEBP·BMP. 그림이 아니면 null
export function sniff(b){
  b = Buffer.from(b || []);
  if (b.length < 26) return null;
  if (b.readUInt32BE(0) === 0x89504e47) return { mime: 'image/png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (/^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1'))) return { mime: 'image/gif', w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b[0] === 0x42 && b[1] === 0x4d) return { mime: 'image/bmp', w: b.readInt32LE(18), h: Math.abs(b.readInt32LE(22)) };
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'){
    const k = b.subarray(12, 16).toString('latin1');
    if (k === 'VP8 ' && b.length >= 30) return { mime: 'image/webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (k === 'VP8L'){ const v = b.readUInt32LE(21); return { mime: 'image/webp', w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 }; }
    if (k === 'VP8X') return { mime: 'image/webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8){
    for (let i = 2; i + 9 < b.length;){
      if (b[i] !== 0xff){ i++; continue; }
      const m = b[i + 1];
      if (m === 0xff || m === 0x01 || (m >= 0xd0 && m <= 0xd9)){ i += m === 0xff ? 1 : 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { mime: 'image/jpeg', w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

// 줄일 크기(sw×sh)와 자를 자리 [{ y, h }]. 조각이 max개를 넘으면 가로를 minWidth까지 더 줄이고, 그래도 넘으면 아래를 버린다(cropped)
export function plan(w, h, { width = 1100, tile = 1400, overlap = 80, max = 6, minWidth = 640 } = {}){
  let s = Math.min(1, width / w);
  const count = sh => sh <= 1568 ? 1 : Math.ceil((sh - overlap) / (tile - overlap));
  if (count(h * s) > max) s = Math.max(Math.min(s, minWidth / w), (max * (tile - overlap) + overlap) / h);
  const sw = Math.max(1, Math.round(w * s)), sh = Math.max(1, Math.round(h * s)), n = count(sh);
  if (n === 1) return { sw, sh, cuts: [{ y: 0, h: sh }], cropped: false };
  const k = Math.min(n, max), step = n > max ? tile - overlap : (sh - tile) / (k - 1);
  return { sw, sh, cuts: Array.from({ length: k }, (_, i) => ({ y: Math.round(i * step), h: tile })), cropped: n > max };
}

// 쓸 만한 그림인지 — 아이콘·단추·띠 배너는 뺀다
export const useful = d => !!d && d.w >= 300 && d.h >= 300 && d.w * d.h >= 200000;

const run = (bin, args) => new Promise((ok, no) => execFile(bin, args, { timeout: 30000, maxBuffer: 1 << 20 }, e => e ? no(e) : ok()));
const exists = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
export function tool(){
  if (process.platform === 'darwin' && exists('/usr/bin/sips')) return 'sips';
  for (const d of [...String(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) if (d && exists(path.join(d, 'ffmpeg'))) return path.join(d, 'ffmpeg');
  return null;
}
const KEEP = 4.5 * 1024 * 1024;   // AI 서버는 한 장 5MB까지 받는다

// 그림 하나 → 조각 파일들 [{ path, mime }]. dir에 name-1.jpg… 로 쓴다. 자를 도구가 없으면 그대로 보낼 수 있는 그림만 그대로
export async function cut(bytes, dir, name, opt = {}){
  const d = sniff(bytes);
  if (!useful(d)) return [];
  const p = plan(d.w, d.h, opt), as = ['image/png', 'image/jpeg'].includes(d.mime) && bytes.length <= KEEP;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keep = () => { const f = path.join(dir, `${name}-1.${d.mime === 'image/png' ? 'png' : 'jpg'}`); fs.writeFileSync(f, bytes); return [{ path: f, mime: d.mime }]; };
  if (as && p.cuts.length === 1 && p.sw === d.w) return keep();
  const t = opt.tool === undefined ? tool() : opt.tool;
  if (!t) return as && Math.max(d.w, d.h) <= 2000 ? keep() : [];   // 자를 도구가 없으면 AI가 줄여도 읽을 만한 것만
  const src = path.join(dir, `${name}-src`), out = [];
  fs.writeFileSync(src, bytes);
  try {
    let from = src;
    if (t === 'sips'){
      from = path.join(dir, `${name}-scaled.jpg`);
      await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-z', String(p.sh), String(p.sw), src, '--out', from]);
    }
    for (const [i, c] of p.cuts.entries()){
      const f = path.join(dir, `${name}-${i + 1}.jpg`);
      if (t === 'sips'){
        if (p.cuts.length === 1) fs.copyFileSync(from, f);
        else await run('/usr/bin/sips', ['-c', String(c.h), String(p.sw), '--cropOffset', String(Math.min(c.y, p.sh - c.h - 1)), '0', from, '--out', f]);   // 맨 아래에 딱 닿으면 sips가 자르지 않는다
      } else await run(t, ['-nostdin', '-v', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', `scale=${p.sw}:${p.sh},crop=${p.sw}:${c.h}:0:${c.y}`, '-q:v', '3', f]);
      const got = sniff(fs.readFileSync(f));
      if (got && got.mime === 'image/jpeg' && fs.statSync(f).size <= KEEP) out.push({ path: f, mime: 'image/jpeg' });
    }
  } catch { return out; }
  finally { for (const f of [src, path.join(dir, `${name}-scaled.jpg`)]) fs.rmSync(f, { force: true }); }
  return out;
}
