import pino from 'pino';
import { config } from './config.js';
import { db } from './db.js';
import { queueRuntime,schedulerTick } from './scheduler.js';
const log=pino(),runtime=queueRuntime(config.REDIS_URL);
runtime.worker.on('error',()=>log.error({event:'worker_error'}));
runtime.worker.on('failed',job=>log.error({event:'job_failed',jobId:job?.id}));
let running=false;
async function tick(){if(running)return;running=true;try{const pending=await schedulerTick(runtime.queue);log.info({event:'scheduler_tick',pending});}catch{log.error({event:'scheduler_failed'});}finally{running=false;}}
await tick();const timer=setInterval(()=>void tick(),30000);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{clearInterval(timer);await runtime.close();await db.$disconnect();process.exit(0);});
