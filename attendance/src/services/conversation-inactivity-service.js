const prisma = require("../database/prisma");
const { settingsPlan } = require("./conversation-settings-service");

const defaultInactivityMinutes = 1440;

async function finalizeInactiveConversations({
  now = new Date(), inactivityMinutes = defaultInactivityMinutes, client = prisma, scope = {},
} = {}) {
  const cutoff = new Date(now.getTime() - inactivityMinutes * 60 * 1000);
  const candidates = await client.conversation.findMany({
    where: { ...scope, status: { not: "FINALIZADO" }, lastMessageAt: { lte: cutoff } },
    select: {
      id: true,
      messages: {
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: 5,
        select: { direction: true, rawPayload: true },
      },
    },
  });
  let finalized = 0;
  for (const conversation of candidates) {
    // Lembrete fora do expediente é transparente aqui (ver acima).
    const lastMessage = conversation.messages.find((message) => message.rawPayload?.system !== "after_hours_reminder") || conversation.messages[0];
    // A inatividade encerra a conversa independentemente de quem enviou a
    // última mensagem. Assim, um cliente que não recebeu nova interação no
    // prazo configurado também sai da fila antiga e volta pela triagem quando
    // escrever novamente.
    if (!lastMessage) continue;
    if (lastMessage.rawPayload?.system === "triage_confirmation" || lastMessage.rawPayload?.flowHandoff) continue;
    await client.$transaction(async (transaction) => {
      const updated = await transaction.conversation.updateMany({
        where: { id: conversation.id, status: { not: "FINALIZADO" }, lastMessageAt: { lte: cutoff } },
        // Mantém categoria e último responsável: a conversa finalizada segue
        // na categoria, visível só a quem atendeu por último (e ao Master).
        // Se o cliente voltar a escrever, a reabertura (message-service)
        // limpa categoria/responsável para a triagem escolher de novo.
        data: {
          status: "FINALIZADO", unreadCount: 0, finalizedAt: now,
        },
      });
      if (!updated.count) return;
      await transaction.conversationActivity.create({ data: {
        conversationId: conversation.id, action: "AUTO_FINALIZED_INACTIVITY",
        details: { inactivityMinutes },
      } });
      finalized += 1;
      await transaction.afterHoursReminder.updateMany({
        where: { conversationId: conversation.id, status: "PENDING" }, data: { status: "CANCELLED", reason: "CONVERSATION_FINALIZED" },
      });
    });
  }
  return finalized;
}

function startInactivityMonitor({
  intervalMs = 60 * 1000, inactivityMinutes, onChange,
} = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      // Configurações → Conversas (item 11): o default de produção vem do
      // singleton central, não mais de uma constante fixa. `inactivityMinutes`
      // continua aceito como override explícito (usado pelos testes).
      // Multiempresa: cada empresa com configuração própria usa a dela.
      const plan = inactivityMinutes !== undefined
        ? [{ settings: { autoFinalizationEnabled: true, autoFinalizationMinutes: inactivityMinutes }, scope: {} }]
        : await settingsPlan();
      let finalized = 0;
      for (const { settings, scope } of plan) {
        if (!settings.autoFinalizationEnabled) continue;
        finalized += await finalizeInactiveConversations({ inactivityMinutes: settings.autoFinalizationMinutes, scope });
      }
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
