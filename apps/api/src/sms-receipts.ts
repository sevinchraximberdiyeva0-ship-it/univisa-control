import { Router } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { config } from './config.js';
import { decrypt } from './security.js';
import { smsCredentials,verifyDevSmsSignature } from './providers.js';
import { smsProviderFor,task } from './notifications.js';
export const smsReceiptRouter=Router();
declare global {namespace Express {interface Request {rawBody?:Buffer;}}}
export async function applySmsReceipt(universityId:string,id:string,state:'DELIVERED'|'FAILED',at:Date){
  const job=await db.notificationJob.findFirst({where:{universityId,provider:'devsms',channel:'SMS',providerMessageId:id}});
  if(!job)return false;
  await db.$transaction(async tx=>{
    // Wait for in-flight send/renewal transaction; never overwrite a terminal receipt.
    await tx.$queryRaw`SELECT id FROM "StudentDocument" WHERE id=${job.documentId} FOR UPDATE`;
    const changed=await tx.notificationJob.updateMany({where:{id:job.id,state:{in:['ACCEPTED','UNKNOWN','SENDING']},OR:[{providerStatusAt:null},{providerStatusAt:{lte:at}}]},data:{state,providerStatusAt:at,nextReceiptAt:null,...(state==='DELIVERED'?{deliveredAt:at}:{lastErrorCode:'PROVIDER_UNDELIVERABLE'})}});
    if(changed.count){await tx.notificationAttempt.create({data:{jobId:job.id,state,errorCode:state==='FAILED'?'PROVIDER_UNDELIVERABLE':null}});if(state==='FAILED')await task(tx,job.universityId,job.studentId,'SMS could not be delivered; verify contact channel',`${job.id}-receipt-failure`);}
  });return true;
}
smsReceiptRouter.post('/:universityId',async(req,res)=>{
  const universityId=String(req.params.universityId);
  const settings=await db.smsProviderConfiguration.findUnique({where:{universityId}});
  if(settings?.provider!=='devsms')return res.sendStatus(401);
  let key:string|undefined;
  try{key=settings.credentialsEncrypted?smsCredentials.parse(JSON.parse(decrypt(settings.credentialsEncrypted))).webhookKey:config.DEVSMS_WEBHOOK_KEY;}catch{return res.sendStatus(401);}
  if(!key || !req.rawBody || !verifyDevSmsSignature(req.rawBody,String(req.headers['x-devsms-timestamp']??''),String(req.headers['x-devsms-signature']??''),key))return res.sendStatus(401);
  const body=z.object({sms_id:z.number().int().positive(),status:z.enum(['sent','delivered','failed'])}).safeParse(req.body);
  if(!body.success)return res.sendStatus(400);
  if(body.data.status!=='sent')await applySmsReceipt(universityId,String(body.data.sms_id),body.data.status==='delivered'?'DELIVERED':'FAILED',new Date(Number(req.headers['x-devsms-timestamp'])*1000));
  return res.sendStatus(204);
});
export async function reconcileSmsReceipts(now=new Date()){
  const jobs=await db.notificationJob.findMany({where:{provider:'devsms',state:'ACCEPTED',nextReceiptAt:{lte:now}},take:100,orderBy:{nextReceiptAt:'asc'}});
  for(const job of jobs){
    if(!job.providerMessageId)continue;
    try{
      const provider=await smsProviderFor(job.universityId);
      if(!provider.status)continue;
      const status=await provider.status(job.providerMessageId);
      if(status!=='ACCEPTED'){await applySmsReceipt(job.universityId,job.providerMessageId,status,now);continue;}
    }catch{/* Retry status lookups only. Never resend an accepted message. */}
    const checks=job.receiptChecks+1;
    await db.notificationJob.updateMany({where:{id:job.id,state:'ACCEPTED',receiptChecks:job.receiptChecks},data:{receiptChecks:checks,nextReceiptAt:checks>=12?null:new Date(now.getTime()+Math.min(3600000,60000*2**checks))}});
    if(checks>=12)await db.$transaction(tx=>task(tx,job.universityId,job.studentId,'SMS acceptance has no final delivery receipt; reconcile with provider',`${job.id}-receipt-timeout`));
  }
}
