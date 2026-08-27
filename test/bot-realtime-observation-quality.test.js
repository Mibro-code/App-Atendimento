require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/database/prisma");
const { orchestrate } = require("../src/services/bot-orchestrator-service");
const {
  observeIncomingMessage, observeAgentReply, listDecisionsForConversation, setConversationObservationPaused,
} = require("../src/services/bot-observation-service");
const { sendText } = require("../src/services/message-service");
const { decide, isAutoReplyPermittedForIntent } = require("../src/services/bot-decision-service");
const { dashboardMetrics } = require("../src/services/bot-quality-service");
const { recordAiUsage, usageSummary } = require("../src/services/bot-ai-usage-service");

const botNamePrefix = "Bot Realtime Obs Teste";
const externalId = "bot-realtime-obs-test-contact";
const masterEmail = "master-realtime-obs-test@teste.local";
let master;

async function cleanup() {
  await prisma.bot.deleteMany({ where: { name: { startsWith: botNamePrefix } } });
  await prisma.contact.deleteMany({ where: { externalId: { startsWith: externalId } } });
}

test.before(async () => {
  master = await prisma.user.upsert({
    where: { email: masterEmail }, update: {}, create: { name: "Master Realtime Obs", email: masterEmail, role: "ADMIN" },
  });
  await prisma.botGlobalSettings.upsert({
    where: { id: "singleton" },
    update: { observationEnabled: true, observeActiveConversations: false },
    create: { id: "singleton", observationEnabled: true, observeActiveConversations: false },
  });
});

test.after(async () => {
  await cleanup();
  await prisma.user.deleteMany({ where: { email: masterEmail } });
  await prisma.$disconnect();
});

let phoneCounter = 0;
async function seedConversation() {
  phoneCounter += 1;
  const contact = await prisma.contact.create({
    data: { externalId: `${externalId}-${phoneCounter}`, phone: `5511966600${String(phoneCounter).padStart(3, "0")}`, name: "Cliente" },
  });
  return prisma.conversation.create({ data: { contactId: contact.id } });
}

async function makeBot(overrides = {}) {
  return prisma.bot.create({
    data: {
      name: `${botNamePrefix} ${Date.now()}-${Math.random()}`, status: "ACTIVE", channel: "META",
      initialMessage: "Olá!", outsideHoursMessage: "Fora.", fallbackMessage: "Não entendi.",
      intents: { create: [{
        name: "Suporte de conexão", active: true, priority: 1,
        examples: { create: [{ text: "não conecta" }, { text: "meu equipamento não conecta" }] },
      }] },
      ...overrides,
    },
    include: { intents: true },
  });
}

// Reproduz o caminho real do webhook (único lugar que persiste BotObservation).
async function observeMessage(conversation, text) {
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id, externalId: `realtime-${conversation.id}-${Math.random()}`,
      direction: "RECEBIDA", status: "RECEBIDA", type: "text", text, occurredAt: new Date(),
    },
  });
  return observeIncomingMessage({ type: "text", text }, message);
}

test("Decision Log: confiança local/final, modelo, duração e não guarda secret", async () => {
  await cleanup();
  await makeBot();
  const conversation = await seedConversation();
  const result = await observeMessage(conversation, "não conecta");
  assert.ok(result);
  const observation = await prisma.botObservation.findFirst({ where: { conversationId: conversation.id } });
  assert.ok(observation);
  assert.equal(typeof observation.localConfidence, "number");
  assert.equal(typeof observation.finalConfidence, "number");
  assert.equal(observation.aiModel, null, "sem IA externa, aiModel deve ficar nulo");
  assert.ok(Number.isInteger(observation.durationMs) && observation.durationMs >= 0);
  const serialized = JSON.stringify(observation);
  assert.doesNotMatch(serialized, /AIzaSy|sk-|ANTHROPIC_API_KEY/i, "o Decision Log nunca deve conter uma API key");
});

test("idempotência por messageId: observar a mesma mensagem duas vezes nunca cria um registro de ERRO", async () => {
  await cleanup();
  await makeBot();
  const conversation = await seedConversation();
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id, externalId: `dup-${conversation.id}`,
      direction: "RECEBIDA", status: "RECEBIDA", type: "text", text: "não conecta", occurredAt: new Date(),
    },
  });
  const event = { type: "text", text: "não conecta" };
  await observeIncomingMessage(event, message);
  const second = await observeIncomingMessage(event, message);
  assert.equal(second, null);
  const rows = await prisma.botObservation.findMany({ where: { messageId: message.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "OK");
});

test("pauseBotObservation: uma conversa pausada nunca gera uma nova observação", async () => {
  await cleanup();
  await makeBot();
  const conversation = await seedConversation();
  await setConversationObservationPaused(conversation.id, true, master);
  const result = await observeMessage(conversation, "não conecta");
  assert.equal(result, null);
  const rows = await prisma.botObservation.findMany({ where: { conversationId: conversation.id } });
  assert.equal(rows.length, 0);

  await setConversationObservationPaused(conversation.id, false, master);
  await observeMessage(conversation, "não conecta");
  const rowsAfter = await prisma.botObservation.findMany({ where: { conversationId: conversation.id } });
  assert.equal(rowsAfter.length, 1);
});

