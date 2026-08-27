// Ponto único de escolha do provider de IA. Se ANTHROPIC_API_KEY não estiver
// configurada, a aplicação continua funcionando normalmente usando apenas o
// LocalFallbackProvider (correspondência literal/fuzzy), como antes desta fase.
const { LocalFallbackProvider } = require("./local-fallback-provider");
const { AnthropicProvider } = require("./anthropic-provider");

const localFallbackProvider = new LocalFallbackProvider();
let anthropicProvider = null;
let anthropicInitError = null;

if (process.env.ANTHROPIC_API_KEY) {
  try {
    anthropicProvider = new AnthropicProvider();
  } catch (error) {
    anthropicInitError = error.message;
  }
}

function getPrimaryProvider() {
  return anthropicProvider ? { provider: anthropicProvider, name: "ANTHROPIC" } : { provider: localFallbackProvider, name: "LOCAL_FALLBACK" };
}

function getFallbackProvider() {
  return { provider: localFallbackProvider, name: "LOCAL_FALLBACK" };
}

// Item 14 (UI "Motor de IA"): status sem NUNCA expor a credencial — só se
// está configurada/qual provider/erro de inicialização, se houver.
function getProviderStatus() {
  return {
    provider: "ANTHROPIC",
    configured: Boolean(anthropicProvider),
    error: anthropicInitError,
  };
}

// Item 14 ("testar conexão"): chamada real mínima só para validar a
// credencial/rede — nunca usada no caminho quente de interpretação. Nunca
// derruba a aplicação: falha vira { ok: false, error }.
async function testConnection() {
  if (!anthropicProvider) return { ok: false, error: anthropicInitError || "Provider não configurado." };
  const startedAt = Date.now();
  try {
    await anthropicProvider.classifyIntent({ bot: { intents: [] }, message: "teste de conexão", context: [] });
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = {
  anthropicInitError, getFallbackProvider, getPrimaryProvider, getProviderStatus, testConnection,
};
