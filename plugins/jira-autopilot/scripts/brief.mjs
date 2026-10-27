#!/usr/bin/env node
// 무엇을 만들지 — 지라 설명이 비어 있으면 지라를 바꾸기 전에 사람에게 묻는다.
//   node brief.mjs --key=ABC-12 --description="…" [--answer="버튼 색만 바꿔 줘"]
const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), ''] : [a.slice(2, i), a.slice(i + 1)]; }));
const done = obj => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(0); };
if (String(opt.answer || '').trim()) done({ note: String(opt.answer).trim(), summary: '내가 적은 요구사항으로 해요' });
if (String(opt.description || '').trim()) done({ note: '', summary: '지라 설명이 있어요' });
done({ ask: { question: '무엇을 만들까요?', hint: `${opt.key} 지라 설명이 비어 있어요. 적어 주면 그 내용으로 시작해요`, free: true, placeholder: '예: 로그인 버튼 문구를 시작하기로 바꿔 줘' } });
