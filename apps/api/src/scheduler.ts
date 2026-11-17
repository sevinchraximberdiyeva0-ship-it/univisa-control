import { Queue,Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { db } from './db.js';
import { deliver,planDocument,task } from './notifications.js';
import { deliverTelegramResponse } from './telegram.js';
import { reconcileSmsReceipts } from './sms-receipts.js';

export const QUEUE_NAME='univisa-delivery';
export type QueueRuntimeOptions={prefix?:string;autorun?:boolean};
export function queueRuntime(url:string,processor=async(name:string,id:string)=>name==='telegram-reply'?deliverTelegramResponse(id):deliver(id),options:QueueRuntimeOptions={}){
  const producer=new Redis(url,{maxRetriesPerRequest:1,enableOfflineQueue:false,connectTimeout:3000});
  const consumer=new Redis(url,{maxRetriesPerRequest:null});
  // Errors are logged without connection strings or credentials by the owning worker.
  producer.on('error',()=>{});consumer.on('error',()=>{});
  const prefix=options.prefix??'bull';
  const queue=new Queue(QUEUE_NAME,{connection:producer,prefix});
  const worker=new Worker(QUEUE_NAME,job=>processor(job.name,String(job.data.id)),{connection:consumer,prefix,autorun:options.autorun??true,concurrency:4});
  queue.on('error',()=>{});worker.on('error',()=>{});
  worker.on('failed',async job=>{
    if(!job||job.name!=='deliver'||job.attemptsMade<4)return;
    await db.notificationJob.updateMany({where:{id:String(job.data.id),state:'PENDING'},data:{queueFailures:{increment:1}}}).catch(()=>undefined);
  });
  return {queue,worker,producer,consumer,async close(){await worker.close();await queue.close();await Promise.all([producer.quit().catch(()=>producer.disconnect()),consumer.quit().catch(()=>consumer.disconnect())]);}};
}

async function enqueue(queue:Queue,name:string,id:string){
  const jobId=name==='telegram-reply'?`tg-${id}`:id;
  const existing=await queue.getJob(jobId);
  if(existing){const state=await existing.getState();if(state==='failed'||state==='completed')await existing.remove();else return;}
  await queue.add(name,{id},{jobId,attempts:4,backoff:{type:'exponential',delay:30000},removeOnComplete:true,removeOnFail:1000});
}
export async function enqueuePending(queue:Queue,now=new Date()){
  const due=await db.notificationJob.findMany({where:{state:'PENDING',scheduledAt:{lte:now}},take:500,orderBy:{scheduledAt:'asc'}});
  for(const job of due){
    if(job.queueFailures>=3){await db.$transaction(async tx=>{await tx.notificationJob.updateMany({where:{id:job.id,state:'PENDING'},data:{state:'FAILED',lastErrorCode:'QUEUE_EXHAUSTED'}});await task(tx,job.universityId,job.studentId,'Repeated queue processing failures require investigation',`${job.id}-queue-exhausted`);});continue;}
    await enqueue(queue,'deliver',job.id);
  }
  const replies=await db.telegramResponse.findMany({where:{state:'PENDING',scheduledAt:{lte:now}},take:100,orderBy:{scheduledAt:'asc'}});
  for(const row of replies)await enqueue(queue,'telegram-reply',row.id);
  return due.length+replies.length;
}
export async function reconcileSchedules(now=new Date()){
  const uncertain=await db.notificationJob.findMany({where:{state:'SENDING',sendingAt:{lt:new Date(now.getTime()-120000)}},take:500});
  for(const job of uncertain)await db.$transaction(async tx=>{
    // A sender may still hold the lock. Recheck state after waiting before quarantining.
    await tx.$queryRaw`SELECT id FROM "StudentDocument" WHERE id=${job.documentId} FOR UPDATE`;
    const updated=await tx.notificationJob.updateMany({where:{id:job.id,state:'SENDING',sendingAt:{lt:new Date(now.getTime()-120000)}},data:{state:'UNKNOWN',lastErrorCode:'INTERRUPTED_SEND'}});
    if(updated.count)await task(tx,job.universityId,job.studentId,'Interrupted provider send requires reconciliation',`${job.id}-interrupted`);
  });
  await db.telegramResponse.updateMany({where:{state:'SENDING',sendingAt:{lt:new Date(now.getTime()-120000)}},data:{state:'UNKNOWN',lastErrorCode:'INTERRUPTED_SEND'}});
  let cursor:string|undefined;
  while(true){
    const documents=await db.studentDocument.findMany({where:{archivedAt:null,student:{archivedAt:null}},orderBy:{id:'asc'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{})});
    for(const document of documents)await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "StudentDocument" WHERE id=${document.id} FOR UPDATE`;
      const current=await tx.studentDocument.findUniqueOrThrow({where:{id:document.id}});
      if(!current.archivedAt)await planDocument(tx,current,now);
    });
    if(documents.length<100)break;cursor=documents[documents.length-1].id;
  }
}
export async function schedulerTick(queue:Queue,now=new Date()){
  await db.workerHeartbeat.upsert({where:{id:'notifications'},update:{updatedAt:now},create:{id:'notifications',updatedAt:now}});
  await reconcileSchedules(now);
  const pending=await enqueuePending(queue,now);
  await reconcileSmsReceipts(now);
  await db.workerHeartbeat.update({where:{id:'notifications'},data:{lastSuccessAt:new Date()}});
  return pending;
}
