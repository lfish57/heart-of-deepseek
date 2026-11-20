import {randomUUID} from 'node:crypto';
import {memoryCommand} from '../memory.mjs';

const reviewRole='xiaoyu-memory-demo';
const commands=[
 '周四下午三点我们一起整理书单，记一下哦。',
 '整理书单改到四点吧。',
 '周六上午九点我们一起看展，记一下哦。',
];
const experience={
 input:'我们一起整理完了蓝色封面的书单，把它放进了文件夹。',
 answer:'我记得蓝色封面，那份书单是我们一起整理出来的。',
 title:'蓝色封面的书单',
};

export function seedPreview(store,defaultRole){
 store.db.exec('SAVEPOINT preview_sample');
 try{
  if(!store.role(reviewRole)){
   store.saveRole({...defaultRole,id:reviewRole,name:'小鱼 · 记忆演示'});
   for(const input of commands){
    const source=randomUUID();
    store.begin(reviewRole,source,input,null);
    const answer=store.memory.command(reviewRole,memoryCommand(input),source);
    store.finish(reviewRole,source,answer);
   }
   const {input,answer,title}=experience;
   const source=record(store,reviewRole,{input,answer});
   store.memory.enqueue(reviewRole,source);
   if(!store.memory.finishExperience(reviewRole,source,{title,userQuote:input,roleQuote:answer}))
    throw Error('预览的实测经历引文无效');
   store.memory.review(reviewRole,source,'confirmed');
  }
  store.db.exec('RELEASE preview_sample');
 }catch(error){
  store.db.exec('ROLLBACK TO preview_sample; RELEASE preview_sample');
  throw error;
 }
}

function record(store,id,{input,answer}){
 const source=randomUUID();
 store.begin(id,source,input,null);
 store.finish(id,source,answer);
 return source;
}
