require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/database/prisma");
const { finalizeInactiveConversations } = require("../src/services/conversation-inactivity-service");
const { saveIncoming } = require("../src/services/message-service");

const testContacts = ["inactive-outgoing-test", "inactive-incoming-test", "inactive-routing-test"];

test.after(async () => {
  await prisma.contact.deleteMany({ where: { externalId: { in: testContacts } } });
  await prisma.$disconnect();
});

test("finaliza após 15 minutos somente quando a equipe aguarda o cliente", async () => {
  const now = new Date("2026-08-12T15:30:00.000Z");
  const old = new Date("2026-08-12T15:14:00.000Z");
  const support = await prisma.category.findUnique({ where: { code: "SUPORTE" } });
  const outgoingContact = await prisma.contact.create({
    data: { externalId: testContacts[0], phone: "5511977770001", name: "Cliente sem retorno" },
  });
  const incomingContact = await prisma.contact.create({
    data: { externalId: testContacts[1], phone: "5511977770002", name: "Cliente aguardando equipe" },
  });
  const routingContact = await prisma.contact.create({
    data: { externalId: testContacts[2], phone: "5511977770003", name: "Cliente recém-encaminhado" },
  });
  const outgoingConversation = await prisma.conversation.create({
    data: { contactId: outgoingContact.id, categoryId: support.id, status: "EM_ATENDIMENTO", lastMessageAt: old },
  });
  const incomingConversation = await prisma.conversation.create({
    data: { contactId: incomingContact.id, categoryId: support.id, status: "AGUARDANDO_RESPOSTA", lastMessageAt: old },
  });
  const routingConversation = await prisma.conversation.create({
    data: { contactId: routingContact.id, categoryId: support.id, status: "NOVO", lastMessageAt: old },
  });
  await prisma.message.createMany({ data: [
    { conversationId: outgoingConversation.id, direction: "ENVIADA", status: "ENVIADA", type: "text", text: "Pode confirmar?", occurredAt: old },
    { conversationId: incomingConversation.id, direction: "RECEBIDA", status: "RECEBIDA", type: "text", text: "Preciso de ajuda", occurredAt: old },
    { conversationId: routingConversation.id, direction: "ENVIADA", status: "ENVIADA", type: "text", text: "Encaminhamos seu atendimento", occurredAt: old, rawPayload: { system: "triage_confirmation" } },
  ] });

  assert.equal(await finalizeInactiveConversations({ now }), 1);
  const finalized = await prisma.conversation.findUnique({ where: { id: outgoingConversation.id } });
  assert.equal(finalized.status, "FINALIZADO");
  assert.equal(finalized.categoryId, null);
  assert.equal(finalized.assignedUserId, null);
  assert.ok(finalized.finalizedAt);
  assert.equal((await prisma.conversation.findUnique({ where: { id: incomingConversation.id } })).status, "AGUARDANDO_RESPOSTA");
  assert.equal((await prisma.conversation.findUnique({ where: { id: routingConversation.id } })).status, "NOVO");
  assert.equal(await prisma.conversationActivity.count({
    where: { conversationId: outgoingConversation.id, action: "AUTO_FINALIZED_INACTIVITY" },
  }), 1);
});

test("nova mensagem em conversa finalizada remove setor para reiniciar a triagem", async () => {
  const support = await prisma.category.findUnique({ where: { code: "SUPORTE" } });
  const conversation = await prisma.conversation.findFirst({
    where: { contact: { externalId: testContacts[0] } },
  });
  await prisma.conversation.update({
    where: { id: conversation.id }, data: { status: "FINALIZADO", categoryId: support.id, finalizedAt: new Date() },
  });
  await saveIncoming({
    externalId: "wamid.inactive.reopened", contactExternalId: testContacts[0],
    phone: "5511977770001", contactName: "Cliente sem retorno", type: "text", text: "Olá novamente",
    occurredAt: new Date(), rawPayload: { id: "wamid.inactive.reopened" },
  });
  const reopened = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  assert.equal(reopened.status, "NOVO");
  assert.equal(reopened.categoryId, null);
  assert.equal(reopened.assignedUserId, null);
  assert.equal(reopened.finalizedAt, null);
});
