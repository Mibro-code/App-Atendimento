require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/database/prisma");
const oauth = require("../src/services/channels/integration-oauth-service");

let account;

test.before(async () => {
  await prisma.channelOAuthState.deleteMany({});
  await prisma.channelAccount.deleteMany({ where: { name: "Teste OAuth seguro" } });
  account = await prisma.channelAccount.create({ data: { channel: "MERCADO_LIVRE", name: "Teste OAuth seguro" } });
});

test.after(async () => {
  await prisma.channelOAuthState.deleteMany({ where: { channelAccountId: account.id } });
  await prisma.channelAccount.delete({ where: { id: account.id } });
  await prisma.$disconnect();
});

async function createState(actorUserId = "master-a") {
  return oauth.createAuthorizationRequest({
    channel: "MERCADO_LIVRE", channelAccountId: account.id, provider: "MERCADO_LIVRE",
    clientId: "client-id", redirectUri: "https://app.example/oauth/callback", actorUserId,
  });
}

test("state OAuth fica vinculado ao usuário que iniciou e não é queimado por outro usuário", async () => {
  const { state } = await createState();
  await assert.rejects(() => oauth.consumeState(state, "master-b"), (error) => error.statusCode === 403);
  const stored = await prisma.channelOAuthState.findUnique({ where: { state } });
  assert.equal(stored.consumedAt, null);
  assert.equal(stored.metadata.actorUserId, "master-a");
});

test("consumo concorrente do mesmo state OAuth permite exatamente um callback", async () => {
  const { state } = await createState();
  const results = await Promise.allSettled([
    oauth.consumeState(state, "master-a"),
    oauth.consumeState(state, "master-a"),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
});

test("state OAuth expirado nunca é consumido", async () => {
  const { state } = await createState();
  await prisma.channelOAuthState.update({ where: { state }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(() => oauth.consumeState(state, "master-a"), (error) => error.statusCode === 400);
});
