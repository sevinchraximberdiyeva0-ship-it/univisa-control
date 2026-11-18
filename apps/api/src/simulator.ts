import { languageSchema } from './languages.js';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { dateOnly,schedule } from './domain.js';
import { render } from './notifications.js';
import { MockSmsProvider,deliveryFailure } from './providers.js';
export const simulationInput=z.object({expirationDate:dateOnly,language:languageSchema.default('uz'),renewAtDays:z.number().int().min(0).max(30).nullable().default(null),smsFailure:z.enum(['none','temporary','permanent','ambiguous']).default('none'),telegramStarted:z.boolean().default(true)});
export async function simulate(input:z.infer<typeof simulationInput>,policy:{timezone:string;deliveryStart:number;deliveryEnd:number;thresholds:number[];overdueOffsets:number[]}){
  const expiry=new Date(input.expirationDate),start=DateTime.fromISO(input.expirationDate,{zone:policy.timezone}).minus({days:30}).set({hour:policy.deliveryStart});
  const slots=schedule(expiry,start.toJSDate(),policy.timezone,policy.thresholds,policy.deliveryStart,policy.deliveryEnd);
  const events:{daysRemaining:number;localDate:string;channel:string;kind:string;state:string;attempt:number;message:string;errorCode?:string}[]=[];
  const mock=new MockSmsProvider();
  const dedupe=new Set<string>();
  for(let days=30;days>=0;days--){
    const date=DateTime.fromISO(input.expirationDate,{zone:policy.timezone}).minus({days}).toISODate()!;
    if(input.renewAtDays!==null&&days===input.renewAtDays){
      for(const channel of ['SMS','TELEGRAM','IN_APP'])events.push({daysRemaining:days,localDate:date,channel,kind:'CONFIRMATION',state:channel==='TELEGRAM'&&!input.telegramStarted?'UNAVAILABLE':channel==='IN_APP'?'SIMULATED_DELIVERED':'MOCK',attempt:1,message:render(input.language,'CONFIRMATION','VISA',DateTime.fromISO(input.expirationDate).plus({years:1}).toISODate()!,365)});
      break;
    }
    if(!slots.some(s=>s.days===days))continue;
    for(const channel of ['SMS','TELEGRAM','IN_APP']){
      const key=`${date}-${channel}`;if(dedupe.has(key))continue;dedupe.add(key);
      const base={daysRemaining:days,localDate:date,channel,kind:'REMINDER',message:render(input.language,'REMINDER','VISA',input.expirationDate,days)};
      if(channel==='TELEGRAM'&&!input.telegramStarted){events.push({...base,state:'UNAVAILABLE',attempt:1});continue;}
      if(channel==='SMS'&&input.smsFailure!=='none'){
        const code=input.smsFailure==='temporary'?'TEMPORARY':input.smsFailure==='permanent'?'INVALID_NUMBER':'TRANSPORT_UNCERTAIN';
        for(let count=0;count<(input.smsFailure==='temporary'?4:1);count++){const failure=deliveryFailure(new Error(code),count);events.push({...base,state:failure.state,attempt:count+1,errorCode:failure.code});}
      }else {if(channel==='SMS')await mock.send('+998000000000',base.message,key);events.push({...base,state:channel==='IN_APP'?'SIMULATED_DELIVERED':'MOCK',attempt:1});}
    }
    if(days===14||days===0)events.push({daysRemaining:days,localDate:date,channel:'STAFF',kind:'ESCALATION',state:'SIMULATED_TASK',attempt:1,message:'Officer follow-up required'});
  }
  if(input.renewAtDays===null)for(const offset of policy.overdueOffsets)events.push({daysRemaining:-offset,localDate:DateTime.fromISO(input.expirationDate).plus({days:offset}).toISODate()!,channel:'STAFF',kind:'OVERDUE',state:'SIMULATED_TASK',attempt:1,message:'Configurable overdue review'});
  return {simulation:true,realMessagesSent:0,queuedJobs:0,policy,events,canceledAfterRenewal:input.renewAtDays!==null};
}
