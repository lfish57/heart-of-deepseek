import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import YAML from 'js-yaml';
const root=fileURLToPath(new URL('../',import.meta.url));
const data=mkdtempSync(path.join(tmpdir(),'heart-smoke-'));
const port=Number(process.env.HEART_SMOKE_PORT||3578),origin='http://127.0.0.1:'+port;
const local=async(p,payload)=>fetch(origin+p,payload===undefined?{}:{
 method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(payload),
});
const rows=async()=>await (await local('/api/roles')).json();
let child;
function launch(){child=spawn(process.execPath,['server.mjs'],{cwd:root,stdio:'ignore',env:{...process.env,
 HEART_DATA_DIR:data,HEART_PORT:String(port),HEART_API_KEY:''}});}
async function ready(){
 for(let i=0;i<30;i++){
  if(child.exitCode!==null)throw Error('Local server exited during startup');
  try{const s=await (await local('/api/settings')).json();if(s.model==='deepseek-flash')return s;}catch{}
  await sleep(150);
 }
 throw Error('Local startup timed out');
}
async function stop(){
 if(child&&child.exitCode===null&&child.signalCode===null){
  const closed=new Promise(resolve=>child.once('exit',resolve));
  child.kill();await closed;
 }
}
try{
 launch();
 assert.equal((await ready()).ready,false);
 assert.match(await (await local('/')).text(),/<title>鲸之心 · 本地聊天<\/title>/);
 const initialRoles=await rows();
 assert.equal(initialRoles.length,1);
 assert.equal(initialRoles[0].name,'小鱼');
 assert.match(initialRoles[0].avatar,/^avatars\/[a-f0-9]{32}\.jpg$/);
 const portrait=await local('/'+initialRoles[0].avatar);
 assert.equal(portrait.headers.get('content-type'),'image/jpeg');
 assert.deepEqual(Buffer.from(await portrait.arrayBuffer()),readFileSync(path.join(root,'public/assets/xiaoyu-avatar.jpg')));
 assert.equal((await local('/default.svg')).headers.get('content-type'),'image/svg+xml');
 assert.deepEqual(await (await local('/api/role/'+initialRoles[0].id+'/history')).json(),{turns:[]});
 const blank=YAML.load(await (await local('/api/template')).text());
 for(const [id,description] of [['paper-cat','旧纸再利用的筹备搭档'],['rain-gull','雨天散步的邻居']]){
  const role=structuredClone(blank);
  Object.assign(role,{id,name:'重名测试'});
  role.identity.self_description=description;
  role.relationship.start='初识';
  role.memory_boundary={start:'空经历',attribution:'仅使用带来源的发言',correction:'最新更正优先'};
  const result=await local('/api/roles',{yaml:YAML.dump(role)});
  assert.equal(result.status,200,await result.text());
 }
 assert.equal((await rows()).filter(r=>r.name==='重名测试').length,2);
 assert.equal((await local('/api/role/paper-cat/memory',{topic:'展会地点',fact:'宁波'})).status,200);
 assert.equal((await local('/api/role/paper-cat/memory',{topic:'展会地点',fact:'绍兴'})).status,200);
 const chat=async text=>{
  const response=await local('/api/role/paper-cat/chat',{text,requestId:randomUUID()});
  return {status:response.status,value:await response.json()};
 };
 const tentative=await chat('周三晚上八点和我接着聊小说，可以吗？');
 assert.equal(tentative.status,400);
 assert.match(tentative.value.error,/API Key/);
 const natural='周三晚上八点我们接着聊小说，记一下哦。';
 assert.match((await chat(natural)).value.answer,/记下了/);
 assert.match((await chat('聊小说改到周日下午吧。')).value.answer,/周日下午/);
 const versions=await (await local('/api/role/paper-cat/memory-revisions?topic='+encodeURIComponent('聊小说'))).json();
 assert.equal(versions.items[0].due,'周日下午');
 assert.equal(versions.items[1].original.input,natural);
 const denied=await fetch(origin+'/api/settings',{method:'POST',headers:{origin:'https://other.invalid','content-type':'application/json'},body:'{}'});
 assert.equal(denied.status,403);
 await stop();launch();await ready();
 const restored=(await (await local('/api/role/paper-cat/memory')).json()).items;
 assert.equal(restored.find(item=>item.topic==='展会地点').fact,'绍兴');
 assert.equal(restored.find(item=>item.topic==='聊小说').due,'周日下午');
 assert.deepEqual((await (await local('/api/role/rain-gull/memory')).json()).items,[]);
 assert.equal((await rows()).length,3);
 console.log(JSON.stringify({status:'pass',origin,data,roleImports:2,restarts:1,externalCalls:0},null,2));
}finally{await stop();}
