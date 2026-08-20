const prisma = require("../database/prisma");

const defaultInactivityMinutes = 1440;

async function finalizeInactiveConversations({
  now = new Date(), inactivityMinutes = defaultInactivityMinutes, client = prisma,
} = {}) {
  const cutoff = new Date(now.getTime() - inactivityMinutes * 60 * 1000);
  const candidates = await client.conversation.findMany({
    where: { status: { not: "FINALIZADO" }, lastMessageAt: { lte: cutoff } },
    select: {
      id: true,
      messages: {
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: 1,
        select: { direction: true, rawPayload: true },
      },
    },
  });
  let finalized = 0;
  for (const conversation of candidates) {
    const lastMessage = conversation.messages[0];
    if (lastMessage?.direction !== "ENVIADA") continue;
    if (lastMessage.rawPayload?.system === "triage_confirmation") continue;
    await client.$transaction(async (transaction) => {
      const updated = await transaction.conversation.updateMany({
        where: { id: conversation.id, status: { not: "FINALIZADO" }, lastMessageAt: { lte: cutoff } },
        data: {
          status: "FINALIZADO", categoryId: null, assignedUserId: null,
          unreadCount: 0, finalizedAt: now,
        },
      });
      if (!updated.count) return;
      await transaction.conversationActivity.create({ data: {
        conversationId: conversation.id, action: "AUTO_FINALIZED_INACTIVITY",
        details: { inactivityMinutes },
      } });
      finalized += 1;
    });
  }
  return finalized;
}

function startInactivityMonitor({
  intervalMs = 60 * 1000, inactivityMinutes = defaultInactivityMinutes, onChange,
} = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const finalized = await finalizeInactiveConversations({ inactivityMinutes });
      if (finalized) onChange?.(finalized);
    } catch (error) {
      console.error("Erro ao finalizar conversas inativas:", error);
    } finally {
      running = false;
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { defaultInactivityMinutes, finalizeInactiveConversations, startInactivityMonitor };
