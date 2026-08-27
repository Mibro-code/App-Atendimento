const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const { orchestrate } = require("./bot-orchestrator-service");
const { suggestQuickReplyForIntent } = require("./quick-reply-service");
const { detectResolutionSignal } = require("./bot-learning-service");

// Nunca pode derrubar a observação: se a Resposta Rápida sugerida falhar ao
// ser resolvida, a observação continua normalmente sem a sugestão (item 33).
async function suggestQuickReplySafely(intentId) {
  if (!intentId) return null;
  try { return await suggestQuickReplyForIntent(intentId); }
  catch (_error) { return null; }
}

// Nunca pode derrubar a observação/o envio: publicar no SSE é só um sinal
// para a UI atualizar (item 22) — se falhar, ninguém mais tenta de novo,
// simplesmente segue sem o refresh imediato.
function publishSafely() {
  try { require("../realtime/inbox-events").publish(); }
  catch (_error) { /* nunca derruba quem chamou */ }
}

// Item 17: um atendente pode pausar a OBSERVAÇÃO (nunca o atendimento) só
// desta conversa, sem tocar em nenhum toggle global/por Bot.
async function isObservationPausedForConversation(conversationId, client = prisma) {
  const state = await client.conversationBotState.findUnique({
    where: { conversationId }, select: { observationPausedAt: true },
  });
  return Boolean(state?.observationPausedAt);
}

