// Perfil 360° do cliente — visão consolidada do relacionamento SEM carregar
// mensagens: dados do contato, conversas que o usuário enxerga, agenda,
// notas, origem comercial e linha do tempo paginada de eventos.
//
// Regras (reaproveitadas, nunca reescritas):
//   - Conversas: authorization.conversationScope (mesma régua da Central).
//   - Eventos: só para quem pode ver histórico (Master ou
//     canViewConversationHistory) e só dentro das janelas que a Central já
//     mostra (inbox-service.readVisibility: histórico do atendente / trechos
//     da equipe na supervisão).
//   - Financeiro protegido: private-segment-service (eventos privados viram
//     marcador estrutural ou somem; notas privadas não aparecem).
//   - Multiempresa: o contato já é por empresa; contatos fundidos só dentro
//     da mesma empresa. Nada de outra empresa entra por coincidência de
//     telefone.
//   - Pedidos/compras/faturamento: não há integração real — não aparecem.
const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const companyService = require("./company-service");
const privateSegments = require("./private-segment-service");
const periods = require("./assignment-period-service");

const TIMELINE_PAGE = 30;
const MAX_TIMELINE_PAGE = 100;
const STATUS_LABELS = {
  NOVO: "Novo", BOT: "Com o Bot", EM_ATENDIMENTO: "Em atendimento", AGUARDANDO_EQUIPE: "Aguardando equipe",
  AGUARDANDO_CLIENTE: "Aguardando cliente", HANDOFF_BOT: "Bot transferiu", FINALIZADO: "Finalizado",
};
const CHANNEL_LABELS = {
  META: "WhatsApp", EMAIL: "E-mail", INSTAGRAM_DIRECT: "Instagram Direct", INSTAGRAM_COMMENTS: "Instagram (comentários)",
  FACEBOOK_MESSENGER: "Messenger", FACEBOOK_COMMENTS: "Facebook (comentários)",
};
const channelLabel = (channel) => CHANNEL_LABELS[channel] || channel;
const REASON_LABELS = {
  RETORNO_COMERCIAL: "retorno comercial", COTACAO: "cotação", NEGOCIACAO: "negociação", POS_VENDA: "pós-venda",
  AGUARDAR_CLIENTE: "aguardar cliente", AGUARDAR_DOCUMENTO: "aguardar documento", OUTRO: "outro",
};

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function contactName(contact) {
  return contact?.customName || contact?.name || contact?.email || (contact?.phone ? `+${contact.phone}` : "Cliente");
}

const when = (date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(date));

