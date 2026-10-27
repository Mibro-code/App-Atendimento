// Agenda e Follow-ups (v0.36) — retornos e compromissos de atendimento.
//
// O que é: um LEMBRETE OPERACIONAL para a equipe ("ligar para o cliente
// amanhã às 14h"). Nunca envia mensagem ao cliente — não há disparo
// automático nesta versão. Agendamento de MENSAGEM continua sendo assunto de
// Campanhas (Campaign.scheduledAt), que não é usado aqui.
//
// Regras (sempre no backend):
//   - Empresa = empresa do contato. Nunca escolhida pelo usuário, nunca
//     misturada: o mesmo telefone na Mibro e na Sincrofit são contatos
//     diferentes, com agendas diferentes.
//   - Status gravado: PENDENTE | CONCLUIDO | CANCELADO. "ATRASADO" é
//     derivado (PENDENTE e dueAt < agora) — nunca diverge do relógio.
//   - Quem vê na Agenda:
//       Master ............ tudo das empresas que acessa;
//       Supervisor ........ (nas empresas em que é Supervisor) os da equipe
//                           definida pelo Master + os próprios;
//       Atendente ......... os próprios (responsável ou quem criou).
//     Na ficha do cliente, quem acessa o contato vê os retornos dele (mesma
//     régua das notas do contato).
//   - Financeiro protegido: follow-up criado com a conversa num setor
//     SECTOR_PRIVATE herda o carimbo (privateCategoryId). Para quem não lê o
//     setor, a observação some (restricted: true) — inclusive para o
//     responsável. Atendente fixo não ganha acesso ao Financeiro.
//   - Responsável: Atendente agenda para si ou para o atendente fixo do
//     cliente; Supervisor também para a equipe; Master para qualquer usuário
//     elegível (ativo, humano, com acesso à empresa).
const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const companyService = require("./company-service");
const privateSegments = require("./private-segment-service");
const audit = require("./audit-service");
const { TIME_ZONE, addZonedDays, localDateTime, parseZonedDate, startOfZonedDay, zonedParts } = require("./operation-time");

const REASONS = Object.freeze({
  RETORNO_COMERCIAL: "Retorno comercial",
  COTACAO: "Cotação",
  NEGOCIACAO: "Negociação",
  POS_VENDA: "Pós-venda",
  AGUARDAR_CLIENTE: "Aguardar cliente",
  AGUARDAR_DOCUMENTO: "Aguardar documento",
  OUTRO: "Outro",
});
const PRIORITIES = ["NORMAL", "ALTA", "URGENTE"];
const VIEWS = ["OVERDUE", "TODAY", "TOMORROW", "WEEK", "UPCOMING", "PENDING", "DONE", "CANCELLED", "ALL"];
const MAX_NOTE = 2000;
const MAX_FUTURE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
// Tolerância para "agendar para agora" (relógios de cliente/servidor).
const PAST_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_LIST = 500;
const RESTRICTED_NOTE = null;

const isMaster = (user) => user?.role === "ADMIN";

function fail(message, statusCode = 400, code) {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

function contactName(contact) {
  return contact?.customName || contact?.name || contact?.email || (contact?.phone ? `+${contact.phone}` : "Cliente");
}

// ---- datas (fuso da operação) ---------------------------------------------

// Aceita ISO com fuso ("2026-10-10T17:00:00.000Z") ou data+hora locais da
// operação ("2026-10-10" + "14:00"). Hora local nunca depende do fuso do
// servidor nem do navegador.
function parseDueAt({ dueAt, date, time } = {}) {
  if (date) return localDateTime(date, time || "09:00");
  if (!dueAt) return null;
  const value = new Date(String(dueAt).slice(0, 40));
  return Number.isNaN(value.getTime()) ? null : value;
}

function formatLocal(date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, dateStyle: "short", timeStyle: "short" }).format(new Date(date));
}

function derivedState(followUp, now = new Date()) {
  if (followUp.status !== "PENDENTE") return followUp.status;
  return new Date(followUp.dueAt).getTime() < now.getTime() ? "ATRASADO" : "PENDENTE";
}

// Intervalos das visões da Agenda, no calendário da operação.
function viewWhere(view, now = new Date()) {
  const today = startOfZonedDay(now);
  const tomorrow = addZonedDays(now, 1);
  const afterTomorrow = addZonedDays(now, 2);
  const p = zonedParts(now);
  // Semana = até o fim do domingo (weekday 0 = segunda).
  const endOfWeek = addZonedDays(now, 7 - p.weekday);
  switch (view) {
    case "OVERDUE": return { status: "PENDENTE", dueAt: { lt: now } };
    case "TODAY": return { status: "PENDENTE", dueAt: { gte: today, lt: tomorrow } };
    case "TOMORROW": return { status: "PENDENTE", dueAt: { gte: tomorrow, lt: afterTomorrow } };
    case "WEEK": return { status: "PENDENTE", dueAt: { gte: today, lt: endOfWeek } };
    case "UPCOMING": return { status: "PENDENTE", dueAt: { gte: now } };
    case "PENDING": return { status: "PENDENTE" };
    case "DONE": return { status: "CONCLUIDO" };
    case "CANCELLED": return { status: "CANCELADO" };
    default: return {};
  }
}

