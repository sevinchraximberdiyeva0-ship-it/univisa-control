export type User={id:string;name:string;email:string;role:string;mfaEnabled:boolean;emailVerifiedAt:string|null;emailVerificationRequired:boolean;emailVerificationAvailable:boolean};
export type Student={id:string;fullName:string;studentNumber:string;facultyId:string;faculty:{name:string};nationality:string;email:string;program:string;year:number;group:string;language:string;phoneAvailable:boolean;phoneVerifiedAt:string|null;telegram:unknown;documents:Document[]};
export type Document={id:string;studentId:string;type:string;expirationDate:string;issueDate:string;daysRemaining:number;activeVersion:number;student?:{fullName:string;studentNumber:string}};
export const cookie=(name:string)=>document.cookie.split('; ').find(v=>v.startsWith(`${name}=`))?.split('=').slice(1).join('=')??'';
export async function api<T>(url:string,options:RequestInit={}):Promise<T> {
  const multipart=options.body instanceof FormData;
  const response=await fetch(`/api${url}`,{credentials:'include',...options,headers:{...(!multipart?{'Content-Type':'application/json'}:{}),'X-CSRF-Token':decodeURIComponent(cookie('uv_csrf')),...options.headers}});
  if(!response.ok) {const data=await response.json().catch(()=>({error:'Request failed'}));throw new Error(data.error+(data.issues?`: ${data.issues.map((i:{message:string})=>i.message).join(', ')}`:''));}
  return response.status===204?undefined as T:response.json();
}
export const post=<T,>(url:string,data:unknown)=>api<T>(url,{method:'POST',body:JSON.stringify(data)});
