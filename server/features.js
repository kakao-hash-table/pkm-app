// 실행기 자동화 기능 — 플러그인마다 이 컴퓨터에서 켜고 끈다(~/.pkm-app/runner.json profiles.<p>.plugins.<id>.features).
// 모두 기본으로 켜져 있고, 끄면 예전처럼 동작한다. 화면은 [준비와 설정 › 자동화 기능]에 체크박스로 보인다.
export const FEATURES = [
  { key: 'auto_retry', label: '잠깐 실패하면 알아서 다시 하기',
    hint: 'AI 서버 연결 끊김·시간 초과·네트워크 오류는 1분·5분·15분 뒤 세 번까지 다시 해요. 제출처럼 되돌릴 수 없는 스크립트 단계는 스크립트가 다시 해도 된다고 할 때만 해요',
    default: true },
];
const BY = new Map(FEATURES.map(f => [f.key, f]));

export function featureOn(pc, key){
  const f = BY.get(key);
  if (!f) return false;
  const v = pc && pc.features && pc.features[key];
  return typeof v === 'boolean' ? v : f.default;
}
export const featureState = pc => Object.fromEntries(FEATURES.map(f => [f.key, featureOn(pc, f.key)]));

/* 일시적인 실패인가 — 같은 일을 조금 뒤에 다시 하면 될 가능성이 큰 것 */
const TRANSIENT = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network|timed? ?out|시간 초과|안에 끝나지 않았|닿지 않아|\b(429|500|502|503|504)\b|Too Many Requests|overloaded|Service Unavailable|Bad Gateway|일시적|잠시 후/i;
export const transient = msg => TRANSIENT.test(String(msg || ''));

export const RETRY_MIN = [1, 5, 15];   // 몇 분 뒤에 다시 할지 — 이만큼 하고도 안 되면 멈춘다
const UNIT = Number(process.env.PKM_RETRY_UNIT_MS || 60000);   // 시험에서는 짧게
// n번째 다시 하기까지 기다릴 ms — 여럿이 한꺼번에 몰리지 않게 ±20% 흔든다
export const retryDelay = n => Math.round(RETRY_MIN[n] * UNIT * (0.8 + Math.random() * 0.4));
