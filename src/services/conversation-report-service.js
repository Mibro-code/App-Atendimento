// Relatório semanal de conversas (Configurações → Conversas → nova seção,
// visível só para Master). Sempre calculado NA HORA a partir do estado atual
// do banco — nunca um job/cron nem uma tabela de snapshot: "atualizado por
// semana" aqui significa que a semana de referência sempre é a atual (ou
// qualquer semana anterior pedida via `weekOffset`), então o relatório já
// nasce sempre em dia, sem depender de nenhum processo em segundo plano.
//
// Semana = segunda 00:00 até a segunda seguinte, sempre em Brasília.
// O container da VPS pode rodar em UTC, portanto não dependemos do fuso
// local do processo para montar os limites consultados no banco.
const prisma = require("../database/prisma");

const REPORT_TIME_ZONE = "America/Sao_Paulo";

function zonedParts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function localMidnightToUtc(year, month, day) {
  const desired = Date.UTC(year, month - 1, day);
  let instant = desired;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: REPORT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const represented = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
    instant -= represented - desired;
  }
  return new Date(instant);
}

function weekBounds(weekOffset = 0, now = new Date()) {
  const local = zonedParts(now);
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const diffToMonday = (localDate.getUTCDay() + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - diffToMonday + weekOffset * 7);
  const start = localMidnightToUtc(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, localDate.getUTCDate());
  localDate.setUTCDate(localDate.getUTCDate() + 7);
  const end = localMidnightToUtc(localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, localDate.getUTCDate());
  const lastDay = new Date(end.getTime() - 1);
  const fmt = (date) => date.toLocaleDateString("pt-BR", {
    timeZone: REPORT_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric",
  });
  return { start, end, label: `${fmt(start)} a ${fmt(lastDay)}` };
}

function parseLocalDate(value, fieldName) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) throw Object.assign(new Error(`Informe ${fieldName} no formato AAAA-MM-DD.`), { statusCode: 400 });
  const [, year, month, day] = match.map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw Object.assign(new Error(`Informe uma ${fieldName} válida.`), { statusCode: 400 });
  }
  return { year, month, day, check };
}

function customBounds(startDate, endDate) {
  const startParts = parseLocalDate(startDate, "data inicial");
  const endParts = parseLocalDate(endDate, "data final");
  if (startParts.check > endParts.check) {
    throw Object.assign(new Error("A data inicial não pode ser posterior à data final."), { statusCode: 400 });
  }
  const nextDay = new Date(endParts.check);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const start = localMidnightToUtc(startParts.year, startParts.month, startParts.day);
  const end = localMidnightToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate());
  const fmt = (date) => date.toLocaleDateString("pt-BR", {
    timeZone: REPORT_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric",
  });
  return { start, end, label: `${fmt(start)} a ${fmt(new Date(end.getTime() - 1))}` };
}

function resolvePeriod({ mode = "WEEK", weekOffset = 0, startDate, endDate } = {}) {
  const normalizedMode = String(mode || "WEEK").toUpperCase();
  if (normalizedMode === "ALL") return { mode: "ALL", start: null, end: null, label: "Todo o histórico" };
  if (normalizedMode === "CUSTOM") return { mode: "CUSTOM", ...customBounds(startDate, endDate) };
  return { mode: "WEEK", ...weekBounds(Number.isFinite(Number(weekOffset)) ? Number(weekOffset) : 0) };
}

const MEDIA_LABELS = { image: "[imagem]", video: "[vídeo]", audio: "[áudio]", document: "[documento]", sticker: "[figurinha]", reaction: "[reação]" };
function previewFor(message) {
  if (!message) return null;
  if (message.type === "text" && message.text) return message.text.slice(0, 160);
  return MEDIA_LABELS[message.type] || `[${message.type}]`;
}

function contactLabel(contact) {
  if (!contact) return "Contato removido";
  return contact.customName || contact.name || contact.phone || contact.email || "Sem nome";
}

const CONVERSATION_LIST_LIMIT = 100;