// ---- escopo ----------------------------------------------------------------

// Equipe que o usuário supervisiona (inclui ele mesmo). Vazio se não for
// Supervisor em nenhuma empresa.
async function teamIds(viewer) {
  const supervises = (await companyService.companyAccess(viewer)).some(({ role }) => role === "SUPERVISOR");
  if (!supervises) return [];
  return authorization.supervisedUserIds({ ...viewer, role: "SUPERVISOR" });
}

// Escopo Prisma da Agenda (o que aparece nas listas).
async function agendaScope(viewer, companyIds = null) {
  const access = await companyService.companyAccess(viewer);
  const allowed = access.map(({ companyId }) => companyId).filter((id) => !companyIds || companyIds.includes(id));
  if (!allowed.length) return { id: { in: [] } };
  if (isMaster(viewer)) return { companyId: { in: allowed } };
  const team = await teamIds(viewer);
  const branches = access.filter(({ companyId }) => allowed.includes(companyId)).map(({ companyId, role }) => {
    const people = role === "SUPERVISOR" && team.length ? team : [viewer.id];
    return { companyId, OR: [{ assigneeId: { in: people } }, { createdById: { in: people } }] };
  });
  return { OR: branches };
}

// Pode alterar (reagendar, concluir, cancelar, trocar responsável)?
async function canManage(viewer, followUp) {
  if (!(await companyService.canAccessCompany(viewer, followUp.companyId))) return false;
  if (isMaster(viewer)) return true;
  if (followUp.assigneeId === viewer.id || followUp.createdById === viewer.id) return true;
  if ((await companyService.roleInCompany(viewer, followUp.companyId)) !== "SUPERVISOR") return false;
  const team = await teamIds(viewer);
  return team.includes(followUp.assigneeId) || team.includes(followUp.createdById);
}

// Leitura de um follow-up: está na Agenda do usuário OU o usuário acessa o
// contato (ficha do cliente).
async function canView(viewer, followUp) {
  if (await canManage(viewer, followUp)) return true;
  if (!(await companyService.canAccessCompany(viewer, followUp.companyId))) return false;
  try {
    await authorization.assertCanAccessContact(viewer, followUp.contactId);
    return true;
  } catch {
    return false;
  }
}

async function eligibleUser(userId, companyId) {
  if (!userId) return null;
  const user = await prisma.user.findFirst({ where: { id: userId, active: true, role: { not: "BOT" } } });
  if (!user) return null;
  return (await companyService.userForCompany(user, companyId)) ? user : null;
}

// Para quem o usuário pode agendar, nesta empresa e para este contato.
async function assignableUserIds(viewer, companyId, contact) {
  if (isMaster(viewer)) return null; // qualquer elegível
  const ids = new Set([viewer.id]);
  if (contact?.preferredAssigneeId) ids.add(contact.preferredAssigneeId);
  if ((await companyService.roleInCompany(viewer, companyId)) === "SUPERVISOR") {
    for (const id of await teamIds(viewer)) ids.add(id);
  }
  return [...ids];
}

async function assertAssignable(viewer, companyId, contact, assigneeId) {
  const user = await eligibleUser(assigneeId, companyId);
  if (!user) throw fail("Responsável inválido: o usuário precisa estar ativo e ter acesso à empresa do cliente.", 400);
  const allowed = await assignableUserIds(viewer, companyId, contact);
  if (allowed && !allowed.includes(assigneeId)) {
    throw authorization.forbidden("Você só pode agendar retornos para você, para o atendente fixo do cliente ou (Supervisor) para a sua equipe.");
  }
  return user;
}

// ---- serialização --------------------------------------------------------

const ITEM_INCLUDE = {
  company: { select: { id: true, name: true, slug: true, displayName: true, primaryColor: true, logoUrl: true, active: true } },
  contact: { select: { id: true, customName: true, name: true, phone: true, email: true, preferredAssigneeId: true, preferredAssigneeEnabled: true } },
  channelAccount: { select: { id: true, name: true, channel: true, config: true } },
  assignee: { select: { id: true, name: true, active: true } },
  createdBy: { select: { id: true, name: true } },
  privateCategory: { select: { id: true, name: true } },
};

function accountLabel(account) {
  if (!account) return null;
  const displayNumber = account.config?.displayPhoneNumber || account.config?.displayNumber || null;
  return { id: account.id, name: account.name, channel: account.channel, displayNumber };
}

