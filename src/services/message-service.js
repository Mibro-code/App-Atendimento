const prisma = require("../database/prisma");
const { findOrCreateMetaConversation } = require("./conversation-service");
const { removeImage, storeAudio, storeDocument, storeImage, storeSticker, storeVideo } = require("./media-storage-service");
const { formatTeamMessage } = require("./team-message-formatter");
const statuses = { sent: "ENVIADA", delivered: "ENTREGUE", read: "LIDA", failed: "FALHOU" };
const closingMessage = "Agradecemos pelo seu contato. Se precisar de qualquer ajuda, estamos à disposição. Você pode voltar a falar conosco quando quiser.";

async function saveIncoming(event) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.message.findUnique({ where: { externalId: event.externalId } });
      if (existing) return { message: existing, duplicate: true };
      const { conversation } = await findOrCreateMetaConversation(event, tx);
      const mediaStore = ({ audio: storeAudio, video: storeVideo, sticker: storeSticker, document: storeDocument })[event.type] || storeImage;
      const media = event.mediaBuffer ? await mediaStore({
        buffer: event.mediaBuffer, mimeType: event.mediaMimeType,
        fileName: event.mediaFileName, stableId: event.externalId,
      }) : null;
      const message = await tx.message.create({ data: {
        conversationId: conversation.id, externalId: event.externalId, channel: "META",
        direction: "RECEBIDA", status: "RECEBIDA", type: event.type, text: event.text,
        mediaStorageKey: media?.storageKey, mediaMimeType: media?.mimeType,
        mediaFileName: media?.fileName, mediaSize: media?.size,
        occurredAt: event.occurredAt, rawPayload: event.rawPayload,
      } });
      if (event.type !== "reaction") {
        await tx.conversation.update({ where: { id: conversation.id }, data: {
          unreadCount: { increment: 1 }, lastMessageAt: event.occurredAt,
        } });
        await tx.conversation.updateMany({
          where: { id: conversation.id, status: "FINALIZADO" },
          data: { categoryId: null, assignedUserId: null, status: "NOVO", finalizedAt: null },
        });
        await tx.conversation.updateMany({
          where: { id: conversation.id, status: { in: ["EM_ATENDIMENTO", "AGUARDANDO_RESPOSTA"] } },
          data: { status: "AGUARDANDO_RESPOSTA" },
        });
      }
      return { message, duplicate: false };
    });
  } catch (error) {
    if (error.code === "P2002" && event.externalId) {
      const message = await prisma.message.findUnique({ where: { externalId: event.externalId } });
      if (message) return { message, duplicate: true };
    }
    throw error;
  }
}

async function updateStatus(event) {
  if (!statuses[event.status]) return null;
  return prisma.message.updateMany({ where: { externalId: event.externalId }, data: { status: statuses[event.status] } });
}

async function updateConversationAfterSending({ conversationId, sentByUserId, occurredAt }) {
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.conversation.findUnique({
      where: { id: conversationId },
      select: {
        assignedUserId: true,
        assignedUser: {
          select: {
            name: true,
          },
        },
      },
    });

    await transaction.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: occurredAt,
        status: "EM_ATENDIMENTO",
        finalizedAt: null,
        ...(sentByUserId ? { assignedUserId: sentByUserId } : {}),
      },
    });

    if (!sentByUserId) return false;

    if (current?.assignedUserId === sentByUserId) {
      return false;
    }

    const sender = await transaction.user.findUnique({
      where: { id: sentByUserId },
      select: { name: true },
    });

    await transaction.conversationActivity.create({
      data: {
        conversationId,
        actorUserId: sentByUserId,
        action: current?.assignedUserId
          ? "CONVERSATION_TRANSFERRED"
          : "CONVERSATION_CLAIMED",
        details: {
          from: current?.assignedUser?.name || "Sem responsável",
          to: sender?.name || "Atendente",
          fromUserId: current?.assignedUserId || null,
          toUserId: sentByUserId,
          automatic: true,
        },
      },
    });

    return true;
  });
}

async function sendText({ conversationId, text, sentByUserId, channel }) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true, category: { include: { parent: true } } } });
  if (!conversation) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  const providerText = formatTeamMessage(conversation.category, text);
  if (providerText.length > 4096) {
    throw Object.assign(new Error("A mensagem ficou acima do limite após adicionar o nome da equipe."), { statusCode: 400 });
  }
  const result = await channel.sendText(conversation.contact.phone, providerText);
  const occurredAt = new Date();
  const message = await prisma.message.create({ data: {
    conversationId, externalId: result.externalId, channel: conversation.channel, direction: "ENVIADA",
    status: "ENVIADA", type: "text", text, occurredAt, sentByUserId: sentByUserId || null, rawPayload: result.data,
  } });
  await updateConversationAfterSending({ conversationId, sentByUserId, occurredAt });
  return { message, providerData: result.data };
}

