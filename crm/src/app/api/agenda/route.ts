import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, requireSession, validationFailed } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import {
  APPOINTMENT_SELECT,
  canAssignAppointmentTo,
  canEditAppointment,
  canLinkCustomer,
  findAppointmentConflicts,
  getAgendaViewer,
  getAppointmentScopeFilter,
  myAppointmentsFilter,
  toAppointmentDTO,
  validateParticipants,
} from "@/lib/agenda";
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  MAX_RANGE_DAYS,
  isDateKey,
  toDateKey,
  zonedDate,
  type AppointmentStatusValue,
  type AppointmentTypeValue,
} from "@/lib/agenda-rules";
import { parseAppointmentInput } from "@/lib/agenda-validation";
import { searchDigits } from "@/lib/format";

const RANGE_LIMIT = 500;
const LIST_PAGE_SIZE = 50;

/**
 * Lista compromissos. Dois modos:
 * - Período (Hoje/Semana/Mês): `from` e `to` (YYYY-MM-DD, `to` exclusivo),
 *   no máximo MAX_RANGE_DAYS — nunca carrega a agenda inteira.
 * - Lista (`list=1`): a partir de `from` (padrão: hoje) + pendentes
 *   atrasados, paginado (`page`).
 * `scope=mine` (padrão) traz os atribuídos ao usuário e os eventos
 * compartilhados com ele; `scope=team` aplica o escopo de RBAC (supervisor:
 * equipe; admin: todos) e aceita filtros extras.
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const params = req.nextUrl.searchParams;

  const teamScope = params.get("scope") === "team" && (user.role === "SUPERVISOR" || user.role === "ADMIN");
  const assignedToId = params.get("assignedToId")?.trim() || null;
  const assigneeRole = params.get("assigneeRole");
  const type = APPOINTMENT_TYPES.find((value) => value === params.get("type")) as AppointmentTypeValue | undefined;
  const status = APPOINTMENT_STATUSES.find((value) => value === params.get("status")) as AppointmentStatusValue | undefined;
  const customerId = params.get("customerId")?.trim() || null;
  const q = params.get("q")?.trim().slice(0, 100) || "";
  const listMode = params.get("list") === "1";

  const viewer = await getAgendaViewer(user);
  if (assignedToId && !canEditAppointment(viewer, assignedToId)) {
    return forbidden("Responsável fora do seu escopo.");
  }

  const and: Prisma.AppointmentWhereInput[] = [
    teamScope ? await getAppointmentScopeFilter(user) : myAppointmentsFilter(user.id),
  ];
  if (teamScope && assignedToId) and.push(myAppointmentsFilter(assignedToId));
  if (teamScope && (assigneeRole === "VENDEDOR" || assigneeRole === "REPRESENTANTE")) {
    and.push({ assignedTo: { role: assigneeRole } });
  }
  if (type) and.push({ type });
  if (status) and.push({ status });
  if (customerId) and.push({ customerId });
  if (q) {
    const digits = searchDigits(q);
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { customer: { contactName: { contains: q, mode: "insensitive" } } },
        { customer: { tradeName: { contains: q, mode: "insensitive" } } },
        { customer: { legalName: { contains: q, mode: "insensitive" } } },
        ...(digits
          ? [{ customer: { cnpjDigits: { contains: digits } } }, { customer: { cpfDigits: { contains: digits } } }]
          : []),
      ],
    });
  }

  if (listMode) {
    const fromKey = isDateKey(params.get("from")) ? params.get("from")! : toDateKey(new Date());
    const toKey = isDateKey(params.get("to")) ? params.get("to")! : null;
    const page = Math.max(0, Math.min(200, Number(params.get("page")) || 0));
    const from = zonedDate(fromKey);
    and.push({
      OR: [
        { startsAt: { gte: from, ...(toKey ? { lt: zonedDate(toKey) } : {}) } },
        // Atrasados continuam aparecendo no topo da lista até serem resolvidos.
        ...(status && status !== "PENDENTE" ? [] : [{ status: "PENDENTE" as const, startsAt: { lt: from } }]),
      ],
    });
    const rows = await prisma.appointment.findMany({
      where: { AND: and },
      select: APPOINTMENT_SELECT,
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      skip: page * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE + 1,
    });
    return NextResponse.json({
      appointments: rows.slice(0, LIST_PAGE_SIZE).map((row) => toAppointmentDTO(row, viewer)),
      hasMore: rows.length > LIST_PAGE_SIZE,
      page,
    });
  }

  const fromKey = params.get("from");
  const toKey = params.get("to");
  if (!isDateKey(fromKey) || !isDateKey(toKey) || toKey <= fromKey) {
    return badRequest("Informe um período válido (from/to).");
  }
  const from = zonedDate(fromKey);
  const to = zonedDate(toKey);
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    return badRequest(`O período máximo é de ${MAX_RANGE_DAYS} dias.`);
  }
  and.push({ startsAt: { gte: from, lt: to } });

  const rows = await prisma.appointment.findMany({
    where: { AND: and },
    select: APPOINTMENT_SELECT,
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: RANGE_LIMIT,
  });
  return NextResponse.json({ appointments: rows.map((row) => toAppointmentDTO(row, viewer)), truncated: rows.length === RANGE_LIMIT });
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = parseAppointmentInput(body);
  if (!parsed.ok) return validationFailed(parsed.fieldErrors);
  const data = parsed.data;

  const assignedToId = data.assignedToId || user.id;
  if (!(await canAssignAppointmentTo(user, assignedToId))) {
    return validationFailed({ assignedToId: "Você não pode criar compromissos para este responsável." });
  }
  if (data.customerId && !(await canLinkCustomer(user, data.customerId))) {
    return validationFailed({ customerId: "Cliente não encontrado na sua carteira." });
  }
  const participants = await validateParticipants(user, data.participantIds, assignedToId);
  if (!participants.ok) return validationFailed({ participantIds: participants.error });

  if (!data.confirmConflicts) {
    const conflicts = await findAppointmentConflicts(assignedToId, data);
    if (conflicts.length > 0) {
      return NextResponse.json(
        {
          code: "CONFLICT",
          error: assignedToId === user.id
            ? "Você já possui um compromisso próximo deste horário."
            : "O responsável já possui um compromisso próximo deste horário.",
          conflicts,
        },
        { status: 409 }
      );
    }
  }

  const created = await prisma.appointment.create({
    data: {
      title: data.title,
      description: data.description,
      type: data.type,
      priority: data.priority,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      allDay: data.allDay,
      reminderMinutes: data.reminderMinutes,
      assignedToId,
      createdById: user.id,
      customerId: data.customerId,
      color: data.color,
      participants: { create: participants.ids.map((userId) => ({ userId })) },
    },
    select: APPOINTMENT_SELECT,
  });

  await logAudit({
    actorId: user.id,
    action: "APPOINTMENT_CREATED",
    entityType: "Appointment",
    entityId: created.id,
    metadata: {
      type: data.type,
      startsAt: data.startsAt.toISOString(),
      assignedToId,
      customerId: data.customerId,
      participantIds: participants.ids,
    },
  });

  return NextResponse.json({ appointment: toAppointmentDTO(created, await getAgendaViewer(user)) }, { status: 201 });
}
