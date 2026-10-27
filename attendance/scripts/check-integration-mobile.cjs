// Functional browser regression against isolated, provider-blocked QA preview.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_RUNTIME || 'playwright');
const base = 'http://127.0.0.1:3341';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const auth = await browser.newContext();
    assert.equal((await auth.request.post(`${base}/api/auth/login`, { data: { email: 'bot-qa@teste.local', password: 'teste-local-bots' } })).status(), 200);
    const storageState = await auth.storageState();
    await auth.close();
    for (const width of [320, 360, 390, 430]) {
      const context = await browser.newContext({ storageState, viewport: { width, height: 800 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await page.locator('#conversation-list .conversation-card').first().waitFor();
      const onScreen = async selector => {
        await page.waitForFunction(selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return rect.width > 0 && rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1;
        }, selector, { timeout: 3000 });
        const rect = await page.locator(selector).boundingBox();
        assert.ok(rect && rect.width > 0 && rect.x >= -1 && rect.x + rect.width <= width + 1 && rect.y >= 0 && rect.y + rect.height <= 801, `${width}: ${selector} fora da tela: ${JSON.stringify(rect)}`);
      };
      await page.locator('#toggle-filters-panel').click();
      await onScreen('#close-mobile-filters');
      await page.locator('#filters-panel').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await onScreen('#close-mobile-filters');
      await page.locator('#close-mobile-filters').click();
      await page.waitForFunction(() => !document.querySelector('#filters-panel').classList.contains('mobile-open'));
      await page.locator('#sidebar-toggle').click();
      await page.locator('#app-sidebar.mobile-open').waitFor();
      await onScreen('#close-mobile-menu');
      await page.locator('#close-mobile-menu').click();
      await page.waitForFunction(() => !document.querySelector('#app-sidebar').classList.contains('mobile-open'));
      await page.locator('#conversation-list .conversation-card').first().click();
      await page.locator('#chat-panel.open').waitFor();
      await onScreen('#toggle-conversation-list');
      await onScreen('#mobile-chat-tools');
      await page.locator('#mobile-chat-tools').click();
      await page.locator('#category-select').waitFor({ state: 'visible' });
      await onScreen('#category-select');
      await page.locator('#mobile-chat-tools').click();
      await page.locator('#toggle-conversation-list').click();
      await page.waitForFunction(() => !document.querySelector('#chat-panel').classList.contains('open'));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: overflow horizontal`);
      assert.deepEqual(errors, []);
      console.log(`Mobile ${width}px: filtros/menu fecham, conversa volta, opções acessíveis, sem erro JS.`);
      await context.close();
    }
    for (const width of [1366, 390]) {
      const context = await browser.newContext({ storageState, viewport: { width, height: 900 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      for (const route of ['/bots', '/campaigns', '/quick-replies', '/integrations', '/operacao', '/custos-meta', '/configuracoes']) {
        const errors = [];
        const onError = error => errors.push(error.message);
        page.on('pageerror', onError);
        const response = await page.goto(`${base}${route}`);
        assert.equal(response.status(), 200, route);
        await page.waitForTimeout(500);
        assert.deepEqual(errors, [], `${width}: ${route}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: ${route} overflow horizontal`);
        page.off('pageerror', onError);
        console.log(`Tela ${route} ${width}px: sem erro JS ou overflow horizontal.`);
      }
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
