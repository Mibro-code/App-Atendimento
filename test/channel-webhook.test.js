require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const prisma = require("../src/database/prisma");

test.before(async () => {
  await prisma.message.deleteMany({ where: { channel: "MERCADO_LIVRE" } });
  await prisma.conversation.deleteMany({ where: { channel: "MERCADO_LIVRE" } });
  await prisma.contact.deleteMany({ where: { channel: "MERCADO_LIVRE" } });
  await prisma.externalChannelEvent.deleteMany({ where: { channel: "MERCADO_LIVRE" } });
});

test.after(async () => prisma.$disconnect());

async function startServer() {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("webhook de canal desconhecido/ainda não gerenciado responde 404 sem vazar detalhe interno", async () => {
  const { server, base } = await startServer();
  try {
    const response = await fetch(`${base}/webhooks/channels/CANAL_INEXISTENTE`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, 404);
  } finally { server.close(); }
});

test("webhook do Mercado Livre fica fechado enquanto a autenticação do provider não estiver implementada", async () => {
  await prisma.integrationGlobalSettings.upsert({
    where: { id: "singleton" }, update: { newChannelsEnabled: true },
    create: { id: "singleton", newChannelsEnabled: true },
  });
  const account = await prisma.channelAccount.create({
    data: { channel: "MERCADO_LIVRE", name: "Teste Webhook ML", enabled: true },
  });
  const { server, base } = await startServer();
  try {
    const payload = { resource: "/questions/555444", user_id: 555, topic: "questions", sent: new Date().toISOString() };
    const response = await fetch(`${base}/webhooks/channels/MERCADO_LIVRE`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    assert.equal(response.status, 404);
    assert.equal(await prisma.externalChannelEvent.count({ where: { channelAccountId: account.id } }), 0);
    assert.equal(await prisma.message.count({ where: { channelAccountId: account.id } }), 0);
  } finally {
    server.close();
    await prisma.channelAccount.delete({ where: { id: account.id } });
    await prisma.integrationGlobalSettings.update({ where: { id: "singleton" }, data: { newChannelsEnabled: false } });
  }
});
test("WhatsApp/Meta continua com sua rota própria intocada (verify token) mesmo com o webhook genérico registrado", async () => {
  const { server, base } = await startServer();
  try {
    const response = await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${process.env.VERIFY_TOKEN || "invalido"}&hub.challenge=abc123`);
    assert.ok([200, 403].includes(response.status));
  } finally { server.close(); }
});
