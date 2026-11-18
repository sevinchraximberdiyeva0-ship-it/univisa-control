import { Router } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { config } from './config.js';
import { decrypt,encrypt,equal,hash } from './security.js';
import { remaining } from './domain.js';
import { deliveryFailure,telegramSend } from './providers.js';
import { languageSchema,resolveLanguage,type Language } from './languages.js';

export const telegramRouter=Router();
const updateSchema=z.object({update_id:z.number().int().safe().nonnegative(),message:z.object({text:z.string().max(500).optional(),chat:z.object({id:z.number().int().safe(),type:z.string()}),from:z.object({id:z.number().int().safe(),is_bot:z.boolean(),language_code:z.string().optional()}).optional()}).optional(),callback_query:z.object({id:z.string(),from:z.object({id:z.number().int().safe()}),data:z.string().max(100).optional(),message:z.object({chat:z.object({id:z.number().int().safe(),type:z.string()})}).optional()}).optional()});
const copy={
  en:{link:'Sign in to your university portal and generate a one-time Telegram linking token.',invalid:'Invalid or expired linking token.',taken:'This Telegram account is already linked to another student.',linked:'Your university account is linked. Use /status to view document dates.',empty:'No active documents recorded. Contact your international office.',renew:'Submit your renewal securely in the portal:',help:'University international office:',choose:'Choose a language',changed:'Notification language updated.',settings:'Notification preferences are managed in your authenticated university portal:',days:'days',status:'View document status',submit:'Submit renewal',contact:'Contact university',language:'Change language'},
  uz:{link:'Universitet portaliga kiring va bir martalik Telegram ulash tokenini yarating.',invalid:'Token noto‘g‘ri yoki muddati tugagan.',taken:'Bu Telegram hisobi boshqa talabaga ulangan.',linked:'Universitet hisobingiz ulandi. Hujjat sanalarini ko‘rish uchun /status buyrug‘ini yuboring.',empty:'Amaldagi hujjat qayd etilmagan. Xalqaro bo‘limga murojaat qiling.',renew:'Yangilash arizasini portal orqali xavfsiz yuboring:',help:'Universitet xalqaro bo‘limi:',choose:'Tilni tanlang',changed:'Bildirishnoma tili yangilandi.',settings:'Bildirishnoma sozlamalari universitet portalida boshqariladi:',days:'kun',status:'Hujjat holati',submit:'Yangilash arizasi',contact:'Universitet bilan aloqa',language:'Tilni o‘zgartirish'},
  ru:{link:'Войдите в университетский портал и создайте одноразовый токен привязки Telegram.',invalid:'Недействительный или просроченный токен.',taken:'Этот аккаунт Telegram уже связан с другим студентом.',linked:'Ваш университетский аккаунт привязан. Используйте /status для просмотра сроков.',empty:'Нет действующих документов. Обратитесь в международный отдел.',renew:'Подайте заявку на продление через защищённый портал:',help:'Международный отдел университета:',choose:'Выберите язык',changed:'Язык уведомлений обновлён.',settings:'Настройки уведомлений доступны в университетском портале:',days:'дней',status:'Статус документов',submit:'Подать продление',contact:'Связь с университетом',language:'Сменить язык'},
  tk:{link:'Uniwersitetiň portalyna giriň we Telegram üçin bir gezeklik baglanyşyk belgisini dörediň.',invalid:'Baglanyşyk belgisi nädogry ýa-da möhleti gutardy.',taken:'Bu Telegram hasaby başga talyba baglanan.',linked:'Uniwersitet hasabyňyz baglandy. Resminamalaryň senelerini görmek üçin /status buýrugyny ulanyň.',empty:'Hereket edýän resminama ýok. Halkara bölüme ýüz tutuň.',renew:'Möhleti uzaltmak üçin arzaňyzy portal arkaly iberiň:',help:'Uniwersitetiň halkara bölümi:',choose:'Dili saýlaň',changed:'Bildirişleriň dili täzelendi.',settings:'Bildiriş sazlamalary uniwersitetiň portalynda dolandyrylýar:',days:'gün',status:'Resminamalaryň ýagdaýy',submit:'Arza ibermek',contact:'Uniwersitet bilen habarlaşmak',language:'Dili üýtgetmek'},
  ko:{link:'대학 포털에 로그인하여 텔레그램 연결용 일회용 코드를 발급받으세요.',invalid:'연결 코드가 잘못되었거나 만료되었습니다.',taken:'이 텔레그램 계정은 이미 다른 학생과 연결되어 있습니다.',linked:'대학 계정이 연결되었습니다. 서류 기한을 확인하려면 /status를 입력하세요.',empty:'유효한 서류가 등록되어 있지 않습니다. 대학 국제처에 문의하세요.',renew:'대학 포털에서 갱신 신청을 안전하게 제출하세요:',help:'대학 국제처:',choose:'언어를 선택하세요',changed:'알림 언어가 변경되었습니다.',settings:'알림 설정은 대학 포털에서 관리할 수 있습니다:',days:'일',status:'서류 상태 보기',submit:'갱신 신청',contact:'대학에 문의',language:'언어 변경'},
  zh:{link:'请登录大学门户，生成用于绑定 Telegram 的一次性代码。',invalid:'绑定代码无效或已过期。',taken:'此 Telegram 账号已绑定到其他学生。',linked:'您的大学账号已绑定。请使用 /status 查看证件日期。',empty:'没有有效证件记录。请联系大学国际事务办公室。',renew:'请通过大学门户安全提交续期申请：',help:'大学国际事务办公室：',choose:'请选择语言',changed:'通知语言已更新。',settings:'请在大学门户管理通知设置：',days:'天',status:'查看证件状态',submit:'提交续期申请',contact:'联系大学',language:'更改语言'},
};
const languageCommands=languageSchema.options.map(code=>`/language_${code}`).join('\n');
const switches:Record<Language,[string,string]>={en:['enabled','disabled'],uz:['yoqilgan','o‘chirilgan'],ru:['включено','отключено'],tk:['işjeň','öçürilen'],ko:['켜짐','꺼짐'],zh:['已启用','已停用']};

