// 지금 하는 중인 일 — 스스로 업데이트(selfupdate.js)가 이 사이에 서버를 다시 켜지 않게. 실행기 한 바퀴, AI 서버로 보내는 요청
let n = 0;
export const track = p => { n++; return Promise.resolve(p).finally(() => { n--; }); };
export const busy = () => n > 0;
