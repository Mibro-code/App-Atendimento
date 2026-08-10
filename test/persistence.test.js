require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/database/prisma");
const { saveIncoming, sendText } = require("../src/services/message-service");
const inbox = require("../src/services/inbox-service");

test.before(async () => {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.contact.deleteMany();
});
test.after(async () => {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.user.deleteMany({ where: { email: "teste@mibro.local" } });
  await prisma.$disconnect();
});

test("persiste contato, conversa e mensagem sem duplicar wamid", async () => {
  const event = {
    externalId: "wamid.test.incoming", contactExternalId: "5511999999999",
    phone: "5511999999999", contactName: "Cliente Teste", type: "text", text: "Preciso de suporte",
    occurredAt: new Date("2026-08-10T12:00:00Z"), rawPayload: { id: "wamid.test.incoming" },
  };
  const results = await Promise.all([saveIncoming(event), saveIncoming(event)]);
  assert.deepEqual(results.map((item) => item.duplicate).sort(), [false, true]);
  assert.equal(await prisma.contact.count(), 1);
  assert.equal(await prisma.conversation.count(), 1);
  assert.equal(await prisma.message.count(), 1);
  const conversation = await prisma.conversation.findFirst();
  assert.equal(conversation.unreadCount, 1);
  assert.equal(conversation.status, "NOVO");
});

test("registra mensagem enviada e o atendente autor", async () => {
  const user = await prisma.user.upsert({
    where: { email: "teste@mibro.local" }, update: {},
    create: { name: "Atendente Teste", email: "teste@mibro.local", role: "ATENDENTE" },
  });
  const conversation = await prisma.conversation.findFirst();
  const channel = { sendText: async () => ({ externalId: "wamid.test.outgoing", data: { messages: [{ id: "wamid.test.outgoing" }] } }) };
  const result = await sendText({ conversationId: conversation.id, text: "Qual é o modelo?", sentByUserId: user.id, channel });
  assert.equal(result.message.direction, "ENVIADA");
  assert.equal(result.message.sentByUserId, user.id);
  assert.equal(await prisma.message.count(), 2);
});

test("lista, pesquisa, classifica, lê, finaliza e reabre a conversa", async () => {
  const category = await prisma.category.findUnique({ where: { code: "SUPORTE" } });
  let conversation = await prisma.conversation.findFirst();
  conversation = await inbox.updateConversation(conversation.id, {
    categoryId: category.id, status: "EM_ATENDIMENTO",
  });
  assert.equal(conversation.category.code, "SUPORTE");
  assert.equal(conversation.status, "EM_ATENDIMENTO");

  const result = await inbox.listConversations({ search: "Cliente", category: "SUPORTE", status: "EM_ATENDIMENTO" });
  assert.equal(result.length, 1);
  assert.equal(result[0].messages[0].text, "Qual é o modelo?");

  await inbox.markAsRead(conversation.id);
  assert.equal((await inbox.getConversation(conversation.id)).unreadCount, 0);
  await inbox.updateConversation(conversation.id, { status: "FINALIZADO" });
  assert.ok((await inbox.getConversation(conversation.id)).finalizedAt);
  await inbox.updateConversation(conversation.id, { status: "NOVO" });
  assert.equal((await inbox.getConversation(conversation.id)).finalizedAt, null);
});

test("salva notas no contato e mantém busca pelo nome", async () => {
  const conversation = await prisma.conversation.findFirst({ include: { contact: true } });
  const note = await inbox.addContactNote(conversation.contactId, { content: "Cliente prefere atendimento no período da tarde." });
  assert.equal(note.content, "Cliente prefere atendimento no período da tarde.");
  const detail = await inbox.getConversation(conversation.id);
  assert.equal(detail.contact.notes.length, 1);
  const found = await inbox.listConversations({ search: "Cliente Teste" });
  assert.equal(found.length, 1);
  assert.equal(found[0].contact.name, "Cliente Teste");
  assert.equal(found[0].contact.notes[0].content, "Cliente prefere atendimento no período da tarde.");
  assert.equal(found[0].contact._count.notes, 1);
});