test("observeAgentReply: desligado por padrão (observeActiveConversations OFF), não liga sugestão x resposta real", async () => {
  await cleanup();
  const bot = await makeBot();
  const conversation = await seedConversation();
  await observeMessage(conversation, "não conecta");
  await prisma.conversation.update({ where: { id: conversation.id }, data: { assignedUserId: master.id, status: "EM_ATENDIMENTO" } });

  await observeAgentReply({ conversationId: conversation.id, replyText: "Qual modelo e qual app você usa?", sentByUserId: master.id });

  const observation = await prisma.botObservation.findFirst({ where: { conversationId: conversation.id } });
  assert.equal(observation.actualAgentReplyText, null);
  await prisma.bot.delete({ where: { id: bot.id } });
});

test("observeAgentReply ligado: liga a resposta real do atendente à observação e detecta o sinal do cliente depois", async () => {
  await cleanup();
  const bot = await makeBot({ featureFlags: { observeActiveConversations: true } });
  await prisma.botGlobalSettings.update({ where: { id: "singleton" }, data: { observeActiveConversations: true } });
  try {
    const conversation = await seedConversation();
    await observeMessage(conversation, "não conecta");
    await prisma.conversation.update({ where: { id: conversation.id }, data: { assignedUserId: master.id, status: "EM_ATENDIMENTO" } });

    const observationId = await observeAgentReply({
      conversationId: conversation.id, replyText: "Qual modelo e qual app você usa?", sentByUserId: master.id,
    });
    assert.ok(observationId);
    let observation = await prisma.botObservation.findUnique({ where: { id: observationId } });
    assert.equal(observation.actualAgentReplyText, "Qual modelo e qual app você usa?");
    assert.equal(observation.actualAgentUserId, master.id);
    assert.ok(observation.actualAgentRepliedAt);
    assert.equal(observation.customerReactionSignal, null);

    await observeMessage(conversation, "GS Pro 2 e Mibro Fit, agora funcionou, obrigado");
    observation = await prisma.botObservation.findUnique({ where: { id: observationId } });
    assert.equal(observation.customerReactionSignal, "POSITIVE");
    assert.ok(observation.customerReactionAt);
  } finally {
    await prisma.botGlobalSettings.update({ where: { id: "singleton" }, data: { observeActiveConversations: false } });
    await prisma.bot.delete({ where: { id: bot.id } });
  }
});

test("sinal de resolução nunca é inferido do silêncio: mensagem sem padrão claro não marca nada", async () => {
  await cleanup();
  const bot = await makeBot({ featureFlags: { observeActiveConversations: true } });
  await prisma.botGlobalSettings.update({ where: { id: "singleton" }, data: { observeActiveConversations: true } });
  try {
    const conversation = await seedConversation();
    await observeMessage(conversation, "não conecta");
    await prisma.conversation.update({ where: { id: conversation.id }, data: { assignedUserId: master.id, status: "EM_ATENDIMENTO" } });
    const observationId = await observeAgentReply({
      conversationId: conversation.id, replyText: "Qual modelo você usa?", sentByUserId: master.id,
    });
    await observeMessage(conversation, "tá bom");
    const observation = await prisma.botObservation.findUnique({ where: { id: observationId } });
    assert.equal(observation.customerReactionSignal, null, "silêncio/mensagem neutra nunca deve virar sucesso");
  } finally {
    await prisma.botGlobalSettings.update({ where: { id: "singleton" }, data: { observeActiveConversations: false } });
    await prisma.bot.delete({ where: { id: bot.id } });
  }
});

test("auto reply por intenção: default OFF (nulo) nunca permite envio automático, mesmo com confiança alta", () => {
  const intent = { id: "i1", name: "Teste", autoReplyEnabled: null, autoReplyMinConfidence: null };
  assert.equal(isAutoReplyPermittedForIntent(intent, 0.99), false);
});

test("auto reply por intenção: ligado só permite acima do mínimo configurado", () => {
  const intent = { id: "i1", name: "Teste", autoReplyEnabled: true, autoReplyMinConfidence: 0.9 };
  assert.equal(isAutoReplyPermittedForIntent(intent, 0.85), false);
  assert.equal(isAutoReplyPermittedForIntent(intent, 0.9), true);
});

test("decide() calcula autoReplyPermitted na decisão RESPOND, sem afetar nenhum outro gate existente", () => {
  const bot = { status: "ACTIVE", highConfidenceThreshold: 0.8, lowConfidenceThreshold: 0.5 };
  const intent = { id: "i1", name: "Suporte", autoReplyEnabled: true, autoReplyMinConfidence: 0.9 };
  const interpretation = { intentId: "i1", confidence: 0.95, entities: {} };
  const decision = decide({ bot: { ...bot, intents: [intent] }, interpretation, message: "não conecta" });
  assert.equal(decision.action, "RESPOND");
  assert.equal(decision.autoReplyPermitted, true);
});

