import {randomUUID} from 'node:crypto';
import {roleFromYaml,roleYaml} from './core.mjs';

const sections=new Map([
 ['基本资料',{fields:{名字:'name',角色编号:'id'}}],
 ['人设',{path:'identity',fields:{年龄或人生阶段:'age_status',角色介绍:'self_description',常见场景:['scenes'],已确定的设定:['facts'],待确认的设定:['unknowns']}}],
 ['性格',{path:'personality',fields:{长期目标:['goals']}}],
 ['一条性格特点',{path:'personality.traits',repeat:true,fields:{特点:'trait',什么时候显现:'when',怎么反应:'behavior',什么时候调整:'reconsider'}}],
 ['相处方式',{path:'relationship',fields:{从怎样的关系开始:'start'}}],
 ['回复格式',{path:'reply_format',fields:{篇幅与节奏:'length',分段习惯:'paragraphs',说话语气:'dialogue',动作描写:'actions',何时收起语气或动作:'omit_when',输出形式:'internal'}}],
 ['一条补充表达',{path:'expression',repeat:true,fields:{遇到什么情况:'when',她怎么回应:'effect',什么时候换一种回应:'exception'}}],
 ['一条参考对话',{path:'examples',repeat:true,fields:{用户说:'user',角色答:'reply',为什么合适:'why'}}],
 ['一条反例对话',{path:'counterexamples',repeat:true,fields:{用户说:'user',角色答:'reply',问题在哪里:'why'}}],
 ['记忆边界',{path:'memory_boundary',fields:{关系与经历的起点:'start',如何区分来源:'attribution',如何处理更正:'correction'}}],
]);

const required=new Set(['名字','角色介绍','从怎样的关系开始']);
const prompts={
 名字:'角色叫什么名字？',角色编号:'想给角色指定什么编号？',年龄或人生阶段:'角色处在人生的哪个阶段？',
 角色介绍:'角色是谁？她平时做什么，为什么会和用户交流？',常见场景:'角色常出现在哪些场景？',
 已确定的设定:'哪些外形、背景或喜好已经确定？',待确认的设定:'还有哪些设定待确认？',长期目标:'角色长期想做成什么？',
 特点:'角色有哪些性格特点？',什么时候显现:'这个特点什么时候显现？',怎么反应:'当时会怎么反应？',什么时候调整:'什么时候会调整反应？',
 从怎样的关系开始:'角色和用户从怎样的关系开始？',篇幅与节奏:'她通常说多长？说话节奏怎样？',
 分段习惯:'她怎样分段？',说话语气:'她说话有什么独特的语气？',动作描写:'什么时候会用动作？动作怎么写？',
 何时收起语气或动作:'什么时候会收起特定语气或动作？',输出形式:'回复有特殊输出要求吗？',
 遇到什么情况:'在什么情境下，她会有特别的反应？',她怎么回应:'她会怎么回应？',什么时候换一种回应:'什么时候需要换一种回应？',
 用户说:'用户说了什么？',角色答:'角色怎么答？',为什么合适:'这段回答为什么合适？',问题在哪里:'这段回答的问题在哪里？',
 关系与经历的起点:'角色认识用户时，已经确认了哪些关系或经历？',如何区分来源:'不同来源的记忆该怎么区分？',如何处理更正:'角色怎样处理更正？',
};
const hints={
 名字:'填写应用里显示的角色名',
 角色编号:'选填，用小写字母、数字或短横线，首位为字母',
 年龄或人生阶段:'填写年龄或人生阶段，未确定可留空',
 角色介绍:'简单写下角色的身份、平时做什么，以及她为什么会和用户交流',
 常见场景:'填写经常出现的场合或活动，每行一项',
 已确定的设定:'填写已经确定的外形、背景或喜好，每行一项',
 待确认的设定:'写下尚未决定的细节，每行一项',
 长期目标:'填写角色长期想做成的事，每行一项',
 特点:'写一项稳定的性格倾向',
 什么时候显现:'写明什么情境会让这个特点表现出来',
 怎么反应:'写她会怎么想、怎么说或怎么做',
 什么时候调整:'写明什么变化会让她调整反应',
 从怎样的关系开始:'写下初识时的关系、称呼或主动程度，也可补充熟悉后的变化',
 篇幅与节奏:'说明平时说多长，哪些时候会多讲或少讲',
 分段习惯:'写下什么情况下分段，以及每段通常写多长',
 说话语气:'写下角色的用词、口气和表达情绪的习惯',
 动作描写:'说明在哪些场景写动作，以及动作如何融入回复',
 何时收起语气或动作:'填写哪些情境需要收起玩笑、动作或特定语气',
 输出形式:'填写需要固定遵循的输出形式，没有可留空',
 遇到什么情况:'写一个能触发角色特定反应的场景',
 她怎么回应:'说明角色在这个场景下怎么接话或行动',
 什么时候换一种回应:'写明出现什么例外时需要改变回应',
 用户说:'填写这段对话中用户说的话',
 角色答:'填写这段对话中角色的回复',
 为什么合适:'说明这句回复体现了角色的哪些特点',
 问题在哪里:'指出这句回复哪里偏离了设定',
 关系与经历的起点:'填写一开始就确认的关系或共同经历',
 如何区分来源:'说明如何区分角色亲历、用户转述和虚构设定',
 如何处理更正:'说明用户更新或纠正旧信息时，角色应以什么为准',
};

