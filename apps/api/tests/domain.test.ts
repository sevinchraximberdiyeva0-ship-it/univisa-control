import {describe,it,expect} from 'vitest';
import {DEFAULT_THRESHOLDS,remaining,schedule,dates,assertTransition,previewImport,permitted} from '../src/domain.js';
describe('university calendar calculations',()=>{
  it.each(DEFAULT_THRESHOLDS)('schedules the %i-day reminder',days=>{
    const expiry=new Date('2028-03-30T00:00:00Z');const now=new Date(expiry);now.setUTCDate(now.getUTCDate()-days);now.setUTCHours(5);
    const jobs=schedule(expiry,now,'Asia/Tashkent',DEFAULT_THRESHOLDS);
    expect(jobs.some(j=>j.days===days)).toBe(true);expect(remaining(expiry,now,'Asia/Tashkent')).toBe(days);
  });
  it('uses Tashkent midnight rather than UTC midnight',()=>{
    expect(remaining('2028-03-01',new Date('2028-02-29T18:59:59Z'),'Asia/Tashkent')).toBe(1);
    expect(remaining('2028-03-01',new Date('2028-02-29T19:00:00Z'),'Asia/Tashkent')).toBe(0);
  });
  it('handles leap years',()=>{expect(remaining('2028-03-01',new Date('2028-02-28T12:00:00Z'),'UTC')).toBe(2);});
  it('handles a daylight-saving calendar boundary',()=>{expect(remaining('2028-03-13',new Date('2028-03-11T18:00:00Z'),'America/New_York')).toBe(2);});
  it('rejects impossible dates and reversed dates',()=>{expect(dates.safeParse({issueDate:'2027-02-29',expirationDate:'2028-03-01'}).success).toBe(false);expect(dates.safeParse({issueDate:'2028-01-02',expirationDate:'2028-01-01'}).success).toBe(false);});
  it('creates one catch-up for newly imported documents',()=>{const jobs=schedule(new Date('2028-04-18'),new Date('2028-04-01T05:00:00Z'),'Asia/Tashkent',DEFAULT_THRESHOLDS);expect(jobs.filter(j=>j.days===17)).toHaveLength(1);expect(jobs.some(j=>j.days===21)).toBe(false);});
  it('respects delivery hours',()=>{const jobs=schedule(new Date('2028-04-18'),new Date('2028-04-01T18:00:00Z'),'Asia/Tashkent',DEFAULT_THRESHOLDS);const catchup=jobs.find(j=>j.days===17)!;expect(catchup.at.toISOString()).toBe('2028-04-02T04:00:00.000Z');});
  it('does not schedule unlimited overdue messages',()=>{expect(schedule(new Date('2028-01-01'),new Date('2028-01-02'),'Asia/Tashkent',DEFAULT_THRESHOLDS)).toEqual([]);});
  it('does not duplicate a configured threshold',()=>{const jobs=schedule(new Date('2028-04-08'),new Date('2028-04-01'),'UTC',[7,7,0]);expect(jobs.filter(j=>j.days===7)).toHaveLength(1);});
  it('does not create repeated daily catch-up messages after initial planning',()=>{const jobs=schedule(new Date('2028-04-18'),new Date('2028-04-02T05:00:00Z'),'Asia/Tashkent',DEFAULT_THRESHOLDS,9,18,false);expect(jobs.some(j=>j.days===16)).toBe(false);});
});
describe('workflow permissions',()=>{
  it('keeps a submitted renewal pending until officer review',()=>{expect(()=>assertTransition('SUBMITTED','VERIFIED')).toThrow();expect(()=>assertTransition('SUBMITTED','UNDER_REVIEW')).not.toThrow();expect(()=>assertTransition('UNDER_REVIEW','VERIFIED')).not.toThrow();});
  it('prevents changes after verification',()=>{expect(()=>assertTransition('VERIFIED','REJECTED')).toThrow();});
  it.each(['STUDENT','AUDITOR','FACULTY_COORDINATOR'])('blocks writes for %s',role=>expect(permitted(role,'write')).toBe(false));
  it('allows international office verification but not staff administration',()=>{expect(permitted('INTERNATIONAL_OFFICE','write')).toBe(true);expect(permitted('INTERNATIONAL_OFFICE','admin')).toBe(false);});
});
describe('bulk import validation',()=>{
  const row={studentNumber:'S1',fullName:'Synthetic Student',facultyId:'faculty',program:'Engineering',year:1,group:'A',nationality:'Example',language:'en',email:'test@example.invalid'};
  it('reports within-file and existing duplicates',()=>{expect(previewImport([row,row],[])[1].errors).toContain('Duplicate student number');expect(previewImport([row],['S1'])[0].errors).toHaveLength(1);expect(previewImport([row],[],[row.email])[0].errors).toContain('Duplicate university email');});
  it('rejects malformed phone numbers and email',()=>{expect(previewImport([{...row,phone:'1234',email:'invalid'}],[])[0].errors.length).toBeGreaterThan(0);});
});
