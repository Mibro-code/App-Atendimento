// Constantes centralizadas do motor de interpretação de Bots.
// Nada aqui deve ser duplicado com números soltos pelo restante do código.

const CONTEXT_MESSAGE_LIMIT = 10;
const MAX_FAILED_INTERPRETATIONS = 3;
const DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 0.8;
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.55;

const BOT_ACTIONS = Object.freeze([
  "RESPOND",
  "ASK_CLARIFICATION",
  "HANDOFF_HUMAN",
  "SWITCH_BOT",
  "QUERY_TOOL",
  "NO_ACTION",
]);

const HUMAN_HANDOFF_PATTERNS = [
  /\bfalar com (um |uma )?(atendente|pessoa|humano|alguem)\b/,
  /\bquero (um |uma )?(atendente|pessoa|humano)\b/,
  /\bme (passa|transfere|transfira) (para|pra) (um |uma )?(atendente|pessoa|humano)\b/,
  /\bnao quero (falar com )?(o |um )?rob(o|ô)\b/,
  /\bsem ser (o |um )?rob(o|ô)\b/,
  /\bquero falar com alguem de verdade\b/,
  /\batendimento humano\b/,
];

function confidenceBand(bot, confidence) {
  const high = typeof bot?.highConfidenceThreshold === "number" ? bot.highConfidenceThreshold : DEFAULT_HIGH_CONFIDENCE_THRESHOLD;
  const low = typeof bot?.lowConfidenceThreshold === "number" ? bot.lowConfidenceThreshold : DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  if (confidence >= high) return "HIGH";
  if (confidence >= low) return "MEDIUM";
  return "LOW";
}

function validateConfidenceThresholds(low, high) {
  if (typeof low !== "number" || typeof high !== "number") return false;
  return low >= 0 && high <= 1 && low <= high;
}

module.exports = {
  BOT_ACTIONS,
  CONTEXT_MESSAGE_LIMIT,
  DEFAULT_HIGH_CONFIDENCE_THRESHOLD,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  HUMAN_HANDOFF_PATTERNS,
  MAX_FAILED_INTERPRETATIONS,
  confidenceBand,
  validateConfidenceThresholds,
};
