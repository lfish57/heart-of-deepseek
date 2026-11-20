import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {handwrittenToYaml,handwrittenQuestions,questionnaireToYaml} from './handwritten.mjs';
import {memoryCommand,mayBeExperience} from './memory.mjs';
import {Store,roleFromYaml,roleYaml,ask,proposeExperience,MODEL,ENDPOINT} from './core.mjs';
import YAML from 'js-yaml';

const root=path.dirname(fileURLToPath(import.meta.url));
const data=path.resolve(process.env.HEART_DATA_DIR||path.join(root,'data'));
const port=Number(process.env.HEART_PORT||3561);
if(!Number.isInteger(port)||port!==0&&(port<1024||port>65535))throw Error('HEART_PORT 无效');
const desktop=process.env.HEART_DESKTOP==='1';
const preview=desktop&&process.env.HEART_PREVIEW==='1';
fs.mkdirSync(path.join(data,'avatars'),{recursive:true});
const store=new Store(path.join(data,'chat.sqlite'));
const defaultRole=roleFromYaml(fs.readFileSync(path.join(root,'roles/xiaoyu.yaml'),'utf8'));
try {
 fs.copyFileSync(path.join(root,'public/assets/xiaoyu-avatar.jpg'),path.join(data,defaultRole.avatar),fs.constants.COPYFILE_EXCL);
} catch(error) {
 if(error.code!=='EEXIST')throw error;
}
const savedDefault=store.role(defaultRole.id);
if(!savedDefault)store.saveRole(defaultRole);
else if(!savedDefault.avatar)store.saveRole({...savedDefault,avatar:defaultRole.avatar},true);
if(preview){const {seedPreview}=await import('./desktop/preview.mjs');seedPreview(store,defaultRole);}
const keyFile=path.join(data,'key.local');
const validKey=v=>typeof v==='string'&&/^sk-[A-Za-z0-9_-]{8,160}$/.test(v);
const getKey=()=>{
 if(preview)return '';
 if(process.env.HEART_API_KEY)return process.env.HEART_API_KEY;
 try{return fs.readFileSync(keyFile,'utf8').trim();}catch{return '';}
};
const assetTypes={png:'image/png',jpg:'image/jpeg',webp:'image/webp'};
function picture(value,limit){
 if(!value)return null;
 const match=typeof value==='string'&&value.length<=Math.ceil(limit/3)*4+60&&value.match(/^data:(image\/(?:png|jpeg|webp));base64,([\w+/=]+)$/);
 if(!match)throw Error('图片须为 PNG、JPEG 或 WebP，且未超过大小上限');
 const bytes=Buffer.from(match[2],'base64'),mime=match[1];
 const looks=mime==='image/png'?bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a':
  mime==='image/jpeg'?bytes.subarray(0,3).toString('hex')==='ffd8ff':
  bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 if(!looks||bytes.length>limit||bytes.toString('base64')!==match[2])throw Error('图片内容或大小不符合格式');
 return {mime,bytes};
}
async function body(req){
 if(!req.headers['content-type']?.startsWith('application/json'))throw Error('请求格式须为 JSON');
 const parts=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>7_100_000)throw Error('请求数据过大');parts.push(chunk);}
 const parsed=JSON.parse(Buffer.concat(parts).toString('utf8'));
 if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw Error('请求体无效');
 return parsed;
}
const respond=(res,status,type,value)=>{res.writeHead(status,{'content-type':type,'x-content-type-options':'nosniff','cache-control':'no-store','cross-origin-resource-policy':'same-origin'});res.end(value);};
const json=(res,status,value)=>respond(res,status,'application/json; charset=utf-8',JSON.stringify(value));
const assets={'/':['index.html','text/html; charset=utf-8'],'/ui.mjs':['ui.mjs','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/default.svg':['default.svg','image/svg+xml'],
 '/roles.html':['role-editor.html','text/html; charset=utf-8'],
 '/role-editor.mjs':['role-editor.mjs','text/javascript; charset=utf-8'],
 '/role-import.mjs':['role-import.mjs','text/javascript; charset=utf-8'],
 '/role-editor.css':['role-editor.css','text/css; charset=utf-8'],
 '/memory.html':['memory.html','text/html; charset=utf-8'],'/memory.mjs':['memory.mjs','text/javascript; charset=utf-8'],'/memory.css':['memory.css','text/css; charset=utf-8']};
const busy=new Set();
const autoExperiences=!preview&&process.env.HEART_AUTO_EXPERIENCES!=='0';
const workerStop=new AbortController();
let working=false;
function scheduleExperiences(){
 if(!autoExperiences||working||workerStop.signal.aborted||busy.size||!validKey(getKey()))return;
 working=true;
 setImmediate(async()=>{
  try{
   while(!workerStop.signal.aborted&&!busy.size){
    const task=store.memory.next();
    const key=getKey();
    if(!task||!validKey(key))break;
    const {role_id:id,source}=task;
    const turn=store.memory.getTurn(id,source);
    let proposal=null;
    try{
     if(turn)proposal=await proposeExperience({key,turn,signal:AbortSignal.any([workerStop.signal,AbortSignal.timeout(20_000)])});
    }catch{ /* An unavailable model leaves the original chat intact. */ }
    if(!workerStop.signal.aborted)store.memory.finishExperience(id,source,proposal);
   }
  }catch{
   console.warn('经历整理暂停，下次聊天后继续检查。');
  }finally{working=false;}
 });
}
const origins=new Set();
const server=http.createServer(async(req,res)=>{
 try{
  const origin='http://'+req.headers.host;
  if(!origins.has(origin)||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&!origins.has(req.headers.origin))||
   (req.method==='POST'&&req.headers.origin!==origin))return json(res,403,{error:'仅限此本机应用页面访问'});
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'");
  const url=new URL(req.url,origin),p=url.pathname;
  if(req.method==='GET'&&(p==='/role-new.html'||p==='/role-edit.html')){
   url.searchParams.set('view',p==='/role-new.html'?'new':'edit');
   res.writeHead(302,{location:'/roles.html?'+url.searchParams,'cache-control':'no-store'});
   return res.end();
  }
  if(req.method==='GET'&&assets[p])return respond(res,200,assets[p][1],fs.readFileSync(path.join(root,'public',assets[p][0])));
  if(req.method==='GET'&&p==='/api/template'){
   const yaml=fs.readFileSync(path.join(root,'roles/blank.yaml'),'utf8');
   if(url.searchParams.get('format')==='card')return json(res,200,{card:YAML.load(yaml)});
   return respond(res,200,'text/plain; charset=utf-8',yaml);
  }
  if(req.method==='GET'&&p==='/api/template/handwritten'){
   if(url.searchParams.get('format')==='questions')return json(res,200,handwrittenQuestions());
   return respond(res,200,'text/plain; charset=utf-8',fs.readFileSync(path.join(root,'roles/手写角色卡.txt')));
  }
  if(req.method==='POST'&&p==='/api/template/convert'){
   const {text,answers}=await body(req);
   return json(res,200,{yaml:answers===undefined?handwrittenToYaml(text):questionnaireToYaml(answers)});
  }
  if(req.method==='POST'&&p==='/api/role-card'){
   const {yaml,card}=await body(req);
   return json(res,200,typeof yaml==='string'?{card:roleFromYaml(yaml)}:{yaml:roleYaml(card)});
  }
  if(req.method==='GET'&&p==='/api/roles'){
   const withProfile=url.searchParams.get('detail')==='profile';
   return json(res,200,store.roles().map(r=>{
    const {id,name,avatar}=r;
    if(!withProfile)return {id,name,avatar};
    const summary=r.identity.self_description;
    const tags=r.personality.traits.slice(0,3).map(item=>item.trait);
    return {id,name,avatar,summary,tags};
   }));
  }
  if(req.method==='GET'&&p==='/api/settings')return json(res,200,{ready:!!getKey(),envKey:!!process.env.HEART_API_KEY,model:MODEL,endpoint:ENDPOINT,vision:'verified',preview});
  if(req.method==='POST'&&p==='/api/settings'){
   if(preview)throw Error('演示窗口只使用本地示例。请打开正式应用配置模型。');
   const {key}=await body(req);
   if(!validKey(key))throw Error('API Key 格式无效，应填写自己申请的 sk- 密钥');
   const next=keyFile+'.new';
   fs.writeFileSync(next,key,{mode:0o600});
   fs.renameSync(next,keyFile);
   scheduleExperiences();
   return json(res,200,{ready:true});
  }
  if(req.method==='POST'&&p==='/api/roles'){
   const input=await body(req),role=roleFromYaml(input.yaml);
   const editing=input.editId!==undefined;
   if(editing&&input.editId!==role.id)throw Error('编辑时不能改稳定 ID。改名请修改 name');
   if(!editing&&store.role(role.id))throw Error('id 已存在，请为新角色填写不同 ID');
   if(editing&&!store.role(role.id))throw Error('要编辑的角色不存在');
   const img=picture(input.avatar,2*1024*1024);
   if(img){
    const ext=Object.keys(assetTypes).find(k=>assetTypes[k]===img.mime);
    role.avatar='avatars/'+randomBytes(16).toString('hex')+'.'+ext;
    fs.writeFileSync(path.join(data,role.avatar),img.bytes);
   }else if(role.avatar&&!fs.existsSync(path.join(data,role.avatar)))throw Error('avatar 文件不存在。请重新选头像，或清空 avatar 使用默认图');
   store.saveRole(role,editing);
   return json(res,200,{id:role.id,name:role.name,avatar:role.avatar});
  }
  const avatar=p.match(/^\/avatars\/([a-f0-9]{32})\.(png|jpg|webp)$/);
  if(req.method==='GET'&&avatar){
   const target=path.join(data,p.slice(1));
   if(fs.existsSync(target))return respond(res,200,assetTypes[avatar[2]],fs.readFileSync(target));
   return json(res,404,{error:'头像丢失，请在角色页重新选择'});
  }
  const match=p.match(/^\/api\/role\/([a-z][a-z0-9-]{2,39})(?:\/(history|memory|memory-revisions|experiences|chat|image)(?:\/([a-f0-9-]{36}))?)?$/);
  if(!match)return json(res,404,{error:'找不到入口'});
  const [,id,action,request]=match,role=store.role(id);
  if(!role)return json(res,404,{error:'角色不存在'});
  if(req.method==='GET'&&!action)return json(res,200,{yaml:roleYaml(role),card:role});
  if(req.method==='GET'&&action==='history')return json(res,200,{turns:store.history(id)});
  if(req.method==='GET'&&action==='memory')return json(res,200,{items:store.memories(id)});
  if(req.method==='GET'&&action==='memory-revisions'){
   const topic=url.searchParams.get('topic'),agreementId=url.searchParams.get('agreementId');
   if(agreementId?!/^[0-9a-f]{32}$/.test(agreementId):!topic||topic.length>80)throw Error('记忆主题或约定编号无效');
   return json(res,200,{items:store.memory.revisions(id,topic,agreementId)});
  }
  if(req.method==='GET'&&action==='experiences')return json(res,200,{items:store.memory.experiences(id),automatic:autoExperiences});
  if(req.method==='POST'&&action==='experiences'){
   const {source,state}=await body(req);
   if(typeof source!=='string'||!/^[a-f0-9-]{36}$/.test(source))throw Error('出处无效');
   store.memory.review(id,source,state);
   return json(res,200,{state});
  }
  if(req.method==='GET'&&action==='image'){
   const found=store.image(id,request);
   return found?respond(res,200,found.mime,Buffer.from(found.image)):json(res,404,{error:'附件不存在'});
  }
  if(req.method==='POST'&&action==='memory')return json(res,200,store.remember(id,await body(req)));
  if(req.method==='POST'&&action==='chat'){
   const {text,image,requestId}=await body(req);
   if(typeof text!=='string'||text.length>4000||(!text.trim()&&!image))throw Error('请输入文字或选择一张图片，正文最多 4,000 字');
   if(typeof requestId!=='string'||!/^[a-f0-9-]{36}$/.test(requestId))throw Error('请求编号无效');
   const stored=store.turn(id,requestId);
   if(stored)return json(res,200,stored);
   if(busy.has(id))return json(res,409,{error:'这一轮还在回复，请稍等'});
   const intent=image?null:memoryCommand(text.trim());
   if(intent&&(!intent.natural||store.memory.matchingAgreements(id,intent).length)){
    store.db.exec('SAVEPOINT chat_memory');
    try{
     store.begin(id,requestId,text.trim(),null);
     const answer=store.memory.command(id,intent,requestId);
     store.finish(id,requestId,answer);
     store.db.exec('RELEASE chat_memory');
    }catch(error){
     store.db.exec('ROLLBACK TO chat_memory; RELEASE chat_memory');
     throw error;
    }
    return json(res,200,store.turn(id,requestId));
   }
   const key=getKey();if(!validKey(key))throw Error('请先在设置中录入自己的 DeepSeek API Key');
   const attachment=picture(image,5*1024*1024),input=text.trim()||'请看看这张图片。';
   store.begin(id,requestId,input,attachment);
   busy.add(id);
   try{
    const answer=await ask({key,role,context:store.context(id,input,requestId),text:input,image:attachment});
    store.finish(id,requestId,answer);
   }catch(error){
    store.finish(id,requestId,null,error.name==='TimeoutError'?'DeepSeek 请求超时':
     /^(DeepSeek 请求失败|模型未返回)/.test(error.message)?error.message:'无法联系 DeepSeek，请检查网络后重试');
   }finally{busy.delete(id);}
   const turn=store.turn(id,requestId);
   if(autoExperiences&&turn.status==='complete'&&mayBeExperience(input)){
    try{store.memory.enqueue(id,requestId);}catch{console.warn('经历待整理记录未能入队。');}
   }
   json(res,200,turn);
   scheduleExperiences();
   return;
  }
  return json(res,405,{error:'请求方法不支持'});
 }catch(error){if(!res.headersSent)json(res,400,{error:String(error.message).slice(0,400)});}
});
server.listen(port,'127.0.0.1',()=>{
 const boundPort=server.address().port;
 const address='http://127.0.0.1:'+boundPort;
 origins.add(address);
 origins.add('http://localhost:'+boundPort);
 console.log((desktop?'HEART_READY ':'鲸之心 ')+address);
 scheduleExperiences();
});
server.on('close',()=>{workerStop.abort();store.close();});
if(desktop){
 process.stdin.on('end',()=>{workerStop.abort();server.close();});
 process.stdin.resume();
}
