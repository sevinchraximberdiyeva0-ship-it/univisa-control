import {createContext,useContext,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Download} from 'lucide-react';
import {useLanguage} from './i18n';

type BrowserInstallPrompt=Event&{
  prompt:()=>Promise<unknown>;
  userChoice:Promise<{outcome:'accepted'|'dismissed'}>;
};
const InstallContext=createContext<{installed:boolean;requestInstall:()=>Promise<boolean>}|null>(null);

const instructions={
  uz:{title:'Ilovani o‘rnatish',close:'Yopish',apple:'Safari’da Ulashish menyusidan Add to Home Screen ni tanlang. Open as Web App ko‘rinsa, uni yoqing va Add tugmasini bosing.',android:'Chrome menyusidan Install app yoki Add to Home screen ni tanlang.',desktop:'Chrome’da manzil satridagi o‘rnatish belgisini yoki menyudan Install page as app ni tanlang. Edge’da Apps → Install this site as an app ni tanlang.',mac:'macOS Sonoma 14 yoki yangiroq tizimda Safari orqali File → Add to Dock ni tanlang.',https:'Telefonda o‘rnatish uchun ilovaning HTTPS manzilini oching.',fallback:'O‘rnatish tugmasi chiqmasa, ilovadan brauzer orqali foydalaning.'},
  tk:{title:'Programmany gurnamak',close:'Ýapmak',apple:'Safari paýlaşma menýusynda Add to Home Screen saýlaň. Open as Web App görkezilse, ony işlediň we Add basyň.',android:'Chrome menýusynda Install app ýa-da Add to Home screen saýlaň.',desktop:'Chrome-da salgy setirindäki gurnama nyşanyny ýa-da Install page as app saýlaň. Edge-de Apps → Install this site as an app saýlaň.',mac:'macOS Sonoma 14 ýa-da täze ulgamda Safari-de File → Add to Dock saýlaň.',https:'Telefonda gurnamak üçin programmanyň HTTPS salgysyny açyň.',fallback:'Gurnama mümkinçiligi görünmese, programmany brauzerde ulanyň.'},
  en:{title:'Install app',close:'Close',apple:'In Safari, open Share and choose Add to Home Screen. Enable Open as Web App if offered, then tap Add.',android:'In Chrome, open the menu and choose Install app or Add to Home screen.',desktop:'In Chrome, choose the install icon in the address bar or Install page as app. In Edge, choose Apps → Install this site as an app.',mac:'In Safari on macOS Sonoma 14 or later, choose File → Add to Dock.',https:'Open the app’s HTTPS address on your phone to install it.',fallback:'If installation is unavailable, you can use the app in your browser.'},
  ru:{title:'Установить приложение',close:'Закрыть',apple:'В Safari откройте меню «Поделиться» и выберите добавление на экран «Домой». Включите Open as Web App, если этот пункт доступен, и нажмите Add.',android:'В меню Chrome выберите установку приложения или добавление на главный экран.',desktop:'В Chrome нажмите значок установки в адресной строке или выберите установку страницы как приложения. В Edge откройте «Приложения» и выберите установку сайта как приложения.',mac:'В Safari на macOS Sonoma 14 или новее выберите «Файл» → «Добавить в Dock».',https:'Для установки на телефоне откройте HTTPS-адрес приложения.',fallback:'Если установка недоступна, пользуйтесь приложением в браузере.'},
  ko:{title:'앱 설치',close:'닫기',apple:'Safari의 공유 메뉴에서 홈 화면에 추가를 선택하세요. 웹 앱으로 열기가 표시되면 켠 후 추가를 누르세요.',android:'Chrome 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택하세요.',desktop:'Chrome 주소 표시줄의 설치 아이콘이나 앱으로 페이지 설치를 선택하세요. Edge에서는 앱 → 이 사이트를 앱으로 설치를 선택하세요.',mac:'macOS Sonoma 14 이상에서 Safari의 파일 → Dock에 추가를 선택하세요.',https:'휴대폰에 설치하려면 앱의 HTTPS 주소를 여세요.',fallback:'설치 메뉴가 없다면 브라우저에서 앱을 이용하세요.'},
  zh:{title:'安装应用',close:'关闭',apple:'在 Safari 的分享菜单中选择添加到主屏幕。如果有作为网页 App 打开的选项，请开启它，再点添加。',android:'在 Chrome 菜单中选择安装应用或添加到主屏幕。',desktop:'在 Chrome 中点击地址栏里的安装图标，或选择将页面安装为应用。在 Edge 中选择应用 → 将此站点安装为应用。',mac:'在 macOS Sonoma 14 或更高版本的 Safari 中，选择文件 → 添加到程序坞。',https:'请在手机上打开应用的 HTTPS 网址进行安装。',fallback:'若没有安装选项，可以继续在浏览器中使用。'},
};

