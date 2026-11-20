const $ = id => document.getElementById(id);
const profileLabels = new Set(['名字','角色编号','年龄或人生阶段']);

export function avatarData(file) {
 if (!file) return Promise.resolve(null);
 if (file.size > 2*1024*1024) return Promise.reject(Error('头像文件不能超过 2 MB'));
 return new Promise((resolve,reject)=>{
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(Error('无法读取头像'));
  reader.readAsDataURL(file);
 });
}

function textElement(tag,text) {
 const node = document.createElement(tag);
 node.textContent = text;
 return node;
}
function questionControl(field) {
 const control = document.createElement('textarea');
 control.maxLength = field.lines ? 24_000 : 1600;
 control.required = field.required;
 control.placeholder = field.hint;
 control.rows = 3;
 const label = document.createElement('label');
 label.append(textElement('span',field.question+(field.required?'（必填）':'')),control);
 if (field.lines) label.append(textElement('small','每行一项，最多 15 项'));
 return {label,control};
}
function questionnaire(sections) {
 const groups = new Set();
 const required = $('required-questions'), optional = $('optional-questions');
 function group(title) {
  const answers = new Map();
  const row = {title,answers};
  groups.add(row);
  return row;
 }
 function addQuestion(field,row,target) {
  const {label,control} = questionControl(field);
  row.answers.set(field.label,control);
  target.append(label);
 }
 for (const section of sections) {
  if (!section.repeat) {
   const row = group(section.title);
   for (const field of section.fields) {
    if (!profileLabels.has(field.label)) addQuestion(field,row,field.required ? required : optional);
   }
   continue;
  }
  const list = document.createElement('div');
  list.className = 'role-question-repeat role-questions';
  const add = textElement('button','添加'+section.title);
  add.type = 'button';
  add.className = 'role-secondary';
  add.onclick = () => {
   const row = group(section.title);
   const fields = textElement('fieldset','');
   fields.className = 'role-repeated role-questions';
   fields.append(textElement('legend',section.title));
   for (const field of section.fields) addQuestion(field,row,fields);
   const remove = textElement('button','移除这组问题');
   remove.type = 'button';
   remove.className = 'role-secondary';
   remove.onclick = () => {
    groups.delete(row);
    fields.remove();
    add.disabled=false;
    add.focus();
   };
   fields.append(remove);
   list.insertBefore(fields,add);
   add.disabled = list.children.length > 15;
   fields.querySelector('input,textarea').focus();
  };
  list.append(add);
  optional.append(list);
 }
 return ({name,id,age}) => [...groups].map(({title,answers})=>{
  const values = Object.fromEntries([...answers].map(([label,control])=>[label,control.value]));
  if (title==='基本资料') Object.assign(values,{名字:name,角色编号:id});
  if (title==='人设') values.年龄或人生阶段=age;
  return {title,answers:values};
 });
}

