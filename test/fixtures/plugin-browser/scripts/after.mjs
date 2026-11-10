const raw = (process.argv.find(a => a.startsWith('--result=')) || '--result=').slice(9);
let r = {}; try { r = JSON.parse(raw); } catch {}
console.log(JSON.stringify({ summary: raw ? `sent=${r.sent} · ${r.proof}` : '브라우저로 내지 않았어요', verdict: { tone: r.sent === 'yes' ? 'ok' : 'bad', title: r.sent === 'yes' ? '냈어요' : '내지 못했어요' } }));
