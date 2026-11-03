const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public/js/optional-panels.js"), "utf8");

function fixture() {
  const scripts = [], listeners = [], errors = [];
  const context = { window: { FollowUpsUI: { currentContactId: () => "contact-qa" } },
    document: {
      createElement: () => ({ remove() { this.removed = true; } }),
      head: { appendChild(script) { scripts.push(script); } },
      querySelector: () => ({ addEventListener(_event, handler) { listeners.push(handler); } }),
    }, toast: (...args) => errors.push(args),
  };
  vm.runInNewContext(source, context);
  return { context, scripts, listeners, errors };
}

test("Painéis não baixam na inicialização; chamadas concorrentes compartilham o script", async () => {
  const { context, scripts } = fixture();
  assert.equal(scripts.length, 0);
  const calls = [];
  const opened = context.window.WaSupervision.open({ memberId: "agent", tab: "history" });
  const timeline = context.window.WaSupervision.openTimeline("conversation");
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, "/js/supervision.js?v=1");
  context.window.WaSupervision = { open: (args) => calls.push(args), openTimeline: (id) => calls.push(id) };
  scripts[0].onload();
  await Promise.all([opened, timeline]);
  assert.equal(calls[0].memberId, "agent");
  assert.equal(calls[0].tab, "history");
  assert.equal(calls[1], "conversation");
});

test("Falha de rede permite tentar novamente e não deixa o carregamento preso", async () => {
  const { context, scripts } = fixture();
  const first = context.window.WaSupervision.open();
  scripts[0].onerror();
  await assert.rejects(first, /Tente novamente/);
  assert.equal(scripts[0].removed, true);
  const second = context.window.WaSupervision.open();
  assert.equal(scripts.length, 2);
  context.window.WaSupervision = { open: () => "ok" };
  scripts[1].onload();
  assert.equal(await second, "ok");
});

test("Perfil 360 recebe o contato atual e exibe erro de carregamento", async () => {
  const { context, scripts, listeners, errors } = fixture();
  listeners[0]();
  assert.equal(scripts[0].src, "/js/contact-profile-ui.js?v=1");
  const calls = [];
  context.window.ContactProfileUI = { open: (id) => calls.push(id) };
  scripts[0].onload();
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["contact-qa"]);
  assert.equal(errors.length, 0);
  const retry = fixture();
  retry.listeners[0]();
  retry.scripts[0].onerror();
  await new Promise(setImmediate);
  assert.equal(retry.errors[0][1], true);
});

test("Script sem exportação não provoca recursão e permite nova tentativa", async () => {
  const { context, scripts } = fixture();
  const request = context.window.ContactProfileUI.open("contact-qa");
  scripts[0].onload();
  await assert.rejects(request, /Tente novamente/);
  assert.equal(scripts[0].removed, true);
});

test("HTML carrega o bootstrap antes do app; PWA não pré-baixa os painéis", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert(html.indexOf('/js/optional-panels.js') < html.indexOf('/js/app.js'));
  assert(!html.includes('<script src="/js/supervision.js'));
  assert(!html.includes('<script src="/js/contact-profile-ui.js'));
  const sw = fs.readFileSync(path.join(root, "public/service-worker.js"), "utf8");
  const precache = sw.slice(sw.indexOf("const STATIC_ASSETS"), sw.indexOf("const STATIC_PATHS"));
  assert(!precache.includes('"/js/contact-profile-ui.js"'));
  assert(!precache.includes('"/js/supervision.js"'));
  assert(sw.includes('STATIC_PATHS.add("/js/contact-profile-ui.js")'));
  const profile = fs.readFileSync(path.join(root, "public/js/contact-profile-ui.js"), "utf8");
  assert(!profile.includes('$("#open-contact-profile")?.addEventListener'));
});

test("Rotas de relatório mantêm produtividade; ranking legado ainda está disponível", () => {
  const controller = fs.readFileSync(path.join(root, "src/controllers/conversation-report-controller.js"), "utf8");
  assert(controller.includes("productivity.getAgentProductivity(access"));
  assert(controller.includes("productivity.getProductivity(access"));
  assert(controller.includes("analytics.getAgentRanking(query)"));
  const service = fs.readFileSync(path.join(root, "src/services/conversation-analytics-service.js"), "utf8");
  assert(!service.includes("function getAgentDetail("));
  assert(!service.includes("function compareAgents("));
  assert(service.includes("async function getAgentRanking("));
});
