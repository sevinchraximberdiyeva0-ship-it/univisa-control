import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { equal } from './security.js';
import { config } from './config.js';

export type SendResult={state:'MOCK'|'ACCEPTED'|'DELIVERED';providerMessageId?:string};
export interface SmsProvider {
  name?:string;
  send(phone:string,text:string,key:string):Promise<SendResult>;
  status?(id:string):Promise<'ACCEPTED'|'DELIVERED'|'FAILED'>;
}
export class ProviderError extends Error {
  constructor(public code:string,public retryAfterMs?:number){super(code);}
}
export class MockSmsProvider implements SmsProvider {
  name='mock';
  async send(phone:string,_text:string,key:string):Promise<SendResult> {
    if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new ProviderError('INVALID_NUMBER');
    return {state:'MOCK',providerMessageId:`mock-${key}`};
  }
}
const responseSchema=z.object({success:z.boolean(),data:z.object({sms_id:z.number().int().positive().optional(),id:z.number().int().positive().optional(),status:z.string().optional()}).optional()});
export const smsCredentials=z.object({token:z.string().min(10).max(4096),webhookKey:z.string().min(32).max(4096),sender:z.string().min(1).max(50).default('4546')});
export class DevSmsProvider implements SmsProvider {
  name='devsms';
  constructor(private credentials:z.infer<typeof smsCredentials>,private callbackUrl:string,private transport:typeof fetch=fetch){}
  private async request(endpoint:string,options:RequestInit={}) {
    let response:Response;
    try{response=await this.transport(`https://devsms.uz/api/${endpoint}`,{...options,redirect:'error',headers:{Authorization:`Bearer ${this.credentials.token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000)});}catch{throw new ProviderError('TRANSPORT_UNCERTAIN');}
    // Only an explicit rate rejection is considered safe to resend. HTTP 5xx is ambiguous.
    if(response.status===429)throw new ProviderError('TEMPORARY',Math.min(3600000,Math.max(30000,Number(response.headers.get('retry-after')??30)*1000)));
    if(response.status===401||response.status===403)throw new ProviderError('PROVIDER_AUTH');
    if(response.status>=500)throw new ProviderError('TRANSPORT_UNCERTAIN');
    if(!response.ok)throw new ProviderError('PROVIDER_REJECTED');
    const body=responseSchema.safeParse(await response.json().catch(()=>null));
    if(!body.success || !body.data.success || !body.data.data)throw new ProviderError('TRANSPORT_UNCERTAIN');
    return body.data.data;
  }
  async send(phone:string,text:string,_key:string):Promise<SendResult> {
    // The selected provider's documented route supports Uzbekistan numbers.
    if(!/^\+998\d{9}$/.test(phone))throw new ProviderError('UNSUPPORTED_NUMBER');
    const data=await this.request('send_sms.php',{method:'POST',body:JSON.stringify({phone:phone.slice(1),message:text,from:this.credentials.sender,callback_url:this.callbackUrl,type:'eskiz'})});
    if(!data.sms_id)throw new ProviderError('TRANSPORT_UNCERTAIN');
    return {state:'ACCEPTED',providerMessageId:String(data.sms_id)};
  }
  async status(id:string) {
    const data=await this.request(`get_status.php?sms_id=${encodeURIComponent(id)}`);
    if(String(data.id??data.sms_id)!==id)throw new ProviderError('RECEIPT_MISMATCH');
    return data.status==='delivered'?'DELIVERED':data.status==='failed'?'FAILED':'ACCEPTED';
  }
}
export function verifyDevSmsSignature(raw:Buffer,timestamp:string,signature:string,key:string,now=Date.now()) {
  if(!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300)return false;
  const expected='sha256='+createHmac('sha256',key).update(timestamp+'.').update(raw).digest('hex');
  return equal(signature,expected);
}
export async function telegramSend(chatId:string,text:string,markup?:unknown,transport:typeof fetch=fetch):Promise<SendResult> {
  if(config.TELEGRAM_MODE==='mock')return {state:'MOCK'};
  if(!config.ALLOW_LIVE_NOTIFICATIONS)throw new ProviderError('LIVE_DISABLED');
  let response:Response;
  try{response=await transport(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,reply_markup:markup}),signal:AbortSignal.timeout(10000)});}catch{throw new ProviderError('TRANSPORT_UNCERTAIN');}
  const body=await response.json().catch(()=>null) as {ok?:boolean;result?:{message_id?:number};error_code?:number;parameters?:{retry_after?:number}}|null;
  const code=body?.error_code??response.status;
  if(code===403)throw new ProviderError('CHANNEL_BLOCKED');
  if(code===429)throw new ProviderError('TEMPORARY',Math.min(3600000,Math.max(30000,(body?.parameters?.retry_after??30)*1000)));
  if(response.status>=500)throw new ProviderError('TRANSPORT_UNCERTAIN');
  if(!response.ok || !body?.ok)throw new ProviderError(code===401?'PROVIDER_AUTH':'PROVIDER_REJECTED');
  if(!Number.isSafeInteger(body.result?.message_id))throw new ProviderError('TRANSPORT_UNCERTAIN');
  return {state:'ACCEPTED',providerMessageId:String(body.result!.message_id)};
}
export function deliveryFailure(error:unknown,count:number) {
  const raw=error instanceof ProviderError?error.code:error instanceof Error?error.message:'TRANSPORT_UNCERTAIN';
  const known=['TEMPORARY','CHANNEL_BLOCKED','INVALID_NUMBER','UNSUPPORTED_NUMBER','PROVIDER_AUTH','PROVIDER_REJECTED','LIVE_DISABLED','TRANSPORT_UNCERTAIN'];
  const code=known.includes(raw)?raw:'TRANSPORT_UNCERTAIN';
  const retry=code==='TEMPORARY'&&count<3;
  const state=retry?'PENDING':code==='CHANNEL_BLOCKED'?'UNAVAILABLE':['TEMPORARY','INVALID_NUMBER','UNSUPPORTED_NUMBER','PROVIDER_AUTH','PROVIDER_REJECTED','LIVE_DISABLED'].includes(code)?'FAILED':'UNKNOWN';
  return {code,retry,state:state as 'PENDING'|'UNAVAILABLE'|'FAILED'|'UNKNOWN',delay:Math.max(30000*2**count,error instanceof ProviderError?error.retryAfterMs??0:0)};
}
