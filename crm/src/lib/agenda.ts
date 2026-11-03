import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canAccessCustomer, getVisibleSellerIds, type SessionUser } from "@/lib/authz";
import {
  addDaysToKey,
  colorForUser,
  effectiveEnd,
  toDateKey,
  zonedDate,
  type AppointmentDTO,
  type AppointmentTiming,
} from "@/lib/agenda-rules";

/**
 * Quem o usuário "enxerga" na Agenda, calculado uma vez por requisição e
 * reaproveitando a mesma regra de equipe do resto do RBAC
 * (getVisibleSellerIds): ADMIN = todos (null); SUPERVISOR = ele + a própria
 * equipe; VENDEDOR/REPRESENTANTE = só ele.
 */
export interface AgendaViewer {
  id: string;
  visible: string[] | null;
}

export async function getAgendaViewer(user: SessionUser): Promise<AgendaViewer> {
  return { id: user.id, visible: await getVisibleSellerIds(user) };
}

/**
 * Escopo de LEITURA: compromissos cujo responsável está no escopo do
 * usuário, ou eventos compartilhados com alguém do escopo (participante).
 * Filtros vindos da tela são sempre combinados com este escopo via AND.
 */
export async function getAppointmentScopeFilter(user: SessionUser): Promise<Prisma.AppointmentWhereInput> {
  const visible = await getVisibleSellerIds(user);
  if (visible === null) return {};
  return { OR: [{ assignedToId: { in: visible } }, { participants: { some: { userId: { in: visible } } } }] };
}

/** "Minha agenda": atribuídos a mim + eventos compartilhados comigo. */
export function myAppointmentsFilter(userId: string): Prisma.AppointmentWhereInput {
  return { OR: [{ assignedToId: userId }, { participants: { some: { userId } } }] };
}

/**
 * Escopo de ESCRITA (editar, concluir, cancelar, reagendar): sempre pelo
 * responsável. Participante de evento compartilhado só visualiza.
 */
export function canEditAppointment(viewer: AgendaViewer, assignedToId: string): boolean {
  return viewer.visible === null || viewer.visible.includes(assignedToId);
}

export async function canAccessAppointment(user: SessionUser, assignedToId: string): Promise<boolean> {
  return canEditAppointment(await getAgendaViewer(user), assignedToId);
}

export function canViewAppointment(viewer: AgendaViewer, assignedToId: string, participantIds: string[]): boolean {
  if (canEditAppointment(viewer, assignedToId)) return true;
  return participantIds.some((id) => id === viewer.id || viewer.visible?.includes(id));
}

/**
 * Para quem o usuário pode criar/atribuir compromissos. Vendedor e
 * representante: só para si. Supervisor: para si e para membros ativos da
 * própria equipe. Admin: qualquer usuário ativo (mesmo acesso administrativo
 * do restante do sistema).
 */
export async function canAssignAppointmentTo(user: SessionUser, targetId: string): Promise<boolean> {
  if (targetId === user.id) return true;
  if (user.role === "VENDEDOR" || user.role === "REPRESENTANTE") return false;
  const target = await prisma.user.findFirst({
    where: { id: targetId, active: true, deletedAt: null },
    select: { supervisorId: true },
  });
  if (!target) return false;
  if (user.role === "ADMIN") return true;
  return target.supervisorId === user.id;
}

/**
 * Participantes de evento compartilhado seguem a mesma regra de atribuição
 * (supervisor: a própria equipe; admin: qualquer usuário ativo; vendedor: só
 * ele mesmo). O responsável é removido da lista (já vê o evento).
 */
export async function validateParticipants(
  user: SessionUser,
  participantIds: string[],
  assignedToId: string
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const ids = [...new Set(participantIds)].filter((id) => id !== assignedToId);
  if (ids.length === 0) return { ok: true, ids };
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, active: true, deletedAt: null },
    select: { id: true, supervisorId: true },
  });
  const allowed = users.filter((target) =>
    target.id === user.id || user.role === "ADMIN" || (user.role === "SUPERVISOR" && target.supervisorId === user.id)
  );
  if (allowed.length !== ids.length) {
    return { ok: false, error: "Você só pode compartilhar com pessoas da sua equipe." };
  }
  return { ok: true, ids };
}

