// Produtividade e Qualidade — métricas por CICLO DE ATENDIMENTO, nunca por
// linha de Conversation (a mesma conversa é reaproveitada a cada novo
// contato do cliente; ver docs/PRODUTIVIDADE_METRICAS.md para as definições
// completas de cada indicador).
//
// Não existe tabela de sessão: os ciclos são reconstruídos de dados reais já
// gravados — Message (quem falou, quando) + ConversationActivity
// (finalização, reabertura, assumir, transferir). Nada é inventado: sem dado
// suficiente, o indicador sai null e a tela mostra "Sem dados".
//
// Vocabulário (mesmo do Relatório de Conversas):
//   CLIENTE = Message RECEBIDA (reações ignoradas)
//   HUMANO  = Message ENVIADA com sentByUserId (exceto a mensagem automática
//             de encerramento, que não é atendimento)
//   BOT     = Message ENVIADA sem sentByUserId — nunca conta como resposta
const prisma = require("../database/prisma");
const { resolvePeriod, buildConversationWhere } = require("./conversation-report-filters-service");
const { getConversationSettings } = require("./conversation-settings-service");
const { TIME_ZONE, addZonedDays, zonedMidnight, zonedParts } = require("./operation-time");
const businessTime = require("./report-business-time-service");
const privateSegments = require("./private-segment-service");

const DAY_MS = 24 * 60 * 60 * 1000;
// Mensagens anteriores ao período lidas para achar o início do ciclo e a
// mensagem do cliente que uma resposta do período respondeu.
const LOOKBACK_DAYS = 14;
// Finalizado e o cliente voltou em até 24h = "reaberto" (retrabalho). Depois
// disso é tratado como novo contato, não como falha do atendimento anterior.
const REOPEN_WINDOW_MS = DAY_MS;
// Uma transferência automática gravada pela mensagem de encerramento (quem
// finalizou "assumia" a conversa ao enviar a despedida) não é transferência
// real — ignorada quando a finalização do mesmo usuário vem em seguida.
const CLOSING_ARTIFACT_WINDOW_MS = 2 * 60 * 1000;
const MAX_CONVERSATIONS = 8000;
const MAX_MESSAGES = 250000;
const CHUNK = 1000;
const ACTIVE_STATUSES = ["NOVO", "EM_ATENDIMENTO", "AGUARDANDO_EQUIPE", "AGUARDANDO_CLIENTE", "HANDOFF_BOT"];
const WAITING_TEAM = ["NOVO", "AGUARDANDO_EQUIPE", "HANDOFF_BOT"];

const FINALIZATION_FILTERS = [
  { action: "STATUS_CHANGED", details: { path: ["to"], equals: "FINALIZADO" } },
  { action: "AUTO_FINALIZED_INACTIVITY" },
  { action: "BOT_FLOW_COMPLETED", details: { path: ["finalizeConversation"], equals: true } },
];
const OTHER_ACTIONS = ["REOPENED_BY_CUSTOMER_MESSAGE", "CONVERSATION_CLAIMED", "CONVERSATION_TRANSFERRED"];
const ACTIVITY_FILTER = { OR: [...FINALIZATION_FILTERS, { action: { in: OTHER_ACTIONS } }] };

