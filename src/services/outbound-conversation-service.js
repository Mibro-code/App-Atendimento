const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const {
  listApprovedTemplates,
  sendApprovedTemplate,
  templatesConfigured,
} = require("./meta-template-service");

function normalizeOutboundPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 8 || digits.length > 15) {
    throw Object.assign(new Error("Informe um telefone válido com DDD e código do país."), { statusCode: 400 });
  }
  return digits;
}

function cleanCustomName(value) {
  const name = String(value || "").trim();
  if (!name) throw Object.assign(new Error("Informe o nome do contato."), { statusCode: 400 });
  if (name.length > 160) throw Object.assign(new Error("O nome deve ter no máximo 160 caracteres."), { statusCode: 400 });
  return name;
}

async function validateTemplateSelection(channel, selection) {
  const name = String(selection?.name || "").trim();
  const language = String(selection?.language || "").trim();
  const values = selection?.values && typeof selection.values === "object" ? selection.values : {};
  if (!name || !language) {
    throw Object.assign(new Error("Selecione um template aprovado para iniciar a conversa."), { statusCode: 400 });
  }
  const template = (await listApprovedTemplates(channel))
    .find((item) => item.name === name && item.language === language);
  if (!template) throw Object.assign(new Error("Template aprovado não encontrado na Meta."), { statusCode: 404 });
  if (!template.supported) throw Object.assign(new Error(template.unsupportedReason), { statusCode: 400 });
  for (const variable of template.variables || []) {
    if (!String(values[variable.key] || "").trim()) {
      throw Object.assign(new Error(`Preencha a variável ${variable.label}.`), { statusCode: 400 });
    }
  }
  return { name, language, values };
}

async function findExistingConversation(phone) {
  return prisma.conversation.findFirst({
    where: { channel: "META", contact: { is: { channel: "META", externalId: phone } } },
    select: { id: true, contactId: true },
  });
}

async function createOutboundConversation({ phone, customName, template, user, channel }) {
  if (!templatesConfigured()) {
    throw Object.assign(new Error("A criação de conversas ficará disponível após configurar os templates da Meta."), {
      statusCode: 503,
      code: "META_TEMPLATES_NOT_CONFIGURED",
    });
  }
  const normalizedPhone = normalizeOutboundPhone(phone);
  const normalizedName = cleanCustomName(customName);
  const selectedTemplate = await validateTemplateSelection(channel, template);

  let conversation = await findExistingConversation(normalizedPhone);
  let created = false;
  if (conversation) {
    await authorization.assertCanViewConversation(user, conversation.id);
    await prisma.contact.update({
      where: { id: conversation.contactId },
      data: { phone: normalizedPhone, customName: normalizedName },
    });
  } else {
    const result = await prisma.$transaction(async (transaction) => {
      const contact = await transaction.contact.upsert({
        where: { channel_externalId: { channel: "META", externalId: normalizedPhone } },
        update: { phone: normalizedPhone, customName: normalizedName },
        create: {
          channel: "META", externalId: normalizedPhone, phone: normalizedPhone,
          name: normalizedName, customName: normalizedName,
        },
      });
      const current = await transaction.conversation.findUnique({
        where: { contactId_channel_channelScope: { contactId: contact.id, channel: "META", channelScope: "LEGACY" } },
        select: { id: true, contactId: true },
      });
      if (current) return { conversation: current, created: false };
      const inserted = await transaction.conversation.create({ data: {
        contactId: contact.id, channel: "META", channelScope: "LEGACY", status: "EM_ATENDIMENTO", assignedUserId: user.id,
      }, select: { id: true, contactId: true } });
      await transaction.conversationActivity.create({ data: {
        conversationId: inserted.id, actorUserId: user.id, action: "CONVERSATION_CREATED",
        details: { source: "panel", phone: normalizedPhone, assignedUserId: user.id },
      } });
      return { conversation: inserted, created: true };
    });
    conversation = result.conversation;
    created = result.created;
    if (!created) await authorization.assertCanViewConversation(user, conversation.id);
  }

  const result = await sendApprovedTemplate({
    conversationId: conversation.id,
    ...selectedTemplate,
    sentByUserId: user.id,
    channel,
  });
  return { conversationId: conversation.id, created, message: result.message };
}

module.exports = { createOutboundConversation, normalizeOutboundPhone };
