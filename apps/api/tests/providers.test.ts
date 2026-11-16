import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
process.env.DATABASE_URL??='postgresql://unused@localhost/unused';process.env.ENCRYPTION_KEY??='a'.repeat(64);process.env.NODE_ENV='test';
const {DevSmsProvider,MockSmsProvider,verifyDevSmsSignature,telegramSend,deliveryFailure}=await import('../src/providers.js');
const {config}=await import('../src/config.js');
const {simulate}=await import('../src/simulator.js');
const {render}=await import('../src/notifications.js');
const {DEFAULT_THRESHOLDS}=await import('../src/domain.js');
const {createHmac}=await import('node:crypto');
const credentials={token:'synthetic-token-only',webhookKey:'w'.repeat(32),sender:'4546'};
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{config.TELEGRAM_MODE='mock';config.ALLOW_LIVE_NOTIFICATIONS=false;vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Unmocked network prohibited'));});
afterEach(()=>vi.restoreAllMocks());
describe('DevSMS provider contract — mocked transport only',()=>{
  it('normalizes Uzbekistan numbers and only records provider acceptance',async()=>{
    const transport=vi.fn<typeof fetch>().mockResolvedValue(response({success:true,data:{sms_id:123,status:'sent'}}));
    const provider=new DevSmsProvider(credentials,'https://university.example.invalid/api/sms/devsms/tenant',transport);
    expect(await provider.send('+998000000000','Synthetic notification','key')).toEqual({state:'ACCEPTED',providerMessageId:'123'});
    const [url,options]=transport.mock.calls[0];expect(url).toBe('https://devsms.uz/api/send_sms.php');expect(JSON.parse(String(options?.body)).phone).toBe('998000000000');expect(JSON.parse(String(options?.body)).callback_url).toContain('/tenant');
  });
  it.each([['+123','INVALID_NUMBER'],['+441234567890','UNSUPPORTED_NUMBER']])('refuses unsupported phone %s without network',async(phone)=>{
    const transport=vi.fn<typeof fetch>();const provider=new DevSmsProvider(credentials,'https://example.invalid',transport);await expect(provider.send(phone,'test','key')).rejects.toThrow('UNSUPPORTED_NUMBER');expect(transport).not.toHaveBeenCalled();
  });
  it.each([[401,'PROVIDER_AUTH'],[403,'PROVIDER_AUTH'],[429,'TEMPORARY'],[503,'TRANSPORT_UNCERTAIN'],[422,'PROVIDER_REJECTED']])('classifies HTTP %i',async(status,code)=>{
    const provider=new DevSmsProvider(credentials,'https://example.invalid',vi.fn<typeof fetch>().mockResolvedValue(response({},Number(status))));await expect(provider.send('+998000000000','test','key')).rejects.toThrow(String(code));
  });
  it('quarantines ambiguous successful responses',async()=>{const provider=new DevSmsProvider(credentials,'https://example.invalid',vi.fn<typeof fetch>().mockResolvedValue(response({success:true,data:{}})));await expect(provider.send('+998000000000','test','key')).rejects.toThrow('TRANSPORT_UNCERTAIN');});
  it('confirms delivery only from a matching authenticated status response',async()=>{const provider=new DevSmsProvider(credentials,'https://example.invalid',vi.fn<typeof fetch>().mockImplementation(async()=>response({success:true,data:{id:123,status:'delivered'}})));expect(await provider.status('123')).toBe('DELIVERED');await expect(provider.status('124')).rejects.toThrow('RECEIPT_MISMATCH');});
  it('validates raw-body HMAC and rejects tampering and replay',()=>{const raw=Buffer.from('{"sms_id":123,"status":"delivered"}'),timestamp=String(Math.floor(Date.now()/1000));const signature='sha256='+createHmac('sha256',credentials.webhookKey).update(timestamp+'.').update(raw).digest('hex');expect(verifyDevSmsSignature(raw,timestamp,signature,credentials.webhookKey)).toBe(true);expect(verifyDevSmsSignature(Buffer.from('{}'),timestamp,signature,credentials.webhookKey)).toBe(false);expect(verifyDevSmsSignature(raw,timestamp,signature,credentials.webhookKey,Date.now()+301000)).toBe(false);});
});
describe('Telegram Bot API — mocked transport only',()=>{
  it('mock mode does not call the network',async()=>{expect((await telegramSend('synthetic-chat','test')).state).toBe('MOCK');expect(fetch).not.toHaveBeenCalled();});
  it('requires the independent live-send gate',async()=>{config.TELEGRAM_MODE='live';await expect(telegramSend('synthetic-chat','test')).rejects.toThrow('LIVE_DISABLED');expect(fetch).not.toHaveBeenCalled();});
  it('does not claim recipient delivery for accepted Telegram messages',async()=>{config.TELEGRAM_MODE='live';config.ALLOW_LIVE_NOTIFICATIONS=true;const transport=vi.fn<typeof fetch>().mockResolvedValue(response({ok:true,result:{message_id:42}}));expect(await telegramSend('synthetic-chat','test',undefined,transport)).toEqual({state:'ACCEPTED',providerMessageId:'42'});});
  it.each([[403,'CHANNEL_BLOCKED'],[429,'TEMPORARY'],[500,'TRANSPORT_UNCERTAIN'],[401,'PROVIDER_AUTH']])('classifies HTTP %i',async(status,code)=>{config.TELEGRAM_MODE='live';config.ALLOW_LIVE_NOTIFICATIONS=true;await expect(telegramSend('synthetic-chat','test',undefined,vi.fn<typeof fetch>().mockResolvedValue(response({ok:false,error_code:status},Number(status))))).rejects.toThrow(String(code));});
  it('honors a bounded provider retry-after delay',async()=>{config.TELEGRAM_MODE='live';config.ALLOW_LIVE_NOTIFICATIONS=true;try{await telegramSend('synthetic-chat','test',undefined,vi.fn<typeof fetch>().mockResolvedValue(response({ok:false,error_code:429,parameters:{retry_after:120}},429)));}catch(e){expect(deliveryFailure(e,0).delay).toBe(120000);}});
  it('bounds temporary retries and never retries uncertain acceptance',()=>{expect(deliveryFailure(new Error('TEMPORARY'),0)).toMatchObject({retry:true,delay:30000});expect(deliveryFailure(new Error('TEMPORARY'),2)).toMatchObject({retry:true,delay:120000});expect(deliveryFailure(new Error('TEMPORARY'),3)).toMatchObject({retry:false,state:'FAILED'});expect(deliveryFailure(new Error('timeout'),0)).toMatchObject({retry:false,state:'UNKNOWN'});});
});
describe('safe shared-engine simulator and templates',()=>{
  const policy={timezone:'Asia/Tashkent',deliveryStart:9,deliveryEnd:18,thresholds:DEFAULT_THRESHOLDS,overdueOffsets:[1,3,7]};
  const input={expirationDate:'2028-03-30',language:'uz' as const,renewAtDays:null,smsFailure:'none' as const,telegramStarted:true};
  it('executes the full milestone sequence without network or queue writes',async()=>{const result=await simulate(input,policy);expect(result.realMessagesSent).toBe(0);expect(result.queuedJobs).toBe(0);expect(result.events.filter(e=>e.channel==='SMS').map(e=>e.daysRemaining)).toEqual(DEFAULT_THRESHOLDS);expect(result.events.filter(e=>e.kind==='OVERDUE')).toHaveLength(3);expect(fetch).not.toHaveBeenCalled();});
  it('cancels future reminders on verified renewal and immediately confirms',async()=>{const result=await simulate({...input,renewAtDays:7},policy);expect(result.events.filter(e=>e.kind==='CONFIRMATION')).toHaveLength(3);expect(result.events.some(e=>e.kind==='REMINDER'&&e.daysRemaining<=7)).toBe(false);expect(result.events.some(e=>e.kind==='OVERDUE')).toBe(false);});
  it('simulates retries and Telegram not started',async()=>{const result=await simulate({...input,smsFailure:'temporary',telegramStarted:false},policy);expect(result.events.filter(e=>e.channel==='SMS'&&e.daysRemaining===30)).toHaveLength(4);expect(result.events.filter(e=>e.channel==='TELEGRAM').every(e=>e.state==='UNAVAILABLE')).toBe(true);});
  it.each(['uz','en','ru'])('has distinct urgent, expiration-day, overdue and confirmation templates in %s',lang=>{const urgent=render(lang,'REMINDER','VISA','2028-03-30',14),normal=render(lang,'REMINDER','VISA','2028-03-30',21),final=render(lang,'REMINDER','VISA','2028-03-30',0);expect(urgent).not.toBe(normal);expect(final).not.toBe(normal);expect(render(lang,'CONFIRMATION','VISA','2029-03-30',365)).toContain('2029-03-30');expect(render(lang,'OVERDUE','VISA','2028-03-30',-1)).toContain('2028-03-30');});
  it('retains mock SMS for local tests',async()=>expect((await new MockSmsProvider().send('+998000000000','test','id')).state).toBe('MOCK'));
});
