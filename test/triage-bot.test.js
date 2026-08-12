require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/database/prisma");
const { categoryReplyId, handleIncomingTriage } = require("../src/services/triage-bot-service");

const externalId = "triage-bot-test-contact";

test.after(async () => {
  await prisma.contact.deleteMany({ where: { externalId } });
  await prisma.$disconnect();
});

test("faz a triagem somente pelos quatro setores e registra o encaminhamento", async () => {
  await prisma.contact.deleteMany({ where: { externalId } });
  const contact = await prisma.contact.create({
    data: { externalId, phone: "5511988887777", name: "Cliente Triagem" },
  });
  const conversation = await prisma.conversation.create({ data: { contactId: contact.id } });
  const incoming = await prisma.message.create({ data: {
    conversationId: conversation.id, externalId: "wamid.triage.incoming", direction: "RECEBIDA",
    status: "RECEBIDA", type: "text", text: "Olá", occurredAt: new Date(),
  } });
  const sentLists = [];
  const sentTexts = [];
  const channel = {
    sendList: async (phone, payload) => {
      sentLists.push({ phone, ...payload });
      return { externalId: `wamid.triage.menu.${sentLists.length}`, data: { ok: true } };
    },
    sendText: async (phone, text) => {
      sentTexts.push({ phone, text });
      return { externalId: `wamid.triage.confirmation.${sentTexts.length}`, data: { ok: true } };
    },
  };

  assert.equal(await handleIncomingTriage({}, incoming, channel), true);
  assert.deepEqual(sentLists[0].rows.map(({ title }) => title), [
    "Atendimento", "Suporte", "Comercial", "Parcerias",
  ]);
  assert.equal((await prisma.conversation.findUnique({ where: { id: conversation.id } })).status, "BOT");

  const wholesale = await prisma.category.findUnique({ where: { code: "ATACADO" } });
  const invalidReply = await prisma.message.create({ data: {
    conversationId: conversation.id, externalId: "wamid.triage.invalid", direction: "RECEBIDA",
    status: "RECEBIDA", type: "interactive", text: "Atacado", occurredAt: new Date(),
  } });
  await handleIncomingTriage({ interactiveReplyId: categoryReplyId(wholesale.id) }, invalidReply, channel);
  assert.equal(sentLists.length, 2);
  assert.equal((await prisma.conversation.findUnique({ where: { id: conversation.id } })).categoryId, null);

  const support = await prisma.category.findUnique({ where: { code: "SUPORTE" } });
  const validReply = await prisma.message.create({ data: {
    conversationId: conversation.id, externalId: "wamid.triage.valid", direction: "RECEBIDA",
    status: "RECEBIDA", type: "interactive", text: "Suporte", occurredAt: new Date(),
  } });
  await handleIncomingTriage({ interactiveReplyId: categoryReplyId(support.id) }, validReply, channel);
  const completed = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  assert.equal(completed.categoryId, support.id);
  assert.equal(completed.status, "NOVO");
  assert.equal(completed.assignedUserId, null);
  assert.match(sentTexts[0].text, /encaminhando você ao setor Suporte/);
  assert.equal(await prisma.message.count({
    where: { conversationId: conversation.id, direction: "ENVIADA", type: "interactive" },
  }), 2);
  assert.equal(await prisma.conversationActivity.count({
    where: { conversationId: conversation.id, action: "BOT_TRIAGE_COMPLETED" },
  }), 1);
});
