import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_THRESHOLDS } from '../src/domain.js';
import { messages } from '../src/notifications.js';
const db=new PrismaClient();
const password=process.env.SEED_ADMIN_PASSWORD,studentPassword=process.env.SEED_STUDENT_PASSWORD;
if(process.env.NODE_ENV==='production')throw new Error('Development seed is disabled in production');
if(!password || password.length<14 || !studentPassword || studentPassword.length<14)throw new Error('Set distinct seed passwords with at least 14 characters');
if(password===studentPassword)throw new Error('Seed passwords must differ');
try {
  const university=await db.university.upsert({where:{slug:'demo'},update:{},create:{slug:'demo',name:'UniVisa Demonstration University',contactEmail:'international@example.invalid',studentRegistrationEnabled:true}});
  const admin=await db.user.upsert({where:{universityId_email:{universityId:university.id,email:process.env.SEED_ADMIN_EMAIL??'admin@example.invalid'}},update:{},create:{universityId:university.id,email:process.env.SEED_ADMIN_EMAIL??'admin@example.invalid',name:'Demo Administrator',role:'UNIVERSITY_ADMIN',passwordHash:await bcrypt.hash(password,12)}});
  const facultyNames=['Engineering','Business & Economics','Medicine','Humanities'];
  const faculties=[];
  for(const name of facultyNames)faculties.push(await db.faculty.upsert({where:{universityId_name:{universityId:university.id,name}},update:{},create:{universityId:university.id,name}}));
  for(const daysRemaining of DEFAULT_THRESHOLDS)await db.notificationRule.upsert({where:{universityId_daysRemaining:{universityId:university.id,daysRemaining}},update:{},create:{universityId:university.id,daysRemaining,escalate:[14,0].includes(daysRemaining)}});
  await db.smsProviderConfiguration.upsert({where:{universityId:university.id},update:{},create:{universityId:university.id,provider:'mock'}});
  for(const [language,templates] of Object.entries(messages))for(const [kind,body]of Object.entries(templates))await db.notificationTemplate.upsert({where:{universityId_language_kind:{universityId:university.id,language,kind}},update:{},create:{universityId:university.id,language,kind,body}});
  const names=['Sample Student Alpha','Sample Student Beta','Sample Student Gamma','Sample Student Delta','Sample Student Epsilon','Sample Student Zeta','Sample Student Eta','Sample Student Theta'];
  for(let i=0;i<names.length;i++) {
    const email=`student${i+1}@example.invalid`;
    const user=await db.user.upsert({where:{universityId_email:{universityId:university.id,email}},update:{},create:{universityId:university.id,email,name:names[i],role:'STUDENT',passwordHash:await bcrypt.hash(studentPassword,12)}});
    const student=await db.student.upsert({where:{universityId_studentNumber:{universityId:university.id,studentNumber:`DEMO-${1001+i}`}},update:{},create:{universityId:university.id,userId:user.id,studentNumber:`DEMO-${1001+i}`,fullName:names[i],facultyId:faculties[i%4].id,program:'International Studies',year:i%4+1,group:`INT-${i%3+1}`,nationality:['India','China','Kazakhstan','Pakistan'][i%4],language:['en','uz','ru'][i%3],email,officerId:admin.id}});
    if(!await db.studentDocument.count({where:{studentId:student.id}})) {
      const expiry=new Date();expiry.setUTCDate(expiry.getUTCDate()+[-3,0,4,7,14,21,30,180][i]);expiry.setUTCHours(0,0,0,0);
      const issue=new Date(expiry);issue.setUTCFullYear(issue.getUTCFullYear()-1);
      const document=await db.studentDocument.create({data:{universityId:university.id,studentId:student.id,type:i%2?'VISA':'TEMPORARY_REGISTRATION',issueDate:issue,expirationDate:expiry,officerId:admin.id}});
      await db.documentVersion.create({data:{universityId:university.id,documentId:document.id,version:1,issueDate:issue,expirationDate:expiry,verifiedBy:admin.id,notes:'Synthetic development data only'}});
    }
  }
  console.log('Seed complete. Tenant slug: demo. Student login: student1@example.invalid. All records are synthetic.');
} finally {await db.$disconnect();}
