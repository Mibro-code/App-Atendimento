// Configuração global de Campanhas (item 31) — mesmo padrão de singleton já
// usado em bot-governance-service.js (BotGlobalSettings). PRINCÍPIO igual:
// implementar não é ativar — massMessagingEnabled nasce OFF e nenhum envio
// real acontece enquanto um Master não ligar explicitamente (item 32).
const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const audit = require("./audit-service");

const SETTINGS_ID = "singleton";

async function getCampaignSettings(client = prisma) {
  return client.campaignGlobalSettings.upsert({
    where: { id: SETTINGS_ID }, update: {}, create: { id: SETTINGS_ID },
  });
}

async function getCampaignSettingsForManager(viewer) {
  authorization.assertCanManageCampaigns(viewer);
  return getCampaignSettings();
}

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

// Só Master liga/desliga o master switch e os limites — mesma régua do kill
// switch de automação de Bots (decisão de risco alto, não delegada a Supervisor).
async function updateCampaignSettings(data, actor) {
  authorization.assertMaster(actor);
  const update = {};
  if (data.massMessagingEnabled !== undefined) {
    if (typeof data.massMessagingEnabled !== "boolean") throw fail("massMessagingEnabled deve ser verdadeiro ou falso.");
    update.massMessagingEnabled = data.massMessagingEnabled;
  }
  if (data.allowScheduling !== undefined) {
    if (typeof data.allowScheduling !== "boolean") throw fail("allowScheduling deve ser verdadeiro ou falso.");
    update.allowScheduling = data.allowScheduling;
  }
  if (data.allowImports !== undefined) {
    if (typeof data.allowImports !== "boolean") throw fail("allowImports deve ser verdadeiro ou falso.");
    update.allowImports = data.allowImports;
  }
  for (const [key, range] of Object.entries({
    maxCampaignRecipients: { min: 1, max: 200000 },
    defaultBatchSize: { min: 1, max: 500 },
    defaultDelayBetweenBatchesSeconds: { min: 1, max: 3600 },
    defaultMaxRetries: { min: 0, max: 10 },
  })) {
    if (data[key] === undefined) continue;
    const value = Number(data[key]);
    if (!Number.isInteger(value) || value < range.min || value > range.max) {
      throw fail(`"${key}" deve ser um inteiro entre ${range.min} e ${range.max}.`);
    }
    update[key] = value;
  }
  if (!Object.keys(update).length) throw fail("Informe ao menos um campo para atualizar.");

  const before = await getCampaignSettings();
  const settings = await prisma.campaignGlobalSettings.update({ where: { id: SETTINGS_ID }, data: update });
  await audit.recordAudit({
    actor, action: "CAMPAIGN_SETTINGS_UPDATED", entityType: "CAMPAIGN_SETTINGS", entityId: null,
    summary: "Atualizou as configurações globais de Campanhas", details: { before, after: settings },
  });
  return settings;
}

module.exports = { getCampaignSettings, getCampaignSettingsForManager, updateCampaignSettings };
