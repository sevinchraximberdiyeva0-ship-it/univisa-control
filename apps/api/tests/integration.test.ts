import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import request from 'supertest';
// Dedicated disposable PostgreSQL database only. Never point this at development or production.
const enabled=!!process.env.TEST_DATABASE_URL;
describe.skipIf(!enabled)('PostgreSQL/API/worker integration',()=>{
  let db:any,app:any,deliver:any,planDocument:any,confirmation:any,encrypt:any;
  let universityId:string,otherUniversityId:string,student:any,document:any;
  let staffCookie:string,studentCookie:string,csrf='integration-csrf';
  beforeAll(async()=>{
    process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
    process.env.ENCRYPTION_KEY='a'.repeat(64);process.env.NODE_ENV='test';process.env.TELEGRAM_MODE='mock';
    ({db}=await import('../src/db.js'));({app}=await import('../src/app.js'));({deliver,planDocument,confirmation}=await import('../src/notifications.js'));({encrypt}=await import('../src/security.js'));
    const {hash}=await import('../src/security.js');
    const slug=`test-${Date.now()}`;
    const university=await db.university.create({data:{slug,name:'Integration tenant',contactEmail:'office@example.invalid',deliveryStart:0,deliveryEnd:24}});universityId=university.id;
    otherUniversityId=(await db.university.create({data:{slug:`${slug}-other`,name:'Other tenant',contactEmail:'office@example.invalid'}})).id;
    const faculty=await db.faculty.create({data:{universityId,name:'Integration faculty'}});
    const staff=await db.user.create({data:{universityId,name:'Integration staff',email:'staff@example.invalid',passwordHash:'unused',role:'INTERNATIONAL_OFFICE',mfaEnabled:true}});
    const user=await db.user.create({data:{universityId,name:'Integration student',email:'student@example.invalid',passwordHash:'unused',role:'STUDENT'}});
    student=await db.student.create({data:{universityId,userId:user.id,studentNumber:'I1',fullName:'Integration student',facultyId:faculty.id,program:'Test',year:1,group:'T',nationality:'Example',email:'student@example.invalid',phoneEncrypted:encrypt('+998901234567'),phoneVerifiedAt:new Date()}});
    const today=new Date();today.setUTCHours(0,0,0,0);const expiry=new Date(today);expiry.setUTCDate(expiry.getUTCDate()+7);const issue=new Date(today);issue.setUTCFullYear(issue.getUTCFullYear()-1);
    document=await db.studentDocument.create({data:{universityId,studentId:student.id,type:'VISA',issueDate:issue,expirationDate:expiry}});
    await db.notificationRule.createMany({data:[7,1,0].map(daysRemaining=>({universityId,daysRemaining}))});await db.smsProviderConfiguration.create({data:{universityId}});
    for(const [raw,id,mfaVerified] of [['staff-token',staff.id,true],['student-token',user.id,false]]as const)await db.session.create({data:{id:hash(raw),userId:id,csrfHash:hash(csrf),mfaVerified,expiresAt:new Date(Date.now()+3600000)}});
    staffCookie='uv_session=staff-token';studentCookie='uv_session=student-token';
  });
  afterAll(async()=>{
    if(!db)return;
    await db.notificationAttempt.deleteMany({where:{job:{universityId}}});
    for(const model of ['notificationJob','staffTask','documentVerification','renewalApplication','documentVersion','privateFile','studentDocument','telegramConnection','telegramLinkToken','notificationRule','smsProviderConfiguration','auditLog','systemSetting'])await db[model].deleteMany({where:{universityId}});
    await db.session.deleteMany({where:{user:{universityId}}});await db.student.deleteMany({where:{universityId}});await db.user.deleteMany({where:{universityId}});await db.faculty.deleteMany({where:{universityId}});await db.university.deleteMany({where:{id:{in:[universityId,otherUniversityId]}}});await db.$disconnect();
  });
  it('blocks unauthenticated reads and student writes',async()=>{
    expect((await request(app).get('/api/students')).status).toBe(401);
    expect((await request(app).post('/api/students').set('Cookie',studentCookie).set('Origin','http://localhost:5173').set('X-CSRF-Token',csrf).send({})).status).toBe(403);
  });
  it('enforces CSRF for mutations',async()=>expect((await request(app).post('/api/renewals').set('Cookie',studentCookie).send({})).status).toBe(403));
  it('isolates tenants even with a guessed student ID',async()=>{
    const faculty=await db.faculty.create({data:{universityId:otherUniversityId,name:'Other'}});const other=await db.student.create({data:{universityId:otherUniversityId,studentNumber:'OTHER',fullName:'Other Student',facultyId:faculty.id,program:'Test',year:1,group:'T',nationality:'Example',email:'other@example.invalid'}});
    const response=await request(app).get('/api/students').set('Cookie',staffCookie);expect(response.body.some((s:any)=>s.id===other.id)).toBe(false);
    const write=await request(app).patch(`/api/students/${other.id}`).set('Cookie',staffCookie).set('Origin','http://localhost:5173').set('X-CSRF-Token',csrf).send({});expect(write.status).toBe(404);
    await db.student.delete({where:{id:other.id}});await db.faculty.delete({where:{id:faculty.id}});
  });
  it('reconciles schedules idempotently after scheduler restart',async()=>{
    await db.$transaction((tx:any)=>planDocument(tx,document));const count=await db.notificationJob.count({where:{documentId:document.id}});await db.$transaction((tx:any)=>planDocument(tx,document));expect(await db.notificationJob.count({where:{documentId:document.id}})).toBe(count);
  });
  it('records unstarted Telegram as unavailable and escalates',async()=>{
    const job=await db.notificationJob.findFirst({where:{documentId:document.id,channel:'TELEGRAM'}});await db.notificationJob.update({where:{id:job.id},data:{scheduledAt:new Date(0)}});await deliver(job.id);expect((await db.notificationJob.findUnique({where:{id:job.id}})).state).toBe('UNAVAILABLE');
  });
  it('does not claim SMS mock delivery or send duplicates',async()=>{
    const job=await db.notificationJob.findFirst({where:{documentId:document.id,channel:'SMS'}});await db.notificationJob.update({where:{id:job.id},data:{scheduledAt:new Date(0)}});await Promise.all([deliver(job.id),deliver(job.id)]);expect((await db.notificationJob.findUnique({where:{id:job.id}})).state).toBe('MOCK');expect(await db.notificationAttempt.count({where:{jobId:job.id}})).toBe(1);
  });
  it('uploads a supporting document, submits, reviews and verifies a renewal once',async()=>{
    const common=(req:any,cookie:string)=>req.set('Cookie',cookie).set('Origin','http://localhost:5173').set('X-CSRF-Token',csrf);
    const upload=await common(request(app).post('/api/files'),studentCookie).field('studentId',student.id).attach('file',Buffer.from('%PDF-1.7\nsynthetic integration fixture'),'fixture.pdf');expect(upload.status).toBe(201);
    const application=await common(request(app).post('/api/renewals'),studentCookie).send({documentId:document.id,fileId:upload.body.id,issueDate:'2028-01-01',expirationDate:'2030-01-01'});expect(application.status).toBe(201);
    expect((await db.studentDocument.findUnique({where:{id:document.id}})).activeVersion).toBe(1);
    const review=()=>common(request(app).post(`/api/renewals/${application.body.id}/review`),staffCookie);
    expect((await review().send({state:'VERIFIED',notes:'Verified against original document'})).status).toBe(409);
    expect((await review().send({state:'UNDER_REVIEW',notes:'Reviewing supporting evidence'})).status).toBe(200);
    const responses=await Promise.all([review().send({state:'VERIFIED',notes:'Verified against original document'}),review().send({state:'VERIFIED',notes:'Verified against original document'})]);expect(responses.every(r=>r.status===200)).toBe(true);
    expect((await db.studentDocument.findUnique({where:{id:document.id}})).activeVersion).toBe(2);
    expect(await db.notificationJob.count({where:{documentId:document.id,kind:'CONFIRMATION'}})).toBe(3);
    expect(await db.notificationJob.count({where:{documentId:document.id,version:1,state:'PENDING'}})).toBe(0);
  });
  it('cancels an obsolete job when renewal is already effective',async()=>{
    const job=await db.notificationJob.findFirst({where:{documentId:document.id,version:1}});await db.notificationJob.update({where:{id:job.id},data:{state:'PENDING',scheduledAt:new Date(0)}});await deliver(job.id);expect((await db.notificationJob.findUnique({where:{id:job.id}})).state).toBe('CANCELED');
  });
  it('uses bounded exponential retry for explicit temporary provider rejection',async()=>{
    const current=await db.studentDocument.findUnique({where:{id:document.id}});await db.$transaction((tx:any)=>confirmation(tx,current));const job=await db.notificationJob.findFirst({where:{documentId:document.id,kind:'CONFIRMATION',channel:'SMS'}});
    await deliver(job.id,{send:async()=>{throw new Error('TEMPORARY');}});const updated=await db.notificationJob.findUnique({where:{id:job.id}});expect(updated.state).toBe('PENDING');expect(updated.scheduledAt.getTime()).toBeGreaterThan(Date.now());
  });
  it('quarantines ambiguous provider failures without blindly retrying',async()=>{
    const job=await db.notificationJob.findFirst({where:{documentId:document.id,kind:'CONFIRMATION',channel:'SMS'}});await db.notificationJob.update({where:{id:job.id},data:{scheduledAt:new Date(0),state:'PENDING'}});
    await deliver(job.id,{send:async()=>{throw new Error('network timeout');}});expect((await db.notificationJob.findUnique({where:{id:job.id}})).state).toBe('UNKNOWN');
  });
  it('does not replay a preexisting in-flight send reservation',async()=>{
    const job=await db.notificationJob.findFirst({where:{documentId:document.id,kind:'CONFIRMATION',channel:'TELEGRAM'}});
    await db.telegramConnection.create({data:{universityId,studentId:student.id,chatId:'12345'}});
    // A committed reservation must be treated as uncertain on re-entry, never resent.
    await db.notificationJob.update({where:{id:job.id},data:{state:'SENDING',sendingAt:new Date(),scheduledAt:new Date(0)}});await deliver(job.id);expect((await db.notificationJob.findUnique({where:{id:job.id}})).state).toBe('SENDING');
  });
  it('rejects invalid, expired and replayed Telegram linking tokens',async()=>{
    const {config}=await import('../src/config.js');const {hash}=await import('../src/security.js');
    const originalMode=config.TELEGRAM_MODE;const originalSecret=config.TELEGRAM_WEBHOOK_SECRET;const originalToken=config.TELEGRAM_BOT_TOKEN;
    config.TELEGRAM_MODE='live';config.TELEGRAM_WEBHOOK_SECRET='integration-secret-only';config.TELEGRAM_BOT_TOKEN='test-only';
    const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({ok:true,result:{message_id:1}}),{status:200}));
    let updateId=100;
    const send=(text:string,secret='integration-secret-only')=>request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token',secret).send({update_id:updateId++,message:{text,chat:{id:99999,type:'private'},from:{id:99999,is_bot:false}}});
    try {
      expect((await send('/start bad','wrong-secret')).status).toBe(401);expect((await send('/start bad')).status).toBe(200);
      expect(await db.telegramConnection.findUnique({where:{chatId:'99999'}})).toBe(null);
      const expired='b'.repeat(64);await db.telegramLinkToken.create({data:{hash:hash(expired),universityId,studentId:student.id,expiresAt:new Date(0)}});await send(`/start ${expired}`);expect(await db.telegramConnection.findUnique({where:{chatId:'99999'}})).toBe(null);
      const valid='c'.repeat(64);await db.telegramLinkToken.create({data:{hash:hash(valid),universityId,studentId:student.id,expiresAt:new Date(Date.now()+60000)}});
      await send(`/start ${valid}`);expect((await db.telegramConnection.findUnique({where:{chatId:'99999'}})).studentId).toBe(student.id);const usedAt=(await db.telegramLinkToken.findUnique({where:{hash:hash(valid)}})).usedAt;await send(`/start ${valid}`);expect((await db.telegramLinkToken.findUnique({where:{hash:hash(valid)}})).usedAt).toEqual(usedAt);
    }finally {fetchMock.mockRestore();config.TELEGRAM_MODE=originalMode;config.TELEGRAM_WEBHOOK_SECRET=originalSecret;config.TELEGRAM_BOT_TOKEN=originalToken;await db.telegramUpdate.deleteMany({where:{id:{gte:100,lt:BigInt(updateId)}}});}
  });
  it('replans pending schedules safely when administrators change university policy',async()=>{
    const staff=await db.user.findFirst({where:{universityId,role:'INTERNATIONAL_OFFICE'}});await db.user.update({where:{id:staff.id},data:{role:'UNIVERSITY_ADMIN'}});
    try {
      const response=await request(app).put('/api/settings').set('Cookie',staffCookie).set('Origin','http://localhost:5173').set('X-CSRF-Token',csrf).send({timezone:'UTC',deliveryStart:10,deliveryEnd:18,thresholds:[30,7,0],contactEmail:'office@example.invalid',retentionDays:365});expect(response.status).toBe(204);
      expect((await db.university.findUnique({where:{id:universityId}})).reminderRevision).toBe(2);
      const pending=await db.notificationJob.findMany({where:{universityId,kind:'REMINDER',state:'PENDING'}});expect(pending.length).toBeGreaterThan(0);expect(pending.every((j:any)=>j.idempotencyKey.includes('-2-REMINDER-'))).toBe(true);expect(pending.every((j:any)=>j.scheduledAt.getUTCHours()===10)).toBe(true);
    }finally {await db.user.update({where:{id:staff.id},data:{role:'INTERNATIONAL_OFFICE'}});}
  });
  it('persists Telegram command replies atomically and deduplicates webhook retries',async()=>{
    const {config}=await import('../src/config.js');const {decrypt}=await import('../src/security.js');const original=config.TELEGRAM_MODE,secret=config.TELEGRAM_WEBHOOK_SECRET;
    config.TELEGRAM_MODE='live';config.TELEGRAM_WEBHOOK_SECRET='integration-secret-only';
    const update={update_id:500,message:{text:'/language_uz',chat:{id:99999,type:'private'},from:{id:99999,is_bot:false}}};
    try{
      const send=(payload=update)=>request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token','integration-secret-only').send(payload);
      expect((await send()).status).toBe(200);expect((await send()).status).toBe(200);
      const rows=await db.telegramResponse.findMany({where:{updateId:500}});expect(rows).toHaveLength(1);expect(JSON.parse(decrypt(rows[0].payloadEncrypted)).text).toContain('yangilandi');
      expect((await send({...update,update_id:501,message:{...update.message,text:'/language'}})).status).toBe(200);
      const choices=await db.telegramResponse.findUniqueOrThrow({where:{updateId:501}});
      expect(JSON.parse(decrypt(choices.payloadEncrypted)).text.split('\n').slice(1)).toEqual(['/language_uz','/language_tk','/language_en','/language_ru','/language_ko','/language_zh']);
      expect((await send({...update,update_id:502,message:{...update.message,text:'/language_zh'}})).status).toBe(200);
      const changed=await db.telegramResponse.findUniqueOrThrow({where:{updateId:502}});
      expect(JSON.parse(decrypt(changed.payloadEncrypted)).text).toBe('通知语言已更新。');
      config.TELEGRAM_MODE='mock';await db.telegramResponse.update({where:{id:rows[0].id},data:{scheduledAt:new Date(0)}});const {deliverTelegramResponse}=await import('../src/telegram.js');await deliverTelegramResponse(rows[0].id);expect((await db.telegramResponse.findUnique({where:{id:rows[0].id}})).state).toBe('MOCK');
    }finally{config.TELEGRAM_MODE=original;config.TELEGRAM_WEBHOOK_SECRET=secret;await db.telegramResponse.deleteMany({where:{updateId:{in:[500,501,502]}}});await db.telegramUpdate.deleteMany({where:{id:{in:[500,501,502]}}});}
  });
  it('deduplicates overdue milestones and stops escalation after verified date extension',async()=>{
    const current=await db.studentDocument.findUnique({where:{id:document.id}});const future=new Date(current.expirationDate);future.setUTCDate(future.getUTCDate()+8);
    await db.$transaction((tx:any)=>planDocument(tx,current,future));await db.$transaction((tx:any)=>planDocument(tx,current,future));
    const count=await db.staffTask.count({where:{universityId,reason:{startsWith:'Overdue document:'}}});expect(count).toBe(3);
    await db.studentDocument.update({where:{id:document.id},data:{expirationDate:new Date('2031-01-01')}});await db.$transaction((tx:any)=>planDocument(tx,{...current,expirationDate:new Date('2031-01-01')},future));expect(await db.staffTask.count({where:{universityId,reason:{startsWith:'Overdue document:'}}})).toBe(count);
    await db.studentDocument.update({where:{id:document.id},data:{expirationDate:current.expirationDate}});
  });
  it('collapses missed milestones to one message per local day after downtime',async()=>{
    const current=await db.studentDocument.findUnique({where:{id:document.id}});const now=new Date('2029-12-31T11:00:00Z');
    await db.notificationJob.updateMany({where:{documentId:document.id,kind:'REMINDER',state:'PENDING'},data:{state:'CANCELED'}});
    const create=(suffix:string,scheduledAt:Date)=>db.notificationJob.create({data:{universityId,studentId:student.id,documentId:document.id,version:current.activeVersion,kind:'REMINDER',channel:'SMS',scheduledDate:scheduledAt.toISOString().slice(0,10),scheduledAt,idempotencyKey:`downtime-${suffix}`}});
    const older=await create('old',new Date('2029-12-30T10:00:00Z')),latest=await create('latest',new Date('2029-12-31T10:00:00Z'));
    let calls=0;const provider={name:'mock',send:async()=>{calls++;return {state:'MOCK' as const};}};
    await deliver(older.id,provider,()=>now);await deliver(latest.id,provider,()=>now);expect(calls).toBe(1);expect((await db.notificationJob.findUnique({where:{id:older.id}})).state).toBe('CANCELED');
  });
  it('shows tenant-scoped monitoring, hides ciphertext and rejects student simulation',async()=>{
    const monitor=await request(app).get('/api/notifications/monitor?state=ALL').set('Cookie',staffCookie);expect(monitor.status).toBe(200);expect(monitor.body.rows.every((r:any)=>r.universityId===universityId)).toBe(true);expect(monitor.body.rows.every((r:any)=>!('messageEncrypted' in r))).toBe(true);
    const studentRead=await request(app).get('/api/notifications/monitor').set('Cookie',studentCookie);expect(studentRead.status).toBe(403);
    const simulateRequest=(cookie:string)=>request(app).post('/api/notifications/simulate').set('Cookie',cookie).set('Origin','http://localhost:5173').set('X-CSRF-Token',csrf).send({expirationDate:'2028-03-30'});
    expect((await simulateRequest(studentCookie)).status).toBe(403);const result=await simulateRequest(staffCookie);expect(result.status).toBe(200);expect(result.body.realMessagesSent).toBe(0);expect(result.body.queuedJobs).toBe(0);
    const own=await request(app).get('/api/notifications').set('Cookie',studentCookie);expect(own.body.every((r:any)=>!('messageEncrypted' in r))).toBe(true);
  });
  it('recovers database outbox jobs after mocked Redis loss, including retained failed jobs',async()=>{
    const {enqueuePending}=await import('../src/scheduler.js');const queueRows=new Map<string,any>();
    const queue={getJob:async(id:string)=>queueRows.get(id),add:async(name:string,data:any,options:any)=>{queueRows.set(options.jobId,{name,data,getState:async()=>'waiting',remove:async()=>queueRows.delete(options.jobId)});}};
    const job=await db.notificationJob.create({data:{universityId,studentId:student.id,documentId:document.id,version:2,kind:'QUEUE_TEST',channel:'IN_APP',scheduledDate:'2026-01-01',scheduledAt:new Date(0),idempotencyKey:'queue-recovery-fixture'}});
    await enqueuePending(queue as any);expect(queueRows.has(job.id)).toBe(true);queueRows.clear();await enqueuePending(queue as any);expect(queueRows.has(job.id)).toBe(true);
    queueRows.set(job.id,{getState:async()=>'failed',remove:async()=>queueRows.delete(job.id)});await enqueuePending(queue as any);expect(await queueRows.get(job.id).getState()).toBe('waiting');
    await db.notificationJob.update({where:{id:job.id},data:{state:'DELIVERED'}});queueRows.clear();await enqueuePending(queue as any);expect(queueRows.has(job.id)).toBe(false);
  });
  it('accepts only signed tenant-specific DevSMS delivery receipts and never downgrades delivery',async()=>{
    const {createHmac}=await import('node:crypto');const key='receipt-fixture-key-'.repeat(3);await db.smsProviderConfiguration.update({where:{universityId},data:{provider:'devsms',credentialsEncrypted:encrypt(JSON.stringify({token:'fixture-token',webhookKey:key,sender:'4546'}))}});
    const job=await db.notificationJob.create({data:{universityId,studentId:student.id,documentId:document.id,version:2,kind:'RECEIPT_TEST',channel:'SMS',scheduledDate:'2026-01-01',scheduledAt:new Date(0),idempotencyKey:'receipt-fixture',provider:'devsms',providerMessageId:'123',state:'ACCEPTED'}});
    const send=(status:string,signed=true)=>{const body=JSON.stringify({sms_id:123,status}),timestamp=String(Math.floor(Date.now()/1000)),signature='sha256='+createHmac('sha256',key).update(timestamp+'.'+body).digest('hex');return request(app).post(`/api/sms/devsms/${universityId}`).set('Content-Type','application/json').set('X-DevSMS-Timestamp',timestamp).set('X-DevSMS-Signature',signed?signature:'invalid').send(body);};
    expect((await send('delivered',false)).status).toBe(401);expect((await send('delivered')).status).toBe(204);expect((await db.notificationJob.findUnique({where:{id:job.id}})).state).toBe('DELIVERED');await send('failed');expect((await db.notificationJob.findUnique({where:{id:job.id}})).state).toBe('DELIVERED');
    await db.smsProviderConfiguration.update({where:{universityId},data:{provider:'mock',credentialsEncrypted:null}});
  });
});
