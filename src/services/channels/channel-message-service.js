// Dispatcher único de envio (item 20 — channelMessageService.send()). A
// Central/Bot chamam só isto; nunca falam com um adapter concreto direto.
const prisma = require("../../database/prisma");
const { createAdapter } = require("./channel-adapter-registry");
const { decryptSecrets } = require("./integration-secret-service");
const { NEW_CHANNELS, channelError } = require("./channel-constants");
const { assertNewChannelEnabled } = require("./integration-global-settings-service");

function decryptSecretsSafe(account) {
  try {
    return decryptSecrets(account);
  } catch (_error) {
    return {};
  }
}

async function loadAccount(channelAccountId, channel) {
  if (!channelAccountId) return null;
  const account = await prisma.channelAccount.findUnique({ where: { id: channelAccountId } });
  if (!account) throw channelError("PROVIDER_ERROR", "Conta de canal não encontrada.");
  if (channel && account.channel !== channel) throw channelError("INVALID_PAYLOAD", "Conta de canal não corresponde ao canal informado.");
  return account;
}

function buildAdapter(channel, account) {
  const adapterAccount = account
    ? {
        ...account, secrets: decryptSecretsSafe(account),
        config: Object.fromEntries(Object.entries(account.config || {}).filter(([key]) => key !== "_secretHints")),
      }
    : null;
  const adapter = createAdapter(channel, adapterAccount);
  if (!adapter) throw channelError("NOT_SUPPORTED", `Canal ${channel} sem adapter disponível.`);
  return adapter;
}

// `send({ channel, channelAccountId, ...params })` — nunca assume
// capability: sempre confere capabilities() primeiro (item 3/12).
async function send({ channel, channelAccountId, kind = "text", ...params }) {
  if (!channel) throw channelError("INVALID_PAYLOAD", "Canal é obrigatório para envio.");
  await assertNewChannelEnabled(channel);
  if (NEW_CHANNELS.includes(channel) && !channelAccountId) {
    throw channelError("INVALID_PAYLOAD", "Conta de canal é obrigatória para novos canais.");
  }
  const account = await loadAccount(channelAccountId, channel);
  if (channelAccountId && account && !account.enabled) {
    throw channelError("NOT_SUPPORTED", "Conta de canal está desativada.");
  }
  const adapter = buildAdapter(channel, account);
  const capabilities = adapter.capabilities();

  if (kind === "media") {
    if (!capabilities.canSendMedia) throw channelError("NOT_SUPPORTED", `Canal ${channel} não suporta envio de mídia.`);
    return adapter.sendMedia(params);
  }
  if (!capabilities.canSendMessages) throw channelError("NOT_SUPPORTED", `Canal ${channel} não suporta envio de mensagens.`);
  return adapter.sendMessage(params);
}

async function markAsRead({ channel, channelAccountId, ...params }) {
  await assertNewChannelEnabled(channel);
  if (NEW_CHANNELS.includes(channel) && !channelAccountId) {
    throw channelError("INVALID_PAYLOAD", "Conta de canal é obrigatória para novos canais.");
  }
  const account = await loadAccount(channelAccountId, channel);
  if (account && !account.enabled) throw channelError("NOT_SUPPORTED", "Conta de canal está desativada.");
  const adapter = buildAdapter(channel, account);
  if (!adapter.capabilities().canMarkRead) throw channelError("NOT_SUPPORTED", `Canal ${channel} não suporta marcar como lido.`);
  return adapter.markAsRead(params);
}

module.exports = { markAsRead, send };
