const prisma = require("../database/prisma");
const { findOrCreateMetaConversation } = require("./conversation-service");
const { removeImage, storeAudio, storeImage } = require("./media-storage-service");
const statuses = { sent: "ENVIADA", delivered: "ENTREGUE", read: "LIDA", failed: "FALHOU" };

async function saveIncoming(event) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.message.findUnique({ where: { externalId: event.externalId } });
      if (existing) return { message: existing, duplicate: true };
      const { conversation } = await findOrCreateMetaConversation(event, tx);
      const mediaStore = event.type === "audio" ? storeAudio : storeImage;
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
      await tx.conversation.update({ where: { id: conversation.id }, data: {
        unreadCount: { increment: 1 }, lastMessageAt: event.occurredAt,
        status: conversation.status === "FINALIZADO" ? "NOVO" : conversation.status,
        finalizedAt: conversation.status === "FINALIZADO" ? null : conversation.finalizedAt,
      } });
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

async function sendText({ conversationId, text, sentByUserId, channel }) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } });
  if (!conversation) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  const result = await channel.sendText(conversation.contact.phone, text);
  const occurredAt = new Date();
  const message = await prisma.message.create({ data: {
    conversationId, externalId: result.externalId, channel: conversation.channel, direction: "ENVIADA",
    status: "ENVIADA", type: "text", text, occurredAt, sentByUserId: sentByUserId || null, rawPayload: result.data,
  } });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: occurredAt } });
  return { message, providerData: result.data };
}

async function sendImage({ conversationId, buffer, mimeType, fileName, caption, sentByUserId, channel }) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } });
  if (!conversation) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  const cleanCaption = caption?.trim() || null;
  if (cleanCaption && cleanCaption.length > 1024) {
    throw Object.assign(new Error("A legenda deve ter no máximo 1.024 caracteres."), { statusCode: 400 });
  }
  const media = await storeImage({ buffer, mimeType, fileName });
  let result;
  try {
    result = await channel.sendImage(conversation.contact.phone, {
      buffer, mimeType, fileName: media.fileName, caption: cleanCaption,
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
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: occurredAt } });
  return { message, providerData: result.data };
}

async function sendTextToPhone({ phone, text, channel }) {
  const { conversation } = await findOrCreateMetaConversation({ contactExternalId: phone, phone, contactName: phone });
  return sendText({ conversationId: conversation.id, text, channel });
}

module.exports = { saveIncoming, sendImage, updateStatus, sendText, sendTextToPhone };
