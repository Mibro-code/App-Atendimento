// Constantes centralizadas do módulo de Campanhas — nada aqui deve ser
// duplicado/hardcoded em outro arquivo (item 18).
const CAMPAIGN_STATUSES = Object.freeze([
  "DRAFT", "SCHEDULED", "QUEUED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED", "FAILED",
]);

const CAMPAIGN_CONTACT_STATUSES = Object.freeze([
  "PENDING", "QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "REPLIED", "FAILED", "SKIPPED", "OPTED_OUT",
]);

const CONTACT_SOURCES = Object.freeze([
  "EVENT", "MANUAL_IMPORT", "SHOPIFY", "FORM", "WHATSAPP", "PARTNER", "OTHER",
]);

const CONSENT_STATUSES = Object.freeze(["UNKNOWN", "OPTED_IN", "OPTED_OUT"]);

const PROSPECT_STATUSES = Object.freeze([
  "NEW", "CONTACTED", "REPLIED", "INTERESTED", "QUALIFIED", "NOT_INTERESTED", "CONVERTED",
]);

// Item 13: reconhece pedido de opt-out mesmo com variação de acentuação/caixa
// (o texto chega já normalizado por normalizeText antes de testar).
const OPT_OUT_PATTERNS = [
  /\bsair\b/, /\bparar\b/, /\bremover\b/, /\bcancelar\b/,
  /\bnao quero receber\b/, /\bnao quero mais receber\b/, /\bpare de enviar\b/,
  /\bdescadastrar\b/, /\bstop\b/,
];

// Item 6/28: upload de importação — CSV apenas nesta fase (sem XLSX, ver
// relatório final). Tamanho e MIME nunca soltos em outro arquivo.
const CSV_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const CSV_ALLOWED_MIME = new Set(["text/csv", "application/vnd.ms-excel", "text/plain"]);
const CSV_MAX_ROWS = 20000;

// Item 18: defaults de fila — sempre sobrepostos por CampaignGlobalSettings/
// Campaign, nunca hardcoded em outro serviço.
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_DELAY_BETWEEN_BATCHES_SECONDS = 5;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_CAMPAIGN_RECIPIENTS = 5000;
const STUCK_SENDING_MINUTES = 5; // acima disso, um item "SENDING" volta a ser candidato a retry.

const CAMPAIGN_IMPORT_FIELDS = Object.freeze([
  "phone", "firstName", "fullName", "email", "companyName", "document", "city", "state", "source", "tags", "notes",
]);

module.exports = {
  CAMPAIGN_STATUSES,
  CAMPAIGN_CONTACT_STATUSES,
  CONTACT_SOURCES,
  CONSENT_STATUSES,
  PROSPECT_STATUSES,
  OPT_OUT_PATTERNS,
  CSV_MAX_FILE_SIZE,
  CSV_ALLOWED_MIME,
  CSV_MAX_ROWS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_DELAY_BETWEEN_BATCHES_SECONDS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_CAMPAIGN_RECIPIENTS,
  STUCK_SENDING_MINUTES,
  CAMPAIGN_IMPORT_FIELDS,
};
