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

module.exports = { anthropicInitError, getFallbackProvider, getPrimaryProvider };
