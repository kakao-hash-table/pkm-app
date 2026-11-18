// 기억해 둔 내 정보 — 브라우저 단계에서 AI가 물어 사람이 적어 준 값(값 묻기)을 프로필마다 이 컴퓨터에만 둔다.
// 다음에 어느 플러그인이든 같은 이름을 물으면 사람에게 묻지 않고 이 값을 넣는다(자동화 기능 remember_answers).
// 파일: ~/.pkm-app/memory.json (0600) — 노트 데이터(동기화·git)에는 넣지 않는다. 값은 화면에 가려서 보이고, 지울 수 있다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = process.env.PKM_HOME ? path.resolve(process.env.PKM_HOME) : path.join(os.homedir(), '.pkm-app');
const FILE = path.join(HOME, 'memory.json');
const MAX = 200;

// 이름 맞추기 — 띄어쓰기·기호·대소문자는 보지 않는다("휴대폰 번호" = "휴대폰번호")
export const norm = name => String(name || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 60);

function read(){ try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { profiles: {} }; } }
function write(m){
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 1) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

export function remember(p, name, value, from){
  const k = norm(name), v = String(value ?? '').trim().slice(0, 4000);
  if (!k || !v) return;
  const m = read(), box = (m.profiles[p] ||= {});
  box[k] = { name: String(name).slice(0, 60), value: v, at: new Date().toISOString(), from: from || null, used: box[k] ? box[k].used || 0 : 0 };
  const keys = Object.keys(box).sort((a, b) => String(box[b].at).localeCompare(String(box[a].at)));
  for (const old of keys.slice(MAX)) delete box[old];
  write(m);
}
export function recall(p, name){
  const k = norm(name), m = read(), it = k && m.profiles[p] && m.profiles[p][k];
  if (!it) return null;
  it.used = (it.used || 0) + 1; it.last_used = new Date().toISOString(); write(m);
  return it;
}
// 화면용 — 값은 앞 한 글자만 보이고 가린다
const mask = v => v.length <= 2 ? '•'.repeat(v.length) : v[0] + '•'.repeat(Math.min(8, v.length - 1));
export function list(p){
  const box = read().profiles[p] || {};
  return Object.entries(box).map(([key, it]) => ({ key, name: it.name, masked: mask(it.value), at: it.at, from: it.from, used: it.used || 0 }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
export function forget(p, key){
  const m = read();
  if (!m.profiles[p]) return false;
  if (key == null){ delete m.profiles[p]; write(m); return true; }
  if (!(key in m.profiles[p])) return false;
  delete m.profiles[p][key]; write(m); return true;
}
