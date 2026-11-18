import {createHmac,randomInt} from 'node:crypto';
import {appendFile} from 'node:fs/promises';
import {Router,type Request} from 'express';
import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {fail} from './auth.js';
import {config} from './config.js';
import {db} from './db.js';
import {resolveLanguage,type Language} from './languages.js';
import {equal} from './security.js';

export const emailVerificationRouter=Router();
export const emailCodeLifetime=15*60_000, maxEmailCodeAttempts=5;
export const emailCodeSchema=z.string().trim().regex(/^\d{8}$/);
const resendInterval=60_000, sendWindow=60*60_000, maxSends=5;
type EmailCodePurpose='email-verification'|'passport-login';
const messages:Record<Language,{subject:string;body:string}>={
  uz:{subject:'UniVisa Control email tasdig‘i',body:'Emailingizni tasdiqlash kodi: {code}. Kod 15 daqiqa amal qiladi. Agar kod so‘ramagan bo‘lsangiz, bu xabarni e’tiborsiz qoldiring.'},
  tk:{subject:'UniVisa Control e-poçta tassyklamasy',body:'E-poçtaňyzy tassyklamak üçin kod: {code}. Kod 15 minut güýjünde. Kody soramadyk bolsaňyz, bu habary äsgermezlik ediň.'},
  en:{subject:'Verify your UniVisa Control email',body:'Your email verification code is {code}. It expires in 15 minutes. If you did not request a code, you can ignore this email.'},
  ru:{subject:'Подтвердите почту UniVisa Control',body:'Код подтверждения почты: {code}. Код действует 15 минут. Если вы не запрашивали код, проигнорируйте это письмо.'},
  ko:{subject:'UniVisa Control 이메일 인증',body:'이메일 인증 코드는 {code}입니다. 코드는 15분 동안 유효합니다. 요청하지 않았다면 이 이메일을 무시하세요.'},
  zh:{subject:'验证您的 UniVisa Control 邮箱',body:'您的邮箱验证码为 {code}，15 分钟内有效。如果您未请求验证码，请忽略此邮件。'},
};

const loginMessages:typeof messages={
  uz:{subject:'UniVisa Control kirish kodi',body:'Kirish kodingiz: {code}. Kod 15 daqiqa amal qiladi. Uni hech kimga bermang.'},
  tk:{subject:'UniVisa Control giriş kody',body:'Giriş koduňyz: {code}. Kod 15 minut güýjünde. Kody hiç kime bermäň.'},
  en:{subject:'Your UniVisa Control sign-in code',body:'Your sign-in code is {code}. It expires in 15 minutes. Do not share this code.'},
  ru:{subject:'Код входа в UniVisa Control',body:'Ваш код входа: {code}. Код действует 15 минут. Никому не сообщайте его.'},
  ko:{subject:'UniVisa Control 로그인 코드',body:'로그인 코드는 {code}입니다. 15분 동안 유효합니다. 다른 사람과 공유하지 마세요.'},
  zh:{subject:'UniVisa Control 登录验证码',body:'您的登录验证码为 {code}，15 分钟内有效。请勿与他人分享。'},
};

export function emailCodeDigest(purpose:EmailCodePurpose,userId:string,email:string,code:string){
  return createHmac('sha256',Buffer.from(config.ENCRYPTION_KEY,'hex'))
    .update(JSON.stringify([purpose,userId,email,code])).digest('hex');
}

type SendHistory={codeHash:string;sentAt:Date;windowStartedAt:Date;sendCount:number};
export function nextEmailCode(purpose:EmailCodePurpose,userId:string,email:string,previous:SendHistory|null){
  const now=new Date();
  const sameWindow=previous&&now.getTime()-previous.windowStartedAt.getTime()<sendWindow;
  const sendCount=sameWindow?previous.sendCount:0;
  if((previous&&now.getTime()-previous.sentAt.getTime()<resendInterval)||sendCount>=maxSends)return null;

  let code:string,codeHash:string;
  do{
    code=String(randomInt(100_000_000)).padStart(8,'0');
    codeHash=emailCodeDigest(purpose,userId,email,code);
  }while(codeHash===previous?.codeHash);
  const fields={codeHash,sentAt:now,expiresAt:new Date(now.getTime()+emailCodeLifetime),
    windowStartedAt:sameWindow?previous.windowStartedAt:now,sendCount:sendCount+1,attempts:0};
  return {code,fields};
}

