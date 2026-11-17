import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import request from 'supertest';
import {randomBytes} from 'node:crypto';
const enabled=!!process.env.TEST_DATABASE_URL;
describe.skipIf(!enabled)('ID/passport registration and passkey boundaries',()=>{
  let db:any,app:any,university:any,faculty:any,otherUniversity:any,staff:any,studentCookie:string,studentCsrf:string,studentId:string,identityId:string;
  const password=randomBytes(24).toString('hex'),csrf='identity-fixture-csrf',staffRaw=randomBytes(24).toString('hex');
  const identity={type:'PASSPORT',country:'UZ',number:'TESTONLY0001',dateOfBirth:'2000-01-01',issueDate:'2025-01-01',expirationDate:'2035-01-01'};
  const origin='http://localhost:5173';
  beforeAll(async()=>{
    process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.NODE_ENV='test';process.env.ENCRYPTION_KEY='a'.repeat(64);
    ({db}=await import('../src/db.js'));({app}=await import('../src/app.js'));const {hash}=await import('../src/security.js');
    const slug=`identity-${Date.now()}`;
    university=await db.university.create({data:{slug,name:'Synthetic identity university',contactEmail:'office@example.invalid',studentRegistrationEnabled:true}});
    otherUniversity=await db.university.create({data:{slug:slug+'-other',name:'Other university',contactEmail:'office@example.invalid'}});
    faculty=await db.faculty.create({data:{universityId:university.id,name:'Test Faculty'}});
    staff=await db.user.create({data:{universityId:university.id,name:'Synthetic Officer',email:'officer@example.invalid',passwordHash:'unused',role:'INTERNATIONAL_OFFICE',mfaEnabled:true}});
    await db.session.create({data:{id:hash(staffRaw),userId:staff.id,csrfHash:hash(csrf),mfaVerified:true,expiresAt:new Date(Date.now()+3600000)}});
  });
  afterAll(async()=>{
    if(!db||!university)return;
    const ids=[university.id,otherUniversity.id],users=await db.user.findMany({where:{universityId:{in:ids}},select:{id:true}});
    await db.webAuthnChallenge.deleteMany({where:{userId:{in:users.map((u:any)=>u.id)}}});
    await db.passkeyCredential.deleteMany({where:{userId:{in:users.map((u:any)=>u.id)}}});
    await db.studentIdentity.deleteMany({where:{universityId:{in:ids}}});await db.staffTask.deleteMany({where:{universityId:{in:ids}}});await db.auditLog.deleteMany({where:{universityId:{in:ids}}});
    await db.session.deleteMany({where:{user:{universityId:{in:ids}}}});await db.student.deleteMany({where:{universityId:{in:ids}}});await db.user.deleteMany({where:{universityId:{in:ids}}});await db.faculty.deleteMany({where:{universityId:{in:ids}}});await db.university.deleteMany({where:{id:{in:ids}}});await db.$disconnect();
  });
  const signup=(overrides:any={})=>request(app).post('/api/auth/student-registration').set('Origin',origin).send({university:university.slug,fullName:'Synthetic Identity Student',studentNumber:'TEST-IDENTITY-1',email:'identity-student@example.invalid',password,facultyId:faculty.id,program:'Testing',year:1,group:'TEST',nationality:'Example',language:'uz',identity,consent:true,...overrides});
  const staffRequest=(method:'get'|'post'|'put',url:string)=>request(app)[method](url).set('Cookie',`uv_session=${staffRaw}`).set('Origin',origin).set('X-CSRF-Token',csrf);
  it('accepts metadata only for universities that opened registration',async()=>{
    expect((await request(app).get(`/api/auth/registration-options?university=${university.slug}`)).status).toBe(200);
    expect((await request(app).get(`/api/auth/registration-options?university=${otherUniversity.slug}`)).status).toBe(404);
    expect((await signup({university:otherUniversity.slug})).status).toBe(403);
  });
  it('requires processing consent and checks calendar dates',async()=>{
    expect((await signup({consent:false})).status).toBe(400);expect((await signup({identity:{...identity,dateOfBirth:'2027-02-29'}})).status).toBe(400);
  });
  it('encrypts passport fields and withholds student access pending officer verification',async()=>{
    const response=await signup();expect(response.status).toBe(201);studentCookie=(response.headers['set-cookie'] as unknown as string[]).find(c=>c.startsWith('uv_session='))!.split(';')[0];studentCsrf=response.body.csrf;
    const row=await db.studentIdentity.findFirst({where:{universityId:university.id}});studentId=row.studentId;identityId=row.id;expect(row.encryptedDetails).not.toContain(identity.number);expect(row.fingerprint).not.toContain(identity.number);expect(row.numberLast4).toBe('0001');expect(row.status).toBe('SUBMITTED');
    expect((await request(app).get('/api/students').set('Cookie',studentCookie)).status).toBe(403);
    expect((await request(app).get('/api/auth/identity').set('Cookie',studentCookie)).body.identity.status).toBe('SUBMITTED');
  });
  it('prevents duplicate normalized passports and rolls back the extra account',async()=>{
    const response=await signup({email:'duplicate@example.invalid',studentNumber:'DUPLICATE',identity:{...identity,number:'TEST ONLY 0001'}});expect(response.status).toBe(409);expect(await db.user.count({where:{universityId:university.id,email:'duplicate@example.invalid'}})).toBe(0);
  });
  it('limits identity disclosure to authorized officers and audits it',async()=>{
    const list=await staffRequest('get','/api/identity/applications');expect(list.status).toBe(200);expect(JSON.stringify(list.body)).not.toContain(identity.number);expect(list.body).toHaveLength(1);
    const full=await staffRequest('get',`/api/identity/applications/${identityId}`);expect(full.body.details.number).toBe(identity.number);expect(await db.auditLog.count({where:{entityId:identityId,action:'IDENTITY_DETAILS_VIEWED'}})).toBe(1);
    expect((await request(app).get(`/api/identity/applications/${identityId}`).set('Cookie',studentCookie)).status).toBe(403);
    const {hash}=await import('../src/security.js');const otherRaw=randomBytes(24).toString('hex');
    const otherOfficer=await db.user.create({data:{universityId:otherUniversity.id,name:'Other Synthetic Officer',email:'other-officer@example.invalid',role:'INTERNATIONAL_OFFICE',passwordHash:'unused',mfaEnabled:true}});
    await db.session.create({data:{id:hash(otherRaw),userId:otherOfficer.id,csrfHash:hash(csrf),mfaVerified:true,expiresAt:new Date(Date.now()+3600000)}});
    expect((await request(app).get(`/api/identity/applications/${identityId}`).set('Cookie',`uv_session=${otherRaw}`)).status).toBe(404);
    expect((await request(app).get('/api/identity/applications').set('Cookie',`uv_session=${otherRaw}`)).body).toEqual([]);
  });
  it('requires original-document confirmation and a non-duplicate officer decision',async()=>{
    expect((await staffRequest('post',`/api/identity/applications/${identityId}/review`).send({state:'VERIFIED',notes:'Checked synthetic original evidence',originalChecked:false})).status).toBe(400);
    const review=await staffRequest('post',`/api/identity/applications/${identityId}/review`).send({state:'VERIFIED',notes:'Checked synthetic original evidence',originalChecked:true});expect(review.status).toBe(204);
    expect((await request(app).get('/api/students').set('Cookie',studentCookie)).status).toBe(200);expect((await db.student.findUnique({where:{id:studentId}})).enrollmentStatus).toBe('ACTIVE');
    expect((await staffRequest('post',`/api/identity/applications/${identityId}/review`).send({state:'REJECTED',notes:'Repeated decision must be rejected',originalChecked:true})).status).toBe(409);
  });
  it('requires the current password to bind a new passkey or change a phone',async()=>{
    const call=(path:string,body:any)=>request(app).post(path).set('Cookie',studentCookie).set('Origin',origin).set('X-CSRF-Token',studentCsrf).send(body);
    expect((await call('/api/auth/passkeys/registration/options',{password:'incorrect'})).status).toBe(401);
    const options=await call('/api/auth/passkeys/registration/options',{password});expect(options.status).toBe(200);expect(options.body.authenticatorSelection).toMatchObject({residentKey:'required',userVerification:'required',authenticatorAttachment:'platform'});
    const user=await db.user.findFirst({where:{student:{id:studentId}}});expect(options.body.user.id).toBe(Buffer.from(user.id).toString('base64url'));
    const phone=await request(app).patch('/api/auth/student-phone').set('Cookie',studentCookie).set('Origin',origin).set('X-CSRF-Token',studentCsrf).send({phone:'+998000000000',password});expect(phone.status).toBe(204);expect((await db.student.findUnique({where:{id:studentId}})).phoneVerifiedAt).toBeNull();
  });
  it('binds login challenges to origin/browser and consumes invalid attempts once',async()=>{
    expect((await request(app).post('/api/auth/passkeys/authentication/options').set('Origin','https://attacker.invalid').send({})).status).toBe(403);
    const agent=request.agent(app),options=await agent.post('/api/auth/passkeys/authentication/options').set('Origin',origin).send({});expect(options.status).toBe(200);expect(options.body.userVerification).toBe('required');expect(options.body.allowCredentials??[]).toHaveLength(0);
    const invalid={response:{id:'unregistered-key',rawId:'unregistered-key',type:'public-key',response:{},clientExtensionResults:{}}};
    expect((await agent.post('/api/auth/passkeys/authentication/verify').set('Origin',origin).send(invalid)).status).toBe(401);
    expect((await agent.post('/api/auth/passkeys/authentication/verify').set('Origin',origin).send(invalid)).status).toBe(400);
    const fresh=await agent.post('/api/auth/passkeys/authentication/options').set('Origin',origin).send({});
    await db.webAuthnChallenge.updateMany({where:{challenge:fresh.body.challenge},data:{expiresAt:new Date(0)}});
    expect((await agent.post('/api/auth/passkeys/authentication/verify').set('Origin',origin).send(invalid)).status).toBe(400);
  });
});
