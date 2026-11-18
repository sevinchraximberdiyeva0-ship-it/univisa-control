import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import {randomBytes} from 'node:crypto';
const enabled=!!process.env.TEST_DATABASE_URL;
describe.skipIf(!enabled)('ID/passport registration and passkey boundaries',()=>{
  let db:any,app:any,university:any,faculty:any,otherUniversity:any,staff:any,studentCookie:string,studentCsrf:string,studentId:string,identityId:string,otherOfficerCookie:string;
  const password=randomBytes(24).toString('hex'),csrf='identity-fixture-csrf',staffRaw=randomBytes(24).toString('hex');
  const identity={type:'PASSPORT' as const,country:'UZ',number:'TESTONLY0001',dateOfBirth:'2000-01-01',issueDate:'2025-01-01',expirationDate:'2035-01-01'};
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
    expect((await staffRequest('get','/api/identity/applications/pending-count')).body).toEqual({count:1});
    expect((await request(app).get('/api/identity/applications/pending-count').set('Cookie',studentCookie)).status).toBe(403);
  });
  it('prevents duplicate normalized passports and rolls back the extra account',async()=>{
    const response=await signup({email:'duplicate@example.invalid',studentNumber:'DUPLICATE',identity:{...identity,number:'TEST ONLY 0001'}});expect(response.status).toBe(409);expect(await db.user.count({where:{universityId:university.id,email:'duplicate@example.invalid'}})).toBe(0);
  });
  it('limits identity disclosure to authorized officers and audits it',async()=>{
    const list=await staffRequest('get','/api/identity/applications');expect(list.status).toBe(200);expect(JSON.stringify(list.body)).not.toContain(identity.number);expect(list.body).toHaveLength(1);
    const full=await staffRequest('get',`/api/identity/applications/${identityId}`);expect(full.body.details.number).toBe(identity.number);expect(await db.auditLog.count({where:{entityId:identityId,action:'IDENTITY_DETAILS_VIEWED'}})).toBe(1);
    expect((await request(app).get(`/api/identity/applications/${identityId}`).set('Cookie',studentCookie)).status).toBe(403);
    const {hash}=await import('../src/security.js');const otherRaw=randomBytes(24).toString('hex');
    otherOfficerCookie=`uv_session=${otherRaw}`;
    const otherOfficer=await db.user.create({data:{universityId:otherUniversity.id,name:'Other Synthetic Officer',email:'other-officer@example.invalid',role:'INTERNATIONAL_OFFICE',passwordHash:'unused',mfaEnabled:true}});
    await db.session.create({data:{id:hash(otherRaw),userId:otherOfficer.id,csrfHash:hash(csrf),mfaVerified:true,expiresAt:new Date(Date.now()+3600000)}});
    expect((await request(app).get(`/api/identity/applications/${identityId}`).set('Cookie',`uv_session=${otherRaw}`)).status).toBe(404);
    expect((await request(app).get('/api/identity/applications').set('Cookie',`uv_session=${otherRaw}`)).body).toEqual([]);
    expect((await request(app).get('/api/identity/applications/pending-count').set('Cookie',`uv_session=${otherRaw}`)).body).toEqual({count:0});
  });
  it('requires original-document confirmation and a non-duplicate officer decision',async()=>{
    expect((await staffRequest('post',`/api/identity/applications/${identityId}/recovery`).send({originalChecked:true})).status).toBe(404);
    expect((await staffRequest('post',`/api/identity/applications/${identityId}/review`).send({state:'VERIFIED',notes:'Checked synthetic original evidence',originalChecked:false})).status).toBe(400);
    const review=await staffRequest('post',`/api/identity/applications/${identityId}/review`).send({state:'VERIFIED',notes:'Checked synthetic original evidence',originalChecked:true});expect(review.status).toBe(204);
    expect((await request(app).get('/api/students').set('Cookie',studentCookie)).status).toBe(200);expect((await db.student.findUnique({where:{id:studentId}})).enrollmentStatus).toBe('ACTIVE');
    expect((await staffRequest('get','/api/identity/applications/pending-count')).body).toEqual({count:0});
    expect((await staffRequest('post',`/api/identity/applications/${identityId}/review`).send({state:'REJECTED',notes:'Repeated decision must be rejected',originalChecked:true})).status).toBe(409);
  });
  it('requires the current password to bind a new passkey or change a phone',async()=>{
    const call=(path:string,body:any)=>request(app).post(path).set('Cookie',studentCookie).set('Origin',origin).set('X-CSRF-Token',studentCsrf).send(body);
    expect((await call('/api/auth/passkeys/registration/options',{password:'incorrect'})).status).toBe(401);
    const options=await call('/api/auth/passkeys/registration/options',{password});expect(options.status).toBe(200);expect(options.body.authenticatorSelection).toMatchObject({residentKey:'required',userVerification:'required',authenticatorAttachment:'platform'});
    const user=await db.user.findFirst({where:{student:{id:studentId}}});expect(options.body.user.id).toBe(Buffer.from(user.id).toString('base64url'));
    const phone=await request(app).patch('/api/auth/student-phone').set('Cookie',studentCookie).set('Origin',origin).set('X-CSRF-Token',studentCsrf).send({phone:'+998000000000',password});expect(phone.status).toBe(204);expect((await db.student.findUnique({where:{id:studentId}})).phoneVerifiedAt).toBeNull();
  });
  it('reopens a rejected application atomically and requires review of the new submission',async()=>{
    const applicant=await signup({email:'resubmit@example.invalid',studentNumber:'TEST-IDENTITY-2',identity:{...identity,number:'TESTONLY0002'}});
    expect(applicant.status).toBe(201);
    const cookie=(applicant.headers['set-cookie'] as unknown as string[]).find(value=>value.startsWith('uv_session='))!.split(';')[0];
    const row=await db.studentIdentity.findFirstOrThrow({where:{student:{userId:applicant.body.user.id}}});
    const reviewPath=`/api/identity/applications/${row.id}/review`;
    const resend=(number:string,consent=true,csrfToken=applicant.body.csrf)=>request(app).post('/api/auth/identity/resubmit')
      .set('Cookie',cookie).set('Origin',origin).set('X-CSRF-Token',csrfToken).send({identity:{...identity,number},consent});
    const decision={notes:'Checked original synthetic document',originalChecked:true};
    const taskWhere={deduplicationKey:`identity-${row.studentId}`};
    expect((await resend('TESTONLY0003')).status).toBe(409);
    expect((await staffRequest('post',reviewPath).send({...decision,state:'REJECTED'})).status).toBe(204);
    expect((await resend('TESTONLY0003',false)).status).toBe(400);
    expect((await resend('TESTONLY0003',true,'invalid')).status).toBe(403);
    expect((await resend('test only 0001')).status).toBe(409);
    expect(await db.studentIdentity.findUnique({where:{id:row.id}})).toMatchObject({status:'REJECTED',numberLast4:'0002',submissionVersion:1});
    expect((await db.staffTask.findUnique({where:taskWhere})).resolvedAt).not.toBeNull();

    const responses=await Promise.all([resend('TESTONLY0003'),resend('TESTONLY0003')]);
    expect(responses.map(response=>response.status).sort()).toEqual([204,409]);
    const updated=await db.studentIdentity.findUnique({where:{id:row.id}});
    expect(updated).toMatchObject({status:'SUBMITTED',numberLast4:'0003',submissionVersion:2,notes:null,reviewedAt:null,reviewedBy:null});
    expect(updated.encryptedDetails).not.toContain('TESTONLY0003');
    expect((await db.student.findUnique({where:{id:row.studentId}})).enrollmentStatus).toBe('PENDING_ADMISSION');
    expect((await db.staffTask.findUnique({where:taskWhere})).resolvedAt).toBeNull();
    expect(await db.auditLog.count({where:{entityId:row.id,action:'IDENTITY_REGISTRATION_RESUBMITTED'}})).toBe(1);
    expect((await request(app).get('/api/documents').set('Cookie',cookie)).status).toBe(403);
    const pending=await staffRequest('get','/api/identity/applications?status=SUBMITTED&page=1');
    expect(pending.body).toMatchObject({total:1,rows:[{id:row.id,numberLast4:'0003'}]});
    expect((await staffRequest('get','/api/identity/applications/pending-count')).body).toEqual({count:1});

    expect((await staffRequest('post',reviewPath).send({...decision,state:'VERIFIED',submissionVersion:1})).status).toBe(409);
    const current=await staffRequest('get',`/api/identity/applications/${row.id}`);
    expect(current.body).toMatchObject({submissionVersion:2,details:{number:'TESTONLY0003'}});
    expect((await staffRequest('post',reviewPath).send({...decision,state:'VERIFIED',submissionVersion:current.body.submissionVersion})).status).toBe(204);
    expect((await request(app).get('/api/documents').set('Cookie',cookie)).status).toBe(200);
    expect((await resend('TESTONLY0004')).status).toBe(409);
  });
  it('lists applications beyond the legacy limit with a stable order and tenant-scoped status counts',async()=>{
    const {encrypt}=await import('../src/security.js');
    const {identityFingerprint}=await import('../src/identity.js');
    const oldDate=new Date('2025-02-01T00:00:00Z');
    async function createApplications(universityId:string,facultyId:string,count:number){
      const students=await db.student.createManyAndReturn({data:Array.from({length:count},(_,index)=>({
        universityId,facultyId,studentNumber:`PAGE-${index}`,fullName:`Synthetic Applicant ${index}`,
        program:'Testing',year:1,group:'TEST',nationality:'Example',email:`page-${index}@example.invalid`,
        archivedAt:index===1?oldDate:null,
      })),select:{id:true,studentNumber:true}});
      await db.studentIdentity.createMany({data:students.map((student:{id:string;studentNumber:string})=>{
        const index=Number(student.studentNumber.slice(5)),numberLast4=String(index).padStart(4,'0');
        const details={...identity,number:`PAGEONLY${numberLast4}`};
        return {universityId,studentId:student.id,encryptedDetails:encrypt(JSON.stringify(details)),fingerprint:identityFingerprint(universityId,details),
          numberLast4,status:index===0?'REJECTED':index===1?'SUBMITTED':'VERIFIED',consentAt:oldDate,updatedAt:oldDate};
      })});
    }
    const otherFaculty=await db.faculty.create({data:{universityId:otherUniversity.id,name:'Other Test Faculty'}});
    await createApplications(university.id,faculty.id,205);
    await createApplications(otherUniversity.id,otherFaculty.id,1);

    const first=await staffRequest('get','/api/identity/applications?page=1');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body).toMatchObject({page:1,pageSize:25,total:207,totalPages:9});
    expect(first.body.rows).toHaveLength(25);
    const eighth=await staffRequest('get','/api/identity/applications?page=8');
    const last=await staffRequest('get','/api/identity/applications?page=999');
    expect(last.body).toMatchObject({page:9,total:207,totalPages:9});
    expect(last.body.rows).toHaveLength(7);
    const lastIds=[...eighth.body.rows,...last.body.rows].map(row=>row.id);
    expect(lastIds).toEqual([...new Set(lastIds)].sort().reverse());
    const rejected=await staffRequest('get','/api/identity/applications?status=REJECTED&pageSize=2');
    expect(rejected.body).toMatchObject({page:1,pageSize:2,total:1,totalPages:1,rows:[{status:'REJECTED',student:{studentNumber:'PAGE-0'}}]});
    expect(JSON.stringify(rejected.body)).not.toContain('PAGEONLY');
    const empty=await staffRequest('get','/api/identity/applications?status=SUBMITTED&page=2');
    expect(empty.body).toMatchObject({page:1,total:0,totalPages:1,rows:[]});
    expect((await staffRequest('get','/api/identity/applications/pending-count')).body).toEqual({count:0});
    const legacy=await staffRequest('get','/api/identity/applications');
    expect(legacy.body).toHaveLength(200);
    for(const query of ['page=0','page=1.5','pageSize=101','status=UNKNOWN']){
      expect((await staffRequest('get',`/api/identity/applications?${query}`)).status).toBe(400);
    }
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
  it('requires email for new applicants when delivery is enabled and consumes only the latest valid code',async()=>{
    const {config}=await import('../src/config.js');
    const original={EMAIL_MODE:config.EMAIL_MODE,EMAIL_FROM:config.EMAIL_FROM,EMAIL_RESEND_API_KEY:config.EMAIL_RESEND_API_KEY};
    Object.assign(config,{EMAIL_MODE:'live',EMAIL_FROM:'verifier@example.invalid',EMAIL_RESEND_API_KEY:'synthetic-key'});
    const messages:{to:string[];text:string}[]=[];
    const mail=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,options)=>{
      messages.push(JSON.parse(String(options?.body)));
      return Response.json({id:'synthetic-mail-id'});
    });
    try{
      const email='email-verification@example.invalid';
      const applicant=await signup({email,studentNumber:'EMAIL-VERIFY',language:'ko',identity:{...identity,number:'EMAILONLY0001'}});
      expect(applicant.status).toBe(201);
      const userId=applicant.body.user.id;
      const cookie=(applicant.headers['set-cookie'] as unknown as string[]).find(value=>value.startsWith('uv_session='))!.split(';')[0];
      expect(applicant.body.user).toMatchObject({emailVerificationRequired:true,emailVerifiedAt:null});
      const row=await db.studentIdentity.findFirstOrThrow({where:{student:{userId}}});
      const call=(action:string,body:object={},sessionCookie=cookie,csrfToken=applicant.body.csrf)=>request(app)
        .post(`/api/auth/email-verification/${action}`).set('Cookie',sessionCookie).set('Origin',origin).set('X-CSRF-Token',csrfToken).send(body);
      expect((await staffRequest('post',`/api/identity/applications/${row.id}/review`).send({state:'VERIFIED',notes:'Checked original synthetic document',originalChecked:true})).status).toBe(204);
      expect((await request(app).get('/api/documents').set('Cookie',cookie)).status).toBe(403);
      expect((await call('send',{},cookie,'invalid')).status).toBe(403);
      const issued=await Promise.all([call('send'),call('send')]);
      expect(issued.map(response=>response.status).sort()).toEqual([204,429]);
      expect(mail).toHaveBeenCalledTimes(1);
      expect(mail.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails');
      expect(messages[0]).toMatchObject({to:[email]});
      expect(messages[0].text).toContain('이메일 인증 코드');
      const firstCode=messages[0].text.match(/\d{8}/)![0];
      const challenge=await db.emailVerification.findUniqueOrThrow({where:{userId}});
      expect(challenge.codeHash).toHaveLength(64);
      expect(challenge.codeHash).not.toBe(firstCode);
      expect((await call('confirm',{code:firstCode},studentCookie,studentCsrf)).status).toBe(400);
      await db.emailVerification.update({where:{userId},data:{expiresAt:new Date(0),sentAt:new Date(0)}});
      expect((await call('confirm',{code:firstCode})).status).toBe(400);
      expect((await call('send')).status).toBe(204);
      const secondCode=messages[1].text.match(/\d{8}/)![0];
      expect(secondCode).not.toBe(firstCode);
      for(let attempt=0;attempt<5;attempt++)expect((await call('confirm',{code:firstCode})).status).toBe(400);
      expect((await call('confirm',{code:secondCode})).status).toBe(400);
      await db.emailVerification.update({where:{userId},data:{sentAt:new Date(0)}});
      expect((await call('send')).status).toBe(204);
      const latestCode=messages[2].text.match(/\d{8}/)![0];
      const confirmed=await Promise.all([call('confirm',{code:latestCode}),call('confirm',{code:latestCode})]);
      expect(confirmed.map(response=>response.status).sort()).toEqual([204,400]);
      expect(await db.emailVerification.findUnique({where:{userId}})).toBeNull();
      expect(await db.auditLog.count({where:{entityId:userId,action:'STUDENT_EMAIL_VERIFIED'}})).toBe(1);
      expect((await request(app).get('/api/documents').set('Cookie',cookie)).status).toBe(200);

      const anonymous=request.agent(app);
      const login={university:university.slug,number:'email-only 0001'};
      const start=(agent:typeof anonymous,body:object=login)=>agent.post('/api/auth/passport-login/start').set('Origin',origin).send(body);
      const finish=(agent:typeof anonymous,code:string)=>agent.post('/api/auth/passport-login/confirm').set('Origin',origin).send({...login,code});
      expect((await anonymous.post('/api/auth/passport-login/start').set('Origin','https://untrusted.invalid').send(login)).status).toBe(403);
      const unknown=await start(request.agent(app),{...login,number:'UNKNOWN0001'});
      const issuedLogin=await start(anonymous);
      expect(issuedLogin.status).toBe(202);
      expect(issuedLogin.body).toEqual(unknown.body);
      await vi.waitFor(()=>expect(messages).toHaveLength(4));
      expect(messages[3]).toMatchObject({to:[email]});
      expect(messages[3].text).toContain('로그인 코드');
      const loginCode=messages[3].text.match(/\d{8}/)![0];
      expect((await finish(request.agent(app),loginCode)).status).toBe(401);
      expect((await finish(anonymous,loginCode==='00000000'?'11111111':'00000000')).status).toBe(401);
      const loggedIn=await finish(anonymous,loginCode);
      expect(loggedIn.status).toBe(200);
      expect(loggedIn.body.user.id).toBe(userId);
      expect((await anonymous.get('/api/documents')).status).toBe(200);
      const oldBinding=issuedLogin.headers['set-cookie'][0].split(';')[0];
      expect((await request(app).post('/api/auth/passport-login/confirm').set('Cookie',oldBinding).set('Origin',origin).send({...login,code:loginCode})).status).toBe(401);
      expect(await db.auditLog.count({where:{entityId:userId,action:'STUDENT_PASSPORT_LOGIN'}})).toBe(1);

      const idEmail='id-card-verification@example.invalid';
      const idApplicant=await signup({email:idEmail,studentNumber:'ID-CARD-VERIFY',identity:{...identity,type:'ID_CARD',number:'EMAILONLY0001'}});
      expect(idApplicant.status).toBe(201);
      const idUser=idApplicant.body.user.id;
      const idIdentity=await db.studentIdentity.findFirstOrThrow({where:{student:{userId:idUser}}});
      expect((await staffRequest('post',`/api/identity/applications/${idIdentity.id}/review`).send({state:'VERIFIED',notes:'Checked original synthetic ID card',originalChecked:true})).status).toBe(204);
      await db.user.update({where:{id:idUser},data:{emailVerifiedAt:new Date()}});
      const ambiguous=request.agent(app),idBrowser=request.agent(app);
      expect((await start(ambiguous)).status).toBe(202);
      const idLogin={...login,document:{type:'ID_CARD',country:'uz'}};
      expect((await start(idBrowser,idLogin)).status).toBe(202);
      await vi.waitFor(()=>expect(messages).toHaveLength(5));
      expect(messages[4].to).toEqual([idEmail]);
      const idCode=messages[4].text.match(/\d{8}/)![0];
      expect((await finish(ambiguous,idCode)).status).toBe(401);
      const idSession=await idBrowser.post('/api/auth/passport-login/confirm').set('Origin',origin).send({...idLogin,code:idCode});
      expect(idSession.status).toBe(200);
      expect(idSession.body.user.id).toBe(idUser);
    }finally{
      mail.mockRestore();Object.assign(config,original);
    }
  });
  it('recovers an approved student once and revokes earlier sign-in credentials',async()=>{
    const {hash}=await import('../src/security.js');
    const user=await db.user.findFirstOrThrow({where:{student:{id:studentId}}});
    const endpoint=`/api/identity/applications/${identityId}/recovery`;
    const issue=()=>staffRequest('post',endpoint).send({originalChecked:true});
    expect((await request(app).post(endpoint).set('Cookie',otherOfficerCookie).set('Origin',origin).set('X-CSRF-Token',csrf).send({originalChecked:true})).status).toBe(404);
    expect((await request(app).post(endpoint).set('Cookie',studentCookie).set('Origin',origin).set('X-CSRF-Token',studentCsrf).send({originalChecked:true})).status).toBe(403);
    expect((await staffRequest('post',endpoint).send({originalChecked:false})).status).toBe(400);

    await db.passkeyCredential.create({data:{id:'synthetic-recovery-key',userId:user.id,name:'Old device',publicKey:Buffer.from('test'),transports:[],deviceType:'singleDevice',backedUp:false}});
    const rawFrom=(link:string)=>new URLSearchParams(new URL(link).hash.split('?')[1]).get('code')!;
    const expired=await issue();
    expect(expired.status).toBe(201);
    expect(expired.headers['cache-control']).toBe('no-store');
    expect(new URL(expired.body.link).pathname).toBe('/talaba/');
    expect(new URL(expired.body.link).search).toBe('');
    const expiredCode=rawFrom(expired.body.link);
    expect(await db.studentAccountRecovery.findUnique({where:{userId:user.id}})).toMatchObject({tokenHash:hash(expiredCode)});
    const newPassword='Recovered synthetic password 024!';
    const complete=(code:string,requestOrigin=origin)=>request(app).post('/api/auth/account-recovery/complete').set('Origin',requestOrigin).send({code,password:newPassword});
    await db.studentAccountRecovery.update({where:{userId:user.id},data:{expiresAt:new Date(0)}});
    expect((await complete(expiredCode)).status).toBe(400);
    const replaced=rawFrom((await issue()).body.link);
    const current=rawFrom((await issue()).body.link);
    expect((await complete(replaced)).status).toBe(400);
    expect((await complete(current,'https://other.invalid')).status).toBe(403);
    expect((await request(app).post('/api/auth/account-recovery/complete').set('Origin',origin).send({code:current,password})).status).toBe(409);
    expect((await request(app).get('/api/auth/me').set('Cookie',studentCookie)).status).toBe(200);

    const responses=await Promise.all([complete(current),complete(current)]);
    expect(responses.map(response=>response.status).sort()).toEqual([200,400]);
    const recovered=responses.find(response=>response.status===200)!;
    const newCookie=(recovered.headers['set-cookie'] as unknown as string[]).find(value=>value.startsWith('uv_session='))!.split(';')[0];
    expect((await request(app).get('/api/auth/me').set('Cookie',newCookie)).body.user.id).toBe(user.id);
    expect((await request(app).get('/api/auth/me').set('Cookie',studentCookie)).status).toBe(401);
    expect(await db.passkeyCredential.count({where:{userId:user.id}})).toBe(0);
    const login=(candidate:string)=>request(app).post('/api/auth/login').send({university:university.slug,email:user.email,password:candidate});
    expect((await login(password)).status).toBe(401);
    expect((await login(newPassword)).status).toBe(200);
    expect(await db.auditLog.count({where:{entityId:user.id,action:'STUDENT_ACCOUNT_RECOVERY_COMPLETED'}})).toBe(1);
  });
});
