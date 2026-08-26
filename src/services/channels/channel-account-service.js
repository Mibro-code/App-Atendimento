// CRUD de ChannelAccount (item 5/6/7) — Master-only. Segredos nunca
// trafegam de volta inteiros: toda leitura devolve só `secretKeys` +
// máscara. Escrita cifra antes de gravar (integration-secret-service.js).
const prisma = require("../../database/prisma");
const authorization = require("../authorization-service");
const audit = require("../audit-service");
const { encryptSecrets, decryptSecrets, maskSecret } = require("./integration-secret-service");
const { createAdapter, getAdapterClass } = require("./channel-adapter-registry");
const { ALL_MANAGED_CHANNELS, NEW_CHANNELS } = require("./channel-constants");
const { getGlobalSettings } = require("./integration-global-settings-service");

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function assertIntegrationManager(viewer) {
  if (!authorization.isMaster(viewer)) {
    throw authorization.forbidden("Somente uma conta Master pode gerenciar integrações.");
  }
}

// Nunca devolve os valores cifrados/segredo — só metadados + máscara do
// último trecho salvo (quando o próprio front mandou uma vez, exibimos a
// máscara com base nos 4 últimos caracteres guardados em config._secretHints,
// que não são o segredo em si).
function publicAccount(account) {
  if (!account) return null;
  const { encryptedSecrets, encryptionIv, encryptionAuthTag, config, ...rest } = account;
  const hints = config?._secretHints || {};
  return {
    ...rest,
    config: Object.fromEntries(Object.entries(config || {}).filter(([key]) => key !== "_secretHints")),
    secretHints: Object.fromEntries(account.secretKeys.map((key) => [key, hints[key] || maskSecret("****")])),
  };
}

async function listAccounts(viewer) {
  assertIntegrationManager(viewer);
  const accounts = await prisma.channelAccount.findMany({ orderBy: [{ channel: "asc" }, { name: "asc" }] });
  return accounts.map(publicAccount);
}

async function ensureAccount(id) {
  const account = await prisma.channelAccount.findUnique({ where: { id } });
  if (!account) throw fail("Conta de canal não encontrada.", 404);
  return account;
}

async function getAccount(id, viewer) {
  assertIntegrationManager(viewer);
  return publicAccount(await ensureAccount(id));
}

const FORBIDDEN_CONFIG_SECRET_KEYS = new Set([
  "accesstoken", "apikey", "appsecret", "clientsecret", "lwaclientsecret",
  "partnerkey", "password", "privatekey", "refreshtoken",
]);

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function assertObjectInput(value, field) {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw fail(field + " deve ser um objeto.");
  }
}

function assertNoPlaintextSecrets(config) {
  const exposed = [];
  const visit = (value, path = "config") => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (FORBIDDEN_CONFIG_SECRET_KEYS.has(normalizedKey)) exposed.push(path + "." + key);
      visit(nested, path + "." + key);
    }
  };
  visit(config);
  if (exposed.length) throw fail("Segredos devem ser enviados no campo secrets: " + exposed.join(", ") + ".");
}

function assertSecretValues(secrets) {
  const invalid = Object.entries(secrets).find(([, value]) => typeof value !== "string" || !value.trim());
  if (invalid) throw fail("Todo segredo deve ser uma string não vazia: " + invalid[0] + ".");
}

function validateChannel(channel) {
  if (!ALL_MANAGED_CHANNELS.includes(channel)) throw fail("Canal inválido para integração.");
  return channel;
}

async function createAccount(data, actor) {
  assertIntegrationManager(actor);
  const channel = validateChannel(data.channel);
  const name = String(data.name || "").trim();
  if (!name) throw fail("Nome da conta é obrigatório.");
  assertObjectInput(data.config, "config");
  assertObjectInput(data.secrets, "secrets");
  const config = plainObject(data.config);
  const secrets = plainObject(data.secrets);
  assertNoPlaintextSecrets(config);
  assertSecretValues(secrets);

  const secretData = Object.keys(secrets).length ? encryptSecrets(secrets) : { secretKeys: [] };
  const hints = Object.fromEntries(Object.entries(secrets).map(([key, value]) => [key, maskSecret(String(value))]));

  const account = await prisma.channelAccount.create({
    data: {
      channel, name, externalAccountId: data.externalAccountId || null,
      config: { ...config, _secretHints: hints },
      status: secretData.secretKeys.length ? "CONFIGURED" : "NOT_CONFIGURED",
      ...secretData,
    },
  });
  await audit.recordAudit({
    actor, action: "CHANNEL_ACCOUNT_CREATED", entityType: "CHANNEL_ACCOUNT", entityId: account.id,
    summary: `Criou a conta "${name}" do canal ${channel}`, details: { channel, name },
  });
  return publicAccount(account);
}

