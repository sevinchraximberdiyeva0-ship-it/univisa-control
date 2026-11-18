import fs from 'node:fs';
const sources=[['apps/api/src/notification-admin.ts','notificationAdmin','/api/notifications'],['apps/api/src/identity.ts','identityPublic','/api/auth'],['apps/api/src/identity.ts','identityAccount','/api/auth'],['apps/api/src/identity.ts','identityStaff','/api/identity'],['apps/api/src/passkeys.ts','passkeyRouter','/api/auth/passkeys'],['apps/api/src/email-verification.ts','emailVerificationRouter','/api/auth/email-verification'],['apps/api/src/passport-login.ts','passportLoginRouter','/api/auth/passport-login'],['apps/api/src/account-recovery.ts','accountRecoveryRouter','/api/auth/account-recovery']];
const source=fs.readFileSync('apps/api/src/app.ts','utf8')+'\n'+sources.map(([file,router,prefix])=>fs.readFileSync(file,'utf8').replace(new RegExp(router+"\\.(get|post|put|patch|delete)\\('([^']+)'",'g'),(_all,method,route)=>`app.${method}('${prefix}${route==='/'?'':route}'`)).join('\n');
const paths={};
for(const match of source.matchAll(/app\.(get|post|put|patch|delete)\('([^']+)'/g)) {
  const [,method,raw]=match;if(!raw.startsWith('/api/'))continue;
  const route=raw.slice(4).replace(/:([a-zA-Z]+)/g,'{$1}');
  const publicRoute=['/health','/auth/login','/sms/receipts','/auth/registration-options','/auth/student-registration','/auth/passkeys/authentication/options','/auth/passkeys/authentication/verify','/auth/passport-login/start','/auth/passport-login/confirm','/auth/account-recovery/complete'].includes(route);
  const parameters=[...route.matchAll(/\{([^}]+)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:{type:'string'}}));
  if(route==='/students')parameters.push({name:'search',in:'query',required:false,schema:{type:'string',maxLength:100}});
  if(route==='/identity/applications')parameters.push(
    {name:'status',in:'query',required:false,schema:{type:'string',enum:['SUBMITTED','VERIFIED','REJECTED']}},
    {name:'page',in:'query',required:false,schema:{type:'integer',minimum:1,maximum:1000000,default:1}},
    {name:'pageSize',in:'query',required:false,schema:{type:'integer',minimum:1,maximum:100,default:25}},
  );
  const operation={summary:`${method.toUpperCase()} ${route}`,operationId:`${method}_${route.replace(/[^a-z0-9]+/gi,'_')}`,tags:[route.split('/')[1]],security:publicRoute?[]:[{sessionCookie:[]}],parameters,responses:{'200':{description:'Successful request'},'201':{description:'Resource created'},'204':{description:'Successful request, no content'},'400':{description:'Invalid input'},'401':{description:'Authentication required'},'403':{description:'Role, tenant, MFA or CSRF restriction'},'404':{description:'Resource not found'},'409':{description:'Duplicate or invalid state transition'}}};
  if(!['get','delete'].includes(method))operation.requestBody={required:true,content:{[route==='/files'||route==='/import/preview'?'multipart/form-data':'application/json']:{schema:{type:'object',description:'See docs/API.md and the Zod route schema for field validation.'}}}};
  if(route==='/identity/applications')operation.responses['200'].description='Masked application rows; a paginated object when any supported query parameter is supplied, otherwise an array of up to 200 rows.';
  if(route==='/auth/email-verification/send'){
    operation.responses['429']={description:'Email resend limit reached'};
    operation.responses['503']={description:'Email delivery is unavailable or could not be confirmed'};
  }
  if(route==='/auth/passport-login/start'){
    operation.responses['202']={description:'Code request accepted; account existence is not disclosed'};
    operation.responses['429']={description:'Request limit reached'};
    operation.responses['503']={description:'Email delivery is disabled'};
  }
  paths[route]??={};paths[route][method]=operation;
}
paths['/telegram/webhook']={post:{summary:'Official Telegram private-chat command webhook',security:[{telegramSecret:[]}],requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['update_id'],properties:{update_id:{type:'integer'},message:{type:'object'}}}}}},responses:{'200':{description:'Update accepted or already processed'},'400':{description:'Invalid update'},'401':{description:'Invalid webhook secret'}}}};
paths['/sms/devsms/{universityId}']={post:{summary:'DevSMS HMAC delivery receipt; signature covers exact raw JSON bytes and timestamp',parameters:[{name:'universityId',in:'path',required:true,schema:{type:'string'}},{name:'X-DevSMS-Timestamp',in:'header',required:true,schema:{type:'string'}},{name:'X-DevSMS-Signature',in:'header',required:true,schema:{type:'string'}}],requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['sms_id','status'],properties:{sms_id:{type:'integer'},status:{enum:['sent','delivered','failed']}}}}}},responses:{'204':{description:'Valid receipt processed or already final'},'401':{description:'Invalid signature, stale timestamp or tenant provider'},'400':{description:'Invalid payload'}}}};
const document={openapi:'3.1.0',info:{title:'UniVisa Control REST API',version:'0.1.0',description:'Tenant-isolated REST API. Authenticated mutations require exact APP_ORIGIN and X-CSRF-Token. Staff require MFA. Response payloads and detailed field validation are described in API.md and executable Zod schemas.'},servers:[{url:'/api'}],components:{securitySchemes:{sessionCookie:{type:'apiKey',in:'cookie',name:'uv_session'},telegramSecret:{type:'apiKey',in:'header',name:'X-Telegram-Bot-Api-Secret-Token'}}},paths};
// JSON is valid YAML 1.2 and avoids a second serializer dependency.
fs.writeFileSync('docs/openapi.yaml',JSON.stringify(document,null,2)+'\n');
console.log(`Documented ${Object.keys(paths).length} API paths.`);
