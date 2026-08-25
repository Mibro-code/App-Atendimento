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
  /\bchama (um |uma )?(atendente|pessoa|humano)\b/,
  /\bpreciso falar com (um |uma )?(atendente|pessoa|humano)\b/,
  /\bnao quero (falar com )?(o |um )?rob(o|ô)\b/,
  /\bsem ser (o |um )?rob(o|ô)\b/,
  /\bquero falar com alguem de verdade\b/,
  /\batendimento humano\b/,
];

// Camada conversacional (bot-social-behavior-service.js): comportamentos
// sociais reconhecidos ao lado da intenção de negócio, sem virar intenção
// cadastrada. GREETING/THANKS/GOODBYE usam presença de frase (a mensagem
// pode ter conteúdo de negócio junto); CONFIRMATION/NEGATION/SMALL_TALK só
// disparam quando a mensagem inteira é a frase social (mensagem curta).
const SOCIAL_BEHAVIORS = Object.freeze([
  "GREETING", "THANKS", "GOODBYE", "SMALL_TALK", "CONFIRMATION", "NEGATION", "HUMAN_REQUEST", "BUSINESS_INTENT",
]);

const GREETING_PHRASES = [
  ["bom dia", "Bom dia"], ["boa tarde", "Boa tarde"], ["boa noite", "Boa noite"],
  ["ola", "Olá"], ["oi", "Oi"], ["opa", "Opa"], ["e ai", "E aí"], ["eae", "E aí"],
  ["tudo bem", "Tudo bem"], ["como vai", "Como vai"], ["fala", "Fala"],
];

const THANKS_PATTERNS = [/\bobrigad[oa]\b/, /\bvaleu\b/, /\bvlw\b/, /\bagradec/];

const GOODBYE_PATTERNS = [/\btchau\b/, /\bate mais\b/, /\bate logo\b/, /\bfalou\b/, /\bbom trabalho\b/];

const SMALL_TALK_PATTERNS = [
  /^quem e voce[?.! ]*$/, /^voce e (um )?rob(o|ô)[?.! ]*$/, /^o que voce faz[?.! ]*$/,
  /^como voce esta[?.! ]*$/,
];

const CONFIRMATION_PATTERN = /^(sim|ss|s|ok|okay|claro|pode ser|isso|isso mesmo|exatamente|confirmo|correto)[.!]*$/;
const NEGATION_PATTERN = /^(nao|n|nao e isso|errado)[.!]*$/;

// Aprendizado supervisionado (bot-learning-service.js).
const LEARNING_MESSAGE_LIMIT = 30;
const LEARNING_TEXT_MAX_LENGTH = 500;
const LEARNING_SIMILARITY_TOPIC_THRESHOLD = 0.6;
const LEARNING_SIMILARITY_CONTENT_THRESHOLD = 0.6;

const RESOLUTION_POSITIVE_PATTERNS = [
  /\bfuncionou\b/, /\bdeu certo\b/, /\bresolveu\b/, /\bagora foi\b/, /\bagora funcionou\b/, /\bconsegui\b/,
];
const RESOLUTION_NEGATIVE_PATTERNS = [
  /\bnao resolveu\b/, /\bcontinua igual\b/, /\bnao deu certo\b/, /\bainda nao\b/, /\bpiorou\b/,
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
  CONFIRMATION_PATTERN,
  CONTEXT_MESSAGE_LIMIT,
  DEFAULT_HIGH_CONFIDENCE_THRESHOLD,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  GOODBYE_PATTERNS,
  GREETING_PHRASES,
  HUMAN_HANDOFF_PATTERNS,
  LEARNING_MESSAGE_LIMIT,
  LEARNING_SIMILARITY_CONTENT_THRESHOLD,
  LEARNING_SIMILARITY_TOPIC_THRESHOLD,
  LEARNING_TEXT_MAX_LENGTH,
  MAX_FAILED_INTERPRETATIONS,
  NEGATION_PATTERN,
  RESOLUTION_NEGATIVE_PATTERNS,
  RESOLUTION_POSITIVE_PATTERNS,
  SMALL_TALK_PATTERNS,
  SOCIAL_BEHAVIORS,
  THANKS_PATTERNS,
  confidenceBand,
  validateConfidenceThresholds,
};
