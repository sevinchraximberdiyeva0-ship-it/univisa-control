import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {post,type User} from './api';
import {useLanguage} from './i18n';

const text={
  uz:{title:'Emailni tasdiqlash',verified:'Email tasdiqlangan.',send:'Kod yuborish',confirm:'Emailni tasdiqlash',code:'8 xonali kod',sent:'Kod yuborildi. Emailingizni tekshiring.',unavailable:'Hozir kod yuborib bo‘lmaydi. Universitetga murojaat qiling.',sendError:'Kod yuborilmadi. Birozdan keyin qayta urinib ko‘ring.',codeError:'Kod noto‘g‘ri yoki muddati tugagan.'},
  tk:{title:'E-poçtany tassyklamak',verified:'E-poçta tassyklandy.',send:'Kod ibermek',confirm:'E-poçtany tassyklamak',code:'8 belgili kod',sent:'Kod iberildi. E-poçtaňyzy barlaň.',unavailable:'Häzir kod iberip bolmaýar. Uniwersitet bilen habarlaşyň.',sendError:'Kod iberilmedi. Biraz wagtdan gaýtadan synanyşyň.',codeError:'Kod nädogry ýa-da möhleti gutardy.'},
  en:{title:'Verify email',verified:'Email verified.',send:'Send code',confirm:'Verify email',code:'8-digit code',sent:'Code sent. Check your email.',unavailable:'Codes cannot be sent right now. Contact your university.',sendError:'The code was not sent. Try again later.',codeError:'The code is invalid or expired.'},
  ru:{title:'Подтверждение почты',verified:'Почта подтверждена.',send:'Отправить код',confirm:'Подтвердить почту',code:'8-значный код',sent:'Код отправлен. Проверьте почту.',unavailable:'Сейчас отправить код невозможно. Обратитесь в университет.',sendError:'Не удалось отправить код. Попробуйте позже.',codeError:'Код недействителен или просрочен.'},
  ko:{title:'이메일 인증',verified:'이메일이 인증되었습니다.',send:'코드 보내기',confirm:'이메일 인증',code:'8자리 코드',sent:'코드를 보냈습니다. 이메일을 확인하세요.',unavailable:'지금은 코드를 보낼 수 없습니다. 대학에 문의하세요.',sendError:'코드를 보내지 못했습니다. 나중에 다시 시도하세요.',codeError:'코드가 잘못되었거나 만료되었습니다.'},
  zh:{title:'验证邮箱',verified:'邮箱已验证。',send:'发送验证码',confirm:'验证邮箱',code:'8 位验证码',sent:'验证码已发送，请查看邮箱。',unavailable:'暂时无法发送验证码，请联系大学。',sendError:'验证码未发送，请稍后重试。',codeError:'验证码无效或已过期。'},
};

export function EmailVerification({user}:{user:User}){
  const t=text[useLanguage()],cache=useQueryClient();
  const [sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  if(user.role!=='STUDENT'||(!user.emailVerificationAvailable&&!user.emailVerificationRequired&&!user.emailVerifiedAt))return null;
  return <section className="panel settings-panel">
    <h2>{t.title}</h2><p>{user.email}</p>
    {user.emailVerifiedAt?<p>{t.verified}</p>:<>
      {user.emailVerificationAvailable?<button className="button" type="button" disabled={busy} onClick={async()=>{
        setBusy(true);setError('');setSent(false);
        try{await post('/auth/email-verification/send',{});setSent(true);}
        catch{setError(t.sendError);}finally{setBusy(false);}
      }}>{t.send}</button>:<p>{t.unavailable}</p>}
      {sent&&<p role="status">{t.sent}</p>}
      <form onSubmit={async e=>{
        e.preventDefault();const code=new FormData(e.currentTarget).get('code');
        setBusy(true);setError('');
        try{await post('/auth/email-verification/confirm',{code});await cache.invalidateQueries({queryKey:['auth']});}
        catch{setError(t.codeError);}finally{setBusy(false);}
      }}>
        <label>{t.code}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} required/></label>
        <button className="primary" disabled={busy}>{t.confirm}</button>
      </form>
      {error&&<div className="error" role="alert">{error}</div>}
    </>}
  </section>;
}
