// Orquestrador: decide QUAL Bot atende uma conversa e amarra
// interpret() -> decide() -> respond() num resultado padronizado único,
// aplicando a camada de governança (feature flags, apresentação, proteção
// contra loop/ping-pong, kill switch/pausa por humano). Usado tanto pelo
// modo observação (mensagens reais) quanto, com estado totalmente separado,
// pelo simulador multi-turno da tela de Bots.
const prisma = require("../database/prisma");
const { interpret } = require("./bot-interpreter-service");
const { decide } = require("./bot-decision-service");
const { respond } = require("./bot-response-service");
const { getState, getRecentContext, persistDecision } = require("./bot-conversation-state-service");
const { getGlobalSettings, renderPresentationMessage, resolveFeatureFlags } = require("./bot-governance-service");
const { checkResponseLoop, checkSwitchWindow } = require("./bot-loop-guard-service");

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

// Sessão "expirada": o estado operacional (intenção pendente, falhas,
// esclarecimento em aberto) não pode ser tratado como verdade para uma nova
// conversa — não apaga histórico real, só reinicia o estado do Bot.
function isSessionExpired(state, flags, now) {
  if (!state?.updatedAt) return false;
  const elapsedMinutes = (now.getTime() - new Date(state.updatedAt).getTime()) / 60000;
  return elapsedMinutes > flags.contextExpirationMinutes;
}

function toStandardResult({ bot, targetBot, interpretation, decision, responseText, extras = {} }) {
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
    socialBehavior: interpretation.socialBehavior || null,
    extractedEntities: interpretation.entities,
    summary: decision.summary,
    response: responseText,
    ...extras,
  };
}

// Núcleo compartilhado por orchestrate() (conversa real) e
// simulateOrchestration() (simulador): interpreta, decide, aplica proteção
// de loop/ping-pong e apresentação. Quem chama decide o que persistir.
// `state` alimenta interpret()/decide() (memória conversacional: intenção
// pendente, falhas, entidades) — pode ser null se contextEnabled estiver
// desligado ou a sessão tiver expirado. `guardState` alimenta as proteções
// de loop/troca de Bot/apresentação — só é null quando a sessão realmente
// expirou (essas proteções não dependem de contextEnabled).
async function runDecisionPipeline({ bot, message, context, state, guardState, flags, now, channel, client, sessionExpired = false }) {
  const interpretation = await interpret({ bot, message, context, state });
  let decision = decide({ bot, interpretation, message, state, now, flags });

  let targetBot = bot;
  let switchInfo = {
    switchCount: guardState?.switchCount ?? 0,
    switchWindowStartedAt: guardState?.switchWindowStartedAt ?? null,
  };
  if (decision.action === "SWITCH_BOT" && decision.categoryId) {
    if (flags.autoSwitchEnabled === false) {
      decision = { ...decision, action: "RESPOND" };
    } else {
      const switchCheck = checkSwitchWindow(guardState, flags, now);
      switchInfo = { switchCount: switchCheck.switchCount, switchWindowStartedAt: switchCheck.switchWindowStartedAt };
      if (!switchCheck.allowed) {
        decision = {
          ...decision, action: "HANDOFF_HUMAN", shouldHandoff: true,
          summary: `${decision.summary} Limite de trocas de Bot na janela recente atingido (proteção contra ping-pong); encaminhando para humano.`,
        };
      } else {
        const candidate = await resolveSwitchTarget(decision.categoryId, channel, bot.id, client);
        if (candidate) targetBot = candidate;
      }
    }
  }

  let responseText = respond({ bot: targetBot, decision, interpretation });

  const priorIntroducedAt = guardState?.introducedAt || null;
  const shouldIntroduce = Boolean(targetBot.introduceWithName) && Boolean(responseText)
    && (!priorIntroducedAt || sessionExpired);
  if (shouldIntroduce) {
    const presentation = renderPresentationMessage(targetBot.presentationMessage, { botName: targetBot.name });
    responseText = `${presentation} ${responseText}`;
  }

  const loopCheck = checkResponseLoop(guardState, responseText);
  if (loopCheck.looped && !["HANDOFF_HUMAN", "NO_ACTION"].includes(decision.action)) {
    decision = {
      ...decision, action: "HANDOFF_HUMAN", shouldHandoff: true,
      summary: `${decision.summary} A mesma resposta se repetiu; proteção contra loop encaminhou para humano.`,
    };
    responseText = respond({ bot: targetBot, decision, interpretation });
  }
  const finalLoop = checkResponseLoop(guardState, responseText);

  const operational = {
    ...switchInfo,
    introducedAt: shouldIntroduce ? now : priorIntroducedAt,
    lastResponseHash: finalLoop.hash,
    lastResponseRepeatCount: finalLoop.repeatCount,
  };

  return { interpretation, decision, targetBot, responseText, operational };
}

