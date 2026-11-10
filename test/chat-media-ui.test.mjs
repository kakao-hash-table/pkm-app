import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
function ui(){
  const store = new Map(), nodes = new Map(), sent = [], notices = [];
  const node = id => { if(!nodes.has(id)) nodes.set(id,{value:'',dataset:{},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}}); return nodes.get(id); };
  const ctx = vm.createContext({ Map,Set,URL, S:{profile:'회사'},CH:{room:'data',sending:false,rooms:{},view:'log'},LS:{get:(k,f)=>store.get(k)??f,set:(k,v)=>store.set(k,v)},$:node,esc:s=>String(s).replaceAll('<','&lt;').replaceAll('"','&quot;'),toast:t=>notices.push(t),chDraftSave(){},chSum:()=>({}),chLoad:async()=>{},chPaint(){},chDraftKey:()=>'',PKMAI:{prefs:()=>({provider:'codex'})},
    capi:async(url,body)=>{sent.push({url,body});return {id:body.id,status:'queued'};},fetch:async()=>({ok:true,json:async()=>({id:'abc123',kind:'image',name:'사진.png',frames:1})}) });
  vm.runInContext(source.slice(source.indexOf('const CH_MEDIA ='),source.indexOf('const CH_ICON =')),ctx);
  vm.runInContext(source.slice(source.indexOf('async function chSend(){'),source.indexOf('async function chAnswer(')),ctx);
  return {ctx,store,node,sent,notices};
}
test('파일 첨부·첨부만 보내기·방별 초안·실패 후 보존',async()=>{
  const {ctx,node,sent}=ui();
  await ctx.chAddMedia([{name:'사진.png',type:'image/png',size:100}]);
  assert.match(node('#chat-attachments').innerHTML,/사진.png/);
  ctx.CH.room='other';assert.equal(ctx.chMediaDraft().length,0);
  ctx.CH.room='data';assert.equal(ctx.chMediaDraft().length,1);
  ctx.capi=async()=>{throw new Error('연결 실패');};
  await ctx.chSend();assert.equal(ctx.chMediaDraft().length,1);assert.equal(ctx.CH.sending,false);
  ctx.capi=async(url,body)=>{sent.push({url,body});return {id:body.id};};
  await ctx.chSend();assert.deepEqual(Array.from(sent[0].body.attachments),['abc123']);assert.equal(sent[0].body.text,'');assert.equal(ctx.chMediaDraft().length,0);
});
test('붙여넣기는 사진·영상 파일을 첨부하고 일반 텍스트는 기본 동작을 유지한다',async()=>{
  const {ctx,node}=ui();let prevented=false;
  node('#chat-in').listeners.paste({clipboardData:{files:[]},preventDefault(){prevented=true;}});
  assert.equal(prevented,false);
  const files=[];ctx.chAddMedia=async f=>files.push(...f);
  node('#chat-in').listeners.paste({clipboardData:{files:[{name:'붙여넣기.mov'}],getData:()=>''},preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(files[0].name,'붙여넣기.mov');
});
test('업로드 중 전송을 막고 완료 후 다시 허용한다',async()=>{
  const {ctx,node,sent}=ui();let release;
  ctx.fetch=()=>new Promise(r=>release=r);
  ctx.CH.room='card-one';
  const upload=ctx.chAddMedia([{name:'사진.png',type:'image/png',size:100}]);
  assert.equal(node('#chat-go').disabled,true);await ctx.chSend();assert.equal(sent.length,0);
  release({ok:true,json:async()=>({id:'uploaded',name:'사진.png',kind:'image',frames:1})});await upload;
  assert.equal(node('#chat-go').disabled,false);
});
