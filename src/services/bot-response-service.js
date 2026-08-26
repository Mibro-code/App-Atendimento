// Camada de RESPOSTA: monta o texto que seria enviado, a partir de uma
// decisão já tomada. Função pura — nunca envia nada, nunca acessa o banco.
// Uma intenção com resposta configurada continua tendo prioridade; a IA só
// ajuda na interpretação (bot-interpreter-service.js), não na redação livre.
const genericClarificationQuestions = [
  "Não tenho certeza se entendi. Você pode explicar com mais detalhes o que precisa?",
  "Para te ajudar melhor, você pode me dizer, em poucas palavras, qual é o assunto? Por exemplo: pedido, garantia ou dúvida sobre produto.",
];
const negationClarificationQuestion = "Sem problemas! Pode me contar, com suas palavras, o que você precisa?";

const handoffMessage = "Vou te encaminhar para um de nossos atendentes, só um instante.";

// Respostas curtas para comportamento puramente social (sem intenção de
// negócio junto). GREETING usa decision.greetingReply, que já ecoa o
// cumprimento do cliente ("Boa tarde!"), por isso não aparece aqui.
const socialReplies = {
  THANKS: "Por nada! Qualquer coisa, é só chamar.",
  GOODBYE: "Até mais! Se precisar de algo, é só chamar por aqui.",
  SMALL_TALK: "Sou o assistente virtual da Mibro, por aqui para ajudar com pedidos, produtos e suporte. Como posso ajudar?",
};

function findIntent(bot, intentId) {
  return (bot.intents || []).find((intent) => intent.id === intentId) || null;
}

// Prefixa a resposta de negócio com o cumprimento quando a mensagem
// combinava saudação + intenção (ex.: "boa tarde, meu pedido não chegou").
function withGreetingPrefix(decision, text) {
  if (!decision.greetingReply) return text;
  return `${decision.greetingReply} ${text}`;
}

function respond({ bot, decision, interpretation }) {
  if (decision.action === "NO_ACTION") return null;
  if (decision.outsideHours) return bot.outsideHoursMessage;

  // Flow Engine (múltiplas etapas): quando presente, o texto já foi montado
  // pelo motor de fluxo (bot-flow-service.js) a partir só das etapas
  // configuradas (pergunta, conhecimento real, resultado real de Tool ou
  // mensagem de encerramento) — tem prioridade sobre tudo abaixo, igual a
  // toolResponseText/knowledgeResponseText nunca inventam nada por cima.
  if (decision.flowResponseText) return withGreetingPrefix(decision, decision.flowResponseText);

  if (!interpretation.intentId && decision.socialBehavior && decision.socialBehavior !== "NEGATION") {
    if (decision.socialBehavior === "GREETING") return `${decision.greetingReply} Como posso te ajudar?`;
    return socialReplies[decision.socialBehavior] || bot.fallbackMessage;
  }

  if (decision.action === "HANDOFF_HUMAN") return withGreetingPrefix(decision, handoffMessage);

  if (decision.action === "ASK_CLARIFICATION") {
    // Itens 5-8: pergunta específica montada pelo orquestrador de Tools
    // quando falta uma entidade obrigatória (ex.: "Pode me informar o
    // número do pedido?") tem prioridade sobre as genéricas.
    if (decision.clarificationQuestion) return withGreetingPrefix(decision, decision.clarificationQuestion);
    if (decision.socialBehavior === "NEGATION") return negationClarificationQuestion;
    const intent = findIntent(bot, interpretation.intentId);
    if (intent) return withGreetingPrefix(decision, `Você quis dizer "${intent.name}"? Pode confirmar ou me dar mais detalhes?`);
    const index = Math.min((decision.failureCount || 1) - 1, genericClarificationQuestions.length - 1);
    return withGreetingPrefix(decision, genericClarificationQuestions[index]);
  }

  // Itens 7/8/10: quando a decisão foi resolvida a partir de uma Tool
  // (bot-tool-orchestrator-service.js), o texto já foi montado só com dados
  // reais devolvidos pela Tool (nunca inventado aqui). Tem prioridade sobre
  // a resposta configurada da intenção.
  if (decision.toolResponseText) return withGreetingPrefix(decision, decision.toolResponseText);

  // Item 4: resposta vinda da Base de Conhecimento (bot-knowledge-response-
  // service.js), só quando a intenção não tinha resposta fixa configurada.
  if (decision.knowledgeResponseText) return withGreetingPrefix(decision, decision.knowledgeResponseText);

  // RESPOND e SWITCH_BOT usam a mesma resposta configurada: a troca de Bot é
  // interna, o cliente não deve perceber que "outro robô" assumiu.
  const intent = findIntent(bot, interpretation.intentId);
  return withGreetingPrefix(decision, intent?.responseMessage || bot.fallbackMessage);
}

module.exports = { respond };
