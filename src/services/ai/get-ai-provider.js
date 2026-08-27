// Ponto único de escolha do provider de IA externa. Cada provider
// (Anthropic, Gemini, OpenAI) só é instanciado se houver credencial —
// painel primeiro (ai-credential-service.js, cofre cifrado no banco), env
// como compatibilidade (ANTHROPIC_API_KEY/GEMINI_API_KEY/OPENAI_API_KEY,
// para quem prefere continuar gerenciando pela VPS). Sem nenhuma das duas,
// a aplicação continua funcionando normalmente usando apenas o
// LocalFallbackProvider. Qual provider usar é escolhido NA CONFIGURAÇÃO DO
// BOT (featureFlags.externalAiProvider/externalAiModel — ver
// bot-constants.js/bot-governance-service.js): a CREDENCIAL é global (uma
// por provider para toda a instalação), só a ESCOLHA de qual usar é por Bot.
//
// Nunca cacheia a instância entre chamadas: trocar/remover uma chave pelo
// painel precisa valer na PRÓXIMA mensagem, sem reiniciar o servidor.
const { LocalFallbackProvider } = require("./local-fallback-provider");
const { AnthropicProvider } = require("./anthropic-provider");
const { GeminiProvider } = require("./gemini-provider");
const { OpenAiProvider } = require("./openai-provider");
const { EXTERNAL_AI_PROVIDERS } = require("../bot-constants");
const { resolveCredential } = require("./ai-credential-service");

const localFallbackProvider = new LocalFallbackProvider();

// Registro central de providers externos IMPLEMENTADOS (item "mostrar
// somente providers realmente implementados"). EXTERNAL_AI_PROVIDERS
// (bot-constants.js) é a lista canônica usada pela UI/validação de
// featureFlags; este objeto só sabe COMO instanciar cada um a partir de uma
// credencial já resolvida — nunca duplica a lista, só implementa contra ela.
const providerClasses = {
  ANTHROPIC: AnthropicProvider,
  GEMINI: GeminiProvider,
  OPENAI: OpenAiProvider,
};

// Resolve a credencial (painel > env) e instancia o provider, sem cache —
// { provider: null, error } quando não há credencial em lugar nenhum.
// `modelOverride` (opcional) é a escolha de modelo DO BOT
// (featureFlags.externalAiModel) — vence o modelo padrão salvo junto da
// credencial; sem nenhum dos dois, o provider usa seu próprio default.
async function resolveInstance(name, modelOverride) {
  const ProviderClass = providerClasses[name];
  if (!ProviderClass) return { provider: null, error: "Provider não implementado." };
  const credential = await resolveCredential(name);
  if (!credential.apiKey) return { provider: null, error: "Provider não configurado." };
  try {
    const options = { apiKey: credential.apiKey };
    const model = modelOverride || credential.model;
    if (model) options.model = model;
    return { provider: new ProviderClass(options), error: null };
  } catch (error) {
    return { provider: null, error: error.message };
  }
}

// `providerName` vem de Bot.featureFlags.externalAiProvider. Sem credencial
// configurada para o provider escolhido (painel ou env), ou provider
// desconhecido, cai para o provider local — nunca quebra a aplicação.
async function getPrimaryProvider(providerName, modelOverride) {
  const entry = await resolveInstance(providerName, modelOverride);
  if (entry.provider) return { provider: entry.provider, name: providerName };
  return { provider: localFallbackProvider, name: "LOCAL_FALLBACK" };
}

function getFallbackProvider() {
  return { provider: localFallbackProvider, name: "LOCAL_FALLBACK" };
}

// Status (Configurado / Não configurado / Erro) — nunca expõe a credencial,
// só se ela existe e se a inicialização deu certo.
async function getProviderStatus(providerName) {
  if (!providerName || providerName === "LOCAL") {
    return { provider: "LOCAL", configured: true, error: null };
  }
  if (!EXTERNAL_AI_PROVIDERS.includes(providerName)) {
    return { provider: providerName, configured: false, error: "Provider não implementado." };
  }
  const entry = await resolveInstance(providerName);
  return { provider: providerName, configured: Boolean(entry.provider), error: entry.provider ? null : entry.error };
}

// "Testar conexão": chamada real mínima só para validar a credencial/rede —
// nunca usada no caminho quente de interpretação. Nunca derruba a
// aplicação: falha vira { ok: false, error }, sem jamais incluir a
// credencial na resposta.
async function testConnection(providerName) {
  if (providerName === "LOCAL") return { ok: true, latencyMs: 0 };
  const entry = await resolveInstance(providerName);
  if (!entry.provider) return { ok: false, error: entry.error || "Provider não configurado." };
  const startedAt = Date.now();
  try {
    await entry.provider.classifyIntent({ bot: { intents: [] }, message: "teste de conexão", context: [] });
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    // Nunca vaza a credencial — só o código/mensagem já normalizados pelo
    // provider (ex.: AUTH_ERROR/RATE_LIMIT/QUOTA_EXCEEDED/TIMEOUT).
    return { ok: false, error: error.message, code: error.code || null };
  }
}

module.exports = {
  getFallbackProvider, getPrimaryProvider, getProviderStatus, testConnection,
};