async function buildConversationReport({ mode = "WEEK", weekOffset = 0, startDate, endDate, page = 1 } = {}, client = prisma) {
  const period = resolvePeriod({ mode, weekOffset, startDate, endDate });
  const { start, end, label } = period;
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const range = start && end ? { gte: start, lt: end } : null;
  const conversationWhere = range ? {
    OR: [
      { lastMessageAt: range },
      { createdAt: range },
    ],
  } : {};

  // IDs leves mantêm os indicadores exatos; a tabela detalhada é paginada
  // para que "Todo o histórico" não sobrecarregue o navegador.
  const cohortRefs = await client.conversation.findMany({
    where: conversationWhere,
    select: { id: true, status: true, createdAt: true },
  });
  const cohortIds = cohortRefs.map((item) => item.id);
  const cohort = await client.conversation.findMany({
    where: conversationWhere,
    select: {
      id: true, status: true, finalizedAt: true, lastMessageAt: true, createdAt: true, assignedUserId: true,
      assignedUser: { select: { id: true, name: true } },
      contact: { select: { name: true, customName: true, phone: true, email: true } },
      category: { select: { name: true, color: true } },
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    skip: (safePage - 1) * CONVERSATION_LIST_LIMIT,
    take: CONVERSATION_LIST_LIMIT,
  });
  const pageIds = cohort.map((item) => item.id);
  const relationFilter = range ? { conversation: conversationWhere } : {};
  const activityRange = range ? { occurredAt: range } : {};
  const finalizedRange = range ? { finalizedAt: range } : {};

  const [answeredGroups, answeredByAgentGroups, lastMessages, finalizedTotal, agentActivity, agentFinalized] = await Promise.all([
    cohortIds.length
      ? client.message.groupBy({ by: ["conversationId"], where: { ...relationFilter, direction: "ENVIADA" }, _count: { _all: true } })
      : [],
    cohortIds.length
      ? client.message.groupBy({ by: ["conversationId"], where: { ...relationFilter, direction: "ENVIADA", sentByUserId: { not: null } }, _count: { _all: true } })
      : [],
    pageIds.length
      ? client.message.findMany({
        where: { conversationId: { in: pageIds } }, orderBy: { occurredAt: "desc" }, distinct: ["conversationId"],
        select: { conversationId: true, text: true, type: true, direction: true, occurredAt: true },
      })
      : [],
    client.conversation.count({ where: { status: "FINALIZADO", ...finalizedRange } }),
    client.message.groupBy({
      by: ["sentByUserId"], where: { direction: "ENVIADA", sentByUserId: { not: null }, ...activityRange }, _count: { _all: true },
    }),
    client.conversation.groupBy({
      by: ["assignedUserId"], where: { status: "FINALIZADO", ...finalizedRange, assignedUserId: { not: null } }, _count: { _all: true },
    }),
  ]);

  const answeredSet = new Set(answeredGroups.map((item) => item.conversationId));
  const answeredByAgentSet = new Set(answeredByAgentGroups.map((item) => item.conversationId));
  const lastMessageByConversation = new Map(lastMessages.map((item) => [item.conversationId, item]));

  const rows = cohort.map((conversation) => {
    const answered = answeredSet.has(conversation.id);
    const answeredByAgent = answeredByAgentSet.has(conversation.id);
    const resolved = conversation.status === "FINALIZADO";
    const lastMessage = lastMessageByConversation.get(conversation.id) || null;
    return {
      id: conversation.id,
      contactName: contactLabel(conversation.contact),
      contactPhone: conversation.contact?.phone || null,
      contactEmail: conversation.contact?.email || null,
      status: conversation.status,
      categoryName: conversation.category?.name || null,
      categoryColor: conversation.category?.color || null,
      assignedUserName: conversation.assignedUser?.name || null,
      createdAt: conversation.createdAt,
      finalizedAt: conversation.finalizedAt,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: previewFor(lastMessage),
      lastMessageFromCustomer: lastMessage?.direction === "RECEBIDA",
      resolved,
      answered,
      answeredByAgent,
      resolvedWithoutAgentResponse: resolved && !answeredByAgent,
    };
  });

  const totals = {
    conversationsInWeek: cohortRefs.length,
    conversationsInPeriod: cohortRefs.length,
    newConversations: range
      ? cohortRefs.filter((item) => item.createdAt >= start && item.createdAt < end).length
      : cohortRefs.length,
    resolved: cohortRefs.filter((item) => item.status === "FINALIZADO").length,
    finalizedTotal,
    unanswered: cohortRefs.filter((item) => !answeredSet.has(item.id)).length,
    resolvedWithoutAgentResponse: cohortRefs.filter((item) => item.status === "FINALIZADO" && !answeredByAgentSet.has(item.id)).length,
  };

  const agentUserIds = [...new Set([
    ...agentActivity.map((item) => item.sentByUserId),
    ...agentFinalized.map((item) => item.assignedUserId),
  ])].filter(Boolean);
  const agentUsers = agentUserIds.length
    ? await client.user.findMany({ where: { id: { in: agentUserIds } }, select: { id: true, name: true, email: true, role: true, active: true } })
    : [];
  const agentUserMap = new Map(agentUsers.map((user) => [user.id, user]));
  const messagesByAgent = new Map(agentActivity.map((item) => [item.sentByUserId, item._count._all]));
  const finalizedByAgent = new Map(agentFinalized.map((item) => [item.assignedUserId, item._count._all]));

  const perAgent = agentUserIds.map((id) => ({
    userId: id,
    name: agentUserMap.get(id)?.name || "Usuário removido",
    email: agentUserMap.get(id)?.email || null,
    role: agentUserMap.get(id)?.role || null,
    active: agentUserMap.get(id)?.active ?? null,
    messagesSent: messagesByAgent.get(id) || 0,
    conversationsFinalized: finalizedByAgent.get(id) || 0,
  })).sort((a, b) => b.messagesSent - a.messagesSent);

  return {
    periodMode: period.mode, periodStart: start, periodEnd: end, periodLabel: label,
    weekStart: start, weekEnd: end, weekLabel: label, weekOffset: Number(weekOffset) || 0,
    page: safePage, pageSize: CONVERSATION_LIST_LIMIT,
    totalConversations: cohortRefs.length,
    totalPages: Math.max(1, Math.ceil(cohortRefs.length / CONVERSATION_LIST_LIMIT)),
    truncated: cohortRefs.length > CONVERSATION_LIST_LIMIT,
    totals, perAgent, conversations: rows,
  };
}

module.exports = {
  buildConversationReport, weekBounds, customBounds, resolvePeriod,
  CONVERSATION_LIST_LIMIT, REPORT_TIME_ZONE,
};
