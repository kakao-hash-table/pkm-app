const ans = (process.argv.find(a => a.startsWith('--answer=')) || '').slice(9);
console.log(JSON.stringify(ans ? { picked: ans, summary: `${ans}로 골랐어요` } : { ask: { question: '어느 쪽?', choices: ['왼쪽', '오른쪽'] } }));
