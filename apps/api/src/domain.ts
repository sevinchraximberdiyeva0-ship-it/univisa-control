import { DateTime } from 'luxon';
import { z } from 'zod';
export const DEFAULT_THRESHOLDS=[30,21,14,7,6,5,4,3,2,1,0];
export const dateOnly=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>DateTime.fromISO(v,{zone:'UTC'}).isValid,'Invalid calendar date');
export const dates=z.object({issueDate:dateOnly,expirationDate:dateOnly}).refine(v=>v.expirationDate>v.issueDate,'Expiration must follow issue date');
export function remaining(expiry:string|Date, now:Date, timezone:string) {
  const end=DateTime.fromISO(typeof expiry==='string'?expiry:expiry.toISOString().slice(0,10),{zone:timezone}).startOf('day');
  const today=DateTime.fromJSDate(now,{zone:timezone}).startOf('day');
  if (!end.isValid || !today.isValid) throw new Error('Invalid date or timezone');
  return Math.round(end.diff(today,'days').days);
}
export function schedule(expiry:Date, now:Date, timezone:string, thresholds:number[], start=9,end=18,catchUp=true) {
  const today=DateTime.fromJSDate(now,{zone:timezone});
  if(!today.isValid || start<0 || end>24 || start>=end) throw new Error('Invalid delivery configuration');
  const days=remaining(expiry,now,timezone);
  if(days<0) return [];
  const selected=thresholds.filter(d=>d<=days);
  // One catch-up on import, followed by future thresholds; never replay all missed milestones.
  if(catchUp && days<=Math.max(...thresholds) && !selected.includes(days)) selected.push(days);
  return [...new Set(selected)].map(d=>{
    let local=DateTime.fromISO(expiry.toISOString().slice(0,10),{zone:timezone}).minus({days:d}).set({hour:start});
    if(local.hasSame(today,'day') && today.hour>=start) local=today.hour<end?today:today.plus({days:1}).startOf('day').set({hour:start});
    return {days:d,localDate:local.toISODate()!,at:local.toUTC().toJSDate()};
  }).filter(s=>remaining(expiry,s.at,timezone)>=0);
}
export const transitions:Record<string,string[]>={DRAFT:['SUBMITTED'],SUBMITTED:['UNDER_REVIEW'],UNDER_REVIEW:['VERIFIED','REJECTED','NEEDS_CORRECTION'],NEEDS_CORRECTION:['SUBMITTED'],REJECTED:[],VERIFIED:[]};
export function assertTransition(from:string,to:string) { if(!transitions[from]?.includes(to)) throw Object.assign(new Error('Invalid workflow transition'),{status:409}); }
export const studentInput=z.object({studentNumber:z.string().trim().min(1).max(50),fullName:z.string().trim().min(2).max(150),facultyId:z.string().min(1),program:z.string().min(1).max(120),year:z.coerce.number().int().min(1).max(12),group:z.string().max(50),nationality:z.string().min(2).max(80),language:z.enum(['en','uz','ru']).default('en'),email:z.string().email().transform(v=>v.toLowerCase()),phone:z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),officerId:z.string().optional()});
export function previewImport(rows:unknown[],existing:string[],existingEmails:string[]=[]) {
  const seen=new Set(existing);
  const emails=new Set(existingEmails.map(v=>v.toLowerCase()));
  return rows.map((row,index)=>{const parsed=studentInput.safeParse(row); if(!parsed.success)return {row:index+1,errors:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`)}; const value=parsed.data; const errors=seen.has(value.studentNumber)?['Duplicate student number']:[];if(emails.has(value.email))errors.push('Duplicate university email');seen.add(value.studentNumber);emails.add(value.email); return {row:index+1,value,errors};});
}
export const writers=['SUPER_ADMIN','UNIVERSITY_ADMIN','INTERNATIONAL_OFFICE'];
export function permitted(role:string,action:'read'|'write'|'admin') { return action==='read' || (action==='write'?writers.includes(role):['SUPER_ADMIN','UNIVERSITY_ADMIN'].includes(role)); }