function serialize(followUp, { readable, canEdit = false, openableConversationIds = null, now = new Date() }) {
  const restricted = Boolean(followUp.privateCategoryId) && !privateSegments.canRead(readable, followUp.privateCategoryId);
  return {
    id: followUp.id,
    company: companyService.publicCompany(followUp.company),
    contact: { id: followUp.contact.id, name: contactName(followUp.contact), phone: followUp.contact.phone || null },
    conversationId: followUp.conversationId,
    canOpenConversation: Boolean(followUp.conversationId && (!openableConversationIds || openableConversationIds.has(followUp.conversationId))),
    channelAccount: accountLabel(followUp.channelAccount),
    assignee: followUp.assignee ? { id: followUp.assignee.id, name: followUp.assignee.name, active: followUp.assignee.active } : null,
    isPreferredAssignee: Boolean(followUp.assigneeId && followUp.assigneeId === followUp.contact.preferredAssigneeId),
    createdBy: followUp.createdBy ? { id: followUp.createdBy.id, name: followUp.createdBy.name } : null,
    dueAt: followUp.dueAt,
    reason: followUp.reason,
    reasonLabel: REASONS[followUp.reason] || followUp.reason,
    note: restricted ? RESTRICTED_NOTE : followUp.note,
    restricted,
    privateSector: followUp.privateCategoryId ? (restricted ? "Setor protegido" : followUp.privateCategory?.name || "Setor protegido") : null,
    priority: followUp.priority,
    status: followUp.status,
    state: derivedState(followUp, now),
    source: followUp.source,
    rescheduleCount: followUp.rescheduleCount,
    completedAt: followUp.completedAt,
    cancelledAt: followUp.cancelledAt,
    cancelReason: restricted ? null : followUp.cancelReason,
    createdAt: followUp.createdAt,
    updatedAt: followUp.updatedAt,
    canEdit,
  };
}

async function serializeMany(viewer, rows, now = new Date()) {
  const readable = await privateSegments.readablePrivateCategoryIds(viewer);
  const conversationIds = [...new Set(rows.map((row) => row.conversationId).filter(Boolean))];
  let openable = new Set();
  if (conversationIds.length) {
    const scope = await authorization.conversationScope(viewer);
    const visible = await prisma.conversation.findMany({ where: { AND: [{ id: { in: conversationIds } }, scope] }, select: { id: true } });
    openable = new Set(visible.map(({ id }) => id));
  }
  const items = [];
  for (const row of rows) {
    items.push(serialize(row, { readable, canEdit: row.status === "PENDENTE" && await canManage(viewer, row), openableConversationIds: openable, now }));
  }
  return items;
}

// ---- notificações -----------------------------------------------------------

// Aviso SEM conteúdo pelo SSE (a tela recarrega pela API, com RBAC) + push
// curto (nome do cliente e horário — nunca motivo/observação).
async function notifyAssignee(followUp, kind, { push = true, now = new Date(), lead = leadMinutes(), expectedDueAt, expectedAssigneeId } = {}) {
  if (!followUp?.assigneeId) return;
  // A atribuição não preserva autoridade após revogação ou desativação.
  const loaded = await prisma.followUp.findUnique({ where: { id: followUp.id }, include: ITEM_INCLUDE });
  if (!loaded || !loaded.company?.active) return;
  if (kind === "OVERDUE" || kind === "DUE_SOON") {
    if (loaded.status !== "PENDENTE") return;
    if (expectedDueAt && loaded.dueAt.getTime() !== expectedDueAt.getTime()) return;
    if (expectedAssigneeId && loaded.assigneeId !== expectedAssigneeId) return;
    const remaining = loaded.dueAt.getTime() - now.getTime();
    if (kind === "OVERDUE" ? remaining > 0 : remaining <= 0 || remaining > lead * 60000) return;
  }
  const invalidationOnly = kind === "UPDATED" && !push;
  if (loaded.assigneeId !== followUp.assigneeId && !invalidationOnly) return;
  if (!(await eligibleUser(followUp.assigneeId, loaded.companyId))) return;
  try {
    require("../realtime/inbox-events").publishToUsers([followUp.assigneeId], kind === "UPDATED" ? "followup.updated" : "followup.reminder", { id: followUp.id, kind });
  } catch {}
  if (!push) return;
  try {
    const label = loaded.company?.displayName ? `${loaded.company.displayName} · ` : "";
    const when = formatLocal(loaded.dueAt);
    const body = {
      DUE_SOON: `Retorno agendado para ${when}`,
      OVERDUE: `Retorno atrasado (era ${when})`,
      ASSIGNED: `Novo retorno para você: ${when}`,
      RESCHEDULED: `Retorno reagendado para ${when}`,
      CUSTOMER_RETURNED: "Cliente com retorno pendente enviou mensagem",
    }[kind];
    if (!body) return;
    await require("./push-service").notifyUser(loaded.assigneeId, {
      title: `${label}${contactName(loaded.contact)}`, company: loaded.company?.slug || null, body,
      tag: `followup-${loaded.id}`, url: `/agenda?followUp=${encodeURIComponent(loaded.id)}`,
    });
  } catch (error) {
    console.warn("[follow-up] falha ao notificar:", error.message);
  }
}

async function recordActivity(client, followUp, action, actor, details = {}) {
  if (!followUp.conversationId) return;
  // Sem observação/motivo livre nos detalhes: a linha do tempo mostra só o
  // fato e o horário. Carimbo privado: herdado do follow-up.
  await client.conversationActivity.create({
    data: {
      conversationId: followUp.conversationId, actorUserId: actor?.id || null, action,
      privateCategoryId: followUp.privateCategoryId || null,
      details: { followUpId: followUp.id, dueAt: followUp.dueAt, reason: followUp.reason, assigneeId: followUp.assigneeId, ...details },
    },
  });
}

