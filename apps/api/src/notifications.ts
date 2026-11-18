import { Prisma, type Channel, type StudentDocument } from '@prisma/client';
import { DateTime } from 'luxon';
import { db } from './db.js';
import { remaining, schedule } from './domain.js';
import { config } from './config.js';
import { decrypt,encrypt } from './security.js';
import { resolveLanguage,type Language } from './languages.js';
import { DevSmsProvider, MockSmsProvider, deliveryFailure, smsCredentials, telegramSend, type SmsProvider, type SendResult } from './providers.js';
export { MockSmsProvider,telegramSend } from './providers.js';
export type { SmsProvider,SendResult } from './providers.js';
type Tx=Prisma.TransactionClient;
export const messages:Record<Language,{reminder:string;critical:string;confirmed:string}>={
  en:{reminder:'Your {type} is scheduled to expire on {date}. Remaining time: {days} days. Please contact the university international office for renewal assistance.',critical:'URGENT: Your {type} expires on {date}. {days} days remain. Please contact the university international office today.',confirmed:'Your updated {type} information has been verified by the university. New expiration date: {date}. Previous reminders have been canceled.'},
  uz:{reminder:'{type} hujjatingizning amal qilish muddati {date} kuni tugashi rejalashtirilgan. {days} kun qoldi. Yangilash uchun universitet xalqaro bo‘limiga murojaat qiling.',critical:'SHOSHILINCH: {type} hujjatingiz {date} kuni tugaydi. {days} kun qoldi. Bugun universitet xalqaro bo‘limiga murojaat qiling.',confirmed:'Universitet yangilangan {type} ma’lumotlaringizni tasdiqladi. Yangi amal qilish muddati: {date}. Oldingi eslatmalar bekor qilindi.'},
  ru:{reminder:'Срок действия документа {type} заканчивается {date}. Осталось дней: {days}. Обратитесь в международный отдел университета для продления.',critical:'СРОЧНО: срок действия документа {type} заканчивается {date}. Осталось дней: {days}. Свяжитесь с международным отделом университета сегодня.',confirmed:'Университет подтвердил обновлённые сведения о документе {type}. Новый срок действия: {date}. Предыдущие напоминания отменены.'},
  tk:{reminder:'{type} resminamaňyzyň möhleti {date} senesinde gutarýar. {days} gün galdy. Möhleti uzaltmak üçin uniwersitetiň halkara bölümine ýüz tutuň.',critical:'GYSSAGLY: {type} resminamaňyzyň möhleti {date} senesinde gutarýar. {days} gün galdy. Şu gün uniwersitetiň halkara bölümine ýüz tutuň.',confirmed:'Uniwersitet {type} resminamaňyzyň täzelenen maglumatlaryny tassyklady. Täze gutarýan senesi: {date}. Öňki ýatlatmalar ýatyryldy.'},
  ko:{reminder:'{type} 서류의 유효기간이 {date}에 만료될 예정입니다. {days}일 남았습니다. 갱신은 대학 국제처에 문의하세요.',critical:'긴급: {type} 서류가 {date}에 만료됩니다. {days}일 남았습니다. 오늘 대학 국제처에 문의하세요.',confirmed:'대학에서 갱신된 {type} 정보를 확인했습니다. 새 만료일은 {date}입니다. 이전 알림은 취소되었습니다.'},
  zh:{reminder:'您的{type}证件预计于{date}到期，还有{days}天。请联系大学国际事务办公室办理续期。',critical:'紧急：您的{type}证件将于{date}到期，还有{days}天。请于今天联系大学国际事务办公室。',confirmed:'大学已核实您更新后的{type}证件信息。新的到期日期为{date}。之前的提醒已取消。'},
};
const corrections:Record<Language,string>={
  en:'Your renewal submission needs attention. Please sign in to your university portal to review the officer’s notes and requested corrections. This message is not a determination of your immigration status.',
  uz:'Yangilash arizangizga e’tibor talab etiladi. Xodim izohlari va so‘ralgan tuzatishlarni ko‘rish uchun universitet portaliga kiring. Bu xabar immigratsiya maqomingiz bo‘yicha xulosa emas.',
  ru:'Ваша заявка на продление требует внимания. Войдите в университетский портал, чтобы прочитать замечания сотрудника и внести исправления. Это сообщение не является оценкой вашего иммиграционного статуса.',
  tk:'Möhleti uzaltmak baradaky arzaňyza serediň. Işgäriň belliklerini we islenen düzedişleri görmek üçin uniwersitetiň portalyna giriň. Bu habar migrasiýa ýagdaýyňyz barada karar däldir.',
  ko:'갱신 신청을 확인해 주세요. 대학 포털에 로그인하여 담당자의 의견과 수정 요청을 확인하세요. 이 메시지는 체류 자격에 관한 결정이 아닙니다.',
  zh:'您的续期申请需要处理。请登录大学门户，查看工作人员的意见和修改要求。此消息不代表对您移民身份的认定。',
};
export function render(language:string,kind:string,type:string,date:string,days:number,custom?:string) {
  if(custom)return custom.replaceAll('{type}',type).replaceAll('{date}',date).replaceAll('{days}',String(days));
  const lang=resolveLanguage(language);
  const special={
    en:{urgent:'URGENT: Your {type} expires on {date}. 14 days remain. Contact the university international office to arrange renewal.',expired:'FINAL WARNING: Your {type} is scheduled to expire today ({date}). Contact the university international office immediately. Staff have been alerted.',overdue:'Your {type} expiration date was {date}. Please contact the university international office to review your record and renewal status.'},
    uz:{urgent:'SHOSHILINCH: {type} hujjatingiz {date} kuni tugaydi. 14 kun qoldi. Yangilash uchun universitet xalqaro bo‘limiga murojaat qiling.',expired:'YAKUNIY OGOHLANTIRISH: {type} hujjatingiz bugun ({date}) tugashi rejalashtirilgan. Zudlik bilan xalqaro bo‘limga murojaat qiling. Mas’ul xodim ogohlantirildi.',overdue:'{type} hujjatingizning amal qilish sanasi {date} edi. Ma’lumotlar va yangilash holatini tekshirish uchun xalqaro bo‘limga murojaat qiling.'},
    ru:{urgent:'СРОЧНО: срок документа {type} заканчивается {date}. Осталось 14 дней. Свяжитесь с международным отделом для продления.',expired:'ПОСЛЕДНЕЕ ПРЕДУПРЕЖДЕНИЕ: срок документа {type} заканчивается сегодня ({date}). Немедленно свяжитесь с международным отделом. Сотрудник уведомлён.',overdue:'Срок документа {type} был указан до {date}. Свяжитесь с международным отделом для проверки данных и статуса продления.'},
    tk:{urgent:'GYSSAGLY: {type} resminamaňyzyň möhleti {date} senesinde gutarýar. 14 gün galdy. Möhleti uzaltmak üçin halkara bölüme ýüz tutuň.',expired:'SOŇKY DUÝDURYŞ: {type} resminamaňyzyň möhleti şu gün ({date}) gutarýar. Derrew halkara bölüme ýüz tutuň. Jogapkär işgär habarly edildi.',overdue:'{type} resminamaňyzyň möhleti {date} senesinde gutardy. Maglumatlaryňyzy we arzanyň ýagdaýyny barlamak üçin halkara bölüme ýüz tutuň.'},
    ko:{urgent:'긴급: {type} 서류가 {date}에 만료됩니다. 14일 남았습니다. 갱신은 대학 국제처에 문의하세요.',expired:'최종 안내: {type} 서류가 오늘({date}) 만료될 예정입니다. 즉시 대학 국제처에 문의하세요. 담당자에게도 알렸습니다.',overdue:'{type} 서류의 만료일은 {date}였습니다. 기록과 갱신 상태를 확인하려면 대학 국제처에 문의하세요.'},
    zh:{urgent:'紧急：您的{type}证件将于{date}到期，还有14天。请联系大学国际事务办公室办理续期。',expired:'最后提醒：您的{type}证件预计于今天（{date}）到期。请立即联系大学国际事务办公室。工作人员已收到通知。',overdue:'您的{type}证件已于{date}到期。请联系大学国际事务办公室核对记录和续期状态。'},
  };
  const selected=special[lang];
  const specialText=kind==='OVERDUE'?selected.overdue:kind==='REMINDER'&&days===0?selected.expired:kind==='REMINDER'&&days===14?selected.urgent:undefined;
  if(specialText)return specialText.replaceAll('{type}',type).replaceAll('{date}',date);
  if(kind==='CORRECTION')return corrections[lang];
  const locale=messages[lang];
  return (kind==='CONFIRMATION'?locale.confirmed:days<=7?locale.critical:locale.reminder).replaceAll('{type}',type).replaceAll('{date}',date).replaceAll('{days}',String(days));
}
export async function planDocument(tx:Tx,document:StudentDocument,now=new Date()) {
  const university=await tx.university.findUniqueOrThrow({where:{id:document.universityId}});
  const rules=await tx.notificationRule.findMany({where:{universityId:document.universityId,enabled:true}});
  const days=remaining(document.expirationDate,now,university.timezone);
  if(days<0){
    // Bounded, configurable overdue milestones are staff tasks, never unlimited student sends.
    for(const offset of university.overdueOffsets.filter(d=>d<=-days))await task(tx,document.universityId,document.studentId,`Overdue document: ${offset}-day review milestone`,`${document.id}-${document.activeVersion}-overdue-${offset}`);
    return;
  }
  const alreadyPlanned=await tx.notificationJob.count({where:{documentId:document.id,version:document.activeVersion,kind:'REMINDER'}});
  const slots=schedule(document.expirationDate,now,university.timezone,rules.map(r=>r.daysRemaining),university.deliveryStart,university.deliveryEnd,alreadyPlanned===0);
  for(const slot of slots) for(const channel of ['SMS','TELEGRAM','IN_APP'] as Channel[]) {
    const previous=await tx.notificationJob.findFirst({where:{documentId:document.id,version:document.activeVersion,kind:'REMINDER',channel,scheduledDate:slot.localDate,state:{notIn:['CANCELED','PENDING']}}});
    if(previous)continue;
    const key=[document.id,document.activeVersion,university.reminderRevision,'REMINDER',slot.localDate,channel].join('-');
    await tx.notificationJob.upsert({where:{idempotencyKey:key},update:{},create:{universityId:document.universityId,studentId:document.studentId,documentId:document.id,version:document.activeVersion,channel,scheduledDate:slot.localDate,scheduledAt:slot.at,idempotencyKey:key}});
  }
}
export async function confirmation(tx:Tx,document:StudentDocument) {
  for(const channel of ['SMS','TELEGRAM','IN_APP'] as Channel[]) {
    const key=[document.id,document.activeVersion,'CONFIRMATION',channel].join('-');
    await tx.notificationJob.upsert({where:{idempotencyKey:key},update:{},create:{universityId:document.universityId,studentId:document.studentId,documentId:document.id,version:document.activeVersion,kind:'CONFIRMATION',channel,scheduledDate:new Date().toISOString().slice(0,10),scheduledAt:new Date(),idempotencyKey:key}});
  }
}
export async function task(tx:Tx,universityId:string,studentId:string,reason:string,key:string) {
  await tx.staffTask.upsert({where:{deduplicationKey:key},update:{},create:{universityId,studentId,reason,deduplicationKey:key}});
}
export async function smsProviderFor(universityId:string):Promise<SmsProvider> {
  const settings=await db.smsProviderConfiguration.findUnique({where:{universityId}});
  if(!settings || settings.provider==='mock' || config.SMS_MODE==='mock')return new MockSmsProvider();
  if(!config.ALLOW_LIVE_NOTIFICATIONS)throw new Error('LIVE_DISABLED');
  if(settings.provider!=='devsms')throw new Error('PROVIDER_AUTH');
  const credentials=smsCredentials.parse(settings.credentialsEncrypted?JSON.parse(decrypt(settings.credentialsEncrypted)):{token:config.DEVSMS_TOKEN,webhookKey:config.DEVSMS_WEBHOOK_KEY,sender:config.DEVSMS_SENDER});
  return new DevSmsProvider(credentials,`${config.APP_ORIGIN}/api/sms/devsms/${universityId}`);
}
export async function deliver(id:string,sms?:SmsProvider,clock:()=>Date=()=>new Date()) {
  // Document row lock serializes approval with delivery. No old send can start after approval commits.
  return db.$transaction(async tx=>{
    const initial=await tx.notificationJob.findUniqueOrThrow({where:{id}});
    await tx.$queryRaw`SELECT id FROM "StudentDocument" WHERE id = ${initial.documentId} FOR UPDATE`;
    const job=await tx.notificationJob.findUniqueOrThrow({where:{id}});
    if(job.state!=='PENDING')return;
    const document=await tx.studentDocument.findFirstOrThrow({where:{id:job.documentId,universityId:job.universityId}});
    const student=await tx.student.findFirstOrThrow({where:{id:job.studentId,universityId:job.universityId},include:{telegram:true,university:true}});
    if(document.activeVersion!==job.version || document.archivedAt || student.archivedAt) { await tx.notificationJob.update({where:{id},data:{state:'CANCELED'}});return; }
    const now=clock(),local=DateTime.fromJSDate(now,{zone:student.university.timezone});
    if(job.scheduledAt>now)return;
    if(job.channel!=='IN_APP' && job.kind!=='CONFIRMATION' && (local.hour<student.university.deliveryStart || local.hour>=student.university.deliveryEnd)){
      const next=local.hour<student.university.deliveryStart?local.startOf('day').set({hour:student.university.deliveryStart}):local.plus({days:1}).startOf('day').set({hour:student.university.deliveryStart});
      await tx.notificationJob.update({where:{id},data:{scheduledAt:next.toUTC().toJSDate()}});return;
    }
    const days=remaining(document.expirationDate,now,student.university.timezone);
    if(job.kind==='REMINDER' && days<0) { await tx.notificationJob.update({where:{id},data:{state:'CANCELED'}}); await task(tx,job.universityId,job.studentId,'Overdue document requires officer review',`${document.id}-${job.version}-overdue`); return; }
    const rule=await tx.notificationRule.findUnique({where:{universityId_daysRemaining:{universityId:job.universityId,daysRemaining:days}}});
    if(job.kind==='REMINDER' && (rule?.escalate || days===0))await task(tx,job.universityId,job.studentId,'Document deadline requires officer contact',`${document.id}-${job.version}-${local.toISODate()}-escalation`);
    if(job.kind==='REMINDER'){
      const deliveredToday=await tx.notificationJob.findFirst({where:{documentId:job.documentId,version:job.version,kind:'REMINDER',channel:job.channel,deliveryDate:local.toISODate()!,id:{not:id}}});
      const newer=await tx.notificationJob.findFirst({where:{documentId:job.documentId,version:job.version,kind:'REMINDER',channel:job.channel,state:'PENDING',scheduledAt:{gt:job.scheduledAt,lte:now}}});
      if(deliveredToday||newer){await tx.notificationJob.update({where:{id},data:{state:'CANCELED',lastErrorCode:'SUPERSEDED_MILESTONE'}});return;}
    }
    const unavailable=(job.channel==='SMS' && (!student.phoneVerifiedAt || !student.phoneEncrypted || !student.smsEnabled)) || (job.channel==='TELEGRAM' && (!student.telegram || student.telegram.blocked || !student.telegramEnabled));
    if(unavailable) { await tx.notificationJob.update({where:{id},data:{state:'UNAVAILABLE'}}); await task(tx,job.universityId,job.studentId,`${job.channel} channel unavailable`,`${id}-unavailable`); return; }
    if(job.channel==='SMS') {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${job.universityId}))::text`;
      const settings=await tx.smsProviderConfiguration.findUnique({where:{universityId:job.universityId}});
      const used=await tx.notificationJob.count({where:{universityId:job.universityId,channel:'SMS',sendingAt:{gte:local.startOf('month').toJSDate()},state:{in:['SENDING','UNKNOWN','ACCEPTED','DELIVERED','MOCK']}}});
      if(!settings || used>=settings.monthlyQuota) {await tx.notificationJob.update({where:{id},data:{state:'FAILED'}});await task(tx,job.universityId,job.studentId,'SMS quota or provider configuration requires attention',`${id}-quota`);return;}
    }
    const template=await tx.notificationTemplate.findUnique({where:{universityId_language_kind:{universityId:job.universityId,language:student.language,kind:job.kind==='CORRECTION'?'correction':job.kind==='CONFIRMATION'?'confirmed':days===0?'expired':days===14?'urgent':days<=7?'critical':'reminder'}}});
    const text=render(student.language,job.kind,document.type,document.expirationDate.toISOString().slice(0,10),days,template?.body);
    // Commit a send reservation independently before crossing the provider boundary.
    // If the process/outer transaction dies after acceptance, SENDING is quarantined for reconciliation.
    let provider:SmsProvider|undefined;
    try{if(job.channel==='SMS')provider=sms??await smsProviderFor(job.universityId);}catch{await tx.notificationJob.update({where:{id},data:{state:'FAILED',lastErrorCode:'PROVIDER_CONFIGURATION'}});await task(tx,job.universityId,job.studentId,'Provider configuration requires attention',`${id}-configuration`);return;}
    const reserved=await db.notificationJob.updateMany({where:{id,state:'PENDING'},data:{state:'SENDING',sendingAt:now,provider:job.channel==='SMS'?provider?.name??'injected':job.channel==='TELEGRAM'?'telegram':'in_app',messageEncrypted:encrypt(text),...(job.kind==='REMINDER'?{deliveryDate:local.toISODate()!}:{})}});
    if(!reserved.count)return;
    try {
      const result:SendResult=job.channel==='IN_APP'?{state:'DELIVERED'}:job.channel==='SMS'?await provider!.send(decrypt(student.phoneEncrypted!),text,job.idempotencyKey):await telegramSend(student.telegram!.chatId,text);
      await tx.notificationAttempt.create({data:{jobId:id,state:result.state}});
      await tx.notificationJob.update({where:{id},data:{...result,lastErrorCode:null,...(result.state==='DELIVERED'?{deliveredAt:now}:{}),...(job.channel==='SMS'&&result.state==='ACCEPTED'?{nextReceiptAt:new Date(now.getTime()+60000)}:{})}});
    } catch(error) {
      const count=await tx.notificationAttempt.count({where:{jobId:id}});
      const failure=deliveryFailure(error,count);
      await tx.notificationAttempt.create({data:{jobId:id,state:failure.retry?'FAILED':failure.state,errorCode:failure.code}});
      await tx.notificationJob.update({where:{id},data:{state:failure.state,lastErrorCode:failure.code,...(failure.retry?{retryCount:{increment:1},scheduledAt:new Date(now.getTime()+failure.delay)}:{})}});
      if(failure.code==='CHANNEL_BLOCKED')await tx.telegramConnection.updateMany({where:{studentId:job.studentId,universityId:job.universityId},data:{blocked:true}});
      if(!failure.retry)await task(tx,job.universityId,job.studentId,'Notification requires delivery reconciliation',`${id}-delivery`);
    }
  },{timeout:20000,maxWait:10000});
}
