import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store,ask,proposeExperience,ENDPOINT,MODEL} from '../core.mjs';
import {memoryCommand,mayBeExperience} from '../memory.mjs';

function setup(t){
 const store=new Store(':memory:');
 t.after(()=>store.close());
 store.saveRole({id:'xiaoyu',name:'鲸之心'});
 store.saveRole({id:'paper-cat',name:'纸月'});
 return store;
}
function record(store,text,answer='知道了。',id='xiaoyu'){
 const source=randomUUID();
 store.begin(id,source,text,null);
 store.finish(id,source,answer);
 return source;
}

test('agreement creation, vague recall, revisions and original quotes stay scoped to their role',t=>{
 const store=setup(t);
 const create='记住约定：聊小说｜周三晚上八点聊最后一章';
 const source=record(store,create);
 assert.match(store.memory.command('xiaoyu',memoryCommand(create),source),/周三晚上八点/);
 assert.deepEqual(memoryCommand('约定改到周三晚上十点可以吗？'),null);
 assert.deepEqual(memoryCommand('约定周三开会意味着什么'),null);
 const edit='把『聊小说』改到周三晚上九点';
 const correction=record(store,edit);
 store.memory.command('xiaoyu',memoryCommand(edit),correction);
 const recall=store.context('xiaoyu','上次咱们说好什么时候来着？','new');
 assert.equal(recall.agreements.items[0].due,'周三晚上九点');
 assert.equal(recall.agreements.items[0].fact,'周三晚上九点聊最后一章');
 const original=store.context('xiaoyu','聊小说的约定最开始怎么说的？','new');
 assert.equal(original.agreementOrigins[0].original,create);
 const versions=store.memory.revisions('xiaoyu','聊小说');
 assert.deepEqual(versions.map(r=>r.revision),[2,1]);
 assert.equal(versions[0].original.input,edit);
 assert.equal(versions[1].original.input,create);
 assert.deepEqual(store.memory.revisions('paper-cat','聊小说'),[]);
 const extra='记住约定：散步｜周五下午三点去河边';
 store.memory.command('xiaoyu',memoryCommand(extra),record(store,extra));
 assert.equal(store.context('xiaoyu','上次说好什么时候？','new').agreements.ambiguous,true);
 const done='把『聊小说』标记为完成';
 store.memory.command('xiaoyu',memoryCommand(done),record(store,done));
 assert.equal(store.memories('xiaoyu').find(m=>m.topic==='聊小说').state,'completed');
 assert.deepEqual(store.context('xiaoyu','上次说好什么时候？','new').agreements.items.map(m=>m.topic),['散步']);
 assert.doesNotMatch(JSON.stringify(store.context('paper-cat','聊小说的约定是什么？','new')),/周三/);
});

test('natural reminders save concrete agreements and tentative wording stays conversational',t=>{
 const store=setup(t);
 for(const question of [
  '周三晚上八点我们接着聊小说，可以吗？',
  '如果我们周三晚上八点聊小说，先记一下。',
  '还没定，周三晚上八点接着聊小说，别忘了。',
  '先别记，咱们周三晚上八点聊小说。',
  '聊小说改到周三晚上九点可以吗',
  '那就定在周三晚上八点聊小说？',
 ])assert.equal(memoryCommand(question),null,question);
 for(const wording of [
  '周三晚上八点我们接着聊小说，记一下哦。',
  '帮我记一下周三晚上八点接着聊小说。',
  '那就定了，周三晚上八点咱们继续聊小说。',
 ]){
  const intent=memoryCommand(wording);
  assert.equal(intent.agreement,true,wording);
  store.memory.command('xiaoyu',intent,record(store,wording));
  assert.equal(store.memories('xiaoyu').length,1);
  assert.equal(store.memories('xiaoyu')[0].topic,'聊小说');
 }
 const reschedule='聊小说改到周日下午吧。';
 const intent=memoryCommand(reschedule);
 assert.equal(store.memory.matchingAgreements('xiaoyu',intent).length,1);
 assert.equal(store.memory.matchingAgreements('paper-cat',intent).length,0);
 assert.match(store.memory.command('xiaoyu',intent,record(store,reschedule)),/周日下午/);
 assert.equal(store.memory.agreements('xiaoyu')[0].due,'周日下午');
 const origins=store.context('xiaoyu','聊小说最初约定的原话','next').agreementOrigins;
 assert.equal(origins[0].original,'周三晚上八点我们接着聊小说，记一下哦。');
});

