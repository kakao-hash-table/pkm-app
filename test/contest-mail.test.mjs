// 공모전 응모 메일(plugins/contest-apply/scripts/mail.mjs) — 같은 프로세스의 가짜 SMTP 서버(평문)로 대화 순서·AUTH LOGIN·DATA 본문을 본다.
// 실제 네이버로 보내는 테스트는 없다(사용자 계정으로 메일이 나가므로).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import { send, buildMessage, checkAddress, dotStuff } from '../plugins/contest-apply/scripts/mail.mjs';

const USER = 'contestme', PASS = 'Secr3tAppPw!';
const b64 = s => Buffer.from(s).toString('base64');

// 가짜 SMTP — opts: authFail, reject(받지 않을 주소), silent(인사 없음)
function fakeSmtp(opts = {}){
  const log = { cmds: [], data: '' };
  const server = net.createServer(sock => {
    if (opts.silent) return;
    let buf = '', inData = false, auth = 0;
    const say = s => sock.write(s + '\r\n');
    say('220 fake.smtp ESMTP');
    sock.on('data', d => {
      buf += d.toString('utf8');
      while (true) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          log.data = buf.slice(0, end + 2); buf = buf.slice(end + 5); inData = false;
          say('250 2.0.0 OK queued'); continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        log.cmds.push(line);
        if (auth === 1) { auth = 2; say('334 UGFzc3dvcmQ6'); continue; }
        if (auth === 2) { auth = 0; say(opts.authFail ? `535 5.7.8 Username and Password not accepted ${line}` : '235 2.7.0 Accepted'); continue; }
        if (/^EHLO /.test(line)) { say('250-fake.smtp'); say('250-AUTH LOGIN PLAIN'); say('250 8BITMIME'); }
        else if (line === 'AUTH LOGIN') { auth = 1; say('334 VXNlcm5hbWU6'); }
        else if (/^MAIL FROM:/.test(line)) say('250 OK');
        else if (/^RCPT TO:/.test(line)) say((opts.reject || []).some(a => line.includes(a)) ? '550 5.1.1 no such user' : '250 OK');
        else if (line === 'DATA') { inData = true; say('354 go ahead'); }
        else if (line === 'QUIT') { say('221 bye'); sock.end(); }
        else say('502 unknown');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ port: server.address().port, log, close: () => new Promise(c => server.close(c)) })));
}

const unstuff = data => data.replace(/(^|\r\n)\.\./g, '$1.');
function parse(raw){
  const [head, ...rest] = raw.split('\r\n\r\n');
  const headers = {};
  for (const l of head.replace(/\r\n[ \t]/g, ' ').split('\r\n')) { const i = l.indexOf(':'); headers[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); }
  const boundary = /boundary="([^"]+)"/.exec(headers['content-type'])[1];
  const parts = rest.join('\r\n\r\n').split(`--${boundary}`).slice(1, -1).map(p => {
    const [h, ...b] = p.replace(/^\r\n/, '').split('\r\n\r\n');
    return { head: h.replace(/\r\n[ \t]/g, ' '), body: Buffer.from(b.join('\r\n\r\n').replace(/\r\n/g, ''), 'base64'), lines: b.join('').split('\r\n') };
  });
  return { headers, parts };
}
const decodeWords = s => s.replace(/\?=\s+=\?/g, '?==?').replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (_, x) => Buffer.from(x, 'base64').toString('utf8'));
const filenameOf = head => {
  const parts = [...head.matchAll(/filename\*(\d*)\*?=([^;]+)/g)].map(m => m[2].trim());
  return parts.length ? decodeURIComponent(parts.join('').replace(/^UTF-8''/, '')) : /filename="([^"]+)"/.exec(head)[1];
};

test('대화 순서·AUTH LOGIN·한글 제목·첨부 바이트·여러 수신자', async () => {
  const srv = await fakeSmtp();
  const hwp = crypto.randomBytes(5000), pdf = crypto.randomBytes(1234);
  const subject = '[응모] 수원시 브랜드 네이밍 공모전 — 홍길동 출품작입니다 (1인 2건)';
  const text = '안녕하세요.\n홍길동입니다.\n.\n점으로 시작하는 줄';
  try {
    const r = await send({ host: '127.0.0.1', port: srv.port, secure: false, user: USER, pass: PASS, to: ['a@contest.kr', 'b@contest.or.kr'],
      subject, text, attachments: [{ filename: '응모신청서_홍길동.hwp', content: hwp }, { filename: 'plan.pdf', content: pdf }], timeout: 5000 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.accepted, ['a@contest.kr', 'b@contest.or.kr']);
    assert.match(r.messageId, /^<[0-9a-z]+@naver\.com>$/);

    const c = srv.log.cmds;
    assert.match(c[0], /^EHLO /);
    assert.deepEqual(c.slice(1, 9), ['AUTH LOGIN', b64(USER), b64(PASS), `MAIL FROM:<${USER}@naver.com>`,
      'RCPT TO:<a@contest.kr>', 'RCPT TO:<b@contest.or.kr>', 'DATA', 'QUIT']);

    const { headers, parts } = parse(unstuff(srv.log.data));
    assert.equal(decodeWords(headers.subject), subject);
    assert.ok(srv.log.data.split('\r\n').every(l => l.length <= 998));
    assert.equal(headers.from, `${USER}@naver.com`);
    assert.equal(headers.to, 'a@contest.kr, b@contest.or.kr');
    assert.equal(headers['message-id'], r.messageId);
    assert.equal(headers['mime-version'], '1.0');
    assert.match(headers.date, /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} \+0900$/);
    assert.match(headers['content-type'], /^multipart\/mixed/);

    assert.equal(parts.length, 3);
    assert.match(parts[0].head, /text\/plain; charset=UTF-8/);
    assert.equal(parts[0].body.toString('utf8'), text.replace(/\n/g, '\r\n'));
    assert.match(parts[1].head, /application\/x-hwp/);
    assert.equal(filenameOf(parts[1].head), '응모신청서_홍길동.hwp');
    assert.ok(parts[1].body.equals(hwp));
    assert.ok(parts[1].lines.filter(Boolean).every(l => l.length <= 76));
    assert.match(parts[2].head, /application\/pdf/);
    assert.equal(filenameOf(parts[2].head), 'plan.pdf');
    assert.ok(parts[2].body.equals(pdf));
  } finally { await srv.close(); }
});