export function initRoleImport(api) {
 const yamlMode = $('show-yaml-import'), manualMode = $('show-manual-import');
 const form = $('role-import-form'), questions = $('role-questionnaire');
 const name = $('import-name'), id = $('import-id'), age = $('import-age');
 const avatar = $('import-avatar'), preview = $('import-avatar-preview'), save = $('save-import');
 const drafts = {yaml:{},manual:{}};
 let mode = 'yaml', readAnswers, loadingQuestions = false, busy = false, avatarUrl = '';

 function readProfile() {
  return {name:name.value.trim(),id:id.value.trim(),age:age.value.trim()};
 }
 function showProfile(profile = {}) {
  name.value = profile.name ?? '';
  id.value = profile.id ?? '';
  age.value = profile.age ?? '';
 }
 function showAvatar() {
  const stored = drafts[mode].card?.avatar;
  preview.src = avatarUrl || (stored ? '/'+stored : '/default.svg');
 }
 preview.onerror = () => {
  if (!preview.src.endsWith('/default.svg')) preview.src = '/default.svg';
 };
 avatar.onchange = () => {
  if (avatarUrl) URL.revokeObjectURL(avatarUrl);
  const file = avatar.files[0];
  avatarUrl = file ? URL.createObjectURL(file) : '';
  $('avatar-import-feedback').textContent = file?.size > 2*1024*1024 ? '头像文件不能超过 2 MB' : '';
  showAvatar();
 };
 function updateForm() {
  const draft = drafts[mode], manual = mode==='manual';
  const writing = manual && !draft.card && Boolean(readAnswers);
  questions.hidden = !writing;
  for (const input of questions.querySelectorAll('input,textarea')) input.disabled = !writing;
  id.required = Boolean(draft.card);
  $('return-to-questionnaire').hidden = !drafts.manual.card;
  $('import-footer').hidden = manual && !draft.card && !writing;
  $('yaml-create-hint').hidden = manual || Boolean(draft.card);
  save.disabled = !draft.card && !writing;
  save.textContent = manual && draft.card ? '确认导入' : '创建角色';
  showAvatar();
 }

 async function showMode(next) {
  if (busy) return;
  drafts[mode].profile = readProfile();
  mode = next;
  const manual = mode==='manual';
  showProfile(drafts[mode].profile);
  yamlMode.setAttribute('aria-pressed',String(!manual));
  manualMode.setAttribute('aria-pressed',String(manual));
  $('yaml-import').hidden = manual;
  $('manual-import').hidden = !manual;
  $('question-save-feedback').textContent = '';
  updateForm();
  if (!manual || readAnswers || loadingQuestions) return;
  loadingQuestions = true;
  const feedback = $('question-load-feedback');
  feedback.textContent = '正在读取问卷…';
  try {
   readAnswers = questionnaire(await api('/api/template/handwritten?format=questions'));
   updateForm();
   feedback.textContent = '';
  } catch(error) { feedback.textContent = error.message; }
  finally { loadingQuestions = false; }
 }
 yamlMode.onclick = () => showMode('yaml');
 manualMode.onclick = () => showMode('manual');
 $('return-to-questionnaire').onclick = () => {
  if (busy) return;
  drafts.manual.card = null;
  $('txt-import-feedback').textContent = '';
  $('question-save-feedback').textContent = '';
  updateForm();
 };

 async function perform(action,feedback,trigger,message) {
  if (busy) return;
  busy = true;
  trigger.disabled = true;
  feedback.textContent = message;
  try { await action(); }
  catch(error) {
   feedback.textContent = error.message;
   feedback.dataset.tone = 'error';
  } finally {
   busy = false;
   trigger.disabled = false;
  }
 }
 async function convert(input) {
  return (await api('/api/template/convert',input)).yaml;
 }
 function bindFile(buttonId,inputId,feedbackId,maxLength,convertText) {
  const button = $(buttonId), input = $(inputId);
  button.onclick = () => { if (!busy) input.click(); };
  input.onchange = () => {
   const file = input.files[0];
   input.value = '';
   if (!file) return;
   const feedback = $(feedbackId);
   const draft = drafts[mode];
   void perform(async () => {
    if (file.size>maxLength*4) throw Error('角色卡文件过大');
    const text = await file.text();
    if (text.length>maxLength) throw Error('角色卡文件内容过长');
    const yaml = await convertText(text);
    const {card} = await api('/api/role-card',{yaml});
    draft.card = card;
    showProfile({name:card.name,id:card.id,age:card.identity.age_status});
    $('question-save-feedback').textContent = '';
    feedback.dataset.tone = 'success';
    feedback.textContent = '已读取 '+file.name;
    updateForm();
   },feedback,button,'正在读取角色卡…');
  };
 }
 bindFile('upload-yaml','yaml-file','yaml-import-feedback',24_000,text=>text);
 bindFile('upload-txt','txt-file','txt-import-feedback',32_000,text=>convert({text}));
 form.addEventListener('invalid',event=>{
  const optional = event.target.closest('details');
  if (optional) optional.open = true;
 },true);
 form.onsubmit = event => {
  event.preventDefault();
  const draft = drafts[mode];
  if (!draft.card && (mode!=='manual' || !readAnswers)) return;
  const profile = readProfile();
  const file = avatar.files[0];
  const feedback = $('question-save-feedback');
  void perform(async () => {
   const picture = await avatarData(file);
   const card = draft.card;
   let yaml;
   if (card) {
    const updated = {...card,name:profile.name,id:profile.id,identity:{...card.identity,age_status:profile.age||'未指定'}};
    yaml = (await api('/api/role-card',{card:updated})).yaml;
   } else yaml = await convert({answers:readAnswers(profile)});
   const saved = await api('/api/roles',{yaml,avatar:picture});
   location.assign('/?role='+encodeURIComponent(saved.id));
  },feedback,save,'正在保存角色…');
 };
 updateForm();
}