telegramRouter.post('/',async(req,res)=>{
  if(config.TELEGRAM_MODE!=='live'||!config.TELEGRAM_WEBHOOK_SECRET||!equal(String(req.headers['x-telegram-bot-api-secret-token']??''),config.TELEGRAM_WEBHOOK_SECRET))return res.sendStatus(401);
  const parsed=updateSchema.safeParse(req.body);if(!parsed.success)return res.sendStatus(400);
  const update=parsed.data,message=update.message,callback=update.callback_query;
  const chat=message?.chat??callback?.message?.chat,sender=message?.from?.id??callback?.from.id;
  if(!chat||chat.type!=='private'||sender!==chat.id||message?.from?.is_bot)return res.sendStatus(200);
  const chatId=String(chat.id),text=message?.text??callback?.data??'';
  await db.$transaction(async tx=>{
    const inserted=await tx.telegramUpdate.createMany({data:[{id:BigInt(update.update_id)}],skipDuplicates:true});if(!inserted.count)return;
    let lang=resolveLanguage(message?.from?.language_code),reply=copy[lang].link;
    if(text.startsWith('/start ')){
      const raw=text.slice(7).trim();reply=copy[lang].invalid;
      if(/^[a-f0-9]{64}$/.test(raw)){
        const link=await tx.telegramLinkToken.findUnique({where:{hash:hash(raw)}});
        if(link){
          await tx.$queryRaw`SELECT id FROM "Student" WHERE id=${link.studentId} FOR UPDATE`;
          const student=await tx.student.findFirst({where:{id:link.studentId,universityId:link.universityId,archivedAt:null,user:{active:true}}});
          const connection=await tx.telegramConnection.findUnique({where:{chatId}});
          if(student){
            lang=resolveLanguage(student.language);
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
        const student=connection.student;lang=resolveLanguage(student.language);const t=copy[lang];
        const requestedLanguage=languageSchema.safeParse(text.startsWith('/language_')?text.slice('/language_'.length):undefined);
        if(connection.blocked)await tx.telegramConnection.update({where:{id:connection.id},data:{blocked:false}});
        if(['/status','/visa','/documents'].includes(text))reply=student.documents.filter(d=>text!=='/visa'||/visa/i.test(d.type)).map(d=>`${d.type}: ${d.expirationDate.toISOString().slice(0,10)} (${remaining(d.expirationDate,new Date(),student.university.timezone)} ${t.days})`).join('\n')||t.empty;
        else if(text==='/renew')reply=`${t.renew} ${config.APP_ORIGIN}/renewals`;
        else if(text==='/help')reply=`${t.help} ${student.university.contactEmail}`;
        else if(text==='/language')reply=`${t.choose}\n${languageCommands}`;
        else if(requestedLanguage.success){lang=requestedLanguage.data;await tx.student.update({where:{id:student.id},data:{language:lang}});reply=copy[lang].changed;}
        else if(text==='/settings'){
          const states=switches[lang];
          reply=`SMS: ${states[student.smsEnabled?0:1]}. Telegram: ${states[student.telegramEnabled?0:1]}.\n${t.settings} ${config.APP_ORIGIN}`;
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
