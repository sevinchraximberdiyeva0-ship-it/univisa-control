import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {createSession,fail,publicUser} from './auth.js';
import {config} from './config.js';
import {db} from './db.js';
import {emailCodeDigest,emailCodeLifetime,emailCodeSchema,maxEmailCodeAttempts,nextEmailCode,sendCodeEmail} from './email-verification.js';
import {identityFingerprint,identityNumber} from './identity.js';
import {decrypt,equal,hash,token} from './security.js';

export const passportLoginRouter=Router();
const cookieName='uv_passport_login',cookiePath='/api/auth/passport-login';
const browserToken=z.string().regex(/^[a-f0-9]{64}$/);
const identifier=z.object({
  university:z.string().trim().min(1).max(50).toLowerCase(),
  number:identityNumber,
  document:z.object({type:z.enum(['PASSPORT','ID_CARD']),country:z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)}).optional(),
});
const eligibleUser={active:true,role:'STUDENT',mfaEnabled:false,emailVerifiedAt:{not:null}} satisfies Prisma.UserWhereInput;
type Applicant={userId:string;universityId:string;identityId:string};

passportLoginRouter.use(rateLimit({windowMs:15*60_000,limit:40,standardHeaders:'draft-8',legacyHeaders:false}),(req,res,next)=>{
  if(req.headers.origin!==config.APP_ORIGIN)throw fail(403,'Invalid request origin');
  res.set('Cache-Control','no-store');
  next();
});

async function findApplicant(input:z.infer<typeof identifier>):Promise<Applicant|null>{
  const university=await db.university.findUnique({where:{slug:input.university},select:{id:true}});
  if(!university)return null;
  const fingerprint=input.document?identityFingerprint(university.id,{...input.document,number:input.number}):undefined;
  const candidates=await db.studentIdentity.findMany({
    where:{universityId:university.id,status:'VERIFIED',numberLast4:input.number.slice(-4),fingerprint,
      student:{archivedAt:null,user:{is:{...eligibleUser,universityId:university.id}}}},
    select:{id:true,encryptedDetails:true,student:{select:{userId:true}}},take:101,
  });
  // The optional document type and issuing country use the existing unique fingerprint.
  if(candidates.length>100)return null;
  let applicant:Applicant|null=null;
  for(const candidate of candidates){
    if(!candidate.student.userId)continue;
    if(!fingerprint){
      try{if(JSON.parse(decrypt(candidate.encryptedDetails)).number!==input.number)continue;}
      catch{continue;}
    }
    if(applicant)return null;
    applicant={userId:candidate.student.userId,universityId:university.id,identityId:candidate.id};
  }
  return applicant;
}

async function lockApplicant(tx:Prisma.TransactionClient,applicant:Applicant){
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${applicant.userId} FOR UPDATE`;
  return tx.user.findFirst({where:{id:applicant.userId,universityId:applicant.universityId,...eligibleUser,
    student:{archivedAt:null,identity:{id:applicant.identityId,status:'VERIFIED'}}},
    include:{student:{select:{language:true}}}});
}

passportLoginRouter.post('/start',async(req,res)=>{
  const input=identifier.parse(req.body);
  if(config.EMAIL_MODE==='disabled')throw fail(503,'Passport login is unavailable');
  const cookie=browserToken.safeParse(req.cookies?.[cookieName]);
  const binding=cookie.success?cookie.data:token();
  res.cookie(cookieName,binding,{httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'strict',path:cookiePath,maxAge:emailCodeLifetime});
  // Return before looking up records or contacting the email provider.
  res.status(202).json({accepted:true});
  try{
    const applicant=await findApplicant(input);
    if(!applicant)return;
    const delivery=await db.$transaction(async tx=>{
      const user=await lockApplicant(tx,applicant);
      if(!user)return null;
      const previous=await tx.passportLoginChallenge.findUnique({where:{userId:user.id}});
      const next=nextEmailCode('passport-login',user.id,user.email,previous);
      if(!next)return null;
      const fields={...next.fields,browserHash:hash(binding),usedAt:null};
      await tx.passportLoginChallenge.upsert({where:{userId:user.id},create:{...fields,userId:user.id},update:fields});
      return {email:user.email,code:next.code,language:user.student?.language??'en'};
    });
    if(delivery)await sendCodeEmail('passport-login',delivery.email,delivery.code,delivery.language);
  }catch{
    console.warn('passport_login_code_delivery_failed');
  }
});

passportLoginRouter.post('/confirm',async(req,res)=>{
  const {code,...input}=identifier.extend({code:emailCodeSchema}).parse(req.body);
  const cookie=browserToken.safeParse(req.cookies?.[cookieName]);
  const applicant=cookie.success?await findApplicant(input):null;
  if(!cookie.success||!applicant)throw fail(401,'Sign-in code is invalid or expired');
  const binding=hash(cookie.data);
  const user=await db.$transaction(async tx=>{
    const account=await lockApplicant(tx,applicant);
    if(!account)return null;
    const challenge=await tx.passportLoginChallenge.findUnique({where:{userId:account.id}});
    const now=new Date();
    if(!challenge||challenge.usedAt||challenge.expiresAt<=now||challenge.attempts>=maxEmailCodeAttempts||!equal(binding,challenge.browserHash))return null;
    if(!equal(challenge.codeHash,emailCodeDigest('passport-login',account.id,account.email,code))){
      await tx.passportLoginChallenge.update({where:{userId:account.id},data:{attempts:{increment:1}}});
      return null;
    }
    await tx.passportLoginChallenge.update({where:{userId:account.id},data:{usedAt:now}});
    await tx.auditLog.create({data:{universityId:account.universityId,actorId:account.id,action:'STUDENT_PASSPORT_LOGIN',entityId:account.id}});
    return account;
  });
  if(!user)throw fail(401,'Sign-in code is invalid or expired');
  res.clearCookie(cookieName,{path:cookiePath});
  res.json({user:publicUser(user),csrf:await createSession(user,res)});
});
