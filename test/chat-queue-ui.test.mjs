import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
function ui(){
  const sent=[], announcements=[], CH={st:{queue_controls:true},rooms:{},err:''};
  const ctx=vm.createContext({CH,esc:String,chPaint(){},chLoad:async()=>{},chSay:t=>announcements.push(t),LS:{set(){}},capi:async(url,body)=>{sent.push({url,body});return {status:'queued'};}});
  vm.runInContext(source.slice(source.indexOf('function chQueueActions('),source.indexOf('function chTurn(')),ctx);
  const start=source.indexOf('async function chQueueAction(');
  vm.runInContext(source.slice(start,source.indexOf("document.addEventListener('click'",start)),ctx);
  return {ctx,CH,sent,announcements};
}
test('대기 메시지마다 지금 반영·개별 취소를 보이고 진행 중·완료된 메시지에는 표시하지 않는다',()=>{
  const {ctx}=ui();
  const html=ctx.chQueueActions('data',{id:'two',status:'queued'});
  assert.match(html,/멈추고 지금 반영/);assert.match(html,/발송 취소/);assert.match(html,/다른 대기 메시지는 유지/);assert.match(html,/data-turn="two"/);
  assert.doesNotMatch(ctx.chQueueActions('data',{id:'one',status:'waiting',job:'job1'}),/data-ch="run-now"/);
  assert.match(ctx.chQueueActions('data',{id:'one',status:'waiting'}),/발송 취소/);
  for(const status of ['running','done','canceled','error'])assert.equal(ctx.chQueueActions('data',{id:'one',status}),'');
});
test('개별 취소는 전체 취소 API를 호출하지 않고 선택한 메시지 id만 보낸다',async()=>{
  const {ctx,CH,sent,announcements}=ui();
  await ctx.chQueueAction('card/one','chosen-turn','cancel-turn');
  assert.equal(sent[0].url,'/card%2Fone/cancel-turn');assert.deepEqual(JSON.parse(JSON.stringify(sent[0].body)),{turn_id:'chosen-turn'});
  assert.equal(CH.queueBusy,'');assert.match(announcements[0],/이 메시지/);
});
test('지금 반영은 중복 클릭을 막고 서버가 실패하면 대기 메시지를 지우지 않는다',async()=>{
  const {ctx,CH,sent}=ui();let release;
  CH.rooms.data={turns:[{id:'chosen',status:'queued',text:'기존 메시지'}]};
  ctx.capi=()=>new Promise(resolve=>release=resolve);
  const pending=ctx.chQueueAction('data','chosen','run-now');
  assert.match(ctx.chQueueActions('data',{id:'chosen',status:'queued'}),/disabled/);
  await ctx.chQueueAction('data','chosen','run-now');assert.equal(sent.length,0);
  release({status:'queued'});await pending;
  ctx.capi=async()=>{throw Error('기존 작업의 중단을 확인하지 못했어요');};
  await ctx.chQueueAction('data','chosen','run-now');
  assert.match(CH.err,/중단/);assert.equal(CH.queueBusy,'');assert.equal(CH.rooms.data.turns[0].text,'기존 메시지');
});
test('이전 실행기에는 재시작을 안내하고 전체 취소로 대체하지 않는다',()=>{
  const {ctx,CH}=ui();CH.st={};const html=ctx.chQueueActions('data',{id:'chosen',status:'queued'});
  assert.match(html,/PKM 앱을 다시 켠 뒤/);assert.doesNotMatch(html,/data-ch=/);
});

test('요약 보기에서도 대기 메시지별 옵션이 대화 이동 버튼 밖에 표시된다',()=>{
  const {ctx}=ui();ctx.CH_WORD={queued:'차례를 기다려요',canceled:'그만뒀어요'};
  vm.runInContext(source.slice(source.indexOf('const chLine ='),source.indexOf('function chView(')),ctx);
  const html=ctx.chSumsHtml({id:'data',turns:[{id:'selected',status:'queued',text:'대기 내용',created:new Date().toISOString(),pending:[]}]});
  assert.match(html,/<\/button><div class="ch-queue-actions"/);assert.match(html,/data-ch="cancel-turn"/);assert.match(html,/data-ch="run-now"/);
});
