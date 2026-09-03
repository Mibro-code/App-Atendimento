const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const html = fs.readFileSync(path.join(process.cwd(), "public", "bots.html"), "utf8");
const javascript = fs.readFileSync(path.join(process.cwd(), "public", "js", "bots.js"), "utf8");

test("tela de Bots exibe todos os campos de personalidade", () => {
  for (const id of [
    "personality-form", "personality-preset", "personality-copy-source",
    "personality-assistant-name", "personality-role", "personality-tone",
    "personality-style", "personality-mandatory", "personality-forbidden",
    "personality-additional", "personality-response-length",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
});

test("interface usa somente os endpoints seguros de personalidade", () => {
  assert.match(javascript, /\/api\/bot-personality-presets/);
  assert.match(javascript, /\/api\/bots\/\$\{[^}]+\}\/personality/);
  assert.match(javascript, /\/personality\/preset/);
  assert.match(javascript, /\/personality\/copy/);
  assert.doesNotMatch(javascript, /client_secret|access_token|refresh_token/i);
});

test("edicao manual envia todos os campos e marca como personalizada", () => {
  assert.match(javascript, /preset:\s*"PERSONALIZADO"/);
  for (const field of [
    "assistantName", "roleDescription", "tone", "responseStyle",
    "mandatoryBehaviors", "forbiddenBehaviors", "additionalInstructions", "responseLength",
  ]) assert.match(javascript, new RegExp(`\\b${field}\\b`));
  assert.match(javascript, /status\.user\.isMaster/);
});
