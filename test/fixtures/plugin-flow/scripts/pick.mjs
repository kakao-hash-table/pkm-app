const ans = (process.argv.find(a => a.startsWith('--answer=')) || '').slice(9);
// 고른 쪽이 갈래(lane) — 다시 고르기(change)·다른 쪽으로 하나 더(fork)는 '*'로 다시 묻는다
console.log(JSON.stringify(ans && ans !== '*' ? { picked: ans, summary: `${ans}로 골랐어요`, lane: ans, change: { label: '다시 고르기', value: '*' }, fork: { label: '다른 쪽도', value: '*' } } : { ask: { question: '어느 쪽?', choices: ['왼쪽', '오른쪽'] } }));