// ---- consultas -------------------------------------------------------------

async function loadOr404(viewer, id) {
  const followUp = await prisma.followUp.findUnique({ where: { id: String(id || "") }, include: ITEM_INCLUDE });
  if (!followUp || !(await canView(viewer, followUp))) throw fail("Retorno não encontrado.", 404);
  return followUp;
}

async function resolveCompanyIds(viewer, company) {
  if (!company || company === companyService.ALL_COMPANIES) return null;
  return companyService.resolveCompanyFilter(viewer, company);
}

async function listFollowUps(viewer, query = {}, { now = new Date(), countViews: requestedViews, completedSince } = {}) {
  const view = VIEWS.includes(String(query.view || "").toUpperCase()) ? String(query.view).toUpperCase() : "PENDING";
  const companyIds = await resolveCompanyIds(viewer, query.company);
  const filters = [await agendaScope(viewer, companyIds)];
  if (query.assigneeId === "me") filters.push({ assigneeId: viewer.id });
  else if (query.assigneeId === "NONE") filters.push({ assigneeId: null });
  else if (query.assigneeId) filters.push({ assigneeId: String(query.assigneeId) });
  if (query.reason && REASONS[query.reason]) filters.push({ reason: query.reason });
  if (query.priority && PRIORITIES.includes(query.priority)) filters.push({ priority: query.priority });
  if (query.contactId) filters.push({ contactId: String(query.contactId) });
  const from = query.from ? parseZonedDate(query.from) : null;
  const to = query.to ? parseZonedDate(query.to) : null;
  if ((query.from && !from) || (query.to && !to)) throw fail("Período inválido (use AAAA-MM-DD).");
  if (from || to) filters.push({ dueAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: addZonedDays(to, 1) } : {}) } });
  const base = { AND: filters };
  const limit = Math.min(Math.max(Number(query.limit) || 200, 1), MAX_LIST);
  const orderBy = view === "DONE" ? [{ completedAt: "desc" }] : view === "CANCELLED" ? [{ cancelledAt: "desc" }] : [{ dueAt: "asc" }, { id: "asc" }];
  const [rows, counts] = await Promise.all([
    prisma.followUp.findMany({ where: { AND: [base, viewWhere(view, now), ...(view === "DONE" && completedSince ? [{ completedAt: { gte: completedSince } }] : [])] }, include: ITEM_INCLUDE, orderBy, take: limit + 1 }),
    countViews(base, now, requestedViews),
  ]);
  return {
    view, now, timeZone: TIME_ZONE, counts, truncated: rows.length > limit,
    items: await serializeMany(viewer, rows.slice(0, limit), now),
  };
}

async function countViews(base, now, requestedViews) {
  // Server-only optimization. Ordinary Agenda callers retain all counters;
  // the activity feed requests only what it uses, with identical scopes.
  const all = ["OVERDUE", "TODAY", "TOMORROW", "WEEK", "UPCOMING", "DONE", "CANCELLED"];
  const views = requestedViews === undefined ? all : [...new Set(requestedViews)].filter((view) => all.includes(view));
  const values = await Promise.all(views.map((view) => prisma.followUp.count({ where: { AND: [base, viewWhere(view, now)] } })));
  return Object.fromEntries(views.map((view, index) => [view, values[index]]));
}

// Ficha do cliente: retornos do contato (e dos contatos fundidos a ele — a
// fusão só ocorre dentro da mesma empresa).
async function listForContact(viewer, contactId, { now = new Date(), limit = 50 } = {}) {
  await authorization.assertCanAccessContact(viewer, contactId);
  const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, companyId: true, identityId: true } });
  if (!contact) throw fail("Contato não encontrado.", 404);
  await companyService.assertCompanyAccess(viewer, contact.companyId);
  const contactWhere = contact.identityId
    ? { contact: { is: { identityId: contact.identityId, companyId: contact.companyId } } }
    : { contactId };
  const rows = await prisma.followUp.findMany({
    where: { AND: [contactWhere, { companyId: contact.companyId }] },
    include: ITEM_INCLUDE, orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: Math.min(Number(limit) || 50, 200),
  });
  const items = await serializeMany(viewer, rows, now);
  return {
    items,
    pending: items.filter((item) => item.status === "PENDENTE").length,
    overdue: items.filter((item) => item.state === "ATRASADO").length,
  };
}

async function getFollowUp(viewer, id, { now = new Date() } = {}) {
  const followUp = await loadOr404(viewer, id);
  const [item] = await serializeMany(viewer, [followUp], now);
  // Janela de 24h do NÚMERO do retorno (nunca a de outro número).
  if (item.canOpenConversation && followUp.conversationId && (!followUp.channelAccount || followUp.channelAccount.channel === "META")) {
    try {
      const { getCustomerServiceWindow } = require("./meta-template-service");
      item.customerServiceWindow = await getCustomerServiceWindow(followUp.conversationId, now, followUp.channelAccountId ?? undefined);
    } catch {
      item.customerServiceWindow = null;
    }
  }
  return item;
}

