// Central de Atividades (CRM ↔ Atendimento): leitura e ações sobre os
// retornos da Agenda da Central para um usuário vinculado. Não há cópia de
// registros entre os bancos: o CRM consulta sob demanda e cada sistema
// continua dono dos próprios compromissos. Escopo (empresa, equipe, Master),
// setor protegido, compare-and-set, auditoria, linha do tempo da conversa e
// avisos continuam sendo os de follow-up-service.
const followUps = require("./follow-up-service");
const { addZonedDays, zonedDateKey } = require("./operation-time");

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const COMPANIES = ["mibro", "sincrofit"];
const HORIZON_DAYS = 14;
const DONE_DAYS = 7;
const MAX_ITEMS = 200;

function fail(message = "Atividade indisponível ou fora do seu acesso.", statusCode = 404) {
  return Object.assign(new Error(message), { statusCode });
}

// Somente o que a Central de Atividades exibe: sem telefone, sem conteúdo de
// mensagens e sem observação de setor protegido (o serviço já a recorta).
function toItem(row) {
  return {
    id: row.id,
    company: row.company ? { id: row.company.id, slug: row.company.slug, name: row.company.displayName || row.company.name } : null,
    contact: { id: row.contact.id, name: row.contact.name },
    reason: row.reason,
    reasonLabel: row.reasonLabel,
    note: row.note,
    restricted: row.restricted,
    privateSector: row.privateSector,
    priority: row.priority,
    status: row.status,
    state: row.state,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    rescheduleCount: row.rescheduleCount,
    assignee: row.assignee ? { id: row.assignee.id, name: row.assignee.name } : null,
    createdBy: row.createdBy ? { id: row.createdBy.id, name: row.createdBy.name } : null,
    conversationId: row.canOpenConversation ? row.conversationId : null,
    canEdit: row.canEdit,
  };
}

function parseInput(input = {}) {
  const company = String(input.company || "");
  if (!COMPANIES.includes(company)) throw fail("Selecione a empresa.", 400);
  return { company, scope: input.scope === "team" ? "team" : "mine" };
}

async function feed(user, input = {}, { now = new Date() } = {}) {
  const { company, scope } = parseInput(input);
  const base = { company, ...(scope === "mine" ? { assigneeId: "me" } : {}) };
  const doneSince = now.getTime() - DONE_DAYS * 86400000;
  const [pending, done] = await Promise.all([
    followUps.listFollowUps(user, { ...base, view: "PENDING", to: zonedDateKey(addZonedDays(now, HORIZON_DAYS)), limit: MAX_ITEMS }, { now, countViews: ["OVERDUE", "TODAY"] }),
    followUps.listFollowUps(user, { ...base, view: "DONE", limit: 30 }, { now, countViews: [], completedSince: new Date(doneSince) }),
  ]);
  const recent = done.items.filter((row) => row.completedAt && new Date(row.completedAt).getTime() >= doneSince);
  return {
    company,
    scope,
    horizonDays: HORIZON_DAYS,
    truncated: pending.truncated || done.truncated,
    // Contagens globais do escopo (sem o horizonte), como na Agenda da Central.
    counts: { overdue: pending.counts.OVERDUE, today: pending.counts.TODAY },
    // A completion during the parallel reads may appear in both results.
    // The completed snapshot wins; never show one source record twice.
    items: [...new Map([...pending.items, ...recent].map((row) => [row.id, toItem(row)])).values()],
  };
}

// Concluir ou reagendar pelo CRM usa exatamente as regras da Agenda da
// Central (somente pendentes, quem pode gerenciar, conflito de edição).
async function act(user, input = {}, { now = new Date() } = {}) {
  const id = String(input.id || "");
  if (!ID.test(id)) throw fail();
  if (input.action === "COMPLETE") {
    const note = typeof input.note === "string" ? input.note.slice(0, 500) : undefined;
    return toItem(await followUps.completeFollowUp(user, id, { note }, { now }));
  }
  if (input.action === "RESCHEDULE") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || "") || !/^\d{2}:\d{2}$/.test(input.time || "")) throw fail("Informe data e horário.", 400);
    return toItem(await followUps.updateFollowUp(user, id, { date: input.date, time: input.time }, { now }));
  }
  throw fail("Ação inválida.", 400);
}

module.exports = { feed, act, HORIZON_DAYS };
