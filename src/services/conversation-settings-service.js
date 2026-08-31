// Configurações → Conversas — mesmo padrão de singleton já usado em
// campaign-settings-service.js (CampaignGlobalSettings). Fonte central de
// todos os prazos/flags de SLA, alertas, contexto do Bot e reabertura de
// conversa: nenhum outro service deve ter seu próprio número hardcoded.
const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const audit = require("./audit-service");

const SETTINGS_ID = "singleton";

// Cache leve em memória (TTL curto) para as leituras de hot-path (por
// mensagem/tick de monitor) não baterem no banco a cada chamada. Invalidado
// explicitamente em updateConversationSettings.
const CACHE_TTL_MS = 5000;
let cache = null;
let cacheExpiresAt = 0;

function invalidateCache() {
  cache = null;
  cacheExpiresAt = 0;
}

async function getConversationSettings(client = prisma) {
  if (client === prisma && cache && Date.now() < cacheExpiresAt) return cache;
  const settings = await client.conversationSettings.upsert({
    where: { id: SETTINGS_ID }, update: {}, create: { id: SETTINGS_ID },
  });
  if (client === prisma) {
    cache = settings;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  }
  return settings;
}

async function getConversationSettingsForViewer(viewer) {
  authorization.assertCanViewConversationSettings(viewer);
  return getConversationSettings();
}

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

const BOOLEAN_FIELDS = [
  "firstResponseSlaEnabled",
  "responseSlaEnabled",
  "unansweredConversationAlertEnabled",
  "stalledConversationAlertEnabled",
  "botResumeAfterHumanEnabled",
  "reopenConversationOnCustomerMessage",
  "slaBusinessHoursOnly",
  "autoFinalizationEnabled",
];

const MINUTES_FIELDS = {
  firstResponseSlaMinutes: { min: 1, max: 1440 },
  responseSlaMinutes: { min: 1, max: 1440 },
  unansweredConversationAlertMinutes: { min: 1, max: 1440 },
  stalledConversationAlertMinutes: { min: 1, max: 1440 },
  botContextTtlMinutes: { min: 1, max: 1440 },
  botResumeAfterHumanMinutes: { min: 1, max: 1440 },
  autoFinalizationMinutes: { min: 1, max: 1440 },
};

// Único campo minutos que é opcional/nulo (item 8 — janela de reabertura).
function validateReopenWindowMinutes(value, update) {
  if (value === null) {
    update.reopenWindowMinutes = null;
    return;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 43200) {
    throw fail('"reopenWindowMinutes" deve ser nulo ou um inteiro entre 1 e 43200.');
  }
  update.reopenWindowMinutes = numeric;
}

// Só Master edita — mesma régua de risco alto usada para Campanhas/Bots.
async function updateConversationSettings(data, actor) {
  authorization.assertMaster(actor);
  const update = {};

  for (const key of BOOLEAN_FIELDS) {
    if (data[key] === undefined) continue;
    if (typeof data[key] !== "boolean") throw fail(`"${key}" deve ser verdadeiro ou falso.`);
    update[key] = data[key];
  }

  for (const [key, range] of Object.entries(MINUTES_FIELDS)) {
    if (data[key] === undefined) continue;
    const value = Number(data[key]);
    if (!Number.isInteger(value) || value < range.min || value > range.max) {
      throw fail(`"${key}" deve ser um inteiro entre ${range.min} e ${range.max}.`);
    }
    update[key] = value;
  }

  if (data.reopenWindowMinutes !== undefined) {
    validateReopenWindowMinutes(data.reopenWindowMinutes, update);
  }

  if (!Object.keys(update).length) throw fail("Informe ao menos um campo para atualizar.");

  const before = await getConversationSettings();
  const settings = await prisma.conversationSettings.update({ where: { id: SETTINGS_ID }, data: update });
  invalidateCache();
  await audit.recordAudit({
    actor, action: "CONVERSATION_SETTINGS_UPDATED", entityType: "CONVERSATION_SETTINGS", entityId: null,
    summary: "Atualizou as configurações globais de Conversas", details: { before, after: settings },
  });
  return settings;
}

module.exports = {
  getConversationSettings,
  getConversationSettingsForViewer,
  updateConversationSettings,
  invalidateCache,
};
