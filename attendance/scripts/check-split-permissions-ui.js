const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const prisma = require('../src/database/prisma');
const { createApp } = require('../src/app');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const master = await prisma.user.create({ data: { name: 'QA Master', role: 'ADMIN', email: `master-split-${process.pid}@teste.local`, passwordHash: await bcrypt.hash('teste-local-only', 4) } });
  const server = createApp({ channel: new Proxy({}, { get: () => async () => { throw new Error('Envio bloqueado no teste'); } }) }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let userId;
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('mibro-theme', 'dark'));
    assert.equal((await context.request.post(`${base}/api/auth/login`, { data: { email: master.email, password: 'teste-local-only' } })).status(), 200);
    const created = await context.request.post(`${base}/api/admin/users`, { data: { name: 'Teste separado', email: `user-split-${process.pid}@teste.local`, role: 'ATENDENTE', password: 'teste-local-only', canStartEmailConversations: true, canStartWhatsAppConversations: false } });
    assert.equal(created.status(), 201);
    const user = await created.json(); userId = user.id;
    assert.equal(user.canStartEmailConversations, true);
    assert.equal(user.canStartWhatsAppConversations, false);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator('#team-button:not([hidden])').waitFor();
    await page.locator('#team-button').click();
    await page.locator(`[data-edit-user="${userId}"]`).click();
    assert.equal(await page.locator('#permission-start-email-conversations').isChecked(), true);
    assert.equal(await page.locator('#permission-start-whatsapp-conversations').isChecked(), false);
    await page.locator('#permission-start-email-conversations').uncheck();
    await page.locator('#permission-start-whatsapp-conversations').check();
    const [saved] = await Promise.all([page.waitForResponse((r) => r.url().endsWith(`/api/admin/users/${userId}`) && r.request().method() === 'PATCH'), page.locator('#team-form button[type="submit"]').click()]);
    assert.equal(saved.status(), 200);
    const updated = await saved.json();
    assert.equal(updated.canStartEmailConversations, false);
    assert.equal(updated.canStartWhatsAppConversations, true);
    assert.deepEqual(errors, []);
    console.log('UI + API: criar, carregar e salvar permissões independentes aprovado.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await prisma.user.deleteMany({ where: { id: { in: [master.id, userId].filter(Boolean) } } });
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
