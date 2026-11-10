import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const projectCode = source.slice(source.indexOf('const PLP ='), source.indexOf('function plInlineFeed('));
const item = { id:'/code/web', title:'web', meta:[], vars:{ command:'pnpm dev', port:'8084', project:JSON.stringify({commands:[{command:'pnpm dev',script:'next dev'},{command:'pnpm dev:mock',script:'next dev --mock'}]}), busy:JSON.stringify([{port:8084,pid:123,name:'next-server'}]), log:'hello <script>unsafe</script>' } };
function ui(){
  const saved = new Map(), requests = [], events = {};
  const x = {state:{feeds:{'프로젝트':{items:[item],ok:true}},runs:[]},feeds:[{name:'프로젝트',input_values:true}]};
  const ctx = vm.createContext({ S:{profile:'회사'},PL:{st:{plugins:{'dev-tools':x}},sent:{}},PLF:{},
    LS:{ get:(k,f)=>saved.get(k)??f, set:(k,v)=>saved.set(k,v) },
    esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    plIsRunner:()=>true,plRunner:()=>'',plUrl:s=>s,plFindText:it=>it.title,plFindHit:()=>true,plFeedError:()=>'',section:(h,b)=>h+b,
    document:{addEventListener:(n,fn)=>events[n]=fn},render(){},plLoad:async()=>{},
    papi:async(url,body)=>{requests.push({url,body});return {applied:true};} });
  vm.runInContext(projectCode, ctx);
  return {ctx,saved,requests,x};
}
test('명령·포트·점유자·포트 종료·로그가 카드에 함께 있고 로그 HTML은 실행되지 않는다',()=>{
  const {ctx,x}=ui(); const html=ctx.plProjectFeed('dev-tools',x,x.feeds[0]);
  assert.match(html,/name="command"/); assert.match(html,/name="port"/);assert.match(html,/PID 123/);assert.match(html,/포트 종료/);assert.match(html,/실행 로그/);assert.match(html,/&lt;script>unsafe/);assert.doesNotMatch(html,/<script>unsafe/);
});
test('고른 명령과 포트는 다시 렌더링해도 남고 실행 요청의 values로 전달된다',async()=>{
  const {ctx,saved,requests}=ui(); const key=vm.runInContext("plProjectKey('dev-tools', '/code/web')", ctx);
  saved.set(key,{command:'pnpm dev:mock',port:'8093'});
  const choice=ctx.plProjectChoice('dev-tools',item);assert.equal(choice.command,'pnpm dev:mock');assert.equal(choice.port,'8093');
  const html=ctx.plProjectFeed('dev-tools',ctx.PL.st.plugins['dev-tools'],{name:'프로젝트',input_values:true});assert.match(html,/value="8093"/);
  await ctx.plProjectSend('dev-tools','프로젝트',item.id,'띄우기',{command:choice.command,port:choice.port});
  assert.equal(requests[0].body.values.port,'8093');assert.equal(requests[0].body.values.command,'pnpm dev:mock');assert.equal(requests[0].body.workflow,'띄우기');
});
test('실행 API 오류가 카드에 남고 다음 실행으로 복구할 수 있다',async()=>{
  const {ctx,x}=ui();ctx.papi=async()=>{throw Error('EADDRINUSE · 8084번 사용 중');};
  await ctx.plProjectSend('dev-tools','프로젝트',item.id,'띄우기',{port:'8084'});
  assert.match(ctx.plProjectFeed('dev-tools',x,x.feeds[0]),/EADDRINUSE/);
  ctx.papi=async()=>({applied:true});await ctx.plProjectSend('dev-tools','프로젝트',item.id,'띄우기',{port:'8093'});
  assert.doesNotMatch(ctx.plProjectFeed('dev-tools',x,x.feeds[0]),/EADDRINUSE/);
});

test('실행기를 다시 불러오기 전에는 포트 입력 적용을 막고 재시작을 안내한다',()=>{
  const {ctx,x}=ui();const html=ctx.plProjectFeed('dev-tools',x,{name:'프로젝트'});
  assert.match(html,/PKM 앱을 다시 켜 주세요/);assert.match(html,/name="port"[^>]*disabled/);
});

const projectItem = (name, running) => ({ ...item, id:`/code/${name}`, title:name, vars:{ ...item.vars, project:JSON.stringify({ ...JSON.parse(item.vars.project), running }) } });
const cardOrder = html => [...html.matchAll(/data-project="([^"]+)"/g)].map(m => m[1]);

test('방문 시 실행 중인 카드가 먼저 나오고, 실행 상태 색을 구분한다',()=>{
  const {ctx,x}=ui();
  const items=[projectItem('a',false),projectItem('b',true),projectItem('c',false),projectItem('d',true)];
  x.state.feeds['프로젝트'].items=items;
  ctx.plProjectVisit('#/plugins/dev-tools');
  const html=ctx.plProjectFeed('dev-tools',x,x.feeds[0]);
  assert.deepEqual(cardOrder(html),['/code/b','/code/d','/code/a','/code/c']);
  assert.match(html,/class="pl-project pl-project-running" data-project="\/code\/b"/);
  assert.match(html,/class="pl-project" data-project="\/code\/a"/);
  assert.deepEqual(items.map(it=>it.title),['a','b','c','d'],'서버 목록 자체의 순서는 바꾸지 않는다');
});

test('켜거나 끄고 다시 그려도 위치 유지, 다른 페이지를 다녀온 뒤에만 다시 정렬한다',()=>{
  const {ctx,x}=ui(), feed=x.feeds[0];
  x.state.feeds['프로젝트'].items=[projectItem('a',false),projectItem('b',true),projectItem('c',false)];
  ctx.plProjectVisit('#/plugins/dev-tools');
  assert.deepEqual(cardOrder(ctx.plProjectFeed('dev-tools',x,feed)),['/code/b','/code/a','/code/c']);
  x.state.feeds['프로젝트'].items=[projectItem('a',false),projectItem('b',false),projectItem('c',true)];
  ctx.plProjectVisit('#/plugins/dev-tools');
  const updated=ctx.plProjectFeed('dev-tools',x,feed);
  assert.deepEqual(cardOrder(updated),['/code/b','/code/a','/code/c']);
  assert.match(updated,/class="pl-project pl-project-running" data-project="\/code\/c"/);
  assert.match(updated,/class="pl-project" data-project="\/code\/b"/);
  ctx.plProjectVisit('#/now');
  ctx.plProjectVisit('#/plugins/dev-tools');
  assert.deepEqual(cardOrder(ctx.plProjectFeed('dev-tools',x,feed)),['/code/c','/code/a','/code/b']);
});

test('목록 갱신과 검색 렌더링에도 기존 카드 순서를 유지하고 새 항목은 뒤에 붙인다',()=>{
  const {ctx,x}=ui(),feed=x.feeds[0];
  x.state.feeds['프로젝트'].items=[projectItem('a',false),projectItem('b',true)];
  ctx.plProjectVisit('#/plugins/dev-tools');ctx.plProjectFeed('dev-tools',x,feed);
  x.state.feeds['프로젝트'].items=[projectItem('new',true),projectItem('a',true),projectItem('b',false)];
  assert.deepEqual(cardOrder(ctx.plProjectFeed('dev-tools',x,feed)),['/code/b','/code/a','/code/new']);
  x.state.feeds['프로젝트'].items=[projectItem('a',true),projectItem('new',true)];
  assert.deepEqual(cardOrder(ctx.plProjectFeed('dev-tools',x,feed)),['/code/a','/code/new']);
});