// Opções do formulário: responsáveis permitidos e sugestão (atendente fixo).
async function formOptions(viewer, { conversationId, contactId, followUpId } = {}) {
  let contact;
  let companyId;
  // Edição de um retorno existente: basta poder gerenciá-lo (o Supervisor
  // reatribui retornos da equipe sem ganhar ação na conversa).
  if (followUpId) {
    const followUp = await loadOr404(viewer, followUpId);
    if (!(await canManage(viewer, followUp))) throw authorization.forbidden("Você não pode alterar este retorno.");
    contactId = followUp.contactId;
    conversationId = null;
  } else if (conversationId) {
    const conversation = await authorization.assertCanActOnConversation(viewer, conversationId);
    contactId = conversation.contactId;
  }
  if (!contactId) throw fail("Informe a conversa ou o contato.");
  if (!conversationId && !followUpId) await authorization.assertCanAccessContact(viewer, contactId, { act: true });
  contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, companyId: true, customName: true, name: true, phone: true, email: true, preferredAssigneeId: true, preferredAssigneeEnabled: true } });
  if (!contact) throw fail("Contato não encontrado.", 404);
  companyId = contact.companyId;
  await companyService.assertCompanyAccess(viewer, companyId);
  const allowed = await assignableUserIds(viewer, companyId, contact);
  const users = await prisma.user.findMany({
    where: {
      active: true, role: { not: "BOT" },
      ...(allowed ? { id: { in: allowed } } : {}),
      OR: [{ role: "ADMIN" }, { companyAccess: { some: { companyId, active: true } } }],
    },
    select: { id: true, name: true }, orderBy: { name: "asc" },
  });
  const preferred = contact.preferredAssigneeId && users.find((user) => user.id === contact.preferredAssigneeId);
  return {
    contact: { id: contact.id, name: contactName(contact) },
    company: companyService.publicCompany(await companyService.getCompany(companyId)),
    assignees: users,
    preferredAssigneeId: preferred ? preferred.id : null,
    suggestedAssigneeId: preferred ? preferred.id : viewer.id,
    reasons: Object.entries(REASONS).map(([value, label]) => ({ value, label })),
    priorities: PRIORITIES,
    timeZone: TIME_ZONE,
  };
}

// ---- escrita -----------------------------------------------------------------

function cleanNote(note) {
  if (note === undefined) return undefined;
  if (note === null) return null;
  const text = String(note).trim();
  if (text.length > MAX_NOTE) throw fail(`Observação muito longa (máximo ${MAX_NOTE} caracteres).`);
  return text || null;
}

function assertDue(dueAt, now) {
  if (!dueAt) throw fail("Informe data e horário válidos.");
  if (dueAt.getTime() < now.getTime() - PAST_TOLERANCE_MS) throw fail("A data do retorno já passou.");
  if (dueAt.getTime() > now.getTime() + MAX_FUTURE_MS) throw fail("Data muito distante (máximo de 2 anos).");
}

function assertReason(reason) {
  if (!REASONS[reason]) throw fail("Motivo inválido.");
}

function assertPriority(priority) {
  if (!PRIORITIES.includes(priority)) throw fail("Prioridade inválida.");
}

