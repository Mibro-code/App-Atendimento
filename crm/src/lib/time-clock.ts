import { BRAZIL_TIME_ZONE } from "./format";
import { EXPECTED_CLOCK_OUT_TIME } from "./config";

export { BRAZIL_TIME_ZONE };

export const timeClockEventValues = [
  "CLOCK_IN",
  "LUNCH_START",
  "LUNCH_END",
  "CLOCK_OUT",
] as const;

export type TimeClockEventValue = (typeof timeClockEventValues)[number];

export const TIME_CLOCK_EVENT_LABELS: Record<TimeClockEventValue, string> = {
  CLOCK_IN: "Entrada",
  LUNCH_START: "Saída para almoço",
  LUNCH_END: "Volta do almoço",
  CLOCK_OUT: "Saída do trabalho",
};

export const TIME_CLOCK_EVENT_MINUTE_FIELDS: Record<TimeClockEventValue, "start" | "lunchStart" | "lunchEnd" | "end"> = {
  CLOCK_IN: "start",
  LUNCH_START: "lunchStart",
  LUNCH_END: "lunchEnd",
  CLOCK_OUT: "end",
};

export interface TimeClockReminderSettings {
  enabled: boolean;
  requiredEvents: TimeClockEventValue[];
  workingDays: number[];
  start: number;
  lunchStart: number;
  lunchEnd: number;
  end: number;
  intervalMinutes: number;
}

export function getBrazilClockParts(now = new Date()): { weekday: number; minutes: number; dateKey: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BRAZIL_TIME_ZONE,
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdays[values.weekday] ?? 0,
    minutes: Number(values.hour) % 24 * 60 + Number(values.minute),
    dateKey: `${values.year}-${values.month}-${values.day}`,
  };
}

export function getDueTimeClockReminder(
  settings: TimeClockReminderSettings,
  registeredEvents: TimeClockEventValue[],
  now = new Date()
): { eventType: TimeClockEventValue; dueMinutes: number; overdueMinutes: number; dateKey: string } | null {
  if (!settings.enabled) return null;
  const current = getBrazilClockParts(now);
  if (!settings.workingDays.includes(current.weekday) || registeredEvents.includes("CLOCK_OUT")) return null;
  const registered = new Set(registeredEvents);
  const latestRegisteredIndex = Math.max(-1, ...registeredEvents.map((eventType) => timeClockEventValues.indexOf(eventType)));
  for (const [eventIndex, eventType] of timeClockEventValues.entries()) {
    // Uma marcação posterior feita no app encerra os lembretes de etapas
    // anteriores que podem ter sido registradas no relógio do escritório.
    if (eventIndex < latestRegisteredIndex) continue;
    if (!settings.requiredEvents.includes(eventType) || registered.has(eventType)) continue;
    const dueMinutes = settings[TIME_CLOCK_EVENT_MINUTE_FIELDS[eventType]];
    if (current.minutes >= dueMinutes) return { eventType, dueMinutes, overdueMinutes: current.minutes - dueMinutes, dateKey: current.dateKey };
    return null;
  }
  return null;
}