async function updateAccount(id, data, actor) {
  assertIntegrationManager(actor);
  const existing = await ensureAccount(id);
  const update = {};
  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) throw fail("Nome da conta não pode ficar vazio.");
    update.name = name;
  }
  if (data.externalAccountId !== undefined) update.externalAccountId = data.externalAccountId || null;

  const existingConfig = existing.config && typeof existing.config === "object" ? existing.config : {};
  const existingHints = existingConfig._secretHints || {};
  assertObjectInput(data.config, "config");
  assertObjectInput(data.secrets, "secrets");
  const incomingConfig = plainObject(data.config);
  assertNoPlaintextSecrets(incomingConfig);
  assertSecretValues(plainObject(data.secrets));
  let config = data.config !== undefined ? { ...existingConfig, ...incomingConfig } : existingConfig;

  if (data.secrets && typeof data.secrets === "object" && Object.keys(data.secrets).length) {
    const mergedSecrets = { ...decryptSecretsSafe(existing), ...data.secrets };
    const secretData = encryptSecrets(mergedSecrets);
    const hints = { ...existingHints, ...Object.fromEntries(Object.entries(data.secrets).map(([key, value]) => [key, maskSecret(String(value))])) };
    Object.assign(update, secretData, { config: { ...config, _secretHints: hints } });
    if (existing.status === "NOT_CONFIGURED") update.status = "CONFIGURED";
  } else if (data.config !== undefined) {
    update.config = config;
  }

  if (!Object.keys(update).length) throw fail("Informe ao menos um campo para atualizar.");

  const account = await prisma.channelAccount.update({ where: { id }, data: update });
  await audit.recordAudit({
    actor, action: "CHANNEL_ACCOUNT_UPDATED", entityType: "CHANNEL_ACCOUNT", entityId: id,
    summary: `Atualizou a conta "${account.name}" do canal ${account.channel}`,
    details: { updatedFields: Object.keys(update).filter((key) => key !== "encryptedSecrets" && key !== "encryptionIv" && key !== "encryptionAuthTag") },
  });
  return publicAccount(account);
}

function decryptSecretsSafe(account) {
  try {
    return decryptSecrets(account);
  } catch (_error) {
    return {};
  }
}

async function setEnabled(id, enabled, actor) {
  assertIntegrationManager(actor);
  const existing = await ensureAccount(id);
  if (typeof enabled !== "boolean") throw fail("enabled deve ser verdadeiro ou falso.");
  const account = await prisma.channelAccount.update({
    where: { id }, data: { enabled, status: enabled && existing.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : existing.status },
  });
  await audit.recordAudit({
    actor, action: enabled ? "CHANNEL_ACCOUNT_ENABLED" : "CHANNEL_ACCOUNT_DISABLED", entityType: "CHANNEL_ACCOUNT", entityId: id,
    summary: `${enabled ? "Ativou" : "Desativou"} a conta "${account.name}" do canal ${account.channel}`,
  });
  return publicAccount(account);
}

async function deleteAccount(id, actor) {
  assertIntegrationManager(actor);
  const existing = await ensureAccount(id);
  await prisma.channelAccount.delete({ where: { id } });
  await audit.recordAudit({
    actor, action: "CHANNEL_ACCOUNT_DELETED", entityType: "CHANNEL_ACCOUNT", entityId: id,
    summary: `Removeu a conta "${existing.name}" do canal ${existing.channel}`,
  });
  return { deleted: true };
}

// Só verifica credenciais/escopo — nunca envia nada real (item 12).
async function testConnection(id, actor) {
  assertIntegrationManager(actor);
  const account = await ensureAccount(id);
  const globalSettings = await getGlobalSettings();
  if (NEW_CHANNELS.includes(account.channel) && !globalSettings.newChannelsEnabled) {
    throw fail("Integrações de novos canais estão desativadas globalmente.");
  }
  const adapter = createAdapter(account.channel, {
    ...account, secrets: decryptSecretsSafe(account),
    config: Object.fromEntries(Object.entries(account.config || {}).filter(([key]) => key !== "_secretHints")),
  });
  if (!adapter) throw fail("Canal sem adapter disponível.");

  let result;
  let status;
  try {
    result = await adapter.testConnection();
    status = result.status || "CONNECTED";
  } catch (error) {
    status = "ERROR";
    await prisma.channelAccount.update({
      where: { id }, data: { status, lastErrorAt: new Date(), lastErrorCode: error.channelErrorCode || "PROVIDER_ERROR", lastErrorMessage: error.message?.slice(0, 300) },
    });
    await audit.recordAudit({
      actor, action: "CHANNEL_CONNECTION_TEST_FAILED", entityType: "CHANNEL_ACCOUNT", entityId: id,
      summary: `Teste de conexão falhou para "${account.name}" (${account.channel})`,
      details: { errorCode: error.channelErrorCode || "PROVIDER_ERROR" },
    });
    throw fail(error.message || "Falha ao testar conexão.", error.statusCode || 502);
  }

  await prisma.channelAccount.update({
    where: { id }, data: { status, lastSyncAt: status === "CONNECTED" ? new Date() : undefined, lastErrorAt: null, lastErrorCode: null, lastErrorMessage: null },
  });
  await audit.recordAudit({
    actor, action: "CHANNEL_CONNECTION_TESTED", entityType: "CHANNEL_ACCOUNT", entityId: id,
    summary: `Testou a conexão de "${account.name}" (${account.channel}): ${status}`,
  });
  return { status, message: result.message || null };
}

// Visão consolidada para os cards da tela de Integrações (item 6), inclui
// canais sem nenhuma conta ainda cadastrada.
async function listChannelOverview(viewer) {
  assertIntegrationManager(viewer);
  const accounts = await prisma.channelAccount.findMany({ orderBy: { createdAt: "asc" } });
  const byChannel = new Map();
  for (const account of accounts) {
    if (!byChannel.has(account.channel)) byChannel.set(account.channel, []);
    byChannel.get(account.channel).push(publicAccount(account));
  }
  return ALL_MANAGED_CHANNELS.map((channel) => ({
    channel,
    adapterAvailable: Boolean(getAdapterClass(channel)),
    capabilities: createAdapter(channel)?.capabilities() || null,
    accounts: byChannel.get(channel) || [],
  }));
}

module.exports = {
  assertIntegrationManager, createAccount, deleteAccount, getAccount, listAccounts,
  listChannelOverview, setEnabled, testConnection, updateAccount,
};
