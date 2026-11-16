import { Router } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { config } from './config.js';
import { decrypt,encrypt,equal,hash } from './security.js';
import { remaining } from './domain.js';
import { deliveryFailure,telegramSend } from './providers.js';

export const telegramRouter=Router();
const updateSchema=z.object({update_id:z.number().int().safe().nonnegative(),message:z.object({text:z.string().max(500).optional(),chat:z.object({id:z.number().int().safe(),type:z.string()}),from:z.object({id:z.number().int().safe(),is_bot:z.boolean(),language_code:z.string().optional()}).optional()}).optional(),callback_query:z.object({id:z.string(),from:z.object({id:z.number().int().safe()}),data:z.string().max(100).optional(),message:z.object({chat:z.object({id:z.number().int().safe(),type:z.string()})}).optional()}).optional()});
const copy={
  en:{link:'Sign in to your university portal and generate a one-time Telegram linking token.',invalid:'Invalid or expired linking token.',taken:'This Telegram account is already linked to another student.',linked:'Your university account is linked. Use /status to view document dates.',empty:'No active documents recorded. Contact your international office.',renew:'Submit your renewal securely in the portal:',help:'University international office:',choose:'Choose /language_en, /language_uz or /language_ru',changed:'Notification language updated.',settings:'Notification preferences are managed in your authenticated university portal:',days:'days',status:'View document status',submit:'Submit renewal',contact:'Contact university',language:'Change language'},
  uz:{link:'Universitet portaliga kiring va bir martalik Telegram ulash tokenini yarating.',invalid:'Token noto‘g‘ri yoki muddati tugagan.',taken:'Bu Telegram hisobi boshqa talabaga ulangan.',linked:'Universitet hisobingiz ulandi. Hujjat sanalarini ko‘rish uchun /status buyrug‘ini yuboring.',empty:'Amaldagi hujjat qayd etilmagan. Xalqaro bo‘limga murojaat qiling.',renew:'Yangilash arizasini portal orqali xavfsiz yuboring:',help:'Universitet xalqaro bo‘limi:',choose:'/language_en, /language_uz yoki /language_ru ni tanlang',changed:'Bildirishnoma tili yangilandi.',settings:'Bildirishnoma sozlamalari universitet portalida boshqariladi:',days:'kun',status:'Hujjat holati',submit:'Yangilash arizasi',contact:'Universitet bilan aloqa',language:'Tilni o‘zgartirish'},
  ru:{link:'Войдите в университетский портал и создайте одноразовый токен привязки Telegram.',invalid:'Недействительный или просроченный токен.',taken:'Этот аккаунт Telegram уже связан с другим студентом.',linked:'Ваш университетский аккаунт привязан. Используйте /status для просмотра сроков.',empty:'Нет действующих документов. Обратитесь в международный отдел.',renew:'Подайте заявку на продление через защищённый портал:',help:'Международный отдел университета:',choose:'Выберите /language_en, /language_uz или /language_ru',changed:'Язык уведомлений обновлён.',settings:'Настройки уведомлений доступны в университетском портале:',days:'дней',status:'Статус документов',submit:'Подать продление',contact:'Связь с университетом',language:'Сменить язык'}
};
type Language=keyof typeof copy;
const language=(value:string|undefined):Language=>value?.startsWith('uz')?'uz':value?.startsWith('ru')?'ru':'en';

