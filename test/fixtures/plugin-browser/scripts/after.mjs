const raw = (process.argv.find(a => a.startsWith('--result=')) || '--result=').slice(9);
let r = {}; try { r = JSON.parse(raw); } catch {}
const given = (process.argv.find(a => a.startsWith('--given=')) || '--given=').slice(8);   // 사람이 알려 준 값 { 이름: 값 } — 기록에는 이름만
let g = {}; try { g = JSON.parse(given || '{}'); } catch {}
console.log(JSON.stringify({ summary: raw ? `sent=${r.sent} · ${r.proof}${Object.keys(g).length ? ` · given=${Object.keys(g).join(',')}` : ''}` : '브라우저로 내지 않았어요', fold_label: '자동으로 채운 것',
  findings: raw ? [{ where: '접수 결과', title: r.sent === 'yes' ? '접수 화면에 냈어요' : '확인이 필요해요', text: r.proof }, { where: '이름', title: '{{이름}}', fold: true }, { where: '연락처', title: '{{연락처}}', fold: true }, { where: '작품', title: '낸 글', copy: '수원새빛', fold: true }] : [],
  verdict: { tone: r.sent === 'yes' ? 'ok' : 'bad', title: r.sent === 'yes' ? '냈어요' : '내지 못했어요' } }));