test('점 이스케이프 — 줄 앞 점만 두 개로', () => {
  assert.equal(dotStuff('.a\r\nb.c\r\n.\r\n..d\r\n'), '..a\r\nb.c\r\n..\r\n...d\r\n');
});

test('MIME — 긴 한글 파일 이름은 나눠 담고 확장자로 Content-Type', () => {
  const name = '가나다라마바사아자차카타파하'.repeat(4) + '.hwpx';
  const raw = buildMessage({ from: '홍길동 <me@naver.com>', to: 'x@y.kr', subject: 'hello', text: '', attachments: [{ filename: name, content: 'x' }, { filename: 'a.bin', content: 'y' }] });
  const { headers, parts } = parse(raw);
  assert.equal(decodeWords(headers.from), '홍길동 <me@naver.com>');
  assert.equal(headers.subject, 'hello');
  assert.match(parts[1].head, /application\/hwp\+zip/);
  assert.match(parts[1].head, /filename\*1\*=/);
  assert.equal(filenameOf(parts[1].head), name);
  assert.match(parts[2].head, /application\/octet-stream/);
  assert.ok(raw.split('\r\n').every(l => l.length <= 998));
});

test('인증 실패(535) — 정해진 문구, 비밀번호는 오류에 없다', async () => {
  const srv = await fakeSmtp({ authFail: true });
  try {
    await assert.rejects(send({ host: '127.0.0.1', port: srv.port, secure: false, user: USER, pass: PASS, to: 'a@contest.kr', subject: 's', text: 't', timeout: 5000 }), e => {
      assert.equal(e.user, true);
      assert.equal(e.code, 535);
      assert.match(e.message, /^네이버 아이디나 애플리케이션 비밀번호가 맞지 않아요/);
      const dump = JSON.stringify({ m: e.message, s: e.stack, ...e });
      assert.ok(!dump.includes(PASS) && !dump.includes(b64(PASS)));
      return true;
    });
    assert.ok(!srv.log.cmds.some(l => /^MAIL FROM/.test(l)));
  } finally { await srv.close(); }
});

test('받는 사람 거절(550)과 서버의 다른 오류 문구', async () => {
  const srv = await fakeSmtp({ reject: ['nobody@contest.kr'] });
  try {
    await assert.rejects(send({ host: '127.0.0.1', port: srv.port, secure: false, user: USER, pass: PASS, to: 'ok@contest.kr, nobody@contest.kr', subject: 's', text: 't', timeout: 5000 }),
      { message: '받는 주소를 메일 서버가 받지 않았어요: nobody@contest.kr', user: true });
    assert.ok(!srv.log.cmds.includes('DATA'));
  } finally { await srv.close(); }
});

test('타임아웃·연결 거부 — 서버에 닿지 않아요', async () => {
  const srv = await fakeSmtp({ silent: true });
  const t0 = Date.now();
  try {
    await assert.rejects(send({ host: '127.0.0.1', port: srv.port, secure: false, user: USER, pass: PASS, to: 'a@contest.kr', timeout: 300 }),
      { message: '네이버 메일 서버에 닿지 않아요. 인터넷 연결을 확인하고 다시 해 주세요', code: 'ETIMEDOUT' });
    assert.ok(Date.now() - t0 < 3000);
  } finally { await srv.close(); }
  const gone = await fakeSmtp(); const port = gone.port; await gone.close();
  await assert.rejects(send({ host: '127.0.0.1', port, secure: false, user: USER, pass: PASS, to: 'a@contest.kr', timeout: 2000 }), { message: /^네이버 메일 서버에 닿지 않아요/ });
});

test('20MB 상한·빈 계정·주소 꼴 — 보내기 전에 막는다', async () => {
  const srv = await fakeSmtp();
  const base = { host: '127.0.0.1', port: srv.port, secure: false, user: USER, pass: PASS, to: 'a@contest.kr', subject: 's', timeout: 2000 };
  try {
    await assert.rejects(send({ ...base, attachments: [{ filename: 'a.zip', content: Buffer.alloc(15 * 1048576) }, { filename: 'b.pdf', content: Buffer.alloc(5 * 1048576 + 1) }] }),
      { user: true, message: /20MB까지/ });
    await assert.rejects(send({ ...base, pass: '' }), { user: true, message: /애플리케이션 비밀번호가 없어요/ });
    await assert.rejects(send({ ...base, to: 'not-an-address' }), { user: true, message: /이메일 꼴이 아니에요/ });
    assert.equal(srv.log.cmds.length, 0);
  } finally { await srv.close(); }
});

test('checkAddress', () => {
  for (const ok of ['a@b.kr', 'first.last+tag@sub.example.co.kr', 'me_1@naver.com']) assert.ok(checkAddress(ok), ok);
  for (const bad of ['', 'a@b', '@b.kr', 'a b@c.kr', 'a@b..kr', '.a@b.kr', 'a.@b.kr', 'a@-b.kr', 'a@b.kr\r\nRCPT TO:<x@y.kr>', null]) assert.ok(!checkAddress(bad), String(bad));
});
