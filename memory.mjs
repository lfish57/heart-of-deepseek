import {randomUUID} from 'node:crypto';

const statuses=new Set(['pending','completed','cancelled']);
const terms=text=>new Set((String(text).toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]{2,}/gu)||[])
 .flatMap(word=>{
  if(!/^[\p{Script=Han}]+$/u.test(word))return [word];
  const chars=Array.from(word);
  return chars.slice(1).map((char,i)=>chars[i]+char);
 }));
function score(text,wanted){return [...terms(text)].filter(term=>wanted.has(term)).length;}
function clip(row){
 return {source:row.source,at:row.at,user:row.input.slice(0,360),role:row.answer.slice(0,360)};
}
function dayWindow(text,now){
 const match=text.match(/([上本这])(?:个)?(?:周|星期|礼拜)([一二三四五六日天])?|前天|昨天|今天/);
 if(!match)return null;
 const label=match[0];
 const [,relative,weekday]=match;
 const weekdayIndex=weekday?'一二三四五六日'.indexOf(weekday==='天'?'日':weekday):0;
 const offset=relative?(now.getDay()+6)%7+(relative==='上'?7:0)-weekdayIndex:{今天:0,昨天:1,前天:2}[label];
 const [year,month,date]=[now.getFullYear(),now.getMonth(),now.getDate()-offset];
 return {label,start:new Date(year,month,date).toISOString(),end:new Date(year,month,date+(relative&&!weekday?7:1)).toISOString()};
}
const datePart='(?:[上下](?:个)?(?:周|星期|礼拜)[一二三四五六日天]?|(?:周|星期|礼拜)[一二三四五六日天]|今天|明天|后天|下个月|[0-9一二三四五六七八九十]{1,3}月[0-9一二三四五六七八九十]{1,3}[日号])';
const periodPart='(?:上午|中午|下午|晚上|凌晨)';
const clockPart='(?:[0-9一二两三四五六七八九十]{1,3}(?:点(?:半|整|[0-9一二两三四五六七八九十]{1,3}分)?|[：:][0-5]\\d))';
const timePattern=new RegExp('(?<date>'+datePart+')(?:\\s*(?<period>'+periodPart+'))?(?:\\s*(?<clock>'+clockPart+'))?|(?<timePeriod>'+periodPart+')(?:\\s*(?<timeClock>'+clockPart+'))?|(?<clockOnly>'+clockPart+')');
function schedule(text){
 const match=String(text??'').match(timePattern);
 const fields=match?.groups??{};
 return {date:fields.date??'',period:fields.period??fields.timePeriod??'',clock:fields.clock??fields.timeClock??fields.clockOnly??''};
}
function timing(text){return text.match(timePattern)?.[0]??'';}
function formatSchedule(value){return value.date+value.period+value.clock;}
function revisedSchedule(previous,next){
 const hour=Number(next.clock.match(/^\d+/)?.[0]);
 if(Number.isFinite(hour)&&(hour>23||next.period&&hour>12))return null;
 const absoluteClock=/^[0０][：:]/.test(next.clock)||hour>12;
 const replacesWithPeriod=next.period&&next.period!==previous.period&&!next.clock;
 return {date:next.date||previous.date,period:absoluteClock?'':next.period||previous.period,clock:replacesWithPeriod?'':next.clock||previous.clock};
}
function soundsLikePlan(fact,due){
 return Boolean(due&&/(?:一起|见面|接着|再聊|约好|碰面)/.test(fact));
}
const agreementJoins=alias=>`
 LEFT JOIN memory_details d ON d.role_id=${alias}.role_id AND d.topic=${alias}.topic AND d.revision=${alias}.revision
 LEFT JOIN agreement_keys k ON k.role_id=${alias}.role_id AND k.memory_key=${alias}.topic
 LEFT JOIN agreement_times t ON t.role_id=${alias}.role_id AND t.memory_key=${alias}.topic AND t.revision=${alias}.revision`;
const memoryFields=alias=>`${alias}.topic AS memoryKey,COALESCE(k.display_topic,${alias}.topic) AS topic,
 ${alias}.fact,${alias}.source,${alias}.revision,${alias}.at,d.kind,d.state,d.when_text AS due,k.agreement_id AS agreementId,
 t.date_text AS date,t.period_text AS period,t.clock_text AS clock`;
