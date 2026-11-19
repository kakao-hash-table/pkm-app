// 공모전 신청 — 승인 값 대조·사람 깨우기·사후 추적(피클 자동화 점검표 5·8번과 보고기).
// 메일은 같은 프로세스의 가짜 SMTP(PKM_CONTEST_SMTP)로만 보낸다 — 네이버에 닿지 않는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-contest-ok-')), profile = path.join(T, '개인');
const SCRIPT = new URL('../plugins/contest-apply/scripts/contest.mjs', import.meta.url).pathname;
const STORE = path.join(profile, '_플러그인/.data/contest-apply'), DB = path.join(STORE, 'db.json'), NOW = '2026-11-10T01:00:00.000Z';   // 한국 10시 — 자동 메일 시간 안
fs.mkdirSync(STORE, { recursive: true });
fs.writeFileSync(path.join(profile, '_설정.md'), '---\ntype: settings\nformat: 1\n---\n');
const ME = '이름\t김테스트\n연락처\t010-1234-5678';

// 가짜 SMTP — drop: DATA 본문을 받은 뒤 답 없이 끊는다(보내졌는지 알 수 없는 경우)
const sent = []; let drop = false;
const smtp = net.createServer(sock => {
  let buf = '', data = false, auth = 0;
  const say = s => sock.write(s + '\r\n');
  say('220 fake ESMTP');
  sock.on('data', d => {
    buf += d.toString('utf8');
    for (;;){
      if (data){ const end = buf.indexOf('\r\n.\r\n'); if (end < 0) return; sent.push(buf.slice(0, end)); buf = buf.slice(end + 5); data = false; if (drop){ sock.destroy(); return; } say('250 OK queued'); continue; }
      const i = buf.indexOf('\r\n'); if (i < 0) return;
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (auth){ auth = auth === 1 ? 2 : 0; say(auth ? '334 UGFzc3dvcmQ6' : '235 OK'); continue; }
      if (/^EHLO/.test(line)){ say('250-fake'); say('250 AUTH LOGIN'); }
      else if (line === 'AUTH LOGIN'){ auth = 1; say('334 VXNlcm5hbWU6'); }
      else if (line === 'DATA'){ data = true; say('354 go'); }
      else if (line === 'QUIT'){ say('221 bye'); sock.end(); }
      else say('250 OK');
    }
  });
  sock.on('error', () => {});
});
await new Promise(r => smtp.listen(0, '127.0.0.1', r));
after(() => { smtp.close(); fs.rmSync(T, { recursive: true, force: true }); });

const env = { ...process.env, PKM_HOME: path.join(T, 'home'), NAVER_ID: 'tester', NAVER_APP_PASSWORD: 'fake-not-real', PKM_CONTEST_SMTP: `127.0.0.1:${smtp.address().port}` };
const run = async (cmd, a = {}) => JSON.parse((await exec(process.execPath, [SCRIPT, cmd, `--profile=${profile}`, `--now=${NOW}`, ...Object.entries(a).map(([k, v]) => `--${k}=${v}`)], { env })).stdout.trim().split('\n').pop());
const db = () => JSON.parse(fs.readFileSync(DB, 'utf8')), put = d => fs.writeFileSync(DB, JSON.stringify(d));
const FIT = { i: 0, unreadable: false, target: true, target_why: '', kinds: ['네이밍'], prize: { text: '대상 100만원', total: 1000000, first: 1000000, goods: false, awards: [] },
  deadline: '2026-11-20', announce: '2026-12-01', announce_text: '', submit: { what: '이름 + 뜻', allow: 1, desc_limit: 0, note: '', fields: [], method: 'email', to: 'contest@example.com', how: '이메일 접수', subject: '' },
  eligibility: { text: '누구나', ok: 'yes', why: '' }, ai: { rule: 'none', text: '' }, doubt: '' };
const contest = (key, more = {}) => ({ key, site: 'wevity', source: '위비티', title: `${key} 이름 짓기`, url: 'https://www.wevity.com/?c=find&ix=1', organizer: '수원시', deadline: '2026-11-20', added: NOW, fit: FIT,
  draft: { items: [{ kind: '네이밍', text: '수원새빛', read: '', why: '새 빛', form: [] }], note: '', at: NOW, made: 'x' }, ...more });
const where = (r, w) => r.findings.filter(f => f.where === w);
const mailBtn = r => r.ask.choices.find(c => c.value.startsWith('mail'));

test('메일 — 확인 화면을 본 뒤 붙일 파일이 바뀌면 보내지 않고 다시 보이고, 지문이 맞을 때만 보낸다', async () => {
  put({ contests: { 'wevity:1': contest('wevity:1') } });
  let r = await run('submit', { cid: 'wevity:1', me: ME });
  const shown = mailBtn(r).value;
  assert.match(shown, /^mail:[0-9a-f]{12}$/);
  assert.equal(where(r, '다시 확인').length, 0);

  const extra = path.join(STORE, 'files', 'wevity-1-보탤 파일');
  fs.mkdirSync(extra, { recursive: true }); fs.writeFileSync(path.join(extra, '서명.pdf'), '%PDF-1.4 서명');
  r = await run('submit', { cid: 'wevity:1', me: ME, answer: shown });
  assert.equal(r.summary, '냈는지 묻기');
  assert.match(where(r, '다시 확인')[0].text, /붙일 파일이 바뀌었어요 · 더함 서명\.pdf/);
  assert.equal(where(r, '다시 확인')[0].fold, undefined, '바뀐 이유는 접지 않는다');
  assert.equal(sent.length, 0, '보내지 않았다');
  assert.equal(db().contests['wevity:1'].mail_sending, undefined);
  assert.notEqual(mailBtn(r).value, shown);

  const old = (await run('submit', { cid: 'wevity:1', me: ME, answer: 'mail' }));   // 지문 없는 예전 버튼
  assert.match(where(old, '다시 확인')[0].text, /한 번 더 확인/);
  assert.equal(sent.length, 0);

  const ok = await run('submit', { cid: 'wevity:1', me: ME, answer: mailBtn(r).value });
  assert.deepEqual([ok.choice, ok.to], ['mail', 'contest@example.com']);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /filename\*?=.*(서명|%EC%84%9C%EB%AA%85)/);
  assert.ok(db().contests['wevity:1'].mailed);
});

