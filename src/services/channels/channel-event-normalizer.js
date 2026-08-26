// Formato comum de mensagem recebida (item 17) — todo adapter converte o
// payload cru da plataforma para isto antes de tocar em Conversation/
// Message. Nenhum campo é obrigatório além de channel/direction/type: cada
// canal preenche só o que fizer sentido.
const { MESSAGE_TYPES } = require("./channel-constants");

function normalizeInboundMessage(input) {
  if (!input || typeof input !== "object") throw new Error("Evento normalizado inválido.");
  const type = MESSAGE_TYPES.includes(input.type) ? input.type : "unknown";
  return {
    channel: input.channel,
    channelAccountId: input.channelAccountId || null,
    externalConversationId: input.externalConversationId || null,
    externalMessageId: input.externalMessageId || null,
    senderExternalId: input.senderExternalId || null,
    senderName: input.senderName || null,
    direction: input.direction === "ENVIADA" ? "ENVIADA" : "RECEBIDA",
    type,
    text: typeof input.text === "string" ? input.text : null,
    media: input.media || null,
    occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    metadata: input.metadata || null,
  };
}

module.exports = { normalizeInboundMessage };