function closingMessageText() {
  return require("./message-service").closingMessage;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function percent(part, total) {
  return total ? (part / total) * 100 : null;
}
function percentChange(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
function chunks(list) {
  const out = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}
function finalizationKind(activity) {
  if (activity.action === "STATUS_CHANGED") return "MANUAL";
  if (activity.action === "AUTO_FINALIZED_INACTIVITY") return "AUTO";
  if (activity.action === "BOT_FLOW_COMPLETED") return "BOT";
  return null;
}

// -----------------------------------------------------------------------
// Carga: só conversas com mensagem ou evento no período, dentro do escopo.
// -----------------------------------------------------------------------
async function loadDataset({ start, end, where, readablePrivateIds = null }, client = prisma) {
  const readable = privateSegments.readableWhere(readablePrivateIds);
  const from = new Date(start.getTime() - LOOKBACK_DAYS * DAY_MS);
  const [messageGroups, activityConversations] = await Promise.all([
    client.message.groupBy({ by: ["conversationId"], where: { AND: [readable, { occurredAt: { gte: start, lt: end }, conversation: { is: where } }] }, _count: { _all: true } }),
    client.conversationActivity.findMany({
      where: { AND: [readable, { createdAt: { gte: start, lt: end } }, { conversation: { is: where } }, ACTIVITY_FILTER] },
      distinct: ["conversationId"], select: { conversationId: true },
    }),
  ]);
  const ids = [...new Set([...messageGroups.map((g) => g.conversationId), ...activityConversations.map((a) => a.conversationId)])];
  if (ids.length > MAX_CONVERSATIONS) return { truncated: true, from };

  const conversations = []; const messages = []; const activities = []; const closingIds = new Set();
  const closingText = closingMessageText();
  for (const part of chunks(ids)) {
    const [convs, msgs, acts, closings] = await Promise.all([
      client.conversation.findMany({
        where: { id: { in: part } },
        select: {
          id: true, companyId: true, channel: true, channelAccountId: true, categoryId: true, status: true, assignedUserId: true, createdAt: true,
          category: { select: { id: true, name: true, color: true, parent: { select: { id: true, name: true, color: true } } } },
        },
      }),
      client.message.findMany({
        where: { AND: [readable, { conversationId: { in: part }, occurredAt: { gte: from, lt: end }, type: { not: "reaction" } }] },
        select: { id: true, conversationId: true, direction: true, sentByUserId: true, occurredAt: true },
      }),
      client.conversationActivity.findMany({
        where: { AND: [readable, { conversationId: { in: part } }, { createdAt: { gte: from, lt: end } }, ACTIVITY_FILTER] },
        select: { conversationId: true, action: true, actorUserId: true, details: true, createdAt: true },
      }),
      client.message.findMany({
        where: { conversationId: { in: part }, direction: "ENVIADA", text: closingText, occurredAt: { gte: from, lt: end } },
        select: { id: true },
      }),
    ]);
    conversations.push(...convs); messages.push(...msgs); activities.push(...acts);
    for (const { id } of closings) closingIds.add(id);
    if (messages.length > MAX_MESSAGES) return { truncated: true, from };
  }
  return { truncated: false, from, conversations, messages, activities, closingIds };
}

// -----------------------------------------------------------------------
// Reconstrução dos ciclos de UMA conversa (função pura — testável).
// -----------------------------------------------------------------------
function walkConversation(conversation, messages, activities, { from, closingIds = new Set(), clock }) {
  const events = [
    ...messages.map((message) => ({ at: message.occurredAt, order: 0, message })),
    ...activities.map((activity) => ({ at: activity.createdAt, order: 1, activity })),
  ].sort((a, b) => a.at - b.at || a.order - b.order);
  clock ||= businessTime.createBusinessClock(events[0]?.at, events.at(-1)?.at);

  // Início do 1º ciclo só é confiável se a conversa nasceu dentro da janela lida.
  let firstCycleKnown = conversation.createdAt >= from;
  const cycles = []; const responses = []; const claims = []; const transfers = []; const humanMessages = [];
  let open = null; let lastClosed = null;

  const openCycle = (at, startedBy, agentId = null) => {
    open = {
      conversationId: conversation.id, companyId: conversation.companyId, category: conversation.category || null,
      startAt: at, startKnown: firstCycleKnown, startedBy, startedByAgentId: agentId,
      pendingAt: null, hadHumanResponse: false, participants: new Set(), lastHumanId: null,
      finalizedAt: null, finalizerId: null, finalKind: null, attributedAgentId: null, reopened: false,
    };
    firstCycleKnown = true;
    cycles.push(open);
  };

  for (const event of events) {
    const { message, activity } = event;
    if (message) {
      if (message.direction === "RECEBIDA") {
        if (!open) openCycle(message.occurredAt, "CUSTOMER");
        if (open.pendingAt === null) open.pendingAt = message.occurredAt;
        continue;
      }
      if (closingIds.has(message.id)) continue;
      if (!message.sentByUserId) { if (!open) openCycle(message.occurredAt, "BOT"); continue; }
      if (!open) openCycle(message.occurredAt, "AGENT", message.sentByUserId);
      humanMessages.push({ at: message.occurredAt, agentId: message.sentByUserId, cycle: open });
      if (open.pendingAt !== null) {
        const first = !open.hadHumanResponse;
        responses.push({
          at: message.occurredAt, agentId: message.sentByUserId, first, cycle: open,
          seconds: clock(open.pendingAt, message.occurredAt),
          // 1ª resposta de ciclo iniciado antes da janela lida: não sabemos se
          // é mesmo a primeira — fica fora da média de 1ª resposta.
          measurable: !first || open.startKnown,
        });
        open.pendingAt = null;
        open.hadHumanResponse = true;
      }
      open.participants.add(message.sentByUserId);
      open.lastHumanId = message.sentByUserId;
      continue;
    }

    const kind = finalizationKind(activity);
    if (kind) {
      // O Bot só finaliza conversa sem humano (updateMany exige assignedUserId
      // nulo); o evento é gravado mesmo quando não finalizou de fato.
      if (!open || (kind === "BOT" && open.participants.size)) continue;
      const finalizerId = kind === "MANUAL" ? activity.actorUserId || null : null;
      open.finalizedAt = activity.createdAt;
      open.finalizerId = finalizerId;
      open.finalKind = kind;
      // Regra de atribuição: quem finalizou, se atendeu neste ciclo; senão o
      // último humano que respondeu; senão ninguém (resolvido sem humano).
      open.attributedAgentId = finalizerId && open.participants.has(finalizerId) ? finalizerId : open.lastHumanId;
      lastClosed = open;
      open = null;
      continue;
    }
    const details = activity.details && typeof activity.details === "object" ? activity.details : {};
    if (activity.action === "REOPENED_BY_CUSTOMER_MESSAGE") {
      if (lastClosed && activity.createdAt - lastClosed.finalizedAt <= REOPEN_WINDOW_MS) lastClosed.reopened = true;
    } else if (activity.action === "CONVERSATION_CLAIMED") {
      claims.push({ at: activity.createdAt, agentId: details.toUserId || activity.actorUserId || null, automatic: details.automatic === true });
    } else if (activity.action === "CONVERSATION_TRANSFERRED") {
      transfers.push({
        at: activity.createdAt, fromUserId: details.fromUserId || null, toUserId: details.toUserId || null,
        automatic: details.automatic === true,
      });
    }
  }

  const finalizations = activities.filter((activity) => finalizationKind(activity) === "MANUAL");
  const realTransfers = transfers.filter((transfer) => !(transfer.automatic && finalizations.some((f) => (
    f.actorUserId === transfer.toUserId && f.createdAt - transfer.at >= 0 && f.createdAt - transfer.at <= CLOSING_ARTIFACT_WINDOW_MS
  ))));
  return { cycles, responses, claims, transfers: realTransfers, humanMessages };
}

// -----------------------------------------------------------------------
// SLA de cada resposta: mesmos prazos de Configurações → Conversas da
// empresa (1ª resposta / resposta durante atendimento). Sem SLA ligado =
// resposta não medida (nunca conta como cumprida).
// -----------------------------------------------------------------------
function slaStateFor(response, settings, channel) {
  if (!settings || channel === "EMAIL") return null;
  const enabled = response.first ? settings.firstResponseSlaEnabled : settings.responseSlaEnabled;
  const minutes = response.first ? settings.firstResponseSlaMinutes : settings.responseSlaMinutes;
  if (!enabled || !minutes) return null;
  const limit = minutes * 60;
  if (response.seconds > limit) return "BREACHED";
  const near = Math.min(Math.max(settings.slaNearBreachPercent || 80, 1), 99) / 100;
  return response.seconds >= limit * near ? "NEAR" : "WITHIN";
}

async function settingsByCompany(companyIds) {
  const map = new Map();
  for (const companyId of companyIds) map.set(companyId, await getConversationSettings(prisma, companyId));
  return map;
}

function emptyStats() {
  return {
    cyclesStarted: 0, startedByAgent: 0, claimed: 0, finalized: 0, finalizedByHuman: 0, finalizedWithoutHuman: 0, finalizedClicked: 0,
    transfersOut: 0, transfersIn: 0, reopened: 0, messagesSent: 0,
    firstResponse: [], response: [], handling: [], sla: { WITHIN: 0, NEAR: 0, BREACHED: 0 },
  };
}

function finishStats(stats) {
  const measured = stats.sla.WITHIN + stats.sla.NEAR + stats.sla.BREACHED;
  return {
    cyclesStarted: stats.cyclesStarted, startedByAgent: stats.startedByAgent, claimed: stats.claimed,
    finalized: stats.finalized, finalizedByHuman: stats.finalizedByHuman, finalizedWithoutHuman: stats.finalizedWithoutHuman,
    finalizedClicked: stats.finalizedClicked, transfersOut: stats.transfersOut, transfersIn: stats.transfersIn,
    reopened: stats.reopened, reopenRate: percent(stats.reopened, stats.finalizedByHuman), messagesSent: stats.messagesSent,
    firstResponseAvgSeconds: average(stats.firstResponse), firstResponseSamples: stats.firstResponse.length,
    responseAvgSeconds: average(stats.response), responseSamples: stats.response.length,
    handlingAvgSeconds: average(stats.handling), handlingSamples: stats.handling.length,
    slaWithin: stats.sla.WITHIN, slaNear: stats.sla.NEAR, slaBreached: stats.sla.BREACHED, slaMeasured: measured,
    slaMetPercent: percent(stats.sla.WITHIN + stats.sla.NEAR, measured),
  };
}

// -----------------------------------------------------------------------
// Agregação de uma janela.
// -----------------------------------------------------------------------
async function aggregateWindow({ start, end, where, agentId, companyIds, readablePrivateIds = null, allowedAgentIds = null, granularity = null }, client = prisma) {
  const dataset = await loadDataset({ start, end, where, readablePrivateIds }, client);
  if (dataset.truncated) return { truncated: true };
  const settings = await settingsByCompany(companyIds);
  const calendars = await businessTime.loadCalendars(companyIds, client);
  const clocks = new Map();
  const inWindow = (at) => at >= start && at < end;
  const matches = (id) => (!agentId || id === agentId) && (!allowedAgentIds || allowedAgentIds.includes(id));

  const total = emptyStats();
  const byAgent = new Map();
  const byCompany = new Map();
  const byCategory = new Map();
  const buckets = granularity ? new Map() : null;
  const agent = (id) => { if (!byAgent.has(id)) byAgent.set(id, emptyStats()); return byAgent.get(id); };
  const company = (id) => { if (!byCompany.has(id)) byCompany.set(id, emptyStats()); return byCompany.get(id); };
  const bucket = (at) => {
    const key = bucketKey(at, granularity);
    if (!buckets.has(key)) buckets.set(key, { finalized: 0, firstResponse: [], breached: 0, measured: 0 });
    return buckets.get(key);
  };

  const messagesByConversation = new Map();
  for (const message of dataset.messages) {
    if (!messagesByConversation.has(message.conversationId)) messagesByConversation.set(message.conversationId, []);
    messagesByConversation.get(message.conversationId).push(message);
  }
  const activitiesByConversation = new Map();
  for (const activity of dataset.activities) {
    if (!activitiesByConversation.has(activity.conversationId)) activitiesByConversation.set(activity.conversationId, []);
    activitiesByConversation.get(activity.conversationId).push(activity);
  }

  for (const conversation of dataset.conversations) {
    const calendar = businessTime.calendarFor(conversation, calendars);
    const key = calendar.id || "default";
    if (!clocks.has(key)) clocks.set(key, businessTime.createBusinessClock(dataset.from, end, calendar));
    const clock = clocks.get(key);
    const walk = walkConversation(conversation, messagesByConversation.get(conversation.id) || [], activitiesByConversation.get(conversation.id) || [], { from: dataset.from, closingIds: dataset.closingIds, clock });
    const companyStats = company(conversation.companyId);

    for (const cycle of walk.cycles) {
      if (cycle.startKnown && inWindow(cycle.startAt)) {
        const involved = agentId ? cycle.participants.has(agentId) || cycle.startedByAgentId === agentId : !allowedAgentIds || [...cycle.participants].some(matches) || matches(cycle.startedByAgentId);
        if (involved) { total.cyclesStarted += 1; companyStats.cyclesStarted += 1; }
        if (cycle.startedByAgentId && matches(cycle.startedByAgentId)) agent(cycle.startedByAgentId).startedByAgent += 1;
        if (cycle.startedByAgentId && matches(cycle.startedByAgentId)) total.startedByAgent += 1;
      }
      if (!cycle.finalizedAt || !inWindow(cycle.finalizedAt)) continue;
      if (cycle.finalizerId && matches(cycle.finalizerId)) { agent(cycle.finalizerId).finalizedClicked += 1; total.finalizedClicked += 1; }
      const attributed = cycle.attributedAgentId;
      if (agentId && attributed !== agentId) continue;
      if (attributed && !matches(attributed)) continue;
      const targets = [total, companyStats, ...(attributed ? [agent(attributed)] : [])];
      for (const stats of targets) {
        stats.finalized += 1;
        if (attributed) stats.finalizedByHuman += 1; else stats.finalizedWithoutHuman += 1;
        if (attributed && cycle.reopened) stats.reopened += 1;
        if (attributed && cycle.startKnown) stats.handling.push(clock(cycle.startAt, cycle.finalizedAt));
      }
      const root = cycle.category?.parent || cycle.category || null;
      const categoryKey = root?.id || `UNCATEGORIZED:${cycle.companyId}`;
      const categoryEntry = byCategory.get(categoryKey) || { key: categoryKey, companyId: cycle.companyId, label: root?.name || "Sem categoria", color: root?.color || null, finalized: 0 };
      categoryEntry.finalized += 1;
      byCategory.set(categoryKey, categoryEntry);
      if (buckets) bucket(cycle.finalizedAt).finalized += 1;
    }

    for (const response of walk.responses) {
      if (!inWindow(response.at) || !matches(response.agentId)) continue;
      const state = slaStateFor(response, settings.get(conversation.companyId), conversation.channel);
      for (const stats of [total, companyStats, agent(response.agentId)]) {
        stats.response.push(response.seconds);
        if (response.first && response.measurable) stats.firstResponse.push(response.seconds);
        if (state) stats.sla[state] += 1;
      }
      if (buckets) {
        const entry = bucket(response.at);
        if (response.first && response.measurable) entry.firstResponse.push(response.seconds);
        if (state) { entry.measured += 1; if (state === "BREACHED") entry.breached += 1; }
      }
    }
    for (const message of walk.humanMessages) {
      if (!inWindow(message.at) || !matches(message.agentId)) continue;
      for (const stats of [total, companyStats, agent(message.agentId)]) stats.messagesSent += 1;
    }
    for (const claim of walk.claims) {
      if (!claim.agentId || !inWindow(claim.at) || !matches(claim.agentId)) continue;
      for (const stats of [total, companyStats, agent(claim.agentId)]) stats.claimed += 1;
    }
    for (const transfer of walk.transfers) {
      if (!inWindow(transfer.at)) continue;
      const counted = matches(transfer.fromUserId) || matches(transfer.toUserId);
      if (counted) { total.transfersOut += 1; companyStats.transfersOut += 1; }
      if (transfer.fromUserId && matches(transfer.fromUserId)) agent(transfer.fromUserId).transfersOut += 1;
      if (transfer.toUserId && matches(transfer.toUserId)) agent(transfer.toUserId).transfersIn += 1;
    }
  }

  return { truncated: false, total, byAgent, byCompany, byCategory, buckets };
}

// -----------------------------------------------------------------------
// Buckets de tempo no fuso da operação.
// -----------------------------------------------------------------------
function bucketKey(date, granularity) {
  const p = zonedParts(date);
  if (granularity === "hour") return `${p.year}-${p.month}-${p.day}-${p.hour}`;
  if (granularity === "month") return `${p.year}-${p.month}`;
  if (granularity === "week") {
    const monday = zonedParts(zonedMidnight(p.year, p.month, p.day - p.weekday));
    return `${monday.year}-${monday.month}-${monday.day}`;
  }
  return `${p.year}-${p.month}-${p.day}`;
}
function bucketLabel(date, granularity) {
  if (granularity === "hour") return `${date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", timeZone: TIME_ZONE })}h`;
  if (granularity === "month") return date.toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: TIME_ZONE });
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TIME_ZONE });
}
function defaultGranularity(preset, start, end) {
  if (preset === "today" || preset === "yesterday") return "hour";
  const days = (end - start) / DAY_MS;
  if (days > 120) return "month";
  if (days > 45) return "week";
  return "day";
}
function bucketSeries(start, end, granularity, buckets) {
  const points = new Map();
  let cursor = new Date(start);
  while (cursor < end) {
    const key = bucketKey(cursor, granularity);
    if (!points.has(key)) {
      const entry = buckets.get(key) || { finalized: 0, firstResponse: [], breached: 0, measured: 0 };
      points.set(key, {
        key, label: bucketLabel(cursor, granularity), finalized: entry.finalized,
        firstResponseAvgSeconds: average(entry.firstResponse), firstResponseSamples: entry.firstResponse.length,
        slaBreached: entry.breached, slaMeasured: entry.measured,
      });
    }
    if (granularity === "hour") cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
    else cursor = addZonedDays(cursor, 1);
  }
  return [...points.values()];
}

