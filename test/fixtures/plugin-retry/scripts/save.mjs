// 처음엔 "보내기 전에 끊김"(retry: true)으로, 다시 부르면 저장했다고 한다. 몇 번째인지는 SAVE_COUNT 파일로 센다
// SAVE_AGAIN이 있으면 첫 번에는 요약 AI로 되돌려(again) 고칠 점을 넘긴다
import fs from 'node:fs';
const f = process.env.SAVE_COUNT, n = Number(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : 0) + 1;
fs.writeFileSync(f, String(n));
if (process.env.SAVE_WAIT) console.log(JSON.stringify(n < 2 ? { summary: '나중에', wait_until: new Date(Date.now() + 300).toISOString(), wait_why: '밤에는 보내지 않아요' } : { summary: `저장했어요(${n}번째)` }));
else if (process.env.SAVE_AGAIN) console.log(JSON.stringify(n < 2 ? { summary: '너무 길어요', again: { step: '요약', value: '20자 이내로 줄여 주세요' } } : { summary: `저장했어요(${n}번째)` }));
else console.log(JSON.stringify(n < 2 ? { error: '네트워크가 끊겨 보내지 못했어요', retry: true } : { summary: `저장했어요(${n}번째)` }));
