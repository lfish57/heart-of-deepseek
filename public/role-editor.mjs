import {avatarData,initRoleImport} from './role-import.mjs';

const $ = id => document.getElementById(id);
const sectionButtons = [...document.querySelectorAll('[data-section]')];
const query = new URLSearchParams(location.search);
const route = query.get('view');
const archive = route !== 'new';
const roleDialog = $('role-dialog');

const sections = {
 identity: [
  ['identity.self_description', '身份与自我认识'],
  ['relationship.start', '相处起点'],
  ['identity.scenes', '常见场景', 'lines'],
  ['identity.facts', '稳定设定', 'lines'],
  ['personality.goals', '长期目标', 'lines'],
  ['identity.unknowns', '待确认的设定', 'lines'],
  ['personality.traits', '性格与反应', {trait:'性格倾向',when:'何时显现',behavior:'如何反应',reconsider:'何时调整'}],
 ],
 reply: [
  ['reply_format.length', '篇幅与节奏'],
  ['reply_format.paragraphs', '分段'],
  ['reply_format.dialogue', '说话语气'],
  ['reply_format.actions', '动作描写'],
  ['reply_format.omit_when', '何时省略'],
  ['reply_format.internal', '其他格式要求'],
 ],
 expression: [
  ['expression', '情境与回应', {when:'触发情境',effect:'表达方式',exception:'适用的例外'}],
  ['examples', '对白正例', {user:'对方发言',reply:'角色回复',why:'采用原因'}],
  ['counterexamples', '对白反例', {user:'对方发言',reply:'角色回复',why:'避免原因'}],
  ['memory_boundary.start', '已确认的相处起点'],
  ['memory_boundary.attribution', '记忆来源归属'],
  ['memory_boundary.correction', '更正规则'],
 ],
};
const profileFields = {'card-name':'name','card-id':'id','card-age':'identity.age_status'};
const fields = new Map();
let card, editId, avatarUrl, busy = false, editorRequest = 0;

