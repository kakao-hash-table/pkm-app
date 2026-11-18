#!/usr/bin/env node
// 업비트 포켓 사이에서 원화를 옮긴다(메인포켓 → 서브포켓, --back이면 서브포켓 → 메인포켓).
// 업비트 화면에는 메인 → 서브로 옮기는 메뉴가 없고 API로만 된다(공지 6261). 업비트 퀀트 플러그인에 서브포켓 키를 넣었을 때, 그 포켓에 굴릴 돈을 넣으려고 쓴다.
//   node scripts/upbit-pocket.mjs                      포켓과 원화 잔고를 보이고, 받을 포켓·금액을 물은 뒤 한 번 더 확인하고 옮긴다
//   node scripts/upbit-pocket.mjs --list               보기만
//   node scripts/upbit-pocket.mjs --to=포켓이름 --amount=100000 [--back] [--yes]
// 키: **메인포켓**에서 발급한 API 키여야 하고 [포켓관리] 권한이 있어야 한다(잔고까지 보려면 [자산조회]도). 실행하면 키를 묻는다(Secret key는 화면에 찍지 않는다).
//     환경 변수 UPBIT_MAIN_ACCESS_KEY · UPBIT_MAIN_SECRET_KEY로 줄 수도 있다. 키는 어디에도 저장하지 않는다 — 플러그인(서브포켓 키)과 섞지 않으려고 따로 둔 스크립트다.
// 문서: docs.upbit.com/kr/reference/list-pockets · universal-transfer · list-universal-transfers · get-sub-pocket-balance
import readline from 'node:readline';
import { token, queryOf, API } from '../plugins/upbit-quant/scripts/upbit.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.match(/^--([^=]+)=?([\s\S]*)$/)).filter(Boolean).map(m => [m[1], m[2] === '' ? true : m[2]]));
const BASE = args.api || API;
if (BASE !== API && !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)){ console.error('업비트가 아닌 주소로는 보내지 않아요'); process.exit(1); }
const won = n => `${Math.round(Number(n)).toLocaleString('ko-KR')}원`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WORDS = { out_of_scope: '이 키에 권한이 없어요. 메인포켓에서 발급한 키인지, [포켓관리] 권한을 켰는지 확인해 주세요', no_authorization_ip: '이 컴퓨터의 IP가 이 키의 허용 IP에 없어요',
  invalid_access_key: 'Access key가 맞지 않아요', jwt_verification: 'Secret key가 맞지 않아요', pocket_not_found: '포켓을 찾지 못했어요', currency_not_found: '옮길 수 없는 자산이에요', duplicated_identifier: '이미 보낸 요청이에요' };

