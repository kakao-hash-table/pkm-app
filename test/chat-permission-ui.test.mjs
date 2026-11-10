import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const start=source.indexOf('function chAsk('),end=source.indexOf('function chHandoffHTML(',start);
assert.ok(start>=0&&end>start);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const ctx=vm.createContext({esc});vm.runInContext(source.slice(start,end),ctx);

test('GPT 권한 요청은 명령과 허락·거절 버튼으로 표시한다',()=>{
 const html=ctx.chAsk('room',{id:'gpt-one',tool:'GPT 명령 실행',title:'명령 실행 승인',input:{command:'echo <test>'}});
 assert.match(html,/명령 실행 승인/);assert.match(html,/echo &lt;test&gt;/);
 assert.match(html,/data-ch="allow"/);assert.match(html,/data-ch="deny"/);assert.match(html,/data-room="room"/);
});
test('GPT 질문은 선택지·직접 입력·비밀 입력을 표시한다',()=>{
 const html=ctx.chAsk('room',{id:'gpt-two',tool:'AskUserQuestion',input:{questions:[{id:'a',question:'골라 주세요',options:[{label:'허락'}],isOther:true},{id:'b',question:'입력',isSecret:true}]}});
 assert.match(html,/value="허락"/);assert.match(html,/name="q0-other"/);assert.match(html,/name="q1-other" type="password"/);
});
test('GPT 도구 폼은 자료형에 맞는 입력과 사용자용 처리 링크를 표시한다',()=>{
 const html=ctx.chAsk('room',{id:'gpt-three',tool:'CodexForm',title:'도구 승인',input:{url:'https://example.com/consent',fields:[{key:'n',label:'개수',type:'integer',required:true},{key:'yes',label:'동의',type:'boolean'},{key:'choice',label:'선택',type:'string',options:['a','b']}]}});
 assert.match(html,/data-ch-form="codex-form"/);assert.match(html,/type="number"/);assert.match(html,/value="false">아니요/);
 assert.match(html,/요청 화면 열기/);assert.match(html,/rel="noopener noreferrer"/);assert.match(html,/허락하기/);
 const unsupported=ctx.chAsk('room',{id:'gpt-four',tool:'CodexForm',input:{unsupported:true,fields:[]}});
 assert.doesNotMatch(unsupported,/type="submit"/);assert.match(unsupported,/거절하기/);
});
