import "server-only";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCustomerScopeFilter, type SessionUser } from "@/lib/authz";
import { APPOINTMENT_SELECT, canEditAppointment, getAgendaViewer, getAppointmentScopeFilter, myAppointmentsFilter } from "@/lib/agenda";
import { APPOINTMENT_TYPE_LABELS, isOverdue } from "@/lib/agenda-rules";
import { centralRequest } from "@/lib/central-identity";
import { centralSession } from "@/lib/central-session";
import type { ActivityItem } from "@/lib/activity-center-rules";

// Central de Atividades: visão única, montada sob demanda, dos compromissos
// que continuam pertencendo a cada sistema (Agenda do CRM, recompra do CRM e
// retornos da Agenda da Central). Nada é copiado entre bancos, então não há
// sincronização nem duplicidade a reconciliar.

export const HORIZON_DAYS = 14;
const DONE_DAYS = 7;
const LIMIT = 200;

export type ActivityScope = "mine" | "team";
export type CentralFeedStatus = "ok" | "unlinked" | "unavailable" | "no-company" | "forbidden";

interface CentralFollowUp {
  id: string;
  company: { id: string; slug: string; name: string } | null;
  contact: { id: string; name: string };
  reasonLabel: string;
  note: string | null;
  priority: "NORMAL" | "ALTA" | "URGENTE";
  status: string;
  state: "PENDENTE" | "ATRASADO" | "CONCLUIDO" | "CANCELADO";
  dueAt: string;
  completedAt: string | null;
  assignee: { id: string; name: string } | null;
  conversationId: string | null;
  canEdit: boolean;
}

const sellerName = (user: { name: string | null; sellerProfile?: { displayName: string | null } | null }) =>
  user.sellerProfile?.displayName || user.name || "Usuário";

export async function crmActivities(user: SessionUser, scope: ActivityScope, now = new Date()): Promise<{ items: ActivityItem[]; truncated: boolean }> {
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const appointmentScope = scope === "team" ? await getAppointmentScopeFilter(user) : myAppointmentsFilter(user.id);
  const customerScope: Prisma.CustomerWhereInput = scope === "team" ? await getCustomerScopeFilter(user) : { sellerId: user.id };
  const viewer = await getAgendaViewer(user);
  const [pending, done, repurchase] = await Promise.all([
    prisma.appointment.findMany({
      where: { AND: [appointmentScope, { status: "PENDENTE", startsAt: { lt: horizon } }] },
      select: APPOINTMENT_SELECT,
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: LIMIT + 1,
    }),
    prisma.appointment.findMany({
      where: { AND: [appointmentScope, { status: "CONCLUIDO", completedAt: { gte: new Date(now.getTime() - DONE_DAYS * 86_400_000) } }] },
      select: APPOINTMENT_SELECT,
      orderBy: { completedAt: "desc" },
      take: 31,
    }),
    // Mesmo recorte da tela "Follow-up de recompra" (clientes que já
    // compraram e estão na etapa própria). Somente leitura: esta consulta
    // não executa as rotinas de retorno automático de etapa.
    prisma.followUp.findMany({
      where: { status: "PENDENTE", dueAt: { lt: horizon }, customer: { is: { AND: [customerScope, { pipelineStage: "FOLLOW_UP", lastSaleAt: { not: null } }] } } },
      select: {
        id: true, dueAt: true, note: true,
        seller: { select: { id: true, name: true, sellerProfile: { select: { displayName: true } } } },
        customer: { select: { id: true, contactName: true, tradeName: true } },
      },
      orderBy: { dueAt: "asc" },
      take: LIMIT + 1,
    }),
  ]);
  const items: ActivityItem[] = [
    ...[...pending.slice(0, LIMIT), ...done.slice(0, 30)].map((row): ActivityItem => ({
      key: `CRM_AGENDA:${row.id}`,
      source: "CRM_AGENDA",
      id: row.id,
      title: row.title,
      kind: APPOINTMENT_TYPE_LABELS[row.type],
      at: row.startsAt.toISOString(),
      endsAt: row.endsAt?.toISOString() ?? null,
      allDay: row.allDay,
      state: row.status === "CONCLUIDO" ? "CONCLUIDO" : isOverdue(row, now) ? "ATRASADO" : "PENDENTE",
      priority: row.priority,
      assignee: { key: row.assignedTo.id, name: sellerName(row.assignedTo) },
      customer: row.customer ? { id: row.customer.id, name: row.customer.tradeName || row.customer.contactName } : null,
      company: null,
      conversationId: null,
      note: row.description,
      // Mesma regra da Agenda: altera quem tem o responsável no escopo;
      // participante de evento compartilhado só visualiza.
      canEdit: row.status === "PENDENTE" && canEditAppointment(viewer, row.assignedTo.id),
      completedAt: row.completedAt?.toISOString() ?? null,
    })),
    ...repurchase.slice(0, LIMIT).map((row): ActivityItem => ({
      key: `CRM_RECOMPRA:${row.id}`,
      source: "CRM_RECOMPRA",
      id: row.id,
      title: `Recompra · ${row.customer.tradeName || row.customer.contactName}`,
      kind: "Follow-up de recompra",
      at: row.dueAt.toISOString(),
      allDay: false,
      state: row.dueAt < now ? "ATRASADO" : "PENDENTE",
      priority: "NORMAL",
      assignee: { key: row.seller.id, name: sellerName(row.seller) },
      customer: { id: row.customer.id, name: row.customer.tradeName || row.customer.contactName },
      company: null,
      conversationId: null,
      note: row.note,
      canEdit: true,
      completedAt: null,
    })),
  ];
  return { items: [...new Map(items.map((item) => [item.key, item])).values()], truncated: pending.length > LIMIT || repurchase.length > LIMIT || done.length > 30 };
}