/** Cliente só pode ser vinculado se estiver na carteira visível ao usuário. */
export async function canLinkCustomer(user: SessionUser, customerId: string): Promise<boolean> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { sellerId: true } });
  return !!customer && (await canAccessCustomer(user, customer.sellerId));
}

export const APPOINTMENT_SELECT = {
  id: true,
  title: true,
  description: true,
  type: true,
  status: true,
  priority: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  reminderMinutes: true,
  reminderDismissedAt: true,
  color: true,
  completedAt: true,
  cancelledAt: true,
  createdAt: true,
  assignedTo: { select: { id: true, name: true, role: true, sellerProfile: { select: { displayName: true } } } },
  createdBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
  customer: { select: { id: true, contactName: true, tradeName: true, legalName: true } },
  participants: {
    select: { user: { select: { id: true, name: true, sellerProfile: { select: { displayName: true } } } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.AppointmentSelect;

type AppointmentRow = Prisma.AppointmentGetPayload<{ select: typeof APPOINTMENT_SELECT }>;

export function toAppointmentDTO(row: AppointmentRow, viewer: AgendaViewer): AppointmentDTO {
  const assigneeColor = colorForUser(row.assignedTo.id);
  const canEdit = canEditAppointment(viewer, row.assignedTo.id);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    status: row.status,
    priority: row.priority,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    allDay: row.allDay,
    reminderMinutes: row.reminderMinutes,
    reminderDismissedAt: row.reminderDismissedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    assignedTo: {
      id: row.assignedTo.id,
      name: row.assignedTo.sellerProfile?.displayName || row.assignedTo.name,
      role: row.assignedTo.role,
      color: assigneeColor,
    },
    createdBy: row.createdBy,
    completedBy: row.completedBy,
    customer: row.customer
      ? {
          id: row.customer.id,
          name: row.customer.tradeName || row.customer.contactName,
          company: row.customer.legalName,
        }
      : null,
    color: row.color ?? assigneeColor,
    customColor: row.color,
    participants: row.participants.map(({ user }) => ({ id: user.id, name: user.sellerProfile?.displayName || user.name })),
    canEdit,
    sharedWithMe: !canEdit,
  };
}

/**
 * Compromissos pendentes do mesmo responsável que se sobrepõem ao intervalo
 * informado. Busca só uma janela curta ao redor do horário (nunca a agenda
 * inteira) e decide a sobreposição com a regra pura `overlaps`.
 */
export async function findAppointmentConflicts(
  assignedToId: string,
  timing: AppointmentTiming,
  excludeId?: string
): Promise<Array<{ id: string; title: string; startsAt: string; endsAt: string | null }>> {
  if (timing.allDay) return [];
  const start = new Date(timing.startsAt);
  const end = effectiveEnd(timing);
  const candidates = await prisma.appointment.findMany({
    where: {
      assignedToId,
      status: "PENDENTE",
      allDay: false,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      // Janela de 1 dia antes cobre compromissos longos que começaram antes.
      startsAt: { gte: new Date(start.getTime() - 86_400_000), lt: end },
    },
    select: { id: true, title: true, startsAt: true, endsAt: true, allDay: true },
    orderBy: { startsAt: "asc" },
    take: 20,
  });
  return candidates
    .filter((item) => item.startsAt < end && start < effectiveEnd(item))
    .map((item) => ({
      id: item.id,
      title: item.title,
      startsAt: item.startsAt.toISOString(),
      endsAt: item.endsAt?.toISOString() ?? null,
    }));
}

/** Pendentes de hoje (São Paulo) do próprio usuário (inclui compartilhados) — badge do menu. */
export async function countTodayPendingAppointments(userId: string, now = new Date()): Promise<number> {
  const todayKey = toDateKey(now);
  return prisma.appointment.count({
    where: {
      ...myAppointmentsFilter(userId),
      status: "PENDENTE",
      startsAt: { gte: zonedDate(todayKey), lt: zonedDate(addDaysToKey(todayKey, 1)) },
    },
  });
}
