// Provider Gemini (Google) — mesmo contrato/abstração de AnthropicProvider
// (AIProvider), reaproveitando o MESMO prompt de classificação
// (buildIntentPrompt) e os MESMOS utilitários de validação de resposta
// (classification-utils.js) — nenhuma lógica de "entender a intenção"
// duplicada, só o transporte HTTP muda. Nunca obrigatório: se
// GEMINI_API_KEY não estiver configurada, get-ai-provider.js nem instancia
// esta classe.
const axios = require("axios");
const { AIProvider } = require("./ai-provider");
const { extractEntities: extractEntitiesLocally } = require("../bot-entity-extractor");
const { parseJsonResponse, validateClassification } = require("./classification-utils");
const { buildIntentPrompt } = require("./anthropic-provider");

const DEFAULT_MODEL = "gemini-2.0-flash";
const DEFAULT_TIMEOUT_MS = 8000;
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Item 4 (tratamento de rate limit/quota/autenticação/timeout): nunca deixa
// a chave vazar na mensagem de erro (a chave só viaja no header
// x-goog-api-key, nunca na URL/query string, então nem aparece em logs de
// erro do axios) — só normaliza o tipo de falha para o chamador decidir
// (bot-interpreter-service.js já cai no fallback local em qualquer erro).
function mapGeminiError(error) {
  if (error.code === "ECONNABORTED" || /timeout/i.test(error.message || "")) {
    return Object.assign(new Error("Tempo limite excedido ao chamar o Gemini."), { code: "TIMEOUT" });
  }
  const status = error.response?.status;
  const apiStatus = error.response?.data?.error?.status;
  const apiMessage = error.response?.data?.error?.message;
  if (status === 401 || status === 403) {
    return Object.assign(new Error("Credencial do Gemini inválida ou sem permissão."), { code: "AUTH_ERROR" });
  }
  if (status === 429) {
    if (apiStatus === "RESOURCE_EXHAUSTED") {
      return Object.assign(new Error("Cota do Gemini excedida."), { code: "QUOTA_EXCEEDED" });
    }
    return Object.assign(new Error("Limite de requisições do Gemini atingido (rate limit)."), { code: "RATE_LIMIT" });
  }
  if (status >= 400 && status < 500) {
    return Object.assign(new Error(apiMessage || "Requisição inválida ao Gemini."), { code: "PROVIDER_REQUEST_FAILED" });
  }
  return Object.assign(new Error("Falha ao consultar o Gemini."), { code: "PROVIDER_REQUEST_FAILED" });
}

class GeminiProvider extends AIProvider {
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL || DEFAULT_MODEL,
    timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  } = {}) {
    super();
    if (!apiKey) throw new Error("GEMINI_API_KEY não configurada.");
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30000
      ? timeoutMs : DEFAULT_TIMEOUT_MS;
  }

  async classifyIntent({ bot, message, context }) {
    const prompt = buildIntentPrompt({ bot, message, context });
    let response;
    try {
      response = await axios.post(`${API_BASE}/${this.model}:generateContent`, {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 400 },
      }, {
        timeout: this.timeoutMs,
        headers: {
          // Item 2: a chave só viaja neste header, nunca na URL/query string
          // (evita aparecer em logs de acesso/URL do axios).
          "x-goog-api-key": this.apiKey,
          "content-type": "application/json",
        },
      });
    } catch (error) {
      throw mapGeminiError(error);
    }
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    // Item 4 (JSON inválido): parseJsonResponse nunca lança — devolve null,
    // e validateClassification(null, ...) já degrada para "sem intenção"
    // (nunca inventa), reaproveitando o mesmo caminho seguro do Anthropic.
    const parsed = parseJsonResponse(text);
    const classification = validateClassification(parsed, bot);
    const rawUsage = response.data?.usageMetadata;
    const usage = rawUsage
      ? { inputTokens: rawUsage.promptTokenCount ?? null, outputTokens: rawUsage.candidatesTokenCount ?? null }
      : null;
    return { ...classification, usage };
  }

  async extractEntities({ message }) {
    return extractEntitiesLocally(message);
  }

  async generateResponse({ bot, intent }) {
    return intent?.responseMessage || bot.fallbackMessage;
  }
}

module.exports = { GeminiProvider, DEFAULT_MODEL, mapGeminiError };