// Interpreta e decide para uma conversa REAL, persistindo o estado do Bot
// nessa conversa (ConversationBotState). Não altera Conversation/Message.
async function orchestrate({ conversationId, channel = "META", messageId = null, message, now = new Date() }, client = prisma) {
  const state = await getState(conversationId, client);
  const bot = await resolveBot(state?.activeBotId, channel, client);
  if (!bot) return null;

  const globalSettings = await getGlobalSettings(client);
  const flags = resolveFeatureFlags(bot);
  const sessionExpired = isSessionExpired(state, flags, now);
  const conversationalState = flags.contextEnabled && !sessionExpired ? state : null;
  const operationalState = sessionExpired ? null : state;

  const context = flags.contextEnabled
    ? await getRecentContext(conversationId, { beforeMessageId: messageId, limit: flags.contextMaxMessages }, client)
    : [];

  const { interpretation, decision, targetBot, responseText, operational } = await runDecisionPipeline({
    bot, message, context, state: conversationalState, guardState: operationalState,
    flags, now, channel, client, sessionExpired,
  });

  let humanPaused = false;
  if (flags.handoffAutoPauseEnabled) {
    const conversation = await client.conversation.findUnique({
      where: { id: conversationId }, select: { assignedUserId: true, status: true },
    });
    humanPaused = Boolean(conversation?.assignedUserId)
      && ["EM_ATENDIMENTO", "AGUARDANDO_RESPOSTA"].includes(conversation?.status);
  }
  const automationBlocked = !globalSettings.automationEnabled || !targetBot.autoReplyEnabled;
  const observationAllowed = globalSettings.observationEnabled && flags.observationEnabled;

  await persistDecision({
    conversationId, bot: targetBot, interpretation, decision,
    operational: { ...operational, humanPausedAt: humanPaused ? now : null },
  }, client);

  return toStandardResult({
    bot, targetBot, interpretation, decision, responseText,
    extras: { humanPaused, automationBlocked, observationAllowed, learningEnabled: flags.learningEnabled },
  });
}

// Mesma interpretação, mas para o simulador: usa um "estado" transitório
// fornecido pelo cliente (nunca a tabela ConversationBotState) e nunca troca
// de Bot fora da lista de Bots ativos do canal — apenas sinaliza a sugestão.
async function simulateOrchestration({ bot, message, context = [], state = null, now = new Date() }) {
  // O simulador deve permitir testar configurações em rascunho sem ativá-las
  // no modo observação. A cópia em memória nunca é persistida.
  const simulationBot = bot.status === "ACTIVE" ? bot : { ...bot, status: "ACTIVE" };
  const flags = resolveFeatureFlags(simulationBot);

  const { interpretation, decision, targetBot: simulatedTargetBot, responseText, operational } = await runDecisionPipeline({
    bot: simulationBot, message, context, state, guardState: state, flags, now, channel: bot.channel, client: prisma,
    sessionExpired: false,
  });
  const targetBot = simulatedTargetBot.id === simulationBot.id ? bot : simulatedTargetBot;

  const nextState = {
    activeBotId: targetBot.id,
    lastIntentId: interpretation.intentId || null,
    lastConfidence: interpretation.confidence ?? null,
    failedInterpretations: decision.action === "ASK_CLARIFICATION" || decision.action === "HANDOFF_HUMAN"
      ? (decision.failureCount ?? 0) : 0,
    pendingClarification: decision.needsClarification || false,
    extractedEntities: interpretation.entities || {},
    ...operational,
  };

  return { ...toStandardResult({ bot, targetBot, interpretation, decision, responseText }), nextState };
}

module.exports = { botInclude, orchestrate, resolveBot, simulateOrchestration };
