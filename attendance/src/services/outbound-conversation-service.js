const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const { whatsappIdVariants } = require("./conversation-service");
const channelMessageService = require("./channels/channel-message-service");
const { ALL_MANAGED_CHANNELS, CHANNEL_LABELS } = require("./channels/channel-constants");
const { updateConversationAfterSending } = require("./message-service");
const { removeImage, storeDocument } = require("./media-storage-service");
const whatsappAccounts = require("./whatsapp-account-service");
const {
  listApprovedTemplates,
  sendApprovedTemplate,
  templatesConfigured,
} = require("./meta-template-service");

async function canStartInAnyCompany(user, channel) {
  if (!user?.id) return authorization.canStartConversations(user, channel);
  for (const entry of await require("./company-service").companyAccess(user)) {
    if (authorization.canStartConversations(await authorization.forCompany(user, entry.companyId), channel)) return true;
  }
  return false;
}

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

async function validateTemplateSelection(channel, selection, account = null) {
  const name = String(selection?.name || "").trim();
  const language = String(selection?.language || "").trim();
  const values = selection?.values && typeof selection.values === "object" ? selection.values : {};
  if (!name || !language) {
    throw Object.assign(new Error("Selecione um template aprovado para iniciar a conversa."), { statusCode: 400 });
  }
  const template = (await listApprovedTemplates(channel, account))
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

// Multiempresa: procura só na empresa/número escolhidos — o mesmo telefone
// na outra empresa é outro cliente, com outra conversa.
async function findExistingConversation(phone, account) {
  // Primeiro o número exato; se não houver, a outra grafia (com/sem o 9º
  // dígito) — evita abrir uma segunda conversa para o mesmo cliente.
  const channelScope = whatsappAccounts.conversationScopeFor(account);
  for (const externalId of whatsappIdVariants(phone)) {
    const conversation = await prisma.conversation.findFirst({
      where: {
        companyId: account.companyId, channel: "META", channelScope,
        contact: { is: { companyId: account.companyId, channel: "META", externalId } },
      },
      select: { id: true, contactId: true },
    });
    if (conversation) return await require("./whatsapp-inbox-service").findInbox(conversation.contactId) || conversation;
  }
  return null;
}

// `channelAccountId` = número (e portanto empresa) escolhido na tela "Nova
// conversa". Validado contra o acesso do usuário; nunca cai num número
// padrão quando o usuário tem mais de um.
async function createOutboundConversation({ phone, customName, template, user, channel, channelAccountId, company, accountId }) {
  if (!(await canStartInAnyCompany(user, "META"))) throw authorization.forbidden("Você não tem permissão para iniciar conversas por WhatsApp.");
  const requestedId = channelAccountId || (accountId && accountId !== "legacy" ? accountId : null);
  const account = accountId === "legacy" && !channelAccountId
    ? await whatsappAccounts.getLegacyAccount()
    : await whatsappAccounts.resolveAccountForUser(user, { channelAccountId: requestedId, company });
  if (!account || !(await require("./company-service").canAccessCompany(user, account.companyId))) throw authorization.forbidden("Você não tem acesso a este número.");
  if (company && account.companyId !== await require("./company-service").resolveWorkspace(user, company)) throw authorization.forbidden("Selecione um número da empresa aberta.");
  if (!(await authorization.canAccessChannelAccount(user, account.id))) throw authorization.forbidden("Você não tem acesso a este número.");
  const selectedAccountId = account.config?.isLegacyWhatsApp || account.config?.legacyEnv ? null : account.id;
  authorization.assertCanStartConversations(await authorization.forCompany(user, account.companyId), "META");
  if (!templatesConfigured(account)) {
    throw Object.assign(new Error("A criação de conversas ficará disponível após configurar os templates da Meta."), {
      statusCode: 503,
      code: "META_TEMPLATES_NOT_CONFIGURED",
    });
  }
  const normalizedPhone = normalizeOutboundPhone(phone);
  const normalizedName = cleanCustomName(customName);
  const selectedTemplate = await validateTemplateSelection(channel, template, account);

  let conversation = await findExistingConversation(normalizedPhone, account);
  let created = false;
  if (conversation) {
    await authorization.assertCanActOnConversation(user, conversation.id);
    await prisma.contact.update({
      where: { id: conversation.contactId },
      data: { phone: normalizedPhone, customName: normalizedName },
    });
  } else {
    const result = await prisma.$transaction(async (transaction) => {
      const companyId = account.companyId;
      const channelScope = whatsappAccounts.conversationScopeFor(account);
      const contact = await transaction.contact.upsert({
        where: { companyId_channel_externalId: { companyId, channel: "META", externalId: normalizedPhone } },
        update: { phone: normalizedPhone, customName: normalizedName },
        create: {
          companyId, channel: "META", externalId: normalizedPhone, phone: normalizedPhone,
          name: normalizedName, customName: normalizedName,
        },
      });
      const current = await transaction.conversation.findUnique({
        where: { contactId_channel_channelScope: { contactId: contact.id, channel: "META", channelScope } },
        select: { id: true, contactId: true },
      });
      const root = await require("./whatsapp-inbox-service").findInbox(contact.id, transaction);
      if (root || current) return { conversation: root || await require("./whatsapp-inbox-service").attachInbox(contact.id, current.id, transaction), created: false };
      const inserted = await transaction.conversation.create({ data: {
        companyId, contactId: contact.id, channel: "META", channelScope, channelAccountId: account.id,
        status: "EM_ATENDIMENTO", assignedUserId: user.id,
      }, select: { id: true, contactId: true } });
      await transaction.conversationActivity.create({ data: {
        conversationId: inserted.id, actorUserId: user.id, action: "CONVERSATION_CREATED",
        details: { source: "panel", phone: normalizedPhone, assignedUserId: user.id, companyId, channelAccountId: account.id },
      } });
      return { conversation: await require("./whatsapp-inbox-service").attachInbox(contact.id, inserted.id, transaction), created: true };
    });
    conversation = result.conversation;
    created = result.created;
    if (!created) await authorization.assertCanActOnConversation(user, conversation.id);
  }

  const result = await sendApprovedTemplate({
    conversationId: conversation.id,
    requestedAccountId: selectedAccountId || "legacy",
    ...selectedTemplate,
    sentByUserId: user.id,
    channel,
  });
  return { conversationId: conversation.id, created, message: result.message };
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw Object.assign(new Error("Informe um endereço de e-mail válido."), { statusCode: 400 });
  }
  return email;
}