const lookupSQL=`SELECT ${memoryFields('m')} FROM memories m ${agreementJoins('m')}`;
function publicMemory(row){
 const {memoryKey,kind,state,due,agreementId,date,period,clock,...base}=row;
 if(agreementId)base.agreementId=agreementId;
 return kind?{...base,kind,state,due,schedule:date===null?schedule(due):{date,period,clock}}:base;
}

// Expand a selected fragment to its sentence. A fragment that drops a qualifier
// is discarded so an affirmative-looking candidate cannot reach the review UI.
const qualifier=/没有|并未|未曾|不曾|没能|没一起|不是|不确定|可能|也许|或许|似乎|好像|如果|假设|要是|只是|仅仅/;
function sentenceQuote(text,quote){
 const start=text.indexOf(quote);
 if(start<0||text.indexOf(quote,start+1)!==-1)return null;
 const end=start+quote.length;
 const before=text.slice(0,start).search(/[^。！？!?；;\n]*$/);
 const tail=text.slice(end);
 const after=/[。！？!?；;\n]$/.test(quote)?-1:tail.search(/[。！？!?；;\n]/);
 const stop=after<0?(/[。！？!?；;\n]$/.test(quote)?end:text.length):end+after+1;
 const result=text.slice(before,stop).trim();
 if(qualifier.test(text.slice(before,start))||qualifier.test(text.slice(end,stop)))return null;
 return result.length<=800?result:null;
}
export function mayBeExperience(text){
 return text.length>=10&&!/^(?:没工作|不知道)|假设|如果我们|要是我们|假如|小说里|剧情里/.test(text)&&
 /一起.{0,28}(?:完成|做完|做了|看完|赢了|去了|度过|解决|拼好)|(?:送给你|专门给你做|这件事很重要|误会解开|和好了|我们刚刚|我们刚才)/.test(text);
}

const undecided=/(?:如果|假设|要是|要不|备选|候选时间|暂定|未定|还没决定|还没定|没说定|不一定|可能|能不能改|要不要改|可以吗|行不行|好不好|怎么样|有空吗|先别记|不用记|不要记|别记下)/;
function agreementTopic(fact,due){
 const action=(due?fact.replace(due,''):fact)
  .replace(/^[，、,：:\s]*(?:(?:到时候|届时|我们|咱们|大家|一起|接着|继续|再)[，、,\s]*)+/,'')
  .replace(/^[，、,：:\s]+|[，。！!\s]+$/g,'');
 return (action||fact).slice(0,80);
}
export function memoryCommand(text){
 const create=text.match(/^(?:请[你帮我]*)?(?:帮我)?记住(?:这个)?(?:约定|这件事)?[：:,，]\s*(.+)$/s);
 const agreement=/记住(?:这个)?约定/.test(create?.[0]??'');
 if(create&&(!(agreement||soundsLikePlan(create[1],timing(create[1])))||!undecided.test(create[1])))return {action:'save',text:create[1],agreement};
 if(undecided.test(text))return null;
 const state=text.match(/^(?:把[「『“](.+?)[」』”](?:标记为|设为)|(?:这个)?约定(?:已经|已|要)?)(完成|取消)[。！!]?$/);
 if(state)return {action:'state',topic:state[1],label:state[2]};
 const change=text.match(/^(?:把[「『“](.+?)[」』”]|把这个约定|把约定|约定)\s*(?:改到|改成|改为|移到)\s*(.+)$/s);
 const reschedule=text.match(/^改期(?:[：:]|改到|改为|到|\s+)\s*(.+)$/s);
 if((change||reschedule)&&!/[？?]$/.test(text))return {action:'reschedule',topic:change?.[1],text:change?.[2]??reschedule[1]};
 const naturalChange=text.match(/^(?:那(?:就)?[，,、\s]*)?(?:把)?(.{0,34}?)(?:改到|挪到|推到)(.{1,100})$/s);
 if(naturalChange&&!/[？?]$/.test(text)&&timing(naturalChange[2])){
  const name=naturalChange[1].trim().replace(/(?:的)?约定$/,'');
  const topic=/^(?:我们|咱们|这个|这件事|那件事|原来的)?$/.test(name)?undefined:name;
  return {action:'reschedule',topic,text:naturalChange[2],natural:true};
 }
 const prefix=text.match(/^(?:(?:可以|能不能)(?:帮我)?|麻烦你|请你?|帮我|给我|替我)?(?:记住|记一下|记下(?:来)?|别忘了)(?:这个约定)?[，,：:\s]*(.+)$/s);
 const suffix=text.match(/^(.+?)[，,、\s]+(?:(?:你|帮我|麻烦你)?(?:记住|记一下|记下(?:来)?|别忘了)|就这么(?:说)?定了)(?:哦|呀|吧|哈|喔|啦)?[。！!?？]*$/s);
 const settled=text.match(/^(?:那就|我们就|咱们就|就)(?:约在?|定(?:在|到|了)?)[，,：:\s]*(.+?)[。！!]*$/s);
 const fact=(prefix?.[1]??suffix?.[1]??settled?.[1])?.trim().replace(/[。！!？?]+$/,'');
 const due=fact&&timing(fact);
 if(!due||fact.replace(due,'').replace(/[，。！\s]/g,'').length<2)return null;
 if(settled&&/[？?]$/.test(text))return null;
 return {action:'save',text:fact,agreement:true};
}