test('same-topic agreement instances keep independent times and revisions',t=>{
 const store=setup(t);
 const id='xiaoyu';
 const chat=text=>store.memory.command(id,memoryCommand(text),record(store,text));
 chat('周三晚上八点我们一起散步，记一下哦。');
 chat('周五晚上九点我们一起散步，记一下哦。');
 assert.equal(memoryCommand('周三晚上八点散步只是备选，记一下哦。'),null);
 assert.match(chat('散步改到周六吧。'),/哪条/);
 assert.match(chat('周三的散步改到十点。'),/周三晚上十点/);
 assert.match(chat('周三的散步改到周四。'),/周四晚上十点/);
 const records=store.memories(id);
 const updated=records.find(m=>m.due==='周四晚上十点');
 const unchanged=records.find(m=>m.due==='周五晚上九点');
 assert.ok(updated&&unchanged&&updated.agreementId!==unchanged.agreementId);
 assert.deepEqual(store.memory.revisions(id,null,updated.agreementId).map(r=>r.due),['周四晚上十点','周三晚上十点','周三晚上八点']);
 assert.equal(store.memory.revisions(id,null,unchanged.agreementId).length,1);
 assert.deepEqual(store.memory.revisions('paper-cat',null,updated.agreementId),[]);
});

test('explicit day ranges and quotes select source messages using the local timezone',t=>{
 const store=setup(t);
 const wanted=record(store,'我在图书馆看到一个旧书签。','那张书签上有一只鲸鱼。');
 const other=record(store,'我在公园看到一个旧书签。');
 const set=store.db.prepare('UPDATE turns SET created_at=? WHERE request_id=?');
 set.run(new Date(2026,10,19,11).toISOString(),wanted);
 set.run(new Date(2026,10,20,11).toISOString(),other);
 const scope=store.memory.context('xiaoyu','昨天图书馆那句原话怎么说的？','new',new Date(2026,10,20,16));
 assert.equal(scope.originalTurns[0].source,wanted);
 assert.equal(scope.originalTurns[0].user,'我在图书馆看到一个旧书签。');
 assert.equal(scope.originalTurns.length,1);
 const prior=record(store,'同一个图书馆发现另一张鲸鱼书签。');
 set.run(new Date(2026,10,12,11).toISOString(),prior);
 const week=store.memory.context('xiaoyu','上周图书馆那句原话怎么说的？','new',new Date(2026,10,20,16));
 assert.deepEqual(week.originalTurns.map(turn=>turn.source),[prior]);
 assert.deepEqual(week.recent,[]);

});

test('the same model proposes an experience, verbatim sources and review control recall',async t=>{
 const store=setup(t);
 const input='我们今天一起完成了海边拼豆作品，最后一颗放上去真开心。';
 const answer='我最舍不得拆的就是那片海，这个是咱俩一起做好的。';
 assert.equal(mayBeExperience(input),true);
 assert.equal(mayBeExperience('如果我们一起完成这件事情就好了。'),false);
 const source=record(store,input,answer);
 store.memory.enqueue('xiaoyu',source);
 store.memory.enqueue('xiaoyu',source);
 assert.equal(store.memory.next().source,source);
 const proposed=await proposeExperience({key:'fixture',turn:store.memory.getTurn('xiaoyu',source),fetchImpl:async(url,options)=>{
  assert.equal(url,ENDPOINT);
  const body=JSON.parse(options.body);
  assert.equal(body.model,MODEL);
  assert.equal(body.thinking.type,'disabled');
  assert.equal(body.max_tokens,350);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:'海边拼豆',userQuote:input,roleQuote:answer})}}]});
 }});
 assert.equal(store.memory.finishExperience('xiaoyu',source,proposed),true);
 assert.equal(store.memory.next(),undefined);
 assert.equal(store.context('xiaoyu','海边拼豆','next').experiences,undefined);
 assert.throws(()=>store.memory.review('paper-cat',source,'confirmed'),/找不到/);
 store.memory.review('xiaoyu',source,'confirmed');
 assert.equal(store.context('xiaoyu','海边拼豆','next').experiences[0].user_quote,input);
 assert.deepEqual(store.memory.experiences('paper-cat'),[]);
 const bad=record(store,input,answer);
 store.memory.enqueue('xiaoyu',bad);
 assert.equal(store.memory.finishExperience('xiaoyu',bad,{...proposed,userQuote:'这是编造的引文。'}),false);
 assert.equal(store.memory.experiences('xiaoyu').length,1);
 const negative=record(store,'我们没有一起完成海边拼豆，只聊了一下。',answer);
 store.memory.enqueue('xiaoyu',negative);
 assert.equal(store.memory.finishExperience('xiaoyu',negative,{...proposed,userQuote:'一起完成海边拼豆'}),false);
 const positive=record(store,'后来，我们一起完成海边拼豆了。',answer);
 store.memory.enqueue('xiaoyu',positive);
 assert.equal(store.memory.finishExperience('xiaoyu',positive,{...proposed,userQuote:'一起完成海边拼豆'}),true);
 assert.equal(store.memory.experiences('xiaoyu','candidate')[0].user_quote,'后来，我们一起完成海边拼豆了。');

 await ask({key:'fixture',role:{name:'鲸之心'},text:'海边拼豆',context:store.context('xiaoyu','海边拼豆','next'),fetchImpl:async (url,options)=>{
  const data=JSON.parse(options.body);
  assert.match(data.messages[1].content,/海边拼豆/);
  assert.match(data.messages[0].content,/角色当时的理解/);
  return Response.json({choices:[{finish_reason:'stop',message:{content:'我记得咱俩一起做了那幅拼豆。'}}]});
 }});
});
