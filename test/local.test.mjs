import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import YAML from 'js-yaml';
import {ask,ENDPOINT,MODEL,prompt,roleFromYaml,roleYaml,Store} from '../core.mjs';

const preset=roleFromYaml(readFileSync(new URL('../roles/xiaoyu.yaml',import.meta.url),'utf8'));
const blank=readFileSync(new URL('../roles/blank.yaml',import.meta.url),'utf8');
function filled(id,name){
 const role=YAML.load(blank);
 Object.assign(role,{id,name});
 role.identity.self_description='收集废纸再利用的闲聊搭档';
 role.relationship.start='初识';
 return roleFromYaml(roleYaml(role));
}

test('schema, blank role, import and readable errors',()=>{
 assert.throws(()=>roleFromYaml(blank),/角色\.id/);
 assert.throws(()=>roleFromYaml(roleYaml({...preset,avatar:'https://invalid.example/a.png'})),/avatar/);
 assert.throws(()=>roleFromYaml(roleYaml({...preset,expression:[{when:'测试'}]})),/expression\[0\]\.effect/);
 assert.deepEqual(roleFromYaml(roleYaml(preset)),preset);
 const minimal=filled('paper-cat','纸团');
 assert.equal(minimal.id,'paper-cat');
 assert.deepEqual(minimal.expression,[]);
 assert.equal(minimal.reply_format.dialogue,'');
 assert.match(prompt(minimal),/当前角色配置[\s\S]*应用通用回复规则[\s\S]*简单道别、告知、确认或交回话头/);
 assert.match(prompt(minimal),/已确认的记忆/);
 const withCounterexample={...minimal,counterexamples:[{user:'我先睡了。',reply:'还有问题吗？',why:'道别后多问了一句。'}]};
 assert.match(prompt(withCounterexample),/counterexamples/);
 assert.doesNotMatch(prompt(withCounterexample,false),/counterexamples/);
 assert.doesNotMatch(prompt(preset),/未填写|必填|string/);
});

test('restart preserves role ownership, correction versions, sources and decisions',t=>{
 const folder=mkdtempSync(path.join(os.tmpdir(),'heart-test-')),file=path.join(folder,'new.sqlite');
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 let s=new Store(file);
 s.saveRole(preset);
 const second=filled('paper-cat',preset.name);
 s.saveRole(second);
 assert.throws(()=>s.saveRole(second),/已存在/);
 const request=randomUUID();
 s.begin(preset.id,request,'这场展会在宁波。',null);
 s.finish(preset.id,request,'我决定把展会主题定为纸灯。');
 s.remember(preset.id,{topic:'展会地点',fact:'宁波',source:request});
 const newer=s.remember(preset.id,{topic:'展会地点',fact:'绍兴',source:request});
 assert.equal(newer.revision,2);
 assert.match(JSON.stringify(s.context(preset.id,'展会地点')),/绍兴/);
 assert.throws(()=>s.remember(second.id,{topic:'展会地点',fact:'绍兴',source:request}),/不属于/);
 for(let i=0;i<7;i++){
  const id=randomUUID();
  s.begin(preset.id,id,'早餐随聊 '+i,null);
  s.finish(preset.id,id,'好。');
 }
 s.saveRole({...preset,name:'示例搭档改名'},true);
 assert.throws(()=>s.begin(preset.id,request,'重复提交',null),/UNIQUE/);
 const interrupted=randomUUID();s.begin(preset.id,interrupted,'请求中途重启',null);
 s.close();
 s=new Store(file);
 assert.equal(s.role(preset.id).name,'示例搭档改名');
 assert.equal(s.turn(preset.id,interrupted).status,'interrupted');
 const recalled=s.context(preset.id,'展会地点是哪里，展会主题怎么定？',randomUUID());
 assert.equal(recalled.facts[0].fact,'绍兴');
 assert.match(recalled.summary[0].roleExcerpt,/我决定把展会主题定为纸灯/);
 assert.equal(recalled.summary[0].source,request);
 assert.equal(s.db.prepare('SELECT count(*) n FROM memory_revisions').get().n,2);
 assert.deepEqual(s.context(second.id,'展会地点和展会主题',randomUUID()),{facts:[],summary:[],recent:[]});
 assert.equal(s.history(second.id).length,0);
 s.close();
});

test('text and image use the sole official endpoint and model, with filenames omitted',async()=>{
 const requests=[];
 const fetchImpl=async(url,opts)=>{
  requests.push({url,body:JSON.parse(opts.body),redirect:opts.redirect});
  return Response.json({choices:[{message:{content:'测试响应'},finish_reason:'stop'}]});
 };
 const input={key:'fixture-key',role:preset,context:{facts:[],summary:[],recent:[]},text:'描述一下色块',fetchImpl};
 await ask(input);
 await ask({...input,image:{bytes:Buffer.from('fixture'),mime:'image/png',name:'不要发送.png'}});
 for(const r of requests){assert.equal(r.url,ENDPOINT);assert.equal(r.body.model,MODEL);assert.equal(r.redirect,'error');}
 assert.equal(requests[1].body.messages.at(-1).content[1].type,'image_url');
 assert.doesNotMatch(JSON.stringify(requests),/不要发送/);
 await assert.rejects(ask({...input,fetchImpl:async()=>new Response('error',{status:400})}),/HTTP 400/);
});
