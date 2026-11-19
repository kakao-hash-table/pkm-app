// 스스로 업데이트 — 데스크톱 앱 빌드와 상관없이 새 버전이 사람 손 없이 들어오게.
// 서버를 감독 프로세스가 한 겹 감싸고(supervise), 서버가 새 커밋을 받으면 RESTART 코드로 끝나 감독이 바로 다시 켠다.
// 받는 것은 업스트림보다 뒤처졌고 올리지 않은 커밋이 없을 때 빨리 감기(ff)로만. 고친 파일은 새 버전과 겹치지 않을 때만 잠깐 치워 두고 다시 얹는다.
// 새 버전이 켜지다 바로 죽으면 감독이 받기 전 커밋으로 되돌리고, 그 커밋은 다시 받지 않는다.
import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const RESTART = 75;
const run = promisify(execFile);
const EARLY_MS = 90000;   // 다시 켠 뒤 이 안에 죽으면 새 버전이 망가진 것으로 본다

// 감독으로 감쌀지 — 이미 감독 아래이거나, 끈다고 했거나, 디버거를 붙였으면(감독이 포트를 잡아 버린다) 감싸지 않는다
export const supervisable = () => !process.env.PKM_CHILD && process.env.PKM_SUPERVISE !== '0' && !process.execArgv.some(a => /^--inspect/.test(a));
// 켜지다 죽어 되돌린 버전 — 감독이 다시 켜져도, 다른 업데이트 경로도 알 수 있게 저장소 안에 적어 둔다
const badFile = root => { try { return path.resolve(root, execFileSync('git', ['-C', root, 'rev-parse', '--git-path', 'pkm-bad-commit']).toString().trim()); } catch { return ''; } };
export const badCommit = root => { const f = badFile(root); try { return f ? fs.readFileSync(f, 'utf8').trim() : ''; } catch { return ''; } };

export function supervise(entry, { root, log = console.log } = {}){
  let child = null, stopping = false, bad = '';
  const mark = path.join(os.tmpdir(), `pkm-update-${process.pid}.json`);
  const stop = sig => { stopping = true; if (child) child.kill(sig); else process.exit(0); };
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => stop(sig));   // SIGHUP은 두어 nohup이 그대로 듣게
  const once = () => new Promise(resolve => {
    child = spawn(process.execPath, [...process.execArgv, entry, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, PKM_CHILD: String(process.pid), PKM_UPDATE_MARK: mark, ...(bad ? { PKM_BAD_COMMIT: bad } : {}) } });
    child.on('exit', (code, signal) => { child = null; resolve(signal ? null : code); });
  });
  return (async () => {
    let updatedAt = 0;
    for (;;){
      const started = Date.now(), code = await once();
      if (stopping) process.exit(0);
      if (code === RESTART){ updatedAt = Date.now(); log('새 버전으로 다시 켭니다'); continue; }
      const m = code != null && updatedAt && started - updatedAt < 5000 && Date.now() - started < EARLY_MS && (() => { try { return JSON.parse(fs.readFileSync(mark, 'utf8')); } catch { return null; } })();
      if (m && m.from && root){
        try {
          execFileSync('git', ['-C', root, 'reset', '--keep', m.from], { stdio: 'ignore', env: { ...process.env, GIT_AUTOPUSH: '0' } });
          bad = m.to; updatedAt = 0; fs.rmSync(mark, { force: true });
          try { const f = badFile(root); if (f) fs.writeFileSync(f, m.to); } catch {}
          log(`새 버전(${String(m.to).slice(0, 7)})이 켜지다 끝나서 전 버전(${String(m.from).slice(0, 7)})으로 되돌렸어요. 이 버전은 다시 받지 않아요`);
          continue;
        } catch (e) { log(`전 버전으로 되돌리지 못했어요: ${e.message}`); }
      }
      process.exit(code ?? 1);
    }
  })();
}

// 감독이 죽으면(강제 종료) 같이 끝난다 — 포트를 쥔 채 남지 않게
export function watchParent(){
  const parent = Number(process.env.PKM_CHILD);
  if (!parent) return;
  setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 3000).unref();
  process.on('SIGHUP', () => {});   // nohup으로 띄운 감독 아래에서 터미널을 닫아도 — 감독이 죽으면 위에서 같이 끝난다
}

