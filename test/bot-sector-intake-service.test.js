require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  categoryFamily, detectIssue, detectProduct, runSectorIntake,
} = require("../src/services/bot-sector-intake-service");

const bot = {
  id: "mibro-assistant-observer",
  name: "Assistente Mibro Brasil",
  intents: [],
  featureFlags: { sectorIntakeEnabled: true, externalAiFallbackEnabled: false },
};
const support = { id: "support", code: "SUPORTE", name: "Suporte" };
const attendance = { id: "attendance", code: "ATENDIMENTO", name: "Atendimento" };
const commercial = { id: "commercial", code: "COMERCIAL", name: "Comercial" };
const partnerships = { id: "partnerships", code: "PARCERIAS", name: "Parcerias" };
const noKnowledge = { async search() { return []; } };

test("reconhece setor pela categoria pai", () => {
  assert.equal(categoryFamily({ name: "Tecnico", parent: support }), "SUPORTE");
});

test("normaliza variacoes locais sem IA", () => {
  assert.equal(detectIssue("SUPORTE", "meu mibro n carrega"), "CARREGAMENTO");
  assert.equal(detectIssue("SUPORTE", "a tela quebrou"), "TELA");
  assert.equal(detectIssue("ATENDIMENTO", "meu pedido nao chegou"), "PEDIDO");
  assert.equal(detectIssue("PARCERIAS", "tenho uma loja e queria revender mibro"), "REVENDA");
  assert.equal(detectProduct("meu gs pro 2 nao carrega"), "GS Pro 2");
});

test("suporte pergunta modelo apenas quando ele ainda nao foi informado", async () => {
  const first = await runSectorIntake({
    bot, category: support, message: "meu mibro n carrega", caseState: {},
    knowledgeProvider: noKnowledge,
  });
  assert.equal(first.interpretation.issue, "CARREGAMENTO");
  assert.equal(first.decision.action, "ASK_CLARIFICATION");
  assert.equal(first.caseState.pendingField, "product");

  const withModel = await runSectorIntake({
    bot, category: support, message: "meu gs pro 2 nao carrega", caseState: {},
    knowledgeProvider: noKnowledge,
  });
  assert.equal(withModel.caseState.product, "GS Pro 2");
  assert.equal(withModel.caseState.pendingField, "purchase");
});

test("conexao com modelo e app pula perguntas ja respondidas", async () => {
  const result = await runSectorIntake({
    bot, category: support, message: "gs pro 2 nao conecta no mibro fit no android",
    caseState: {}, knowledgeProvider: noKnowledge,
  });
  assert.equal(result.interpretation.issue, "CONEXAO");
  assert.equal(result.caseState.product, "GS Pro 2");
  assert.equal(result.caseState.app, "Mibro Fit");
  assert.equal(result.caseState.os, "Android");
  assert.equal(result.decision.action, "HANDOFF_HUMAN");
});

test("perfis de atendimento, comercial e parcerias usam o setor escolhido", async () => {
  const order = await runSectorIntake({
    bot, category: attendance, message: "meu pedido nao chegou", caseState: {}, knowledgeProvider: noKnowledge,
  });
  assert.equal(order.interpretation.issue, "PEDIDO");
  assert.equal(order.caseState.pendingField, "orderNumber");

  const sale = await runSectorIntake({
    bot, category: commercial, message: "quero saber qual tem gps", caseState: {}, knowledgeProvider: noKnowledge,
  });
  assert.equal(sale.interpretation.issue, "GPS");
  assert.equal(sale.caseState.objective, "quero saber qual tem gps");
  assert.equal(sale.decision.action, "HANDOFF_HUMAN");

  const reseller = await runSectorIntake({
    bot, category: partnerships, message: "tenho uma loja e queria revender mibro",
    caseState: {}, knowledgeProvider: noKnowledge,
  });
  assert.equal(reseller.interpretation.issue, "REVENDA");
  assert.equal(reseller.decision.action, "HANDOFF_HUMAN");
});

test("nao executa antes da triagem definir categoria", async () => {
  assert.equal(await runSectorIntake({
    bot, category: null, message: "nao carrega", caseState: {}, knowledgeProvider: noKnowledge,
  }), null);
});

test("coleta apenas os campos faltantes e conclui o handoff em poucos passos", async () => {
  const one = await runSectorIntake({
    bot, category: support, message: "gs pro 2 n carrega", caseState: {}, knowledgeProvider: noKnowledge,
  });
  assert.equal(one.caseState.pendingField, "purchase");

  const two = await runSectorIntake({
    bot, category: support, message: "sim, tenho nf e comprei na amazon",
    caseState: one.caseState, knowledgeProvider: noKnowledge,
  });
  assert.equal(two.caseState.hasInvoice, true);
  assert.match(two.caseState.purchaseChannel, /amazon/i);
  assert.equal(two.caseState.pendingField, "purchaseDateApprox");

  const three = await runSectorIntake({
    bot, category: support, message: "ha 2 meses",
    caseState: two.caseState, knowledgeProvider: noKnowledge,
  });
  assert.equal(three.decision.action, "HANDOFF_HUMAN");
  assert.equal(three.caseState.purchaseDateApprox, "ha 2 meses");
  assert.equal(three.caseState.questionsAsked.length, 2);
});
