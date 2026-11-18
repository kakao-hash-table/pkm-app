// 처음엔 "보내기 전에 끊김"(retry: true)으로, 다시 부르면 저장했다고 한다. 몇 번째인지는 SAVE_COUNT 파일로 센다
import fs from 'node:fs';
const f = process.env.SAVE_COUNT, n = Number(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : 0) + 1;
fs.writeFileSync(f, String(n));
console.log(JSON.stringify(n < 2 ? { error: '네트워크가 끊겨 보내지 못했어요', retry: true } : { summary: `저장했어요(${n}번째)` }));
