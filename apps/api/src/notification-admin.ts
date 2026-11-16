import { Router } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { authorize,fail,studentScope } from './auth.js';
import { decrypt,encrypt } from './security.js';
import { simulate,simulationInput } from './simulator.js';
import { smsCredentials } from './providers.js';
export const notificationAdmin=Router();
notificationAdmin.get('/monitor',async(req,res)=>{
  if(req.user.role==='STUDENT')throw fail(403,'Staff monitoring only');
  const query=z.object({state:z.enum(['ALL','ACCEPTED','DELIVERED','PENDING','SENDING','FAILED','UNKNOWN','UNAVAILABLE','CANCELED','MOCK','RETRIED']).default('ALL'),channel:z.enum(['ALL','SMS','TELEGRAM','IN_APP']).default('ALL'),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(req.query);
  const students=await db.student.findMany({where:await studentScope(req),select:{id:true}});
  const base={universityId:req.user.universityId,studentId:{in:students.map(s=>s.id)}};
  const where={...base,...(query.state==='RETRIED'?{retryCount:{gt:0}}:query.state==='ALL'?{}:{state:query.state}),...(query.channel==='ALL'?{}:{channel:query.channel})};
  const [groups,total,rows,retried,heartbeat]=await Promise.all([
    db.notificationJob.groupBy({by:['state'],where:base,_count:{_all:true}}),
    db.notificationJob.count({where}),
    db.notificationJob.findMany({where,include:{attempts:{orderBy:{createdAt:'asc'}}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*50,take:50}),
    db.notificationJob.count({where:{...base,retryCount:{gt:0}}}),
    db.workerHeartbeat.findUnique({where:{id:'notifications'}})
  ]);
  res.json({counts:Object.fromEntries(groups.map(g=>[g.state,g._count._all])),retried,total,page:query.page,pageSize:50,worker:{lastSuccessAt:heartbeat?.lastSuccessAt??null,healthy:!!heartbeat?.lastSuccessAt&&Date.now()-heartbeat.lastSuccessAt.getTime()<90000},rows:rows.map(({messageEncrypted,...row})=>({...row,message:messageEncrypted?decrypt(messageEncrypted):null}))});
});
notificationAdmin.post('/simulate',authorize('write'),async(req,res)=>{
  const input=simulationInput.parse(req.body);
  const university=await db.university.findUniqueOrThrow({where:{id:req.user.universityId}});
  const rules=await db.notificationRule.findMany({where:{universityId:req.user.universityId,enabled:true}});
  const result=await simulate(input,{timezone:university.timezone,deliveryStart:university.deliveryStart,deliveryEnd:university.deliveryEnd,thresholds:rules.map(r=>r.daysRemaining),overdueOffsets:university.overdueOffsets});
  await db.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'NOTIFICATION_SIMULATED',entityId:'synthetic-only'}});res.json(result);
});
notificationAdmin.put('/overdue-policy',authorize('admin'),async(req,res)=>{
  const {offsets}=z.object({offsets:z.array(z.number().int().min(1).max(365)).max(12)}).parse(req.body);
  await db.$transaction(async tx=>{await tx.university.update({where:{id:req.user.universityId},data:{overdueOffsets:[...new Set(offsets)].sort((a,b)=>a-b)}});await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'OVERDUE_POLICY_UPDATED',entityId:req.user.universityId}});});res.sendStatus(204);
});
notificationAdmin.put('/sms-provider',authorize('admin'),async(req,res)=>{
  const input=z.object({provider:z.enum(['mock','devsms']),credentials:smsCredentials.optional()}).parse(req.body);
  const previous=await db.smsProviderConfiguration.findUnique({where:{universityId:req.user.universityId}});
  const encrypted=input.credentials?encrypt(JSON.stringify(input.credentials)):undefined;
  await db.$transaction(async tx=>{await tx.smsProviderConfiguration.upsert({where:{universityId:req.user.universityId},update:{provider:input.provider,...(encrypted?{credentialsEncrypted:encrypted}:{})},create:{universityId:req.user.universityId,provider:input.provider,credentialsEncrypted:encrypted}});await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'SMS_PROVIDER_UPDATED',entityId:previous?.id??req.user.universityId}});});
  res.json({provider:input.provider,credentialsConfigured:!!(encrypted||previous?.credentialsEncrypted)});
});
