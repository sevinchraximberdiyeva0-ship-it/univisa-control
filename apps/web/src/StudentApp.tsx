import {useState,type ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link,NavLink} from 'react-router-dom';
import {ArrowRight,Bell,CalendarDays,ChevronRight,ClipboardList,Files,GraduationCap,House,LogOut,UserRound} from 'lucide-react';
import {api,type Document,type User} from './api';
import {useLanguage,useText} from './i18n';
import {StudentInstallAction} from './StudentInstall';
import './student-app.css';

export const studentAppName='UniVisa Talaba';
export const studentAppText={
  uz:{home:'Bosh sahifa',documents:'Hujjatlar',renewals:'Arizalar',notifications:'Xabarlar',profile:'Profil',nav:'Talaba menyusi',expiry:'Amal qilish muddati',attention:'Hujjat holati',empty:'Hozircha hujjat qo‘shilmagan.',loading:'Hujjatlar yuklanmoqda…',today:'Bugun tugaydi',days:'{n} kun qoldi',calendar:'Muddatlar taqvimi',open:'Hujjatlarni ko‘rish',staffOnly:'Bu ilova talaba akkauntlari uchun.',staffPortal:'Universitet paneliga o‘tish',signOutError:'Chiqib bo‘lmadi. Qayta urinib ko‘ring.'},
  tk:{home:'Baş sahypa',documents:'Resminamalar',renewals:'Arzalar',notifications:'Bildirişler',profile:'Profil',nav:'Talyp menýusy',expiry:'Hereket ediş möhleti',attention:'Resminamanyň ýagdaýy',empty:'Häzirlikçe resminama ýok.',loading:'Resminamalar ýüklenýär…',today:'Şu gün gutarýar',days:'{n} gün galdy',calendar:'Möhletler senenamasy',open:'Resminamalary görmek',staffOnly:'Bu programma talyp hasaplary üçin.',staffPortal:'Uniwersitet paneline geçmek',signOutError:'Çykyp bolmady. Gaýtadan synanyşyň.'},
  en:{home:'Home',documents:'Documents',renewals:'Applications',notifications:'Alerts',profile:'Profile',nav:'Student navigation',expiry:'Expiry date',attention:'Document status',empty:'Your university has not added a document yet.',loading:'Loading documents…',today:'Expires today',days:'{n} days left',calendar:'Expiry calendar',open:'View documents',staffOnly:'This app is for student accounts.',staffPortal:'Open university console',signOutError:'Could not sign out. Please try again.'},
  ru:{home:'Главная',documents:'Документы',renewals:'Заявки',notifications:'Уведомления',profile:'Профиль',nav:'Меню студента',expiry:'Срок действия',attention:'Статус документа',empty:'Университет ещё не добавил документы.',loading:'Загрузка документов…',today:'Истекает сегодня',days:'Осталось дней: {n}',calendar:'Календарь сроков',open:'Смотреть документы',staffOnly:'Это приложение для студентов.',staffPortal:'Открыть панель университета',signOutError:'Не удалось выйти. Попробуйте ещё раз.'},
  ko:{home:'홈',documents:'서류',renewals:'신청',notifications:'알림',profile:'프로필',nav:'학생 메뉴',expiry:'만료일',attention:'서류 상태',empty:'대학에서 아직 서류를 추가하지 않았습니다.',loading:'서류를 불러오는 중…',today:'오늘 만료',days:'{n}일 남음',calendar:'만료 일정',open:'서류 보기',staffOnly:'학생 계정용 앱입니다.',staffPortal:'대학 관리 화면 열기',signOutError:'로그아웃하지 못했습니다. 다시 시도하세요.'},
  zh:{home:'首页',documents:'证件',renewals:'申请',notifications:'通知',profile:'个人资料',nav:'学生导航',expiry:'到期日期',attention:'证件状态',empty:'大学尚未添加证件。',loading:'正在载入证件…',today:'今天到期',days:'还有 {n} 天',calendar:'到期日历',open:'查看证件',staffOnly:'此应用面向学生账号。',staffPortal:'打开大学管理控制台',signOutError:'退出失败，请重试。'},
};

const documentNames={
  uz:{VISA:'Viza',TEMPORARY_REGISTRATION:'Vaqtincha ro‘yxat'},
  tk:{VISA:'Wiza',TEMPORARY_REGISTRATION:'Wagtlaýyn hasaba alyş'},
  en:{VISA:'Visa',TEMPORARY_REGISTRATION:'Temporary registration'},
  ru:{VISA:'Виза',TEMPORARY_REGISTRATION:'Временная регистрация'},
  ko:{VISA:'비자',TEMPORARY_REGISTRATION:'임시 등록'},
  zh:{VISA:'签证',TEMPORARY_REGISTRATION:'临时登记'},
};

