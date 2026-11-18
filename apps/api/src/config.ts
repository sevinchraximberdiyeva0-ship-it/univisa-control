import 'dotenv/config';
import { z } from 'zod';
export const config = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().default(4000), APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1), REDIS_URL: z.string().default('redis://localhost:6379'),
  ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i), SESSION_HOURS: z.coerce.number().min(1).max(24).default(8),
  STORAGE_PATH: z.string().default('./storage'), SMS_MODE: z.enum(['mock','live']).default('mock'),
  ALLOW_LIVE_NOTIFICATIONS: z.enum(['true','false']).default('false').transform(v=>v==='true'),
  DEVSMS_TOKEN:z.string().optional(), DEVSMS_WEBHOOK_KEY:z.string().optional(), DEVSMS_SENDER:z.string().default('4546'),
  TELEGRAM_MODE: z.enum(['mock','live']).default('mock'), TELEGRAM_BOT_TOKEN: z.string().optional(),
  EMAIL_MODE: z.enum(['disabled','mock','live']).default('disabled'),
  EMAIL_RESEND_API_KEY:z.string().optional(), EMAIL_FROM:z.string().optional(), TEST_EMAIL_OUTBOX:z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(), SMS_WEBHOOK_SECRET: z.string().optional()
}).parse(process.env);
if (config.TELEGRAM_MODE === 'live' && (!config.TELEGRAM_BOT_TOKEN || (config.TELEGRAM_WEBHOOK_SECRET?.length ?? 0) < 32)) throw new Error('Live Telegram requires token and strong webhook secret');
if (config.EMAIL_MODE==='live'&&(!config.EMAIL_RESEND_API_KEY?.trim()||!config.EMAIL_FROM?.trim())) throw new Error('Live email requires EMAIL_RESEND_API_KEY and EMAIL_FROM');
if (config.EMAIL_MODE==='mock'&&(config.NODE_ENV!=='test'||!config.TEST_EMAIL_OUTBOX)) throw new Error('Mock email requires test mode and a test outbox path');
if (config.NODE_ENV === 'production' && !config.APP_ORIGIN.startsWith('https://')) throw new Error('Production requires HTTPS');