// Texto do evento — só a partir de campos estruturais (o que sobra depois
// do sanitizeActivities). Nunca usa motivo/resumo/prévia.
function describe(activity) {
  const d = activity.details && typeof activity.details === "object" ? activity.details : {};
  const actor = activity.actorUser?.name || null;
  switch (activity.action) {
    case "CONVERSATION_CLAIMED": return `${d.to || actor || "Atendente"} assumiu o atendimento${d.automatic ? " ao responder" : ""}`;
    case "CONVERSATION_TRANSFERRED": return `${actor || d.from || "Atendente"} transferiu${d.to ? ` para ${d.to}` : ""}${d.toCategory ? ` (${d.toCategory})` : ""}`;
    case "ASSIGNEE_REMOVED": return `${actor || "Alguém"} removeu o responsável`;
    case "CATEGORY_CHANGED": return `${actor || "Sistema"} alterou o setor${d.to ? ` para ${d.to}` : ""}`;
    case "STATUS_CHANGED": return d.to === "FINALIZADO" ? `${actor || "Sistema"} finalizou o atendimento` : `Status: ${STATUS_LABELS[d.to] || d.to || "—"}`;
    case "PRIORITY_CHANGED": return `Prioridade: ${d.to || "—"}`;
    case "REOPENED_BY_CUSTOMER_MESSAGE": return "Cliente voltou a escrever (novo atendimento)";
    case "AUTO_FINALIZED_INACTIVITY": return "Finalizado automaticamente por inatividade";
    case "PRIVATE_SEGMENT_STARTED": return "Entrou em setor protegido";
    case "PRIVATE_SEGMENT_ENDED": return "Saiu de setor protegido";
    case "BOT_FLOW_STARTED": return "Bot iniciou o atendimento";
    case "BOT_FLOW_HANDOFF": return "Bot encaminhou para a equipe";
    case "BOT_FLOW_TRANSFERRED": return `Bot encaminhou${d.categoryName ? ` para ${d.categoryName}` : ""}`;
    case "BOT_FLOW_TRANSFERRED_TO_USER": return `Bot encaminhou${d.to ? ` para ${d.to}` : ""}`;
    case "BOT_FLOW_COMPLETED": return "Bot concluiu o fluxo";
    case "BOT_FLOW_FOLLOW_UP_SCHEDULED": return "Bot agendou um retorno";
    case "ROUTED_TO_PREFERRED_ASSIGNEE": return "Direcionado ao atendente fixo";
    case "FOLLOW_UP_CREATED": return `${actor || (d.automatic ? "Bot" : "Equipe")} agendou retorno${d.reason ? ` (${REASON_LABELS[d.reason] || d.reason})` : ""}${d.dueAt ? ` para ${when(d.dueAt)}` : ""}`;
    case "FOLLOW_UP_RESCHEDULED": return `${actor || "Equipe"} reagendou o retorno${d.to ? ` para ${when(d.to)}` : ""}`;
    case "FOLLOW_UP_REASSIGNED": return `${actor || "Equipe"} trocou o responsável do retorno`;
    case "FOLLOW_UP_COMPLETED": return `${actor || "Equipe"} concluiu o retorno${d.late ? " (com atraso)" : ""}`;
    case "FOLLOW_UP_CANCELLED": return `${actor || "Equipe"} cancelou o retorno`;
    case "FOLLOW_UP_UPDATED": return `${actor || "Equipe"} editou o retorno`;
    case "SLA_RESPONSE_BREACHED": return "SLA de resposta estourado";
    default: return null; // eventos técnicos não entram na linha do tempo
  }
}

