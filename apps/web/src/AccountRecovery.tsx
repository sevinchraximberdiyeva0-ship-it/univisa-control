import {useEffect,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {post} from './api';
import {admissionText,useLanguage} from './i18n';

export const recoveryText={
  uz:{entry:'Qurilmam yo‘qolgan',title:'Akkauntni tiklash',intro:'Xalqaro bo‘limga asl hujjatingiz bilan boring. Xodim bergan tiklash havolasini oching yoki kodini kiriting.',code:'Tiklash kodi',confirmPassword:'Parolni takrorlang',submit:'Akkauntni tiklash',back:'Kirishga qaytish',mismatch:'Parollar bir xil bo‘lishi kerak.',invalid:'Tiklash havolasi yaroqsiz yoki muddati tugagan.',passwordLength:'Kamida 14 belgi kiriting. Juda uzun yoki ko‘p baytli parolni qisqartiring.',next:'Tiklashdan keyin eski sessiyalar va qurilma kalitlari bekor bo‘ladi. Yangi kalitni profildan qo‘shing.',issue:'Tiklash havolasini yaratish',checked:'Talabaning shaxsini asl hujjat bilan shaxsan tekshirdim.',link:'Bir martalik tiklash havolasi',deliver:'Havolani tekshirilgan talabaning o‘ziga bering.',expires:'Havola amal qilish muddati',copy:'Havolani nusxalash',copied:'Havola nusxalandi.',issueError:'Tiklash havolasini yaratib bo‘lmadi.'},
  tk:{entry:'Enjamymy ýitirdim',title:'Hasaby dikeltmek',intro:'Asyl resminamaňyz bilen halkara bölüme ýüz tutuň. Işgäriň beren salgysyny açyň ýa-da kody giriziň.',code:'Dikeldiş kody',confirmPassword:'Açar sözi gaýtalaň',submit:'Hasaby dikeltmek',back:'Girişe dolanmak',mismatch:'Açar sözler gabat gelmeli.',invalid:'Dikeldiş salgysy nädogry ýa-da möhleti gutardy.',passwordLength:'Iň azyndan 14 belgi giriziň. Örän uzyn açar sözi gysgaldyň.',next:'Öňki girişler we enjam açarlary ýatyrylar. Täze açary profilde goşuň.',issue:'Dikeldiş salgysyny döretmek',checked:'Talybyň şahsyýetini asyl resminama bilen barladym.',link:'Bir gezeklik dikeldiş salgysy',deliver:'Salgyny diňe barlanan talyba beriň.',expires:'Salgynyň möhleti',copy:'Salgyny göçürmek',copied:'Salgy göçürildi.',issueError:'Dikeldiş salgysyny döredip bolmady.'},
  en:{entry:'I lost my device',title:'Recover account',intro:'Visit the international office with your original ID. Open the recovery link from the officer or enter its code.',code:'Recovery code',confirmPassword:'Repeat password',submit:'Recover account',back:'Back to sign in',mismatch:'The passwords must match.',invalid:'The recovery link is invalid or expired.',passwordLength:'Enter at least 14 characters. Shorten passwords that exceed 72 UTF-8 bytes.',next:'Recovery signs out old sessions and revokes existing device keys. Add a new key from your profile.',issue:'Create recovery link',checked:'I checked the student’s identity in person against the original document.',link:'Single-use recovery link',deliver:'Give this link directly to the verified student.',expires:'Link expires',copy:'Copy recovery link',copied:'Link copied.',issueError:'The recovery link could not be created.'},
  ru:{entry:'Устройство потеряно',title:'Восстановление аккаунта',intro:'Посетите международный отдел с оригиналом документа. Откройте ссылку сотрудника или введите код.',code:'Код восстановления',confirmPassword:'Повторите пароль',submit:'Восстановить аккаунт',back:'Вернуться ко входу',mismatch:'Пароли должны совпадать.',invalid:'Ссылка недействительна или просрочена.',passwordLength:'Введите хотя бы 14 символов. Сократите пароль, если он длиннее 72 байт UTF-8.',next:'Старые сеансы и ключи доступа будут отменены. Добавьте новый ключ в профиле.',issue:'Создать ссылку восстановления',checked:'Я лично сверил личность студента с оригиналом документа.',link:'Одноразовая ссылка восстановления',deliver:'Передайте ссылку лично проверенному студенту.',expires:'Ссылка действует до',copy:'Скопировать ссылку',copied:'Ссылка скопирована.',issueError:'Не удалось создать ссылку восстановления.'},
  ko:{entry:'기기를 분실했습니다',title:'계정 복구',intro:'신분증 원본을 가지고 국제처에 방문하세요. 담당자가 준 복구 링크를 열거나 코드를 입력하세요.',code:'복구 코드',confirmPassword:'비밀번호 다시 입력',submit:'계정 복구',back:'로그인으로 돌아가기',mismatch:'비밀번호가 일치해야 합니다.',invalid:'복구 링크가 잘못되었거나 만료되었습니다.',passwordLength:'14자 이상 입력하세요. UTF-8 72바이트를 넘으면 줄여 주세요.',next:'기존 세션과 기기 키가 취소됩니다. 프로필에서 새 키를 추가하세요.',issue:'복구 링크 만들기',checked:'학생을 직접 만나 신분증 원본으로 신원을 확인했습니다.',link:'일회용 복구 링크',deliver:'확인된 학생 본인에게 링크를 전달하세요.',expires:'링크 만료',copy:'복구 링크 복사',copied:'링크가 복사되었습니다.',issueError:'복구 링크를 만들지 못했습니다.'},
  zh:{entry:'我的设备丢失了',title:'恢复账号',intro:'请携带身份证件原件前往国际事务办公室。打开工作人员提供的恢复链接或输入其验证码。',code:'恢复代码',confirmPassword:'再次输入密码',submit:'恢复账号',back:'返回登录',mismatch:'两次密码必须一致。',invalid:'恢复链接无效或已过期。',passwordLength:'至少输入 14 个字符。若超过 72 个 UTF-8 字节，请缩短密码。',next:'恢复后旧会话和设备密钥将被撤销。请在个人资料中添加新密钥。',issue:'创建恢复链接',checked:'我已当面核对学生身份及证件原件。',link:'一次性恢复链接',deliver:'请将链接直接交给已核验的学生本人。',expires:'链接有效期至',copy:'复制恢复链接',copied:'链接已复制。',issueError:'无法创建恢复链接。'},
};

const differentPassword={uz:'Avvalgi paroldan farqli parol tanlang.',tk:'Öňküsinden tapawutly açar söz saýlaň.',en:'Choose a password different from your previous one.',ru:'Выберите пароль, отличный от прежнего.',ko:'이전과 다른 비밀번호를 선택하세요.',zh:'请选择与原密码不同的密码。'};

export function StudentRecovery({onComplete}:{onComplete:()=>void}){
  const language=useLanguage(),t=recoveryText[language],admission=admissionText[language];
  const [params,setParams]=useSearchParams();
  const [code,setCode]=useState(params.get('code')??'');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    const incoming=params.get('code');
    if(incoming!==null){setCode(incoming);setParams({}, {replace:true});}
  },[params,setParams]);
  return <div className="login student-app-login"><main className="login-form"><div className="login-inner">
    <h1>{t.title}</h1><p>{t.intro}</p><p className="fine">{t.next}</p>
    <form onSubmit={async e=>{
      e.preventDefault();setError('');
      const form=new FormData(e.currentTarget),password=String(form.get('password'));
      if(password!==form.get('confirmPassword')){setError(t.mismatch);return;}
      if(password.length<14||new TextEncoder().encode(password).length>72){setError(t.passwordLength);return;}
      setBusy(true);
      try{await post('/auth/account-recovery/complete',{code,password});setCode('');onComplete();}
      catch(e){setError(e instanceof Error&&e.message==='Choose a password different from the current password'?differentPassword[language]:t.invalid);}
      finally{setBusy(false);}
    }}>
      <label>{t.code}<input name="code" type="password" autoComplete="off" value={code} onChange={e=>setCode(e.target.value)} required/></label>
      <label>{admission.newPassword}<input name="password" type="password" autoComplete="new-password" minLength={14} maxLength={72} required/></label>
      <label>{t.confirmPassword}<input name="confirmPassword" type="password" autoComplete="new-password" minLength={14} maxLength={72} required/></label>
      <button className="primary" disabled={busy}>{t.submit}</button>
    </form>
    {error&&<div className="error" role="alert">{error}</div>}
    <Link className="button recovery-back" to="/">{t.back}</Link>
  </div></main></div>;
}