async function sendImage({ conversationId, buffer, mimeType, fileName, caption, sentByUserId, channel }) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true, category: { include: { parent: true } } } });
  if (!conversation) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  const cleanCaption = caption?.trim() || null;
  const providerCaption = formatTeamMessage(conversation.category, cleanCaption || "");
  if (providerCaption.length > 1024) {
    throw Object.assign(new Error("A legenda ficou acima do limite após adicionar o nome da equipe."), { statusCode: 400 });
  }
  const media = await storeImage({ buffer, mimeType, fileName });
  let result;
  try {
    result = await channel.sendImage(conversation.contact.phone, {
      buffer, mimeType, fileName: media.fileName, caption: providerCaption || null,
    });
  } catch (error) {
    await removeImage(media.storageKey);
    throw error;
  }
  const occurredAt = new Date();
  const message = await prisma.message.create({ data: {
    conversationId, externalId: result.externalId, channel: conversation.channel, direction: "ENVIADA",
    status: "ENVIADA", type: "image", text: cleanCaption,
    mediaStorageKey: media.storageKey, mediaMimeType: media.mimeType,
    mediaFileName: media.fileName, mediaSize: media.size,
    occurredAt, sentByUserId: sentByUserId || null,
    rawPayload: { message: result.data, mediaId: result.mediaId },
  } });
  await updateConversationAfterSending({ conversationId, sentByUserId, occurredAt });
  return { message, providerData: result.data };
}

async function sendVideo({ conversationId, buffer, mimeType, fileName, caption, sentByUserId, channel }) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true, category: { include: { parent: true } } } });
  if (!conversation) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  const cleanCaption = caption?.trim() || null;
  const providerCaption = formatTeamMessage(conversation.category, cleanCaption || "");
  if (providerCaption.length > 1024) {
    throw Object.assign(new Error("A legenda ficou acima do limite após adicionar o nome da equipe."), { statusCode: 400 });
  }
  const media = await storeVideo({ buffer, mimeType, fileName });
  let result;
  try {
    result = await channel.sendVideo(conversation.contact.phone, {
      buffer, mimeType: media.mimeType, fileName: media.fileName, caption: providerCaption || null,
    });
  } catch (error) {
    await removeImage(media.storageKey);
    throw error;
  }
  const occurredAt = new Date();
  const message = await prisma.message.create({ data: {
    conversationId, externalId: result.externalId, channel: conversation.channel, direction: "ENVIADA",
    status: "ENVIADA", type: "video", text: cleanCaption,
    mediaStorageKey: media.storageKey, mediaMimeType: media.mimeType,
    mediaFileName: media.fileName, mediaSize: media.size,
    occurredAt, sentByUserId: sentByUserId || null,
    rawPayload: { message: result.data, mediaId: result.mediaId },
  } });
  await updateConversationAfterSending({ conversationId, sentByUserId, occurredAt });
  return { message, providerData: result.data };
}

async function sendDocument({ conversationId, buffer, mimeType, fileName, caption, sentByUserId, channel }) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true, category: { include: { parent: true } } } });
  if (!conversation) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  const cleanCaption = caption?.trim() || null;
  const providerCaption = formatTeamMessage(conversation.category, cleanCaption || "");
  if (providerCaption.length > 1024) {
    throw Object.assign(new Error("A legenda ficou acima do limite após adicionar o nome da equipe."), { statusCode: 400 });
  }
  const media = await storeDocument({ buffer, mimeType, fileName });
  let result;
  try {
    result = await channel.sendDocument(conversation.contact.phone, {
      buffer, mimeType: media.mimeType, fileName: media.fileName, caption: providerCaption || null,
    });
  } catch (error) {
    await removeImage(media.storageKey);
    throw error;
  }
  const occurredAt = new Date();
  const message = await prisma.message.create({ data: {
    conversationId, externalId: result.externalId, channel: conversation.channel, direction: "ENVIADA",
    status: "ENVIADA", type: "document", text: cleanCaption,
    mediaStorageKey: media.storageKey, mediaMimeType: media.mimeType,
    mediaFileName: media.fileName, mediaSize: media.size,
    occurredAt, sentByUserId: sentByUserId || null,
    rawPayload: { message: result.data, mediaId: result.mediaId },
  } });
  await updateConversationAfterSending({ conversationId, sentByUserId, occurredAt });
  return { message, providerData: result.data };
}

async function finalizeConversation({ conversationId, sentByUserId, channel }) {
  const current = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!current) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  if (current.status === "FINALIZADO") {
    return { conversation: current, message: null, alreadyFinalized: true };
  }
  const result = await sendText({ conversationId, text: closingMessage, sentByUserId, channel });
  const conversation = await prisma.conversation.update({ where: { id: conversationId }, data: {
    status: "FINALIZADO", finalizedAt: new Date(),
  } });
  return { conversation, message: result.message, providerData: result.providerData, alreadyFinalized: false, previousStatus: current.status };
}

async function sendTextToPhone({ phone, text, channel }) {
  const { conversation } = await findOrCreateMetaConversation({ contactExternalId: phone, phone, contactName: phone });
  return sendText({ conversationId: conversation.id, text, channel });
}

module.exports = { closingMessage, finalizeConversation, saveIncoming, sendDocument, sendImage, sendVideo, updateStatus, sendText, sendTextToPhone };
