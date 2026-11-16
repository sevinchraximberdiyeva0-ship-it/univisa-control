import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
export const token = () => randomBytes(32).toString('hex');
export const hash = (value:string) => createHash('sha256').update(value).digest('hex');
export function equal(a:string,b:string) { const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }
export function encrypt(value:string) { const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',Buffer.from(config.ENCRYPTION_KEY,'hex'),iv); const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return [iv,cipher.getAuthTag(),ciphertext].map(v=>v.toString('base64')).join('.'); }
export function decrypt(value:string) { const [iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'base64')); const cipher=createDecipheriv('aes-256-gcm',Buffer.from(config.ENCRYPTION_KEY,'hex'),iv); cipher.setAuthTag(tag); return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8'); }