test('메일 — 내 정보가 바뀌어도 다시 보이고, 바뀐 이유를 말한다', async () => {
  put({ contests: { 'wevity:2': contest('wevity:2') } });
  const r = await run('submit', { cid: 'wevity:2', me: `${ME}\n주소\t수원시\n조합원 여부\t아니오` });
  assert.doesNotMatch(where(r, '메일 본문')[0].copy, /주소|조합원/, '요강이 묻지 않은 내 정보는 메일에 넣지 않는다');
  assert.match(where(r, '메일 본문')[0].copy, /이름: 김테스트\n연락처: 010-1234-5678/);
  const again = await run('submit', { cid: 'wevity:2', me: ME.replace('5678', '0000'), answer: mailBtn(r).value });
  assert.match(where(again, '다시 확인')[0].text, /제목이나 본문이 바뀌었어요/);
  assert.equal(sent.length, 1, '앞 시험의 한 통뿐');
});

test('아이콘처럼 그림을 같이 내야 하는 공모전은 자동으로 보내지 않고 할 일로 보이다가, 보탤 파일을 넣으면 보낸다', async () => {
  put({ contests: { 'wevity:30': contest('wevity:30', { fit: { ...FIT, kinds: ['네이밍', '아이콘'], submit: { ...FIT.submit, what: '명칭과 아이콘 + 참가신청서' } } }), 'wevity:9': contest('wevity:9', { mailed: { at: NOW, to: 'a@b.kr' }, submitted: NOW }) } });
  const before = sent.length;
  const r = await run('submit', { cid: 'wevity:30', me: ME, auto: 'true' });
  assert.equal(sent.length, before, '자동으로 보내지 않는다');
  assert.ok(where(r, '직접 할 일').some(f => /아이콘 작품 파일/.test(f.title)));
  assert.ok(where(r, '직접 할 일').some(f => /신청서/.test(f.title)));
  const extra = path.join(path.dirname(DB), 'files', 'wevity-30-보탤 파일');
  fs.mkdirSync(extra, { recursive: true }); fs.writeFileSync(path.join(extra, '아이콘.png'), 'png');
  const r2 = await run('submit', { cid: 'wevity:30', me: ME, auto: 'true' });
  assert.equal(r2.summary, '메일 보냄');
  assert.equal(sent.length, before + 1);
});

test('자동 메일이 보내졌는지 모르게 끊기면 다시 보내지 않고, 휴대폰 알림으로 사람을 깨운다', async () => {
  put({ contests: { 'wevity:3': contest('wevity:3'), 'wevity:9': contest('wevity:9', { mailed: { at: NOW, to: 'a@b.kr' }, submitted: NOW }) } });
  drop = true;
  const r = await run('submit', { cid: 'wevity:3', me: ME, auto: 'true' });
  drop = false;
  assert.match(r.error, /알 수 없어요/);
  assert.match(r.notify.title, /자동 메일 — 제출됐는지 확인이 필요해요/);
  assert.match(r.notify.text, /wevity:3 이름 짓기/);
  assert.ok(db().contests['wevity:3'].mail_sending, '보내는 중 기록이 남아 다음에 다시 보내지 않는다');
  const next = await run('submit', { cid: 'wevity:3', me: ME, auto: 'true' });
  assert.equal(next.summary, '냈는지 묻기', '다음 자동 실행도 보내지 않고 묻는다');
});

test('사후 추적 — 낸 공모전의 발표일이 오면 한 번만 알리고, 오래 지난 것은 알리지 않는다', async () => {
  const sentC = (key, announce) => contest(key, { submitted: NOW, mailed: { at: NOW, to: 'a@b.kr' }, fit: { ...FIT, announce } });
  put({ contests: { 'wevity:20': sentC('wevity:20', '2026-11-10'), 'wevity:21': sentC('wevity:21', '2026-10-01'), 'wevity:22': sentC('wevity:22', '2026-12-01') } });
  let r = await run('sent-list');
  assert.deepEqual(r.notify, { title: '오늘 발표 · wevity:20 이름 짓기', text: "주최 홈페이지·메일에서 결과를 확인하고 '결과 기다리는 공모전'에서 [결과 적기]를 눌러 주세요" });
  assert.deepEqual(['wevity:20', 'wevity:21', 'wevity:22'].map(k => db().contests[k].announce_told), ['2026-11-10', '2026-11-10', undefined]);
  r = await run('sent-list');
  assert.equal(r.notify, undefined, '두 번 알리지 않는다');
  assert.equal(r.items.length, 3);
  const fin = await run('finish', { cid: 'wevity:22', choice: 'mail' });
  assert.match(fin.verdict.text, /발표일\(12월 1일\)이 되면 알림으로 알려 드려요/);
});