function cleanRequiredText(value, field, maxLength) {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error(`${field} é obrigatório.`), { statusCode: 400 });
  if (text.length > maxLength) throw Object.assign(new Error(`${field} deve ter no máximo ${maxLength} caracteres.`), { statusCode: 400 });
  return text;
}

function emailAccountScope(user) {
  return authorization.isMaster(user) ? {} : { accessUsers: { some: { userId: user.id } } };
}

async function availableEmailAccounts(user, companyId = null) {
  const companies = await require("./company-service").companyAccess(user);
  const allowed = [];
  for (const { companyId } of companies) {
    if (authorization.canStartConversations(await authorization.forCompany(user, companyId), "EMAIL")) allowed.push(companyId);
  }
  return prisma.channelAccount.findMany({
    where: { channel: "EMAIL", enabled: true, status: "CONNECTED", ...emailAccountScope(user), companyId: { in: allowed.filter(id => !companyId || id === companyId) } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, externalAccountId: true, providerMetadata: true },
  });
}

async function availableMetaAccounts(user, companyId = null) {
  const companies = await require("./company-service").companyAccess(user);
  const allowed = [];
  for (const { companyId } of companies) {
    const scoped = await authorization.forCompany(user, companyId);
    if (authorization.canStartConversations(scoped, "META") || authorization.canManageCampaigns(scoped)) allowed.push(companyId);
  }
  const stored = await prisma.channelAccount.findMany({
    where: { channel: "META", enabled: true, status: "CONNECTED", ...emailAccountScope(user), companyId: { in: allowed.filter(id => !companyId || id === companyId) } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, externalAccountId: true, providerMetadata: true, config: true },
  });
  const rows = stored.map((account) => ({
    id: account.config?.isLegacyWhatsApp ? "legacy" : account.id, name: account.name,
    address: account.providerMetadata?.username || account.config?.displayPhoneNumber || account.externalAccountId || null,
  }));
  return rows;
}

