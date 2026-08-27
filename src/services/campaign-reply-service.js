// Itens 9/13/22: liga as respostas reais do WhatsApp (webhook já existente)
// de volta às campanhas — nunca cria um webhook novo, só reage ao mesmo
// evento que já alimenta a Central. Nunca pode derrubar o processamento
// real do webhook (todo erro aqui é engolido e logado).
const prisma = require("../database/prisma");
const { detectOptOutKeyword, registerOptOut } = require("./campaign-optout-service");

const STATUS_FIELD = {
  delivered: { status: "DELIVERED", field: "deliveredAt" },
  read: { status: "READ", field: "readAt" },
  failed: { status: "FAILED", field: "failedAt" },
};

// Item 22: SENT/DELIVERED/READ/FAILED via webhook de status, relacionados
// pelo externalMessageId (wamid) — nunca por heurística de texto/horário.
async function handleCampaignStatusEvent(event) {
  try {
    const mapping = STATUS_FIELD[event.status];
    if (!mapping) return;
    const contact = await prisma.campaignContact.findFirst({ where: { externalMessageId: event.externalId } });
    if (!contact) return;
    // Nunca regride um status "mais avançado" (ex.: um evento "delivered"
    // atrasado chegando depois de já termos REPLIED) — a fila é sempre
    // SENT -> DELIVERED -> READ -> (REPLIED em paralelo).
    if (mapping.status === "FAILED") {
      await prisma.campaignContact.update({
        where: { id: contact.id }, data: { status: "FAILED", failedAt: new Date(), failureReason: "Falha reportada pela Meta." },
      });
      return;
    }
    if (["REPLIED"].includes(contact.status)) return;
    await prisma.campaignContact.update({
      where: { id: contact.id }, data: { status: mapping.status, [mapping.field]: new Date() },
    });
  } catch (error) {
    console.error("[CAMPAIGN_REPLY] falha ao atualizar status por webhook (ignorada)", error.message);
  }
}

// Item 9/13: roda para toda mensagem RECEBIDA real (nunca no simulador/
// Observação) — detecta opt-out e vincula a resposta à campanha de origem.
async function handleInboundMessage({ phone, text, conversationId, contactId }) {
  try {
    if (phone && text && detectOptOutKeyword(text)) {
      await registerOptOut({ phone, contactId, reason: text.slice(0, 300), source: "REPLY_KEYWORD" });
      await prisma.campaignContact.updateMany({
        where: { phone, status: { notIn: ["OPTED_OUT"] } }, data: { status: "OPTED_OUT" },
      });
    }

    if (!phone) return;
    const lastContact = await prisma.campaignContact.findFirst({
      where: { phone, status: { in: ["SENT", "DELIVERED", "READ"] } },
      orderBy: { sentAt: "desc" },
    });
    if (!lastContact) return;

    await prisma.campaignContact.update({
      where: { id: lastContact.id }, data: { status: "REPLIED", repliedAt: new Date(), prospectStatus: lastContact.prospectStatus === "NEW" || lastContact.prospectStatus === "CONTACTED" ? "REPLIED" : lastContact.prospectStatus },
    });

    if (!conversationId) return;
    const campaign = await prisma.campaign.findUnique({ where: { id: lastContact.campaignId }, select: { id: true, replyCategoryId: true, replyBotId: true } });
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { categoryId: true, originCampaignId: true } });
    if (!conversation || conversation.originCampaignId) return; // item 15: nunca sobrescreve um vínculo já existente

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        originSource: "OUTBOUND_CAMPAIGN", originCampaignId: lastContact.campaignId, originCampaignContactId: lastContact.id,
        // Item 15/16: só aplica a categoria de destino se a conversa ainda
        // não tiver uma (nunca reatribui uma conversa já triada/atendida).
        ...(conversation.categoryId ? {} : { categoryId: campaign?.replyCategoryId || undefined }),
      },
    });
  } catch (error) {
    console.error("[CAMPAIGN_REPLY] falha ao processar resposta de campanha (ignorada)", error.message);
  }
}

module.exports = { handleCampaignStatusEvent, handleInboundMessage };
