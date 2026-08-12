const prisma = require("../database/prisma");

const categoryReplyPrefix = "triage_category:";
const triageCategoryCodes = ["ATENDIMENTO", "SUPORTE", "COMERCIAL", "PARCERIAS"];
const menuText = "Olá! Para direcionar seu atendimento, selecione com qual setor você deseja falar.";

function categoryReplyId(categoryId) {
  return `${categoryReplyPrefix}${categoryId}`;
}

async function sendCategoryMenu(conversation, channel) {
  const categories = await prisma.category.findMany({
    where: { active: true, parentId: null, code: { in: triageCategoryCodes } },
  });
  categories.sort((left, right) => triageCategoryCodes.indexOf(left.code) - triageCategoryCodes.indexOf(right.code));
  if (!categories.length) return false;
  const rows = categories.map((category) => ({
    id: categoryReplyId(category.id), title: category.name.slice(0, 24),
  }));
  const result = await channel.sendList(conversation.contact.phone, {
    body: menuText, button: "Escolher setor", rows,
  });
  await prisma.$transaction([
    prisma.message.create({ data: {
      conversationId: conversation.id, externalId: result.externalId || null, channel: "META",
      direction: "ENVIADA", status: "ENVIADA", type: "interactive", text: menuText,
      occurredAt: new Date(), rawPayload: result.data,
    } }),
    prisma.conversation.update({
      where: { id: conversation.id }, data: { status: "BOT", lastMessageAt: new Date() },
    }),
  ]);
  return true;
}

async function completeTriage(conversation, categoryId, channel) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, active: true, parentId: null, code: { in: triageCategoryCodes } },
  });
  if (!category) return sendCategoryMenu(conversation, channel);

  const text = `Obrigado! Estou encaminhando você ao setor ${category.name}. Em breve, um atendente continuará o atendimento por aqui.`;
  const result = await channel.sendText(conversation.contact.phone, text);
  const occurredAt = new Date();
  await prisma.$transaction([
    prisma.message.create({ data: {
      conversationId: conversation.id, externalId: result.externalId || null, channel: "META",
      direction: "ENVIADA", status: "ENVIADA", type: "text", text, occurredAt,
      rawPayload: result.data,
    } }),
    prisma.conversation.update({ where: { id: conversation.id }, data: {
      categoryId: category.id, status: "NOVO", assignedUserId: null,
      lastMessageAt: occurredAt, finalizedAt: null,
    } }),
    prisma.conversationActivity.create({ data: {
      conversationId: conversation.id, action: "BOT_TRIAGE_COMPLETED",
      details: { categoryId: category.id, categoryName: category.name },
    } }),
  ]);
  return true;
}

async function handleIncomingTriage(event, message, channel) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: message.conversationId }, include: { contact: true },
  });
  if (!conversation || conversation.categoryId) return false;

  if (event.interactiveReplyId?.startsWith(categoryReplyPrefix)) {
    return completeTriage(conversation, event.interactiveReplyId.slice(categoryReplyPrefix.length), channel);
  }
  return sendCategoryMenu(conversation, channel);
}

module.exports = { categoryReplyId, handleIncomingTriage, menuText };