export function StudentAppShell({user,languagePicker,onLogout,locked,children}:{
  user:User;languagePicker:ReactNode;onLogout:()=>Promise<void>;locked:boolean;children:ReactNode;
}){
  const t=studentAppText[useLanguage()],text=useText();
  const [signingOut,setSigningOut]=useState(false),[error,setError]=useState(false);
  const tabs=[
    {to:'/',label:t.home,Icon:House},
    {to:'/documents',label:t.documents,Icon:Files},
    {to:'/renewals',label:t.renewals,Icon:ClipboardList},
    {to:'/notifications',label:t.notifications,Icon:Bell},
    {to:'/profile',label:t.profile,Icon:UserRound},
  ];
  const isStudent=user.role==='STUDENT';
  return <div className="student-app">
    <header className="student-bar"><div className="student-bar-content">
      <Link to="/" className="student-brand"><span><GraduationCap size={22} aria-hidden="true"/></span>{studentAppName}</Link>
      <div className="student-header-actions">{isStudent&&<StudentInstallAction compact/>}{languagePicker}<button className="student-bar-button" type="button" title={text.logout} aria-label={text.logout} disabled={signingOut} onClick={async()=>{
        setSigningOut(true);setError(false);
        try{await onLogout();}catch{setError(true);}finally{setSigningOut(false);}
      }}><LogOut size={20}/></button></div>
    </div></header>
    <main className="student-content">
      {error&&<p role="alert" className="error">{t.signOutError}</p>}
      {isStudent?children:<section className="panel settings-panel"><h1>{t.staffOnly}</h1><a href="/" className="button">{t.staffPortal}<ArrowRight size={16}/></a></section>}
    </main>
    {isStudent&&!locked&&<nav className="student-tabs" aria-label={t.nav}><div>
      {tabs.map(({to,label,Icon})=><NavLink key={to} to={to} end={to==='/'}><Icon size={21} aria-hidden="true"/><span>{label}</span></NavLink>)}
    </div></nav>}
  </div>;
}

export function StudentHome({user}:{user:User}){
  const language=useLanguage(),t=studentAppText[language],text=useText();
  const documents=useQuery({queryKey:['documents'],queryFn:()=>api<Document[]>('/documents')});
  const university=useQuery({queryKey:['university'],queryFn:()=>api<{name:string}>('/university')});
  const first=documents.data?.reduce<Document|undefined>((due,document)=>!due||document.daysRemaining<due.daysRemaining?document:due,undefined);
  const status=first&&(first.daysRemaining<0?text.expired:first.daysRemaining===0?t.today:t.days.replace('{n}',String(first.daysRemaining)));
  const date=first&&new Intl.DateTimeFormat(language,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(first.expirationDate));
  const documentName=first&&(first.type==='VISA'||first.type==='TEMPORARY_REGISTRATION'?documentNames[language][first.type]:first.type.replaceAll('_',' '));
  const actions=[
    {to:'/calendar',label:t.calendar,Icon:CalendarDays},
    {to:'/renewals',label:text.renewals,Icon:ClipboardList},
    {to:'/notifications',label:text.notifications,Icon:Bell},
    {to:'/contact',label:text.contact,Icon:UserRound},
  ];
  return <>
    <div className="student-greeting"><div>{university.data&&<p>{university.data.name}</p>}<h1>{user.name}</h1></div><span className="student-initials" aria-hidden="true">{user.name.split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase()}</span></div>
    <section className="student-deadline" aria-labelledby="student-deadline-title">
      <div className="student-deadline-heading"><h2 id="student-deadline-title">{t.attention}</h2><CalendarDays size={24} aria-hidden="true"/></div>
      {documents.isPending&&<p role="status">{t.loading}</p>}
      {documents.error&&<p role="alert">{documents.error.message}</p>}
      {first?<div className="student-expiry">
        <div><p>{documentName} · {t.expiry}</p><time dateTime={first.expirationDate.slice(0,10)}>{date}</time></div>
        <span className={first.daysRemaining<=7?'student-status urgent':'student-status'}>{status}</span>
      </div>:documents.data&&<p>{t.empty}</p>}
      <Link to="/documents">{t.open}<ArrowRight size={17} aria-hidden="true"/></Link>
    </section>
    <div className="student-actions">{actions.map(({to,label,Icon})=><Link key={to} to={to}><span><Icon size={22} aria-hidden="true"/></span><b>{label}</b><ChevronRight size={16} aria-hidden="true"/></Link>)}</div>
  </>;
}
