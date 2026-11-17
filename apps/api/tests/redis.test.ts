import { afterAll,beforeAll,describe,it,expect,vi } from 'vitest';
import type { PrismaClient,StudentDocument } from '@prisma/client';
import type { queueRuntime } from '../src/scheduler.js';
import { randomUUID } from 'node:crypto';

// Test only synthetic records and this run's Redis prefix. Never FLUSHDB/FLUSHALL.
const enabled=!!process.env.TEST_DATABASE_URL&&!!process.env.TEST_REDIS_URL;
if(process.env.REQUIRE_REDIS_TESTS==='true'&&!enabled)throw new Error('REQUIRE_REDIS_TESTS=true requires TEST_DATABASE_URL and TEST_REDIS_URL');
type Runtime=ReturnType<typeof queueRuntime>;
describe.skipIf(!enabled)('real Redis + PostgreSQL notification recovery',()=>{
  const prefix=`univisa-test-${randomUUID()}`;
  let db:PrismaClient,runtime:Runtime|undefined,document:StudentDocument,universityId:string;
  let createRuntime:typeof queueRuntime,enqueuePending:typeof import('../src/scheduler.js').enqueuePending;
  const connections:Runtime[]=[];
  let sequence=0;

  async function waitFor(predicate:()=>Promise<boolean>,message:string){
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}
    throw new Error(message);
  }
  async function open(autorun=true){
    // Use the real application processor and database delivery ledger, not an in-memory stub.
    const next=createRuntime(process.env.TEST_REDIS_URL!,undefined,{prefix,autorun});
    connections.push(next);await next.queue.waitUntilReady();await next.worker.waitUntilReady();runtime=next;return next;
  }
  async function notification(){
    return db.notificationJob.create({data:{universityId,studentId:document.studentId,documentId:document.id,version:1,kind:'CONFIRMATION',channel:'IN_APP',scheduledDate:new Date().toISOString().slice(0,10),scheduledAt:new Date(0),idempotencyKey:`${prefix}-${++sequence}`}});
  }
  async function delivered(id:string){await waitFor(async()=>!!await db.notificationJob.findFirst({where:{id,state:'DELIVERED'}}),'Database delivery was not confirmed');expect(await db.notificationAttempt.count({where:{jobId:id}})).toBe(1);}

  beforeAll(async()=>{
    const target=new URL(process.env.TEST_REDIS_URL!);
    if(target.pathname!=='/15')throw new Error('TEST_REDIS_URL must target a dedicated test database /15');
    process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.ENCRYPTION_KEY='a'.repeat(64);process.env.NODE_ENV='test';process.env.SMS_MODE='mock';process.env.TELEGRAM_MODE='mock';process.env.ALLOW_LIVE_NOTIFICATIONS='false';
    // Fail if any notification provider tries to reach an external HTTP endpoint.
    vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('External network forbidden in Redis tests'));
    ({db}=await import('../src/db.js'));({queueRuntime:createRuntime,enqueuePending}=await import('../src/scheduler.js'));
    const university=await db.university.create({data:{name:'Synthetic Redis test',slug:prefix,timezone:'UTC',deliveryStart:0,deliveryEnd:24,contactEmail:'synthetic@example.invalid'}});universityId=university.id;
    const faculty=await db.faculty.create({data:{universityId,name:'Synthetic faculty'}});
    const student=await db.student.create({data:{universityId,studentNumber:'REDIS-SYNTHETIC',fullName:'Synthetic Redis Student',facultyId:faculty.id,program:'Testing',year:1,group:'TEST',nationality:'Example',email:'synthetic@example.invalid'}});
    document=await db.studentDocument.create({data:{universityId,studentId:student.id,type:'VISA',issueDate:new Date('2026-01-01'),expirationDate:new Date('2099-12-31')}});
  });
  afterAll(async()=>{
    try{
      if(runtime){await runtime.worker.close();await runtime.queue.obliterate({force:true});}
    }finally{
      await Promise.allSettled(connections.map(connection=>connection.close()));
      vi.restoreAllMocks();
      if(db&&universityId){
        await db.notificationAttempt.deleteMany({where:{job:{universityId}}});await db.notificationJob.deleteMany({where:{universityId}});await db.staffTask.deleteMany({where:{universityId}});await db.studentDocument.deleteMany({where:{universityId}});await db.student.deleteMany({where:{universityId}});await db.faculty.deleteMany({where:{universityId}});await db.university.delete({where:{id:universityId}});
      }
      await db?.$disconnect();
    }
  });

  it('delivers a persisted pending job after its consumer is replaced',async()=>{
    const pending=await notification();const first=await open(false);
    await enqueuePending(first.queue);expect(await first.queue.getJob(pending.id)).toBeDefined();
    await first.close();await open();await delivered(pending.id);
  });
  it('rebuilds actual lost queue data from PostgreSQL without losing a pending message',async()=>{
    const pending=await notification();await runtime!.close();const paused=await open(false);
    await enqueuePending(paused.queue);expect(await paused.queue.getJob(pending.id)).toBeDefined();
    // Only this test's queue prefix is deleted; unrelated Redis data is untouched.
    await paused.queue.obliterate({force:true});expect(await paused.queue.getJob(pending.id)).toBeUndefined();
    await paused.close();const replacement=await open();await enqueuePending(replacement.queue);await delivered(pending.id);
  });
  it('suppresses a replayed completed message using the persisted database state',async()=>{
    const pending=await notification();await enqueuePending(runtime!.queue);await delivered(pending.id);
    const replayId=`replay-${randomUUID()}`;
    await runtime!.queue.add('deliver',{id:pending.id},{jobId:replayId,removeOnComplete:false});
    await waitFor(async()=>(await runtime!.queue.getJob(replayId))?.getState().then(state=>state==='completed')??false,'Replay was not processed');
    expect(await db.notificationAttempt.count({where:{jobId:pending.id}})).toBe(1);
  });
  it('recovers a retained failed queue entry from its still-pending database record',async()=>{
    await runtime!.close();
    const pending=await notification();
    const failing=createRuntime(process.env.TEST_REDIS_URL!,async()=>{throw new Error('Synthetic queue processor failure');},{prefix});connections.push(failing);runtime=failing;
    await failing.queue.waitUntilReady();await failing.worker.waitUntilReady();
    await failing.queue.add('deliver',{id:pending.id},{jobId:pending.id,attempts:1,removeOnFail:false});
    await waitFor(async()=>(await failing.queue.getJob(pending.id))?.getState().then(state=>state==='failed')??false,'Synthetic failure was not retained');
    expect((await db.notificationJob.findUniqueOrThrow({where:{id:pending.id}})).state).toBe('PENDING');
    await failing.close();const replacement=await open();await enqueuePending(replacement.queue);await delivered(pending.id);
  });
});
