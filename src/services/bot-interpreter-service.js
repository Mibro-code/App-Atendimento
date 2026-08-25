// Camada de INTERPRETAÇÃO: transforma uma mensagem em { intentId, confidence,
// entities }. Não decide ação (bot-decision-service.js) nem monta texto de
// resposta (bot-response-service.js). Nunca lança erro para quem chama: toda
// falha vira { status: "PROVIDER_ERROR", ... } com fallback local aplicado.
const { normalizeText } = require("./bot-simulator-service");
const { extractEntities, mergeEntities } = require("./bot-entity-extractor");
const { getPrimaryProvider, getFallbackProvider } = require("./ai/get-ai-provider");

const affirmativePattern = /^(sim|s|ok|okay|claro|pode ser|isso|isso mesmo|exatamente|confirmo|correto)[.!]*$/;

function findIntent(bot, intentId) {
  if (!intentId) return null;
  return (bot.intents || []).find((intent) => intent.id === intentId) || null;
}

// Curto-circuito de contexto: "sim" após uma pergunta de esclarecimento deve
// reafirmar a última intenção, sem precisar de um provider para isso.
function carryOverFromContext(bot, normalizedMessage, state) {
  if (!state?.pendingClarification || !state?.lastIntentId) return null;
  if (!affirmativePattern.test(normalizedMessage)) return null;
  const intent = findIntent(bot, state.lastIntentId);
  if (!intent) return null;
  return {
    intentId: intent.id,
    confidence: Math.max(state.lastConfidence || 0, 0.75),
    matchedExample: null,
    providerName: "CONTEXT_CARRYOVER",
    entities: {},
  };
}

async function runProvider(providerEntry, { bot, message, context }) {
  const classification = await providerEntry.provider.classifyIntent({ bot, message, context });
  return classification ? { ...classification, providerName: providerEntry.name } : null;
}

// Núcleo testável: recebe os providers já resolvidos (permite injetar dublês
// nos testes sem depender de rede ou de variáveis de ambiente). `interpret()`
// abaixo é a versão de uso normal, que resolve os providers reais.
async function interpretWithProviders({ bot, message, context = [], state = null, primary, fallback }) {
  const normalizedMessage = normalizeText(message);
  const localEntities = extractEntities(message);

  if (!normalizedMessage) {
    return {
      intentId: null, intentName: null, confidence: 0, matchedExample: null,
      entities: localEntities, provider: "NONE", status: "EMPTY_MESSAGE", errorCode: null,
    };
  }

  const carryOver = carryOverFromContext(bot, normalizedMessage, state);
  if (carryOver) {
    return {
      intentId: carryOver.intentId,
      intentName: findIntent(bot, carryOver.intentId)?.name || null,
      confidence: carryOver.confidence,
      matchedExample: null,
      entities: mergeEntities(localEntities, carryOver.entities),
      provider: carryOver.providerName,
      status: "OK",
      errorCode: null,
    };
  }

  let result = null;
  let status = "OK";
  let errorCode = null;

  try {
    result = await runProvider(primary, { bot, message, context });
  } catch (error) {
    status = "PROVIDER_ERROR";
    errorCode = error.code || "PROVIDER_REQUEST_FAILED";
  }

  if ((!result || status === "PROVIDER_ERROR") && primary.name !== fallback.name) {
    try {
      const fallbackResult = await runProvider(fallback, { bot, message, context });
      if (fallbackResult) {
        result = fallbackResult;
        if (status !== "PROVIDER_ERROR") status = "OK";
      }
    } catch (_error) {
      // O fallback local não deveria falhar; se falhar, seguimos sem intenção.
    }
  } else if (!result && status === "OK") {
    // Provider único (ou já era o fallback) respondeu sem intenção correspondente.
    status = "OK";
  }

  if (!result) {
    return {
      intentId: null, intentName: null, confidence: 0, matchedExample: null,
      entities: localEntities, provider: status === "PROVIDER_ERROR" ? fallback.name : primary.name,
      status, errorCode,
    };
  }

  const intent = findIntent(bot, result.intentId);
  return {
    intentId: intent ? intent.id : null,
    intentName: intent ? intent.name : null,
    confidence: intent ? Math.min(1, Math.max(0, Number(result.confidence) || 0)) : 0,
    matchedExample: result.matchedExample || null,
    entities: mergeEntities(localEntities, result.entities),
    provider: result.providerName,
    status,
    errorCode,
  };
}

async function interpret({ bot, message, context = [], state = null }) {
  return interpretWithProviders({
    bot, message, context, state, primary: getPrimaryProvider(), fallback: getFallbackProvider(),
  });
}

module.exports = { interpret, interpretWithProviders };