// Cria um retorno. `options.system` = criação automática (Flow Builder):
// sem usuário, idempotente por sourceKey, responsável validado só por
// elegibilidade (o fluxo foi publicado por quem administra o Bot).
async function createFollowUp(viewer, input = {}, { now = new Date(), system = null } = {}) {
  let conversation = null;
  let contactId = input.contactId ? String(input.contactId) : null;
  if (input.conversationId) {
    conversation = system
      ? await prisma.conversation.findUnique({ where: { id: String(input.conversationId) }, select: { id: true, contactId: true } })
      : await authorization.assertCanActOnConversation(viewer, String(input.conversationId));
    if (!conversation) throw fail("Conversa não encontrada.", 404);
    contactId = conversation.contactId;
  } else if (!system) {
    if (!contactId) throw fail("Informe a conversa ou o contato.");
    await authorization.assertCanAccessContact(viewer, contactId, { act: true });
  }
  const contact = await prisma.contact.findUnique({ where: { id: contactId || "" }, select: { id: true, companyId: true, customName: true, name: true, phone: true, email: true, preferredAssigneeId: true, preferredAssigneeEnabled: true } });
  if (!contact) throw fail("Contato não encontrado.", 404);
  const companyId = contact.companyId;
  if (!system) await companyService.assertCompanyAccess(viewer, companyId);
  const full = conversation ? await prisma.conversation.findUnique({ where: { id: conversation.id }, select: { id: true, companyId: true, channelAccountId: true } }) : null;
  if (full && full.companyId !== companyId) throw fail("Conversa e contato de empresas diferentes.", 400);

  const reason = String(input.reason || "RETORNO_COMERCIAL");
  assertReason(reason);
  const priority = String(input.priority || "NORMAL");
  assertPriority(priority);
  const dueAt = parseDueAt(input);
  assertDue(dueAt, now);
  const note = cleanNote(input.note);

  // Número de saída: o da conversa, ou um informado (mesma empresa e, para
  // quem não é Master, um número que o usuário pode usar).
  let channelAccountId = full?.channelAccountId || null;
  if (input.channelAccountId) {
    const account = await prisma.channelAccount.findUnique({ where: { id: String(input.channelAccountId) }, select: { id: true, companyId: true } });
    if (!account || account.companyId !== companyId) throw fail("Número/canal inválido para a empresa do cliente.");
    if (!system && !(await authorization.canAccessChannelAccount(viewer, account.id))) throw authorization.forbidden("Você não pode usar este número.");
    channelAccountId = account.id;
  }

  let assigneeId = input.assigneeId ? String(input.assigneeId) : null;
  if (system) {
    if (assigneeId && !(await eligibleUser(assigneeId, companyId))) assigneeId = null;
  } else {
    assigneeId ||= viewer.id;
    await assertAssignable(viewer, companyId, contact, assigneeId);
  }

  const privateCategoryId = conversation ? await privateSegments.stampForConversation(conversation.id, prisma) : null;
  const sourceKey = system?.sourceKey ? String(system.sourceKey).slice(0, 200) : null;
  if (sourceKey) {
    const existing = await prisma.followUp.findUnique({ where: { sourceKey }, include: ITEM_INCLUDE });
    if (existing) return { followUp: existing, created: false };
  }

  let followUp;
  try {
    followUp = await prisma.$transaction(async (tx) => {
      const created = await tx.followUp.create({
        data: {
          companyId, contactId: contact.id, conversationId: conversation?.id || null, channelAccountId,
          assigneeId, createdById: viewer?.id || null, dueAt, reason, note, priority, privateCategoryId,
          source: system ? "FLOW" : "MANUAL", sourceKey,
        },
        include: ITEM_INCLUDE,
      });
      await recordActivity(tx, created, "FOLLOW_UP_CREATED", viewer, system ? { automatic: true } : {});
      await audit.recordAudit({
        actor: viewer, action: "FOLLOW_UP_CREATED", entityType: "FOLLOW_UP", entityId: created.id, companyId,
        summary: `Agendou retorno para ${contactName(contact)} em ${formatLocal(dueAt)}`,
        details: { contactId: contact.id, conversationId: conversation?.id || null, assigneeId, reason, source: created.source },
      }, tx);
      return created;
    });
  } catch (error) {
    // Corrida na criação automática (mesmo sourceKey): devolve o existente.
    if (sourceKey && error.code === "P2002") {
      return { followUp: await prisma.followUp.findUnique({ where: { sourceKey }, include: ITEM_INCLUDE }), created: false };
    }
    throw error;
  }
  if (assigneeId && assigneeId !== viewer?.id) await notifyAssignee(followUp, "ASSIGNED");
  else if (assigneeId) await notifyAssignee(followUp, "UPDATED", { push: false });
  return { followUp, created: true };
}

async function createFromRequest(viewer, input, options) {
  const { followUp } = await createFollowUp(viewer, input, options);
  return getFollowUp(viewer, followUp.id, options);
}

async function loadForChange(viewer, id) {
  const followUp = await loadOr404(viewer, id);
  if (!(await canManage(viewer, followUp))) throw authorization.forbidden("Você não pode alterar este retorno.");
  if (followUp.status !== "PENDENTE") throw fail("Somente retornos pendentes podem ser alterados.", 409);
  return followUp;
}