// Contato + contatos fundidos (mesma empresa) que o usuário enxerga.
async function loadContactScope(viewer, contactId) {
  await authorization.assertCanAccessContact(viewer, contactId);
  const contact = await prisma.contact.findUnique({
    where: { id: String(contactId || "") },
    include: {
      company: true,
      preferredAssignee: { select: { id: true, name: true, active: true } },
    },
  });
  if (!contact) throw fail("Contato não encontrado.", 404);
  await companyService.assertCompanyAccess(viewer, contact.companyId);
  const contactIds = contact.identityId
    ? (await prisma.contact.findMany({ where: { identityId: contact.identityId, companyId: contact.companyId }, select: { id: true } })).map(({ id }) => id)
    : [contact.id];
  const scope = await authorization.conversationScope(viewer);
  const conversations = await prisma.conversation.findMany({
    where: { AND: [{ contactId: { in: contactIds } }, { companyId: contact.companyId }, scope] },
    select: {
      id: true, channel: true, status: true, priority: true, categoryId: true, assignedUserId: true, contactId: true,
      createdAt: true, lastMessageAt: true, finalizedAt: true, originSource: true, originCampaignId: true,
      channelAccount: { select: { id: true, name: true, config: true } },
      category: { select: { id: true, name: true, visibilityMode: true, parent: { select: { name: true, visibilityMode: true } } } },
      assignedUser: { select: { id: true, name: true } },
      originCampaign: { select: { id: true, name: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
  });
  return { contact, contactIds, conversations };
}

// Janelas de eventos por conversa (null = sem restrição). Sem permissão de
// histórico: nenhuma janela e nenhum acesso à linha do tempo.
async function eventWindows(viewer, conversations) {
  const canViewHistory = authorization.isMaster(viewer) || Boolean(viewer.canViewConversationHistory);
  if (!canViewHistory) return { canViewHistory, branches: [] };
  const { readVisibility } = require("./inbox-service");
  const branches = [];
  for (const conversation of conversations) {
    const visibility = await readVisibility(conversation, viewer);
    const windowWhere = periods.windowsWhere(visibility.windows, "createdAt");
    branches.push({ AND: [{ conversationId: conversation.id }, ...(windowWhere ? [windowWhere] : [])] });
  }
  return { canViewHistory, branches };
}

async function getTimeline(viewer, contactId, query = {}) {
  const { conversations } = await loadContactScope(viewer, contactId);
  const limit = Math.min(Math.max(Number(query.limit) || TIMELINE_PAGE, 1), MAX_TIMELINE_PAGE);
  const [cursorDate, cursorId = null] = query.before ? String(query.before).split("|") : [];
  const before = cursorDate ? new Date(cursorDate) : null;
  if (before && Number.isNaN(before.getTime())) throw fail("Cursor inválido.");
  if (cursorId && !/^[A-Za-z0-9_:-]{1,128}$/.test(cursorId)) throw fail("Cursor inválido.");
  const { canViewHistory, branches } = await eventWindows(viewer, conversations);
  if (!canViewHistory) throw authorization.forbidden("Você precisa da permissão Visualizar histórico para acessar a linha do tempo.");
  const readable = await privateSegments.readablePrivateCategoryIds(viewer);
  const conversationLabel = new Map(conversations.map((conversation) => [conversation.id, conversation.channelAccount?.name || channelLabel(conversation.channel)]));
  const items = [];
  let nextCursor = null;
  if (branches.length) {
    const rows = await prisma.conversationActivity.findMany({
      where: { AND: [{ OR: branches }, ...(before ? [cursorId ? { OR: [
        { createdAt: { lt: before } }, { createdAt: before, id: { lt: cursorId } },
      ] } : { createdAt: { lt: before } }] : [])] },
      include: { actorUser: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    if (rows.length > limit) nextCursor = `${page[page.length - 1].createdAt.toISOString()}|${page[page.length - 1].id}`;
    for (const activity of privateSegments.sanitizeActivities(page, readable)) {
      const label = describe(activity);
      if (!label) continue;
      items.push({
        id: activity.id, at: activity.createdAt, action: activity.action, label, restricted: Boolean(activity.restricted),
        conversationId: activity.conversationId, channel: conversationLabel.get(activity.conversationId) || null,
      });
    }
  }
  // Início de cada conversa visível, também protegido pela permissão de
  // histórico e dentro do intervalo pedido.
  const compare = (at, id, boundAt, boundId) => new Date(at).getTime() - new Date(boundAt).getTime() || (id < boundId ? -1 : id > boundId ? 1 : 0);
  const [nextDate, nextId] = nextCursor ? nextCursor.split("|") : [];
  for (const conversation of conversations) {
    const id = `start:${conversation.id}`;
    if (before && (cursorId ? compare(conversation.createdAt, id, before, cursorId) >= 0 : conversation.createdAt >= before)) continue;
    if (nextCursor && compare(conversation.createdAt, id, nextDate, nextId) < 0) continue;
    items.push({ id, at: conversation.createdAt, action: "CONVERSATION_STARTED", label: "Cliente iniciou contato", conversationId: conversation.id, channel: conversationLabel.get(conversation.id) || null, restricted: false });
  }
  items.sort((left, right) => compare(right.at, right.id, left.at, left.id));
  return { items, nextCursor, canViewHistory };
}

async function getProfile(viewer, contactId, { now = new Date() } = {}) {
  const { contact, contactIds, conversations } = await loadContactScope(viewer, contactId);
  const readable = await privateSegments.readablePrivateCategoryIds(viewer);
  const { canViewHistory, branches } = await eventWindows(viewer, conversations);
  const [finalized, transfers, notes, followUps, mergedContacts] = await Promise.all([
    branches.length ? prisma.conversationActivity.count({ where: { AND: [{ OR: branches }, { OR: [{ action: "AUTO_FINALIZED_INACTIVITY" }, { action: "STATUS_CHANGED", details: { path: ["to"], equals: "FINALIZADO" } }] }] } }) : null,
    branches.length ? prisma.conversationActivity.count({ where: { AND: [{ OR: branches }, { action: "CONVERSATION_TRANSFERRED" }] } }) : null,
    // Notas: mesma regra da Central (setor protegido só para quem lê).
    // Acesso só de supervisão vê as notas dos trechos da equipe.
    (async () => {
      // Same authorization predicate, but only existence matters here. Avoid
      // rebuilding the scope and querying once for every visible conversation.
      const operational = authorization.isMaster(viewer) || Boolean(conversations.length && await prisma.conversation.findFirst({
        where: { AND: [{ id: { in: conversations.map(({ id }) => id) } }, await authorization.operationalScope(viewer)] },
        select: { id: true },
      }));
      const extra = [];
      if (!operational) {
        const team = await authorization.supervisedUserIds(viewer);
        const windows = periods.mergeWindows((await Promise.all(conversations.map((conversation) => periods.supervisionWindows(conversation, team)))).flat());
        extra.push(periods.windowsWhere(windows, "createdAt") || {});
      }
      return prisma.contactNote.findMany({
        where: { AND: [{ contactId: { in: contactIds } }, privateSegments.readableWhere(readable), ...extra] },
        include: { author: { select: { id: true, name: true } } },
        orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
        take: 10,
      });
    })(),
    require("./follow-up-service").listForContact(viewer, contact.id, { now, limit: 20 }),
    contact.identityId ? prisma.contact.count({ where: { identityId: contact.identityId, companyId: contact.companyId } }) : 1,
  ]);
  const first = conversations.reduce((oldest, conversation) => (!oldest || conversation.createdAt < oldest.createdAt ? conversation : oldest), null);
  const lastInteractionAt = conversations.reduce((latest, conversation) => (conversation.lastMessageAt && (!latest || conversation.lastMessageAt > latest) ? conversation.lastMessageAt : latest), null);
  const categoryLabel = (category) => (category ? (category.parent ? `${category.parent.name}: ${category.name}` : category.name) : null);
  const current = conversations.find((conversation) => conversation.status !== "FINALIZADO") || conversations[0] || null;
  return {
    contact: {
      id: contact.id, name: contactName(contact), phone: contact.phone || null, email: contact.email || null, channel: contact.channel,
      createdAt: contact.createdAt, mergedContacts: mergedContacts > 1 ? mergedContacts : 0,
    },
    company: companyService.publicCompany(contact.company),
    preferredAssignee: contact.preferredAssignee ? { ...contact.preferredAssignee, autoRouteEnabled: contact.preferredAssigneeEnabled } : null,
    current: current ? {
      conversationId: current.id, status: current.status, statusLabel: STATUS_LABELS[current.status] || current.status,
      assignee: current.assignedUser, category: categoryLabel(current.category), priority: current.priority,
      channelAccount: current.channelAccount ? { id: current.channelAccount.id, name: current.channelAccount.name, displayNumber: current.channelAccount.config?.displayNumber || null } : null,
    } : null,
    conversations: conversations.map((conversation) => ({
      id: conversation.id, channel: conversation.channel, channelLabel: channelLabel(conversation.channel), status: conversation.status, statusLabel: STATUS_LABELS[conversation.status] || conversation.status,
      channelAccount: conversation.channelAccount ? { name: conversation.channelAccount.name, displayNumber: conversation.channelAccount.config?.displayNumber || null } : null,
      category: categoryLabel(conversation.category), assignee: conversation.assignedUser,
      createdAt: conversation.createdAt, lastMessageAt: conversation.lastMessageAt,
    })),
    stats: {
      conversations: conversations.length,
      firstContactAt: first?.createdAt || null,
      lastInteractionAt,
      // null = o usuário não tem permissão de histórico (não é "zero").
      finalizedCycles: finalized,
      transfers,
    },
    agenda: { pending: followUps.pending, overdue: followUps.overdue, items: followUps.items.slice(0, 10) },
    notes: notes.map((note) => ({ id: note.id, content: note.content, pinned: note.pinned, author: note.author?.name || "Equipe", createdAt: note.createdAt, updatedAt: note.updatedAt })),
    commercial: {
      origin: first ? (first.originSource === "OUTBOUND_CAMPAIGN" ? `Resposta a campanha${first.originCampaign?.name ? ` (${first.originCampaign.name})` : ""}` : first.originSource || "Não registrada") : null,
      sectors: [...new Set(conversations.map((conversation) => categoryLabel(conversation.category)).filter(Boolean))],
      // Sem integração de pedidos/faturamento: nunca inventado.
      orders: null,
    },
    canViewHistory,
  };
}

module.exports = { describe, getProfile, getTimeline };
