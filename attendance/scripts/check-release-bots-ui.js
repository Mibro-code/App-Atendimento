const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext();
    assert.equal((await context.request.post("http://127.0.0.1:3340/api/auth/login", { data: { email: "release-bot-qa@teste.local", password: "teste-local-bots" } })).status(), 200);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => { errors.push(error.message); console.error("UI_ERROR:", error.message); });
    page.on("response", async (response) => { if (response.status() >= 400) console.error("HTTP_ERROR:", response.status(), new URL(response.url()).pathname, (await response.text()).slice(0, 350)); });
    for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 680, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size); await page.goto("http://127.0.0.1:3340/bots.html");
      await page.locator("#editor:not([hidden])").waitFor();
      assert.deepEqual(await page.locator(".workspace-tabs button").allTextContents(), ["Geral", "Disponibilidade", "Qualidade", "Simulador", "Observação"]);
      for (const tab of ["bot", "availability", "quality", "simulator", "observation"]) {
        await page.locator('[data-tab="' + tab + '"]').click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      }
    }
    await page.locator(".bot-card").filter({ hasText: "Triagem Inicial" }).click();
    await page.waitForFunction(() => document.querySelector("#editor-title")?.textContent === "Triagem Inicial");
    await page.locator('[data-tab="simulator"]').click();
    await page.locator("#simulation-time").fill("2026-10-05T11:00");
    const turn = async (text) => {
      await page.locator("#simulation-message").fill(text);
      const [response] = await Promise.all([page.waitForResponse((response) => response.url().includes("/simulate") && response.request().method() === "POST"), page.locator("#simulation-form button").click()]);
      assert.equal(response.status(), 200); const result = await response.json(); assert.equal(result.dryRun, true); return result;
    };
    let result = await turn("Olá");
    const options = result.outputs.find((output) => output.options)?.options || [];
    const commercial = options.findIndex((option) => option.label === "Comercial") + 1;
    assert.ok(commercial); result = await turn(String(commercial));
    if (result.botId === "system-triage-bot") {
      const submenu = result.outputs.find((output) => output.options)?.options || [];
      assert.ok(submenu.length); result = await turn("1");
    }
    assert.equal(result.botId, "mibro-assistant-observer");
    await turn("Quero comprar um relógio"); result = await turn("Lite 3 Pro");
    assert.ok(result.outputs.some((output) => output.text?.includes("products/mibro-lite-3-pro")));
    result = await turn("Voltar"); assert.equal(result.state.currentNodeKey, "answer_products");
    await turn("Lite 3"); result = await turn("quero falar com um vendedor"); assert.equal(result.status, "HANDED_OFF");
    const editor = await context.request.get("http://127.0.0.1:3340/api/bots/system-triage-bot/visual-flow-options");
    assert.equal(editor.status(), 200);
    assert.ok(!(await editor.json()).nodeTypes.some((node) => node.type === "webhook"));
    assert.deepEqual(errors, []);
    console.log("20 verificações responsivas + Triagem → Assistente → ficha/link → Voltar → vendedor: OK; Webhook/API ausente.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
