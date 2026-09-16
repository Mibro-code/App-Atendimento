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

test("saudacao generica usa abertura neutra em qualquer setor", async () => {
  for (const category of [support, attendance, commercial, partnerships]) {
    const result = await runSectorIntake({
      bot, category, message: "Olá", caseState: {}, knowledgeProvider: noKnowledge,
    });
    assert.equal(result.decision.flowResponseText, "Olá! Como posso ajudar?");
  }
});

test("responde pela base antes de iniciar coleta e handoff", async () => {
  const knowledge = {
    async search() {
      return [{ id: "kb-pareamento", title: "Pareamento Bluetooth", content: "Abra o Mibro Fit e selecione Adicionar dispositivo.", score: 0.94 }];
    },
  };
  const result = await runSectorIntake({
    bot, category: support, message: "Como faço para parear?", caseState: {}, knowledgeProvider: knowledge,
  });
  assert.equal(result.decision.action, "RESPOND");
  assert.equal(result.caseState.pendingField, "none");
  assert.match(result.decision.flowResponseText, /Adicionar dispositivo/);
  assert.equal(result.knowledgeSource.id, "kb-pareamento");
});

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

test("parceria coleta redes, seguidores e links antes do encaminhamento", async () => {
  const one = await runSectorIntake({
    bot, category: partnerships, message: "Tenho um Instagram e gostaria de fazer vídeos para vocês",
    caseState: {}, knowledgeProvider: noKnowledge,
  });
  assert.equal(one.interpretation.issue, "PARCERIA");
  assert.equal(one.caseState.pendingField, "socialNetworks");
  assert.equal(one.decision.flowResponseText, "Quais redes sociais você utiliza?");

  const two = await runSectorIntake({
    bot, category: partnerships, message: "Instagram e TikTok",
    caseState: one.caseState, knowledgeProvider: noKnowledge,
  });
  assert.equal(two.caseState.socialNetworks, "Instagram e TikTok");
  assert.equal(two.caseState.pendingField, "followerCount");

  const three = await runSectorIntake({
    bot, category: partnerships, message: "20 mil no Instagram e 8 mil no TikTok",
    caseState: two.caseState, knowledgeProvider: noKnowledge,
  });
  assert.equal(three.caseState.followerCount, "20 mil no Instagram e 8 mil no TikTok");
  assert.equal(three.caseState.pendingField, "socialLinks");

  const four = await runSectorIntake({
    bot, category: partnerships, message: "https://instagram.com/exemplo e https://tiktok.com/@exemplo",
    caseState: three.caseState, knowledgeProvider: noKnowledge,
  });
  assert.equal(four.caseState.socialLinks, "https://instagram.com/exemplo e https://tiktok.com/@exemplo");
  assert.equal(four.decision.action, "HANDOFF_HUMAN");
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
  assert.equal(three.decision.flowResponseText, "Ok! Vou encaminhar seu caso para um atendente. Em breve, alguém da nossa equipe continuará o atendimento por aqui.");
  assert.equal(three.caseState.purchaseDateApprox, "ha 2 meses");
  assert.equal(three.caseState.questionsAsked.length, 2);
});
