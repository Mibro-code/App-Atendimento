// Camada de RESPOSTA: monta o texto que seria enviado, a partir de uma
// decisão já tomada. Função pura — nunca envia nada, nunca acessa o banco.
// Uma intenção com resposta configurada continua tendo prioridade; a IA só
// ajuda na interpretação (bot-interpreter-service.js), não na redação livre.
const genericClarificationQuestions = [
  "Não tenho certeza se entendi. Você pode explicar com mais detalhes o que precisa?",
  "Para te ajudar melhor, você pode me dizer, em poucas palavras, qual é o assunto? Por exemplo: pedido, garantia ou dúvida sobre produto.",
];

const handoffMessage = "Vou te encaminhar para um de nossos atendentes, só um instante.";

function findIntent(bot, intentId) {
  return (bot.intents || []).find((intent) => intent.id === intentId) || null;
}

function respond({ bot, decision, interpretation }) {
  if (decision.action === "NO_ACTION") return null;
  if (decision.outsideHours) return bot.outsideHoursMessage;
  if (decision.action === "HANDOFF_HUMAN") return handoffMessage;

  if (decision.action === "ASK_CLARIFICATION") {
    const intent = findIntent(bot, interpretation.intentId);
    if (intent) return `Você quis dizer "${intent.name}"? Pode confirmar ou me dar mais detalhes?`;
    const index = Math.min((decision.failureCount || 1) - 1, genericClarificationQuestions.length - 1);
    return genericClarificationQuestions[index];
  }

  // RESPOND e SWITCH_BOT usam a mesma resposta configurada: a troca de Bot é
  // interna, o cliente não deve perceber que "outro robô" assumiu.
  const intent = findIntent(bot, interpretation.intentId);
  return intent?.responseMessage || bot.fallbackMessage;
}

module.exports = { respond };
