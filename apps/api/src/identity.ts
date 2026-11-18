import { languageSchema } from './languages.js';
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
import { Prisma } from '@prisma/client';
import { issueStudentRecovery } from './account-recovery.js';

export const identityPublic=Router(),identityAccount=Router(),identityStaff=Router();
const limits=rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false});
const identityTaskReason='Verify student identity against original ID/passport before admission';
export const identityNumber=z.string().trim().min(4).max(30).regex(/^[a-zA-Z0-9 -]+$/)
  .transform(value=>value.replace(/[ -]/g,'').toUpperCase()).refine(value=>value.length>=4);
const identityIdentifier=z.object({type:z.enum(['PASSPORT','ID_CARD']),country:z.string().regex(/^[A-Z]{2}$/),number:identityNumber});
export const identityDetails=identityIdentifier.extend({dateOfBirth:dateOnly,issueDate:dateOnly,expirationDate:dateOnly}).refine(v=>v.dateOfBirth<=v.issueDate&&v.issueDate<v.expirationDate,'Check birth, issue and expiration dates');
export function identityFingerprint(universityId:string,input:z.infer<typeof identityIdentifier>){return createHmac('sha256',Buffer.from(config.ENCRYPTION_KEY,'hex')).update(JSON.stringify(['student-identity',universityId,input.type,input.country,input.number])).digest('hex');}
function origin(origin:string|undefined){if(origin!==config.APP_ORIGIN)throw fail(403,'Invalid request origin');}
identityPublic.get('/registration-options',async(req,res)=>{
  const slug=z.string().min(1).max(50).parse(req.query.university);
  const university=await db.university.findUnique({where:{slug},select:{id:true,name:true,studentRegistrationEnabled:true}});
  if(!university?.studentRegistrationEnabled)throw fail(404,'Student registration is not open for this university');
  res.json({name:university.name,faculties:await db.faculty.findMany({where:{universityId:university.id},select:{id:true,name:true},orderBy:{name:'asc'}})});
});
identityPublic.post('/student-registration',limits,async(req,res)=>{
  origin(req.headers.origin);
  const input=z.object({university:z.string().min(1).max(50),fullName:z.string().trim().min(2).max(150),studentNumber:z.string().trim().min(1).max(50),email:z.string().email().max(200).transform(v=>v.toLowerCase()),password:z.string().min(14).max(128),facultyId:z.string().min(1),program:z.string().min(1).max(120),year:z.number().int().min(1).max(12),group:z.string().max(50),nationality:z.string().min(2).max(80),language:languageSchema,identity:identityDetails,consent:z.literal(true)}).parse(req.body);
  const university=await db.university.findUnique({where:{slug:input.university}});
  if(!university?.studentRegistrationEnabled)throw fail(403,'Student registration is closed');
  if(!await db.faculty.findFirst({where:{id:input.facultyId,universityId:university.id}}))throw fail(400,'Unknown university faculty');
  const passwordHash=await bcrypt.hash(input.password,12);
  const user=await db.$transaction(async tx=>{
    const user=await tx.user.create({data:{universityId:university.id,name:input.fullName,email:input.email,passwordHash,role:'STUDENT',emailVerificationRequired:config.EMAIL_MODE!=='disabled'}});
    const student=await tx.student.create({data:{universityId:university.id,userId:user.id,studentNumber:input.studentNumber,fullName:input.fullName,facultyId:input.facultyId,program:input.program,year:input.year,group:input.group,nationality:input.nationality,language:input.language,email:input.email,enrollmentStatus:'PENDING_ADMISSION',consentAt:new Date()}});
    await tx.studentIdentity.create({data:{universityId:university.id,studentId:student.id,encryptedDetails:encrypt(JSON.stringify(input.identity)),fingerprint:identityFingerprint(university.id,input.identity),numberLast4:input.identity.number.slice(-4),consentAt:new Date()}});
    await tx.staffTask.create({data:{universityId:university.id,studentId:student.id,reason:identityTaskReason,deduplicationKey:`identity-${student.id}`}});
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
identityAccount.post('/identity/resubmit',async(req,res)=>{
  if(req.user.role!=='STUDENT')throw fail(403,'Student account required');
  const {identity}=z.object({identity:identityDetails,consent:z.literal(true)}).parse(req.body);
  const universityId=req.user.universityId;
  await db.$transaction(async tx=>{
    const row=await tx.studentIdentity.findFirst({
      where:{universityId,student:{userId:req.user.id,archivedAt:null}},
      select:{id:true,studentId:true,status:true,submissionVersion:true},
    });
    if(!row)throw fail(404,'Identity application not found');
    if(row.status!=='REJECTED')throw fail(409,'Only rejected identity applications can be resubmitted');
    const consentAt=new Date();
    const updated=await tx.studentIdentity.updateMany({
      where:{id:row.id,status:'REJECTED',submissionVersion:row.submissionVersion},
      data:{status:'SUBMITTED',submissionVersion:{increment:1},notes:null,reviewedBy:null,reviewedAt:null,
        encryptedDetails:encrypt(JSON.stringify(identity)),fingerprint:identityFingerprint(universityId,identity),
        numberLast4:identity.number.slice(-4),consentAt},
    });
    if(!updated.count)throw fail(409,'Identity application changed, refresh');
    const student=await tx.student.updateMany({where:{id:row.studentId,archivedAt:null},data:{enrollmentStatus:'PENDING_ADMISSION',consentAt}});
    if(!student.count)throw fail(409,'Student record is archived');
    const deduplicationKey=`identity-${row.studentId}`;
    await tx.staffTask.upsert({where:{deduplicationKey},update:{resolvedAt:null},create:{universityId,studentId:row.studentId,reason:identityTaskReason,deduplicationKey}});
    await tx.auditLog.create({data:{universityId,actorId:req.user.id,action:'IDENTITY_REGISTRATION_RESUBMITTED',entityId:row.id}});
  });
  res.sendStatus(204);
});
identityAccount.patch('/student-phone',async(req,res)=>{
  if(req.user.role!=='STUDENT')throw fail(403,'Student account required');
  const input=z.object({phone:z.string().regex(/^\+[1-9]\d{7,14}$/),password:z.string().min(1).max(128)}).parse(req.body);
  if(!await bcrypt.compare(input.password,req.user.passwordHash))throw fail(401,'Current password required');
  await db.$transaction(async tx=>{await tx.student.updateMany({where:{userId:req.user.id,universityId:req.user.universityId,archivedAt:null},data:{phoneEncrypted:encrypt(input.phone),phoneVerifiedAt:null}});await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'STUDENT_PHONE_CHANGED_VERIFICATION_RESET',entityId:req.user.id}});});
  res.sendStatus(204);
});
identityStaff.use(authorize('write'));
const applicationStatus=z.enum(['SUBMITTED','VERIFIED','REJECTED']);
const applicationQuery=z.object({
  status:applicationStatus.optional(),
  page:z.coerce.number().int().min(1).max(1_000_000).optional(),
  pageSize:z.coerce.number().int().min(1).max(100).optional(),
});
function pendingApplications(universityId:string):Prisma.StudentIdentityWhereInput{
  return {universityId,status:'SUBMITTED',student:{archivedAt:null}};
}
identityStaff.get('/applications/pending-count',async(req,res)=>{
  const count=await db.studentIdentity.count({where:pendingApplications(req.user.universityId)});
  res.set('Cache-Control','no-store').json({count});
});
identityStaff.get('/applications',async(req,res)=>{
  const query=applicationQuery.parse(req.query);
  const universityId=req.user.universityId;
  const where=query.status==='SUBMITTED'?pendingApplications(universityId):{universityId,status:query.status};
  const select={id:true,studentId:true,status:true,numberLast4:true,notes:true,createdAt:true,
    student:{select:{fullName:true,studentNumber:true,email:true}}} satisfies Prisma.StudentIdentitySelect;
  const orderBy=[{updatedAt:'desc'},{id:'desc'}] satisfies Prisma.StudentIdentityOrderByWithRelationInput[];
  res.set('Cache-Control','no-store');
  // Preserve the array response for callers that do not request filtering or pagination.
  if(query.page===undefined&&query.pageSize===undefined&&query.status===undefined){
    res.json(await db.studentIdentity.findMany({where,select,orderBy,take:200}));
    return;
  }
  const pageSize=query.pageSize??25;
  const result=await db.$transaction(async tx=>{
    const total=await tx.studentIdentity.count({where});
    const totalPages=Math.max(1,Math.ceil(total/pageSize));
    const page=Math.min(query.page??1,totalPages);
    const rows=await tx.studentIdentity.findMany({where,select,orderBy,skip:(page-1)*pageSize,take:pageSize});
    return {rows,page,pageSize,total,totalPages};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  res.json(result);
});
identityStaff.get('/applications/:id',async(req,res)=>{
  const row=await db.studentIdentity.findFirst({where:{id:String(req.params.id),universityId:req.user.universityId}});if(!row)throw fail(404,'Application not found');
  await db.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'IDENTITY_DETAILS_VIEWED',entityId:row.id}});
  res.set('Cache-Control','no-store').json({id:row.id,status:row.status,submissionVersion:row.submissionVersion,details:JSON.parse(decrypt(row.encryptedDetails))});
});
identityStaff.post('/applications/:id/recovery',async(req,res)=>{
  z.object({originalChecked:z.literal(true)}).parse(req.body);
  const recovery=await issueStudentRecovery(String(req.params.id),req.user);
  res.set('Cache-Control','no-store').status(201).json(recovery);
});
identityStaff.post('/applications/:id/review',async(req,res)=>{
  const input=z.object({state:z.enum(['VERIFIED','REJECTED']),notes:z.string().trim().min(15).max(1000),originalChecked:z.literal(true),submissionVersion:z.number().int().positive().default(1)}).parse(req.body);
  await db.$transaction(async tx=>{
    const row=await tx.studentIdentity.findFirst({where:{id:String(req.params.id),universityId:req.user.universityId}});if(!row)throw fail(404,'Application not found');
    if(row.status!=='SUBMITTED')throw fail(409,'Identity application already reviewed');
    const changed=await tx.studentIdentity.updateMany({where:{id:row.id,status:'SUBMITTED',submissionVersion:input.submissionVersion},data:{status:input.state,notes:input.notes,reviewedBy:req.user.id,reviewedAt:new Date()}});if(!changed.count)throw fail(409,'Application changed, refresh');
    const student=await tx.student.updateMany({where:{id:row.studentId,archivedAt:null},data:{enrollmentStatus:input.state==='VERIFIED'?'ACTIVE':'ADMISSION_REJECTED'}});
    if(!student.count)throw fail(409,'Student record is archived');
    await tx.staffTask.updateMany({where:{deduplicationKey:`identity-${row.studentId}`},data:{resolvedAt:new Date()}});
    await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:`IDENTITY_${input.state}`,entityId:row.id}});
  });res.sendStatus(204);
});
identityStaff.put('/registration-policy',authorize('admin'),async(req,res)=>{
  const {enabled}=z.object({enabled:z.boolean()}).parse(req.body);
  await db.$transaction(async tx=>{await tx.university.update({where:{id:req.user.universityId},data:{studentRegistrationEnabled:enabled}});await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:enabled?'STUDENT_REGISTRATION_OPENED':'STUDENT_REGISTRATION_CLOSED',entityId:req.user.universityId}});});res.sendStatus(204);
});
