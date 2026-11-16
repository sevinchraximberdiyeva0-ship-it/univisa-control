import fs from 'node:fs';
const source=fs.readFileSync('apps/api/src/app.ts','utf8')+'\n'+fs.readFileSync('apps/api/src/notification-admin.ts','utf8').replace(/notificationAdmin\.(get|post|put)\('([^']+)'/g,(_all,method,route)=>`app.${method}('/api/notifications${route}'`);
const paths={};
for(const match of source.matchAll(/app\.(get|post|put|patch|delete)\('([^']+)'/g)) {
  const [,method,raw]=match;if(!raw.startsWith('/api/'))continue;
  const route=raw.slice(4).replace(/:([a-zA-Z]+)/g,'{$1}');
  const publicRoute=['/health','/auth/login','/sms/receipts'].includes(route);
  const parameters=[...route.matchAll(/\{([^}]+)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:{type:'string'}}));
  if(route==='/students')parameters.push({name:'search',in:'query',required:false,schema:{type:'string',maxLength:100}});
  const operation={summary:`${method.toUpperCase()} ${route}`,operationId:`${method}_${route.replace(/[^a-z0-9]+/gi,'_')}`,tags:[route.split('/')[1]],security:publicRoute?[]:[{sessionCookie:[]}],parameters,responses:{'200':{description:'Successful request'},'201':{description:'Resource created'},'204':{description:'Successful request, no content'},'400':{description:'Invalid input'},'401':{description:'Authentication required'},'403':{description:'Role, tenant, MFA or CSRF restriction'},'404':{description:'Resource not found'},'409':{description:'Duplicate or invalid state transition'}}};
  if(!['get','delete'].includes(method))operation.requestBody={required:true,content:{[route==='/files'||route==='/import/preview'?'multipart/form-data':'application/json']:{schema:{type:'object',description:'See docs/API.md and the Zod route schema for field validation.'}}}};
  paths[route]??={};paths[route][method]=operation;
}
paths['/telegram/webhook']={post:{summary:'Official Telegram private-chat command webhook',security:[{telegramSecret:[]}],requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['update_id'],properties:{update_id:{type:'integer'},message:{type:'object'}}}}}},responses:{'200':{description:'Update accepted or already processed'},'400':{description:'Invalid update'},'401':{description:'Invalid webhook secret'}}}};
paths['/sms/devsms/{universityId}']={post:{summary:'DevSMS HMAC delivery receipt; signature covers exact raw JSON bytes and timestamp',parameters:[{name:'universityId',in:'path',required:true,schema:{type:'string'}},{name:'X-DevSMS-Timestamp',in:'header',required:true,schema:{type:'string'}},{name:'X-DevSMS-Signature',in:'header',required:true,schema:{type:'string'}}],requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['sms_id','status'],properties:{sms_id:{type:'integer'},status:{enum:['sent','delivered','failed']}}}}}},responses:{'204':{description:'Valid receipt processed or already final'},'401':{description:'Invalid signature, stale timestamp or tenant provider'},'400':{description:'Invalid payload'}}}};
const document={openapi:'3.1.0',info:{title:'UniVisa Control REST API',version:'0.1.0',description:'Tenant-isolated REST API. Authenticated mutations require exact APP_ORIGIN and X-CSRF-Token. Staff require MFA. Response payloads and detailed field validation are described in API.md and executable Zod schemas.'},servers:[{url:'/api'}],components:{securitySchemes:{sessionCookie:{type:'apiKey',in:'cookie',name:'uv_session'},telegramSecret:{type:'apiKey',in:'header',name:'X-Telegram-Bot-Api-Secret-Token'}}},paths};
// JSON is valid YAML 1.2 and avoids a second serializer dependency.
fs.writeFileSync('docs/openapi.yaml',JSON.stringify(document,null,2)+'\n');
console.log(`Documented ${Object.keys(paths).length} API paths.`);