// Roda o motor de interpretação (orquestrador -> interpretador -> decisão)
// do Bot ativo do canal em paralelo à triagem real, apenas para
// log/comparação. Nunca envia mensagem, nunca altera Conversation/Message,
// nunca chama uma tool externa e nunca pode derrubar o processamento real
// do webhook. Evolução do observador da Fase 2 (mesma responsabilidade,
// agora orientada pelo motor de interpretação em vez de match literal puro).
async function observeIncomingMessage(event, message, { now = new Date() } = {}) {
  try {
    if (event.type !== "text" || !event.text) return null;

    // Item 17: pausa por conversa checada ANTES de rodar o motor — nem
    // interpretação/estado avançam para esta conversa enquanto pausada.
    if (await isObservationPausedForConversation(message.conversationId)) return null;

    const result = await orchestrate({
      conversationId: message.conversationId,
      messageId: message.id,
      channel: "META",
      message: event.text,
      now,
      executionMode: "OBSERVATION",
    });
    if (!result) return null;

    // Item 8/11: a PRÓXIMA mensagem do cliente depois de uma resposta real de
    // atendente pode conter um sinal de resultado ("funcionou"/"não
    // resolveu") — nunca inferido do silêncio do cliente, só de um padrão
    // reconhecido explicitamente. Roda independente do toggle de observação
    // abaixo (é sobre uma resposta HUMANA já registrada, não sobre este
    // Bot decidir algo novo). Isolado em seu próprio try/catch: uma falha
    // aqui nunca pode transformar a observação principal em ERROR.
    try {
      const signal = detectResolutionSignal([{ direction: "RECEBIDA", text: event.text }]);
      if (signal) {
        const pendingComparison = await prisma.botObservation.findFirst({
          where: {
            conversationId: message.conversationId,
            actualAgentReplyText: { not: null },
            customerReactionSignal: null,
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (pendingComparison) {
          await prisma.botObservation.update({
            where: { id: pendingComparison.id },
            data: { customerReactionSignal: signal, customerReactionAt: now },
          });
        }
      }
    } catch (error) {
      console.error("[BOT_OBSERVATION] falha ao registrar sinal de resolução (ignorada)", error.message);
    }

    // Toggle global + por Bot ("Observação"), agora também considerando o
    // item 6 (observeActiveConversations) quando um humano já assumiu a
    // conversa — calculado dentro de orchestrate(). Interpretar continua
    // rodando (é o que garante o estado da conversa/proteções ficarem
    // corretos), só o registro/log é que fica condicionado ao toggle.
    if (!result.observationAllowed) return result;

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
      toolName: result.toolName || null,
      knowledgeSourceId: result.knowledgeSourceId || null,
      calledExternalAi: Boolean(result.calledExternalAi),
      flowResolutionStatus: result.flowResolutionStatus || null,
      durationMs: result.durationMs ?? null,
    }));

    const suggestedQuickReply = await suggestQuickReplySafely(result.intentId);

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
        localConfidence: result.localConfidence ?? null,
        finalConfidence: result.finalConfidence ?? null,
        aiModel: result.aiModel || null,
        durationMs: result.durationMs ?? null,
        handoffReason: result.handoffReason || null,
        action: result.action,
        extractedEntities: result.extractedEntities || {},
        toolName: result.toolName || null,
        knowledgeSourceId: result.knowledgeSourceId || null,
        knowledgeSourceTitle: result.knowledgeSourceTitle || null,
        calledExternalAi: Boolean(result.calledExternalAi),
        flowStepId: result.flowStepId || null,
        flowResolutionStatus: result.flowResolutionStatus || null,
        // Item 7 (sugestão para o atendente): o texto que o motor calcularia
        // para esta mensagem — nunca enviado automaticamente, só fica
        // disponível para o atendente usar quando já assumiu a conversa
        // (bot-suggestion-service.js). Item 4: se esta mensagem trocou de
        // assunto no meio de um fluxo em andamento.
        suggestedResponseText: result.suggestedResponseText || null,
        topicSwitchDetected: Boolean(result.topicSwitchDetected),
        provider: result.provider,
        mode: "OBSERVATION",
        status: result.status,
        errorCode: result.errorCode,
        suggestedQuickReplyId: suggestedQuickReply?.id || null,
        suggestedQuickReplyName: suggestedQuickReply?.name || null,
      },
    });

    // Item 22 (tempo real): publica DEPOIS que a observação/sugestão já
    // foram gravadas — nunca antes, senão um cliente que reage ao evento SSE
    // pode buscar a sugestão antes dela existir.
    publishSafely();

    return result;
  } catch (error) {
    // Item 15 (idempotência por messageId): uma segunda tentativa de
    // observar a MESMA mensagem (retry de rede, corrida entre duas chamadas)
    // esbarra na constraint única de messageId — isso não é uma falha real
    // de observação, só significa "já foi analisada", então nunca grava um
    // registro de erro por cima.
    if (error.code === "P2002") return null;

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

// Item 7/8/10/13 (observar resposta do atendente / comparação Bot x
// Humano): chamado a partir de message-service.js logo depois que um
// ATENDENTE (humano) envia uma resposta de texto real. Nunca bloqueia o
// envio (sempre chamado "fire-and-forget" por quem invoca) e nunca lança —
// toda falha é engolida aqui mesmo. Liga a resposta real à observação mais
// recente desta conversa que ainda não tinha uma resposta de atendente
// associada (a sugestão que o motor teria dado para a última mensagem do
// cliente), permitindo comparar depois `suggestedResponseText` (Bot) x
// `actualAgentReplyText` (Humano) — nunca usado para ranking individual.
async function observeAgentReply({ conversationId, replyText, sentByUserId, now = new Date() }) {
  try {
    if (!conversationId || !replyText || !sentByUserId) return null;
    if (await isObservationPausedForConversation(conversationId)) return null;

    // Item 6 (observação de conversas ATIVAS): esta é a camada NOVA desta
    // fase (comparar sugestão x resposta real do atendente) — só roda
    // quando explicitamente ligada (global + por Bot), default OFF. Nunca
    // afeta a observação "de sempre" das mensagens do cliente (sempre
    // ligada por observationEnabled, ver bot-orchestrator-service.js).
    const { getState } = require("./bot-conversation-state-service");
    const { getGlobalSettings, resolveFeatureFlags } = require("./bot-governance-service");
    const state = await getState(conversationId);
    if (!state?.activeBotId) return null;
    const [globalSettings, bot] = await Promise.all([
      getGlobalSettings(),
      prisma.bot.findUnique({ where: { id: state.activeBotId }, select: { featureFlags: true } }),
    ]);
    const flags = resolveFeatureFlags(bot);
    if (!globalSettings.observeActiveConversations || !flags.observeActiveConversations) return null;

    const pendingObservation = await prisma.botObservation.findFirst({
      where: { conversationId, actualAgentReplyText: null, status: "OK" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!pendingObservation) return null;

    await prisma.botObservation.update({
      where: { id: pendingObservation.id },
      data: {
        actualAgentReplyText: replyText,
        actualAgentUserId: sentByUserId,
        actualAgentRepliedAt: now,
      },
    });
    publishSafely();
    return pendingObservation.id;
  } catch (error) {
    console.error("[BOT_OBSERVATION] falha ao observar resposta do atendente (ignorada)", error.message);
    return null;
  }
}

// Item 2/21 ("Decisões do Bot"/"Assistente do Bot" na tela de conversa):
// cronológico, só de UMA conversa — nunca a listagem administrativa pesada
// de bot-service.js:listObservations (Master-only, todos os Bots). Qualquer
// pessoa que já pode ver a conversa (assertCanViewConversation) pode ver as
// decisões dela.
async function listDecisionsForConversation(conversationId, viewer, { limit = 30 } = {}) {
  await authorization.assertCanViewConversation(viewer, conversationId);
  const take = Number.isInteger(Number(limit)) && limit > 0 && limit <= 100 ? Number(limit) : 30;
  const [rows, state] = await Promise.all([
    prisma.botObservation.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true, createdAt: true, messageId: true, botId: true, botName: true,
        intentId: true, intentName: true, localConfidence: true, finalConfidence: true, confidence: true,
        flowStepId: true, extractedEntities: true, knowledgeSourceId: true, knowledgeSourceTitle: true,
        toolName: true, calledExternalAi: true, provider: true, aiModel: true, action: true,
        handoffReason: true, flowResolutionStatus: true, durationMs: true, status: true, errorCode: true,
        suggestedResponseText: true, actualAgentReplyText: true, actualAgentUserId: true,
        actualAgentRepliedAt: true, customerReactionSignal: true, customerReactionAt: true,
      },
    }),
    prisma.conversationBotState.findUnique({ where: { conversationId }, select: { observationPausedAt: true } }),
  ]);
  return { observationPaused: Boolean(state?.observationPausedAt), decisions: rows };
}

// Item 17: liga/desliga a pausa de observação só desta conversa. Usa upsert
// porque uma conversa nova (nenhuma mensagem ainda passou pelo motor) pode
// não ter ConversationBotState criado.
async function setConversationObservationPaused(conversationId, paused, actor) {
  await authorization.assertCanViewConversation(actor, conversationId);
  const value = paused ? new Date() : null;
  return prisma.conversationBotState.upsert({
    where: { conversationId },
    create: { conversationId, observationPausedAt: value },
    update: { observationPausedAt: value },
  });
}

module.exports = {
  observeIncomingMessage, observeAgentReply, listDecisionsForConversation, setConversationObservationPaused,
};
