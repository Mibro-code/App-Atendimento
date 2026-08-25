// Provider que usa a API da Anthropic para classificar a intenção do cliente
// com tolerância a erros de digitação, gírias e paráfrases (algo que
// correspondência literal/fuzzy não cobre). Nunca é obrigatório: se
// ANTHROPIC_API_KEY não estiver configurada, get-ai-provider.js nem
// instancia esta classe.
const axios = require("axios");
const { AIProvider } = require("./ai-provider");
const { extractEntities: extractEntitiesLocally, sanitizeEntities } = require("../bot-entity-extractor");

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT_MS = 8000;
const API_URL = "https://api.anthropic.com/v1/messages";

function buildIntentPrompt({ bot, message, context = [] }) {
  const intents = (bot.intents || [])
    .filter((intent) => intent.active)
    .map((intent) => ({
      id: intent.id,
      name: intent.name,
      description: intent.description || undefined,
      examples: (intent.examples || []).slice(0, 8).map((example) => example.text),
    }));

  const recentTurns = context.slice(-8).map((entry) => (
    `${entry.direction === "ENVIADA" ? "Bot" : "Cliente"}: ${entry.text || "[mensagem sem texto]"}`
  )).join("\n");

  return [
    "Você classifica a intenção de mensagens de clientes de um chat de atendimento.",
    "Responda APENAS com um JSON válido, sem texto antes ou depois, no formato:",
    '{"intentId": "<id da intenção mais provável ou null>", "confidence": <número de 0 a 1>, "entities": {"orderNumber": null, "cpf": null, "cnpj": null, "serialNumber": null, "email": null, "productName": null, "trackingCode": null}}',
    "Preencha em entities apenas os campos que a mensagem realmente informar; deixe os demais como null.",
    "Escolha intentId apenas entre os IDs listados abaixo. Se nenhuma intenção corresponder com confiança, use null.",
    "",
    `Intenções disponíveis: ${JSON.stringify(intents)}`,
    recentTurns ? `\nContexto recente da conversa:\n${recentTurns}` : "",
    `\nMensagem atual do cliente: ${JSON.stringify(message)}`,
  ].filter(Boolean).join("\n");
}

function parseJsonResponse(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_error) {
    return null;
  }
}

function validateClassification(parsed, bot) {
  if (!parsed || typeof parsed !== "object") return null;
  const validIntentIds = new Set((bot.intents || []).map((intent) => intent.id));
  const intentId = typeof parsed.intentId === "string" && validIntentIds.has(parsed.intentId) ? parsed.intentId : null;
  const rawConfidence = Number(parsed.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0;
  if (!intentId) return { intentId: null, confidence: 0, entities: sanitizeEntities(parsed.entities) };
  return { intentId, confidence, entities: sanitizeEntities(parsed.entities) };
}

class AnthropicProvider extends AIProvider {
  constructor({
    apiKey = process.env.ANTHROPIC_API_KEY,
    model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    timeoutMs = Number(process.env.ANTHROPIC_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  } = {}) {
    super();
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada.");
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30000
      ? timeoutMs : DEFAULT_TIMEOUT_MS;
  }

  async classifyIntent({ bot, message, context }) {
    const prompt = buildIntentPrompt({ bot, message, context });
    const response = await axios.post(API_URL, {
      model: this.model,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }, {
      timeout: this.timeoutMs,
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
    });
    const text = response.data?.content?.[0]?.text;
    const parsed = parseJsonResponse(text);
    return validateClassification(parsed, bot);
  }

  async extractEntities({ message }) {
    return extractEntitiesLocally(message);
  }

  async generateResponse({ bot, intent }) {
    return intent?.responseMessage || bot.fallbackMessage;
  }
}

module.exports = {
  AnthropicProvider, DEFAULT_MODEL, buildIntentPrompt, parseJsonResponse, validateClassification,
};
