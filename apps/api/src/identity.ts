import { Router } from 'express';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { db } from './db.js';
import { config } from './config.js';
import { authorize,createSession,fail,publicUser } from './auth.js';
import { encrypt,decrypt } from './security.js';
import { dateOnly } from './domain.js';

export const identityPublic=Router(),identityAccount=Router(),identityStaff=Router();
const limits=rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false});
export const identityDetails=z.object({type:z.enum(['PASSPORT','ID_CARD']),country:z.string().regex(/^[A-Z]{2}$/),number:z.string().trim().min(4).max(30).regex(/^[a-zA-Z0-9 -]+$/).transform(v=>v.replace(/[ -]/g,'').toUpperCase()).refine(v=>v.length>=4),dateOfBirth:dateOnly,issueDate:dateOnly,expirationDate:dateOnly}).refine(v=>v.dateOfBirth<=v.issueDate&&v.issueDate<v.expirationDate,'Check birth, issue and expiration dates');
export function identityFingerprint(universityId:string,input:z.infer<typeof identityDetails>){return createHmac('sha256',Buffer.from(config.ENCRYPTION_KEY,'hex')).update(JSON.stringify(['student-identity',universityId,input.type,input.country,input.number])).digest('hex');}
function origin(origin:string|undefined){if(origin!==config.APP_ORIGIN)throw fail(403,'Invalid request origin');}
identityPublic.get('/registration-options',async(req,res)=>{
  const slug=z.string().min(1).max(50).parse(req.query.university);
  const university=await db.university.findUnique({where:{slug},select:{id:true,name:true,studentRegistrationEnabled:true}});
  if(!university?.studentRegistrationEnabled)throw fail(404,'Student registration is not open for this university');
  res.json({name:university.name,faculties:await db.faculty.findMany({where:{universityId:university.id},select:{id:true,name:true},orderBy:{name:'asc'}})});
});
identityPublic.post('/student-registration',limits,async(req,res)=>{
  origin(req.headers.origin);
  const input=z.object({university:z.string().min(1).max(50),fullName:z.string().trim().min(2).max(150),studentNumber:z.string().trim().min(1).max(50),email:z.string().email().max(200).transform(v=>v.toLowerCase()),password:z.string().min(14).max(128),facultyId:z.string().min(1),program:z.string().min(1).max(120),year:z.number().int().min(1).max(12),group:z.string().max(50),nationality:z.string().min(2).max(80),language:z.enum(['uz','en','ru']),identity:identityDetails,consent:z.literal(true)}).parse(req.body);
  const university=await db.university.findUnique({where:{slug:input.university}});
  if(!university?.studentRegistrationEnabled)throw fail(403,'Student registration is closed');
  if(!await db.faculty.findFirst({where:{id:input.facultyId,universityId:university.id}}))throw fail(400,'Unknown university faculty');
  const passwordHash=await bcrypt.hash(input.password,12);
  const user=await db.$transaction(async tx=>{
    const user=await tx.user.create({data:{universityId:university.id,name:input.fullName,email:input.email,passwordHash,role:'STUDENT'}});
    const student=await tx.student.create({data:{universityId:university.id,userId:user.id,studentNumber:input.studentNumber,fullName:input.fullName,facultyId:input.facultyId,program:input.program,year:input.year,group:input.group,nationality:input.nationality,language:input.language,email:input.email,enrollmentStatus:'PENDING_ADMISSION',consentAt:new Date()}});
    await tx.studentIdentity.create({data:{universityId:university.id,studentId:student.id,encryptedDetails:encrypt(JSON.stringify(input.identity)),fingerprint:identityFingerprint(university.id,input.identity),numberLast4:input.identity.number.slice(-4),consentAt:new Date()}});
    await tx.staffTask.create({data:{universityId:university.id,studentId:student.id,reason:'Verify student identity against original ID/passport before admission',deduplicationKey:`identity-${student.id}`}});
    await tx.auditLog.create({data:{universityId:university.id,actorId:user.id,action:'IDENTITY_REGISTRATION_SUBMITTED',entityId:student.id}});
    return user;
  });
  res.status(201).json({user:publicUser(user),csrf:await createSession(user,res),identityStatus:'SUBMITTED'});
});
identityAccount.get('/identity',async(req,res)=>{
  if(req.user.role!=='STUDENT')throw fail(403,'Student account required');
  const identity=await db.studentIdentity.findFirst({where:{universityId:req.user.universityId,student:{userId:req.user.id}},select:{status:true,numberLast4:true,notes:true,reviewedAt:true}});
  res.json({identity});
});
identityAccount.patch('/student-phone',async(req,res)=>{
  if(req.user.role!=='STUDENT')throw fail(403,'Student account required');
  const input=z.object({phone:z.string().regex(/^\+[1-9]\d{7,14}$/),password:z.string().min(1).max(128)}).parse(req.body);
  if(!await bcrypt.compare(input.password,req.user.passwordHash))throw fail(401,'Current password required');
  await db.$transaction(async tx=>{await tx.student.updateMany({where:{userId:req.user.id,universityId:req.user.universityId,archivedAt:null},data:{phoneEncrypted:encrypt(input.phone),phoneVerifiedAt:null}});await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'STUDENT_PHONE_CHANGED_VERIFICATION_RESET',entityId:req.user.id}});});
  res.sendStatus(204);
});
identityStaff.use(authorize('write'));
identityStaff.get('/applications',async(req,res)=>res.json(await db.studentIdentity.findMany({where:{universityId:req.user.universityId},select:{id:true,studentId:true,status:true,numberLast4:true,notes:true,createdAt:true,student:{select:{fullName:true,studentNumber:true,email:true}}},orderBy:{createdAt:'desc'},take:200})));
identityStaff.get('/applications/:id',async(req,res)=>{
  const row=await db.studentIdentity.findFirst({where:{id:String(req.params.id),universityId:req.user.universityId}});if(!row)throw fail(404,'Application not found');
  await db.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'IDENTITY_DETAILS_VIEWED',entityId:row.id}});
  res.set('Cache-Control','no-store').json({id:row.id,status:row.status,details:JSON.parse(decrypt(row.encryptedDetails))});
});
identityStaff.post('/applications/:id/review',async(req,res)=>{
  const input=z.object({state:z.enum(['VERIFIED','REJECTED']),notes:z.string().trim().min(15).max(1000),originalChecked:z.literal(true)}).parse(req.body);
  await db.$transaction(async tx=>{
    const row=await tx.studentIdentity.findFirst({where:{id:String(req.params.id),universityId:req.user.universityId}});if(!row)throw fail(404,'Application not found');
    if(row.status!=='SUBMITTED')throw fail(409,'Identity application already reviewed');
    const changed=await tx.studentIdentity.updateMany({where:{id:row.id,status:'SUBMITTED'},data:{status:input.state,notes:input.notes,reviewedBy:req.user.id,reviewedAt:new Date()}});if(!changed.count)throw fail(409,'Application changed, refresh');
    await tx.student.update({where:{id:row.studentId},data:{enrollmentStatus:input.state==='VERIFIED'?'ACTIVE':'ADMISSION_REJECTED'}});
    await tx.staffTask.updateMany({where:{deduplicationKey:`identity-${row.studentId}`},data:{resolvedAt:new Date()}});
    await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:`IDENTITY_${input.state}`,entityId:row.id}});
  });res.sendStatus(204);
});
identityStaff.put('/registration-policy',authorize('admin'),async(req,res)=>{
  const {enabled}=z.object({enabled:z.boolean()}).parse(req.body);
  await db.$transaction(async tx=>{await tx.university.update({where:{id:req.user.universityId},data:{studentRegistrationEnabled:enabled}});await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:enabled?'STUDENT_REGISTRATION_OPENED':'STUDENT_REGISTRATION_CLOSED',entityId:req.user.universityId}});});res.sendStatus(204);
});
