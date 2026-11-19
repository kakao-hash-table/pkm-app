// pkm 앱 스스로 업데이트 — 데스크톱 앱 빌드와 상관없이 새 버전이 사람 손 없이 들어오게.
// 서버를 감독 프로세스가 한 겹 감싸고(supervise), 서버가 새 커밋을 받으면 RESTART 코드로 끝나 감독이 바로 다시 켠다.
// 받는 것은 깨끗한(고친 파일·올리지 않은 커밋 없음) 작업 폴더가 업스트림보다 뒤처졌을 때 빨리 감기(ff)로만.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const RESTART = 75;
const run = promisify(execFile);

export function supervise(entry){
  let child = null, stopping = false;
  const stop = sig => { stopping = true; if (child) child.kill(sig); else process.exit(0); };
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => stop(sig));
  const once = () => new Promise(resolve => {
    child = spawn(process.execPath, [...process.execArgv, entry, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, PKM_CHILD: String(process.pid) } });
    child.on('exit', (code, signal) => { child = null; resolve(signal ? null : code); });
  });
  return (async () => {
    for (;;){
      const code = await once();
      if (stopping || code !== RESTART) process.exit(stopping ? 0 : code ?? 1);
      console.log('pkm 앱을 새 버전으로 다시 켭니다');
    }
  })();
}

// 감독이 죽으면(강제 종료) 같이 끝난다 — 포트를 쥔 채 남지 않게
export function watchParent(){
  const parent = Number(process.env.PKM_CHILD);
  if (!parent) return;
  setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 3000).unref();
}

const MS = Number(process.env.PKM_SELFUPDATE_MS || 30 * 60000);
const IDLE_MS = 3 * 60000;
// root: 앱 폴더 · enabled(): 켜져 있는지 · idleSince(): 마지막으로 무언가를 바꾼 요청 시각 · log
export function createSelfUpdate({ root, enabled, idleSince, log = console.log, exit = code => process.exit(code), git = (...a) => run('git', ['-C', root, ...a], { timeout: 60000, env: { ...process.env, GIT_AUTOPUSH: '0' } }) }){
  const S = { at: null, state: 'idle', error: null, pulled: 0, kept: 0, commit: null };
  const out = async (...a) => String((await git(...a)).stdout).trim();
  async function check(){
    if (!enabled()) return (S.state = 'off');
    try {
      S.commit ||= await out('rev-parse', '--short', 'HEAD');
      const up = await out('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').catch(() => '');
      if (!up) return (S.state = 'no-upstream');
      await git('fetch', '--quiet');
      const [ahead, behind] = (await out('rev-list', '--left-right', '--count', 'HEAD...@{u}')).split(/\s+/).map(Number);
      S.at = new Date().toISOString(); S.error = null;
      if (!behind) return (S.state = 'latest');
      if (ahead) return (S.state = 'ahead');
      // 고친 파일이 있어도 새 버전이 건드리지 않는 파일뿐이면 잠깐 치워 두고 받은 뒤 다시 얹는다(겹치면 받지 않는다)
      const mine = (await out('diff', '--name-only', 'HEAD')).split('\n').filter(Boolean);
      if (mine.length){
        const theirs = new Set((await out('diff', '--name-only', 'HEAD', '@{u}')).split('\n').filter(Boolean));
        if (mine.some(f => theirs.has(f))) return (S.state = 'dirty');
      }
      if (Date.now() - idleSince() < IDLE_MS) return (S.state = 'busy');   // 방금 무언가를 저장했으면 조금 뒤에
      if (mine.length) await git('stash', 'push', '--quiet', '-m', 'pkm 자동 업데이트');
      try { await git('merge', '--ff-only', '--quiet', '@{u}'); }
      finally { if (mine.length) await git('stash', 'pop', '--quiet'); }
      S.kept = mine.length;
      S.pulled = behind; S.state = 'pulled';
      log(`pkm 앱 새 버전을 받았어요 (커밋 ${behind}개)${S.kept ? ` · 고친 파일 ${S.kept}개는 다시 얹었어요` : ''}`);
      if (process.env.PKM_CHILD){ exit(RESTART); return S.state; }
      S.state = 'restart';   // 감독 없이 켰으면 다시 켜야 반영된다
    } catch (e) {
      S.state = 'error'; S.error = String(e.stderr || e.message || e).trim().split('\n').pop().slice(0, 300);
    }
    return S.state;
  }
  let timer = null;
  const start = () => {
    if (timer) return;
    const loop = async () => { await check(); timer = setTimeout(loop, S.state === 'busy' ? 2 * 60000 : MS); timer.unref?.(); };
    timer = setTimeout(loop, 2 * 60000); timer.unref?.();
  };
  return { check, start, state: () => ({ ...S }) };
}
