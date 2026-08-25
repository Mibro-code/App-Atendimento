// Camada de DECISÃO: recebe uma interpretação já pronta e decide o que fazer
// (bot-interpreter-service.js não sabe nada sobre ações). Não gera texto de
// resposta (isso é bot-response-service.js) nem envia nada a ninguém.
const { normalizeText, scheduleState } = require("./bot-simulator-service");
const {
  HUMAN_HANDOFF_PATTERNS, MAX_FAILED_INTERPRETATIONS, confidenceBand,
} = require("./bot-constants");

function requestsHuman(message) {
  const normalized = normalizeText(message);
  return HUMAN_HANDOFF_PATTERNS.some((pattern) => pattern.test(normalized));
}

function findIntent(bot, intentId) {
  return (bot.intents || []).find((intent) => intent.id === intentId) || null;
}

function decide({ bot, interpretation, message, state = null, now = new Date() }) {
  if (bot.status !== "ACTIVE") {
    return {
      action: "NO_ACTION", categoryId: null, needsClarification: false,
      shouldHandoff: false, withinHours: null, summary: "Bot pausado ou arquivado: nenhuma ação é tomada.",
    };
  }

  if (requestsHuman(message)) {
    return {
      action: "HANDOFF_HUMAN", categoryId: bot.defaultCategoryId || null, needsClarification: false,
      shouldHandoff: true, withinHours: null, summary: "Cliente pediu para falar com um atendente humano.",
    };
  }

  const hours = scheduleState(bot, now);
  if (!hours.withinHours) {
    return {
      action: "RESPOND", categoryId: null, needsClarification: false, shouldHandoff: false,
      withinHours: false, outsideHours: true, summary: "Fora do horário configurado para este Bot.",
    };
  }

  const priorFailures = state?.failedInterpretations || 0;
  const band = interpretation.intentId ? confidenceBand(bot, interpretation.confidence) : "LOW";

  if (!interpretation.intentId || band === "LOW") {
    const failureCount = priorFailures + 1;
    if (failureCount >= MAX_FAILED_INTERPRETATIONS) {
      return {
        action: "HANDOFF_HUMAN", categoryId: bot.defaultCategoryId || null, needsClarification: false,
        shouldHandoff: true, withinHours: true,
        summary: "Cliente não foi compreendido após múltiplas tentativas; encaminhar para humano.",
      };
    }
    return {
      action: "ASK_CLARIFICATION", categoryId: null, needsClarification: true, shouldHandoff: false,
      withinHours: true, failureCount,
      summary: failureCount >= 2
        ? "Segunda tentativa sem entender o cliente; fazer uma pergunta mais objetiva."
        : "Mensagem não identificada com confiança; pedir esclarecimento ao cliente.",
    };
  }

  const intent = findIntent(bot, interpretation.intentId);
  const categoryId = intent?.categoryId || null;

  if (band === "MEDIUM") {
    return {
      action: "ASK_CLARIFICATION", categoryId, needsClarification: true, shouldHandoff: false,
      withinHours: true, summary: `Confiança média para "${intent?.name}"; confirmar com o cliente antes de prosseguir.`,
    };
  }

  if (intent?.fallbackAction === "TRANSFER_TO_HUMAN") {
    return {
      action: "HANDOFF_HUMAN", categoryId, needsClarification: false, shouldHandoff: true,
      withinHours: true, summary: `Intenção "${intent.name}" configurada para encaminhamento humano.`,
    };
  }

  if (intent?.fallbackAction === "TRANSFER_TO_CATEGORY" && categoryId) {
    return {
      action: "SWITCH_BOT", categoryId, needsClarification: false, shouldHandoff: false,
      withinHours: true, summary: `Cliente deseja tratar de "${intent.name}"; avaliar troca de Bot responsável pela categoria.`,
    };
  }

  return {
    action: "RESPOND", categoryId, needsClarification: false, shouldHandoff: false,
    withinHours: true, summary: `Cliente demonstrou a intenção "${intent?.name}".`,
  };
}

module.exports = { decide, requestsHuman };
