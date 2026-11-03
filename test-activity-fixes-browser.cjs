const { chromium } = require('playwright'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { client, credentials, seed } = require('./local-fixtures.cjs');
const a = 'http://127.0.0.1:4037', c = 'http://127.0.0.1:4038', results = [];
const dateKey = days => {
 const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() + days * 86400000)).map(p => [p.type, p.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
};
async function fixtures() {
 await seed();
 const db = client('attendance'), crm = client('crm');
 try {
  for (const [name, companyId, number] of [['mibro', 'cmp_mibro', '5511911112222'], ['sincrofit', 'cmp_sincrofit', '5511933334444']]) {
   await db.contact.upsert({ where: { id: 'review-activity-' + name }, create: { id: 'review-activity-' + name, companyId, channel: 'META', externalId: number, phone: number, name: 'Teste exclusivo ' + name }, update: {} });
   const data = { companyId, contactId: 'review-activity-' + name, assigneeId: 'merge-local-owner-a', createdById: 'merge-local-owner-a', reason: 'RETORNO_COMERCIAL', dueAt: new Date(Date.now() + 86400000), status: 'PENDENTE', note: 'FIXTURE_' + name.toUpperCase() + '_ONLY' };
   await db.followUp.upsert({ where: { id: 'review-followup-' + name }, create: { id: 'review-followup-' + name, ...data }, update: data });
  }
  for (const [id, allDay, day] of [['review-all-day', true, 3], ['review-duration', false, 4]]) {
   const data = { title: id === 'review-all-day' ? 'Teste — dia inteiro' : 'Teste — duração de 2 horas', type: 'VISITA', assignedToId: 'merge-local-owner-c', createdById: 'merge-local-owner-c', startsAt: new Date(dateKey(day) + (allDay ? 'T00:00:00-03:00' : 'T09:00:00-03:00')), endsAt: allDay ? null : new Date(dateKey(day) + 'T11:00:00-03:00'), allDay, status: 'PENDENTE', completedAt: null, cancelledAt: null };
   await crm.appointment.upsert({ where: { id }, create: { id, ...data }, update: data });
  }
  const teamItem = { companyId: 'cmp_mibro', contactId: 'review-activity-mibro', assigneeId: 'merge-local-a', createdById: 'merge-local-a', reason: 'POS_VENDA', dueAt: new Date(Date.now() + 86400000), status: 'PENDENTE', note: 'FIXTURE_TEAM_ONLY' };
  await db.followUp.upsert({ where: { id: 'review-team-only' }, create: { id: 'review-team-only', ...teamItem }, update: teamItem });
  await db.conversation.upsert({ where: { id: 'review-contact-card' }, create: { id: 'review-contact-card', companyId: 'cmp_mibro', contactId: 'review-activity-mibro', channel: 'META', status: 'AGUARDANDO_EQUIPE', assignedUserId: 'merge-local-owner-a' }, update: { status: 'AGUARDANDO_EQUIPE', assignedUserId: 'merge-local-owner-a' } });
  const message = { conversationId: 'review-contact-card', direction: 'RECEBIDA', status: 'RECEBIDA', type: 'contacts', text: '[contacts]', occurredAt: new Date(), rawPayload: { type: 'contacts', contacts: [{ name: { formatted_name: 'Contato compartilhado de demonstração' }, phones: [{ phone: '+55 (11) 98888-7777', type: 'CELL' }] }] } };
  await db.message.upsert({ where: { id: 'review-contact-message' }, create: { id: 'review-contact-message', ...message }, update: message });
 } finally { await db.$disconnect(); await crm.$disconnect(); }
}
async function main() {
 await fixtures();
 const browser = await chromium.launch({ channel: 'msedge', headless: true }), ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 900 } });
 await ctx.route('**/*', route => { const url = route.request().url(); return url.startsWith(a + '/') || url.startsWith(c + '/') ? route.continue() : route.abort(); });
 const csrf = await (await ctx.request.get(c + '/api/auth/csrf')).json();
 await ctx.request.post(c + '/api/auth/callback/credentials', { form: { email: credentials.ownerEmail, password: credentials.password, csrfToken: csrf.csrfToken, callbackUrl: c + '/dashboard' }, headers: { 'X-Auth-Return-Redirect': '1' } });
 assert.ok((await (await ctx.request.get(c + '/api/auth/session')).json()).user);
 const attendanceLogin = await ctx.request.post(a + '/api/auth/login', { data: { email: credentials.ownerEmail, password: credentials.password } });
 if (attendanceLogin.status() !== 200) { await ctx.close(); await browser.close(); throw Error('Local Attendance login failed: ' + attendanceLogin.status()); }
 const page = await ctx.newPage(); page.setDefaultTimeout(45000);
 async function check(name, fn) { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
 try {
  await check('company switch hides old rows immediately, including failed requests', async () => {
   await page.goto(c + '/central-activities?company=mibro'); await page.getByText('FIXTURE_MIBRO_ONLY', { exact: true }).waitFor({ timeout: 90000 });
   let release; const gate = new Promise(resolve => { release = resolve; });
   await page.route('**/api/activity-center?**', async route => { if (new URL(route.request().url()).searchParams.get('company') !== 'sincrofit') return route.continue(); await gate; await route.fulfill({ status: 503, json: { error: 'Falha sintética de troca de empresa' } }); });
   const select = page.getByLabel('Empresa do Atendimento'); await select.selectOption('sincrofit');
   await page.waitForFunction(() => !document.body.innerText.includes('FIXTURE_MIBRO_ONLY'));
   assert.equal(await page.getByText('FIXTURE_MIBRO_ONLY', { exact: true }).count(), 0);
   release(); await page.getByRole('alert').filter({ hasText: 'Falha sintética' }).waitFor();
   assert.equal(await page.getByText('FIXTURE_MIBRO_ONLY', { exact: true }).count(), 0);
   await page.unroute('**/api/activity-center?**'); await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
   await page.getByText('FIXTURE_SINCROFIT_ONLY', { exact: true }).waitFor(); assert.equal(await page.getByText('FIXTURE_MIBRO_ONLY', { exact: true }).count(), 0);
  });
  await check('whole-day CRM appointment remains whole-day through the real screen/API', async () => {
   const row = page.getByRole('listitem').filter({ hasText: 'Teste — dia inteiro' }); await row.getByRole('button', { name: 'Reagendar', exact: true }).click();
   assert.equal(await row.locator('input[type=time]').count(), 0); await row.getByLabel('Data', { exact: true }).fill(dateKey(6));
   await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/agenda/review-all-day') && r.request().method() === 'PATCH' && r.status() === 200), row.getByRole('button', { name: 'Salvar', exact: true }).click()]);
   const db = client('crm'); try { const item = await db.appointment.findUnique({ where: { id: 'review-all-day' } }); assert.equal(item.allDay, true); assert.equal(item.endsAt, null); assert.equal(item.startsAt.toISOString(), dateKey(6) + 'T03:00:00.000Z'); } finally { await db.$disconnect(); }
  });
  await check('late company response cannot paint over the newly selected workspace', async () => {
   const select = page.getByLabel('Empresa do Atendimento'); await select.selectOption('mibro'); await page.getByText('FIXTURE_MIBRO_ONLY', { exact: true }).waitFor();
   const other = await (await ctx.request.get(c + '/api/activity-center?company=sincrofit&scope=mine')).json();
   let release; const gate = new Promise(resolve => { release = resolve; });
   await page.route('**/api/activity-center?**', async route => { if (new URL(route.request().url()).searchParams.get('company') !== 'sincrofit') return route.continue(); await gate; await route.fulfill({ json: other }).catch(() => {}); });
   await select.selectOption('sincrofit'); await page.waitForFunction(() => !document.body.innerText.includes('FIXTURE_MIBRO_ONLY'));
   await select.selectOption('mibro'); await page.getByText('FIXTURE_MIBRO_ONLY', { exact: true }).waitFor(); release(); await page.waitForTimeout(150);
   assert.equal(await page.getByText('FIXTURE_SINCROFIT_ONLY', { exact: true }).count(), 0); await page.unroute('**/api/activity-center?**');
  });
  await check('switching team to mine immediately removes other assignees', async () => {
   await page.getByRole('button', { name: 'Equipe', exact: true }).click(); await page.getByText('FIXTURE_TEAM_ONLY', { exact: true }).waitFor();
   await page.getByRole('button', { name: 'Minhas', exact: true }).click(); await page.waitForFunction(() => !document.body.innerText.includes('FIXTURE_TEAM_ONLY'));
   assert.equal(await page.getByText('FIXTURE_TEAM_ONLY', { exact: true }).count(), 0);
   await page.getByText('FIXTURE_MIBRO_ONLY', { exact: true }).waitFor();
  });
  await check('timed CRM appointment retains its two-hour duration after rescheduling', async () => {
   const row = page.getByRole('listitem').filter({ hasText: 'Teste — duração de 2 horas' }); await row.getByRole('button', { name: 'Reagendar', exact: true }).click(); await row.getByLabel('Data', { exact: true }).fill(dateKey(7)); await row.getByLabel('Horário', { exact: true }).fill('10:30');
   await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/agenda/review-duration') && r.request().method() === 'PATCH' && r.status() === 200), row.getByRole('button', { name: 'Salvar', exact: true }).click()]);
   const db = client('crm'); try { const item = await db.appointment.findUnique({ where: { id: 'review-duration' } }); assert.equal(item.allDay, false); assert.equal(item.endsAt - item.startsAt, 7200000); } finally { await db.$disconnect(); }
  });
  await check('desktop, narrow desktop and mobile activity layouts do not overflow', async () => {
   await page.getByRole('button', { name: 'Atualizar', exact: true }).waitFor({ state: 'visible' });
   for (const width of [1366, 900, 768, 390, 360]) { await page.setViewportSize({ width, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'overflow at ' + width); }
   await page.screenshot({ path: path.join(__dirname, 'preview-activity-fixed-mobile.png'), fullPage: true });
  });
  await check('shared contact hotfix and Minhas survive the CRM integration', async () => {
   await page.setViewportSize({ width: 1366, height: 900 }); await page.goto(a + '/?conversation=review-contact-card'); await page.waitForFunction(() => !!window.CentralWorkspace?.current());
   await page.evaluate(async () => { await window.CentralWorkspace.switchTo('mibro'); });
   // A workspace switch deliberately clears selection, so reopen via its normal deep link.
   await page.goto(a + '/?conversation=review-contact-card'); await page.locator('.shared-contact-card strong').filter({ hasText: 'Contato compartilhado de demonstração' }).waitFor();
   assert.equal(await page.locator('.shared-contact-card a[href="tel:+5511988887777"]').count(), 1);
   assert.equal(await page.locator('button[data-status="MINE"]').count(), 1);
   await page.screenshot({ path: path.join(__dirname, 'preview-integrated-contact-card.png') });
  });
  await check('main Attendance mobile header and contact card remain usable', async () => {
   for (const width of [900, 390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: path.join(__dirname, 'preview-integrated-main-' + width + '.png') });
    const overflow = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth > innerWidth, nodes: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(el).visibility !== 'hidden'; }).slice(0, 15).map(el => ({ id: el.id, tag: el.tagName, class: el.className, right: Math.round(el.getBoundingClientRect().right) })) }));
    assert.equal(overflow.wide, false, 'Attendance horizontal overflow at ' + width + ': ' + JSON.stringify(overflow.nodes));
    await page.locator('.central-integration-menu > summary').click();
    const activities = page.getByRole('button', { name: 'Atividades', exact: true });
    assert.equal(await activities.isVisible(), true); const bounds = await activities.boundingBox(); await page.screenshot({ path: path.join(__dirname, 'preview-integrated-menu-' + width + '.png') }); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'Atividades button outside viewport at ' + width + ': ' + JSON.stringify(bounds));
    await page.keyboard.press('Escape');
   }
   const originalTheme=await page.locator('html').getAttribute('data-theme');
   await page.locator('.central-integration-menu > summary').click(); await page.locator('#theme-toggle').click();
   assert.notEqual(await page.locator('html').getAttribute('data-theme'),originalTheme);
   assert.equal(await page.locator('.shared-contact-card strong').filter({hasText:'Contato compartilhado de demonstração'}).count(),1);
   await page.screenshot({ path: path.join(__dirname, 'preview-integrated-main-mobile.png') });
  });
 } finally { await ctx.close(); await browser.close(); fs.writeFileSync(path.join(__dirname, 'activity-fixes-browser-results.json'), JSON.stringify({ at: new Date(), results }, null, 2)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
