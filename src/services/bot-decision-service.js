// Camada de DECISÃO: recebe uma interpretação já pronta e decide o que fazer
// (bot-interpreter-service.js não sabe nada sobre ações). Não gera texto de
// resposta (isso é bot-response-service.js) nem envia nada a ninguém.
const { scheduleState } = require("./bot-simulator-service");
const { detectSocialBehavior } = require("./bot-social-behavior-service");
const { MAX_FAILED_INTERPRETATIONS, confidenceBand } = require("./bot-constants");

function findIntent(bot, intentId) {
  return (bot.intents || []).find((intent) => intent.id === intentId) || null;
}

function decide({ bot, interpretation, message, state = null, now = new Date(), flags = {} }) {
  if (bot.status !== "ACTIVE") {
    return {
      action: "NO_ACTION", categoryId: null, needsClarification: false,
      shouldHandoff: false, withinHours: null, summary: "Bot pausado ou arquivado: nenhuma ação é tomada.",
    };
  }

  const hours = scheduleState(bot, now);
  if (!hours.withinHours) {
    return {
      action: "RESPOND", categoryId: null, needsClarification: false, shouldHandoff: false,
      withinHours: false, outsideHours: true, summary: "Fora do horário configurado para este Bot.",
    };
  }

  const { socialBehavior, greetingReply } = detectSocialBehavior(message);

  if (socialBehavior === "HUMAN_REQUEST") {
    return {
      action: "HANDOFF_HUMAN", categoryId: bot.defaultCategoryId || null, needsClarification: false,
      shouldHandoff: true, withinHours: true, socialBehavior,
      summary: "Cliente pediu para falar com um atendente humano.",
    };
  }

  // Mensagem puramente social (ex.: "bom dia", "obrigado"), sem nenhuma
  // intenção de negócio reconhecida junto: responde com o comportamento
  // social e NÃO conta como falha de interpretação. Desligável por Bot
  // (conversationalBehaviorEnabled) — HUMAN_REQUEST acima nunca é afetado.
  if (flags.conversationalBehaviorEnabled !== false && !interpretation.intentId && socialBehavior && socialBehavior !== "NEGATION") {
    return {
      action: "RESPOND", categoryId: null, needsClarification: false, shouldHandoff: false,
      withinHours: true, socialBehavior, greetingReply,
      summary: `Comportamento social identificado (${socialBehavior}), sem intenção de negócio associada.`,
    };
  }

  const priorFailures = state?.failedInterpretations || 0;
  const band = interpretation.intentId ? confidenceBand(bot, interpretation.confidence) : "LOW";

  if (!interpretation.intentId || band === "LOW") {
    const failureCount = priorFailures + 1;
    if (failureCount >= MAX_FAILED_INTERPRETATIONS) {
      return {
        action: "HANDOFF_HUMAN", categoryId: bot.defaultCategoryId || null, needsClarification: false,
        shouldHandoff: true, withinHours: true, failureCount, socialBehavior,
        summary: "Cliente não foi compreendido após múltiplas tentativas; encaminhar para humano.",
      };
    }
    return {
      action: "ASK_CLARIFICATION", categoryId: null, needsClarification: true, shouldHandoff: false,
      withinHours: true, failureCount, socialBehavior,
      summary: socialBehavior === "NEGATION"
        ? "Cliente indicou que a intenção sugerida está errada; pedir para descrever o que precisa."
        : (failureCount >= 2
          ? "Segunda tentativa sem entender o cliente; fazer uma pergunta mais objetiva."
          : "Mensagem não identificada com confiança; pedir esclarecimento ao cliente."),
    };
  }

  const intent = findIntent(bot, interpretation.intentId);
  const categoryId = intent?.categoryId || null;

  if (band === "MEDIUM") {
    return {
      action: "ASK_CLARIFICATION", categoryId, needsClarification: true, shouldHandoff: false,
      withinHours: true, socialBehavior, greetingReply,
      summary: `Confiança média para "${intent?.name}"; confirmar com o cliente antes de prosseguir.`,
    };
  }

  if (intent?.fallbackAction === "TRANSFER_TO_HUMAN") {
    return {
      action: "HANDOFF_HUMAN", categoryId, needsClarification: false, shouldHandoff: true,
      withinHours: true, socialBehavior, greetingReply,
      summary: `Intenção "${intent.name}" configurada para encaminhamento humano.`,
    };
  }

  if (flags.autoSwitchEnabled !== false && intent?.fallbackAction === "TRANSFER_TO_CATEGORY" && categoryId) {
    return {
      action: "SWITCH_BOT", categoryId, needsClarification: false, shouldHandoff: false,
      withinHours: true, socialBehavior, greetingReply,
      summary: `Cliente deseja tratar de "${intent.name}"; avaliar troca de Bot responsável pela categoria.`,
    };
  }

  return {
    action: "RESPOND", categoryId, needsClarification: false, shouldHandoff: false,
    withinHours: true, socialBehavior, greetingReply,
    summary: `Cliente demonstrou a intenção "${intent?.name}".`,
  };
}

module.exports = { decide };
