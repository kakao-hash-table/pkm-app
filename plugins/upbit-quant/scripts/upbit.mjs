// 업비트 Open API 클라이언트 — 시세(인증 없음)와 거래(JWT). 의존성 없이 node 내장만 쓴다.
// 규칙은 공식 문서(docs.upbit.com/kr/reference) 기준: Authorization: Bearer <JWT(HS512)>, payload { access_key, nonce, query_hash(SHA512), query_hash_alg },
// query_hash는 GET·DELETE면 쿼리 문자열, POST면 JSON 본문을 key=value&… 로 이은 글(인코딩하지 않은 그대로)의 해시. 주문 본문은 JSON만 받는다.
import crypto from 'node:crypto';

export const API = 'https://api.upbit.com';   // 끝에 /를 붙이지 않는다(경로에 //가 생기면 오류)
const PATH = { '1h': 'minutes/60', '4h': 'minutes/240', '1d': 'days' };
const STEP = { '1h': 3600, '4h': 14400, '1d': 86400 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = v => Buffer.from(v).toString('base64url');

export class UpbitError extends Error {
  constructor(message, { name = '', status = 0, unsure = false } = {}){ super(message); this.code = name; this.status = status; this.unsure = unsure; this.user = true; }
}
// 사람에게 보일 말 — 업비트의 error.name으로 가른다(문서가 message가 아니라 name으로 보라고 한다)
const WORDS = {
  invalid_access_key: 'Access key가 맞지 않아요. 설정에서 다시 넣어 주세요', jwt_verification: 'Secret key가 맞지 않아요. 설정에서 다시 넣어 주세요', invalid_query_payload: '요청 서명이 맞지 않아요',
  no_authorization_ip: '이 컴퓨터의 IP가 업비트 API 키의 허용 IP에 없어요. 업비트 Open API 관리에서 IP를 더해 주세요', out_of_scope: 'API 키에 이 일을 할 권한이 없어요. 자산조회·주문조회·주문하기를 켜 주세요',
  expired_access_key: 'API 키가 만료됐어요(유효 기간 1년). 새로 발급해 넣어 주세요', nonce_used: '같은 요청을 두 번 보냈어요',
  insufficient_funds_bid: '원화가 모자라요', insufficient_funds_ask: '팔 코인이 모자라요', under_min_total_bid: '최소 주문 금액(5,000원)보다 적어요', under_min_total_ask: '최소 주문 금액(5,000원)보다 적어요',
  invalid_price_bid: '주문 가격이 호가 단위에 맞지 않아요', invalid_price_ask: '주문 가격이 호가 단위에 맞지 않아요', market_offline: '지금 이 코인은 거래가 멈춰 있어요', notfoundmarket: '업비트 원화 마켓에 없는 코인이에요',
  duplicated_identifier: '이미 같은 주문을 넣었어요', order_not_found: '주문을 찾지 못했어요'
};

export function token(access, secret, query = ''){
  const payload = { access_key: access, nonce: crypto.randomUUID() };
  if (query){ payload.query_hash = crypto.createHash('sha512').update(query, 'utf8').digest('hex'); payload.query_hash_alg = 'SHA512'; }
  const head = `${b64(JSON.stringify({ alg: 'HS512', typ: 'JWT' }))}.${b64(JSON.stringify(payload))}`;
  return `${head}.${crypto.createHmac('sha512', secret).update(head).digest('base64url')}`;
}
export const queryOf = params => Object.entries(params || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${v}`).join('&');

/* base는 테스트용 — 이 컴퓨터(127.0.0.1)의 주소만 받는다. 서명한 요청이 다른 서버로 가지 않게 */
export function client({ access = '', secret = '', base = API, fetchFn = globalThis.fetch } = {}){
  if (base !== API && !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new UpbitError('업비트가 아닌 주소로는 보내지 않아요');
  const hasKeys = !!(access && secret);

  async function call(method, path, params, { auth = false } = {}){
    if (auth && !hasKeys) throw new UpbitError('업비트 계정 정보(Access key·Secret key)를 설정에 넣어 주세요', { name: 'no_keys' });
    const query = queryOf(params), isPost = method === 'POST';
    const url = `${base}${path}${!isPost && query ? `?${query}` : ''}`;
    for (let attempt = 0; ; attempt++){
      const headers = { Accept: 'application/json' };
      if (auth) headers.Authorization = `Bearer ${token(access, secret, query)}`;
      if (isPost) headers['Content-Type'] = 'application/json; charset=utf-8';
      let res;
      try { res = await fetchFn(url, { method, headers, body: isPost ? JSON.stringify(params) : undefined, signal: AbortSignal.timeout(15000) }); }
      catch (e) {
        // 읽기만 하는 요청은 한 번 더. 주문(POST)은 들어갔는지 알 수 없으니 다시 보내지 않는다 — 부른 쪽이 identifier로 확인한다
        if (!isPost && attempt < 2){ await sleep(500 * (attempt + 1)); continue; }
        throw new UpbitError('업비트에 닿지 않아요. 네트워크를 확인해 주세요', { name: 'network', unsure: isPost });
      }
      if (res.status === 429 && attempt < 5){ await sleep(1000); continue; }   // 요청 수 제한 — 다음 초에 다시
      const body = await res.json().catch(() => null);
      if (res.ok) return body;
      const name = String(body?.error?.name ?? ''), msg = WORDS[name] || body?.error?.message || `업비트 HTTP ${res.status}`;
      if (res.status >= 500 && !isPost && attempt < 2){ await sleep(700); continue; }
      throw new UpbitError(msg, { name, status: res.status, unsure: isPost && res.status >= 500 });
    }
  }

  return {
    hasKeys,
    /* ---------- 시세 ---------- */
    ticker: markets => call('GET', '/v1/ticker', { markets: markets.join(',') }),
    orderbook: markets => call('GET', '/v1/orderbook', { markets: markets.join(',') }),
    instruments: markets => call('GET', '/v1/orderbook/instruments', { markets: markets.join(',') }),   // 호가 단위(tick_size)
    markets: () => call('GET', '/v1/market/all', { isDetails: 'false' }),
    /* 닫힌 봉만, 오래된 것부터. since(초)보다 뒤의 봉을 want개까지 — 200개씩 과거로 거슬러 받는다. 거래가 없던 봉은 업비트가 내려주지 않는다 */
    async candles(market, interval, { want = 200, since = 0, now = Date.now() } = {}){
      if (!PATH[interval]) throw new UpbitError(`지원하지 않는 봉 단위: ${interval}`);
      const byT = new Map(), nowSec = Math.floor(now / 1000);
      let to = null;
      for (let page = 0; page < 12; page++){
        const rows = await call('GET', `/v1/candles/${PATH[interval]}`, { market, count: 200, ...(to != null ? { to: `${new Date(to * 1000).toISOString().slice(0, 19)}Z` } : {}) });
        if (!Array.isArray(rows) || !rows.length) break;
        for (const c of rows) byT.set(Date.parse(`${c.candle_date_time_utc}Z`) / 1000, { t: Date.parse(`${c.candle_date_time_utc}Z`) / 1000, o: c.opening_price, h: c.high_price, l: c.low_price, c: c.trade_price, v: c.candle_acc_trade_volume ?? 0 });
        const oldest = Math.min(...rows.map(c => Date.parse(`${c.candle_date_time_utc}Z`) / 1000));
        if (rows.length < 200 || oldest <= since || byT.size >= want + 1) break;
        to = oldest;
        await sleep(120);   // 시세 조회 한도(초당 10회) 아래로
      }
      return [...byT.values()].filter(b => b.t > since && b.t + STEP[interval] <= nowSec).sort((a, b) => a.t - b.t);   // 아직 닫히지 않은 마지막 봉은 뺀다
    },
    /* ---------- 거래(JWT) ---------- */
    accounts: () => call('GET', '/v1/accounts', null, { auth: true }),
    chance: market => call('GET', '/v1/orders/chance', { market }, { auth: true }),
    order: body => call('POST', '/v1/orders', body, { auth: true }),
    orderTest: body => call('POST', '/v1/orders/test', body, { auth: true }),   // 실제 주문은 만들지 않고 검사만
    getOrder: by => call('GET', '/v1/order', by, { auth: true }),               // { uuid } 또는 { identifier }
    cancel: uuid => call('DELETE', '/v1/order', { uuid }, { auth: true })
  };
}
export const STEP_SEC = STEP;
