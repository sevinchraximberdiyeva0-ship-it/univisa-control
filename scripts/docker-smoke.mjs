import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir,writeFile,unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function smokeEnvironment(){
  const id=randomBytes(6).toString('hex');
  return {project:`univisa-smoke-${id}`,values:{NODE_ENV:'production',PORT:'4000',APP_ORIGIN:'https://univisa-smoke.invalid',POSTGRES_USER:'univisa_smoke',POSTGRES_PASSWORD:randomBytes(32).toString('hex'),POSTGRES_DB:'univisa_smoke',ENCRYPTION_KEY:randomBytes(32).toString('hex'),SMS_MODE:'mock',TELEGRAM_MODE:'mock',ALLOW_LIVE_NOTIFICATIONS:'false'}};
}
export function assertProject(project){assert.match(project,/^univisa-smoke-[a-f0-9]{12}$/,'Refusing to operate outside the generated smoke-test project');}
export function publishedOrigin(value){
  const match=/^127\.0\.0\.1:(\d+)$/.exec(value.trim());
  if(!match||Number(match[1])<1||Number(match[1])>65535)throw new Error('Smoke service must publish an ephemeral loopback port');
  return `http://${match[0]}`;
}
export function redact(value,secrets){let text=String(value);for(const secret of secrets.filter(s=>s&&s.length>=12))text=text.replaceAll(secret,'[redacted]');return text;}

