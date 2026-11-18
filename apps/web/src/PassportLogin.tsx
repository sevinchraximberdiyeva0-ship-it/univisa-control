import {useState} from 'react';
import {post} from './api';
import {accountText,admissionText,useLanguage} from './i18n';

const copy={
  uz:{title:'Pasport / ID orqali kirish',request:'Kirish kodini yuborish',notice:'Mos akkaunt topilsa, kod tasdiqlangan emailga yuboriladi.',code:'8 xonali kirish kodi',retry:'Kodni qayta yuborish',change:'Hujjat ma’lumotlarini o‘zgartirish',extra:'Hujjat turi va bergan davlat (ixtiyoriy)',unavailable:'Hozir kod so‘rab bo‘lmaydi. Qayta urinib ko‘ring.',invalid:'Kirish kodi noto‘g‘ri yoki muddati tugagan.'},
  tk:{title:'Pasport ýa-da şahsyýetnama bilen girmek',request:'Giriş koduny ibermek',notice:'Gabat gelýän hasap tapylsa, kod tassyklanan e-poçta iberiler.',code:'8 belgili giriş kody',retry:'Kody gaýtadan ibermek',change:'Resminama maglumatlaryny üýtgetmek',extra:'Resminamanyň görnüşi we beren ýurt (islege görä)',unavailable:'Häzir kod sorap bolmaýar. Gaýtadan synanyşyň.',invalid:'Giriş kody nädogry ýa-da möhleti gutardy.'},
  en:{title:'Sign in with passport or ID',request:'Send sign-in code',notice:'If a matching account is found, a code will be sent to its verified email.',code:'8-digit sign-in code',retry:'Resend code',change:'Change document details',extra:'Document type and issuing country (optional)',unavailable:'A code cannot be requested right now. Try again later.',invalid:'The sign-in code is invalid or expired.'},
  ru:{title:'Войти по паспорту или удостоверению личности',request:'Отправить код входа',notice:'Если аккаунт найден, код будет отправлен на подтверждённую почту.',code:'8-значный код входа',retry:'Отправить код повторно',change:'Изменить данные документа',extra:'Тип документа и страна выдачи (необязательно)',unavailable:'Сейчас запросить код невозможно. Попробуйте позже.',invalid:'Код входа недействителен или просрочен.'},
  ko:{title:'여권 또는 신분증으로 로그인',request:'로그인 코드 보내기',notice:'일치하는 계정이 있으면 인증된 이메일로 코드를 보냅니다.',code:'8자리 로그인 코드',retry:'코드 다시 보내기',change:'서류 정보 변경',extra:'서류 유형 및 발급 국가 (선택 사항)',unavailable:'지금은 코드를 요청할 수 없습니다. 나중에 다시 시도하세요.',invalid:'로그인 코드가 잘못되었거나 만료되었습니다.'},
  zh:{title:'使用护照或身份证登录',request:'发送登录验证码',notice:'如果找到匹配的账号，验证码将发送到已验证的邮箱。',code:'8 位登录验证码',retry:'重新发送验证码',change:'更改证件信息',extra:'证件类型及签发国家（可选）',unavailable:'目前无法请求验证码，请稍后重试。',invalid:'登录验证码无效或已过期。'},
};

type Identifier={university:string;number:string;document?:{type:string;country:string}};

export function PassportLogin({done}:{done:()=>void}){
  const language=useLanguage(),t=copy[language],labels=admissionText[language],account=accountText[language];
  const [identifier,setIdentifier]=useState<Identifier>();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');

  async function send(input:Identifier){
    setBusy(true);setError('');
    try{await post('/auth/passport-login/start',input);setIdentifier(input);}
    catch{setError(t.unavailable);}finally{setBusy(false);}
  }

  return <details className="passport-login">
    <summary>{t.title}</summary>
    {identifier?<>
      <p className="fine" role="status">{t.notice}</p>
      <form onSubmit={async e=>{
        e.preventDefault();const code=new FormData(e.currentTarget).get('code');
        setBusy(true);setError('');
        try{await post('/auth/passport-login/confirm',{...identifier,code});done();}
        catch{setError(t.invalid);}finally{setBusy(false);}
      }}>
        <label>{t.code}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} required/></label>
        <button className="primary" disabled={busy}>{account.signIn}</button>
      </form>
      <div className="passport-login-actions">
        <button className="button" type="button" disabled={busy} onClick={()=>void send(identifier)}>{t.retry}</button>
        <button className="button" type="button" disabled={busy} onClick={()=>{setIdentifier(undefined);setError('');}}>{t.change}</button>
      </div>
    </>:<form onSubmit={e=>{
      e.preventDefault();const form=new FormData(e.currentTarget);
      const country=String(form.get('country')).trim();
      void send({university:String(form.get('university')),number:String(form.get('number')),
        ...(country?{document:{type:String(form.get('type')),country}}:{})});
    }}>
      <label>{account.code}<input name="university" autoComplete="organization" maxLength={50} required/></label>
      <label>{labels.number}<input name="number" autoComplete="off" minLength={4} maxLength={30} required/></label>
      <details><summary>{t.extra}</summary>
        <label>{labels.type}<select name="type"><option value="PASSPORT">{labels.passport}</option><option value="ID_CARD">{labels.idCard}</option></select></label>
        <label>{labels.country}<input name="country" pattern="[A-Za-z]{2}" maxLength={2} autoComplete="off"/></label>
      </details>
      <button className="primary" disabled={busy}>{t.request}</button>
    </form>}
    {error&&<div className="error" role="alert">{error}</div>}
  </details>;
}