export function formatClockMinutes(minutes: number): string {
  const normalized = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

/** Retorna a data civil brasileira sem depender do fuso do servidor/Docker. */
export function getBrazilWorkDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/** Prisma/Postgres DATE: meia-noite UTC representa somente a data civil. */
export function getBrazilWorkDate(now = new Date()): Date {
  return new Date(`${getBrazilWorkDateKey(now)}T00:00:00.000Z`);
}

export function canUseTimeClock(role: string): boolean {
  return role === "VENDEDOR" || role === "SUPERVISOR";
}

// ---------------------------------------------------------------------------
// Saída antecipada
// ---------------------------------------------------------------------------

// `workDate` já é meia-noite UTC representando a data civil de São Paulo (ver
// getBrazilWorkDate acima) — por isso extraímos a chave direto via
// toISOString() em vez de reformatar pelo fuso de novo (isso subtrairia 3h e
// voltaria para o dia anterior). O Brasil não tem mais horário de verão desde
// 2019, então "-03:00" fixo é seguro para qualquer data que o sistema trate.
export function getExpectedClockOutAt(workDate: Date): Date {
  const workDateKey = workDate.toISOString().slice(0, 10);
  const [hh, mm] = EXPECTED_CLOCK_OUT_TIME.split(":");
  const hhStr = (hh || "18").padStart(2, "0");
  const mmStr = (mm || "00").padStart(2, "0");
  return new Date(`${workDateKey}T${hhStr}:${mmStr}:00.000-03:00`);
}

/** Servidor nunca confia em flag do cliente — sempre recalcula. */
export function isEarlyDeparture(occurredAt: Date, workDate: Date): boolean {
  return occurredAt.getTime() < getExpectedClockOutAt(workDate).getTime();
}

// ---------------------------------------------------------------------------
// Resumo diário — função pura, usada na tela do vendedor ("próxima ação") e
// nas tabelas de supervisor/admin.
// ---------------------------------------------------------------------------

export interface TimeClockEntryLike {
  eventType: TimeClockEventValue;
  occurredAt: Date | string;
}

export type DailyTimeClockStatus = "NOT_STARTED" | "WORKING" | "ON_BREAK" | "FINISHED" | "INCOMPLETE";

export interface DailyTimeClockSummary {
  clockIn: Date | null;
  lunchStart: Date | null;
  lunchEnd: Date | null;
  clockOut: Date | null;
  workedMinutes: number;
  status: DailyTimeClockStatus;
  /** Próxima ação sugerida (sequência entrada→intervalo→retorno→saída). Nulo quando o dia terminou ou já passou. */
  nextAction: TimeClockEventValue | null;
}

export function computeDailySummary(
  entries: TimeClockEntryLike[],
  options: { workDate?: Date; now?: Date } = {}
): DailyTimeClockSummary {
  const byType = new Map<TimeClockEventValue, Date>();
  for (const entry of entries) {
    byType.set(entry.eventType, typeof entry.occurredAt === "string" ? new Date(entry.occurredAt) : entry.occurredAt);
  }
  const clockIn = byType.get("CLOCK_IN") ?? null;
  const lunchStart = byType.get("LUNCH_START") ?? null;
  const lunchEnd = byType.get("LUNCH_END") ?? null;
  const clockOut = byType.get("CLOCK_OUT") ?? null;

  const now = options.now ?? new Date();
  // `workDate` já é meia-noite UTC representando a data civil de São Paulo —
  // comparar a chave direto (toISOString) em vez de reformatar pelo fuso de
  // novo (getBrazilWorkDateKey), que subtrairia 3h e voltaria um dia.
  const isPastDay = options.workDate ? options.workDate.toISOString().slice(0, 10) < getBrazilWorkDateKey(now) : false;

  let status: DailyTimeClockStatus;
  let nextAction: TimeClockEventValue | null;
  if (clockOut) {
    status = "FINISHED";
    nextAction = null;
  } else if (lunchStart && !lunchEnd) {
    status = isPastDay ? "INCOMPLETE" : "ON_BREAK";
    nextAction = isPastDay ? null : "LUNCH_END";
  } else if (clockIn || lunchEnd) {
    status = isPastDay ? "INCOMPLETE" : "WORKING";
    nextAction = isPastDay ? null : lunchStart || lunchEnd ? "CLOCK_OUT" : "LUNCH_START";
  } else {
    status = isPastDay ? "INCOMPLETE" : "NOT_STARTED";
    nextAction = isPastDay ? null : "CLOCK_IN";
  }

  const segmentMinutes = (start: Date | null, end: Date | null): number => {
    if (!start) return 0;
    const effectiveEnd = end ?? (isPastDay ? null : now);
    if (!effectiveEnd) return 0;
    return Math.max(0, Math.round((effectiveEnd.getTime() - start.getTime()) / 60000));
  };

  let workedMinutes = segmentMinutes(clockIn, lunchStart ?? clockOut);
  if (lunchEnd) workedMinutes += segmentMinutes(lunchEnd, clockOut);

  return { clockIn, lunchStart, lunchEnd, clockOut, workedMinutes, status, nextAction };
}
