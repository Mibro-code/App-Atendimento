const prisma = require("../database/prisma");
const audit = require("./audit-service");

const categoryReplyPrefix = "triage_category:";
const triageCategoryCodes = ["ATENDIMENTO", "SUPORTE", "COMERCIAL", "PARCERIAS"];
const businessTimeZone = "America/Sao_Paulo";
const businessHoursText = "segunda a sexta-feira, das 8h às 17h (horário de Brasília)";

function contactFirstName(contact) {
  const name = contact?.name?.trim();
  if (!name || name === contact?.phone) return "Olá";
  return name.split(/\s+/)[0];
}

function businessParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: businessTimeZone, weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function isBusinessHours(date = new Date()) {
  const { weekday, hour } = businessParts(date);
  return !["Sat", "Sun"].includes(weekday) && Number(hour) >= 8 && Number(hour) < 17;
}

function welcomeText(contact) {
  const greeting = contactFirstName(contact);
  return `👋 ${greeting === "Olá" ? greeting : `Olá, ${greeting}`}! Seja bem-vindo(a) à Mibro Brasil!\n\nÉ um prazer receber você por aqui. Nosso atendimento funciona de ${businessHoursText}.\n\nPara encaminharmos você à equipe certa, escolha abaixo o setor com o qual deseja falar.`;
}

function routingText(contact, category) {
  const greeting = contactFirstName(contact);
  return `✅ Perfeito${greeting === "Olá" ? "" : `, ${greeting}`}! Encaminhamos seu atendimento para o setor ${category.name}. Em breve, nossa equipe continuará a conversa por aqui.\n\n⏱️ Importante: após uma mensagem da nossa equipe, aguardaremos sua resposta por 15 minutos. Se não houver retorno nesse período, a conversa será finalizada automaticamente. Mas fique tranquilo(a): sempre que precisar, basta enviar uma nova mensagem para iniciar outro atendimento.`;
}

function afterHoursText(contact) {
  const greeting = contactFirstName(contact);
  return `🌙 ${greeting === "Olá" ? greeting : `Olá, ${greeting}`}! Agradecemos por entrar em contato com a Mibro Brasil.\n\nNo momento, nossa equipe não está online. Nosso atendimento funciona de ${businessHoursText}.\n\nPor favor, envie uma nova mensagem dentro desse horário e teremos prazer em atender você. Até breve!`;
}

function categoryReplyId(categoryId) {
  return `${categoryReplyPrefix}${categoryId}`;
}

async function saveBotText(conversation, text, system, channel) {
  const result = await channel.sendText(conversation.contact.phone, text);
  const occurredAt = new Date();
  await prisma.$transaction([
    prisma.message.create({ data: {
      conversationId: conversation.id, externalId: result.externalId || null, channel: "META",
      direction: "ENVIADA", status: "ENVIADA", type: "text", text, occurredAt,
      rawPayload: { message: result.data, system },
    } }),
    prisma.conversation.update({
      where: { id: conversation.id }, data: { status: "BOT", lastMessageAt: occurredAt },
    }),
  ]);
  return true;
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
  const menuText = welcomeText(conversation.contact);
  const result = await channel.sendList(conversation.contact.phone, {
    body: menuText, button: "Escolher setor", rows,
  });
  await prisma.$transaction([
    prisma.message.create({ data: {
      conversationId: conversation.id, externalId: result.externalId || null, channel: "META",
      direction: "ENVIADA", status: "ENVIADA", type: "interactive", text: menuText,
      occurredAt: new Date(), rawPayload: { message: result.data, system: "triage_menu" },
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

  const claimed = await prisma.conversation.updateMany({
    where: { id: conversation.id, categoryId: null, status: "BOT" },
    data: { categoryId: category.id, status: "NOVO", assignedUserId: null, finalizedAt: null },
  });
  if (!claimed.count) return false;

  try {
    const text = routingText(conversation.contact, category);
    const result = await channel.sendText(conversation.contact.phone, text);
    const occurredAt = new Date();
    await prisma.$transaction(async (transaction) => {
      await transaction.message.create({ data: {
        conversationId: conversation.id, externalId: result.externalId || null, channel: "META",
        direction: "ENVIADA", status: "ENVIADA", type: "text", text, occurredAt,
        rawPayload: { message: result.data, system: "triage_confirmation" },
      } });
      await transaction.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: occurredAt } });
      await transaction.conversationActivity.create({ data: {
        conversationId: conversation.id, action: "BOT_TRIAGE_COMPLETED",
        details: { categoryId: category.id, categoryName: category.name },
      } });
      await audit.recordAudit({
        actor: null,
        action: "CONVERSATION_CATEGORY_CHANGED",
        entityType: "CONVERSATION",
        entityId: conversation.id,
        summary: `Bot encaminhou a conversa de ${conversation.contact.customName || conversation.contact.name || conversation.contact.phone} para ${category.name}`,
        details: {
          conversationId: conversation.id,
          contactCustomName: conversation.contact.customName || null,
          contactName: conversation.contact.name || null,
          contactPhone: conversation.contact.phone,
          from: "Sem categoria",
          to: category.name,
          fromCategoryId: null,
          toCategoryId: category.id,
        },
      }, transaction);
    });
    return true;
  } catch (error) {
    await prisma.conversation.updateMany({
      where: { id: conversation.id, categoryId: category.id, status: "NOVO", assignedUserId: null },
      data: { categoryId: null, status: "BOT" },
    });
    throw error;
  }
}

async function handleIncomingTriage(event, message, channel, { now = new Date() } = {}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: message.conversationId },
    include: {
      contact: true,
      messages: {
        where: { direction: "ENVIADA" }, orderBy: { occurredAt: "desc" }, take: 1,
        select: { rawPayload: true },
      },
    },
  });
  if (!conversation) return false;
  if (conversation.categoryId) return false;

  if (event.interactiveReplyId?.startsWith(categoryReplyPrefix)) {
    if (!isBusinessHours(now)) return false;
    return completeTriage(conversation, event.interactiveReplyId.slice(categoryReplyPrefix.length), channel);
  }
  const businessHours = isBusinessHours(now);
  const lastAutomation = conversation.messages[0]?.rawPayload?.system;
  const canStart = conversation.status === "NOVO"
    || (conversation.status === "BOT" && businessHours && lastAutomation === "after_hours");
  if (!canStart) return false;
  const claimed = await prisma.conversation.updateMany({
    where: {
      id: conversation.id, categoryId: null,
      status: conversation.status, updatedAt: conversation.updatedAt,
    },
    data: { status: "BOT" },
  });
  if (!claimed.count) return false;
  try {
    if (!businessHours) {
      return await saveBotText(conversation, afterHoursText(conversation.contact), "after_hours", channel);
    }
    return await sendCategoryMenu(conversation, channel);
  } catch (error) {
    await prisma.conversation.updateMany({
      where: { id: conversation.id, categoryId: null, status: "BOT" }, data: { status: "NOVO" },
    });
    throw error;
  }
}

module.exports = {
  afterHoursText, businessHoursText, categoryReplyId, handleIncomingTriage,
  isBusinessHours, routingText, welcomeText,
};
