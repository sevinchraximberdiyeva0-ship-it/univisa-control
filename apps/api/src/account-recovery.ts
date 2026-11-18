import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import {z} from 'zod';
import type {Prisma,User} from '@prisma/client';
import {createSession,fail,publicUser} from './auth.js';
import {config} from './config.js';
import {db} from './db.js';
import {hash,token} from './security.js';

export const accountRecoveryRouter=Router();
const recoveryLifetime=30*60_000;
const submission=z.object({
  code:z.string().trim().regex(/^[a-f0-9]{64}$/),
  password:z.string().min(14).max(72).refine(value=>Buffer.byteLength(value,'utf8')<=72,'Password must fit within 72 UTF-8 bytes'),
});
const eligibleStudent={
  active:true,role:'STUDENT',student:{archivedAt:null,identity:{status:'VERIFIED'}},
} satisfies Prisma.UserWhereInput;

export async function issueStudentRecovery(identityId:string,officer:User){
  const code=token();
  const expiresAt=await db.$transaction(async tx=>{
    const application=await tx.studentIdentity.findFirst({
      where:{id:identityId,universityId:officer.universityId,status:'VERIFIED',student:{archivedAt:null}},
      select:{student:{select:{userId:true}}},
    });
    const userId=application?.student.userId;
    if(!userId)throw fail(404,'Verified student account not found');
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const user=await tx.user.findFirst({
      where:{...eligibleStudent,id:userId,universityId:officer.universityId,
        student:{universityId:officer.universityId,archivedAt:null,identity:{id:identityId,status:'VERIFIED'}}},
      select:{id:true},
    });
    if(!user)throw fail(404,'Verified student account not found');
    const expiresAt=new Date(Date.now()+recoveryLifetime),fields={tokenHash:hash(code),expiresAt};
    await tx.studentAccountRecovery.upsert({where:{userId},create:{userId,...fields},update:fields});
    await tx.auditLog.create({data:{universityId:officer.universityId,actorId:officer.id,action:'STUDENT_ACCOUNT_RECOVERY_ISSUED',entityId:userId}});
    return expiresAt;
  });
  const link=new URL('/talaba/',config.APP_ORIGIN);
  link.hash=`/recover?code=${code}`;
  return {link:link.toString(),expiresAt};
}

accountRecoveryRouter.post('/complete',rateLimit({windowMs:15*60_000,limit:20,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res)=>{
  if(req.headers.origin!==config.APP_ORIGIN)throw fail(403,'Invalid request origin');
  res.set('Cache-Control','no-store');
  const {code,password}=submission.parse(req.body);
  const tokenHash=hash(code);
  const issued=await db.studentAccountRecovery.findUnique({where:{tokenHash},include:{user:{select:{passwordHash:true}}}});
  if(!issued||issued.expiresAt<=new Date())throw fail(400,'Recovery link is invalid or expired');
  if(await bcrypt.compare(password,issued.user.passwordHash))throw fail(409,'Choose a password different from the current password');
  const passwordHash=await bcrypt.hash(password,12);
  const user=await db.$transaction(async tx=>{
    const userId=issued.userId;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const account=await tx.user.findFirst({where:{...eligibleStudent,id:userId}});
    if(!account||account.passwordHash!==issued.user.passwordHash)throw fail(400,'Recovery link is invalid or expired');
    const consumed=await tx.studentAccountRecovery.deleteMany({where:{userId,tokenHash,expiresAt:{gt:new Date()}}});
    if(!consumed.count)throw fail(400,'Recovery link is invalid or expired');
    const recovered=await tx.user.update({where:{id:userId},data:{passwordHash,mfaSecret:null,mfaEnabled:false,lastTotpStep:null}});
    await tx.session.deleteMany({where:{userId}});
    await tx.passkeyCredential.deleteMany({where:{userId}});
    await tx.webAuthnChallenge.deleteMany({where:{userId}});
    await tx.passportLoginChallenge.deleteMany({where:{userId}});
    await tx.emailVerification.deleteMany({where:{userId}});
    await tx.auditLog.create({data:{universityId:account.universityId,actorId:userId,action:'STUDENT_ACCOUNT_RECOVERY_COMPLETED',entityId:userId}});
    return recovered;
  });
  const csrf=await createSession(user,res);
  res.json({user:publicUser(user),csrf});
});
