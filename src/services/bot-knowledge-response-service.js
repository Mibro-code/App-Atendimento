// Item 4: separa claramente INTERPRETAR (bot-interpreter-service.js) / criar
// escolher a ação (bot-decision-service.js) / BUSCAR CONHECIMENTO (aqui) /
// RESPONDER (bot-response-service.js) como passos distintos, nunca
// misturados numa função só. Roda depois de decide() e antes de respond():
// se a decisão já é RESPOND para uma intenção reconhecida, tenta enriquecer
// com uma resposta vinda da Base de Conhecimento (KnowledgeSource). Se nada
// confiável for encontrado, NUNCA inventa — a decisão volta inalterada e
// bot-response-service.js cai na resposta configurada da intenção/fallback
// normalmente (item 10: nunca fabricar).
const { KnowledgeSourceProvider } = require("./bot-knowledge/knowledge-provider");

const defaultProvider = new KnowledgeSourceProvider();

function findIntent(bot, intentId) {
  return (bot.intents || []).find((intent) => intent.id === intentId) || null;
}

async function resolveKnowledgeResponse({ bot, decision, interpretation, message, flags = {}, provider = defaultProvider }) {
  if (decision.action !== "RESPOND") return decision;
  if (flags.knowledgeBaseEnabled !== true) return decision;
  if (!interpretation.intentId) return decision;

  const intent = findIntent(bot, interpretation.intentId);
  // Uma intenção com resposta já configurada continua tendo prioridade —
  // Base de Conhecimento só complementa intenções sem resposta fixa, para
  // não sobrescrever conteúdo que um humano já revisou e aprovou.
  if (intent?.responseMessage) return decision;

  let results = [];
  try {
    results = await provider.search(message, {
      botId: bot.id, intentId: interpretation.intentId, globalIntentId: intent?.globalIntentId || null,
      // Item 5: prioriza o produto/modelo já coletado na conversa (entidade
      // "productName", a mesma extraída/coletada em qualquer etapa do Flow
      // Engine) — "GS Pro 2 não conecta" deve priorizar "Pareamento GS Pro 2"
      // sobre um artigo genérico de conexão.
      product: interpretation.entities?.productName || null,
    });
  } catch (error) {
    // Busca de conhecimento nunca pode derrubar a resposta — degrada para
    // "nada encontrado" e segue o fluxo normal.
    console.error("[BOT_KNOWLEDGE] falha na busca (ignorada)", error.message);
    return decision;
  }
  if (!results.length) return decision;

  // Item 6 (conflito): nunca escolher "no escuro" entre duas fontes válidas
  // e igualmente específicas — a decisão volta inalterada (resposta segura
  // configurada da intenção/fallback), sinalizando o conflito para auditoria.
  if (results.conflict) {
    return { ...decision, knowledgeConflict: true };
  }

  const best = results[0];
  return {
    ...decision,
    knowledgeResponseText: best.content || null,
    knowledgeSourceId: best.id,
    knowledgeSourceTitle: best.title,
    knowledgeSourceVersion: best.version,
  };
}

module.exports = { resolveKnowledgeResponse };