/**
 * Retornos da Agenda da Central, consultados no momento com a autorização
 * da própria Central (empresa, equipe, setor protegido). O responsável é
 * associado ao usuário do CRM somente quando existe vínculo de identidade,
 * e o cliente só é indicado quando há vínculo explícito de contato E o
 * cadastro está na carteira visível ao usuário.
 */
export async function centralActivities(
  req: NextRequest,
  user: SessionUser,
  company: string,
  scope: ActivityScope
): Promise<{ status: CentralFeedStatus; items: ActivityItem[]; counts?: { overdue: number; today: number }; truncated?: boolean }> {
  if (!["mibro", "sincrofit"].includes(company)) return { status: "no-company", items: [] };
  const context = await centralSession(req, user);
  if (!context) return { status: "unlinked", items: [] };
  let data: { items: CentralFollowUp[]; counts: { overdue: number; today: number }; truncated: boolean };
  try {
    data = await centralRequest("/identity/activity-feed", { ...context, company, scope });
  } catch (failure) {
    return { status: (failure as { statusCode?: number }).statusCode === 403 ? "forbidden" : "unavailable", items: [] };
  }
  const rows = data.items.filter((row) => row.company?.slug === company && row.state !== "CANCELADO");
  const [identities, links, scopeFilter] = await Promise.all([
    prisma.centralIdentityLink.findMany({
      where: { enabled: true, attendanceUserId: { in: [...new Set(rows.flatMap((row) => (row.assignee ? [row.assignee.id] : [])))] } },
      select: { attendanceUserId: true, userId: true },
    }),
    prisma.centralContactLink.findMany({
      where: { OR: rows.filter((row) => row.company).map((row) => ({ attendanceCompanyId: row.company!.id, attendanceContactId: row.contact.id })) },
      select: { attendanceCompanyId: true, attendanceContactId: true, customerId: true },
    }),
    getCustomerScopeFilter(user),
  ]);
  const visible = new Map(
    (await prisma.customer.findMany({
      where: { AND: [scopeFilter, { id: { in: [...new Set(links.map((link) => link.customerId))] } }] },
      select: { id: true, contactName: true, tradeName: true },
    })).map((row) => [row.id, row.tradeName || row.contactName])
  );
  const crmUser = new Map(identities.map((row) => [row.attendanceUserId, row.userId]));
  const customerOf = new Map(links.map((link) => [`${link.attendanceCompanyId}:${link.attendanceContactId}`, link.customerId]));
  const items = rows.map((row): ActivityItem => {
    const customerId = row.company ? customerOf.get(`${row.company.id}:${row.contact.id}`) : undefined;
    const customerName = customerId ? visible.get(customerId) : undefined;
    return {
      key: `CENTRAL:${row.id}`,
      source: "CENTRAL",
      id: row.id,
      title: `${row.reasonLabel} · ${row.contact.name}`,
      kind: row.reasonLabel,
      at: row.dueAt,
      allDay: false,
      state: row.state === "CONCLUIDO" ? "CONCLUIDO" : row.state === "ATRASADO" ? "ATRASADO" : "PENDENTE",
      priority: row.priority,
      assignee: row.assignee ? { key: crmUser.get(row.assignee.id) ?? `central:${row.assignee.id}`, name: row.assignee.name } : null,
      customer: customerId && customerName ? { id: customerId, name: customerName } : null,
      company: row.company ? { slug: row.company.slug, name: row.company.name } : null,
      conversationId: row.conversationId,
      note: row.note,
      canEdit: row.canEdit && row.status === "PENDENTE",
      completedAt: row.completedAt,
    };
  });
  return { status: "ok", items, counts: data.counts, truncated: data.truncated };
}