export function handwrittenQuestions(){
 return [...sections].map(([title,section])=>({
  title,repeat:Boolean(section.repeat),
  fields:Object.entries(section.fields).map(([label,key])=>({
   label,question:prompts[label],hint:hints[label],lines:Array.isArray(key),required:required.has(label),
  })),
 }));
}

function emptyRole(){
 return {schema_version:'1.0',avatar:'',identity:{age_status:'未指定'},personality:{},relationship:{},reply_format:{},memory_boundary:{}};
}
function addRepeatedSection(role,section,title,draft){
 if(Object.values(draft).every(value=>!value))return;
 for(const [field,key] of Object.entries(section.fields)){
  if(!draft[key])throw Error('「'+title+'」请填写「'+field+'」，或将整组留空');
 }
 const parts=section.path.split('.');
 const parent=parts.length===2?role[parts[0]]:role;
 (parent[parts.at(-1)]??=[]).push(draft);
}
function setAnswer(draft,descriptor,value){
 if(Array.isArray(descriptor))draft[descriptor[0]]=value.split(/\r\n?|\n/).map(line=>line.trim()).filter(Boolean);
 else draft[descriptor]=value;
}
function finalize(role){
 if(!role.id)role.id='role-'+randomUUID().replaceAll('-','');
 if(!role.identity.age_status)role.identity.age_status='未指定';
 for(const [value,display] of [[role.name,'名字'],[role.identity.self_description,'角色介绍'],[role.relationship.start,'从怎样的关系开始']]){
  if(!value)throw Error('请填写「'+display+'」');
 }
 return roleYaml(roleFromYaml(roleYaml(role)));
}

export function questionnaireToYaml(groups){
 if(!Array.isArray(groups)||groups.length>66)throw Error('手写问卷的栏目数量无效');
 const role=emptyRole(),seen=new Set();
 for(const group of groups){
  const section=sections.get(group?.title);
  const answers=group?.answers;
  if(!section||!answers||typeof answers!=='object'||Array.isArray(answers))throw Error('手写问卷包含无效栏目');
  if(!section.repeat&&seen.has(group.title))throw Error('「'+group.title+'」只能填写一次');
  seen.add(group.title);
  const draft=section.repeat?{}:section.path?role[section.path]:role;
  for(const [label,value] of Object.entries(answers)){
   if(!Object.hasOwn(section.fields,label)||typeof value!=='string')throw Error('手写问卷包含无效回答');
   setAnswer(draft,section.fields[label],value.trim());
  }
  if(section.repeat)addRepeatedSection(role,section,group.title,draft);
 }
 return finalize(role);
}

export function handwrittenToYaml(text){
 if(typeof text!=='string'||text.length>32_000)throw Error('手写稿最多 32,000 字符');
 const role=emptyRole();
 const seen=new Set();
 let section, title, draft, label, lines=[];
 const activeFields=new Set();
 function finishField(){
  if(!label)return;
  const descriptor=section.fields[label];
  setAnswer(draft,descriptor,lines.join('\n').trim());
  label=null;
  lines=[];
 }
 function finishSection(){
  finishField();
  if(section?.repeat)addRepeatedSection(role,section,title,draft);
 }
 for(const [index,line] of text.replace(/^\uFEFF/,'').split(/\r\n?|\n/).entries()){
  if(line.trimStart().startsWith('#'))continue;
  const heading=line.trim().match(/^【([^】]+)】$/);
  if(heading){
   finishSection();
   title=heading[1];
   section=sections.get(title);
   if(!section)throw Error('第 '+(index+1)+' 行的栏目「'+title+'」无法识别');
   if(!section.repeat&&seen.has(title))throw Error('「'+title+'」只能填写一次');
   seen.add(title);
   activeFields.clear();
   draft=section.repeat?{}:section.path?role[section.path]:role;
   continue;
  }
  const field=line.match(/^([^：:]+)[：:]\s*(.*)$/);
  if(field&&section&&Object.hasOwn(section.fields,field[1].trim())){
   finishField();
   label=field[1].trim();
   if(activeFields.has(label))throw Error('「'+title+'」里的「'+label+'」重复了');
   activeFields.add(label);
   if(field[2])lines.push(field[2]);
   continue;
  }
  if(label){lines.push(line);continue;}
  if(line.trim())throw Error('第 '+(index+1)+' 行请写在模板的栏目和字段下');
 }
 finishSection();
 return finalize(role);
}
