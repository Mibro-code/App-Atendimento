require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/database/prisma");
const { encryptSecrets } = require("../src/services/channels/integration-secret-service");
const { fetchGmailInbox, syncGmailAccount } = require("../src/services/channels/gmail-sync-service");

const accountName = "Gmail Sync Test";
let account;
const sender = "cliente.gmail.sync@example.com";

function gmailMessage(id, internalDate, text) {
  return {
    id, threadId: "thread-sync", internalDate: String(internalDate),
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "From", value: `Cliente Teste <${sender}>` }, { name: "Subject", value: "Teste Gmail" }],
      body: { data: Buffer.from(text).toString("base64url") },
    },
  };
}

test.before(async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = "11".repeat(32);
  await prisma.integrationGlobalSettings.upsert({ where: { id: "singleton" }, update: { newChannelsEnabled: true }, create: { id: "singleton", newChannelsEnabled: true } });
  await prisma.channelAccount.deleteMany({ where: { name: accountName } });
  account = await prisma.channelAccount.create({ data: {
    channel: "EMAIL", name: accountName, status: "CONNECTED", enabled: true,
    oauthProvider: "GOOGLE", tokenExpiresAt: new Date(Date.now() + 3600000),
    config: { provider: "GMAIL", emailAddress: "central@example.com" },
    ...encryptSecrets({ accessToken: "access-test", refreshToken: "refresh-test" }),
  } });
});

test.after(async () => {
  await prisma.externalChannelEvent.deleteMany({ where: { channelAccountId: account.id } });
  await prisma.message.deleteMany({ where: { channelAccountId: account.id } });
  await prisma.conversation.deleteMany({ where: { channelAccountId: account.id } });
  await prisma.contact.deleteMany({ where: { channel: "EMAIL", externalId: { startsWith: `${account.id}:` } } });
  await prisma.channelAccount.delete({ where: { id: account.id } });
  await prisma.$disconnect();
});

test("fetch Gmail pagina, usa somente INBOX e devolve mensagens em ordem cronológica", async () => {
  const calls = [];
  const now = Date.now();
  const http = { get: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/messages")) {
      return options.params.pageToken
        ? { data: { messages: [{ id: "old" }] } }
        : { data: { messages: [{ id: "new" }], nextPageToken: "page-2" } };
    }
    return { data: url.endsWith("/old") ? gmailMessage("old", now - 1000, "Antiga") : gmailMessage("new", now, "Nova") };
  } };
  const result = await fetchGmailInbox({ accessToken: "token", since: new Date(now - 5000), http });
  assert.deepEqual(result.map((item) => item.id), ["old", "new"]);
  assert.equal(calls[0].options.params.labelIds, "INBOX");
  assert.match(calls[0].options.params.q, /^after:\d+$/);
});

test("sincronização importa e-mail recebido uma única vez e avança o cursor", async () => {
  const raw = gmailMessage("gmail-msg-1", Date.now(), "Mensagem recebida de teste");
  const http = { get: async (url) => url.endsWith("/messages") ? { data: { messages: [{ id: raw.id }] } } : { data: raw } };
  assert.equal(await syncGmailAccount(account, { http }), 1);
  const refreshed = await prisma.channelAccount.findUnique({ where: { id: account.id } });
  assert.ok(refreshed.config.gmailSyncCursorAt);
  assert.equal(await syncGmailAccount(refreshed, { http }), 0);
  assert.equal(await prisma.message.count({ where: { channelAccountId: account.id, externalId: `${account.id}:${raw.id}` } }), 1);
});