// -----------------------------------------------------------------------
// API pública
// -----------------------------------------------------------------------
async function usersFor(ids, companyIds) {
  if (!ids.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, email: true, role: true, active: true,
      companyAccess: { where: { companyId: { in: companyIds }, active: true }, select: { companyId: true, role: true } },
      categoryAccess: { where: { category: { is: { companyId: { in: companyIds }, parentId: null } } }, select: { category: { select: { name: true } } } },
    },
  });
  return new Map(users.map((user) => [user.id, user]));
}

function roleLabel(user) {
  const roles = new Set([user.role, ...(user.companyAccess || []).map((entry) => entry.role).filter(Boolean)]);
  if (roles.has("ADMIN")) return "Master";
  if (roles.has("SUPERVISOR")) return "Supervisor";
  return "Atendente";
}

async function activeNowByAgent(where) {
  const groups = await prisma.conversation.groupBy({
    by: ["assignedUserId", "status"], where: { AND: [where, { status: { in: ACTIVE_STATUSES } }] }, _count: { _all: true },
  });
  const map = new Map();
  let active = 0; let waiting = 0;
  for (const group of groups) {
    active += group._count._all;
    if (WAITING_TEAM.includes(group.status)) waiting += group._count._all;
    if (!group.assignedUserId) continue;
    const entry = map.get(group.assignedUserId) || { active: 0, waiting: 0 };
    entry.active += group._count._all;
    if (WAITING_TEAM.includes(group.status)) entry.waiting += group._count._all;
    map.set(group.assignedUserId, entry);
  }
  return { map, active, waiting };
}

