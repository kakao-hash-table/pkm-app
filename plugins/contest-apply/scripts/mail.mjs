// 공모전 응모 메일 — 네이버 메일 SMTP(smtp.naver.com:465, SSL)로 보낸다. 의존성 없이 node:tls 소켓으로 SMTP를 직접 말한다.
// 아이디·애플리케이션 비밀번호는 실행할 때 환경 변수(NAVER_ID·NAVER_APP_PASSWORD)로 받아 넘긴다. 비밀번호는 오류·로그에 남기지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import crypto from 'node:crypto';

const LIMIT = 20 * 1024 * 1024;   // 첨부 합계 상한
const fail = (msg, extra) => { throw Object.assign(new Error(msg), { user: true }, extra); };
const blank = v => v == null || !String(v).trim();
const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const wrap76 = buf => (Buffer.isBuffer(buf) ? buf : Buffer.from(buf)).toString('base64').replace(/.{76}(?=.)/g, '$&\r\n');
const oneLine = s => String(s ?? '').replace(/[\r\n]+/g, ' ');
const ascii = s => /^[\x20-\x7e]*$/.test(s);

export const checkAddress = s => typeof s === 'string' && s.length <= 254 &&
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/.test(s) &&
  !/^\.|\.\.|\.@/.test(s);

