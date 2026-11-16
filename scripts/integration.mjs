import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import pgClient from 'pg';
const { pg_ctl }=process.platform==='win32'?await import('@embedded-postgres/windows-x64'):{pg_ctl:undefined};
const root=process.cwd();
const dir=path.resolve(root,'test-results',`postgres-${Date.now()}`);
await mkdir(dir,{recursive:true});
const password=randomBytes(24).toString('hex');
const browserMode=process.argv.includes('--browser');
const children=[];
const pg=new EmbeddedPostgres({databaseDir:dir,user:'univisa_test',password,port:55439,persistent:true,authMethod:'scram-sha-256',initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:console.error});
function run(file,args,env) {return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file,...args],{cwd:root,env:{...process.env,...env},stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Command exited ${code}`)));});}
function control(args) {return new Promise((resolve,reject)=>{const child=spawn(pg_ctl,args,{windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`pg_ctl exited ${code}`)));});}
async function ready(url) {for(let i=0;i<80;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error(`Service did not become ready: ${url}`);}
let started=false;
try {
  console.log('Initializing disposable PostgreSQL');await pg.initialise();console.log('Starting disposable PostgreSQL');
  if(process.platform==='win32')await control(['start','-D',dir,'-l',path.join(dir,'server.log'),'-o','-p 55439 -h 127.0.0.1','-w']);else await pg.start();started=true;
  const admin=new pgClient.Client({host:'127.0.0.1',port:55439,user:'univisa_test',password,database:'postgres'});await admin.connect();await admin.query('CREATE DATABASE univisa_integration ENCODING \'UTF8\' TEMPLATE template0');await admin.end();
  const url=`postgresql://univisa_test:${password}@localhost:55439/univisa_integration`;
  await run('node_modules/prisma/build/index.js',['migrate','deploy','--schema','apps/api/prisma/schema.prisma'],{DATABASE_URL:url});
  await run('node_modules/prisma/build/index.js',['migrate','diff','--from-url',url,'--to-schema-datamodel','apps/api/prisma/schema.prisma','--exit-code'],{DATABASE_URL:url});
  if(browserMode) {
    const env={DATABASE_URL:url,NODE_ENV:'test',SMS_MODE:'mock',TELEGRAM_MODE:'mock',ALLOW_LIVE_NOTIFICATIONS:'false',ENCRYPTION_KEY:randomBytes(32).toString('hex'),SEED_ADMIN_EMAIL:'admin@example.invalid',SEED_ADMIN_PASSWORD:randomBytes(20).toString('hex'),SEED_STUDENT_PASSWORD:randomBytes(20).toString('hex'),APP_ORIGIN:'http://localhost:5173',STORAGE_PATH:path.join(dir,'private-files')};
    await run('node_modules/tsx/dist/cli.mjs',['apps/api/prisma/seed.ts'],env);
    children.push(spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','apps/api/src/server.ts'],{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true}));
    children.push(spawn(process.execPath,[path.resolve('node_modules/vite/bin/vite.js'),'--host','127.0.0.1'],{cwd:path.join(root,'apps/web'),env:process.env,stdio:'inherit',windowsHide:true}));
    await ready('http://localhost:4000/api/health');await ready('http://localhost:5173');
    await run('node_modules/@playwright/test/cli.js',['test'],{E2E_ADMIN_PASSWORD:env.SEED_ADMIN_PASSWORD,E2E_STUDENT_PASSWORD:env.SEED_STUDENT_PASSWORD});
  }else await run('node_modules/vitest/vitest.mjs',['run','--root','apps/api'],{TEST_DATABASE_URL:url,SMS_MODE:'mock',TELEGRAM_MODE:'mock',ALLOW_LIVE_NOTIFICATIONS:'false'});
  console.log('Database integration run completed.');
} finally {for(const child of children)child.kill();if(started){if(process.platform==='win32')await control(['stop','-D',dir,'-m','fast','-w']);else await pg.stop();}}
