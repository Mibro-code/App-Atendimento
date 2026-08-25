const prisma = require("../database/prisma");
const { orchestrate } = require("./bot-orchestrator-service");

// Roda o motor de interpretação (orquestrador -> interpretador -> decisão)
// do Bot ativo do canal em paralelo à triagem real, apenas para
// log/comparação. Nunca envia mensagem, nunca altera Conversation/Message,
// nunca chama uma tool externa e nunca pode derrubar o processamento real
// do webhook. Evolução do observador da Fase 2 (mesma responsabilidade,
// agora orientada pelo motor de interpretação em vez de match literal puro).
async function observeIncomingMessage(event, message, { now = new Date() } = {}) {
  try {
    if (event.type !== "text" || !event.text) return null;

    const result = await orchestrate({
      conversationId: message.conversationId,
      messageId: message.id,
      channel: "META",
      message: event.text,
      now,
    });
    if (!result) return null;

    console.log("[BOT_OBSERVATION]", JSON.stringify({
      conversationId: message.conversationId,
      botId: result.botId,
      botName: result.botName,
      switchedFromBotId: result.switchedFromBotId,
      withinHours: result.withinHours,
      intent: result.intentName,
      socialBehavior: result.socialBehavior,
      confidence: result.confidence,
      action: result.action,
      category: result.categoryName,
      provider: result.provider,
      status: result.status,
    }));

    await prisma.botObservation.create({
      data: {
        conversationId: message.conversationId,
        messageId: message.id,
        botId: result.botId,
        botName: result.botName,
        channel: "META",
        withinHours: result.withinHours ?? true,
        intentId: result.intentId,
        intentName: result.intentName,
        socialBehavior: result.socialBehavior,
        matchedExample: result.matchedExample,
        categoryId: result.categoryId,
        categoryName: result.categoryName,
        fallbackAction: null,
        confidence: result.confidence,
        action: result.action,
        extractedEntities: result.extractedEntities || {},
        provider: result.provider,
        mode: "OBSERVATION",
        status: result.status,
        errorCode: result.errorCode,
      },
    });

    return result;
  } catch (error) {
    console.error("[BOT_OBSERVATION] falha ao interpretar (ignorada)", error.message);
    try {
      await prisma.botObservation.create({
        data: {
          conversationId: message.conversationId,
          messageId: message.id,
          botName: "Erro na observação",
          channel: "META",
          withinHours: true,
          mode: "OBSERVATION",
          status: "ERROR",
          errorCode: error.code || "OBSERVATION_FAILED",
        },
      });
    } catch (_persistError) {
      // Se nem o registro de erro puder ser gravado, apenas seguimos: o
      // webhook nunca pode ser afetado pelo modo observação.
    }
    return null;
  }
}

module.exports = { observeIncomingMessage };