export class MemoryStore {
 constructor(db){
  this.db=db;
  db.exec(`
   CREATE TABLE IF NOT EXISTS memory_details(
    role_id TEXT NOT NULL, topic TEXT NOT NULL, revision INTEGER NOT NULL,
    kind TEXT NOT NULL, state TEXT NOT NULL, when_text TEXT NOT NULL,
    PRIMARY KEY(role_id,topic,revision),
    FOREIGN KEY(role_id,topic,revision) REFERENCES memory_revisions(role_id,topic,revision));
   CREATE TABLE IF NOT EXISTS agreement_keys(
    role_id TEXT NOT NULL, memory_key TEXT NOT NULL, agreement_id TEXT NOT NULL, display_topic TEXT NOT NULL,
    PRIMARY KEY(role_id,memory_key), UNIQUE(role_id,agreement_id),
    FOREIGN KEY(role_id,memory_key) REFERENCES memories(role_id,topic));
   CREATE TABLE IF NOT EXISTS agreement_times(
    role_id TEXT NOT NULL, memory_key TEXT NOT NULL, revision INTEGER NOT NULL,
    date_text TEXT NOT NULL, period_text TEXT NOT NULL, clock_text TEXT NOT NULL,
    PRIMARY KEY(role_id,memory_key,revision),
    FOREIGN KEY(role_id,memory_key,revision) REFERENCES memory_revisions(role_id,topic,revision));
   INSERT OR IGNORE INTO agreement_keys
    SELECT d.role_id,d.topic,lower(hex(randomblob(16))),d.topic
    FROM memory_details d JOIN memories m ON m.role_id=d.role_id AND m.topic=d.topic
    WHERE d.kind='agreement' AND NOT EXISTS (SELECT 1 FROM agreement_keys k WHERE k.role_id=d.role_id AND k.memory_key=d.topic)
    GROUP BY d.role_id,d.topic;
   CREATE TABLE IF NOT EXISTS memory_experiences(
    role_id TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL,
    title TEXT, user_quote TEXT, role_quote TEXT, at TEXT NOT NULL,
    PRIMARY KEY(role_id,source),
    FOREIGN KEY(role_id,source) REFERENCES turns(role_id,request_id));
   CREATE INDEX IF NOT EXISTS memory_experiences_queue ON memory_experiences(state,at);
   CREATE INDEX IF NOT EXISTS memory_turn_recall ON turns(role_id,status,created_at);
  `);
 }
 list(id){
  return this.db.prepare(lookupSQL+' WHERE m.role_id=? ORDER BY m.at DESC LIMIT 100').all(id).map(publicMemory);
 }
 agreements(id){
  return this.db.prepare(lookupSQL+" WHERE m.role_id=? AND d.kind='agreement' ORDER BY m.at DESC LIMIT 100").all(id).map(publicMemory);
 }
 getTurn(id,source){
  return this.db.prepare("SELECT request_id AS source,input,answer,created_at AS at FROM turns WHERE role_id=? AND request_id=? AND status='complete'").get(id,source);
 }
 agreementKey(id,agreementId){
  return this.db.prepare('SELECT memory_key,display_topic FROM agreement_keys WHERE role_id=? AND agreement_id=?').get(id,agreementId);
 }
 revisions(id,topic,agreementId){
  const key=agreementId?this.agreementKey(id,agreementId)?.memory_key:this.resolveTopicKey(id,topic);
  if(!key)return [];
  return this.db.prepare(`SELECT ${memoryFields('r')} FROM memory_revisions r ${agreementJoins('r')}
   WHERE r.role_id=? AND r.topic=? ORDER BY r.revision DESC LIMIT 100`).all(id,key)
   .map(row=>({...publicMemory(row),original:this.getTurn(id,row.source)??null}));
 }
 resolveTopicKey(id,topic){
  const keys=this.db.prepare(`SELECT m.topic AS key,k.agreement_id AS agreementId FROM memories m LEFT JOIN agreement_keys k
   ON k.role_id=m.role_id AND k.memory_key=m.topic WHERE m.role_id=? AND COALESCE(k.display_topic,m.topic)=?
   ORDER BY k.agreement_id IS NOT NULL LIMIT 2`).all(id,topic);
  if(keys.length>1&&keys[0].agreementId)throw Error('有多条同主题记忆，请指定约定编号');
  return keys[0]?.key;
 }
 remember(id,input){
  const {topic,fact,source,kind,state,due,agreementId,newAgreement}=input;
  if(typeof topic!=='string'||!topic.trim()||topic.length>80||typeof fact!=='string'||!fact.trim()||fact.length>600)throw Error('记忆主题和事实分别最多 80 和 600 字');
  this.db.exec('SAVEPOINT store_memory');
  try{
   const result=this.write(id,{topic:topic.trim(),fact:fact.trim(),source,kind,state,due,agreementId,newAgreement});
   this.db.exec('RELEASE store_memory');
   return result;
  }catch(error){
   this.db.exec('ROLLBACK TO store_memory; RELEASE store_memory');
   throw error;
  }
 }
 write(id,{topic,fact,source,kind,state,due,agreementId,newAgreement}){
  if(source&&!this.db.prepare('SELECT 1 FROM turns WHERE role_id=? AND request_id=?').get(id,source))throw Error('引用消息不属于当前角色');
  const explicit=agreementId?this.agreementKey(id,agreementId):null;
  if(agreementId&&(!explicit||explicit.display_topic!==topic))throw Error('找不到当前角色的约定');
  const previousKey=explicit?.memory_key??(newAgreement&&kind==='agreement'?null:this.resolveTopicKey(id,topic));
  const old=previousKey?this.db.prepare(lookupSQL+' WHERE m.role_id=? AND m.topic=?').get(id,previousKey):null;
  const type=kind??old?.kind??'fact';
  if(!['fact','agreement'].includes(type))throw Error('记忆类型无效');
  const status=type==='agreement'?(state??old?.state??'pending'):'';
  const when=type==='agreement'?(due??(old?.fact===fact?old.due:timing(fact))??''):'';
  if(type==='agreement'&&(!statuses.has(status)||typeof when!=='string'||when.length>80))throw Error('约定状态或时间无效');
  if(old?.fact===fact&&(old.kind??'fact')===type&&(old.state??'')===status&&(old.due??'')===when&&(!source||old.source===source))return publicMemory(old);
  const identity=old?.agreementId??(type==='agreement'?randomUUID().replaceAll('-',''):null);
  const key=previousKey??(identity?'@agreement/'+identity:topic);
  const rec={topic,fact,source:source||'manual:'+randomUUID(),revision:(old?.revision??0)+1,at:new Date().toISOString()};
  this.db.prepare('INSERT INTO memory_revisions VALUES(?,?,?,?,?,?)').run(id,key,rec.revision,fact,rec.source,rec.at);
  this.db.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?) ON CONFLICT(role_id,topic) DO UPDATE SET fact=excluded.fact,source=excluded.source,revision=excluded.revision,at=excluded.at').run(id,key,fact,rec.source,rec.revision,rec.at);
  if(identity&&!old?.agreementId)this.db.prepare('INSERT INTO agreement_keys VALUES(?,?,?,?)').run(id,key,identity,topic);
  if(identity)rec.agreementId=identity;
  if(type!=='agreement')return rec;
  const time=schedule(when);
  this.db.prepare('INSERT INTO memory_details VALUES(?,?,?,?,?,?)').run(id,key,rec.revision,type,status,when);
  this.db.prepare('INSERT INTO agreement_times VALUES(?,?,?,?,?,?)').run(id,key,rec.revision,time.date,time.period,time.clock);
  return {...rec,kind:type,state:status,due:when,schedule:time};
 }
 matchingAgreements(id,intent){
  const name=intent.topic?.trim();
  const entries=this.agreements(id);
  if(!name)return entries.filter(item=>item.state==='pending');
  const exact=entries.filter(item=>item.topic===name);
  if(exact.length)return exact;
  const due=schedule(name);
  const time=formatSchedule(due);
  const title=time?name.replace(timing(name),'').replace(/^[的\s，、]+|的$/g,'').trim():name;
  return title.length>=2&&(time||intent.natural)?entries.filter(item=>
   (time?(Object.keys(due).every(key=>!due[key]||item.schedule[key]===due[key])):item.state==='pending')&&
   (item.topic===title||intent.natural&&(item.topic.includes(title)||item.fact.includes(title)))):[];
 }
 command(id,intent,source){
  if(intent.action==='save'){
   const [first,...rest]=intent.text.split(/[｜|]/);
   const fact=(rest.length?rest.join('｜'):first).trim();
   const due=timing(fact);
   const isPlan=intent.agreement||soundsLikePlan(fact,due);
   const kind=isPlan?'agreement':'fact';
   const topic=rest.length?first.trim():isPlan?agreementTopic(fact,due):fact.slice(0,80);
   const same=isPlan&&due&&this.agreements(id).find(item=>item.topic===topic&&item.due===due&&item.state==='pending'&&(!rest.length||item.fact===fact));
   const saved=same||this.remember(id,{topic,fact,source,kind,state:isPlan?'pending':undefined,due,newAgreement:isPlan});
   return '记下了。'+saved.topic+(saved.topic===saved.fact?'':'：'+saved.fact);
  }
  const matches=this.matchingAgreements(id,intent);
  if(matches.length>1)return '你指哪条约定？'+matches.slice(0,4).map(item=>[item.due,item.topic].filter(Boolean).join(' ')).join('、')+'。可以带上原定时间。';
  if(!matches.length)return '还没找到这条约定。可以先到记忆库保存，或用「记住约定：主题｜内容」。';
  const previous=matches[0];
  if(intent.action==='state'){
   const status=intent.label==='完成'?'completed':'cancelled';
   this.remember(id,{...previous,source,state:status});
   return '「'+previous.topic+'」已标记'+intent.label+'。';
  }
  const next=intent.text.trim().replace(/[。！!]$/,'');
  const requested=schedule(next);
  if(!formatSchedule(requested))return '请再说一下改到哪一天或几点。';
  const previousTime=previous.due||timing(previous.fact);
  const originalSchedule=previous.schedule??schedule(previousTime);
  const combined=revisedSchedule(originalSchedule,requested);
  if(!combined||previousTime&&!formatSchedule(originalSchedule)&&(!requested.date||!requested.clock))return '请补充改期后的日期和钟点，我再记下来。';
  const due=formatSchedule(combined);
  const fact=previousTime&&previous.fact.includes(previousTime)?previous.fact.replace(previousTime,due):previous.fact+'。新时间：'+due;
  this.remember(id,{...previous,fact,source,state:'pending',due});
  return '「'+previous.topic+'」已改到'+due+'。';
 }
 context(id,query,exclude='',now=new Date()){
  const rows=this.db.prepare("SELECT request_id AS source,input,answer,created_at AS at FROM turns WHERE role_id=? AND request_id<>? AND status='complete' ORDER BY rowid DESC LIMIT 2000").all(id,exclude);
  const wanted=terms(query);
  const ranked=(items,text)=>items.map(row=>({row,score:score(text(row),wanted)})).sort((a,b)=>b.score-a.score);
  const original=/原话|原句|逐字|最开始|最初|当初|怎么说的|哪句/.test(query);
  const window=dayWindow(query,now);
  if(window&&(original||/(?:聊|说|提|发生)(?:了|过|到)什么|(?:聊|说|提|发生)过/.test(query))){
   const pool=this.db.prepare(`SELECT request_id AS source,input,answer,created_at AS at FROM turns
    WHERE role_id=? AND request_id<>? AND status='complete' AND created_at>=? AND created_at<? ORDER BY rowid DESC LIMIT 200`).all(id,exclude,window.start,window.end);
   const evidence=ranked(pool,row=>row.input+' '+row.answer).slice(0,4)
    .map(({row})=>({...clip(row),user:row.input.slice(0,800),role:row.answer.slice(0,800)}));
   return {facts:[],summary:[],recent:[],originalTurns:evidence,originalWindow:window};
  }
  const summary=ranked(rows.slice(6),row=>row.input+' '+row.answer).filter(x=>x.score>=2).slice(0,5)
   .map(({row})=>({source:row.source,userExcerpt:row.input.slice(0,120),roleExcerpt:row.answer.slice(0,120)}));
  const facts=this.list(id).filter(m=>m.kind!=='agreement'&&score(m.topic+' '+m.fact,wanted)>0).slice(0,12);
  const recent=rows.slice(0,6).reverse().map(clip);
  const context={facts,summary,recent};
  const agreementQuery=/约定|约好|说好|改期|原定|定在|约的是/.test(query);
  const matches=ranked(this.agreements(id),item=>item.topic+' '+item.fact);
  const named=matches.filter(item=>item.score>=2);
  const selected=agreementQuery?(named.length?named:matches.filter(item=>original||item.row.state==='pending')):named;
  if(selected.length){
   const related=selected.slice(0,5).map(item=>item.row);
   context.agreements={ambiguous:related.length>1&&(!selected[0].score||selected[0].score===selected[1].score),items:related};
   if(original)context.agreementOrigins=related.map(item=>{
    const oldest=this.db.prepare("SELECT source,fact,at FROM memory_revisions WHERE role_id=? AND topic=? ORDER BY revision LIMIT 1").get(id,this.agreementKey(id,item.agreementId).memory_key);
    return {topic:item.topic,first:oldest,original:this.getTurn(id,oldest.source)?.input??null};
   });
  }
  if(original){
   const evidence=ranked(rows,row=>row.input+' '+row.answer).filter(item=>item.score>0).slice(0,4)
    .map(({row})=>({...clip(row),user:row.input.slice(0,800),role:row.answer.slice(0,800)}));
   if(evidence.length)context.originalTurns=evidence;
  }
  if(wanted.size){
   const experiences=ranked(this.experiences(id,'confirmed'),e=>e.title+' '+e.user_quote+' '+e.role_quote)
    .filter(x=>x.score>=2).slice(0,4).map(x=>x.row);
   if(experiences.length)context.experiences=experiences;
  }
  return context;
 }
 enqueue(id,source){
  this.db.prepare(`INSERT OR IGNORE INTO memory_experiences(role_id,source,state,at)
   SELECT role_id,request_id,'queued',created_at FROM turns WHERE role_id=? AND request_id=? AND status='complete'`).run(id,source);
 }
 next(){
  return this.db.prepare("SELECT role_id,source FROM memory_experiences WHERE state='queued' ORDER BY at LIMIT 1").get();
 }
 finishExperience(id,source,proposed){
  const turn=this.getTurn(id,source);
  const bounded=(text,min,max)=>typeof text==='string'&&text.trim().length>=min&&text.length<=max;
  const userQuote=turn&&bounded(proposed?.userQuote,4,360)?sentenceQuote(turn.input,proposed.userQuote):null;
  const roleQuote=turn&&bounded(proposed?.roleQuote,4,360)?sentenceQuote(turn.answer,proposed.roleQuote):null;
  const valid=bounded(proposed?.title,2,80)&&userQuote&&roleQuote;
  const result=this.db.prepare("UPDATE memory_experiences SET state=?,title=?,user_quote=?,role_quote=? WHERE role_id=? AND source=? AND state='queued'")
   .run(valid?'candidate':'skipped',valid?proposed.title.trim():null,valid?userQuote:null,valid?roleQuote:null,id,source);
  return Boolean(valid&&result.changes);
 }

 experiences(id,state){
  const sql=`SELECT source,state,title,user_quote,role_quote,at FROM memory_experiences WHERE role_id=? AND `;
  return state?this.db.prepare(sql+'state=? ORDER BY at DESC LIMIT 100').all(id,state):
   this.db.prepare(sql+"state IN ('confirmed','candidate') ORDER BY at DESC LIMIT 100").all(id);
 }
 review(id,source,state){
  if(!['confirmed','dismissed'].includes(state))throw Error('请选择确认或忽略');
  const result=this.db.prepare("UPDATE memory_experiences SET state=? WHERE role_id=? AND source=? AND (state='candidate' OR state=?)").run(state,id,source,state);
  if(!result.changes)throw Error('找不到待确认的经历');
 }
}
