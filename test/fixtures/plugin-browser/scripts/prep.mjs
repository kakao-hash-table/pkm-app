// 낼 것 준비 — 브라우저 단계에 넘길 옵션(_browser)을 낸다. 내 정보 값은 여기서만 나오고 AI 프롬프트에는 이름만 간다
const id = (process.argv.find(a => a.startsWith('--id=')) || '--id=').slice(5);
const vars = { 이름: '홍길동', 연락처: '010-9999-8888' };
if (id === 'no-web') console.log(JSON.stringify({ summary: '브라우저로 낼 곳이 없어요', browse: false }));
else console.log(JSON.stringify({ summary: '낼 준비를 마쳤어요', browse: true, url: 'https://apply.example.com/form', names: Object.keys(vars).map(k => `{{${k}}}`).join(' '),
  _browser: { vars, allow: ['apply.example.com', 'WWW.Example.com'], files: [{ name: '신청서.hwp', path: '/tmp/pkm-test-신청서.hwp' }], ...(id.startsWith('위비티') ? { tab: '위비티' } : {}) } }));
