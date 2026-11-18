import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useSearchParams} from 'react-router-dom';
import {startRegistration,startAuthentication,type PublicKeyCredentialCreationOptionsJSON,type PublicKeyCredentialRequestOptionsJSON} from '@simplewebauthn/browser';
import {Fingerprint,ShieldCheck} from 'lucide-react';
import {api,post,type User} from './api';
import {EmailVerification} from './EmailVerification';
import {IssueRecovery} from './AccountRecovery';
import {accountText,admissionText,identityListText,isLanguage,languageCodes,languageNames,useLanguage,useText,type Language} from './i18n';

const errorText=(error:unknown)=>error instanceof Error?error.message:'Amal bajarilmadi';

function identitySubmission(form:FormData){
  return {consent:form.get('consent')==='yes',identity:{
    type:form.get('type'),country:String(form.get('country')).toUpperCase(),number:form.get('number'),
    dateOfBirth:form.get('dateOfBirth'),issueDate:form.get('issueDate'),expirationDate:form.get('expirationDate'),
  }};
}

function IdentityFields(){
  const t=admissionText[useLanguage()];
  return <>
    <label>{t.type}<select name="type"><option value="PASSPORT">{t.passport}</option><option value="ID_CARD">{t.idCard}</option></select></label>
    <label>{t.country}<input name="country" minLength={2} maxLength={2} placeholder="UZ" required/></label>
    <label>{t.number}<input name="number" minLength={4} maxLength={30} required autoComplete="off"/></label>
    <label>{t.birth}<input name="dateOfBirth" type="date" required/></label>
    <label>{t.issued}<input name="issueDate" type="date" required/></label>
    <label>{t.expiration}<input name="expirationDate" type="date" required/></label>
    <label className="checkbox-label"><input type="checkbox" name="consent" value="yes" required/>{t.consent}</label>
  </>;
}
export function FaceIdLogin({done}:{done:()=>void}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const t=admissionText[useLanguage()];
  return <div className="passkey-login"><button className="primary" type="button" disabled={busy} onClick={async()=>{setError('');setBusy(true);try{const options=await post<PublicKeyCredentialRequestOptionsJSON>('/auth/passkeys/authentication/options',{});const response=await startAuthentication({optionsJSON:options});await post('/auth/passkeys/authentication/verify',{response});done();}catch(e){setError(errorText(e));}finally{setBusy(false);}}}><Fingerprint size={18}/>{busy?t.waiting:t.signIn}</button><p className="fine">{t.keyHelp}</p>{error&&<div className="error" role="alert">{error}</div>}</div>;
}
export function StudentRegistration({done}:{done:()=>void}){
  const language=useLanguage(),t=admissionText[language],account=accountText[language];
  const [open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[slug,setSlug]=useState('demo'),[options,setOptions]=useState<{name:string;faculties:{id:string;name:string}[]}>();
  if(!open)return <button className="button registration-open" type="button" onClick={()=>setOpen(true)}>{t.register}</button>;
  return <section className="identity-signup"><h2>{t.title}</h2><p className="fine">{t.intro}</p><label>{account.code}<input value={slug} onChange={e=>{setSlug(e.target.value);setOptions(undefined);}}/></label><button className="button" type="button" onClick={async()=>{try{setOptions(await api(`/auth/registration-options?university=${encodeURIComponent(slug)}`));setError('');}catch(e){setError(errorText(e));}}}>{t.faculties}</button>{options&&<form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');const f=new FormData(e.currentTarget);try{await post('/auth/student-registration',{university:slug,fullName:f.get('fullName'),studentNumber:f.get('studentNumber'),email:f.get('email'),password:f.get('password'),facultyId:f.get('facultyId'),program:f.get('program'),year:Number(f.get('year')),group:f.get('group'),nationality:f.get('nationality'),language:f.get('language'),...identitySubmission(f)});done();}catch(e){setError(errorText(e));}finally{setBusy(false);}}}>
    <p className="fine">{options.name}</p>{[['fullName',t.name],['studentNumber',t.studentNumber],['email',account.email],['password',t.newPassword],['program',t.program],['group',t.group],['nationality',t.nationality]].map(([name,label])=><label key={name}>{label}<input name={name} type={name==='password'?'password':name==='email'?'email':'text'} minLength={name==='password'?14:1} maxLength={name==='password'?128:150} required autoComplete={name==='password'?'new-password':name==='email'?'email':'off'}/></label>)}
    <label>{t.faculty}<select name="facultyId" required>{options.faculties.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>{t.year}<input type="number" name="year" min="1" max="12" defaultValue="1" required/></label><label>{account.notificationLanguage}<select name="language" defaultValue={language}>{languageCodes.map(code=><option key={code} value={code} lang={code}>{languageNames[code]}</option>)}</select></label><IdentityFields/><button className="primary" disabled={busy}>{busy?t.sending:t.send}</button>
  </form>}{error&&<div className="error" role="alert">{error}</div>}<button className="button" type="button" onClick={()=>setOpen(false)}>{t.back}</button></section>;
}
export function StudentProfile({user}:{user:User}){
  const t=accountText[useLanguage()];
  const [error,setError]=useState(''),[success,setSuccess]=useState(false);
  return <><div className="page-heading"><div><div className="eyebrow">UNIVISA / STUDENT ACCOUNT</div><h1>{t.profile}</h1><p>Akkaunt qurilma kalitiga bog‘lanadi. Telefon yoki talaba raqami o‘zgarishi bu kalitni o‘zgartirmaydi.</p></div></div><Passkeys/><EmailVerification user={user}/><StudentNotificationLanguage/><section className="panel settings-panel"><h2>Telefon raqamini yangilash</h2><form onSubmit={async e=>{e.preventDefault();setError('');setSuccess(false);const form=e.currentTarget,f=new FormData(form);try{await api('/auth/student-phone',{method:'PATCH',body:JSON.stringify({phone:f.get('phone'),password:f.get('password')})});setSuccess(true);form.reset();}catch(e){setError(errorText(e));}}}><label>Yangi telefon raqami<input name="phone" type="tel" pattern="\+[1-9][0-9]{7,14}" placeholder="+998…" required/></label><label>Joriy parol<input name="password" type="password" required autoComplete="current-password"/></label><button className="primary">Telefonni saqlash</button></form>{success&&<div className="notice" role="status">Raqam yangilandi. SMS uchun universitet uni qayta tasdiqlashi kerak. Qurilma kalitingiz saqlandi.</div>}{error&&<div className="error" role="alert">{error}</div>}</section></>;
}
function StudentNotificationLanguage(){
  const cache=useQueryClient(),t=accountText[useLanguage()],text=useText();
  const profile=useQuery({queryKey:['student-profile'],queryFn:()=>api<{language:string}>('/profile')});
  const [selection,setSelection]=useState<Language>(),[saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false),[error,setError]=useState('');
  const current=profile.data?.language??null;
  return <section className="panel settings-panel">
    <h2>{t.notificationLanguage}</h2>
    {profile.data&&<form onSubmit={async e=>{
      e.preventDefault();
      if(!selection)return;
      setSaving(true);setError('');setSaved(false);
      try{
        await api('/profile',{method:'PATCH',body:JSON.stringify({language:selection})});
        cache.setQueryData(['student-profile'],{...profile.data,language:selection});
        setSelection(undefined);setSaved(true);
      }catch(e){setError(errorText(e));}finally{setSaving(false);}
    }}>
      <label>{t.notificationLanguage}<select value={selection??(isLanguage(current)?current:'en')} disabled={saving} onChange={e=>{
        const next=e.target.value;
        if(isLanguage(next)){setSelection(next);setSaved(false);setError('');}
      }}>{languageCodes.map(code=><option key={code} value={code} lang={code}>{languageNames[code]}</option>)}</select></label>
      <button className="primary" disabled={saving||!selection||selection===current}>{text.save}</button>
    </form>}
    {saved&&<div className="notice" role="status">{t.saved}</div>}
    {(error||profile.error)&&<div className="error" role="alert">{error||profile.error?.message}</div>}
  </section>;
}
function Passkeys(){
  const cache=useQueryClient(),keys=useQuery({queryKey:['passkeys'],queryFn:()=>api<{id:string;name:string;createdAt:string;lastUsedAt:string|null}[]>('/auth/passkeys')});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <section className="panel settings-panel"><h2><Fingerprint size={21}/>Face ID / qurilma kalitlari</h2><p className="fine">Qurilmaga qarab Face ID, Touch ID, Windows Hello yoki qurilma PIN’i ishlatiladi. Server yuz tasvirini olmaydi va biometrika turini aniqlamaydi. Kalit yo‘qolsa, parol bilan kiring yoki universitetga murojaat qiling.</p><form className="form-grid" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');const form=e.currentTarget,f=new FormData(form);try{const options=await post<PublicKeyCredentialCreationOptionsJSON>('/auth/passkeys/registration/options',{password:f.get('password')});const response=await startRegistration({optionsJSON:options});await post('/auth/passkeys/registration/verify',{response,name:f.get('name')});form.reset();void cache.invalidateQueries({queryKey:['passkeys']});}catch(e){setError(errorText(e));}finally{setBusy(false);}}}><label>Qurilma nomi<input name="name" required maxLength={80} placeholder="Shaxsiy telefonim"/></label><label>Joriy parol<input name="password" type="password" required autoComplete="current-password"/></label><button className="primary" disabled={busy}>{busy?'Qurilma tasdig‘i kutilmoqda…':'Qurilma kalitini qo‘shish'}</button></form><div className="passkey-list">{keys.data?.map(key=><div className="passkey-row" key={key.id}><div><strong>{key.name}</strong><p className="fine">Qo‘shilgan: {key.createdAt.slice(0,10)} · Oxirgi kirish: {key.lastUsedAt?.slice(0,10)??'Hali yo‘q'}</p></div><form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api(`/auth/passkeys/${encodeURIComponent(key.id)}`,{method:'DELETE',body:JSON.stringify({password:f.get('password')})});void cache.invalidateQueries({queryKey:['passkeys']});}catch(e){setError(errorText(e));}}}><input name="password" type="password" required placeholder="O‘chirish uchun parol" aria-label={`Remove ${key.name} password`}/><button className="button">Kalitni o‘chirish</button></form></div>)}</div>{(error||keys.error)&&<div className="error" role="alert">{error||keys.error?.message}</div>}</section>;
}
export type IdentityStatus={status:string;numberLast4:string;notes:string|null};
export function PendingIdentity({user,identity,refresh}:{user:User;identity:IdentityStatus;refresh:()=>Promise<unknown>}){
  const language=useLanguage(),t=admissionText[language],text=useText();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const rejected=identity.status==='REJECTED';
  return <><section className="panel settings-panel">
    <ShieldCheck size={30}/><h1>{rejected?t.rejected:t.pending}</h1>
    <p>{t.number}: ****{identity.numberLast4} · {rejected?t.rejected:text.pending}</p>
    <p>{identity.notes??t.pendingHelp}</p>
    <button className="button" onClick={()=>void refresh()}>{t.refresh}</button>
    {rejected&&<form className="form-grid" onSubmit={async e=>{
      e.preventDefault();setBusy(true);setError('');
      try{
        await post('/auth/identity/resubmit',identitySubmission(new FormData(e.currentTarget)));
        await refresh();
      }catch(e){setError(errorText(e));}finally{setBusy(false);}
    }}>
      <h2 className="full">{t.correct}</h2>
      <IdentityFields/>
      <button className="primary" disabled={busy}>{busy?t.sending:t.resubmit}</button>
    </form>}
    {error&&<div className="error" role="alert">{error}</div>}
  </section><EmailVerification user={user}/><Passkeys/></>;
}
type ApplicationStatus='SUBMITTED'|'VERIFIED'|'REJECTED';
type ApplicationRow={id:string;status:string;numberLast4:string;student:{fullName:string;studentNumber:string}};
type ApplicationPage={rows:ApplicationRow[];page:number;totalPages:number};
type ApplicationDetails={status:string;submissionVersion:number;details:Record<string,string>};

export function IdentityReview(){
  const language=useLanguage(),t=identityListText[language];
  const statusLabels={SUBMITTED:t.submitted,VERIFIED:t.verified,REJECTED:t.rejected};
  const statuses=['SUBMITTED','VERIFIED','REJECTED'] as const;
  const [params,setParams]=useSearchParams();
  const status=statuses.find(value=>value===params.get('status'))??'';
  const pageValue=Number(params.get('page'));
  const page=Number.isInteger(pageValue)&&pageValue>=1&&pageValue<=1_000_000?pageValue:1;
  const [selected,setSelected]=useState<(ApplicationRow&ApplicationDetails)>();
  const [opening,setOpening]=useState(false),[reviewing,setReviewing]=useState(false),[error,setError]=useState('');
  const cache=useQueryClient();
  const query=useQuery({queryKey:['identity-applications',status,page],staleTime:0,queryFn:({signal})=>{
    const params=new URLSearchParams({page:String(page)});
    if(status)params.set('status',status);
    return api<ApplicationPage>(`/identity/applications?${params}`,{signal});
  }});
  const auth=useQuery({queryKey:['auth'],queryFn:()=>api<{user:User}>('/auth/me')});
  const university=useQuery({queryKey:['university'],queryFn:()=>api<{studentRegistrationEnabled:boolean}>('/university')});
  const admin=['SUPER_ADMIN','UNIVERSITY_ADMIN'].includes(auth.data?.user.role??'');
  const result=query.data;

  function changeView(next:number,nextStatus:ApplicationStatus|''=status){
    setSelected(undefined);setError('');
    const query=new URLSearchParams();
    if(nextStatus)query.set('status',nextStatus);
    if(next>1)query.set('page',String(next));
    setParams(query);
  }

  async function openApplication(row:ApplicationRow){
    setOpening(true);setSelected(undefined);setError('');
    try{
      const details=await api<ApplicationDetails>(`/identity/applications/${row.id}`);
      setSelected({...row,...details});
    }catch(e){setError(errorText(e));}finally{setOpening(false);}
  }

  return <>
    <div className="page-heading"><div><div className="eyebrow">UNIVISA / IDENTITY REVIEW</div>
      <h1>{accountText[language].identity}</h1>
      <p>Faqat vakolatli xodim asl hujjatni tekshirib tasdiqlaydi. Face ID pasport tekshiruvining o‘rnini bosmaydi.</p>
    </div></div>
    {admin&&<section className="panel settings-panel">
      <p>Talabalar ro‘yxatdan o‘tishi: <b>{university.data?.studentRegistrationEnabled?'Ochiq':'Yopiq'}</b></p>
      <button className="button" disabled={!university.data} onClick={async()=>{
        try{
          await api('/identity/registration-policy',{method:'PUT',body:JSON.stringify({enabled:!university.data?.studentRegistrationEnabled})});
          void cache.invalidateQueries({queryKey:['university']});
        }catch(e){setError(errorText(e));}
      }}>{university.data?.studentRegistrationEnabled?'Ro‘yxatdan o‘tishni yopish':'Ro‘yxatdan o‘tishni ochish'}</button>
      <p className="fine">Universitetning shaxsiy ma’lumotlarni qayta ishlash siyosati va huquqiy ko‘rigi tayyor bo‘lgach oching.</p>
    </section>}
    {(error||query.error)&&<div className="error" role="alert">{error||query.error?.message}</div>}
    <section className="panel">
      <div className="toolbar"><label htmlFor="identity-status-filter">{t.filter}</label>
        <select id="identity-status-filter" value={status} disabled={opening||reviewing} onChange={e=>{
          changeView(1,statuses.find(value=>value===e.target.value)??'');
        }}>
          <option value="">{t.all}</option>
          {statuses.map(value=><option key={value} value={value}>{statusLabels[value]}</option>)}
        </select>
      </div>
      {query.isPending&&<p className="empty" role="status">{t.loading}</p>}
      {result?.rows.length===0&&<p className="empty" role="status">{t.empty}</p>}
      {!!result?.rows.length&&<div className="table-wrap"><table>
        <thead><tr><th>{t.student}</th><th>{t.document}</th><th>{t.status}</th><th/></tr></thead>
        <tbody>{result.rows.map(row=><tr key={row.id}>
          <td>{row.student.fullName}<small>{row.student.studentNumber}</small></td>
          <td>****{row.numberLast4}</td>
          <td>{statusLabels[row.status as ApplicationStatus]??row.status}</td>
          <td><button className="button" disabled={opening||reviewing} onClick={()=>void openApplication(row)}>{t.open}</button></td>
        </tr>)}</tbody>
      </table></div>}
      {result&&result.totalPages>1&&<nav className="toolbar identity-pages" aria-label={t.navigation}>
        <button className="button" disabled={result.page===1||opening||reviewing} onClick={()=>changeView(result.page-1)}>{t.previous}</button>
        <span aria-live="polite">{t.page.replace('{page}',String(result.page)).replace('{total}',String(result.totalPages))}</span>
        <button className="button" disabled={result.page===result.totalPages||opening||reviewing} onClick={()=>changeView(result.page+1)}>{t.next}</button>
      </nav>}
    </section>
    {selected&&<section className="panel settings-panel">
      <h2>{selected.student.fullName}</h2>
      <dl>{Object.entries(selected.details).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      {selected.status==='SUBMITTED'&&<form onSubmit={async e=>{
        e.preventDefault();const form=new FormData(e.currentTarget);
        setReviewing(true);setError('');
        try{
          await post(`/identity/applications/${selected.id}/review`,{state:form.get('state'),notes:form.get('notes'),originalChecked:form.get('originalChecked')==='yes',submissionVersion:selected.submissionVersion});
          setSelected(undefined);await cache.invalidateQueries();
        }catch(e){setError(errorText(e));}finally{setReviewing(false);}
      }}>
        <label>Qaror<select name="state"><option value="VERIFIED">Tasdiqlash</option><option value="REJECTED">Rad etish</option></select></label>
        <label>Tekshiruv qaydlari<textarea name="notes" minLength={15} maxLength={1000} required/></label>
        <label className="checkbox-label"><input type="checkbox" name="originalChecked" value="yes" required/>Asl ID/pasport va talabaning shaxsini tekshirdim.</label>
        <button className="primary" disabled={reviewing}>Qarorni saqlash</button>
      </form>}
      {selected.status==='VERIFIED'&&<IssueRecovery key={selected.id} identityId={selected.id}/>}
      <button className="button" disabled={reviewing} onClick={()=>setSelected(undefined)}>Yopish</button>
    </section>}
  </>;
}