async function listOutboundChannels(user, { company } = {}) {
  const companyId = company ? await require("./company-service").resolveWorkspace(user, company) : null;
  const canEmail = await canStartInAnyCompany(user, "EMAIL");
  const canIndividual = await canStartInAnyCompany(user, "META");
  const canBulk = (await require("./campaign-service").manageableCompanyIds(user)).length > 0;
  if (!canEmail && !canIndividual && !canBulk) return [];
  const [accounts, metaAccounts] = await Promise.all([canEmail ? availableEmailAccounts(user, companyId) : [], canIndividual || canBulk ? availableMetaAccounts(user, companyId) : []]);
  return ALL_MANAGED_CHANNELS.map((channelName) => {
    if (channelName === "EMAIL") return {
      channel: channelName, label: CHANNEL_LABELS[channelName], enabled: canEmail && accounts.length > 0,
      reason: !canEmail ? "Sem permissão para iniciar conversas por e-mail." : accounts.length ? null : "Nenhuma conta de e-mail conectada e liberada para você.",
      accounts: accounts.map((account) => ({
        id: account.id, name: account.name,
        address: account.providerMetadata?.username || account.externalAccountId || null,
      })),
    };
    if (channelName === "META") {
      const enabled = metaAccounts.length > 0;
      return {
        channel: channelName, label: CHANNEL_LABELS[channelName], enabled,
        accounts: enabled ? metaAccounts : [],
        // Modos liberados para este usuário no painel "Nova conversa".
        modes: { individual: canIndividual, bulk: canBulk },
        reason: !canIndividual && !canBulk ? "Sem permissão para iniciar conversas por WhatsApp." : enabled ? null : "Nenhum número WhatsApp conectado e liberado para você.",
      };
    }
    return {
      channel: channelName, label: CHANNEL_LABELS[channelName], enabled: false, accounts: [],
      reason: "Integração ainda não liberada para iniciar conversas.",
    };
  });
}