// RFC 2047 — 한글 제목을 =?UTF-8?B?…?= 낱말로, 낱말 하나가 75자를 넘지 않게 글자 단위로 끊는다
function encodeWord(s){
  s = oneLine(s);
  if (ascii(s)) return s;
  const words = []; let cur = '';
  for (const ch of s) {
    if (Buffer.byteLength(cur + ch) > 39) { words.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map(w => `=?UTF-8?B?${b64(w)}?=`).join('\r\n ');
}

// RFC 2231 — 파일 이름 filename*=UTF-8''%EA%B0…, 길면 *0* *1* 로 나눈다
function fileParam(name){
  if (ascii(name) && !/["\\]/.test(name)) return `filename="${name}"`;
  const enc = encodeURIComponent(name).replace(/[*'()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const parts = enc.match(/(?:%[0-9A-F]{2}|[^%]){1,60}/g) || [''];   // %XX를 가르지 않게
  if (parts.length === 1) return `filename*=UTF-8''${enc}`;
  return parts.map((p, i) => `filename*${i}*=${i ? '' : "UTF-8''"}${p}`).join(';\r\n ');
}

const TYPES = { hwp: 'application/x-hwp', hwpx: 'application/hwp+zip', pdf: 'application/pdf', zip: 'application/zip',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', txt: 'text/plain', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const typeOf = name => TYPES[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';

// Date 헤더 — 한국 시각(+0900)
const dateHeader = d => new Date(d.getTime() + 9 * 3600000).toUTCString().replace('GMT', '+0900');
const splitFrom = from => { const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(from)); return m ? { name: m[1].replace(/^"|"$/g, ''), addr: m[2].trim() } : { name: '', addr: String(from).trim() }; };
const asList = to => (Array.isArray(to) ? to : String(to ?? '').split(/[,;]/)).map(a => String(a).trim()).filter(Boolean);

// 첨부 하나를 { filename, content(Buffer) } 로
function loadFile(a){
  if (a.path) {
    let content;
    try { content = fs.readFileSync(a.path); } catch { fail(`첨부 파일을 읽지 못했어요: ${path.basename(a.path)}`); }
    return { filename: a.filename || path.basename(a.path), content };
  }
  if (a.content == null) fail(`첨부 파일 내용이 비어 있어요: ${a.filename || '(이름 없음)'}`);
  return { filename: a.filename || 'file', content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content) };
}

// MIME 글(multipart/mixed) — 줄바꿈은 CRLF, 끝도 CRLF
export function buildMessage({ from, to, subject = '', text = '', attachments = [], messageId, date = new Date(), boundary }){
  const f = splitFrom(from);
  const id = messageId || `<${crypto.randomBytes(12).toString('hex')}@naver.com>`;
  const b = boundary || `=_pkm_${crypto.randomBytes(12).toString('hex')}`;
  const files = attachments.map(loadFile);
  const head = [
    `From: ${f.name ? `${encodeWord(f.name)} <${f.addr}>` : f.addr}`,
    `To: ${asList(to).join(',\r\n ')}`,
    `Subject: ${encodeWord(subject)}`,
    `Date: ${dateHeader(date)}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b}"`,
  ];
  const body = ['', `--${b}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    wrap76(Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8'))];
  for (const a of files) {
    body.push(`--${b}`,
      `Content-Type: ${typeOf(a.filename)}; name="${encodeWord(a.filename).replace(/\r\n /g, '')}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; ${fileParam(oneLine(a.filename))}`, '', wrap76(a.content));
  }
  body.push(`--${b}--`, '');
  return [...head, ...body].join('\r\n');
}

// DATA 안에서 줄 앞 '.' 은 '..' 로
export const dotStuff = raw => raw.replace(/(^|\r\n)\./g, '$1..');

// 응답 읽기 — 다중 줄(250-…)을 모아 마지막 줄(250 …)에서 하나로 돌려준다
function session(sock){
  let buf = '', dead = null;
  const lines = [], waiters = [];
  const pump = () => {
    while (waiters.length) {
      const i = lines.findIndex(l => /^\d{3}(?: |$)/.test(l));
      if (i >= 0) {
        const got = lines.splice(0, i + 1);
        waiters.shift().resolve({ code: Number(got[i].slice(0, 3)), text: got.map(l => l.slice(4)).join(' ').trim() });
      } else if (dead) waiters.shift().reject(dead);
      else return;
    }
  };
  sock.setEncoding('utf8');
  sock.on('data', d => { buf += d; const parts = buf.split(/\r?\n/); buf = parts.pop(); lines.push(...parts); pump(); });
  sock.on('error', e => { dead ||= e; pump(); });
  sock.on('close', () => { dead ||= Object.assign(new Error('closed'), { code: 'ECONNRESET' }); pump(); });
  const read = () => new Promise((resolve, reject) => { waiters.push({ resolve, reject }); pump(); });
  const write = s => { if (!dead) sock.write(s); };
  return { read, write, get dead(){ return dead; } };
}

export async function send({ host = 'smtp.naver.com', port = 465, secure = true, user, pass, from, to, subject = '', text = '',
  attachments = [], timeout = 30000, tlsOptions } = {}){
  if (blank(user) || blank(pass)) fail('네이버 아이디와 애플리케이션 비밀번호가 없어요. 설정에서 먼저 넣어 주세요');
  const sender = from || (String(user).includes('@') ? String(user) : `${user}@naver.com`);
  const addr = splitFrom(sender).addr;
  if (!checkAddress(addr)) fail(`보내는 주소가 이메일 꼴이 아니에요: ${oneLine(addr)}`);
  const rcpts = asList(to);
  if (!rcpts.length) fail('받는 주소가 없어요');
  const bad = rcpts.find(a => !checkAddress(a));
  if (bad) fail(`받는 주소가 이메일 꼴이 아니에요: ${oneLine(bad)}`);
  const files = attachments.map(loadFile);
  const total = files.reduce((n, a) => n + a.content.length, 0);
  if (total > LIMIT) fail(`첨부 파일이 모두 ${(total / 1048576).toFixed(1)}MB예요. 한 번에 20MB까지 보낼 수 있어요 — 파일을 줄이거나 나눠 주세요`);

  const messageId = `<${crypto.randomBytes(12).toString('hex')}${Date.now().toString(36)}@naver.com>`;
  const raw = buildMessage({ from: sender, to: rcpts, subject, text, attachments: files, messageId });
  const secrets = [String(pass), b64(pass), b64(user)];
  const scrub = s => secrets.reduce((t, x) => x ? t.split(x).join('***') : t, oneLine(s)).slice(0, 300);
  const smtpFail = (stage, r, who) => {
    if ([534, 535].includes(r.code) || (stage === 'auth' && r.code >= 500))
      fail('네이버 아이디나 애플리케이션 비밀번호가 맞지 않아요. 네이버 메일 › 환경설정 › POP3/SMTP 설정에서 SMTP 사용을 켰는지, 2단계 인증의 애플리케이션 비밀번호를 넣었는지 봐 주세요', { code: r.code });
    if (stage === 'rcpt' && [550, 551, 553].includes(r.code)) fail(`받는 주소를 메일 서버가 받지 않았어요: ${who}`, { code: r.code });
    fail(`메일을 보내지 못했어요(코드 ${r.code}): ${scrub(r.text) || '서버 메시지 없음'}`, { code: r.code });
  };

  const opts = { host, port, ...(secure ? { ...(net.isIP(host) ? {} : { servername: host }), ...tlsOptions } : {}) };
  const sock = secure ? tls.connect(opts) : net.connect(opts);
  sock.setTimeout(timeout, () => sock.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
  const s = session(sock);
  const expect = async (ok, stage, who) => { const r = await s.read(); if (![].concat(ok).includes(r.code)) smtpFail(stage, r, who); return r; };
  const cmd = (line, ok, stage, who) => { s.write(line + '\r\n'); return expect(ok, stage, who); };
  const helo = (os.hostname() || '').replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
  let quit = false;
  try {
    await expect(220, 'hello');
    await cmd(`EHLO ${helo}`, 250, 'hello');
    await cmd('AUTH LOGIN', 334, 'auth');
    await cmd(b64(user), 334, 'auth');
    await cmd(b64(pass), 235, 'auth');
    await cmd(`MAIL FROM:<${addr}>`, 250, 'from');
    for (const r of rcpts) await cmd(`RCPT TO:<${r}>`, [250, 251], 'rcpt', r);
    await cmd('DATA', 354, 'data');
    await cmd(dotStuff(raw) + '.', 250, 'data');   // raw는 CRLF로 끝나므로 CRLF.CRLF
    s.write('QUIT\r\n'); quit = true;
    await s.read().catch(() => {});
    return { ok: true, messageId, accepted: rcpts };
  } catch (e) {
    if (e.user) throw e;
    fail('네이버 메일 서버에 닿지 않아요. 인터넷 연결을 확인하고 다시 해 주세요', { code: e.code === 'ETIMEDOUT' ? 'ETIMEDOUT' : 'ECONNECT' });
  } finally {
    if (!quit) s.write('QUIT\r\n');
    sock.end();
    setTimeout(() => sock.destroy(), 1000).unref();
  }
}
