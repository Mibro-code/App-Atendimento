const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const js = fs.readFileSync(path.join(__dirname, "../public/js/integrations.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../public/integrations.html"), "utf8");
const callback = fs.readFileSync(path.join(__dirname, "../public/oauth-callback.html"), "utf8");

test("UI prioriza botões OAuth oficiais e deixa fallback manual apenas no avançado", () => {
  for (const label of ["Conectar com Google", "Conectar com Microsoft", "Conectar com Meta", "Conectar com Mercado Livre", "Conectar com Amazon"]) {
    assert.ok(js.includes(label), label);
  }
  assert.ok(js.includes("oauthButtons(entry)"));
  assert.ok(js.includes("Configuração avançada"));
  assert.ok(js.includes("Adicionar manualmente"));
});

test("callback trata cancelamento e seleção múltipla sem receber client secret ou tokens", () => {
  assert.ok(callback.includes('params.get("error")'));
  assert.ok(callback.includes("/api/integrations/oauth/callback"));
  assert.ok(html.includes("oauth-selection-dialog"));
  assert.ok(js.includes("/api/integrations/oauth/accounts/"));
  assert.equal((html + js + callback).includes("GOOGLE_OAUTH_CLIENT_SECRET"), false);
  assert.equal(callback.includes("access_token"), false);
});

test("conta de e-mail permite selecionar usuários sem expor o conteúdo", () => {
  assert.ok(html.includes("account-access-dialog"));
  assert.ok(js.includes("Gerenciar acesso"));
  assert.ok(js.includes("/access"));
  assert.ok(js.includes("somente Master"));
});