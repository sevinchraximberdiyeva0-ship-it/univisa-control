import {test,expect,type Page} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import bcrypt from 'bcryptjs';
import {authenticator} from 'otplib';
import {readFile} from 'node:fs/promises';
const password=process.env.E2E_STUDENT_PASSWORD!;

async function passwordSignIn(page:Page,email:string,password:string,entry:'setup'|'staff'='setup'){
  const button=entry==='staff'?'Staff sign-in':'Set up a device key for the first time';
  await page.getByRole('button',{name:button,exact:true}).click();
  await page.getByLabel('University email').fill(email);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
}

async function enrollStaffMfa(page:Page){
  await expect(page.getByRole('heading',{name:'Secure your staff account'})).toBeVisible();
  await page.getByRole('button',{name:'Set up authenticator'}).click();
  const secret=await page.locator('.secret').innerText();
  await page.getByLabel('Six-digit code').fill(authenticator.generate(secret));
  await page.getByRole('button',{name:'Verify and continue'}).click();
  await expect(page.getByRole('heading',{name:'International student overview'})).toBeVisible();
}
test('student signs in, sees only own documents, and opens renewal form',async({page})=>{
  await page.goto('/');await passwordSignIn(page,'student1@example.invalid',password);
  await expect(page.getByRole('heading',{name:'Profile and Face ID'})).toBeVisible();
  await page.getByRole('link',{name:'Overview',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your university, within reach'})).toBeVisible();
  await page.getByRole('link',{name:'Visas & documents',exact:true}).click();await expect(page.getByRole('heading',{name:'Visas & documents'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Sample Student Alpha'})).toBeVisible();await expect(page.getByRole('heading',{name:'Sample Student Beta'})).toHaveCount(0);
  await page.getByRole('link',{name:'Submit a renewal'}).click();await expect(page.getByRole('dialog',{name:'Submit renewal for verification'})).toBeVisible();
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('link',{name:'Telegram bot',exact:true}).click();await page.getByRole('button',{name:'Generate secure linking token'}).click();await expect(page.locator('.secret')).toContainText('/start');
});
test('staff enrolls MFA, searches registry, and switches language on mobile',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');await passwordSignIn(page,'admin@example.invalid',process.env.E2E_ADMIN_PASSWORD!,'staff');
  await enrollStaffMfa(page);
  await page.screenshot({path:'test-results/dashboard-desktop.png',fullPage:true});
  await page.getByRole('link',{name:'Students',exact:true}).click();await page.getByPlaceholder('Search students…').fill('Alpha');await expect(page.getByRole('link',{name:'Sample Student Alpha',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Sample Student Beta',exact:true})).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link',{name:'Notifications',exact:true}).click();await expect(page.getByRole('heading',{name:'Bildirishnomalar nazorati'})).toBeVisible();await page.getByRole('button',{name:'Xavfsiz simulator',exact:true}).click();await page.getByRole('button',{name:'Simulyatsiyani boshlash',exact:true}).click();await expect(page.getByRole('status')).toContainText('Haqiqiy xabarlar: 0');await expect(page.getByRole('status')).toContainText('Navbatga qo‘shilgan: 0');
  await page.getByRole('link',{name:'Students',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.getByLabel('Language').selectOption('uz');await expect(page.getByRole('heading',{name:'Talabalar',exact:true})).toBeVisible();await expect(page.locator('body')).toHaveJSProperty('scrollWidth',390);await page.screenshot({path:'test-results/students-mobile.png',fullPage:true});
});
test('the student can sign in with a passkey after phone changes without entering identifiers',async({page,context,baseURL})=>{
  const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
  const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  try{
    await page.goto('/');
    const passkeySignIn=page.getByRole('button',{name:'Sign in with Face ID or a passkey',exact:true});
    await expect(passkeySignIn).toBeVisible();
    await expect(page.getByLabel('University email')).toHaveCount(0);
    await expect(page.getByLabel('University code',{exact:true})).toHaveCount(0);
    await expect(page.getByLabel('Password',{exact:true})).toHaveCount(0);
    await expect(page.locator('input[type="tel"]')).toHaveCount(0);
    await passwordSignIn(page,'student1@example.invalid',password);
    await expect(page.getByRole('heading',{name:'Profile and Face ID',exact:true})).toBeVisible();
    const enrollment=page.locator('form').filter({has:page.getByLabel('Qurilma nomi')});
    await enrollment.getByLabel('Qurilma nomi').fill('Virtual test device');await enrollment.getByLabel('Joriy parol').fill(password);await enrollment.getByRole('button',{name:'Qurilma kalitini qo‘shish',exact:true}).click();
    await expect(page.getByText('Virtual test device',{exact:true})).toBeVisible();
    for(const phone of ['+998000000000','+998000000001']){
      const contact=page.locator('form').filter({has:page.getByLabel('Yangi telefon raqami')});await contact.getByLabel('Yangi telefon raqami').fill(phone);await contact.getByLabel('Joriy parol').fill(password);
      const result=page.waitForResponse(r=>r.url().endsWith('/api/auth/student-phone')&&r.request().method()==='PATCH');await contact.getByRole('button',{name:'Telefonni saqlash',exact:true}).click();expect((await result).status()).toBe(204);await expect(contact.getByLabel('Yangi telefon raqami')).toHaveValue('');
    }
    await page.locator('button.profile').click();await expect(passkeySignIn).toBeVisible();
    await expect(page.getByLabel('University email')).toHaveCount(0);
    const assertion=page.waitForRequest(r=>r.url().endsWith('/api/auth/passkeys/authentication/verify'));
    await passkeySignIn.click();const captured=(await assertion).postDataJSON();
    await expect(page.getByRole('heading',{name:'Profile and Face ID',exact:true})).toBeVisible();
    expect((await (await page.request.get('/api/auth/me')).json()).user.email).toBe('student1@example.invalid');
    const replay=await page.request.post('/api/auth/passkeys/authentication/verify',{headers:{Origin:new URL(baseURL!).origin},data:captured});expect(replay.status()).toBe(400);
    await page.getByRole('link',{name:'Profile and Face ID',exact:true}).click();await expect(page.getByText('Virtual test device',{exact:true})).toBeVisible();
  }finally{await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId});}
});
test('a rejected passport application can be corrected and approved in the same student account',async({page,browser,baseURL})=>{
  const databaseUrl=process.env.E2E_DATABASE_URL;
  if(!databaseUrl)throw new Error('Run this test via npm run test:e2e to provision its disposable database');
  const officerEmail='passport-reviewer@example.invalid';
  const officerPassword=process.env.E2E_ADMIN_PASSWORD!;
  const db=new PrismaClient({datasourceUrl:databaseUrl});
  try{
    const university=await db.university.findUniqueOrThrow({where:{slug:'demo'},select:{id:true}});
    await db.user.create({data:{universityId:university.id,email:officerEmail,name:'Synthetic Passport Reviewer',role:'INTERNATIONAL_OFFICE',passwordHash:await bcrypt.hash(officerPassword,12)}});
    const faculty=await db.faculty.findFirstOrThrow({where:{universityId:university.id},select:{id:true}});
    const earlierApplicants=await db.student.createManyAndReturn({data:Array.from({length:25},(_,index)=>({
      universityId:university.id,facultyId:faculty.id,studentNumber:`PAGE-FIXTURE-${index}`,fullName:`Verified Example ${index}`,
      program:'Testing',year:1,group:'TEST',nationality:'Example',email:`page-${index}@example.invalid`,
    })),select:{id:true,studentNumber:true}});
    const previousReview=new Date('2025-02-01T00:00:00Z');
    await db.studentIdentity.createMany({data:earlierApplicants.map(student=>({
      universityId:university.id,studentId:student.id,status:'VERIFIED',numberLast4:'0000',fingerprint:student.studentNumber,
      encryptedDetails:'unused-by-list-fixture',consentAt:previousReview,updatedAt:previousReview,
    }))});
  }finally{
    await db.$disconnect();
  }

  await page.clock.install();
  await page.goto('/talaba/');
  await page.getByRole('button',{name:'ID / pasport bilan ro‘yxatdan o‘tish',exact:true}).click();
  const signup=page.locator('.identity-signup');await signup.getByRole('button',{name:'Fakultetlarni olish',exact:true}).click();
  await signup.getByLabel('F.I.Sh.',{exact:true}).fill('Synthetic Passport Applicant');await signup.getByLabel('Universitet talaba raqami',{exact:true}).fill('DEMO-IDENTITY-ONLY');await signup.getByLabel('Universitet emaili',{exact:true}).fill('identity-applicant@example.invalid');await signup.getByLabel('Yangi parol',{exact:true}).fill(process.env.E2E_STUDENT_PASSWORD!);
  await signup.getByLabel('Ta’lim dasturi',{exact:true}).fill('Testing');await signup.getByLabel('Guruh',{exact:true}).fill('TEST');await signup.getByLabel('Fuqarolik',{exact:true}).fill('Example');await signup.getByLabel('Hujjat bergan davlat kodi',{exact:true}).fill('UZ');await signup.getByLabel('ID / pasport raqami',{exact:true}).fill('SYNTHETIC0001');await signup.getByLabel('Tug‘ilgan sana',{exact:true}).fill('2000-01-01');await signup.getByLabel('Hujjat berilgan sana',{exact:true}).fill('2025-01-01');await signup.getByLabel('Hujjat tugash sanasi',{exact:true}).fill('2035-01-01');await signup.getByRole('checkbox').check();
  await signup.getByRole('button',{name:'Arizani yuborish',exact:true}).click();await expect(page.getByRole('heading',{name:'Shaxsni tekshirish kutilmoqda',exact:true})).toBeVisible();
  expect((await page.request.get('/api/documents')).status()).toBe(403);
  await expect(page.getByText('Face ID / qurilma kalitlari',{exact:true})).toBeVisible();

  const officerContext=await browser.newContext({baseURL});
  let recoveryLink='';
  try{
    const officer=await officerContext.newPage();
    await officer.goto('/');
    await passwordSignIn(officer,officerEmail,officerPassword,'staff');
    await expect(officer.getByRole('heading',{name:'Secure your staff account'})).toBeVisible();
    expect((await officer.request.get('/api/identity/applications')).status()).toBe(403);
    await enrollStaffMfa(officer);

    const queue=officer.getByRole('link',{name:/Applications awaiting identity review/});
    await expect(queue).toContainText('1');
    await officer.screenshot({path:'test-results/staff-admissions.png',fullPage:true});
    await queue.click();
    await expect(officer).toHaveURL(/\/identity\?status=SUBMITTED$/);
    const application=officer.getByRole('row').filter({hasText:'DEMO-IDENTITY-ONLY'});
    const statusFilter=officer.getByRole('combobox',{name:'Filter by status'});
    await expect(statusFilter).toHaveValue('SUBMITTED');
    await statusFilter.selectOption('');
    await expect(officer.getByText('Page 1 of 2',{exact:true})).toBeVisible();
    await officer.getByRole('button',{name:'Next page'}).click();
    await expect(officer.getByText('Page 2 of 2',{exact:true})).toBeVisible();
    await expect(application).toHaveCount(0);
    await officer.getByRole('button',{name:'Previous page'}).click();
    await expect(officer.getByText('Page 1 of 2',{exact:true})).toBeVisible();
    await statusFilter.selectOption('SUBMITTED');
    await expect(application).toContainText('****0001');
    await expect(application).toContainText('Pending review');
    await application.getByRole('button',{name:'Review document'}).click();
    await expect(officer.getByText('SYNTHETIC0001',{exact:true})).toBeVisible();
    const rejectionNotes='The submitted document number differs from the original synthetic document.';
    await officer.getByLabel('Qaror').selectOption('REJECTED');
    await officer.getByLabel('Tekshiruv qaydlari').fill(rejectionNotes);
    await officer.getByRole('checkbox',{name:'Asl ID/pasport va talabaning shaxsini tekshirdim.'}).check();
    await officer.getByRole('button',{name:'Qarorni saqlash'}).click();
    await expect(officer.getByText('No matching applications.')).toBeVisible();
    await expect(officer.getByRole('link',{name:'ID / passport review',exact:true}).locator('.identity-queue-count')).toHaveCount(0);
    await statusFilter.selectOption('REJECTED');
    await expect(application).toContainText('Rejected');

    await page.clock.fastForward(31_000);
    await expect(page.getByRole('heading',{name:'ID / pasport arizasi rad etildi'})).toBeVisible();
    await expect(page.getByText(rejectionNotes,{exact:true})).toBeVisible();
    const correction=page.locator('form').filter({has:page.getByLabel('ID / pasport raqami',{exact:true})});
    await correction.getByLabel('Hujjat bergan davlat kodi').fill('UZ');
    await correction.getByLabel('ID / pasport raqami',{exact:true}).fill('SYNTHETIC0002');
    await correction.getByLabel('Tug‘ilgan sana').fill('2000-01-01');
    await correction.getByLabel('Hujjat berilgan sana').fill('2025-01-01');
    await correction.getByLabel('Hujjat tugash sanasi').fill('2035-01-01');
    await correction.getByRole('checkbox').check();
    await correction.getByRole('button',{name:'Arizani qayta yuborish'}).click();
    await expect(page.getByRole('heading',{name:'Shaxsni tekshirish kutilmoqda'})).toBeVisible();
    expect((await page.request.get('/api/documents')).status()).toBe(403);

    await statusFilter.selectOption('SUBMITTED');
    await expect(application).toContainText('****0002');
    await expect(application).toContainText('Pending review');
    await application.getByRole('button',{name:'Review document'}).click();
    await expect(officer.getByText('SYNTHETIC0002',{exact:true})).toBeVisible();
    await officer.getByLabel('Qaror').selectOption('VERIFIED');
    await officer.getByLabel('Tekshiruv qaydlari').fill('Corrected synthetic document matches the original.');
    await officer.getByRole('checkbox',{name:'Asl ID/pasport va talabaning shaxsini tekshirdim.'}).check();
    await officer.getByRole('button',{name:'Qarorni saqlash'}).click();
    await expect(officer.getByText('No matching applications.')).toBeVisible();
    await statusFilter.selectOption('VERIFIED');
    await expect(application).toContainText('Verified');
    await application.getByRole('button',{name:'Review document'}).click();
    await officer.getByRole('checkbox',{name:'I checked the student’s identity in person against the original document.'}).check();
    await officer.getByRole('button',{name:'Create recovery link',exact:true}).click();
    const link=officer.getByLabel('Single-use recovery link');
    await expect(link).toHaveValue(/#\/recover\?code=[a-f0-9]{64}$/);
    recoveryLink=await link.inputValue();
  }finally{
    await officerContext.close();
  }

  await page.clock.fastForward(31_000);
  await expect(page.getByRole('heading',{name:'Emailni tasdiqlash'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Shaxsni tekshirish kutilmoqda'})).toHaveCount(0);
  expect((await page.request.get('/api/documents')).status()).toBe(403);
  await page.getByRole('button',{name:'Kod yuborish'}).click();
  await expect(page.getByText('Kod yuborildi. Emailingizni tekshiring.')).toBeVisible();
  const outbox=await readFile(process.env.E2E_EMAIL_OUTBOX!,'utf8');
  const message=outbox.trim().split('\n').map(line=>JSON.parse(line)).find(mail=>mail.to.includes('identity-applicant@example.invalid'));
  const code=message?.text.match(/\b\d{8}\b/)?.[0];
  expect(code).toBeDefined();
  await page.getByLabel('8 xonali kod').fill(code!);
  await page.getByRole('button',{name:'Emailni tasdiqlash'}).click();
  await expect(page.getByRole('heading',{name:'Synthetic Passport Applicant',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Talaba menyusi'}).getByRole('link',{name:'Hujjatlar',exact:true}).click();
  await expect(page.getByText('No matching document records.')).toBeVisible();
  const documents=await page.request.get('/api/documents');
  expect(documents.status()).toBe(200);
  expect(await documents.json()).toEqual([]);

  await page.getByRole('button',{name:'Chiqish',exact:true}).click();
  await page.getByRole('button',{name:'Qurilma kalitini birinchi marta sozlash',exact:true}).click();
  await page.getByText('Pasport / ID orqali kirish',{exact:true}).click();
  const passportLogin=page.locator('.passport-login');
  await passportLogin.getByLabel('Universitet kodi',{exact:true}).fill('demo');
  await passportLogin.getByLabel('ID / pasport raqami',{exact:true}).fill('synthetic-0002');
  await passportLogin.getByRole('button',{name:'Kirish kodini yuborish'}).click();
  await expect(passportLogin.getByRole('status')).toContainText('tasdiqlangan emailga');
  let signInCode:string|undefined;
  await expect.poll(async()=>{
    const mail=await readFile(process.env.E2E_EMAIL_OUTBOX!,'utf8');
    const signIn=mail.trim().split('\n').map(line=>JSON.parse(line)).find(entry=>entry.subject==='UniVisa Control kirish kodi');
    signInCode=signIn?.text.match(/\b\d{8}\b/)?.[0];
    return signInCode;
  }).toMatch(/^\d{8}$/);
  await passportLogin.getByLabel('8 xonali kirish kodi').fill(signInCode!);
  await passportLogin.getByRole('button',{name:'Kirish',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Profil va Face ID'})).toBeVisible();
  expect((await (await page.request.get('/api/auth/me')).json()).user.email).toBe('identity-applicant@example.invalid');

  const replacement=await browser.newContext({baseURL});
  try{
    const recovered=await replacement.newPage();
    const cdp=await replacement.newCDPSession(recovered);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
    await recovered.goto(recoveryLink);
    await expect(recovered.getByRole('heading',{name:'Akkauntni tiklash'})).toBeVisible();
    await expect(recovered).toHaveURL(/#\/recover$/);
    await expect(recovered.getByLabel('Tiklash kodi')).toHaveValue(/^[a-f0-9]{64}$/);
    const newPassword='Demo replacement device 2026!';
    await recovered.getByLabel('Yangi parol',{exact:true}).fill(newPassword);
    await recovered.getByLabel('Parolni takrorlang',{exact:true}).fill(newPassword);
    await recovered.getByRole('button',{name:'Akkauntni tiklash',exact:true}).click();
    await expect(recovered.getByRole('heading',{name:'Profil va Face ID'})).toBeVisible();
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    const enrollment=recovered.locator('form').filter({has:recovered.getByLabel('Qurilma nomi')});
    await enrollment.getByLabel('Qurilma nomi').fill('Replacement device');
    await enrollment.getByLabel('Joriy parol').fill(newPassword);
    await enrollment.getByRole('button',{name:'Qurilma kalitini qo‘shish'}).click();
    await expect(recovered.getByText('Replacement device',{exact:true})).toBeVisible();
    await recovered.getByRole('button',{name:'Chiqish',exact:true}).click();
    await recovered.getByRole('button',{name:'Face ID / qurilma kaliti bilan kirish',exact:true}).click();
    await expect(recovered.getByRole('heading',{name:'Profil va Face ID'})).toBeVisible();
  }finally{await replacement.close();}
});

test('portal and notification languages can be selected independently',async({page})=>{
  await page.goto('/');
  const portalLanguage=page.getByRole('combobox');
  await expect(portalLanguage.getByRole('option')).toHaveText(['O‘zbekcha','Türkmençe','English','Русский','한국어','简体中文']);
  await portalLanguage.selectOption('tk');
  await expect(page.getByRole('heading',{name:'Hoş geldiňiz'})).toBeVisible();
  await portalLanguage.selectOption('ko');
  await expect(page.getByRole('button',{name:'Face ID 또는 패스키로 로그인',exact:true})).toBeVisible();
  await portalLanguage.selectOption('zh');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','zh');
  await expect(page.getByRole('heading',{name:'欢迎回来'})).toBeVisible();
  await page.getByRole('button',{name:'首次设置设备密钥',exact:true}).click();
  await page.getByLabel('大学邮箱').fill('student1@example.invalid');
  await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('link',{name:'个人资料和 Face ID',exact:true}).click();
  const notificationLanguage=page.getByRole('combobox',{name:'通知语言',exact:true});
  await notificationLanguage.selectOption('ko');
  await page.getByRole('button',{name:'保存更改',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('通知语言已保存。');
  await page.reload();
  await expect(notificationLanguage).toHaveValue('ko');
  await expect(page.locator('html')).toHaveAttribute('lang','zh');
});

test('the student app offers installation across device types',async({page})=>{
  await page.setViewportSize({width:320,height:700});
  await page.addInitScript(()=>{
    localStorage.setItem('uv-language','en');
    window.addEventListener('beforeinstallprompt',event=>{
      if(event.isTrusted){event.preventDefault();event.stopImmediatePropagation();}
    },{capture:true});
  });
  await page.goto('/talaba/');
  const install=page.getByRole('button',{name:'Install app',exact:true});
  const guide=page.getByRole('dialog',{name:'Install app'});
  await install.click();
  await expect(guide).toBeVisible();
  for(const device of ['iPhone / iPad','Android','Windows / Linux / Chromebook','Mac']){
    await expect(guide.getByText(device,{exact:true})).toBeVisible();
  }
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth',320);
  await guide.getByRole('button',{name:'Close',exact:true}).click();
  await expect(install).toBeFocused();

  const offerInstall=async(outcome:'dismissed'|'accepted')=>page.evaluate(value=>{
    const event=new Event('beforeinstallprompt',{cancelable:true});
    Object.assign(event,{
      prompt:async()=>{document.documentElement.dataset.promptOutcome=value;},
      userChoice:Promise.resolve({outcome:value}),
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  },outcome);
  expect(await offerInstall('dismissed')).toBe(true);
  await install.click();
  await expect(page.locator('html')).toHaveAttribute('data-prompt-outcome','dismissed');
  await expect(install).toBeVisible();
  await expect(guide).toBeHidden();
  await install.click();
  await expect(guide).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await offerInstall('accepted')).toBe(true);
  await install.click();
  await expect(page.locator('html')).toHaveAttribute('data-prompt-outcome','accepted');
  await expect(install).toHaveCount(0);

  await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true,configurable:true}));
  await page.reload();
  await expect(page.getByRole('button',{name:'Sign in with Face ID or a passkey'})).toBeVisible();
  await expect(install).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Staff sign-in'})).toBeVisible();
  await expect(install).toHaveCount(0);
});

test('the student app sends a renewal to the same university console',async({page,browser,baseURL})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>localStorage.setItem('uv-language','en'));
  await page.goto('/talaba/');
  await expect(page).toHaveTitle('UniVisa Talaba');
  await expect(page.getByRole('button',{name:'Sign in with Face ID or a passkey'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Staff sign-in'})).toHaveCount(0);
  const manifest=await page.request.get('/talaba/manifest.webmanifest');
  expect(await manifest.json()).toMatchObject({start_url:'/talaba/',scope:'/talaba/',display:'standalone'});
  await expect.poll(()=>page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.getRegistration('/talaba/');
    return registration?.active?.state;
  })).toBe('activated');

  await passwordSignIn(page,'student1@example.invalid',password);
  const navigation=page.getByRole('navigation',{name:'Student navigation'});
  await expect(page.getByRole('heading',{name:'Profile and Face ID'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Install app',exact:true})).toBeVisible();
  await navigation.getByRole('link',{name:'Home',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sample Student Alpha',exact:true})).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth',390);
  await page.getByRole('link',{name:'Expiry calendar',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Expiration calendar',exact:true})).toBeVisible();
  await navigation.getByRole('link',{name:'Documents',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sample Student Alpha',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Sample Student Beta',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'Submit a renewal'}).click();
  const form=page.getByRole('dialog',{name:'Submit renewal for verification'});
  await form.getByLabel('Issue date',{exact:true}).fill('2034-01-12');
  await form.getByLabel('New expiration date',{exact:true}).fill('2035-01-12');
  await form.locator('input[type=file]').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nSynthetic renewal attachment\n%%EOF')});
  await form.getByRole('button',{name:'Submit for review'}).click();
  await expect(page.getByRole('row').filter({hasText:'2035-01-12'})).toContainText('SUBMITTED');

  const db=new PrismaClient({datasourceUrl:process.env.E2E_DATABASE_URL!});
  const officerEmail='student-app-reviewer@example.invalid';
  try{
    const university=await db.university.findUniqueOrThrow({where:{slug:'demo'},select:{id:true}});
    await db.user.create({data:{universityId:university.id,email:officerEmail,name:'Student App Reviewer',role:'INTERNATIONAL_OFFICE',passwordHash:await bcrypt.hash(password,12)}});
  }finally{await db.$disconnect();}
  const staff=await browser.newContext({baseURL});
  try{
    const officer=await staff.newPage();
    await officer.goto('/');
    await passwordSignIn(officer,officerEmail,password,'staff');
    await enrollStaffMfa(officer);
    await officer.getByRole('link',{name:'Renewal applications',exact:true}).click();
    const row=officer.getByRole('row').filter({hasText:'2035-01-12'});
    await expect(row).toContainText('Sample Student Alpha');
    await expect(row.getByRole('button',{name:'Review',exact:true})).toBeVisible();
    await officer.goto('/talaba/');
    await expect(officer.locator('.student-content')).toBeVisible();
    await expect(officer.locator('.student-tabs')).toHaveCount(0);
  }finally{await staff.close();}
});