async function api(path, value){
 const res = await fetch(path, value === undefined ? {} : {
  method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(value),
 });
 const result = await res.json();
 if (!res.ok) throw Error(result.error || '操作失败');
 return result;
}
function element(tag, text, className){
 const node = document.createElement(tag);
 if (text) node.textContent = text;
 if (className) node.className = className;
 return node;
}
function textarea(label, rows, value = '', maxLength = 1600){
 const wrapper = element('label', label);
 const control = element('textarea');
 control.rows = rows;
 control.maxLength = maxLength;
 control.value = value;
 wrapper.append(control);
 return {wrapper, control};
}
function button(text){
 const node = element('button', text, 'role-secondary');
 node.type = 'button';
 return node;
}
function repeatedField(title, labels, values){
 const panel = element('fieldset', '', 'role-repeated');
 const legend = element('legend', title);
 const rows = element('div', '', 'role-repeated-rows');
 const add = button('添加一项');
 const read = () => [...rows.children].map(row => Object.fromEntries(
  [...row.querySelectorAll('textarea')].map(input => [input.name,input.value]),
 ));
 function append(value = {}){
  const row = element('div', '', 'role-field-grid role-repeated-row');
  for (const [name, label] of Object.entries(labels)){
   const {wrapper, control} = textarea(label, 2, value[name]);
   control.name = name;
   row.append(wrapper);
  }
  const remove = button('移除此项');
  remove.onclick = () => {
   const next = row.nextElementSibling || row.previousElementSibling;
   row.remove();
   add.disabled = false;
   (next?.querySelector('textarea') || add).focus();
  };
  row.append(remove);
  rows.append(row);
  add.disabled = rows.children.length >= 15;
  return row;
 }
 values.forEach(append);
 add.onclick = () => append().querySelector('textarea').focus();
 panel.append(legend, rows, add);
 return {panel, read};
}
function readPath(data, path){
 return path.split('.').reduce((value,key) => value[key], data);
}
function writePath(data, path, value){
 const [parent, key] = path.split('.');
 if (key) data[parent][key] = value;
 else data[parent] = value;
}
function renderCard(next){
 card = next;
 fields.clear();
 for (const [id, path] of Object.entries(profileFields)){
  $(id).value = readPath(card, path);
  fields.set(path, () => $(id).value.trim());
 }
 $('card-id').readOnly = true;
 $('role-id-hint').textContent = '角色 ID 用于识别该角色的聊天与记忆，保存后固定。';
 $('avatar-preview').src = avatarUrl || (card.avatar ? '/'+card.avatar : '/default.svg');
 for (const [id, entries] of Object.entries(sections)){
  const area = $('role-'+id);
  const grid = element('div', '', 'role-field-grid');
  area.replaceChildren(grid);
  for (const [path, label, type] of entries){
   const value = readPath(card,path);
   if (typeof type === 'object'){
    const {panel, read} = repeatedField(label, type, value);
    panel.classList.add('role-field-wide');
    grid.append(panel);
    fields.set(path, read);
    continue;
   }
   const lines = type === 'lines';
   const initialText = lines ? value.join('\n') : value;
   const {wrapper, control} = textarea(label, 3, initialText, lines ? 24000 : 1600);
   if (lines) wrapper.append(element('small', '每行一项，最多 15 项'));
   grid.append(wrapper);
   fields.set(path, () => {
    if (!lines) return control.value.trim();
    if (control.value === initialText) return value;
    return control.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
   });
  }
 }
}
function collectCard(){
 const next = structuredClone(card);
 for (const [path, read] of fields) writePath(next, path, read());
 return next;
}
async function run(action){
 if (busy) return;
 busy = true;
 $('role-form').inert = true;
 $('role-error').textContent = '';
 const focus = document.activeElement;
 try { await action(); }
 catch (error) { $('role-error').textContent = error.message; }
 finally {
  busy = false;
  $('role-form').inert = false;
  if (roleDialog.open) focus?.focus();
 }
}
async function serialize(){
 return (await api('/api/role-card', {card:collectCard()})).yaml;
}
function selectSection(section){
 for (const tab of sectionButtons){
  const selected = tab.dataset.section === section;
  tab.setAttribute('aria-pressed', String(selected));
  $('role-'+tab.dataset.section).hidden = !selected;
 }
}
for (const btn of sectionButtons) btn.onclick = () => selectSection(btn.dataset.section);
$('avatar-file').onchange = event => {
 if (avatarUrl) URL.revokeObjectURL(avatarUrl);
 const file = event.target.files[0];
 avatarUrl = file ? URL.createObjectURL(file) : '';
 $('avatar-preview').src = avatarUrl || (card.avatar ? '/'+card.avatar : '/default.svg');
};
$('avatar-preview').onerror = () => {
 if (!$('avatar-preview').src.endsWith('/default.svg')) $('avatar-preview').src = '/default.svg';
};
$('role-form').onsubmit = event => {
 event.preventDefault();
 void run(async () => {
  const avatar = await avatarData($('avatar-file').files[0]);
  const saved = await api('/api/roles', {yaml:await serialize(), editId, avatar});
  roleDialog.close();
  await loadArchive();
  for (const link of document.querySelectorAll('.role-archive-edit')){
   if (link.dataset.roleId === saved.id) link.focus({preventScroll:true});
  }
 });
};
function roleView(view, id, section){
 const params = new URLSearchParams();
 if (view) params.set('view',view);
 if (id) params.set('role',id);
 if (section) params.set('section',section);
 return '/roles.html'+(params.size ? '?'+params : '');
}
function bindNavigation(role){
 const queryString = role ? '?role='+encodeURIComponent(role.id) : '';
 for (const link of document.querySelectorAll('[data-chat-link]')) link.href = '/'+queryString;
 $('role-memory-link').href = '/memory.html'+queryString;
 $('role-archive-menu').href = $('role-archive-link').href = roleView(undefined,role?.id);
 $('role-new-link').href = roleView('new',role?.id);
 $('role-create-card').href = $('role-new-link').href;
}
const cardLinks = [
 ['人设','identity','M12 3l9 9-9 9-9-9z'],
 ['格式','reply','M5 5h14M5 12h10M5 19h14'],
 ['表达','expression','M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z'],
 ['记忆',null,'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5'],
];
function profileTile(label, shape, href){
 const link=element('a','','role-profile-tile');
 link.href=href;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 const strokes=document.createElementNS(svg.namespaceURI,'path');
 svg.setAttribute('viewBox','0 0 24 24');
 svg.setAttribute('aria-hidden','true');
 strokes.setAttribute('d',shape);
 svg.append(strokes);
 link.append(svg,element('span',label));
 return link;
}
function bindEditor(link, role, section){
 link.href=roleView('edit',role.id,section);
 link.onclick=event=>{
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  event.preventDefault();
  void showEditor(role,section);
 };
}
function archiveCard(role, model){
 const item=element('article','','role-archive-card');
 const avatar=element('img');
 avatar.src=role.avatar?'/'+role.avatar:'/default.svg';
 avatar.alt='';
 avatar.onerror=()=>{avatar.onerror=null;avatar.src='/default.svg';};
 const identity=element('div');
 identity.append(element('h3',role.name),element('p',role.summary,'role-archive-summary'));
 const hero=element('div','','role-archive-hero');
 hero.append(avatar,identity);
 const tags=element('ul','','role-archive-tags');
 tags.append(...role.tags.map(tag=>element('li',tag)));
 const actions=element('nav','','role-archive-actions');
 actions.setAttribute('aria-label',role.name+'的设定');
 for(const [label,section,shape] of cardLinks){
  const link=profileTile(label,shape,'/memory.html?role='+encodeURIComponent(role.id));
  if (section) bindEditor(link,role,section);
  actions.append(link);
 }
 const usage=element('div','','role-archive-model');
 usage.append(element('span','使用模型'),element('strong',model));
 const edit=element('a','查看与编辑设定','role-archive-edit');
 edit.dataset.roleId=role.id;
 bindEditor(edit,role);
 item.append(hero,tags,actions,usage,edit);
 return item;
}
async function loadArchive(){
 const refresh=$('role-refresh');
 const feedback=$('role-archive-feedback');
 refresh.disabled=true;
 feedback.textContent='正在读取角色…';
 try{
  const [roles,settings]=await Promise.all([api('/api/roles?detail=profile'),api('/api/settings')]);
  const active=roles.find(item=>item.id===query.get('role'))??roles[0];
  bindNavigation(active);
  $('role-count').textContent=roles.length+' 个角色';
  const model=settings.preview?'演示数据':('DeepSeek · '+settings.model);
  $('role-cards').replaceChildren(...roles.map(role=>archiveCard(role,model)));
  feedback.textContent=roles.length?'':'还没有角色';
  return active;
 }catch(error){feedback.textContent=error.message;}
 finally{refresh.disabled=false;}
}
async function loadEditor(role, section){
 const request=++editorRequest;
 editId=role.id;
 if (avatarUrl) URL.revokeObjectURL(avatarUrl);
 avatarUrl='';
 const form=$('role-form');
 form.hidden=true;
 form.reset();
 $('role-error').textContent='';
 $('role-load-error').textContent='正在读取角色卡…';
 $('role-title').textContent='编辑角色 · '+role.name;
 selectSection(Object.hasOwn(sections,section)?section:'identity');
 try {
  const initial = await api('/api/role/'+encodeURIComponent(role.id));
  if (request !== editorRequest) return;
  renderCard(initial.card);
  $('role-load-error').textContent='';
  form.hidden=false;
  document.querySelector('.role-editor-content').scrollTop=0;
 } catch(error) {
  if (request === editorRequest) $('role-load-error').textContent=error.message;
 }
}
function showEditor(role, section){
 if (roleDialog.open || busy) return;
 const loading=loadEditor(role,section);
 roleDialog.showModal();
 return loading;
}
function dismissEditor(){
 if (!busy) roleDialog.close();
}
$('role-close').onclick=dismissEditor;
$('role-cancel').onclick=dismissEditor;
roleDialog.addEventListener('cancel',event=>{
 if (busy) event.preventDefault();
});
roleDialog.addEventListener('close',()=>{
 ++editorRequest;
 if (new URLSearchParams(location.search).get('view')==='edit')
  history.replaceState(null,'',$('role-archive-link').href);
});
$(archive ? 'role-archive-link' : 'role-new-link').setAttribute('aria-current','page');
if (archive){
 $('role-archive').hidden=false;
 document.querySelector('.memory-page-workspace').setAttribute('aria-labelledby','role-archive-title');
 const panel=$('role-editor-panel');
 roleDialog.append(panel);
 panel.hidden=false;
 $('role-close').hidden=false;
 $('role-cancel').hidden=false;
 $('role-refresh').onclick=loadArchive;
 const active=await loadArchive();
 if (route==='edit' && active) await showEditor(active,query.get('section'));
} else {
 $('role-import-panel').hidden=false;
 document.querySelector('.memory-page-workspace').setAttribute('aria-labelledby','role-import-title');
 initRoleImport(api);
 try {
  const roles = await api('/api/roles');
  const role = roles.find(item => item.id === query.get('role')) ?? roles[0];
  bindNavigation(role);
 } catch (error) {
  $('yaml-import-feedback').textContent=error.message;
 }
}
