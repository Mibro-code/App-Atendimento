// Validação do formulário de compromisso. Pura (sem Prisma) para ser testável;
// a autorização (responsável/cliente dentro do escopo) fica em lib/agenda.ts.
// Sempre devolve erro POR CAMPO, no mesmo formato de `validationFailed`
// (lib/api-auth.ts), para o formulário mostrar a mensagem embaixo do input.

import { z } from "zod";
import {
  APPOINTMENT_PRIORITIES,
  APPOINTMENT_TYPES,
  REMINDER_MINUTES_VALUES,
  isAppointmentColor,
  isDateKey,
  isTimeKey,
  zonedDate,
  type AppointmentPriorityValue,
  type AppointmentTypeValue,
} from "./agenda-rules";

const optionalText = (max: number, message: string) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() || null : value ?? null),
    z.string().max(max, message).nullable()
  );

export const appointmentInputSchema = z.object({
  title: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string({ required_error: "Informe o título.", invalid_type_error: "Informe o título." })
      .min(1, "Informe o título.")
      .max(160, "Use no máximo 160 caracteres.")
  ),
  type: z.enum(APPOINTMENT_TYPES, {
    errorMap: () => ({ message: "Selecione o tipo do compromisso." }),
  }),
  date: z.string({ required_error: "Informe a data.", invalid_type_error: "Informe a data." })
    .refine(isDateKey, "Informe uma data válida."),
  allDay: z.boolean().default(false),
  startTime: optionalText(5, "Horário inválido."),
  endTime: optionalText(5, "Horário inválido."),
  customerId: optionalText(64, "Cliente inválido."),
  assignedToId: optionalText(64, "Responsável inválido."),
  description: optionalText(4000, "Use no máximo 4000 caracteres."),
  priority: z.enum(APPOINTMENT_PRIORITIES, {
    errorMap: () => ({ message: "Prioridade inválida." }),
  }).default("NORMAL"),
  reminderMinutes: z.preprocess(
    (value) => (value === "" || value === undefined ? null : typeof value === "string" ? Number(value) : value),
    z.number().int().nullable().refine(
      (value) => value === null || REMINDER_MINUTES_VALUES.includes(value),
      "Lembrete inválido."
    )
  ),
  color: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toUpperCase() || null : value ?? null),
    z.string().nullable().refine((value) => value === null || isAppointmentColor(value), "Escolha uma cor da paleta.")
  ),
  participantIds: z.array(z.string().min(1).max(64), { invalid_type_error: "Participantes inválidos." })
    .max(50, "No máximo 50 participantes.")
    .default([]),
  confirmConflicts: z.boolean().optional(),
});

export interface ParsedAppointmentInput {
  title: string;
  type: AppointmentTypeValue;
  allDay: boolean;
  startsAt: Date;
  endsAt: Date | null;
  dateKey: string;
  customerId: string | null;
  assignedToId: string | null;
  description: string | null;
  priority: AppointmentPriorityValue;
  reminderMinutes: number | null;
  color: string | null;
  participantIds: string[];
  confirmConflicts: boolean;
}

export type AppointmentInputResult =
  | { ok: true; data: ParsedAppointmentInput }
  | { ok: false; fieldErrors: Record<string, string> };

export function parseAppointmentInput(body: unknown): AppointmentInputResult {
  const parsed = appointmentInputSchema.safeParse(body ?? {});
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "form");
      fieldErrors[field] ??= issue.message;
    }
  }

  // Horários são validados mesmo com outros erros, para o usuário ver todos
  // os problemas de uma vez.
  const raw = (body ?? {}) as Record<string, unknown>;
  const allDay = raw.allDay === true;
  const startTime = typeof raw.startTime === "string" ? raw.startTime.trim() : "";
  const endTime = typeof raw.endTime === "string" ? raw.endTime.trim() : "";
  if (!allDay) {
    if (!startTime) fieldErrors.startTime ??= "Informe o horário inicial.";
    else if (!isTimeKey(startTime)) fieldErrors.startTime ??= "Horário inválido.";
    if (endTime && !isTimeKey(endTime)) fieldErrors.endTime ??= "Horário inválido.";
    else if (endTime && isTimeKey(startTime) && endTime <= startTime) {
      fieldErrors.endTime ??= "O horário final deve ser depois do inicial.";
    }
  }

  if (!parsed.success || Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const data = parsed.data;
  const startsAt = data.allDay ? zonedDate(data.date) : zonedDate(data.date, startTime);
  const endsAt = !data.allDay && endTime ? zonedDate(data.date, endTime) : null;
  return {
    ok: true,
    data: {
      title: data.title,
      type: data.type,
      allDay: data.allDay,
      startsAt,
      endsAt,
      dateKey: data.date,
      customerId: data.customerId,
      assignedToId: data.assignedToId,
      description: data.description,
      priority: data.priority,
      reminderMinutes: data.reminderMinutes,
      color: data.color,
      participantIds: [...new Set(data.participantIds)],
      confirmConflicts: data.confirmConflicts ?? false,
    },
  };
}

/** Reagendar: só data/horários, com as mesmas regras do formulário. */
export function parseRescheduleInput(body: unknown):
  | { ok: true; data: { startsAt: Date; endsAt: Date | null; allDay: boolean; confirmConflicts: boolean } }
  | { ok: false; fieldErrors: Record<string, string> } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const result = parseAppointmentInput({
    title: "-", type: "OUTRO", date: raw.date, allDay: raw.allDay === true,
    startTime: raw.startTime, endTime: raw.endTime, confirmConflicts: raw.confirmConflicts === true,
  });
  if (!result.ok) return result;
  const { startsAt, endsAt, allDay, confirmConflicts } = result.data;
  return { ok: true, data: { startsAt, endsAt, allDay, confirmConflicts } };
}
