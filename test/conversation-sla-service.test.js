require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/database/prisma");
const {
  checkFirstResponseSla, checkResponseSla, checkStalledConversationAlert, checkUnansweredConversationAlert,
} = require("../src/services/conversation-sla-service");
const { updateConversationAfterSending } = require("../src/services/message-service");

const testContacts = [
  "sla-first-response-test", "sla-response-test", "sla-internal-note-test", "sla-idempotent-test",
];

const baseSettings = {
  firstResponseSlaEnabled: true, firstResponseSlaMinutes: 10,
  responseSlaEnabled: true, responseSlaMinutes: 15,
  unansweredConversationAlertEnabled: true, unansweredConversationAlertMinutes: 30,
  stalledConversationAlertEnabled: true, stalledConversationAlertMinutes: 360,
  slaBusinessHoursOnly: false,
};

async function createContactAndConversation(externalId, phone, status, lastMessageAt) {
  const contact = await prisma.contact.create({ data: { externalId, phone, name: `Cliente ${externalId}` } });
  const conversation = await prisma.conversation.create({
    data: { contactId: contact.id, status, lastMessageAt },
  });
  return { contact, conversation };
}

test.after(async () => {
  await prisma.contact.deleteMany({ where: { externalId: { in: testContacts } } });
  await prisma.$disconnect();
});

test("SLA de primeira resposta: inicia com mensagem do cliente (status NOVO) e some quando a empresa responde", async () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const old = new Date("2026-08-20T11:00:00.000Z"); // 60min atrás, > 10min de SLA
  const { conversation } = await createContactAndConversation(testContacts[0], "5511900000001", "NOVO", old);

  const flagged = await checkFirstResponseSla({ now, settings: baseSettings });
  assert.ok(flagged >= 1);
  let updated = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  assert.equal(updated.firstResponseSlaBreached, true);

  // Empresa responde -> updateConversationAfterSending reseta o indicador.
  await updateConversationAfterSending({ conversationId: conversation.id, sentByUserId: null, occurredAt: now });
  updated = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  assert.equal(updated.firstResponseSlaBreached, false);
  assert.notEqual(updated.status, "FINALIZADO"); // nunca finaliza por causa da SLA
});

test("SLA de resposta durante atendimento: alerta quando AGUARDANDO_RESPOSTA ultrapassa o prazo, nunca finaliza", async () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const old = new Date("2026-08-20T11:30:00.000Z"); // 30min atrás, > 15min de SLA
  const { conversation } = await createContactAndConversation(testContacts[1], "5511900000002", "AGUARDANDO_RESPOSTA", old);

  const flagged = await checkResponseSla({ now, settings: baseSettings });
  assert.ok(flagged >= 1);
  const activity = await prisma.conversationActivity.findFirst({
    where: { conversationId: conversation.id, action: "SLA_RESPONSE_BREACHED" },
  });
  assert.ok(activity, "deveria gravar SLA_RESPONSE_BREACHED");
  const updated = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  assert.equal(updated.status, "AGUARDANDO_RESPOSTA");
  assert.notEqual(updated.status, "FINALIZADO");
});

test("mensagem interna (chat interno da equipe) não reseta o SLA de resposta em atendimento", async () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const old = new Date("2026-08-20T11:30:00.000Z");
  const { conversation } = await createContactAndConversation(testContacts[2], "5511900000003", "AGUARDANDO_RESPOSTA", old);

  const chat = await prisma.internalChat.create({ data: { key: `sla-test-chat-${conversation.id}`, type: "GENERAL" } });
  await prisma.internalMessage.create({
    data: { chatId: chat.id, conversationId: conversation.id, type: "USER", text: "Nota interna, cliente ainda não recebeu retorno" },
  });

  const untouched = await prisma.conversation.findUnique({ where: { id: conversation.id } });
  assert.equal(untouched.status, "AGUARDANDO_RESPOSTA");
  assert.equal(untouched.lastMessageAt.getTime(), old.getTime());

  const flagged = await checkResponseSla({ now, settings: baseSettings });
  assert.ok(flagged >= 1, "a mensagem interna não deveria ter resetado o SLA");
});

test("alertas não duplicam em execuções repetidas do monitor (idempotência)", async () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const old = new Date("2026-08-20T05:00:00.000Z"); // 7h atrás, > 6h de stalled
  const { conversation } = await createContactAndConversation(testContacts[3], "5511900000004", "EM_ATENDIMENTO", old);

  await checkStalledConversationAlert({ now, settings: baseSettings });
  await checkStalledConversationAlert({ now, settings: baseSettings });
  await checkUnansweredConversationAlert({ now, settings: { ...baseSettings, unansweredConversationAlertMinutes: 30 } });

  const stalledCount = await prisma.conversationActivity.count({
    where: { conversationId: conversation.id, action: "STALLED_CONVERSATION_ALERT" },
  });
  assert.equal(stalledCount, 1, "não deveria duplicar o alerta de conversa parada");
});