function ask(question, { hidden = false } = {}){
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(question); };   // 적는 글자는 찍지 않는다
    rl.question(question, v => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(String(v).trim()); });
  });
}
let KEY, SECRET;
async function call(method, path, params){
  const query = queryOf(params), post = method === 'POST';
  const res = await fetch(`${BASE}${path}${!post && query ? `?${query}` : ''}`, { method, signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', Authorization: `Bearer ${token(KEY, SECRET, query)}`, ...(post ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) }, body: post ? JSON.stringify(params) : undefined });
  const body = await res.json().catch(() => null);
  if (res.ok) return body;
  const name = String(body?.error?.name ?? '');
  throw Object.assign(new Error(WORDS[name] || body?.error?.message || `업비트 HTTP ${res.status}`), { code: name, status: res.status });
}
const krwOf = list => { const a = (Array.isArray(list) ? list : []).find(x => x.currency === 'KRW'); return a ? Number(a.balance) : 0; };
async function balanceOf(p){   // 메인은 /v1/accounts(자산조회 권한), 서브는 /v1/pockets/assets(문서 도식에는 asset으로도 적혀 있다)
  try {
    if (p.type === 'main') return krwOf(await call('GET', '/v1/accounts'));
    try { return krwOf(await call('GET', '/v1/pockets/assets', { uuid: p.uuid })); }
    catch (e) { if (e.status !== 404 || e.code) throw e; return krwOf(await call('GET', '/v1/pockets/asset', { uuid: p.uuid })); }
  } catch { return null; }
}

async function main(){
  KEY = process.env.UPBIT_MAIN_ACCESS_KEY || await ask('메인포켓 Access key: ');
  SECRET = process.env.UPBIT_MAIN_SECRET_KEY || await ask('메인포켓 Secret key(적어도 화면에 보이지 않아요): ', { hidden: true });
  if (!KEY || !SECRET) throw new Error('키가 비어 있어요');
  const pockets = await call('GET', '/v1/pockets');
  if (!Array.isArray(pockets) || !pockets.length) throw new Error('포켓 목록을 받지 못했어요');
  for (const p of pockets) p.krw = await balanceOf(p);
  const mainP = pockets.find(p => p.type === 'main'), subs = pockets.filter(p => p.type !== 'main');
  console.log('\n포켓');
  pockets.forEach(p => console.log(`  ${p.type === 'main' ? '메인' : `서브 ${subs.indexOf(p) + 1}`}  ${p.name}  원화 ${p.krw == null ? '확인 못 함(자산조회 권한이 없을 수 있어요)' : won(p.krw)}`));
  if (args.list) return;
  if (!mainP) throw new Error('메인포켓을 찾지 못했어요');
  if (!subs.length) throw new Error('서브포켓이 없어요. 업비트 PC 웹 › 마이페이지 › Open API 관리에서 먼저 만들어 주세요');

  let sub = args.to ? subs.find(p => p.name === args.to || p.uuid === args.to) : subs.length === 1 ? subs[0] : null;
  if (args.to && !sub) throw new Error(`"${args.to}" 서브포켓이 없어요`);
  if (!sub){ const n = Number(await ask(`\n어느 서브포켓인가요? (1~${subs.length}): `)); sub = subs[n - 1]; if (!sub) throw new Error('고르지 않았어요'); }
  const [from, to] = args.back ? [sub, mainP] : [mainP, sub];
  const amount = Math.floor(Number(String(args.amount ?? await ask(`\n${from.name} → ${to.name}: 옮길 원화 금액(원): `)).replace(/[,\s원]/g, '')));
  if (!(amount > 0)) throw new Error('금액은 0보다 큰 숫자여야 해요');
  if (from.krw != null && amount > from.krw) throw new Error(`${from.name}의 원화(${won(from.krw)})보다 많아요`);
  if (!args.yes){
    const ok = await ask(`\n${from.name} → ${to.name}로 ${won(amount)}을 옮겨요. 맞으면 "옮기기"라고 적어 주세요: `);
    if (ok !== '옮기기'){ console.log('옮기지 않았어요'); return; }
  }
  const sent = await call('POST', '/v1/pockets/universal_transfers', { from: from.uuid, to: to.uuid, currency: 'KRW', amount: String(amount), identifier: `pkm_${Date.now()}` });
  console.log(`\n요청했어요 · 이전 번호 ${sent.uuid} · 상태 ${sent.state}`);
  let state = sent.state;
  for (let i = 0; i < 20 && !['done', 'failed'].includes(state); i++){   // 처리는 뒤에서 된다(submitted → processing → done·failed)
    await sleep(Number(args.poll) || 1500);
    const row = (await call('GET', '/v1/pockets/universal_transfers').catch(() => [])).find(t => t.uuid === sent.uuid);
    if (row) state = row.state;
  }
  if (state === 'done') console.log(`옮겼어요 · ${to.name} 원화 ${(v => v == null ? '확인 못 함' : won(v))(await balanceOf(to))}`);
  else if (state === 'failed') throw new Error('업비트가 이전을 처리하지 못했어요(failed). 업비트에서 사유를 확인해 주세요');
  else console.log(`아직 처리 중이에요(${state}). 잠시 뒤 --list로 잔고를 확인해 주세요`);
}
main().catch(e => { console.error(`\n못 했어요: ${e.message}`); process.exitCode = 1; });
