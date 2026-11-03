import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound, requireSession, validationFailed } from "@/lib/api-auth";
import { logAudit, type AuditAction } from "@/lib/audit";
import {
  APPOINTMENT_SELECT,
  canAssignAppointmentTo,
  canEditAppointment,
  canLinkCustomer,
  canViewAppointment,
  findAppointmentConflicts,
  getAgendaViewer,
  toAppointmentDTO,
  validateParticipants,
} from "@/lib/agenda";
import { parseAppointmentInput, parseRescheduleInput } from "@/lib/agenda-validation";

/**
 * Leitura: responsável no escopo do usuário OU evento compartilhado com ele
 * (ou com alguém do escopo). Escrita: só o escopo do responsável — o
 * participante de um evento compartilhado apenas visualiza.
 */
async function loadAccessible(id: string, mode: "view" | "edit") {
  const { user, error } = await requireSession();
  if (error) return { error } as const;
  const current = await prisma.appointment.findUnique({ where: { id }, include: { participants: { select: { userId: true } } } });
  if (!current) return { error: notFound("Compromisso não encontrado.") } as const;
  const viewer = await getAgendaViewer(user);
  const participantIds = current.participants.map((participant) => participant.userId);
  const allowed = mode === "edit"
    ? canEditAppointment(viewer, current.assignedToId)
    : canViewAppointment(viewer, current.assignedToId, participantIds);
  if (!allowed) {
    return { error: forbidden(mode === "edit" && canViewAppointment(viewer, current.assignedToId, participantIds)
      ? "Evento compartilhado: somente o responsável pode alterar."
      : undefined) } as const;
  }
  return { user, viewer, current, participantIds, error: null } as const;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadAccessible(id, "view");
  if (loaded.error) return loaded.error;
  const row = await prisma.appointment.findUniqueOrThrow({ where: { id }, select: APPOINTMENT_SELECT });
  return NextResponse.json({ appointment: toAppointmentDTO(row, loaded.viewer) });
}

const actionSchema = z.object({
  action: z.enum(["UPDATE", "RESCHEDULE", "COMPLETE", "REOPEN", "CANCEL", "DISMISS_REMINDER"]),
});

function conflictResponse(isSelf: boolean, conflicts: unknown[]) {
  return NextResponse.json(
    {
      code: "CONFLICT",
      error: isSelf
        ? "Você já possui um compromisso próximo deste horário."
        : "O responsável já possui um compromisso próximo deste horário.",
      conflicts,
    },
    { status: 409 }
  );
}

