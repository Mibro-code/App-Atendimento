const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const read = (file) => fs.readFileSync(path.join(publicDir, file), "utf8");
const html = read("index.html");
const appCss = read("css/app.css");
const settingsCss = read("css/configuracoes.css");
const appJs = read("js/app.js");

test("Configurações permite rolagem vertical e crescimento natural das seções", () => {
  assert.match(settingsCss, /body\{[^}]*height:auto[^}]*overflow-y:auto/);
  assert.match(settingsCss, /grid-auto-rows:max-content/);
  assert.match(settingsCss, /details\.card\{min-height:0;overflow:visible\}/);
});

test("textos de ajuda ficam abaixo dos campos sem margem negativa", () => {
  const rule = settingsCss.match(/\.settings-grid \.card-help\{([^}]*)\}/)?.[1] || "";
  assert.match(rule, /margin:12px 0 0/);
  assert.doesNotMatch(rule, /margin:-/);
  assert.match(rule, /line-height:1\.55/);
});

test("atalhos são agrupados nas quatro áreas e preservam IDs únicos", () => {
  for (const label of ["Atendimento", "Automação", "Canais", "Administração"]) {
    assert.match(html, new RegExp("<summary>" + label + "</summary>"));
  }
  for (const id of [
    "enable-notifications", "manage-devices", "bots-button", "integrations-button",
    "quick-replies-admin-button", "knowledge-base-button", "campaigns-button",
    "conversation-settings-button", "team-button",
  ]) {
    assert.equal((html.match(new RegExp('id="' + id + '"', "g")) || []).length, 1);
  }
});

test("menus fecham ao trocar de área, escolher opção ou clicar fora", () => {
  assert.match(appJs, /topbar-menu\[open\]/);
  assert.match(appJs, /other !== menu/);
  assert.match(appJs, /closest\("\.topbar-menu-item"\)/);
  assert.match(appCss, /topbar-menu-panel/);
  assert.match(appCss, /max-width:820px/);
});