test("controle de custo (observeWithExternalAi): fora do modo LIVE, IA externa não é chamada mesmo com externalAiFallbackEnabled=true, a menos que observeWithExternalAi também esteja ligado", async () => {
  await cleanup();
  const bot = await makeBot({
    featureFlags: {
      externalAiFallbackEnabled: true, externalAiThreshold: 0.99, externalAiProvider: "GEMINI", observeWithExternalAi: false,
    },
  });
  try {
    const conversation = await seedConversation();
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id, externalId: `cost-${conversation.id}`,
        direction: "RECEBIDA", status: "RECEBIDA", type: "text", text: "não conecta", occurredAt: new Date(),
      },
    });
    const result = await orchestrate({
      conversationId: conversation.id, messageId: message.id, message: "não conecta", executionMode: "OBSERVATION",
    });
    assert.equal(result.calledExternalAi, false, "sem observeWithExternalAi, a observação nunca deveria chamar IA externa");
  } finally {
    await prisma.bot.delete({ where: { id: bot.id } });
  }
});

test("listDecisionsForConversation: cronológico e sem exigir ser Master (basta poder ver a conversa)", async () => {
  await cleanup();
  await makeBot();
  const conversation = await seedConversation();
  await observeMessage(conversation, "não conecta");
  const result = await listDecisionsForConversation(conversation.id, master);
  assert.equal(result.observationPaused, false);
  assert.ok(result.decisions.length >= 1);
  assert.equal(result.decisions[0].conversationId ?? undefined, undefined); // select não inclui conversationId (já é o filtro)
  assert.ok("intentName" in result.decisions[0]);
  assert.ok("durationMs" in result.decisions[0]);
});

test("dashboardMetrics: agrega rating/por-intenção/qualidade/alertas/uso de IA num único payload", async () => {
  await cleanup();
  const bot = await makeBot();
  const conversation = await seedConversation();
  await observeMessage(conversation, "não conecta");
  await recordAiUsage({ botId: bot.id, provider: "GEMINI", model: "gemini-2.0-flash", reason: "LOW_LOCAL_CONFIDENCE" });

  const dashboard = await dashboardMetrics(bot.id, null, master);
  assert.equal(dashboard.botId, bot.id);
  assert.ok(dashboard.rating);
  assert.ok(Array.isArray(dashboard.byIntent));
  assert.ok(dashboard.quality);
  assert.ok(Array.isArray(dashboard.alerts));
  assert.ok(dashboard.aiUsage);
  assert.ok(Array.isArray(dashboard.aiUsage.calls));
  assert.ok(dashboard.aiUsage.calls.some((row) => row.provider === "GEMINI" && row.model === "gemini-2.0-flash"));
  assert.ok(Array.isArray(dashboard.toolsUsed));
});

test("usageSummary agrupa por provider+model+reason", async () => {
  await cleanup();
  const bot = await makeBot();
  await recordAiUsage({ botId: bot.id, provider: "OPENAI", model: "gpt-4o-mini", reason: "LOW_LOCAL_CONFIDENCE", usage: { inputTokens: 10, outputTokens: 5 } });
  const summary = await usageSummary({ botId: bot.id });
  const row = summary.find((entry) => entry.provider === "OPENAI");
  assert.equal(row.model, "gpt-4o-mini");
  assert.equal(row.inputTokens, 10);
  assert.equal(row.outputTokens, 5);
});

test("message-service.sendText nunca é atrasado/bloqueado por observeAgentReply (fire-and-forget)", async () => {
  await cleanup();
  const bot = await makeBot({ featureFlags: { observeActiveConversations: true } });
  await prisma.botGlobalSettings.update({ where: { id: "singleton" }, data: { observeActiveConversations: true } });
  try {
    const conversation = await seedConversation();
    await prisma.message.create({
      data: {
        conversationId: conversation.id, externalId: `inbound-${conversation.id}`,
        direction: "RECEBIDA", status: "RECEBIDA", type: "text", text: "não conecta", occurredAt: new Date(),
      },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { assignedUserId: master.id, status: "EM_ATENDIMENTO" } });
    let resolveMeta = null;
    const metaSecretCall = new Promise((resolve) => { resolveMeta = resolve; });
    const channel = {
      sendText: async () => { resolveMeta(); return { externalId: `sent-${Date.now()}`, data: {} }; },
    };
    const { message } = await sendText({ conversationId: conversation.id, text: "Olá, tudo bem?", sentByUserId: master.id, channel });
    assert.ok(message.id);
    await metaSecretCall;
  } finally {
    await prisma.botGlobalSettings.update({ where: { id: "singleton" }, data: { observeActiveConversations: false } });
    await prisma.bot.delete({ where: { id: bot.id } });
  }
});