function isStandalone(){
  return matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
}

export function StudentInstallProvider({children}:{children:ReactNode}){
  const prompt=useRef<BrowserInstallPrompt|null>(null);
  const [installed,setInstalled]=useState(isStandalone);
  useEffect(()=>{
    const mode=matchMedia('(display-mode: standalone)');
    const onPrompt=(event:Event)=>{
      event.preventDefault();
      prompt.current=event as BrowserInstallPrompt;
    };
    const onInstalled=()=>{prompt.current=null;setInstalled(true);};
    const onModeChange=()=>setInstalled(isStandalone());
    window.addEventListener('beforeinstallprompt',onPrompt);
    window.addEventListener('appinstalled',onInstalled);
    mode.addEventListener?.('change',onModeChange);
    return ()=>{
      window.removeEventListener('beforeinstallprompt',onPrompt);
      window.removeEventListener('appinstalled',onInstalled);
      mode.removeEventListener?.('change',onModeChange);
    };
  },[]);

  async function requestInstall(){
    const available=prompt.current;
    if(!available)return false;
    prompt.current=null;
    try{
      await available.prompt();
      if((await available.userChoice).outcome==='accepted')setInstalled(true);
      return true;
    }catch{return false;}
  }

  return <InstallContext.Provider value={{installed,requestInstall}}>{children}</InstallContext.Provider>;
}

export function StudentInstallAction({compact=false}:{compact?:boolean}){
  const install=useContext(InstallContext),t=instructions[useLanguage()];
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null),title=useId();
  const [busy,setBusy]=useState(false);
  if(!install||install.installed)return null;

  return <>
    <button ref={trigger} className={compact?'student-bar-button':'button student-install-trigger'} type="button" aria-label={t.title} title={compact?t.title:undefined} disabled={busy} onClick={async()=>{
      setBusy(true);
      try{
        if(await install.requestInstall())return;
        const element=dialog.current;
        if(!element)return;
        if(typeof element.showModal==='function')element.showModal();
        else{element.setAttribute('open','');close.current?.focus();}
      }
      finally{setBusy(false);}
    }}><Download size={19} aria-hidden="true"/>{!compact&&t.title}</button>
    <dialog ref={dialog} className="student-install-dialog" aria-labelledby={title} onClose={()=>trigger.current?.focus()}>
      <h2 id={title}>{t.title}</h2>
      {!window.isSecureContext&&<p>{t.https}</p>}
      <dl>
        <div><dt>iPhone / iPad</dt><dd>{t.apple}</dd></div>
        <div><dt>Android</dt><dd>{t.android}</dd></div>
        <div><dt>Windows / Linux / Chromebook</dt><dd>{t.desktop}</dd></div>
        <div><dt>Mac</dt><dd>{t.mac}</dd></div>
      </dl>
      <p>{t.fallback}</p>
      <div className="student-install-dialog-actions"><button ref={close} type="button" className="button" onClick={()=>{
        const element=dialog.current;
        if(typeof element?.close==='function')element.close();
        else{element?.removeAttribute('open');trigger.current?.focus();}
      }}>{t.close}</button></div>
    </dialog>
  </>;
}
