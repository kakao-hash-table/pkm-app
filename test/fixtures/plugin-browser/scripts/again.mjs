// 단계 되돌리기(again) 시험 — check가 모자란 내용을 받은 뒤 앞 단계(고르기)에 답 'ok'를 준 것처럼 되돌린다
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || `--${k}=`).slice(k.length + 3);
const mode = process.argv[2], id = arg('id'), answer = arg('answer'), picked = arg('picked');
if (mode === 'pick') console.log(JSON.stringify({ summary: `고른 것: ${answer || 'first'}`, picked: answer || 'first' }));
else if (id === 'no-web') console.log(JSON.stringify({ summary: '없는 단계로', again: { step: '확인', value: 'x' } }));   // 앞 단계가 아니다
else if (id.startsWith('위비티')) console.log(JSON.stringify({ summary: '또 되돌리기', again: { step: '고르기', value: 'loop' } }));   // 끝없이 되돌린다
else if (picked === 'ok') console.log(JSON.stringify({ summary: '다 됐어요' }));
else if (!answer) console.log(JSON.stringify({ summary: '모자란 내용이 있어요', ask: { question: '모자란 내용을 적어 주세요', free: true } }));
else console.log(JSON.stringify({ summary: '내용을 받아 다시 내요', again: { step: '고르기', value: 'ok' } }));