async function lockStudentAccount(tx:Prisma.TransactionClient,req:Request){
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.user.id} FOR UPDATE`;
  const user=await tx.user.findFirst({
    where:{id:req.user.id,universityId:req.user.universityId,active:true,role:'STUDENT',student:{archivedAt:null}},
    select:{id:true,universityId:true,email:true,emailVerifiedAt:true,student:{select:{language:true}}},
  });
  if(!user)throw fail(403,'Active student account required');
  return user;
}

export async function sendCodeEmail(purpose:EmailCodePurpose,email:string,code:string,language:string,transport:typeof fetch=fetch){
  const message=(purpose==='passport-login'?loginMessages:messages)[resolveLanguage(language)];
  const payload={to:[email],subject:message.subject,text:message.body.replace('{code}',code)};
  if(config.EMAIL_MODE==='mock'&&config.NODE_ENV==='test'&&config.TEST_EMAIL_OUTBOX){
    await appendFile(config.TEST_EMAIL_OUTBOX,JSON.stringify(payload)+'\n',{mode:0o600});
    return;
  }
  if(config.EMAIL_MODE!=='live'||!config.EMAIL_FROM||!config.EMAIL_RESEND_API_KEY)throw new Error('Email delivery unavailable');
  const response=await transport('https://api.resend.com/emails',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
    headers:{Authorization:`Bearer ${config.EMAIL_RESEND_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({...payload,from:config.EMAIL_FROM}),
  });
  if(!response.ok)throw new Error('Email delivery rejected');
  const accepted=z.object({id:z.string().min(1)}).safeParse(await response.json());
  if(!accepted.success)throw new Error('Email provider did not confirm acceptance');
}

emailVerificationRouter.post('/send',async(req,res)=>{
  if(req.user.role!=='STUDENT')throw fail(403,'Student account required');
  if(config.EMAIL_MODE==='disabled')throw fail(503,'Email verification is unavailable');
  const delivery=await db.$transaction(async tx=>{
    const user=await lockStudentAccount(tx,req);
    if(user.emailVerifiedAt)return null;
    const previous=await tx.emailVerification.findUnique({where:{userId:user.id}});
    const next=nextEmailCode('email-verification',user.id,user.email,previous);
    if(!next)throw fail(429,'Wait before requesting another verification code');
    const {fields,code}=next;
    await tx.emailVerification.upsert({where:{userId:user.id},create:{...fields,userId:user.id},update:fields});
    return {email:user.email,code,language:user.student?.language??'en'};
  });
  if(delivery){
    try{await sendCodeEmail('email-verification',delivery.email,delivery.code,delivery.language);}
    catch{throw fail(503,'Verification email could not be sent');}
  }
  res.sendStatus(204);
});

emailVerificationRouter.post('/confirm',async(req,res)=>{
  if(req.user.role!=='STUDENT')throw fail(403,'Student account required');
  const {code}=z.object({code:emailCodeSchema}).parse(req.body);
  const verified=await db.$transaction(async tx=>{
    const user=await lockStudentAccount(tx,req);
    const challenge=await tx.emailVerification.findUnique({where:{userId:user.id}});
    const now=new Date();
    if(user.emailVerifiedAt||!challenge||challenge.expiresAt<=now||challenge.attempts>=maxEmailCodeAttempts)return false;
    if(!equal(challenge.codeHash,emailCodeDigest('email-verification',user.id,user.email,code))){
      await tx.emailVerification.update({where:{userId:user.id},data:{attempts:{increment:1}}});
      return false;
    }
    await tx.user.update({where:{id:user.id},data:{emailVerifiedAt:now}});
    await tx.emailVerification.delete({where:{userId:user.id}});
    await tx.auditLog.create({data:{universityId:user.universityId,actorId:user.id,action:'STUDENT_EMAIL_VERIFIED',entityId:user.id}});
    return true;
  });
  if(!verified)throw fail(400,'Verification code is invalid or expired');
  res.sendStatus(204);
});