export async function dockerSmoke(){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const {project,values}=smokeEnvironment();assertProject(project);
  const directory=path.join(root,'test-results',project),envFile=path.join(directory,'smoke.env');
  const secrets=[values.POSTGRES_PASSWORD,values.ENCRYPTION_KEY];
  const env={...process.env,...values,UNIVISA_ENV_FILE:envFile,COMPOSE_INTERACTIVE_NO_CLI:'1'};
  const composeArgs=['compose','--project-name',project,'--env-file',envFile,'-f',path.join(root,'docker-compose.yml'),'-f',path.join(root,'deploy/compose.smoke.yml')];
  const checks=[];
  let resourcesStarted=false,success=false;
  function command(args,{input,allowFailure=false,timeout=180000}={}){
    return new Promise((resolve,reject)=>{
      const child=spawn('docker',args,{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
      let stdout='',stderr='';
      const timer=setTimeout(()=>{child.kill();reject(new Error(`Docker command timed out: ${args[0]} ${args[1]??''}`));},timeout);
      child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
      child.on('error',error=>{clearTimeout(timer);reject(new Error(error.code==='ENOENT'?'Docker is not installed; use the docker-smoke CI job or a Docker-enabled host':error.message));});
      child.on('close',code=>{clearTimeout(timer);const output={code,stdout:redact(stdout,secrets),stderr:redact(stderr,secrets)};if(code!==0&&!allowFailure)reject(new Error(`Docker command failed (${code}):\n${output.stderr.slice(-18000)}\n${output.stdout.slice(-18000)}`));else resolve(output);});
      child.stdin.on('error',()=>{});child.stdin.end(input??'');
    });
  }
  const compose=(args,options)=>{assertProject(project);return command([...composeArgs,...args],options);};
  const mark=name=>{checks.push(name);console.log(`PASS ${name}`);};
  async function script(service,source){const output=await compose(['exec','-T',service,'node','--input-type=module'],{input:source});return output.stdout.trim();}
  async function waitFor(check,message,timeout=100000){const until=Date.now()+timeout;while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,1000));}throw new Error(message);}
  const dataScript=body=>`const {db}=await import('./apps/api/dist/src/db.js');try{${body}}finally{await db.$disconnect();}`;
  const queueScript=body=>dataScript(`const {Queue}=await import('bullmq');const {Redis}=await import('ioredis');const connection=new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:1});const queue=new Queue('univisa-delivery',{connection});try{${body}}finally{await queue.close();await connection.quit();}`);
  try{
    await command(['info','--format','{{.ServerVersion}}'],{timeout:30000});
    await mkdir(directory,{recursive:true});
    await writeFile(envFile,Object.entries(values).map(([key,value])=>`${key}=${value}`).join('\n')+'\n',{mode:0o600});
    await compose(['config','--quiet']);mark('Compose configuration resolves with isolated environment');
    resourcesStarted=true;
    console.log('Building application and migration images…');
    await compose(['build'],{timeout:600000});mark('Docker images build');
    await compose(['up','--detach','--wait','--wait-timeout','150'],{timeout:210000});mark('Migrations complete and all services become healthy');
    const web=publishedOrigin((await compose(['port','web','80'])).stdout),api=publishedOrigin((await compose(['port','api','4000'])).stdout);
    const request=url=>fetch(url,{signal:AbortSignal.timeout(10000)});
    const home=await request(web);assert.equal(home.status,200);assert.match(await home.text(),/UniVisa Control/);
    const route=await request(`${web}/renewals`);assert.equal(route.status,200);assert.match(await route.text(),/id="root"/);mark('Frontend and SPA route are served by Nginx');
    const health=await request(`${web}/api/health`);assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok',sms:'mock',telegram:'mock'});
    assert.equal((await request(`${api}/api/students`)).status,401);mark('Nginx API proxy works and unauthenticated student access is denied');
    for(const service of ['api','worker']){
      const uid=await script(service,"console.log(JSON.stringify({uid:process.getuid(),nodeEnv:process.env.NODE_ENV,sms:process.env.SMS_MODE,telegram:process.env.TELEGRAM_MODE,live:process.env.ALLOW_LIVE_NOTIFICATIONS}));");
      assert.deepEqual(JSON.parse(uid),{uid:1000,nodeEnv:'production',sms:'mock',telegram:'mock',live:'false'});
    }mark('API and worker run as non-root with live sending disabled');
    await script('api',"const fs=await import('node:fs/promises');await fs.writeFile('/app/storage/.smoke-probe','synthetic-only',{mode:0o600});await fs.unlink('/app/storage/.smoke-probe');for(const name of ['vitest','embedded-postgres']){try{import.meta.resolve(name);throw new Error('Development dependency leaked into runtime: '+name);}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}}");mark('Private storage is writable and test tools are absent from runtime');
    const fixture=JSON.parse(await script('api',dataScript(`
      const university=await db.university.create({data:{name:'Synthetic Docker Smoke University',slug:'docker-smoke',contactEmail:'synthetic@example.invalid',timezone:'UTC',deliveryStart:0,deliveryEnd:24}});
      const faculty=await db.faculty.create({data:{universityId:university.id,name:'Synthetic Faculty'}});
      const student=await db.student.create({data:{universityId:university.id,facultyId:faculty.id,studentNumber:'DOCKER-SYNTHETIC',fullName:'Synthetic Docker Student',program:'Testing',year:1,group:'TEST',nationality:'Example',email:'synthetic@example.invalid'}});
      const document=await db.studentDocument.create({data:{universityId:university.id,studentId:student.id,type:'VISA',issueDate:new Date('2026-01-01'),expirationDate:new Date('2099-12-31')}});
      const job=await db.notificationJob.create({data:{universityId:university.id,studentId:student.id,documentId:document.id,version:1,kind:'CONFIRMATION',channel:'IN_APP',scheduledDate:new Date().toISOString().slice(0,10),scheduledAt:new Date(0),idempotencyKey:'smoke-first'}});
      console.log(JSON.stringify({universityId:university.id,studentId:student.id,documentId:document.id,jobId:job.id}));
    `)));
    async function delivered(jobId){return JSON.parse(await script('api',dataScript(`const job=await db.notificationJob.findUniqueOrThrow({where:{id:${JSON.stringify(jobId)}}});console.log(JSON.stringify({state:job.state,attempts:await db.notificationAttempt.count({where:{jobId:job.id}})}));`)));}
    await waitFor(async()=>{const result=await delivered(fixture.jobId);return result.state==='DELIVERED'&&result.attempts===1;},'Worker failed to deliver synthetic in-app notification');mark('Worker processes PostgreSQL outbox through Redis exactly once in the tested scenario');
    await script('api',queueScript(`await queue.add('deliver',{id:${JSON.stringify(fixture.jobId)}},{jobId:'smoke-replay',removeOnComplete:false});`));
    await waitFor(async()=>await script('api',queueScript("const job=await queue.getJob('smoke-replay');console.log(job?await job.getState():'missing');"))==='completed','Replayed job did not complete');
    assert.equal((await delivered(fixture.jobId)).attempts,1);mark('Replayed job does not duplicate persisted notification attempts');
    await compose(['stop','--timeout','20','worker']);
    const pendingId=JSON.parse(await script('api',queueScript(`const job=await db.notificationJob.create({data:{universityId:${JSON.stringify(fixture.universityId)},studentId:${JSON.stringify(fixture.studentId)},documentId:${JSON.stringify(fixture.documentId)},version:1,kind:'CONFIRMATION',channel:'IN_APP',scheduledDate:new Date().toISOString().slice(0,10),scheduledAt:new Date(0),idempotencyKey:'smoke-after-restart'}});await queue.add('deliver',{id:job.id},{jobId:job.id,removeOnComplete:true});console.log(JSON.stringify(job.id));`)));
    await compose(['restart','redis']);
    await compose(['up','--detach','--wait','--wait-timeout','150','worker'],{timeout:210000});
    await waitFor(async()=>{const result=await delivered(pendingId);return result.state==='DELIVERED'&&result.attempts===1;},'Pending message was not recovered after Redis/worker restart');
    assert.equal((await delivered(fixture.jobId)).attempts,1);mark('Pending notification survives Redis server and worker restart without replaying old delivery');
    const migration=await compose(['run','--rm','-T','migrate']);assert.equal(migration.code,0);mark('Migration command is safe to repeat');
    success=true;
  }catch(error){
    if(resourcesStarted){const diagnostics=await compose(['logs','--no-color','--tail','80'],{allowFailure:true}).catch(()=>({stdout:'Diagnostics unavailable',stderr:''}));await writeFile(path.join(directory,'diagnostics.log'),diagnostics.stdout+'\n'+diagnostics.stderr).catch(()=>{});}
    console.error(redact(error instanceof Error?error.message:String(error),secrets));process.exitCode=1;
  }finally{
    if(resourcesStarted){try{await compose(['down','--volumes','--remove-orphans','--rmi','local'],{timeout:120000});mark('Only the generated smoke project is cleaned up');}catch(error){success=false;process.exitCode=1;console.error(redact(error instanceof Error?error.message:String(error),secrets));}}
    await unlink(envFile).catch(()=>{});
    await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'result.json'),JSON.stringify({project,success,checks,liveMessagesSent:0},null,2));
    console.log(success?'Docker smoke test passed. Only synthetic in-app notifications were processed.':'Docker smoke test did not pass; inspect the redacted diagnostics and result JSON.');
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await dockerSmoke();