/**
 * Todas as mudanças passam por aqui, identificadas por `action`. Não existe
 * exclusão definitiva: "Cancelar" mantém o registro com status CANCELADO
 * (histórico e auditoria preservados).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadAccessible(id, "edit");
  if (loaded.error) return loaded.error;
  const { user, viewer, current, participantIds } = loaded;

  const body = await req.json().catch(() => null);
  const parsedAction = actionSchema.safeParse(body);
  if (!parsedAction.success) return badRequest("Ação inválida.");
  const { action } = parsedAction.data;

  const now = new Date();
  let data: Prisma.AppointmentUncheckedUpdateInput;
  const audits: Array<{ action: AuditAction; metadata?: Prisma.InputJsonValue }> = [];

  if (action === "UPDATE") {
    const parsed = parseAppointmentInput(body);
    if (!parsed.ok) return validationFailed(parsed.fieldErrors);
    const input = parsed.data;
    const assignedToId = input.assignedToId || current.assignedToId;
    if (assignedToId !== current.assignedToId && !(await canAssignAppointmentTo(user, assignedToId))) {
      return validationFailed({ assignedToId: "Você não pode atribuir compromissos a este responsável." });
    }
    if (input.customerId && input.customerId !== current.customerId && !(await canLinkCustomer(user, input.customerId))) {
      return validationFailed({ customerId: "Cliente não encontrado na sua carteira." });
    }
    // Só os participantes NOVOS passam pela regra de convite; quem já estava
    // (ex.: incluído por um admin) pode permanecer ou ser removido.
    const nextParticipants = [...new Set(input.participantIds)].filter((userId) => userId !== assignedToId);
    const added = nextParticipants.filter((userId) => !participantIds.includes(userId));
    const addedCheck = await validateParticipants(user, added, assignedToId);
    if (!addedCheck.ok) return validationFailed({ participantIds: addedCheck.error });
    const participantsChanged = added.length > 0 || participantIds.some((userId) => !nextParticipants.includes(userId));
    const timeChanged =
      input.startsAt.getTime() !== current.startsAt.getTime() ||
      (input.endsAt?.getTime() ?? null) !== (current.endsAt?.getTime() ?? null) ||
      input.allDay !== current.allDay;
    if ((timeChanged || assignedToId !== current.assignedToId) && !input.confirmConflicts && current.status === "PENDENTE") {
      const conflicts = await findAppointmentConflicts(assignedToId, input, id);
      if (conflicts.length > 0) return conflictResponse(assignedToId === user.id, conflicts);
    }
    data = {
      title: input.title,
      description: input.description,
      type: input.type,
      priority: input.priority,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      allDay: input.allDay,
      reminderMinutes: input.reminderMinutes,
      customerId: input.customerId,
      assignedToId,
      color: input.color,
      ...(participantsChanged
        ? { participants: { deleteMany: { userId: { notIn: nextParticipants } }, create: added.map((userId) => ({ userId })) } }
        : {}),
      // Novo horário/lembrete = lembrete volta a valer.
      ...(timeChanged || input.reminderMinutes !== current.reminderMinutes ? { reminderDismissedAt: null } : {}),
    };
    audits.push({ action: "APPOINTMENT_UPDATED", ...(participantsChanged ? { metadata: { participantIds: nextParticipants } } : {}) });
    if (timeChanged) {
      audits.push({
        action: "APPOINTMENT_RESCHEDULED",
        metadata: { from: current.startsAt.toISOString(), to: input.startsAt.toISOString() },
      });
    }
    if (assignedToId !== current.assignedToId) {
      audits.push({ action: "APPOINTMENT_REASSIGNED", metadata: { from: current.assignedToId, to: assignedToId } });
    }
  } else if (action === "RESCHEDULE") {
    const parsed = parseRescheduleInput(body);
    if (!parsed.ok) return validationFailed(parsed.fieldErrors);
    const input = parsed.data;
    if (!input.confirmConflicts) {
      const conflicts = await findAppointmentConflicts(current.assignedToId, input, id);
      if (conflicts.length > 0) return conflictResponse(current.assignedToId === user.id, conflicts);
    }
    data = {
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      allDay: input.allDay,
      reminderDismissedAt: null,
      // Reagendar um compromisso concluído/cancelado o traz de volta à agenda.
      status: "PENDENTE",
      completedAt: null,
      completedById: null,
      cancelledAt: null,
      cancelledById: null,
    };
    audits.push({
      action: "APPOINTMENT_RESCHEDULED",
      metadata: { from: current.startsAt.toISOString(), to: input.startsAt.toISOString() },
    });
  } else if (action === "COMPLETE") {
    if (current.status === "CONCLUIDO") return badRequest("Este compromisso já está concluído.");
    data = { status: "CONCLUIDO", completedAt: now, completedById: user.id, cancelledAt: null, cancelledById: null };
    audits.push({ action: "APPOINTMENT_COMPLETED" });
  } else if (action === "REOPEN") {
    if (current.status === "PENDENTE") return badRequest("Este compromisso já está pendente.");
    data = { status: "PENDENTE", completedAt: null, completedById: null, cancelledAt: null, cancelledById: null };
    audits.push({ action: "APPOINTMENT_REOPENED", metadata: { previousStatus: current.status } });
  } else if (action === "CANCEL") {
    if (current.status === "CANCELADO") return badRequest("Este compromisso já está cancelado.");
    data = { status: "CANCELADO", cancelledAt: now, cancelledById: user.id, completedAt: null, completedById: null };
    audits.push({ action: "APPOINTMENT_CANCELLED" });
  } else {
    // Dispensar lembrete é preferência de leitura, não mudança de negócio:
    // não gera auditoria.
    data = { reminderDismissedAt: now };
  }

  const updated = await prisma.appointment.update({ where: { id }, data, select: APPOINTMENT_SELECT });
  for (const audit of audits) {
    await logAudit({
      actorId: user.id,
      action: audit.action,
      entityType: "Appointment",
      entityId: id,
      metadata: audit.metadata,
    });
  }
  return NextResponse.json({ appointment: toAppointmentDTO(updated, viewer) });
}
