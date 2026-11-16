import { describe,it,expect } from 'vitest';
// Real Redis integration is opt-in and restricted to a dedicated DB 15 instance.
const enabled=!!process.env.TEST_DATABASE_URL&&!!process.env.TEST_REDIS_URL;
describe.skipIf(!enabled)('real Redis/BullMQ recovery',()=>{
  it('survives consumer restart and rebuilds queue loss without duplicate external processing',async()=>{
    const url=process.env.TEST_REDIS_URL!;if(new URL(url).pathname!=='/15')throw new Error('TEST_REDIS_URL must target isolated database /15');
    process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.ENCRYPTION_KEY='a'.repeat(64);process.env.NODE_ENV='test';process.env.ALLOW_LIVE_NOTIFICATIONS='false';
    const {queueRuntime}=await import('../src/scheduler.js');
    const processed=new Set<string>();let calls=0;
    const processor=async(_name:string,id:string)=>{if(processed.has(id))return;processed.add(id);calls++;};
    let runtime=queueRuntime(url,processor);
    const waitFor=async(predicate:()=>boolean)=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Redis recovery timed out');};
    try{
      await runtime.queue.waitUntilReady();await runtime.worker.waitUntilReady();
      await runtime.queue.add('test',{id:'persistent-fixture'},{jobId:'persistent-fixture',delay:200,removeOnComplete:true});
      await runtime.close();runtime=queueRuntime(url,processor);await waitFor(()=>calls===1);
      // Model an outbox replay after queue data loss. The durable processor ledger prevents resend.
      await runtime.queue.add('test',{id:'persistent-fixture'},{jobId:'persistent-fixture-rebuilt',removeOnComplete:true});
      await new Promise(r=>setTimeout(r,250));expect(calls).toBe(1);
    }finally{await runtime.close();}
  },20000);
});