// Edição/reagendamento/troca de responsável. Compare-and-set por updatedAt
// para não sobrescrever uma alteração simultânea.
async function updateFollowUp(viewer, id, input = {}, { now = new Date() } = {}) {
  const current = await loadForChange(viewer, id);
  const data = {};
  const events = [];
  if (input.dueAt !== undefined || input.date !== undefined) {
    const dueAt = parseDueAt(input);
    assertDue(dueAt, now);
    if (dueAt.getTime() !== current.dueAt.getTime()) {
      Object.assign(data, { dueAt, rescheduleCount: current.rescheduleCount + 1, remindedAt: null, overdueNotifiedAt: null });
      events.push(["FOLLOW_UP_RESCHEDULED", { from: current.dueAt, to: dueAt }]);
    }
  }
  if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
    if (!input.assigneeId) throw fail("Informe o responsável.");
    await assertAssignable(viewer, current.companyId, current.contact, String(input.assigneeId));
    Object.assign(data, { assigneeId: String(input.assigneeId), remindedAt: null, overdueNotifiedAt: null });
    events.push(["FOLLOW_UP_REASSIGNED", { fromUserId: current.assigneeId, toUserId: String(input.assigneeId) }]);
  }
  if (input.reason !== undefined) { assertReason(input.reason); data.reason = input.reason; }
  if (input.priority !== undefined) { assertPriority(input.priority); data.priority = input.priority; }
  if (input.note !== undefined) {
    const readable = await privateSegments.readablePrivateCategoryIds(viewer);
    if (current.privateCategoryId && !privateSegments.canRead(readable, current.privateCategoryId)) {
      throw authorization.forbidden("A observação deste retorno é de setor protegido.");
    }
    data.note = cleanNote(input.note);
  }
  if (!Object.keys(data).length) return getFollowUp(viewer, id, { now });
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.followUp.updateMany({ where: { id: current.id, status: "PENDENTE", updatedAt: current.updatedAt }, data });
    if (result.count !== 1) throw fail("Este retorno foi alterado por outra pessoa. Recarregue e tente novamente.", 409, "FOLLOW_UP_CONFLICT");
    const fresh = await tx.followUp.findUnique({ where: { id: current.id }, include: ITEM_INCLUDE });
    for (const [action, details] of events.length ? events : [["FOLLOW_UP_UPDATED", {}]]) await recordActivity(tx, fresh, action, viewer, details);
    await audit.recordAudit({
      actor: viewer, action: events.length ? events.map(([action]) => action).join(",") : "FOLLOW_UP_UPDATED", entityType: "FOLLOW_UP",
      entityId: fresh.id, companyId: fresh.companyId, summary: `Alterou retorno de ${contactName(fresh.contact)} (${formatLocal(fresh.dueAt)})`,
      details: { changed: Object.keys(data), assigneeId: fresh.assigneeId },
    }, tx);
    return fresh;
  });
  if (events.some(([action]) => action === "FOLLOW_UP_REASSIGNED")) {
    if (updated.assigneeId !== viewer.id) await notifyAssignee(updated, "ASSIGNED");
    if (current.assigneeId && current.assigneeId !== viewer.id) await notifyAssignee({ ...current, assigneeId: current.assigneeId }, "UPDATED", { push: false });
  } else if (events.length && updated.assigneeId && updated.assigneeId !== viewer.id) {
    await notifyAssignee(updated, "RESCHEDULED");
  } else {
    await notifyAssignee(updated, "UPDATED", { push: false });
  }
  return getFollowUp(viewer, id, { now });
}

async function finish(viewer, id, status, input = {}, { now = new Date() } = {}) {
  const current = await loadForChange(viewer, id);
  const data = status === "CONCLUIDO"
    ? { status, completedAt: now, completedById: viewer.id }
    : { status, cancelledAt: now, cancelledById: viewer.id, cancelReason: input.reason ? String(input.reason).trim().slice(0, 500) || null : null };
  if (status === "CONCLUIDO" && input.note !== undefined && String(input.note).trim()) {
    const readable = await privateSegments.readablePrivateCategoryIds(viewer);
    if (!current.privateCategoryId || privateSegments.canRead(readable, current.privateCategoryId)) {
      data.note = cleanNote([current.note, `Conclusão: ${String(input.note).trim()}`].filter(Boolean).join("\n"));
    }
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.followUp.updateMany({ where: { id: current.id, status: "PENDENTE" }, data });
    if (result.count !== 1) throw fail("Este retorno já foi concluído ou cancelado.", 409, "FOLLOW_UP_CONFLICT");
    const fresh = await tx.followUp.findUnique({ where: { id: current.id }, include: ITEM_INCLUDE });
    await recordActivity(tx, fresh, status === "CONCLUIDO" ? "FOLLOW_UP_COMPLETED" : "FOLLOW_UP_CANCELLED", viewer, { late: status === "CONCLUIDO" && current.dueAt < now });
    await audit.recordAudit({
      actor: viewer, action: status === "CONCLUIDO" ? "FOLLOW_UP_COMPLETED" : "FOLLOW_UP_CANCELLED", entityType: "FOLLOW_UP",
      entityId: fresh.id, companyId: fresh.companyId, summary: `${status === "CONCLUIDO" ? "Concluiu" : "Cancelou"} retorno de ${contactName(fresh.contact)}`,
      details: { assigneeId: fresh.assigneeId },
    }, tx);
    return fresh;
  });
  await notifyAssignee(updated, "UPDATED", { push: false });
  return getFollowUp(viewer, id, { now });
}

const completeFollowUp = (viewer, id, input, options) => finish(viewer, id, "CONCLUIDO", input, options);
const cancelFollowUp = (viewer, id, input, options) => finish(viewer, id, "CANCELADO", input, options);

// ---- lembretes (worker) -------------------------------------------------------

const DEFAULT_LEAD_MINUTES = 15;
const BATCH = 100;

function leadMinutes() {
  const value = Number(process.env.FOLLOW_UP_REMINDER_LEAD_MINUTES);
  return Number.isFinite(value) && value >= 0 && value <= 24 * 60 ? value : DEFAULT_LEAD_MINUTES;
}

