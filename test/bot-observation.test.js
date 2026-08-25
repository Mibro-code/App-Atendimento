require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/database/prisma");
const { observeIncomingMessage } = require("../src/services/bot-observation-service");

const botName = "Bot Observação Teste";
const externalId = "bot-observation-test-contact";

async function cleanup() {
  await prisma.bot.deleteMany({ where: { name: botName } });
  await prisma.contact.deleteMany({ where: { externalId } });
}

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("observa a intenção do Bot ativo sem enviar mensagem nem alterar a conversa", async (t) => {
  await cleanup();
  const contact = await prisma.contact.create({
    data: { externalId, phone: "5511988880000", name: "Cliente Observação" },
  });
  const conversation = await prisma.conversation.create({ data: { contactId: contact.id } });
  const message = await prisma.message.create({ data: {
    conversationId: conversation.id, externalId: "wamid.observation.incoming", direction: "RECEBIDA",
    status: "RECEBIDA", type: "text", text: "quero rastrear meu pedido", occurredAt: new Date(),
  } });
  const category = await prisma.category.findFirst();
  const bot = await prisma.bot.create({
    data: {
      name: botName,
      status: "ACTIVE",
      channel: "META",
      initialMessage: "Olá!",
      outsideHoursMessage: "Fora do horário.",
      fallbackMessage: "Não entendi.",
      defaultCategoryId: category?.id || null,
      intents: {
        create: [{
          name: "Rastreamento",
          priority: 1,
          active: true,
          fallbackAction: "USE_BOT_FALLBACK",
          examples: { create: [{ text: "rastrear meu pedido" }] },
        }],
      },
    },
  });

  const logs = [];
  t.mock.method(console, "log", (...args) => logs.push(args));

  const result = await observeIncomingMessage(
    { type: "text", text: message.text }, message, { now: new Date("2026-08-12T14:00:00.000Z") },
  );

  assert.equal(result.intent.name, "Rastreamento");
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], "[BOT_OBSERVATION]");
  const logged = JSON.parse(logs[0][1]);
  assert.equal(logged.conversationId, conversation.id);
  assert.equal(logged.botId, bot.id);
  assert.equal(logged.intent, "Rastreamento");

  const conversationAfter = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  assert.equal(conversationAfter.status, "NOVO");
  assert.equal(conversationAfter.categoryId, null);
  assert.equal(await prisma.message.count({ where: { conversationId: conversation.id } }), 1);

  const observation = await prisma.botObservation.findUnique({ where: { messageId: message.id } });
  assert.ok(observation, "deveria persistir a observação para comparação futura");
  assert.equal(observation.conversationId, conversation.id);
  assert.equal(observation.botId, bot.id);
  assert.equal(observation.botName, botName);
  assert.equal(observation.withinHours, true);
  assert.equal(observation.intentName, "Rastreamento");
  assert.equal(observation.matchedExample, "rastrear meu pedido");
  assert.equal(observation.fallbackAction, "USE_BOT_FALLBACK");
});

test("persiste fallback quando nenhuma intenção é reconhecida, sem alterar a conversa", async () => {
  await cleanup();
  const contact = await prisma.contact.create({
    data: { externalId, phone: "5511988880002", name: "Cliente Fallback" },
  });
  const conversation = await prisma.conversation.create({ data: { contactId: contact.id } });
  const message = await prisma.message.create({ data: {
    conversationId: conversation.id, externalId: "wamid.observation.fallback", direction: "RECEBIDA",
    status: "RECEBIDA", type: "text", text: "mensagem sem intenção cadastrada", occurredAt: new Date(),
  } });
  const bot = await prisma.bot.create({
    data: {
      name: botName,
      status: "ACTIVE",
      channel: "META",
      initialMessage: "Olá!",
      outsideHoursMessage: "Fora do horário.",
      fallbackMessage: "Não entendi.",
    },
  });

  const result = await observeIncomingMessage(
    { type: "text", text: message.text }, message, { now: new Date("2026-08-12T14:00:00.000Z") },
  );

  assert.equal(result.intent, null);
  assert.equal(result.fallbackAction, "USE_BOT_FALLBACK");

  const observation = await prisma.botObservation.findUnique({ where: { messageId: message.id } });
  assert.ok(observation);
  assert.equal(observation.botId, bot.id);
  assert.equal(observation.intentName, null);
  assert.equal(observation.fallbackAction, "USE_BOT_FALLBACK");

  const conversationAfter = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  assert.equal(conversationAfter.status, "NOVO");
  assert.equal(conversationAfter.categoryId, null);
});

test("ignora mensagens que não são texto e retorna null sem consultar o Bot", async () => {
  const result = await observeIncomingMessage({ type: "reaction", text: null }, { conversationId: "irrelevant" });
  assert.equal(result, null);
});

test("retorna null quando não há Bot ativo do canal META", async () => {
  await cleanup();
  const contact = await prisma.contact.create({
    data: { externalId, phone: "5511988880001", name: "Cliente Sem Bot" },
  });
  const conversation = await prisma.conversation.create({ data: { contactId: contact.id } });
  const message = await prisma.message.create({ data: {
    conversationId: conversation.id, externalId: "wamid.observation.no-bot", direction: "RECEBIDA",
    status: "RECEBIDA", type: "text", text: "oi", occurredAt: new Date(),
  } });
  const result = await observeIncomingMessage({ type: "text", text: message.text }, message);
  assert.equal(result, null);
});
