// 실행기 자동화 기능 — 플러그인마다 이 컴퓨터에서 켜고 끈다(~/.pkm-app/runner.json profiles.<p>.plugins.<id>.features).
// 모두 기본으로 켜져 있고, 끄면 예전처럼 동작한다. 화면은 [준비와 설정 › 자동화 기능]에 체크박스로 보인다.
export const FEATURES = [
  { key: 'auto_retry', label: '잠깐 실패하면 알아서 다시 하기',
    hint: 'AI 서버 연결 끊김·시간 초과·네트워크 오류는 1분·5분·15분 뒤 세 번까지 다시 해요. 제출처럼 되돌릴 수 없는 스크립트 단계는 스크립트가 다시 해도 된다고 할 때만 해요',
    default: true },
  { key: 'remember_answers', label: '한 번 알려 준 내 정보는 다시 묻지 않기',
    hint: '브라우저에서 AI가 물어 적어 준 값(예: 생년월일)을 이 컴퓨터에만 기억해 두고, 다음에 같은 것을 물으면 묻지 않고 넣어요. 기억한 값은 플러그인 관리에서 보고 지울 수 있어요',
    default: true },
  { key: 'close_gone', label: '끝난 일의 대기는 알아서 닫기',
    hint: '목록에서 빠진 지(PR이 닫힘·지난 회차·마감 지남) 하루가 지난 대기 작업을 닫아 내 차례에서 치워요. 닫은 작업도 [다시 하기]로 살릴 수 있어요',
    default: true },
  { key: 'share_settings', label: '다른 플러그인에 넣은 같은 설정은 다시 넣지 않기',
    hint: 'Jira 주소·GitHub API 주소·Jira 이메일처럼 다른 플러그인에 이미 넣은 값은 비어 있으면 가져와 써요. 직접 넣은 값은 그대로 둬요',
    default: true },
  { key: 'ai_review', label: 'AI가 낸 답을 다른 AI가 한 번 더 검토하기',
    hint: 'AI 단계의 답을 작업 과정을 모르는 AI가 요청과 결과만 보고 채점해요(형식·지어낸 내용·빠진 항목·모순). 짚은 점이 있으면 한 번 다시 만들어요. AI 사용량이 늘어요',
    default: true },
  { key: 'auto_update', label: 'pkm에 들어 있는 플러그인은 알아서 업데이트하기',
    hint: '새 버전이 오면 이 컴퓨터가 30분 안에 업데이트하고, 전에 승인했으면 다시 승인해요. 설치본을 손으로 고쳤거나 권한(AI·브라우저·토큰)이 늘면 지금처럼 직접 살펴보고 업데이트해요',
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
