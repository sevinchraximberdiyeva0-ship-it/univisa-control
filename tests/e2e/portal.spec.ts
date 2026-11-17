import {test,expect} from '@playwright/test';
import {authenticator} from 'otplib';
const password=process.env.E2E_STUDENT_PASSWORD!;
test('student signs in, sees only own documents, and opens renewal form',async({page})=>{
  await page.goto('/');await page.getByLabel('University email').fill('student1@example.invalid');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your university, within reach'})).toBeVisible();
  await page.getByRole('link',{name:'Visas & documents',exact:true}).click();await expect(page.getByRole('heading',{name:'Visas & documents'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Sample Student Alpha'})).toBeVisible();await expect(page.getByRole('heading',{name:'Sample Student Beta'})).toHaveCount(0);
  await page.getByRole('link',{name:'Submit a renewal'}).click();await expect(page.getByRole('dialog',{name:'Submit renewal for verification'})).toBeVisible();
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('link',{name:'Telegram bot',exact:true}).click();await page.getByRole('button',{name:'Generate secure linking token'}).click();await expect(page.locator('.secret')).toContainText('/start');
});
test('staff enrolls MFA, searches registry, and switches language on mobile',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');await page.getByLabel('University email').fill('admin@example.invalid');await page.getByLabel('Password',{exact:true}).fill(process.env.E2E_ADMIN_PASSWORD!);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Secure your staff account'})).toBeVisible();await page.getByRole('button',{name:'Set up authenticator'}).click();const secret=await page.locator('.secret').innerText();await page.getByLabel('Six-digit code').fill(authenticator.generate(secret));await page.getByRole('button',{name:'Verify and continue'}).click();
  await expect(page.getByRole('heading',{name:'International student overview'})).toBeVisible();await page.screenshot({path:'test-results/dashboard-desktop.png',fullPage:true});
  await page.getByRole('link',{name:'Students',exact:true}).click();await page.getByPlaceholder('Search students…').fill('Alpha');await expect(page.getByRole('link',{name:'Sample Student Alpha',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Sample Student Beta',exact:true})).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link',{name:'Notifications',exact:true}).click();await expect(page.getByRole('heading',{name:'Bildirishnomalar nazorati'})).toBeVisible();await page.getByRole('button',{name:'Xavfsiz simulator',exact:true}).click();await page.getByRole('button',{name:'Simulyatsiyani boshlash',exact:true}).click();await expect(page.getByRole('status')).toContainText('Haqiqiy xabarlar: 0');await expect(page.getByRole('status')).toContainText('Navbatga qo‘shilgan: 0');
  await page.getByRole('link',{name:'Students',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.getByLabel('Language').selectOption('uz');await expect(page.getByRole('heading',{name:'Talabalar',exact:true})).toBeVisible();await expect(page.locator('body')).toHaveJSProperty('scrollWidth',390);await page.screenshot({path:'test-results/students-mobile.png',fullPage:true});
});
test('student passkey login survives phone changes without entering a phone or student number',async({page,context})=>{
  const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
  const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  try{
    await page.goto('/');await page.getByLabel('University email').fill('student1@example.invalid');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('link',{name:'Profil va Face ID',exact:true}).click();
    const enrollment=page.locator('form').filter({has:page.getByLabel('Qurilma nomi')});
    await enrollment.getByLabel('Qurilma nomi').fill('Virtual test device');await enrollment.getByLabel('Joriy parol').fill(password);await enrollment.getByRole('button',{name:'Qurilma kalitini qo‘shish',exact:true}).click();
    await expect(page.getByText('Virtual test device',{exact:true})).toBeVisible();
    for(const phone of ['+998000000000','+998000000001']){
      const contact=page.locator('form').filter({has:page.getByLabel('Yangi telefon raqami')});await contact.getByLabel('Yangi telefon raqami').fill(phone);await contact.getByLabel('Joriy parol').fill(password);
      const result=page.waitForResponse(r=>r.url().endsWith('/api/auth/student-phone')&&r.request().method()==='PATCH');await contact.getByRole('button',{name:'Telefonni saqlash',exact:true}).click();expect((await result).status()).toBe(204);await expect(contact.getByLabel('Yangi telefon raqami')).toHaveValue('');
    }
    await page.locator('button.profile').click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
    const assertion=page.waitForRequest(r=>r.url().endsWith('/api/auth/passkeys/authentication/verify'));
    await page.getByRole('button',{name:'Face ID / qurilma kaliti bilan kirish',exact:true}).click();const captured=(await assertion).postDataJSON();
    await expect(page.getByRole('heading',{name:'Profil va Face ID',exact:true})).toBeVisible();
    expect((await (await page.request.get('/api/auth/me')).json()).user.email).toBe('student1@example.invalid');
    const replay=await page.request.post('/api/auth/passkeys/authentication/verify',{headers:{Origin:'http://localhost:5173'},data:captured});expect(replay.status()).toBe(400);
    await page.getByRole('link',{name:'Profil va Face ID',exact:true}).click();await expect(page.getByText('Virtual test device',{exact:true})).toBeVisible();
  }finally{await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId});}
});
test('ID/passport registration stays pending until university verification',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'ID / pasport bilan ro‘yxatdan o‘tish',exact:true}).click();
  const signup=page.locator('.identity-signup');await signup.getByRole('button',{name:'Fakultetlarni olish',exact:true}).click();
  await signup.getByLabel('F.I.Sh.',{exact:true}).fill('Synthetic Passport Applicant');await signup.getByLabel('Universitet talaba raqami',{exact:true}).fill('DEMO-IDENTITY-ONLY');await signup.getByLabel('Universitet emaili',{exact:true}).fill('identity-applicant@example.invalid');await signup.getByLabel('Yangi parol',{exact:true}).fill(process.env.E2E_STUDENT_PASSWORD!);
  await signup.getByLabel('Ta’lim dasturi',{exact:true}).fill('Testing');await signup.getByLabel('Guruh',{exact:true}).fill('TEST');await signup.getByLabel('Fuqarolik',{exact:true}).fill('Example');await signup.getByLabel('Hujjat bergan davlat kodi',{exact:true}).fill('UZ');await signup.getByLabel('ID / pasport raqami',{exact:true}).fill('SYNTHETIC0001');await signup.getByLabel('Tug‘ilgan sana',{exact:true}).fill('2000-01-01');await signup.getByLabel('Hujjat berilgan sana',{exact:true}).fill('2025-01-01');await signup.getByLabel('Hujjat tugash sanasi',{exact:true}).fill('2035-01-01');await signup.getByRole('checkbox').check();
  await signup.getByRole('button',{name:'Arizani yuborish',exact:true}).click();await expect(page.getByRole('heading',{name:'Shaxsni tekshirish kutilmoqda',exact:true})).toBeVisible();
  expect((await page.request.get('/api/students')).status()).toBe(403);await expect(page.getByText('Face ID / qurilma kalitlari',{exact:true})).toBeVisible();
});
