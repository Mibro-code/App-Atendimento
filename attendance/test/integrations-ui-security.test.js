const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("painel de integrações escapa dados persistidos antes de usar innerHTML", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/integrations.js"), "utf8");
  assert.match(source, /<strong>\$\{escapeHtml\(account\.name\)\}<\/strong>/);
  assert.match(source, /Erro: \$\{escapeHtml\(account\.lastErrorMessage\)\}/);
  assert.match(source, /data-id="\$\{escapeHtml\(account\.id\)\}"/);
  assert.doesNotMatch(source, /<strong>\$\{account\.name\}<\/strong>/);
});