telegramRouter.post('/',async(req,res)=>{
  if(config.TELEGRAM_MODE!=='live'||!config.TELEGRAM_WEBHOOK_SECRET||!equal(String(req.headers['x-telegram-bot-api-secret-token']??''),config.TELEGRAM_WEBHOOK_SECRET))return res.sendStatus(401);
  const parsed=updateSchema.safeParse(req.body);if(!parsed.success)return res.sendStatus(400);
  const update=parsed.data,message=update.message,callback=update.callback_query;
  const chat=message?.chat??callback?.message?.chat,sender=message?.from?.id??callback?.from.id;
  if(!chat||chat.type!=='private'||sender!==chat.id||message?.from?.is_bot)return res.sendStatus(200);
  const chatId=String(chat.id),text=message?.text??callback?.data??'';
  await db.$transaction(async tx=>{
    const inserted=await tx.telegramUpdate.createMany({data:[{id:BigInt(update.update_id)}],skipDuplicates:true});if(!inserted.count)return;
    let lang=language(message?.from?.language_code),reply=copy[lang].link;
    if(text.startsWith('/start ')){
      const raw=text.slice(7).trim();reply=copy[lang].invalid;
      if(/^[a-f0-9]{64}$/.test(raw)){
        const link=await tx.telegramLinkToken.findUnique({where:{hash:hash(raw)}});
        if(link){
          await tx.$queryRaw`SELECT id FROM "Student" WHERE id=${link.studentId} FOR UPDATE`;
          const student=await tx.student.findFirst({where:{id:link.studentId,universityId:link.universityId,archivedAt:null,user:{active:true}}});
          const connection=await tx.telegramConnection.findUnique({where:{chatId}});
          if(student){
            lang=language(student.language);
            if(connection&&connection.studentId!==student.id)reply=copy[lang].taken;
            else {
              const used=await tx.telegramLinkToken.updateMany({where:{hash:link.hash,usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
              if(used.count){
                await tx.telegramConnection.upsert({where:{studentId:student.id},update:{chatId,blocked:false},create:{universityId:student.universityId,studentId:student.id,chatId}});
                await tx.auditLog.create({data:{universityId:student.universityId,actorId:student.userId!,action:'TELEGRAM_LINKED',entityId:student.id}});reply=copy[lang].linked;
              }else reply=copy[lang].invalid;
            }
          }
        }
      }
    }else {
      const connection=await tx.telegramConnection.findUnique({where:{chatId},include:{student:{include:{user:true,university:true,documents:{where:{archivedAt:null}}}}}});
      if(connection&&!connection.student.archivedAt&&connection.student.user?.active){
        const student=connection.student;lang=language(student.language);const t=copy[lang];
        if(connection.blocked)await tx.telegramConnection.update({where:{id:connection.id},data:{blocked:false}});
        if(['/status','/visa','/documents'].includes(text))reply=student.documents.filter(d=>text!=='/visa'||/visa/i.test(d.type)).map(d=>`${d.type}: ${d.expirationDate.toISOString().slice(0,10)} (${remaining(d.expirationDate,new Date(),student.university.timezone)} ${t.days})`).join('\n')||t.empty;
        else if(text==='/renew')reply=`${t.renew} ${config.APP_ORIGIN}/renewals`;
        else if(text==='/help')reply=`${t.help} ${student.university.contactEmail}`;
        else if(text==='/language')reply=t.choose;
        else if(/^\/language_(en|uz|ru)$/.test(text)){lang=text.slice(-2) as Language;await tx.student.update({where:{id:student.id},data:{language:lang}});reply=copy[lang].changed;}
        else if(text==='/settings'){
          const switches={en:['enabled','disabled'],uz:['yoqilgan','o‘chirilgan'],ru:['включено','отключено']}[lang];
          reply=`SMS: ${switches[student.smsEnabled?0:1]}. Telegram: ${switches[student.telegramEnabled?0:1]}.\n${t.settings} ${config.APP_ORIGIN}`;
        }
        else reply='/status · /visa · /documents · /renew · /help · /language · /settings';
      }
    }
    const t=copy[lang],markup={inline_keyboard:[[{text:t.status,callback_data:'/status'},{text:t.submit,url:`${config.APP_ORIGIN}/renewals`}],[{text:t.contact,callback_data:'/help'},{text:t.language,callback_data:'/language'}]]};
    await tx.telegramResponse.create({data:{updateId:BigInt(update.update_id),payloadEncrypted:encrypt(JSON.stringify({chatId,text:reply,markup,callbackId:callback?.id}))}});
  });
  return res.sendStatus(200);
});

export async function deliverTelegramResponse(id:string){
  const row=await db.telegramResponse.findUniqueOrThrow({where:{id}});
  const claimed=await db.telegramResponse.updateMany({where:{id,state:'PENDING',scheduledAt:{lte:new Date()}},data:{state:'SENDING',sendingAt:new Date(),attempts:{increment:1}}});if(!claimed.count)return;
  const payload=JSON.parse(decrypt(row.payloadEncrypted)) as {chatId:string;text:string;markup:unknown;callbackId?:string};
  try{
    const result=await telegramSend(payload.chatId,payload.text,payload.markup);
    await db.telegramResponse.update({where:{id},data:{state:result.state,lastErrorCode:null}});
    if(payload.callbackId&&config.TELEGRAM_MODE==='live'&&config.ALLOW_LIVE_NOTIFICATIONS)await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:payload.callbackId}),signal:AbortSignal.timeout(5000)}).catch(()=>undefined);
  }catch(error){
    const failure=deliveryFailure(error,row.attempts);
    await db.telegramResponse.update({where:{id},data:{state:failure.state,lastErrorCode:failure.code,...(failure.retry?{scheduledAt:new Date(Date.now()+failure.delay)}:{})}});
    if(failure.code==='CHANNEL_BLOCKED')await db.telegramConnection.updateMany({where:{chatId:payload.chatId},data:{blocked:true}});
  }
}
