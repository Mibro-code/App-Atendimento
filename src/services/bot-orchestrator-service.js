// Orquestrador: decide QUAL Bot atende uma conversa e amarra
// interpret() -> decide() -> respond() num resultado padronizado único.
// Usado tanto pelo modo observação (mensagens reais) quanto, com estado
// totalmente separado, pelo simulador multi-turno da tela de Bots.
const prisma = require("../database/prisma");
const { interpret } = require("./bot-interpreter-service");
const { decide } = require("./bot-decision-service");
const { respond } = require("./bot-response-service");
const { getState, getRecentContext, persistDecision } = require("./bot-conversation-state-service");

const categorySelection = { id: true, code: true, name: true, color: true, active: true };
const botInclude = {
  defaultCategory: { select: categorySelection },
  schedules: { orderBy: { dayOfWeek: "asc" } },
  intents: {
    include: {
      category: { select: categorySelection },
      examples: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  },
};

async function resolveBot(activeBotId, channel, client) {
  if (activeBotId) {
    const active = await client.bot.findFirst({
      where: { id: activeBotId, channel, status: "ACTIVE", archivedAt: null },
      include: botInclude,
    });
    if (active) return active;
  }
  return client.bot.findFirst({
    where: { channel, status: "ACTIVE", archivedAt: null },
    include: botInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function resolveSwitchTarget(categoryId, channel, currentBotId, client) {
  return client.bot.findFirst({
    where: {
      channel, status: "ACTIVE", archivedAt: null,
      defaultCategoryId: categoryId, id: { not: currentBotId },
    },
    include: botInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

function categoryNameFor(bot, categoryId) {
  if (!categoryId) return null;
  if (bot.defaultCategoryId === categoryId) return bot.defaultCategory?.name || null;
  const intent = (bot.intents || []).find((item) => item.categoryId === categoryId);
  return intent?.category?.name || null;
}

function toStandardResult({ bot, targetBot, interpretation, decision, responseText }) {
  return {
    botId: targetBot.id,
    botName: targetBot.name,
    switchedFromBotId: targetBot.id !== bot.id ? bot.id : null,
    intentId: interpretation.intentId,
    intentName: interpretation.intentName,
    confidence: interpretation.confidence,
    matchedExample: interpretation.matchedExample,
    provider: interpretation.provider,
    status: interpretation.status,
    errorCode: interpretation.errorCode,
    action: decision.action,
    categoryId: decision.categoryId,
    categoryName: categoryNameFor(targetBot, decision.categoryId),
    needsClarification: decision.needsClarification,
    shouldHandoff: decision.shouldHandoff,
    withinHours: decision.withinHours,
    extractedEntities: interpretation.entities,
    summary: decision.summary,
    response: responseText,
  };
}

// Interpreta e decide para uma conversa REAL, persistindo o estado do Bot
// nessa conversa (ConversationBotState). Não altera Conversation/Message.
async function orchestrate({ conversationId, channel = "META", messageId = null, message, now = new Date() }, client = prisma) {
  const state = await getState(conversationId, client);
  const bot = await resolveBot(state?.activeBotId, channel, client);
  if (!bot) return null;

  const context = await getRecentContext(conversationId, { beforeMessageId: messageId }, client);
  const interpretation = await interpret({ bot, message, context, state });
  const decision = decide({ bot, interpretation, message, state, now });

  let targetBot = bot;
  if (decision.action === "SWITCH_BOT" && decision.categoryId) {
    const candidate = await resolveSwitchTarget(decision.categoryId, channel, bot.id, client);
    if (candidate) targetBot = candidate;
  }

  const responseText = respond({ bot: targetBot, decision, interpretation });
  await persistDecision({ conversationId, bot: targetBot, interpretation, decision }, client);

  return toStandardResult({ bot, targetBot, interpretation, decision, responseText });
}

// Mesma interpretação, mas para o simulador: usa um "estado" transitório
// fornecido pelo cliente (nunca a tabela ConversationBotState) e nunca troca
// de Bot fora da lista de Bots ativos do canal — apenas sinaliza a sugestão.
async function simulateOrchestration({ bot, message, context = [], state = null, now = new Date() }) {
  // O simulador deve permitir testar configurações em rascunho sem ativá-las
  // no modo observação. A cópia em memória nunca é persistida.
  const simulationBot = bot.status === "ACTIVE" ? bot : { ...bot, status: "ACTIVE" };
  const interpretation = await interpret({ bot: simulationBot, message, context, state });
  const decision = decide({ bot: simulationBot, interpretation, message, state, now });

  let targetBot = bot;
  if (decision.action === "SWITCH_BOT" && decision.categoryId) {
    const candidate = await resolveSwitchTarget(decision.categoryId, bot.channel, bot.id, prisma);
    if (candidate) targetBot = candidate;
  }

  const responseText = respond({ bot: targetBot, decision, interpretation });
  const nextState = {
    activeBotId: targetBot.id,
    lastIntentId: interpretation.intentId || null,
    lastConfidence: interpretation.confidence ?? null,
    failedInterpretations: decision.action === "ASK_CLARIFICATION" || decision.action === "HANDOFF_HUMAN"
      ? (decision.failureCount ?? 0) : 0,
    pendingClarification: decision.needsClarification || false,
    extractedEntities: interpretation.entities || {},
  };

  return { ...toStandardResult({ bot, targetBot, interpretation, decision, responseText }), nextState };
}

module.exports = { botInclude, orchestrate, resolveBot, simulateOrchestration };
