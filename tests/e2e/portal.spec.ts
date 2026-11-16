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
