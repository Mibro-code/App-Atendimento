// Chave-mestra de "novos canais" (item 34) — controla só os canais fora do
// Meta/WhatsApp. Nunca deve existir um caminho que desative Meta por aqui.
const prisma = require("../../database/prisma");
const authorization = require("../authorization-service");
const audit = require("../audit-service");

const SINGLETON_ID = "singleton";

async function getGlobalSettings() {
  return prisma.integrationGlobalSettings.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
}

async function setNewChannelsEnabled(enabled, actor) {
  if (!authorization.isMaster(actor)) {
    throw authorization.forbidden("Somente uma conta Master pode alterar essa configuração.");
  }
  if (typeof enabled !== "boolean") {
    throw Object.assign(new Error("enabled deve ser verdadeiro ou falso."), { statusCode: 400 });
  }
  const settings = await prisma.integrationGlobalSettings.upsert({
    where: { id: SINGLETON_ID },
    update: { newChannelsEnabled: enabled },
    create: { id: SINGLETON_ID, newChannelsEnabled: enabled },
  });
  await audit.recordAudit({
    actor, action: enabled ? "NEW_CHANNELS_ENABLED" : "NEW_CHANNELS_DISABLED", entityType: "INTEGRATION", entityId: SINGLETON_ID,
    summary: `${enabled ? "Ativou" : "Desativou"} globalmente os novos canais de integração (Meta/WhatsApp não é afetado).`,
  });
  return settings;
}

module.exports = { getGlobalSettings, setNewChannelsEnabled };
