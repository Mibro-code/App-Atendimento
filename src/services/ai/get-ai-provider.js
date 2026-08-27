// Ponto único de escolha do provider de IA externa. Cada provider (Anthropic,
// Gemini) só é instanciado se a variável de ambiente correspondente existir
// — sem credencial, a aplicação continua funcionando normalmente usando
// apenas o LocalFallbackProvider (correspondência literal/fuzzy). Qual
// provider usar é escolhido NA CONFIGURAÇÃO DO BOT
// (featureFlags.externalAiProvider — ver bot-constants.js/
// bot-governance-service.js), nunca um único provider global fixo: Bots
// diferentes podem escolher providers diferentes.
const { LocalFallbackProvider } = require("./local-fallback-provider");
const { AnthropicProvider } = require("./anthropic-provider");
const { GeminiProvider } = require("./gemini-provider");
const { EXTERNAL_AI_PROVIDERS } = require("../bot-constants");

const localFallbackProvider = new LocalFallbackProvider();

// Registro central de providers externos IMPLEMENTADOS (item 3: "mostrar
// somente providers realmente implementados"). EXTERNAL_AI_PROVIDERS
// (bot-constants.js) é a lista canônica usada pela UI/validação de
// featureFlags; este objeto só sabe COMO instanciar cada um — nunca duplica
// a lista, só implementa contra ela.
const providerFactories = {
  ANTHROPIC: () => new AnthropicProvider(),
  GEMINI: () => new GeminiProvider(),
};

const instances = {}; // { ANTHROPIC: { provider, error }, GEMINI: {...} }

function resolveInstance(name) {
  if (!providerFactories[name]) return null;
  if (instances[name]) return instances[name];
  const entry = { provider: null, error: null };
  try {
    entry.provider = providerFactories[name]();
  } catch (error) {
    entry.error = error.message;
  }
  instances[name] = entry;
  return entry;
}

// `providerName` vem de Bot.featureFlags.externalAiProvider. Sem credencial
// configurada para o provider escolhido (ou provider desconhecido), cai
// para o provider local — nunca quebra a aplicação.
function getPrimaryProvider(providerName) {
  const entry = resolveInstance(providerName);
  if (entry?.provider) return { provider: entry.provider, name: providerName };
  return { provider: localFallbackProvider, name: "LOCAL_FALLBACK" };
}

function getFallbackProvider() {
  return { provider: localFallbackProvider, name: "LOCAL_FALLBACK" };
}

// Item 5 (status): Configurado / Não configurado / Erro — nunca expõe a
// credencial, só se ela existe e se a inicialização deu certo.
function getProviderStatus(providerName) {
  if (!providerName || providerName === "LOCAL") {
    return { provider: "LOCAL", configured: true, error: null };
  }
  if (!EXTERNAL_AI_PROVIDERS.includes(providerName)) {
    return { provider: providerName, configured: false, error: "Provider não implementado." };
  }
  const entry = resolveInstance(providerName);
  return { provider: providerName, configured: Boolean(entry?.provider), error: entry?.error || null };
}

// Item 6 ("Testar conexão"): chamada real mínima só para validar a
// credencial/rede — nunca usada no caminho quente de interpretação. Nunca
// derruba a aplicação: falha vira { ok: false, error }, sem jamais incluir a
// credencial na resposta.
async function testConnection(providerName) {
  if (providerName === "LOCAL") return { ok: true, latencyMs: 0 };
  const entry = resolveInstance(providerName);
  if (!entry?.provider) return { ok: false, error: entry?.error || "Provider não configurado." };
  const startedAt = Date.now();
  try {
    await entry.provider.classifyIntent({ bot: { intents: [] }, message: "teste de conexão", context: [] });
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    // Nunca vaza a credencial — só o código/mensagem já normalizados pelo
    // provider (ex.: AUTH_ERROR/RATE_LIMIT/QUOTA_EXCEEDED/TIMEOUT no Gemini).
    return { ok: false, error: error.message, code: error.code || null };
  }
}

module.exports = {
  getFallbackProvider, getPrimaryProvider, getProviderStatus, testConnection,
};
