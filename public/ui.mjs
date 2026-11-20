const $=id=>document.getElementById(id);
let active='',roles=[],sending=false;
const fileData=file=>file?new Promise((resolve,reject)=>{
 const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('无法读取文件'));
 reader.readAsDataURL(file);
}):Promise.resolve(null);
async function api(path,value){
 const res=await fetch(path,value===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 const result=await res.json();
 if(!res.ok)throw Error(result.error||'操作失败');
 return result;
}
const safe=fn=>async event=>{try{await fn(event);}catch(error){$('status').textContent=error.message;}};
function node(tag,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;}
const clock=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
function setAvatar(image,role){
 image.src=role?.avatar?'/'+role.avatar:'/default.svg';
 image.onerror=()=>{image.onerror=null;image.src='/default.svg';};
}
function showMessage(parent,role,text,img,at){
 const current=roles.find(r=>r.id===active);
 const box=node('article');box.className='message-row '+role;
 if(role==='assistant'){
  const portrait=node('img');portrait.className='message-avatar';portrait.alt='';
  setAvatar(portrait,current);box.append(portrait);
 }
 const stack=node('div');stack.className='message-stack';
 const bubble=node('div');bubble.className='message-bubble'+(role==='error'?' error':'');
 bubble.append(node('p',text));
 if(img){const picture=node('img');picture.src=img;picture.alt='本轮发送的图片';bubble.append(picture);}
 const author=role==='user'?'你':role==='error'?'发送状态':current?.name;
 const meta=node('div',author+' · '+clock.format(new Date(at)));meta.className='message-meta';
 stack.append(bubble,meta);box.append(stack);parent.append(box);
}
async function loadChat(){
 const id=active;
 const history=await api('/api/role/'+id+'/history');
 if(id!==active)return;
 const chats=$('messages');chats.replaceChildren();
 if(!history.turns.length){
  const empty=node('p','还没有消息');empty.className='chat-empty';chats.append(empty);
 }
 for(const turn of history.turns){
  showMessage(chats,'user',turn.input,turn.mime?'/api/role/'+id+'/image/'+turn.request_id:null,turn.created_at);
  if(turn.status==='complete')showMessage(chats,'assistant',turn.answer,null,turn.created_at);
  else showMessage(chats,'error',turn.error||'等待模型回复…',null,turn.created_at);
 }
 chats.scrollTop=chats.scrollHeight;
}
async function reload(preferred){
 roles=await api('/api/roles');
 const current=roles.find(x=>x.id===preferred)??roles[0];
 active=current?.id??'';
 $('roles').replaceChildren(...roles.map(r=>{
  const button=node('button');button.type='button';button.setAttribute('aria-current',String(r.id===active));
  const avatar=node('img');avatar.alt='';setAvatar(avatar,r);
  button.append(avatar,node('span',r.name));button.onclick=safe(()=>reload(r.id));return button;
 }));
 $('name').textContent=current?'和「'+current.name+'」聊聊天':'聊天';
 $('text').placeholder=current?'想和「'+current.name+'」说点什么……':'说点什么…';
 setAvatar($('chat-avatar'),current);
 const query=active?'?role='+encodeURIComponent(active):'';
 $('open-memory').href='/memory.html'+query;
 $('open-role-manager').href='/roles.html'+query;
 if(active){
  history.replaceState(null,'','/'+query);
  await loadChat();
 }
}
async function settings(){
 const s=await api('/api/settings');
 $('connection').textContent=s.preview?'演示数据':s.ready?'DeepSeek 已配置':'待配置 API Key';
 $('settings').hidden=s.preview;
 $('model').textContent=s.model+' · 已通过原生看图测试'+(s.envKey?' · 运行时密钥来自环境变量':'');
}
$('settings').onclick=safe(async()=>{await settings();$('settings-error').textContent='';$('settings-dialog').showModal();});
$('settings-form').onsubmit=async event=>{
 event.preventDefault();
 try{await api('/api/settings',{key:new FormData(event.target).get('key').trim()});event.target.reset();await settings();$('settings-dialog').close();}
 catch(error){$('settings-error').textContent=error.message;}
};
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>button.closest('dialog').close();
$('picture').onchange=()=>{$('attachment-name').textContent=$('picture').files[0]?.name??'';};
$('send').onsubmit=safe(async event=>{
 event.preventDefault();if(sending)return;
 const target=active,input=$('text'),button=$('send-button'),text=input.value;
 const picture=$('picture');const attachment=picture.files[0];
 if(!text.trim()&&!attachment)return;
 sending=true;button.disabled=true;$('status').textContent='正在等待回复…';
 try{
  const turn=await api('/api/role/'+target+'/chat',{text,image:await fileData(attachment),requestId:crypto.randomUUID()});
  if(turn.status==='complete'){if(input.value===text)input.value='';picture.value='';$('attachment-name').textContent='';}
  $('status').textContent=turn.error||'';
  if(target===active)await loadChat();
 }finally{sending=false;button.disabled=false;}
});
const preferred=new URLSearchParams(location.search).get('role');
await safe(async()=>{await Promise.all([reload(preferred),settings()]);})();
