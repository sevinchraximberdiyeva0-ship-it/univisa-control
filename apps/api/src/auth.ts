import type { Request, Response, NextFunction } from 'express';
import type { User, Session } from '@prisma/client';
import { db } from './db.js';
import { equal, hash,token } from './security.js';
import { config } from './config.js';
import { permitted } from './domain.js';
declare global { namespace Express { interface Request { user:User; session:Session; } } }
export const fail=(status:number,message:string)=>Object.assign(new Error(message),{status});
export async function authenticate(req:Request,res:Response,next:NextFunction) {
  const raw=req.cookies?.uv_session;
  const session=raw?await db.session.findUnique({where:{id:hash(raw)},include:{user:true}}):null;
  if(!session || session.expiresAt<new Date() || !session.user.active) throw fail(401,'Authentication required');
  req.user=session.user; req.session=session;
  if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
    if(req.headers.origin!==config.APP_ORIGIN || !equal(hash(String(req.headers['x-csrf-token']??'')),session.csrfHash)) throw fail(403,'Invalid request origin or CSRF token');
  }
  next();
}
export function authorize(action:'read'|'write'|'admin'='read') { return async(req:Request,res:Response,next:NextFunction)=>{
  if(!permitted(req.user.role,action)) throw fail(403,'Insufficient permissions');
  if(req.user.role!=='STUDENT' && (!req.user.mfaEnabled || !req.session.mfaVerified)) throw fail(403,'Staff MFA enrollment and verification required');
  if(req.user.role==='STUDENT'){
    if(req.user.emailVerificationRequired&&!req.user.emailVerifiedAt)throw fail(403,'Email verification is required');
    const identity=await db.studentIdentity.findFirst({where:{universityId:req.user.universityId,student:{userId:req.user.id}}});
    if(identity&&identity.status!=='VERIFIED')throw fail(403,'University identity verification is required');
  }
  next();
}; }
export async function studentScope(req:Request) {
  const base={universityId:req.user.universityId,archivedAt:null};
  if(req.user.role==='STUDENT') return {...base,userId:req.user.id};
  if(req.user.role==='FACULTY_COORDINATOR') return {...base,facultyId:req.user.facultyId??'__none__'};
  return base;
}
export async function ownStudent(req:Request,id:string) { const student=await db.student.findFirst({where:{...await studentScope(req),id}}); if(!student)throw fail(404,'Student not found'); return student; }
export function publicUser(user:User) { return {id:user.id,name:user.name,email:user.email,role:user.role,universityId:user.universityId,mfaEnabled:user.mfaEnabled,emailVerifiedAt:user.emailVerifiedAt,emailVerificationRequired:user.emailVerificationRequired,emailVerificationAvailable:config.EMAIL_MODE!=='disabled'}; }
export async function createSession(user:User,res:Response,mfaVerified=false){
  const raw=token(),csrf=token(),maxAge=config.SESSION_HOURS*3600000;
  await db.$transaction(async tx=>{
    const [current]=await tx.$queryRaw<Pick<User,'passwordHash'|'active'>[]>`SELECT "passwordHash", active FROM "User" WHERE id=${user.id} FOR SHARE`;
    if(!current?.active||current.passwordHash!==user.passwordHash)throw fail(401,'Account credentials changed, sign in again');
    await tx.session.create({data:{id:hash(raw),userId:user.id,csrfHash:hash(csrf),mfaVerified,expiresAt:new Date(Date.now()+maxAge)}});
  });
  res.cookie('uv_session',raw,{httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'strict',maxAge,path:'/api'});
  res.cookie('uv_csrf',csrf,{secure:config.NODE_ENV==='production',sameSite:'strict',maxAge,path:'/'});
  return csrf;
}