async function createOutboundEmail({ accountId, to, customName, subject, text, attachments = [], user }) {
  if (!(await canStartInAnyCompany(user, "EMAIL"))) throw authorization.forbidden("Você não tem permissão para iniciar conversas por e-mail.");
  const email = normalizeEmail(to);
  const name = cleanCustomName(customName || email);
  const cleanSubject = cleanRequiredText(subject, "Assunto", 240);
  const cleanBody = cleanRequiredText(text, "Mensagem", 20000);
  if (!Array.isArray(attachments) || attachments.length > 10) {
    throw Object.assign(new Error("Envie no máximo 10 documentos por e-mail."), { statusCode: 400 });
  }
  const attachmentBytes = attachments.reduce((total, attachment) => total + (attachment.buffer?.length || 0), 0);
  if (attachmentBytes > 20 * 1024 * 1024) {
    throw Object.assign(new Error("Os documentos do e-mail devem somar no máximo 20 MB."), { statusCode: 413 });
  }
  const account = await prisma.channelAccount.findFirst({
    where: {
      id: String(accountId || ""), channel: "EMAIL", enabled: true, status: "CONNECTED", ...emailAccountScope(user),
      ...(await authorization.companyScope(user)),
    },
    select: { id: true, companyId: true },
  });
  if (!account) throw authorization.forbidden("Esta conta de e-mail não está conectada ou não foi liberada para você.");
  authorization.assertCanStartConversations(await authorization.forCompany(user, account.companyId), "EMAIL");

  const externalContactId = `${account.id}:${email}`;
  const existing = await prisma.conversation.findFirst({
    where: { channel: "EMAIL", channelAccountId: account.id, contact: { is: { externalId: externalContactId } } },
    select: { id: true },
  });
  if (existing) await authorization.assertCanActOnConversation(user, existing.id);

  const storedAttachments = [];
  try {
    for (const attachment of attachments) {
      storedAttachments.push(await storeDocument({
        buffer: attachment.buffer, mimeType: attachment.mimeType, fileName: attachment.fileName,
      }));
    }
  } catch (error) {
    await Promise.allSettled(storedAttachments.map((attachment) => removeImage(attachment.storageKey)));
    throw error;
  }
  let providerResult;
  try {
    providerResult = await channelMessageService.send({
      channel: "EMAIL", channelAccountId: account.id, kind: storedAttachments.length ? "media" : "text",
      to: email, subject: cleanSubject, text: cleanBody,
      ...(storedAttachments.length ? { attachments: storedAttachments.map((stored, index) => ({
        buffer: attachments[index].buffer, mimeType: stored.mimeType, filename: stored.fileName,
      })) } : {}),
    });
  } catch (error) {
    await Promise.allSettled(storedAttachments.map((attachment) => removeImage(attachment.storageKey)));
    throw error;
  }
  const occurredAt = new Date();
  let stored;
  try {
    stored = await prisma.$transaction(async (transaction) => {
    const contact = await transaction.contact.upsert({
      where: { companyId_channel_externalId: { companyId: account.companyId, channel: "EMAIL", externalId: externalContactId } },
      update: { email, customName: name },
      create: { companyId: account.companyId, channel: "EMAIL", externalId: externalContactId, email, name, customName: name },
    });
    const conversation = await transaction.conversation.upsert({
      where: { contactId_channel_channelScope: { contactId: contact.id, channel: "EMAIL", channelScope: account.id } },
      update: { channelAccountId: account.id, externalConversationId: providerResult.data?.threadId || undefined },
      create: {
        companyId: account.companyId, contactId: contact.id, channel: "EMAIL", channelScope: account.id, channelAccountId: account.id,
        externalConversationId: providerResult.data?.threadId || null, kind: "EMAIL_THREAD",
        status: "EM_ATENDIMENTO", assignedUserId: user.id,
      },
    });
      const message = await transaction.message.create({ data: {
      conversationId: conversation.id,
      externalId: providerResult.externalId ? `${account.id}:${providerResult.externalId}` : null,
      channel: "EMAIL", channelAccountId: account.id, direction: "ENVIADA", status: "ENVIADA",
      type: "text", text: cleanBody, occurredAt, sentByUserId: user.id,
      rawPayload: { providerMessage: providerResult.data || null, subject: cleanSubject, threadId: providerResult.data?.threadId || null },
      } });
      const attachmentMessages = [];
      for (const attachment of storedAttachments) {
        attachmentMessages.push(await transaction.message.create({ data: {
          conversationId: conversation.id, channel: "EMAIL", channelAccountId: account.id,
          direction: "ENVIADA", status: "ENVIADA", type: "document", text: null, occurredAt,
          sentByUserId: user.id, mediaStorageKey: attachment.storageKey, mediaMimeType: attachment.mimeType,
          mediaFileName: attachment.fileName, mediaSize: attachment.size,
          rawPayload: { providerMessage: providerResult.data || null, subject: cleanSubject, threadId: providerResult.data?.threadId || null, attachment: true },
        } }));
      }
      return { conversation, message, attachmentMessages };
    });
  } catch (error) {
    await Promise.allSettled(storedAttachments.map((attachment) => removeImage(attachment.storageKey)));
    throw error;
  }
  await updateConversationAfterSending({ conversationId: stored.conversation.id, sentByUserId: user.id, occurredAt });
  return { conversationId: stored.conversation.id, created: !existing, message: stored.message, attachments: stored.attachmentMessages };
}
module.exports = { createOutboundConversation, createOutboundEmail, listOutboundChannels, normalizeOutboundPhone };
