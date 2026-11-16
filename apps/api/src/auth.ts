import type { Request, Response, NextFunction } from 'express';
import type { User, Session } from '@prisma/client';
import { db } from './db.js';
import { equal, hash } from './security.js';
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
export function authorize(action:'read'|'write'|'admin'='read') { return (req:Request,res:Response,next:NextFunction)=>{
  if(!permitted(req.user.role,action)) throw fail(403,'Insufficient permissions');
  if(req.user.role!=='STUDENT' && (!req.user.mfaEnabled || !req.session.mfaVerified)) throw fail(403,'Staff MFA enrollment and verification required');
  next();
}; }
export async function studentScope(req:Request) {
  const base={universityId:req.user.universityId,archivedAt:null};
  if(req.user.role==='STUDENT') return {...base,userId:req.user.id};
  if(req.user.role==='FACULTY_COORDINATOR') return {...base,facultyId:req.user.facultyId??'__none__'};
  return base;
}
export async function ownStudent(req:Request,id:string) { const student=await db.student.findFirst({where:{...await studentScope(req),id}}); if(!student)throw fail(404,'Student not found'); return student; }
export function publicUser(user:User) { return {id:user.id,name:user.name,email:user.email,role:user.role,universityId:user.universityId,mfaEnabled:user.mfaEnabled}; }