const SUMMARY_KEYS = [
  "cyclesStarted", "claimed", "finalized", "finalizedByHuman", "finalizedWithoutHuman", "transfersOut", "reopened", "reopenRate",
  "firstResponseAvgSeconds", "responseAvgSeconds", "handlingAvgSeconds", "slaMetPercent", "slaBreached", "messagesSent",
];

// `access` vem de report-access-service#resolveReportAccess.
async function getProductivity(access, query = {}) {
  const period = resolvePeriod(query);
  const agentId = access.forcedAgentId || (query.agentId && query.agentId !== "unassigned" ? query.agentId : null);
  if (agentId && access.allowedAgentIds && !access.allowedAgentIds.includes(agentId)) throw Object.assign(new Error('Atendente não encontrado.'), { statusCode: 404 });
  // O filtro de atendente aqui é por ATRIBUIÇÃO (quem fez), nunca pelo
  // responsável atual da conversa — por isso fica fora do WHERE.
  const where = buildConversationWhere({ ...query, agentId: undefined, status: undefined, priority: undefined, companyIds: access.companyIds, scope: access.scope });
  const granularity = ["hour", "day", "week", "month"].includes(query.granularity) ? query.granularity : defaultGranularity(period.preset, period.start, period.end);

  const [current, previous, activeNow] = await Promise.all([
    aggregateWindow({ start: period.start, end: period.end, where, agentId, companyIds: access.companyIds, readablePrivateIds: access.readablePrivateIds, allowedAgentIds: access.allowedAgentIds, granularity }),
    period.preset === "all" ? null : aggregateWindow({ start: period.previousStart, end: period.previousEnd, where, agentId, companyIds: access.companyIds, readablePrivateIds: access.readablePrivateIds, allowedAgentIds: access.allowedAgentIds }),
    activeNowByAgent(agentId ? { AND: [where, { assignedUserId: agentId }] } : where),
  ]);
  const base = {
    period: { start: period.start, end: period.end, label: period.label, preset: period.preset, timeZone: TIME_ZONE },
    access: { mode: access.mode, canCompare: access.canCompare, agentId },
  };
  if (current.truncated) {
    return { ...base, truncated: true, summary: null, agents: [], companies: [], categories: [], sla: null, timeseries: { granularity, points: [] } };
  }

  const summaryCurrent = { ...finishStats(current.total), activeNow: activeNow.active, waitingTeamNow: activeNow.waiting };
  const summaryPrevious = previous && !previous.truncated ? finishStats(previous.total) : null;
  const changes = {};
  if (summaryPrevious) for (const key of SUMMARY_KEYS) changes[key] = percentChange(summaryCurrent[key], summaryPrevious[key]);

  const agentIds = [...new Set([...current.byAgent.keys(), ...activeNow.map.keys(), ...(previous?.byAgent?.keys() || [])])]
    .filter((id) => (!agentId || id === agentId) && (!access.allowedAgentIds || access.allowedAgentIds.includes(id)));
  const users = await usersFor(agentIds, access.companyIds);
  const agents = agentIds.filter((id) => users.has(id)).map((id) => {
    const user = users.get(id);
    const stats = finishStats(current.byAgent.get(id) || emptyStats());
    const before = previous?.byAgent?.get(id) ? finishStats(previous.byAgent.get(id)) : null;
    return {
      userId: id, name: user.name, role: roleLabel(user), active: user.active,
      teams: [...new Set(user.categoryAccess.map((entry) => entry.category.name))],
      ...stats, activeNow: activeNow.map.get(id)?.active || 0, waitingNow: activeNow.map.get(id)?.waiting || 0,
      previous: before ? { finalized: before.finalized, firstResponseAvgSeconds: before.firstResponseAvgSeconds, slaMetPercent: before.slaMetPercent, handlingAvgSeconds: before.handlingAvgSeconds } : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const companies = await prisma.company.findMany({ where: { id: { in: [...current.byCompany.keys()] } }, select: { id: true, name: true, slug: true, displayName: true, primaryColor: true } });
  const companyRows = companies.map((company) => ({ company, ...finishStats(current.byCompany.get(company.id)) }))
    .sort((a, b) => a.company.name.localeCompare(b.company.name, "pt-BR"));

  const categoryTotal = [...current.byCategory.values()].reduce((sum, entry) => sum + entry.finalized, 0);
  const categories = [...current.byCategory.values()].map((entry) => ({ ...entry, percent: percent(entry.finalized, categoryTotal) }))
    .sort((a, b) => b.finalized - a.finalized);

  return {
    ...base, truncated: false,
    summary: { current: summaryCurrent, previous: summaryPrevious, changes },
    agents: access.canCompare ? agents : agents.filter((row) => row.userId === access.forcedAgentId),
    companies: companyRows, categories,
    sla: { within: summaryCurrent.slaWithin, near: summaryCurrent.slaNear, breached: summaryCurrent.slaBreached, measured: summaryCurrent.slaMeasured },
    timeseries: { granularity, points: bucketSeries(period.start, period.end, granularity, current.buckets) },
  };
}

// Visão individual. 404 para quem o usuário não pode acompanhar (nunca
// revela nome de pessoa de outra empresa/equipe).
async function getAgentProductivity(access, userId, query = {}, viewer = null) {
  if (access.forcedAgentId && access.forcedAgentId !== userId) throw Object.assign(new Error("Atendente não encontrado."), { statusCode: 404 });
  const user = await prisma.user.findFirst({
    where: { id: userId, role: { not: "BOT" }, OR: [{ role: "ADMIN" }, { companyAccess: { some: { companyId: { in: access.companyIds }, active: true } } }] },
    select: {
      id: true, name: true, email: true, role: true, active: true,
      companyAccess: { where: { companyId: { in: access.companyIds }, active: true }, select: { companyId: true, role: true, company: { select: { name: true, slug: true, primaryColor: true } } } },
      categoryAccess: { where: { category: { is: { companyId: { in: access.companyIds }, parentId: null } } }, select: { category: { select: { name: true } } } },
    },
  });
  if (!user) throw Object.assign(new Error("Atendente não encontrado."), { statusCode: 404 });
  const data = await getProductivity({ ...access, forcedAgentId: userId, canCompare: false }, { ...query, agentId: userId });
  // Supervisor: a pessoa precisa ter atividade no escopo dele (ou ser de uma
  // equipe que ele acompanha) — sem isso, nada a mostrar e nada a revelar.
  if (access.mode === "SUPERVISOR" && !data.agents.length && user.id !== viewer?.id) {
    const visible = await prisma.conversation.count({ where: { AND: [access.scope, { companyId: { in: access.companyIds } }, { assignedUserId: userId }] } });
    if (!visible) throw Object.assign(new Error("Atendente não encontrado."), { statusCode: 404 });
  }
  return {
    user: {
      id: user.id, name: user.name, email: user.email, role: roleLabel(user), active: user.active,
      companies: user.companyAccess.map((entry) => ({ ...entry.company, role: entry.role })),
      teams: [...new Set(user.categoryAccess.map((entry) => entry.category.name))],
    },
    ...data,
  };
}

module.exports = {
  getProductivity, getAgentProductivity, walkConversation, slaStateFor, aggregateWindow,
  LOOKBACK_DAYS, REOPEN_WINDOW_MS,
};
