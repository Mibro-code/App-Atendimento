// Configurações → Conversas — SLA de primeira resposta (item 1), SLA de
// resposta durante atendimento (item 2), alerta de conversa sem resposta
// (item 3) e alerta de conversa parada (item 4). Mesmo esqueleto de
// conversation-inactivity-service.js: uma função de varredura pura por
// preocupação + um monitor único com setInterval/unref/guarda de
// reentrância. Nenhuma dessas checagens finaliza conversa nem envia
// mensagem automática ao cliente — só marca indicador/gera atividade.
const prisma = require("../database/prisma");
const { getConversationSettings } = require("./conversation-settings-service");
const { isBusinessHours } = require("./business-hours-service");

// Item 9: quando a SLA está restrita a horário comercial, simplesmente não
// avalia enquanto estivermos fora dele — não tenta "descontar" o tempo fora
// do expediente do cronômetro, só evita marcar atraso fora de horário.
function shouldEvaluateSla(now, settings) {
  return !settings.slaBusinessHoursOnly || isBusinessHours(now);
}

// Item 1: conversa em NOVO (cliente falou, empresa ainda não respondeu desde
// a criação/reabertura) além do prazo -> marca o indicador. Nunca finaliza,
// nunca muda status.
async function checkFirstResponseSla({ now, settings, client = prisma }) {
  if (!settings.firstResponseSlaEnabled || !shouldEvaluateSla(now, settings)) return 0;
  const cutoff = new Date(now.getTime() - settings.firstResponseSlaMinutes * 60 * 1000);
  const result = await client.conversation.updateMany({
    where: { status: "NOVO", firstResponseSlaBreached: false, lastMessageAt: { lte: cutoff } },
    data: { firstResponseSlaBreached: true },
  });
  return result.count;
}

// Idempotência (item 14): só grava uma atividade de alerta por "episódio" —
// isto é, se ainda não existe um registro daquele action mais recente que o
// lastMessageAt atual da conversa.
async function alreadyAlerted(conversationId, action, since, client) {
  const existing = await client.conversationActivity.findFirst({
    where: { conversationId, action, createdAt: { gte: since } },
    select: { id: true },
  });
  return Boolean(existing);
}

// Item 2: última mensagem válida é do cliente durante atendimento
// (AGUARDANDO_RESPOSTA já é esse sinal na máquina de estados existente) além
// do prazo -> destaca + ConversationActivity. Reseta quando a empresa
// responde (status sai de AGUARDANDO_RESPOSTA via updateConversationAfterSending).
async function checkResponseSla({ now, settings, client = prisma }) {
  if (!settings.responseSlaEnabled || !shouldEvaluateSla(now, settings)) return 0;
  const cutoff = new Date(now.getTime() - settings.responseSlaMinutes * 60 * 1000);
  const candidates = await client.conversation.findMany({
    where: { status: "AGUARDANDO_RESPOSTA", lastMessageAt: { lte: cutoff } },
    select: { id: true, lastMessageAt: true },
  });
  let flagged = 0;
  for (const conversation of candidates) {
    if (await alreadyAlerted(conversation.id, "SLA_RESPONSE_BREACHED", conversation.lastMessageAt, client)) continue;
    await client.conversationActivity.create({ data: {
      conversationId: conversation.id, action: "SLA_RESPONSE_BREACHED",
      details: { responseSlaMinutes: settings.responseSlaMinutes },
    } });
    flagged += 1;
  }
  return flagged;
}

// Item 3: alerta interno (para equipe/responsável) de mensagem do cliente
// sem resposta — não envia nada ao cliente. Mesma condição-base do item 2,
// prazo e ação de auditoria próprios.
async function checkUnansweredConversationAlert({ now, settings, client = prisma }) {
  if (!settings.unansweredConversationAlertEnabled) return 0;
  const cutoff = new Date(now.getTime() - settings.unansweredConversationAlertMinutes * 60 * 1000);
  const candidates = await client.conversation.findMany({
    where: { status: "AGUARDANDO_RESPOSTA", lastMessageAt: { lte: cutoff } },
    select: { id: true, lastMessageAt: true },
  });
  let flagged = 0;
  for (const conversation of candidates) {
    if (await alreadyAlerted(conversation.id, "UNANSWERED_CONVERSATION_ALERT", conversation.lastMessageAt, client)) continue;
    await client.conversationActivity.create({ data: {
      conversationId: conversation.id, action: "UNANSWERED_CONVERSATION_ALERT",
      details: { unansweredConversationAlertMinutes: settings.unansweredConversationAlertMinutes },
    } });
    flagged += 1;
  }
  return flagged;
}

// Item 4: conversa em atendimento (qualquer lado aguardando) sem nenhuma
// movimentação relevante por muito tempo — alerta interno "Conversa sem
// atividade há Xh", nunca finaliza por causa disto.
async function checkStalledConversationAlert({ now, settings, client = prisma }) {
  if (!settings.stalledConversationAlertEnabled) return 0;
  const cutoff = new Date(now.getTime() - settings.stalledConversationAlertMinutes * 60 * 1000);
  const candidates = await client.conversation.findMany({
    where: { status: { in: ["EM_ATENDIMENTO", "AGUARDANDO_RESPOSTA"] }, lastMessageAt: { lte: cutoff } },
    select: { id: true, lastMessageAt: true },
  });
  let flagged = 0;
  for (const conversation of candidates) {
    if (await alreadyAlerted(conversation.id, "STALLED_CONVERSATION_ALERT", conversation.lastMessageAt, client)) continue;
    await client.conversationActivity.create({ data: {
      conversationId: conversation.id, action: "STALLED_CONVERSATION_ALERT",
      details: { stalledConversationAlertMinutes: settings.stalledConversationAlertMinutes },
    } });
    flagged += 1;
  }
  return flagged;
}

async function runSlaChecks({ now = new Date(), client = prisma, settings } = {}) {
  const resolvedSettings = settings || await getConversationSettings(client);
  const results = {
    firstResponseBreached: await checkFirstResponseSla({ now, settings: resolvedSettings, client }),
    responseBreached: await checkResponseSla({ now, settings: resolvedSettings, client }),
    unansweredAlerted: await checkUnansweredConversationAlert({ now, settings: resolvedSettings, client }),
    stalledAlerted: await checkStalledConversationAlert({ now, settings: resolvedSettings, client }),
  };
  return results;
}

function startSlaMonitor({ intervalMs = 60 * 1000, onChange } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const results = await runSlaChecks();
      const total = Object.values(results).reduce((sum, value) => sum + value, 0);
      if (total) onChange?.(results);
    } catch (error) {
      console.error("Erro ao avaliar SLAs/alertas de conversas:", error);
    } finally {
      running = false;
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = {
  checkFirstResponseSla, checkResponseSla, checkStalledConversationAlert,
  checkUnansweredConversationAlert, runSlaChecks, startSlaMonitor,
};
