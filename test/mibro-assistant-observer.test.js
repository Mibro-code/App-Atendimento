const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { emptyCaseState, mergeCaseState } = require("../src/services/bot-case-state-service");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "prisma/migrations/20260909120000_mibro_assistant_observer/migration.sql"), "utf8");
const orchestrator = fs.readFileSync(path.join(root, "src/services/bot-orchestrator-service.js"), "utf8");
const botsUi = fs.readFileSync(path.join(root, "public/js/bots.js"), "utf8");

test("Assistente Mibro nasce somente em observação e é priorizado após a triagem", () => {
  assert.match(migration, /mibro-assistant-observer/);
  assert.match(migration, /"autoReplyEnabled"[\s\S]*false/);
  assert.match(migration, /"agentPlannerEnabled":true/);
  assert.match(orchestrator, /mibro-assistant-observer/);
  assert.match(botsUi, /Observa&ccedil;/);
});

test("Assistente Mibro possui 9 intenções e 18 fontes oficiais iniciais", () => {
  assert.equal((migration.match(/INSERT INTO "BotIntent" /g) || []).length, 9);
  assert.equal((migration.match(/INSERT INTO "KnowledgeSource" /g) || []).length, 18);
  assert.match(migration, /mibrobrasil\.com\.br\/pages\/app-mibro/);
  assert.match(migration, /mibrobrasil\.com\.br\/policies\/refund-policy/);
});

test("memória do caso preserva os detalhes necessários ao handoff", () => {
  const state = mergeCaseState(emptyCaseState(), {
    product: "GS Pro 2", phone: "Android", objective: "parear relógio",
    lastResult: "não funcionou", orderNumber: "12345", purchaseChannel: "loja oficial", topic: "conexão",
  });
  assert.equal(state.product, "GS Pro 2");
  assert.equal(state.objective, "parear relógio");
  assert.equal(state.lastResult, "não funcionou");
  assert.equal(state.orderNumber, "12345");
  assert.equal(state.purchaseChannel, "loja oficial");
  assert.equal(state.topic, "conexão");
});
