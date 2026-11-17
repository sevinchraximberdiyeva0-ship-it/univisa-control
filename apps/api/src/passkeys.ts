import { Router,type Request,type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse,type RegistrationResponseJSON,type AuthenticationResponseJSON,type AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { db } from './db.js';
import { config } from './config.js';
import { authenticate,createSession,fail,publicUser } from './auth.js';
import { hash,token } from './security.js';

export const passkeyRouter=Router();
const limiter=rateLimit({windowMs:15*60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false});
const rpID=new URL(config.APP_ORIGIN).hostname;
const cookieName='uv_passkey_challenge',cookiePath='/api/auth/passkeys';
const credential=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/).max(2048),rawId:z.string().max(2048),type:z.literal('public-key'),response:z.record(z.string(),z.unknown()),clientExtensionResults:z.record(z.string(),z.unknown())}).passthrough();
passkeyRouter.use(limiter,(req,_res,next)=>{if(req.method!=='GET'&&req.headers.origin!==config.APP_ORIGIN)throw fail(403,'Invalid request origin');next();});
async function remember(req:Request,res:Response,challenge:string,purpose:string,userId?:string,sessionId?:string){
  await db.webAuthnChallenge.deleteMany({where:{OR:[{expiresAt:{lt:new Date()}},...(req.cookies?.[cookieName]?[{id:hash(req.cookies[cookieName])}]:[])]}});
  const binding=token();await db.webAuthnChallenge.create({data:{id:hash(binding),challenge,purpose,userId,sessionId,expiresAt:new Date(Date.now()+300000)}});
  res.cookie(cookieName,binding,{httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'strict',path:cookiePath,maxAge:300000});
}
async function consume(req:Request,res:Response,purpose:string,userId?:string,sessionId?:string){
  const raw=req.cookies?.[cookieName];res.clearCookie(cookieName,{path:cookiePath});
  if(typeof raw!=='string')throw fail(400,'Passkey challenge required');
  const row=await db.webAuthnChallenge.findUnique({where:{id:hash(raw)}});
  if(!row||row.purpose!==purpose||row.userId!==(userId??null)||row.sessionId!==(sessionId??null)||row.usedAt||row.expiresAt<=new Date())throw fail(400,'Passkey challenge expired or already used');
  const claimed=await db.webAuthnChallenge.updateMany({where:{id:row.id,usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});if(!claimed.count)throw fail(400,'Passkey challenge already used');
  return row.challenge;
}
function student(req:Request){if(req.user.role!=='STUDENT')throw fail(403,'Student passkeys only; staff MFA remains required');}
passkeyRouter.post('/authentication/options',async(req,res)=>{
  const options=await generateAuthenticationOptions({rpID,userVerification:'required',timeout:60000});
  await remember(req,res,options.challenge,'AUTHENTICATION');res.json(options);
});
passkeyRouter.post('/authentication/verify',async(req,res)=>{
  const challenge=await consume(req,res,'AUTHENTICATION');
  const response=credential.parse(req.body.response) as unknown as AuthenticationResponseJSON;
  const key=await db.passkeyCredential.findUnique({where:{id:response.id},include:{user:true}});
  if(!key||!key.user.active||key.user.role!=='STUDENT')throw fail(401,'Passkey authentication failed');
  if(response.response.userHandle!==Buffer.from(key.userId).toString('base64url'))throw fail(401,'Passkey account binding is invalid');
  let verified:Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try{verified=await verifyAuthenticationResponse({response,expectedChallenge:challenge,expectedOrigin:config.APP_ORIGIN,expectedRPID:rpID,credential:{id:key.id,publicKey:new Uint8Array(key.publicKey),counter:Number(key.counter),transports:key.transports as AuthenticatorTransportFuture[]},requireUserVerification:true});}catch{throw fail(401,'Passkey authentication failed');}
  if(!verified.verified||!verified.authenticationInfo.userVerified)throw fail(401,'Device verification required');
  await db.$transaction(async tx=>{
    // Optimistic concurrency prevents two assertions from racing the stored signature counter.
    const changed=await tx.passkeyCredential.updateMany({where:{id:key.id,counter:key.counter},data:{counter:BigInt(verified.authenticationInfo.newCounter),lastUsedAt:new Date(),backedUp:verified.authenticationInfo.credentialBackedUp}});if(!changed.count)throw fail(409,'Passkey changed, try again');
    await tx.auditLog.create({data:{universityId:key.user.universityId,actorId:key.user.id,action:'STUDENT_PASSKEY_LOGIN',entityId:key.id}});
  });
  res.json({user:publicUser(key.user),csrf:await createSession(key.user,res)});
});
passkeyRouter.use(authenticate);
passkeyRouter.get('/',async(req,res)=>{student(req);res.json(await db.passkeyCredential.findMany({where:{userId:req.user.id},select:{id:true,name:true,deviceType:true,backedUp:true,createdAt:true,lastUsedAt:true},orderBy:{createdAt:'desc'}}));});
passkeyRouter.post('/registration/options',async(req,res)=>{
  student(req);const {password}=z.object({password:z.string().min(1).max(128)}).parse(req.body);
  if(!await bcrypt.compare(password,req.user.passwordHash))throw fail(401,'Current password required to add a device');
  const keys=await db.passkeyCredential.findMany({where:{userId:req.user.id}});if(keys.length>=10)throw fail(409,'Maximum 10 passkeys per account');
  const university=await db.university.findUniqueOrThrow({where:{id:req.user.universityId}});
  const options=await generateRegistrationOptions({rpName:'UniVisa Control',rpID,userID:new TextEncoder().encode(req.user.id),userName:req.user.email,userDisplayName:`${university.name} · ${req.user.name}`,attestationType:'none',excludeCredentials:keys.map(k=>({id:k.id})),authenticatorSelection:{residentKey:'required',userVerification:'required',authenticatorAttachment:'platform'},supportedAlgorithmIDs:[-7,-257],timeout:60000});
  await remember(req,res,options.challenge,'REGISTRATION',req.user.id,req.session.id);res.json(options);
});
passkeyRouter.post('/registration/verify',async(req,res)=>{
  student(req);const challenge=await consume(req,res,'REGISTRATION',req.user.id,req.session.id);
  const input=z.object({name:z.string().trim().min(1).max(80),response:credential}).parse(req.body);
  let verified:Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try{verified=await verifyRegistrationResponse({response:input.response as unknown as RegistrationResponseJSON,expectedChallenge:challenge,expectedOrigin:config.APP_ORIGIN,expectedRPID:rpID,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});}catch{throw fail(400,'Device registration could not be verified');}
  if(!verified.verified||!verified.registrationInfo.userVerified)throw fail(400,'Device verification required');
  const info=verified.registrationInfo;
  await db.$transaction(async tx=>{
    // Limit enrollment concurrently as well as at options generation.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${req.user.id} FOR UPDATE`;
    if(await tx.passkeyCredential.count({where:{userId:req.user.id}})>=10)throw fail(409,'Maximum 10 passkeys per account');
    await tx.passkeyCredential.create({data:{id:info.credential.id,userId:req.user.id,publicKey:Buffer.from(info.credential.publicKey),counter:BigInt(info.credential.counter),transports:info.credential.transports??[],deviceType:info.credentialDeviceType,backedUp:info.credentialBackedUp,name:input.name}});
    await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'STUDENT_PASSKEY_REGISTERED',entityId:info.credential.id}});
  });res.status(201).json({verified:true});
});
passkeyRouter.delete('/:id',async(req,res)=>{
  student(req);const {password}=z.object({password:z.string().min(1).max(128)}).parse(req.body);if(!await bcrypt.compare(password,req.user.passwordHash))throw fail(401,'Current password required');
  const result=await db.passkeyCredential.deleteMany({where:{id:String(req.params.id),userId:req.user.id}});if(!result.count)throw fail(404,'Passkey not found');
  await db.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'STUDENT_PASSKEY_REMOVED',entityId:String(req.params.id)}});res.sendStatus(204);
});
