// Ledger de idempotência (item 16/17). Uma notificação repetida da
// plataforma externa nunca pode gerar conversa/mensagem/resposta duplicada
// — a unicidade real é a constraint @@unique([channel, externalEventId]).
const prisma = require("../../database/prisma");

// Retorna { event, isDuplicate }. Se já existir um evento com o mesmo
// (channel, externalEventId), marca como DUPLICATE e não recria nada.
async function recordEvent({ channel, channelAccountId = null, externalEventId, eventType, payload }, client = prisma) {
  const existing = await client.externalChannelEvent.findUnique({
    where: { channel_externalEventId: { channel, externalEventId } },
  });
  if (existing) return { event: existing, isDuplicate: true };

  try {
    const event = await client.externalChannelEvent.create({
      data: { channel, channelAccountId, externalEventId, eventType, payload, status: "RECEIVED" },
    });
    return { event, isDuplicate: false };
  } catch (error) {
    if (error.code === "P2002") {
      const raced = await client.externalChannelEvent.findUnique({
        where: { channel_externalEventId: { channel, externalEventId } },
      });
      if (raced) return { event: raced, isDuplicate: true };
    }
    throw error;
  }
}

async function markProcessed(eventId, client = prisma) {
  return client.externalChannelEvent.update({
    where: { id: eventId }, data: { status: "PROCESSED", processedAt: new Date() },
  });
}

async function markError(eventId, errorCode, client = prisma) {
  return client.externalChannelEvent.update({
    where: { id: eventId }, data: { status: "ERROR", errorCode: String(errorCode || "PROVIDER_ERROR").slice(0, 80) },
  });
}

module.exports = { markError, markProcessed, recordEvent };
