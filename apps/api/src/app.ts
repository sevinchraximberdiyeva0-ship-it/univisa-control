import { languageSchema } from './languages.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { z, ZodError } from 'zod';
import multer from 'multer';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { DateTime } from 'luxon';
import { db } from './db.js';
import { config } from './config.js';
import { authenticate,authorize,createSession,fail,ownStudent,publicUser,studentScope } from './auth.js';
import { decrypt,encrypt,equal,hash,token } from './security.js';
import { assertTransition,dates,previewImport,remaining,studentInput } from './domain.js';
import { confirmation,messages,planDocument,render } from './notifications.js';
import { telegramRouter } from './telegram.js';
import { smsReceiptRouter } from './sms-receipts.js';
import { notificationAdmin } from './notification-admin.js';
import { passkeyRouter } from './passkeys.js';
import { identityPublic,identityAccount,identityStaff } from './identity.js';
import { emailVerificationRouter } from './email-verification.js';
import { passportLoginRouter } from './passport-login.js';
import { accountRecoveryRouter } from './account-recovery.js';
export const app=express();
app.disable('x-powered-by');
app.use(helmet());app.use(cors({origin:config.APP_ORIGIN,credentials:true}));app.use(express.json({limit:'2mb',verify:(req,_res,buffer)=>{(req as express.Request).rawBody=Buffer.from(buffer);}}));app.use(cookieParser());
app.use(rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-8',legacyHeaders:false}));
app.get('/api/health',async(_req,res)=>{await db.$queryRaw`SELECT 1`;res.json({status:'ok',sms:config.SMS_MODE,telegram:config.TELEGRAM_MODE});});
const authLimit=rateLimit({windowMs:15*60000,limit:20,standardHeaders:'draft-8',legacyHeaders:false});
app.use('/api/auth/passkeys',passkeyRouter);
app.use('/api/auth/passport-login',passportLoginRouter);
app.use('/api/auth/account-recovery',accountRecoveryRouter);
app.use('/api/auth',identityPublic);
app.post('/api/auth/login',authLimit,async(req,res)=>{
  const input=z.object({university:z.string(),email:z.string().email(),password:z.string().min(1).max(128),otp:z.string().optional()}).parse(req.body);
  const university=await db.university.findUnique({where:{slug:input.university}});
  const user=university?await db.user.findUnique({where:{universityId_email:{universityId:university.id,email:input.email.toLowerCase()}}}):null;
  const valid=await bcrypt.compare(input.password,user?.passwordHash??'$2b$12$JZiG7XqhQYYSE.TMNX1OfOQ0vP5mOdqAmM5VHg.uTgUB6p6xYzU3W');
  if(!user || !valid || !user.active)throw fail(401,'Invalid credentials');
  let verified=false;
  if(user.mfaEnabled) {
    if(!input.otp || !user.mfaSecret || !authenticator.check(input.otp,decrypt(user.mfaSecret)))throw fail(401,'Valid MFA code required');
    const step=BigInt(Math.floor(Date.now()/30000));
    const updated=await db.user.updateMany({where:{id:user.id,OR:[{lastTotpStep:null},{lastTotpStep:{lt:step}}]},data:{lastTotpStep:step}});
    if(!updated.count)throw fail(401,'MFA code already used'); verified=true;
  }
  const csrf=await createSession(user,res,verified);
  res.json({user:publicUser(user),csrf});
});
app.use('/api/telegram/webhook',telegramRouter);
app.use('/api/sms/devsms',smsReceiptRouter);
app.post('/api/sms/receipts',async(req,res)=>{
  if(!config.SMS_WEBHOOK_SECRET || !equal(String(req.headers['x-webhook-secret']??''),config.SMS_WEBHOOK_SECRET))throw fail(401,'Invalid webhook secret');
  const input=z.object({providerMessageId:z.string(),state:z.enum(['DELIVERED','FAILED'])}).parse(req.body);
  // Mock receipts cannot promote a test send into a real delivery claim.
  const result=await db.notificationJob.updateMany({where:{providerMessageId:input.providerMessageId,provider:'legacy',channel:'SMS',state:'ACCEPTED'},data:{state:input.state}});
  res.json({updated:result.count});
});
app.use('/api',authenticate);
app.use('/api/auth',identityAccount);
app.use('/api/auth/email-verification',emailVerificationRouter);
app.get('/api/auth/me',async(req,res)=>res.json({user:publicUser(req.user),mfaVerified:req.session.mfaVerified,identity:req.user.role==='STUDENT'?await db.studentIdentity.findFirst({where:{universityId:req.user.universityId,student:{userId:req.user.id}},select:{status:true,numberLast4:true,notes:true}}):null}));
app.post('/api/auth/logout',async(req,res)=>{await db.session.delete({where:{id:req.session.id}});res.clearCookie('uv_session',{path:'/api'});res.clearCookie('uv_csrf',{path:'/'});res.sendStatus(204);});
app.post('/api/auth/mfa/setup',async(req,res)=>{
  if(req.user.mfaEnabled)throw fail(409,'MFA already enrolled');
  const secret=authenticator.generateSecret();await db.user.update({where:{id:req.user.id},data:{mfaSecret:encrypt(secret)}});
  res.json({secret,uri:authenticator.keyuri(req.user.email,'UniVisa Control',secret)});
});
app.post('/api/auth/mfa/verify',authLimit,async(req,res)=>{
  const {otp}=z.object({otp:z.string().regex(/^\d{6}$/)}).parse(req.body);
  if(req.user.mfaEnabled || !req.user.mfaSecret || !authenticator.check(otp,decrypt(req.user.mfaSecret)))throw fail(400,'Invalid enrollment code');
  await db.$transaction([db.user.update({where:{id:req.user.id},data:{mfaEnabled:true,lastTotpStep:BigInt(Math.floor(Date.now()/30000))}}),db.session.deleteMany({where:{userId:req.user.id,id:{not:req.session.id}}}),db.session.update({where:{id:req.session.id},data:{mfaVerified:true}})]);res.json({verified:true});
});
app.use('/api',authorize());
app.use('/api/notifications',notificationAdmin);
app.use('/api/identity',identityStaff);
async function audit(universityId:string,actorId:string,action:string,entityId:string) {await db.auditLog.create({data:{universityId,actorId,action,entityId}});}
app.get('/api/university',async(req,res)=>res.json(await db.university.findUniqueOrThrow({where:{id:req.user.universityId}})));
app.get('/api/rules',async(req,res)=>res.json(await db.notificationRule.findMany({where:{universityId:req.user.universityId,enabled:true},orderBy:{daysRemaining:'desc'}})));
app.get('/api/universities',async(req,res)=>{if(req.user.role!=='SUPER_ADMIN')throw fail(403,'Platform administrator required');res.json(await db.university.findMany({select:{id:true,name:true,slug:true,timezone:true,contactEmail:true}}));});
app.post('/api/universities',async(req,res)=>{
  if(req.user.role!=='SUPER_ADMIN')throw fail(403,'Platform administrator required');
  const input=z.object({name:z.string().min(3).max(150),slug:z.string().regex(/^[a-z0-9-]{3,50}$/),contactEmail:z.string().email(),timezone:z.string().refine(v=>DateTime.now().setZone(v).isValid),adminEmail:z.string().email(),adminName:z.string().min(2),adminPassword:z.string().min(14).max(128)}).parse(req.body);
  const passwordHash=await bcrypt.hash(input.adminPassword,12);
  const created=await db.$transaction(async tx=>{const university=await tx.university.create({data:{name:input.name,slug:input.slug,contactEmail:input.contactEmail,timezone:input.timezone}});await tx.user.create({data:{universityId:university.id,email:input.adminEmail.toLowerCase(),name:input.adminName,passwordHash,role:'UNIVERSITY_ADMIN'}});await tx.smsProviderConfiguration.create({data:{universityId:university.id}});await tx.auditLog.create({data:{universityId:university.id,actorId:req.user.id,action:'UNIVERSITY_PROVISIONED',entityId:university.id}});return university;});res.status(201).json(created);
});
app.get('/api/profile',async(req,res)=>{
  if(req.user.role!=='STUDENT')throw fail(403,'Student account required');
  const profile=await db.student.findFirst({where:await studentScope(req),select:{language:true,smsEnabled:true,telegramEnabled:true}});
  if(!profile)throw fail(404,'Student record not found');
  res.json(profile);
});
app.patch('/api/profile',async(req,res)=>{
  if(req.user.role!=='STUDENT')throw fail(403,'Student account required');
  const input=z.object({language:languageSchema,smsEnabled:z.boolean().optional(),telegramEnabled:z.boolean().optional()}).parse(req.body);
  const result=await db.student.updateMany({where:await studentScope(req),data:input});
  if(!result.count)throw fail(404,'Student record not found');
  await audit(req.user.universityId,req.user.id,'NOTIFICATION_PREFERENCES_UPDATED',req.user.id);res.sendStatus(204);
});
app.get('/api/faculties',async(req,res)=>res.json(await db.faculty.findMany({where:{universityId:req.user.universityId,...(req.user.role==='FACULTY_COORDINATOR'?{id:req.user.facultyId??'none'}:{})},orderBy:{name:'asc'}})));
app.get('/api/students',async(req,res)=>{
  const search=z.string().max(100).parse(req.query.search??'');
  const records=await db.student.findMany({where:{...await studentScope(req),...(search?{OR:[{fullName:{contains:search,mode:'insensitive'}},{studentNumber:{contains:search,mode:'insensitive'}}]}:{})},include:{faculty:true,documents:true,telegram:{select:{linkedAt:true,blocked:true}}},take:500,orderBy:{fullName:'asc'}});
  const university=await db.university.findUniqueOrThrow({where:{id:req.user.universityId}});
  res.json(records.map(({phoneEncrypted,...s})=>({...s,phoneAvailable:!!phoneEncrypted,documents:s.documents.map(d=>({...d,daysRemaining:remaining(d.expirationDate,new Date(),university.timezone)}))})));
});
async function validateReferences(universityId:string,facultyId:string,officerId?:string) {
  if(!await db.faculty.findFirst({where:{id:facultyId,universityId}}))throw fail(400,'Unknown faculty');
  if(officerId && !await db.user.findFirst({where:{id:officerId,universityId,role:{in:['INTERNATIONAL_OFFICE','UNIVERSITY_ADMIN']},active:true}}))throw fail(400,'Unknown responsible officer');
}
app.post('/api/students',authorize('write'),async(req,res)=>{
  const {phone,...input}=studentInput.parse(req.body);await validateReferences(req.user.universityId,input.facultyId,input.officerId);
  const student=await db.$transaction(async tx=>{const s=await tx.student.create({data:{...input,universityId:req.user.universityId,phoneEncrypted:phone?encrypt(phone):null}});await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'STUDENT_CREATED',entityId:s.id}});return s;});
  res.status(201).json({id:student.id});
});
app.patch('/api/students/:id',authorize('write'),async(req,res)=>{
  const id=String(req.params.id);await ownStudent(req,id); const {phone,...input}=studentInput.parse(req.body);await validateReferences(req.user.universityId,input.facultyId,input.officerId);
  await db.student.update({where:{id},data:{...input,...(phone?{phoneEncrypted:encrypt(phone),phoneVerifiedAt:null}:{})}});await audit(req.user.universityId,req.user.id,'STUDENT_UPDATED',id);res.sendStatus(204);
});
app.delete('/api/students/:id',authorize('admin'),async(req,res)=>{
  const id=String(req.params.id);await ownStudent(req,id);
  await db.$transaction(async tx=>{await tx.student.update({where:{id},data:{archivedAt:new Date(),enrollmentStatus:'ARCHIVED'}});await tx.notificationJob.updateMany({where:{universityId:req.user.universityId,studentId:id,state:'PENDING'},data:{state:'CANCELED'}});await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'STUDENT_ARCHIVED',entityId:id}});});res.sendStatus(204);
});
app.post('/api/students/:id/phone-verification',authorize('write'),async(req,res)=>{
  const id=String(req.params.id);const student=await ownStudent(req,id);const {evidence}=z.object({evidence:z.string().min(15).max(1000)}).parse(req.body);
  if(!student.phoneEncrypted)throw fail(400,'No phone number');
  await db.$transaction(async tx=>{await tx.student.update({where:{id},data:{phoneVerifiedAt:new Date()}});await tx.systemSetting.upsert({where:{universityId_key:{universityId:req.user.universityId,key:`phone-evidence-${id}`}},update:{value:{evidence:encrypt(evidence),actor:req.user.id}},create:{universityId:req.user.universityId,key:`phone-evidence-${id}`,value:{evidence:encrypt(evidence),actor:req.user.id}}});await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'PHONE_VERIFIED_BY_STAFF',entityId:id}});});res.sendStatus(204);
});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1}});
app.post('/api/import/preview',authorize('write'),upload.single('file'),async(req,res)=>{
  if(!req.file)throw fail(400,'CSV or XLSX file required');
  let rows:unknown[];
  const extension=path.extname(req.file.originalname).toLowerCase();
  if(extension==='.csv')rows=parse(req.file.buffer,{columns:true,skip_empty_lines:true,bom:true});
  else if(extension==='.xlsx') {
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(req.file.buffer as any);
    const sheet=workbook.worksheets[0];if(!sheet || sheet.rowCount>1001)throw fail(400,'Import limit: 1000 rows');
    const headers=(sheet.getRow(1).values as unknown[]).slice(1).map(String);rows=[];
    sheet.eachRow((row,index)=>{if(index>1)rows.push(Object.fromEntries(headers.map((key,i)=>[key,row.getCell(i+1).text])));});
  }else throw fail(400,'Only CSV or XLSX accepted');
  if(rows.length>1000)throw fail(400,'Import limit: 1000 rows');
  const existing=await db.student.findMany({where:{universityId:req.user.universityId},select:{studentNumber:true,email:true}});
  res.json(previewImport(rows,existing.map(s=>s.studentNumber),existing.map(s=>s.email)));
});
app.post('/api/import/commit',authorize('write'),async(req,res)=>{
  const rows=z.array(studentInput).min(1).max(1000).parse(req.body.rows);
  for(const row of rows)await validateReferences(req.user.universityId,row.facultyId,row.officerId);
  const result=await db.$transaction(async tx=>{for(const {phone,...row} of rows)await tx.student.create({data:{...row,universityId:req.user.universityId,phoneEncrypted:phone?encrypt(phone):null}});await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'BULK_IMPORT',entityId:String(rows.length)}});return rows.length;});res.json({created:result});
});
app.get('/api/export/students',async(req,res)=>{
  if(req.user.role==='STUDENT')throw fail(403,'Staff only');
  const records=await db.student.findMany({where:await studentScope(req),select:{studentNumber:true,fullName:true,nationality:true,program:true,year:true}});
  const sanitized=records.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='string' && /^[=+@\-\t\r]/.test(v)?`'${v}`:v])));
  const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Students');sheet.columns=Object.keys(sanitized[0]??{studentNumber:''}).map(key=>({header:key,key,width:24}));sheet.addRows(sanitized);
  await audit(req.user.universityId,req.user.id,'STUDENT_EXPORT','registry');res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('students.xlsx').send(Buffer.from(await workbook.xlsx.writeBuffer()));
});
app.get('/api/documents',async(req,res)=>{
  const university=await db.university.findUniqueOrThrow({where:{id:req.user.universityId}});
  const documents=await db.studentDocument.findMany({where:{universityId:req.user.universityId,archivedAt:null,student:await studentScope(req)},include:{student:{select:{fullName:true,studentNumber:true,facultyId:true}},versions:true},orderBy:{expirationDate:'asc'},take:1000});
  res.json(documents.map(d=>({...d,daysRemaining:remaining(d.expirationDate,new Date(),university.timezone)})));
});
app.post('/api/documents',authorize('write'),async(req,res)=>{
  const input=z.object({studentId:z.string(),type:z.string().min(2).max(80),issueDate:z.string(),expirationDate:z.string(),notes:z.string().min(10).max(1000)}).parse(req.body);dates.parse(input);await ownStudent(req,input.studentId);
  const document=await db.$transaction(async tx=>{const d=await tx.studentDocument.create({data:{universityId:req.user.universityId,studentId:input.studentId,type:input.type,issueDate:new Date(input.issueDate),expirationDate:new Date(input.expirationDate),officerId:req.user.id}});await tx.documentVersion.create({data:{universityId:d.universityId,documentId:d.id,version:1,issueDate:d.issueDate,expirationDate:d.expirationDate,verifiedBy:req.user.id,notes:input.notes}});await planDocument(tx,d);await tx.auditLog.create({data:{universityId:d.universityId,actorId:req.user.id,action:'DOCUMENT_VERIFIED_CREATED',entityId:d.id}});return d;});res.status(201).json(document);
});
app.post('/api/files',upload.single('file'),async(req,res)=>{
  if(!['STUDENT','INTERNATIONAL_OFFICE','UNIVERSITY_ADMIN','SUPER_ADMIN'].includes(req.user.role))throw fail(403,'Upload not permitted');
  const studentId=z.string().parse(req.body.studentId);await ownStudent(req,studentId);
  const file=req.file;if(!file)throw fail(400,'File required');
  const pdf=file.buffer.subarray(0,5).toString()==='%PDF-',png=file.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=file.buffer[0]===255&&file.buffer[1]===216&&file.buffer[2]===255;
  if(!pdf&&!png&&!jpeg)throw fail(400,'Only PDF, PNG or JPEG content accepted');
  const storageKey=token();await mkdir(config.STORAGE_PATH,{recursive:true});await writeFile(path.join(config.STORAGE_PATH,storageKey),encrypt(file.buffer.toString('base64')),{mode:0o600});
  const saved=await db.privateFile.create({data:{universityId:req.user.universityId,studentId,storageKey,mimeType:pdf?'application/pdf':png?'image/png':'image/jpeg',size:file.size,uploadedBy:req.user.id}});await audit(req.user.universityId,req.user.id,'FILE_UPLOADED',saved.id);res.status(201).json({id:saved.id});
});
app.get('/api/files/:id',async(req,res)=>{
  const file=await db.privateFile.findFirst({where:{id:String(req.params.id),universityId:req.user.universityId}});if(!file)throw fail(404,'File not found');await ownStudent(req,file.studentId);await audit(req.user.universityId,req.user.id,'FILE_DOWNLOADED',file.id);
  res.set('Cache-Control','no-store').type(file.mimeType).attachment(`document.${file.mimeType==='application/pdf'?'pdf':file.mimeType==='image/png'?'png':'jpg'}`).send(Buffer.from(decrypt(await readFile(path.join(config.STORAGE_PATH,file.storageKey),'utf8')),'base64'));
});
app.get('/api/renewals',async(req,res)=>res.json(await db.renewalApplication.findMany({where:{universityId:req.user.universityId,document:{student:await studentScope(req)}},include:{document:{include:{student:{select:{fullName:true}}}}},orderBy:{createdAt:'desc'},take:500})));
app.post('/api/renewals',async(req,res)=>{
  if(!['STUDENT','INTERNATIONAL_OFFICE','UNIVERSITY_ADMIN','SUPER_ADMIN'].includes(req.user.role))throw fail(403,'Submission not permitted');
  const input=z.object({documentId:z.string(),fileId:z.string(),issueDate:z.string(),expirationDate:z.string()}).parse(req.body);dates.parse(input);
  const document=await db.studentDocument.findFirst({where:{id:input.documentId,universityId:req.user.universityId,archivedAt:null,student:await studentScope(req)}});if(!document)throw fail(404,'Document not found');
  if(!await db.privateFile.findFirst({where:{id:input.fileId,universityId:req.user.universityId,studentId:document.studentId}}))throw fail(400,'Invalid supporting file');
  const application=await db.$transaction(async tx=>{const a=await tx.renewalApplication.create({data:{...input,universityId:req.user.universityId,issueDate:new Date(input.issueDate),expirationDate:new Date(input.expirationDate),baseVersion:document.activeVersion,state:'SUBMITTED',submittedBy:req.user.id}});await tx.staffTask.create({data:{universityId:req.user.universityId,studentId:document.studentId,assignedTo:document.officerId,reason:'Renewal awaiting document review',deduplicationKey:`renewal-${a.id}`}});await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'RENEWAL_SUBMITTED',entityId:a.id}});return a;});res.status(201).json(application);
});
app.post('/api/renewals/:id/review',authorize('write'),async(req,res)=>{
  const input=z.object({state:z.enum(['UNDER_REVIEW','VERIFIED','REJECTED','NEEDS_CORRECTION']),notes:z.string().min(10).max(2000)}).parse(req.body);
  const id=String(req.params.id);
  const result=await db.$transaction(async tx=>{
    const first=await tx.renewalApplication.findFirst({where:{id,universityId:req.user.universityId}});if(!first)throw fail(404,'Application not found');
    await tx.$queryRaw`SELECT id FROM "StudentDocument" WHERE id = ${first.documentId} FOR UPDATE`;
    const application=await tx.renewalApplication.findUniqueOrThrow({where:{id}});
    if(application.state==='VERIFIED' && input.state==='VERIFIED')return application;
    assertTransition(application.state,input.state);
    const document=await tx.studentDocument.findUniqueOrThrow({where:{id:application.documentId}});
    if(document.activeVersion!==application.baseVersion)throw fail(409,'Application concerns an obsolete document version');
    if(application.submittedBy===req.user.id && input.state==='VERIFIED')throw fail(403,'A different officer must verify this submission');
    if(input.state==='VERIFIED') {
      const version=document.activeVersion+1;
      await tx.documentVersion.create({data:{universityId:req.user.universityId,documentId:document.id,version,issueDate:application.issueDate,expirationDate:application.expirationDate,fileId:application.fileId,verifiedBy:req.user.id,notes:input.notes}});
      const updated=await tx.studentDocument.update({where:{id:document.id},data:{activeVersion:version,issueDate:application.issueDate,expirationDate:application.expirationDate}});
      await tx.notificationJob.updateMany({where:{documentId:document.id,version:document.activeVersion,state:'PENDING'},data:{state:'CANCELED'}});
      await tx.staffTask.updateMany({where:{universityId:document.universityId,deduplicationKey:{startsWith:`${document.id}-${document.activeVersion}-`},resolvedAt:null},data:{resolvedAt:new Date()}});
      await planDocument(tx,updated);await confirmation(tx,updated);
      await tx.staffTask.updateMany({where:{deduplicationKey:`renewal-${id}`},data:{resolvedAt:new Date()}});
    }
    const event=await tx.documentVerification.create({data:{universityId:req.user.universityId,applicationId:id,actorId:req.user.id,state:input.state,notes:input.notes}});
    if(['REJECTED','NEEDS_CORRECTION'].includes(input.state))for(const channel of ['SMS','TELEGRAM','IN_APP']as const)await tx.notificationJob.create({data:{universityId:document.universityId,studentId:document.studentId,documentId:document.id,version:document.activeVersion,kind:'CORRECTION',channel,scheduledDate:new Date().toISOString().slice(0,10),scheduledAt:new Date(),idempotencyKey:`correction-${event.id}-${channel}`}});
    await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:`RENEWAL_${input.state}`,entityId:id}});
    return tx.renewalApplication.update({where:{id},data:{state:input.state,notes:input.notes,reviewedBy:req.user.id,reviewedAt:new Date()}});
  });res.json(result);
});
app.post('/api/renewals/:id/resubmit',async(req,res)=>{
  const input=z.object({fileId:z.string(),issueDate:z.string(),expirationDate:z.string()}).parse(req.body);dates.parse(input);
  const application=await db.renewalApplication.findFirst({where:{id:String(req.params.id),universityId:req.user.universityId,submittedBy:req.user.id,document:{student:await studentScope(req)}}});if(!application)throw fail(404,'Application not found');assertTransition(application.state,'SUBMITTED');
  const document=await db.studentDocument.findUniqueOrThrow({where:{id:application.documentId}});
  if(!await db.privateFile.findFirst({where:{id:input.fileId,studentId:document.studentId,universityId:req.user.universityId}}))throw fail(400,'Invalid supporting file');
  const result=await db.renewalApplication.updateMany({where:{id:application.id,state:application.state},data:{fileId:input.fileId,issueDate:new Date(input.issueDate),expirationDate:new Date(input.expirationDate),state:'SUBMITTED',notes:null}});if(!result.count)throw fail(409,'Application changed, refresh and retry');await audit(req.user.universityId,req.user.id,'RENEWAL_RESUBMITTED',application.id);res.sendStatus(204);
});
app.get('/api/dashboard',async(req,res)=>{
  const scope=await studentScope(req);const university=await db.university.findUniqueOrThrow({where:{id:req.user.universityId}});
  const students=await db.student.findMany({where:scope,include:{documents:{where:{archivedAt:null}},telegram:true}});const ids=students.map(s=>s.id);
  const days=students.flatMap(s=>s.documents.map(d=>remaining(d.expirationDate,new Date(),university.timezone)));
  const jobs={universityId:req.user.universityId,studentId:{in:ids}};
  res.json({totalStudents:students.length,activeDocuments:days.filter(d=>d>=0).length,within30:days.filter(d=>d>=0&&d<=30).length,within14:days.filter(d=>d>=0&&d<=14).length,within7:days.filter(d=>d>=0&&d<=7).length,expired:days.filter(d=>d<0).length,pending:await db.renewalApplication.count({where:{universityId:req.user.universityId,state:{in:['SUBMITTED','UNDER_REVIEW']},document:{studentId:{in:ids}}}}),renewed:await db.renewalApplication.count({where:{universityId:req.user.universityId,state:'VERIFIED',document:{studentId:{in:ids}}}}),unreachable:students.filter(s=>!s.phoneVerifiedAt&&(!s.telegram||s.telegram.blocked)).length,failed:await db.notificationJob.count({where:{...jobs,state:{in:['FAILED','UNKNOWN','UNAVAILABLE']}}}),countries:Object.entries(students.reduce<Record<string,number>>((r,s)=>(r[s.nationality]=(r[s.nationality]??0)+1,r),{})).map(([name,value])=>({name,value}))});
});
app.get('/api/notifications',async(req,res)=>{
  const students=await db.student.findMany({where:await studentScope(req),select:{id:true,language:true}});
  const jobs=await db.notificationJob.findMany({where:{universityId:req.user.universityId,studentId:{in:students.map(s=>s.id)}},include:{attempts:true},take:500,orderBy:{createdAt:'desc'}});
  const documents=await db.studentDocument.findMany({where:{universityId:req.user.universityId,id:{in:jobs.map(j=>j.documentId)}},include:{versions:true}});
  const university=await db.university.findUniqueOrThrow({where:{id:req.user.universityId}});
  res.json(jobs.map(({messageEncrypted,...job})=>{const document=documents.find(d=>d.id===job.documentId);const version=document?.versions.find(v=>v.version===job.version);const expiry=version?.expirationDate??document?.expirationDate;const student=students.find(s=>s.id===job.studentId);return {...job,message:messageEncrypted?decrypt(messageEncrypted):document&&expiry?render(student?.language??'en',job.kind,document.type,expiry.toISOString().slice(0,10),remaining(expiry,job.scheduledAt,university.timezone)):undefined};}));
});
app.post('/api/notifications/:id/acknowledge',async(req,res)=>{if(req.user.role!=='STUDENT')throw fail(403,'Student acknowledgement required');const student=await db.student.findFirstOrThrow({where:{userId:req.user.id,universityId:req.user.universityId}});const result=await db.notificationJob.updateMany({where:{id:String(req.params.id),studentId:student.id,universityId:req.user.universityId},data:{acknowledgedAt:new Date()}});if(!result.count)throw fail(404,'Notification not found');res.sendStatus(204);});
app.get('/api/staff',authorize('admin'),async(req,res)=>res.json(await db.user.findMany({where:{universityId:req.user.universityId,role:{not:'STUDENT'}},select:{id:true,name:true,email:true,role:true,active:true,mfaEnabled:true}})));
app.post('/api/staff',authorize('admin'),async(req,res)=>{
  const input=z.object({name:z.string().min(2),email:z.string().email(),password:z.string().min(14).max(128),role:z.enum(['UNIVERSITY_ADMIN','INTERNATIONAL_OFFICE','FACULTY_COORDINATOR','AUDITOR']),facultyId:z.string().optional()}).parse(req.body);
  if(input.role==='FACULTY_COORDINATOR'&&!input.facultyId)throw fail(400,'Faculty is required');if(input.facultyId)await validateReferences(req.user.universityId,input.facultyId);
  const {password,...data}=input;const user=await db.user.create({data:{...data,email:data.email.toLowerCase(),universityId:req.user.universityId,passwordHash:await bcrypt.hash(password,12)}});await audit(req.user.universityId,req.user.id,'STAFF_CREATED',user.id);res.status(201).json(publicUser(user));
});
app.get('/api/audit',async(req,res)=>{if(!['SUPER_ADMIN','UNIVERSITY_ADMIN','AUDITOR'].includes(req.user.role))throw fail(403,'Audit access restricted');res.json(await db.auditLog.findMany({where:{universityId:req.user.universityId},orderBy:{createdAt:'desc'},take:500}));});
app.get('/api/tasks',async(req,res)=>{if(req.user.role==='STUDENT')throw fail(403,'Staff only');const students=await db.student.findMany({where:await studentScope(req),select:{id:true}});res.json(await db.staffTask.findMany({where:{universityId:req.user.universityId,studentId:{in:students.map(s=>s.id)},resolvedAt:null},orderBy:{createdAt:'desc'},take:500}));});
app.get('/api/settings',authorize('admin'),async(req,res)=>{
  const universityId=req.user.universityId;
  const [university,rules,sms,storedTemplates]=await Promise.all([
    db.university.findUnique({where:{id:universityId}}),
    db.notificationRule.findMany({where:{universityId},orderBy:{daysRemaining:'desc'}}),
    db.smsProviderConfiguration.findUnique({where:{universityId},select:{provider:true,monthlyQuota:true,unitCost:true}}),
    db.notificationTemplate.findMany({where:{universityId}}),
  ]);
  const templates=new Map<string,{language:string;kind:string;body:string}>();
  for(const language of languageSchema.options){
    for(const [kind,body] of Object.entries(messages[language]))templates.set(`${language}:${kind}`,{language,kind,body});
  }
  for(const template of storedTemplates)templates.set(`${template.language}:${template.kind}`,template);
  res.json({university,rules,sms,templates:[...templates.values()]});
});
app.put('/api/settings',authorize('admin'),async(req,res)=>{
  const input=z.object({timezone:z.string().refine(v=>DateTime.now().setZone(v).isValid),deliveryStart:z.number().int().min(0).max(23),deliveryEnd:z.number().int().min(1).max(24),thresholds:z.array(z.number().int().min(0).max(365)).min(1).max(40),contactEmail:z.string().email(),retentionDays:z.number().int().min(30).max(3650)}).refine(v=>v.deliveryStart<v.deliveryEnd).parse(req.body);
  await db.$transaction(async tx=>{
    const {thresholds,...settings}=input;await tx.university.update({where:{id:req.user.universityId},data:{...settings,reminderRevision:{increment:1}}});
    await tx.notificationRule.deleteMany({where:{universityId:req.user.universityId}});await tx.notificationRule.createMany({data:[...new Set(thresholds)].map(daysRemaining=>({universityId:req.user.universityId,daysRemaining,escalate:daysRemaining===14||daysRemaining===0}))});
    const documents=await tx.studentDocument.findMany({where:{universityId:req.user.universityId,archivedAt:null},orderBy:{id:'asc'}});
    for(const document of documents){await tx.$queryRaw`SELECT id FROM "StudentDocument" WHERE id = ${document.id} FOR UPDATE`;const current=await tx.studentDocument.findUniqueOrThrow({where:{id:document.id}});await tx.notificationJob.updateMany({where:{documentId:current.id,kind:'REMINDER',state:'PENDING'},data:{state:'CANCELED'}});await planDocument(tx,current);}
    await tx.auditLog.create({data:{universityId:req.user.universityId,actorId:req.user.id,action:'REMINDER_SETTINGS_UPDATED',entityId:req.user.universityId}});
  },{timeout:60000});res.sendStatus(204);
});
app.put('/api/sms/settings',authorize('admin'),async(req,res)=>{const input=z.object({monthlyQuota:z.number().int().min(0).max(1000000),unitCost:z.number().min(0).max(100000)}).parse(req.body);await db.smsProviderConfiguration.upsert({where:{universityId:req.user.universityId},update:input,create:{...input,universityId:req.user.universityId,provider:'mock'}});await audit(req.user.universityId,req.user.id,'SMS_BUDGET_UPDATED',req.user.universityId);res.sendStatus(204);});
app.put('/api/templates',authorize('admin'),async(req,res)=>{const input=z.object({language:languageSchema,kind:z.enum(['confirmed','reminder','critical']),body:z.string().min(10).max(1200)}).parse(req.body);await db.notificationTemplate.upsert({where:{universityId_language_kind:{universityId:req.user.universityId,language:input.language,kind:input.kind}},update:{body:input.body},create:{...input,universityId:req.user.universityId}});await audit(req.user.universityId,req.user.id,'TEMPLATE_UPDATED',`${input.language}-${input.kind}`);res.sendStatus(204);});
app.post('/api/telegram/link-token',async(req,res)=>{
  if(req.user.role!=='STUDENT')throw fail(403,'Student account required');const student=await db.student.findFirstOrThrow({where:{userId:req.user.id,universityId:req.user.universityId}});const value=token();
  await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Student" WHERE id=${student.id} FOR UPDATE`;await tx.telegramLinkToken.deleteMany({where:{studentId:student.id}});await tx.telegramLinkToken.create({data:{hash:hash(value),universityId:req.user.universityId,studentId:student.id,expiresAt:new Date(Date.now()+5*60000)}});});res.json({token:value,expiresIn:300,mode:config.TELEGRAM_MODE});
});
app.use('/api',(_req,_res,next)=>next(fail(404,'Endpoint not found')));
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const e=error as {status?:number;code?:string};const status=error instanceof ZodError?400:e.code==='P2002'?409:e.status??500;
  res.status(status).json({error:error instanceof ZodError?'Validation failed':e.code==='P2002'?'A matching account, student record or identity already exists':status===500?'Internal server error':error instanceof Error?error.message:'Request failed',...(error instanceof ZodError?{issues:error.issues.map(i=>({path:i.path,message:i.message}))}:{})});
});
