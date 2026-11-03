const test = require("node:test");
const assert = require("node:assert/strict");
const { matchOptionWithAi } = require("../src/services/bot-flow-service");

const step = {
  options: [
    { id: "support", label: "Suporte", value: "SUPORTE", active: true, aliases: [], conditions: {}, targetIntentId: "intent-support" },
    { id: "other", label: "Outro", value: "OUTRO", active: true, aliases: [], conditions: {}, targetIntentId: "intent-other" },
  ],
};

const bot = {
  highConfidenceThreshold: 0.8,
  featureFlags: { externalAiFallbackEnabled: true, externalAiProvider: "GEMINI" },
};

test("menu guiado aceita somente intenção pertencente às opções e registra a chamada externa", async () => {
  const result = await matchOptionWithAi({
    step, bot, message: "meu relógio parou de conversar com o aplicativo", flowState: { collectedEntities: {} }, context: [],
    interpretMessage: async () => ({
      intentId: "intent-support", confidence: 0.94, calledExternalAi: true,
      externalProvider: "GEMINI", externalAccepted: true, externalStatus: "OK",
      aiUsage: { inputTokens: 20, outputTokens: 5 }, problem: "Falha de conexão",
      recommendedFlow: "intent-support",
    }),
  });
  assert.equal(result.match.option.id, "support");
  assert.equal(result.match.rule, "OPTION_AI");
  assert.equal(result.aiTrace.calledExternalAi, true);
  assert.equal(result.aiTrace.externalProvider, "GEMINI");
  assert.deepEqual(result.aiTrace.aiUsage, { inputTokens: 20, outputTokens: 5 });
});

test("IA nunca inventa opção fora do menu, mas mantém o consumo rastreável", async () => {
  const result = await matchOptionWithAi({
    step, bot, message: "quero falar de cobrança", flowState: { collectedEntities: {} }, context: [],
    interpretMessage: async () => ({
      intentId: "intent-billing", confidence: 0.99, calledExternalAi: true,
      externalProvider: "GEMINI", externalAccepted: true, externalStatus: "OK",
    }),
  });
  assert.equal(result.match, null);
  assert.equal(result.aiTrace.calledExternalAi, true);
});

test("classificação abaixo do limiar não escolhe opção", async () => {
  const result = await matchOptionWithAi({
    step, bot, message: "talvez suporte", flowState: { collectedEntities: {} }, context: [],
    interpretMessage: async () => ({ intentId: "intent-support", confidence: 0.6, calledExternalAi: true, externalProvider: "GEMINI" }),
  });
  assert.equal(result.match, null);
});

test("classificador local pode reconhecer intenção sem fingir chamada de IA externa", async () => {
  const result = await matchOptionWithAi({
    step, bot, message: "preciso de ajuda técnica", flowState: { collectedEntities: {} }, context: [],
    interpretMessage: async () => ({ intentId: "intent-support", confidence: 0.9, calledExternalAi: false }),
  });
  assert.equal(result.match.rule, "OPTION_INTENT");
  assert.equal(result.aiTrace, null);
});

test("tentativa externa sem resposta aceita mantém a classificação como local", async () => {
  const result = await matchOptionWithAi({
    step, bot, message: "preciso de suporte", flowState: { collectedEntities: {} }, context: [],
    interpretMessage: async () => ({
      intentId: "intent-support", confidence: 0.9, calledExternalAi: true,
      externalProvider: "GEMINI", externalAccepted: false, externalStatus: "PROVIDER_ERROR",
    }),
  });
  assert.equal(result.match.rule, "OPTION_INTENT");
  assert.equal(result.aiTrace.calledExternalAi, true);
  assert.equal(result.aiTrace.externalAccepted, false);
});