// Um tick: reivindica cada lembrete com updateMany(where campo = null) — dois
// processos/ticks concorrentes nunca avisam duas vezes o mesmo retorno.
async function runReminderTick({ now = new Date(), lead = leadMinutes(), notify = notifyAssignee } = {}) {
  const sent = { dueSoon: 0, overdue: 0 };
  const activeCompany = { company: { is: { active: true } } };
  const overdue = await prisma.followUp.findMany({
    where: { status: "PENDENTE", overdueNotifiedAt: null, dueAt: { lte: now }, assigneeId: { not: null }, ...activeCompany },
    select: { id: true, updatedAt: true, dueAt: true, assigneeId: true }, orderBy: { dueAt: "asc" }, take: BATCH,
  });
  for (const { id, updatedAt, dueAt, assigneeId } of overdue) {
    const claim = await prisma.followUp.updateMany({ where: { id, updatedAt, dueAt, assigneeId, status: "PENDENTE", overdueNotifiedAt: null, ...activeCompany }, data: { overdueNotifiedAt: now, remindedAt: now } });
    if (claim.count !== 1) continue;
    sent.overdue += 1;
    await notify(await prisma.followUp.findUnique({ where: { id }, include: ITEM_INCLUDE }), "OVERDUE", { now, lead, expectedDueAt: dueAt, expectedAssigneeId: assigneeId });
  }
  const soon = await prisma.followUp.findMany({
    where: { status: "PENDENTE", remindedAt: null, dueAt: { gt: now, lte: new Date(now.getTime() + lead * 60000) }, assigneeId: { not: null }, ...activeCompany },
    select: { id: true, updatedAt: true, dueAt: true, assigneeId: true }, orderBy: { dueAt: "asc" }, take: BATCH,
  });
  for (const { id, updatedAt, dueAt, assigneeId } of soon) {
    const claim = await prisma.followUp.updateMany({ where: { id, updatedAt, dueAt, assigneeId, status: "PENDENTE", remindedAt: null, ...activeCompany }, data: { remindedAt: now } });
    if (claim.count !== 1) continue;
    sent.dueSoon += 1;
    await notify(await prisma.followUp.findUnique({ where: { id }, include: ITEM_INCLUDE }), "DUE_SOON", { now, lead, expectedDueAt: dueAt, expectedAssigneeId: assigneeId });
  }
  return sent;
}

let lastTick = null;
function startFollowUpReminderWorker({ intervalMs = 60 * 1000, onChange } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const sent = await runReminderTick();
      lastTick = { at: new Date(), ok: true, ...sent };
      if ((sent.dueSoon || sent.overdue) && onChange) onChange();
    } catch (error) {
      lastTick = { at: new Date(), ok: false, error: String(error.message || "erro").slice(0, 200) };
      console.error("[follow-up] falha no worker de lembretes:", error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  run();
  return () => clearInterval(timer);
}

function workerStatus() {
  return lastTick;
}

// Cliente com retorno pendente voltou a escrever: avisa o responsável (no
// máximo uma vez a cada 30 min por retorno, em memória do processo).
const customerReturnedAt = new Map();
const CUSTOMER_RETURN_COOLDOWN_MS = 30 * 60 * 1000;
async function notifyCustomerReturned(message, { now = new Date() } = {}) {
  if (!message?.conversationId || message.direction !== "RECEBIDA") return 0;
  const conversation = await prisma.conversation.findUnique({ where: { id: message.conversationId }, select: { contactId: true } });
  if (!conversation) return 0;
  const pending = await prisma.followUp.findMany({
    where: { contactId: conversation.contactId, status: "PENDENTE", assigneeId: { not: null }, company: { is: { active: true } } },
    include: ITEM_INCLUDE, take: 5,
  });
  let notified = 0;
  for (const followUp of pending) {
    const last = customerReturnedAt.get(followUp.id) || 0;
    if (now.getTime() - last < CUSTOMER_RETURN_COOLDOWN_MS) continue;
    customerReturnedAt.set(followUp.id, now.getTime());
    notified += 1;
    await notifyAssignee(followUp, "CUSTOMER_RETURNED");
  }
  if (customerReturnedAt.size > 5000) customerReturnedAt.clear();
  return notified;
}

// Contagem para badges (menu e Central de Operação).
async function summaryFor(viewer, { now = new Date(), companyIds = null } = {}) {
  const scope = await agendaScope(viewer, companyIds);
  const mine = { AND: [scope, { assigneeId: viewer.id }] };
  const [overdue, today, mineOverdue, mineToday] = await Promise.all([
    prisma.followUp.count({ where: { AND: [scope, viewWhere("OVERDUE", now)] } }),
    prisma.followUp.count({ where: { AND: [scope, viewWhere("TODAY", now)] } }),
    prisma.followUp.count({ where: { AND: [mine, viewWhere("OVERDUE", now)] } }),
    prisma.followUp.count({ where: { AND: [mine, viewWhere("TODAY", now)] } }),
  ]);
  return { overdue, today, mine: { overdue: mineOverdue, today: mineToday } };
}

module.exports = {
  PRIORITIES, REASONS, VIEWS,
  agendaScope, cancelFollowUp, canManage, completeFollowUp, createFollowUp, createFromRequest, derivedState, formOptions,
  getFollowUp, listFollowUps, listForContact, notifyCustomerReturned, parseDueAt, runReminderTick, startFollowUpReminderWorker,
  summaryFor, updateFollowUp, viewWhere, workerStatus,
};