const MS = Number(process.env.PKM_SELFUPDATE_MS || 30 * 60000);
const STASH_MSG = 'pkm 자동 업데이트';
// root: 앱 폴더 · enabled(): 켜져 있는지 · ready(): 지금 다시 켜도 되는지(하던 일이 없는지) · log
export function createSelfUpdate({ root, enabled, ready = () => true, log = console.log, exit = code => process.exit(code), git = (...a) => run('git', ['-C', root, ...a], { timeout: 60000, env: { ...process.env, GIT_AUTOPUSH: '0' } }) }){
  const S = { at: null, state: 'idle', error: null, pulled: 0, kept: 0, commit: null, stash: null };
  let boot = ''; try { boot = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD']).toString().trim(); } catch {}   // 켜질 때의 코드 — 폴더에서 직접 받거나 커밋해 바뀌었으면 다시 켠다
  let critical = false; const after = [];   // 치워 두기~다시 얹기 사이에 끄려는 쪽은 whenIdle로 기다린다
  const out = async (...a) => String((await git(...a)).stdout).trim();
  const has = async name => fs.existsSync(path.resolve(root, await out('rev-parse', '--git-path', name)));
  async function once(){
    if (!enabled()) return (S.state = 'off');
    if (S.state === 'restart' || S.stash) return S.state;   // 받아 두고 다시 켜기를 기다리는 중이거나, 고친 파일을 다시 얹지 못해 사람이 볼 차례
    try {
      S.commit ||= await out('rev-parse', '--short', 'HEAD');
      const up = await out('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').catch(() => '');
      if (!up) return (S.state = 'no-upstream');
      await git('fetch', '--quiet');
      const [ahead, behind] = (await out('rev-list', '--left-right', '--count', 'HEAD...@{u}')).split(/\s+/).map(Number);
      S.at = new Date().toISOString(); S.error = null;
      if (!behind){
        const head = await out('rev-parse', 'HEAD');
        if (!boot || head === boot || !process.env.PKM_CHILD) return (S.state = 'latest');
        if (!ready()) return (S.state = 'busy');
        log('폴더의 코드가 켜질 때와 달라져 다시 켭니다');
        if (process.env.PKM_UPDATE_MARK) try { fs.writeFileSync(process.env.PKM_UPDATE_MARK, JSON.stringify({ from: boot, to: head })); } catch {}
        S.state = 'pulled'; exit(RESTART); return S.state;
      }
      if (ahead) return (S.state = 'ahead');
      const to = await out('rev-parse', '@{u}');
      if (to === process.env.PKM_BAD_COMMIT || to === badCommit(root)) return (S.state = 'bad');   // 켜지다 죽어 되돌린 버전 — 다음 커밋을 기다린다
      for (const n of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) if (await has(n)) return (S.state = 'merging');   // 사람이 합치는 중
      const mine = (await out('diff', '--name-only', 'HEAD')).split('\n').filter(Boolean);
      if (mine.length){
        const theirs = new Set((await out('diff', '--name-only', 'HEAD', '@{u}')).split('\n').filter(Boolean));
        if (mine.some(f => theirs.has(f))) return (S.state = 'dirty');
      }
      if (!ready()) return (S.state = 'busy');   // 하던 일이 있으면 조금 뒤에
      const from = await out('rev-parse', 'HEAD');
      // 치워 두기부터 다시 얹기까지는 끊기지 않게 — 그 사이 끄라는 신호가 오면 끝낸 뒤에 끈다
      let sig = null; const hold = s => { sig = s; };
      process.on('SIGTERM', hold); process.on('SIGINT', hold); critical = true;
      try {
        let sha = '';
        const stashes = async () => (await out('stash', 'list', '--format=%H %s')).split('\n').filter(Boolean).map(l => ({ sha: l.slice(0, 40), msg: l.slice(41) }));
        const restore = async () => {   // 치워 둔 것을 sha로 다시 얹고 그 항목만 지운다. 못 얹으면 보관함에 둔 채 멈춰 보인다
          try {
            await git('stash', 'apply', '--quiet', sha);
            const i = (await stashes()).findIndex(x => x.sha === sha);
            if (i >= 0) await git('stash', 'drop', '--quiet', `stash@{${i}}`);
            return true;
          } catch {
            S.stash = sha; S.error = `고친 파일을 다시 얹지 못했어요 — git 보관함에 "${STASH_MSG}"로 있어요(git stash list)`;
            log(S.error); S.state = 'stashed'; return false;
          }
        };
        if (mine.length){
          const before = new Set((await stashes()).map(x => x.sha));
          await git('stash', 'push', '--quiet', '-m', STASH_MSG);
          sha = ((await stashes()).find(x => !before.has(x.sha) && x.msg.includes(STASH_MSG)) || {}).sha || '';   // 남의 것이 위에 쌓여도 내 항목을 찾는다
          if (!sha) return (S.state = 'busy');   // 그 사이 고친 것이 사라졌다
        }
        try { await git('merge', '--ff-only', '--quiet', '@{u}'); }
        catch (e) { if (sha) await restore(); throw e; }
        if (sha && !(await restore())) return S.state;
        Object.assign(S, { pulled: behind, kept: mine.length, state: 'pulled' });
        log(`pkm 앱 새 버전을 받았어요 (커밋 ${behind}개)${mine.length ? ` · 고친 파일 ${mine.length}개는 다시 얹었어요` : ''}`);
        if (process.env.PKM_CHILD){
          if (process.env.PKM_UPDATE_MARK) try { fs.writeFileSync(process.env.PKM_UPDATE_MARK, JSON.stringify({ from, to })); } catch {}
          exit(RESTART); return S.state;
        }
        S.state = 'restart';   // 감독 없이 켰으면 다시 켜야 반영된다
      } finally {
        process.off('SIGTERM', hold); process.off('SIGINT', hold); critical = false;
        for (const f of after.splice(0)) f();
        if (sig) process.exit(0);
      }
    } catch (e) {
      S.state = 'error'; S.error = String(e.stderr || e.message || e).trim().split('\n').pop().slice(0, 300);
    }
    return S.state;
  }
  let busy = null, timer = null, loop = null;
  const arm = ms => { if (!loop) return; clearTimeout(timer); timer = setTimeout(loop, ms); timer.unref?.(); };
  // 겹쳐 부르면 도는 것을 같이 기다린다. 어디서 불렀든 하던 일 때문에 미뤘으면 2분 뒤 다시 본다
  const check = () => (busy ||= once().finally(() => { busy = null; if (S.state === 'busy') arm(2 * 60000); }));
  const start = () => {
    if (loop) return;
    loop = async () => { await check(); if (S.state !== 'busy') arm(MS); };
    arm(2 * 60000);
  };
  const whenIdle = f => { if (critical) after.push(f); else f(); };
  return { check, start, whenIdle, state: () => ({ ...S }) };
}