export function IssueRecovery({identityId}:{identityId:string}){
  const language=useLanguage(),t=recoveryText[language];
  const [result,setResult]=useState<{link:string;expiresAt:string}>();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  return <section className="issue-recovery">
    <h3>{t.issue}</h3>
    <form onSubmit={async e=>{
      e.preventDefault();const form=new FormData(e.currentTarget);
      setBusy(true);setError('');setCopied(false);setResult(undefined);
      try{setResult(await post(`/identity/applications/${identityId}/recovery`,{originalChecked:form.get('originalChecked')==='yes'}));}
      catch{setError(t.issueError);}finally{setBusy(false);}
    }}>
      <label className="checkbox-label"><input type="checkbox" name="originalChecked" value="yes" required/>{t.checked}</label>
      <button type="submit" className="button" disabled={busy}>{t.issue}</button>
    </form>
    {result&&<div className="recovery-result">
      <label>{t.link}<input readOnly value={result.link} onFocus={e=>e.currentTarget.select()}/></label>
      <p className="fine">{t.deliver} {t.expires} · {new Intl.DateTimeFormat(language,{dateStyle:'short',timeStyle:'short'}).format(new Date(result.expiresAt))}</p>
      {navigator.clipboard&&<button type="button" className="button" onClick={async()=>{
        try{await navigator.clipboard.writeText(result.link);setCopied(true);}catch{setCopied(false);}
      }}>{t.copy}</button>}
      {copied&&<span className="fine" role="status"> {t.copied}</span>}
    </div>}
    {error&&<div className="error" role="alert">{error}</div>}
  </section>;
}
