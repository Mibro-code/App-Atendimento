// Estado operacional do Bot dentro de uma conversa real (ConversationBotState).
// Reaproveitado pelo orquestrador; o simulador NÃO usa esta tabela — ele
// mantém um estado temporário só na memória da sessão de simulação.
const prisma = require("../database/prisma");
const { CONTEXT_MESSAGE_LIMIT } = require("./bot-constants");

async function getState(conversationId, client = prisma) {
  return client.conversationBotState.findUnique({ where: { conversationId } });
}

async function persistDecision({ conversationId, bot, interpretation, decision }, client = prisma) {
  const failedInterpretations = decision.action === "ASK_CLARIFICATION" || decision.action === "HANDOFF_HUMAN"
    ? (decision.failureCount ?? 0)
    : 0;
  return client.conversationBotState.upsert({
    where: { conversationId },
    create: {
      conversationId,
      activeBotId: bot.id,
      lastIntentId: interpretation.intentId || null,
      lastConfidence: interpretation.confidence ?? null,
      failedInterpretations,
      pendingClarification: decision.needsClarification || false,
      extractedEntities: interpretation.entities || {},
    },
    update: {
      activeBotId: bot.id,
      lastIntentId: interpretation.intentId || null,
      lastConfidence: interpretation.confidence ?? null,
      failedInterpretations,
      pendingClarification: decision.needsClarification || false,
      extractedEntities: interpretation.entities || {},
    },
  });
}

// Retorna as últimas mensagens (mais antiga primeiro), limitadas a uma
// quantidade fixa para não crescer indefinidamente com o histórico completo.
async function getRecentContext(conversationId, { limit = CONTEXT_MESSAGE_LIMIT, beforeMessageId = null } = {}, client = prisma) {
  const rows = await client.message.findMany({
    where: {
      conversationId,
      type: "text",
      ...(beforeMessageId ? { id: { not: beforeMessageId } } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: { direction: true, text: true, occurredAt: true },
  });
  return rows.reverse();
}

module.exports = { getRecentContext, getState, persistDecision };
