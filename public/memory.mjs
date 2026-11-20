const $=id=>document.getElementById(id);
const picker=$('memory-role'),search=$('memory-search'),dialog=$('memory-dialog'),form=$('memory-form');
const add=$('memory-add'),save=$('memory-save'),feedback=$('memory-feedback');
const memoryViewButtons=[...document.querySelectorAll('[data-memory-view]')];
const viewNames={library:'记忆库',experiences:'共同经历'};
const queries={library:'',experiences:''};
let view=new URLSearchParams(location.search).get('view')==='experiences'?'experiences':'library';
const date=new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium'});
const agreementStates={pending:'待完成',completed:'已完成',cancelled:'已取消'};
let roles=[],memories=[],turns=[],experiences=[],automatic=false,previewMode=false,readyRole='',saveRole='',editingMemory,loadNumber=0;
async function api(path,value){
 const response=await fetch(path,value===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'操作失败');
 return result;
}
function node(tag,text,className){
 const el=document.createElement(tag);
 if(text!==undefined)el.textContent=text;
 if(className)el.className=className;
 return el;
}
function status(text,tone=''){
 feedback.textContent=text;
 feedback.dataset.tone=tone;
}
function sourceLabel(memory){
 if(memory.source.startsWith('manual:'))return '手动确认';
 const turn=turns.find(item=>item.request_id===memory.source);
 return turn?'来自对话 · '+turn.input.slice(0,45):'已关联历史对话';
}
function versions(memory){
 const details=node('details',undefined,'memory-versions');
 const summary=node('summary','查看版本和原话');
 const content=node('div');
 const id=readyRole;
 details.append(summary,content);
 details.addEventListener('toggle',async ()=>{
  if(!details.open||content.childNodes.length)return;
  content.textContent='正在读取…';
  try{
   const selector=memory.agreementId?{agreementId:memory.agreementId}:{topic:memory.topic};
   const result=await api('/api/role/'+id+'/memory-revisions?'+new URLSearchParams(selector));
   content.replaceChildren(...result.items.map(item=>{
    const block=node('div',undefined,'memory-version');
    block.append(node('strong','第 '+item.revision+' 版 · '+date.format(new Date(item.at))),node('p',item.fact));
    if(item.original)block.append(node('p','用户原话 · '+item.original.input),node('p','角色回复 · '+item.original.answer));
    return block;
   }));
  }catch(error){
   content.textContent=error.message;
  }
 });
 return details;
}
function renderExperiences(query){
 const hint=$('experience-hint');
 hint.hidden=!automatic;
 hint.textContent='有明确线索的聊天会在后台整理。确认后，角色才能在以后回想起这条经历。';
 const matches=experiences.filter(e=>(e.title+' '+e.user_quote+' '+e.role_quote).toLowerCase().includes(query));
 if(!matches.length){
  const empty=node('div',undefined,'memory-page-empty');
  empty.append(node('h3',readyRole?(query?'没有匹配的共同经历':'还没有共同经历'):'正在读取共同经历'));
  $('experience-list').replaceChildren(empty);
  return;
 }
 const id=readyRole;
 $('experience-list').replaceChildren(...matches.map(e=>{
  const card=node('article',undefined,'memory-record-card memory-type-self');
  card.append(node('h3',e.title,'memory-record-type'),node('p','用户原话 · '+e.user_quote,'memory-record-text'),
   node('p','角色当时的理解 · '+e.role_quote,'memory-record-text'),node('span',e.state==='candidate'?'待确认':'已确认','memory-record-meta'));
  if(e.state==='candidate'){
   const actions=node('div',undefined,'memory-record-actions');
   for(const [label,state] of [['确认经历','confirmed'],['忽略','dismissed']]){
    const button=node('button',label);
    button.type='button';
    button.onclick=async ()=>{
     for(const control of actions.querySelectorAll('button'))control.disabled=true;
     try{
      await api('/api/role/'+id+'/experiences',{source:e.source,state});
      if(picker.value===id)await loadRole(id);
     }catch(error){if(picker.value===id)status(error.message,'error');}
     finally{for(const control of actions.querySelectorAll('button'))control.disabled=false;}
    };
    actions.append(button);
   }
   card.append(actions);
  }
  return card;
 }));
}
function render(){
 const query=queries.library.trim().toLowerCase();
 const experienceQuery=queries.experiences.trim().toLowerCase();
 const matches=memories.filter(m=>(m.topic+' '+m.fact+' '+(m.due??'')).toLowerCase().includes(query));
 renderExperiences(experienceQuery);
 const count=$('memory-count');
 count.textContent=readyRole&&view==='library'?(query?matches.length+' / ':'')+memories.length+' 条':'';
 if(!matches.length){
  const empty=node('div',undefined,'memory-page-empty');
  empty.append(node('h3',readyRole?(query?'没有匹配的记忆':'还没有已确认的记忆'):'正在读取记忆'));
  $('memory-list').replaceChildren(empty);
  return;
 }
 $('memory-list').replaceChildren(...matches.map(m=>{
  const card=node('article',undefined,'memory-record-card memory-type-topic');
  const heading=node('h3',m.topic,'memory-record-type');
  const meta=node('div',undefined,'memory-record-meta');
  meta.append(node('span',sourceLabel(m)),node('span',date.format(new Date(m.at))+' · 第 '+m.revision+' 版'));
  if(m.kind==='agreement')meta.append(node('span',(m.due?m.due+' · ':'')+agreementStates[m.state]));
  const actions=node('div',undefined,'memory-record-actions');
  const button=node('button','更正');
  button.type='button';
  button.setAttribute('aria-label','更正 '+m.topic);
  button.onclick=()=>openForm(m);
  actions.append(button);
  card.append(heading,node('p',m.fact,'memory-record-text'),meta,versions(m),actions);
  return card;
 }));
}
async function loadRole(id){
 const loading=++loadNumber;
 readyRole='';
 add.disabled=true;
 memories=[];
 turns=[];
 experiences=[];
 automatic=false;
 status('');
 render();
 const roleUrl='/api/role/'+id;
 try{
  const [memory,history,review]=await Promise.all([api(roleUrl+'/memory'),api(roleUrl+'/history'),api(roleUrl+'/experiences')]);
  if(loading!==loadNumber)return;
  readyRole=id;
  memories=memory.items;
  turns=history.turns;
  experiences=review.items;
  automatic=review.automatic;
  add.disabled=false;
  render();
 }catch(error){
  if(loading!==loadNumber)return;
  $('memory-list').replaceChildren();
  $('experience-list').replaceChildren();
  status(error.message,'error');
 }
}
function updateMemoryUrl(){
 const query=new URLSearchParams(location.search);
 if(picker.value)query.set('role',picker.value);
 if(view==='experiences')query.set('view',view);
 else query.delete('view');
 const href='/memory.html'+(query.size?'?'+query:'');
 history.replaceState(null,'',href);
 document.querySelector('.desktop-menubar [aria-current="page"]').href=href;
}
function showView(next){
 view=next;
 const library=view==='library';
 $('memory-title').textContent=viewNames[view];
 $('memory-list').hidden=!library;
 $('experience-section').hidden=library;
 add.hidden=!library;
 search.value=queries[view];
 const prompt=library?'搜索主题或事实':'搜索共同经历';
 search.placeholder=prompt+'…';
 search.setAttribute('aria-label',prompt);
 for(const button of memoryViewButtons)
  button.setAttribute('aria-pressed',String(button.dataset.memoryView===view));
 document.querySelector('.memory-library-view').scrollTop=0;
 updateMemoryUrl();
 render();
}
function selectRole(){
 const id=picker.value;
 const query='?role='+encodeURIComponent(id);
 for(const link of document.querySelectorAll('[data-chat-link]'))link.href='/'+query;
 $('memory-role-link').href='/roles.html'+query;
 $('memory-owner').textContent=(previewMode?'演示数据 · ':'')+roles.find(r=>r.id===id).name;
 queries.library=queries.experiences='';
 showView(view);
 return loadRole(id);
}
function showAgreementFields(){
 const agreement=form.elements.kind.value==='agreement';
 $('agreement-fields').hidden=!agreement;
 form.elements.due.disabled=!agreement;
 form.elements.state.disabled=!agreement;
}
form.elements.kind.onchange=showAgreementFields;
function openForm(memory){
 saveRole=readyRole;
 editingMemory=memory;
 form.reset();
 const {topic,fact,source,kind,due,state}=form.elements;
 kind.value=memory?.kind??'fact';
 due.value=memory?.due??'';
 state.value=memory?.state??'pending';
 showAgreementFields();
 topic.readOnly=Boolean(memory);
 topic.value=memory?.topic??'';
 fact.value=memory?.fact??'';
 source.replaceChildren(new Option('手动确认',''),...turns.map(t=>new Option(t.input.slice(0,45),t.request_id)));
 const previousSource=memory?.source;
 if(previousSource&&!previousSource.startsWith('manual:')){
  if(!turns.some(t=>t.request_id===previousSource))source.add(new Option('保留关联的历史对话',previousSource));
  source.value=previousSource;
 }
 $('memory-dialog-title').textContent=memory?'更正记忆':'新增记忆';
 $('memory-hint').textContent=memory?'保存后，旧版本仍保留在本机。':'同主题的约定可以分别保存，普通事实仍按主题更新。';
 $('memory-error').hidden=true;
 dialog.showModal();
 (memory?fact:topic).focus();
}
form.onsubmit=async event=>{
 event.preventDefault();
 if(save.disabled)return;
 const id=saveRole;
 const payload=Object.fromEntries(new FormData(form));
 if(payload.due==='')delete payload.due;
 if(editingMemory?.agreementId)payload.agreementId=editingMemory.agreementId;
 if(!editingMemory&&payload.kind==='agreement')payload.newAgreement=true;
 save.disabled=true;
 $('memory-error').hidden=true;
 try{
  await api('/api/role/'+id+'/memory',payload);
  dialog.close();
  if(picker.value===id){
   await loadRole(id);
   if(readyRole===id)status('记忆已保存。','success');
  }
 }catch(error){
  $('memory-error').textContent=error.message;
  $('memory-error').hidden=false;
 }finally{save.disabled=false;}
};
for(const id of ['memory-close','memory-cancel'])$(id).onclick=()=>dialog.close();
picker.onchange=selectRole;
for(const button of memoryViewButtons)button.onclick=()=>showView(button.dataset.memoryView);
search.oninput=()=>{
 queries[view]=search.value;
 render();
};
add.onclick=()=>openForm();
showView(view);
try{
 const [available,settings]=await Promise.all([api('/api/roles'),api('/api/settings')]);
 roles=available;
 previewMode=settings.preview;
 if(!roles.length)throw Error('请先在对话页创建角色。');
 picker.replaceChildren(...roles.map(r=>new Option(r.name,r.id)));
 const preferred=new URLSearchParams(location.search).get('role');
 picker.value=roles.find(r=>r.id===preferred)?.id??roles[0].id;
 picker.disabled=false;
 await selectRole();
}catch(error){status(error.message,'error');}
