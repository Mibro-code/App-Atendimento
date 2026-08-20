const prisma = require("../database/prisma");

function normalizePhone(value = "") {
  return String(value).replace(/\D/g, "");
}

function validContactName(name, phone) {
  const cleanName = String(name || "").trim();

  if (!cleanName) return null;

  const nameAsPhone = normalizePhone(cleanName);
  const normalizedPhone = normalizePhone(phone);

  if (
    nameAsPhone &&
    normalizedPhone &&
    nameAsPhone === normalizedPhone
  ) {
    return null;
  }

  return cleanName;
}

async function findOrCreateMetaConversation(event, db = prisma) {
  const contactName = validContactName(
    event.contactName,
    event.phone
  );

  const contact = await db.contact.upsert({
    where: {
      channel_externalId: {
        channel: "META",
        externalId: event.contactExternalId
      }
    },

    update: {
      phone: event.phone,
      ...(contactName ? { name: contactName } : {})
    },

    create: {
      channel: "META",
      externalId: event.contactExternalId,
      phone: event.phone,
      name: contactName || event.phone
    }
  });

  const conversation = await db.conversation.upsert({
    where: {
      contactId_channel: {
        contactId: contact.id,
        channel: "META"
      }
    },

    update: {},

    create: {
      contactId: contact.id,
      channel: "META",
      status: "NOVO"
    }
  });

  return { contact, conversation };
}

module.exports = {
  findOrCreateMetaConversation
};
