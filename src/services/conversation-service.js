const prisma = require("../database/prisma");

async function findOrCreateMetaConversation(event, db = prisma) {
  const contact = await db.contact.upsert({
    where: { channel_externalId: { channel: "META", externalId: event.contactExternalId } },
    update: { phone: event.phone, name: event.contactName },
    create: { channel: "META", externalId: event.contactExternalId, phone: event.phone, name: event.contactName },
  });
  const conversation = await db.conversation.upsert({
    where: { contactId_channel: { contactId: contact.id, channel: "META" } }, update: {},
    create: { contactId: contact.id, channel: "META", status: "NOVO" },
  });
  return { contact, conversation };
}

module.exports = { findOrCreateMetaConversation };
