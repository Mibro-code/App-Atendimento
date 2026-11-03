import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeDailySummary, type DailyTimeClockSummary, type TimeClockEventValue } from "@/lib/time-clock";

export interface TimeClockOverviewEntry {
  id: string;
  eventType: TimeClockEventValue;
  occurredAt: Date;
  locationStatus: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
}

export interface TimeClockOverviewEarlyDeparture {
  entryId: string;
  reason: string;
  description: string;
  expectedAt: Date;
  actualAt: Date;
}

export interface TimeClockOverviewOccurrence {
  id: string;
  type: string;
  status: string;
  description: string;
  documents: { id: string; fileName: string }[];
}

export interface TimeClockOverviewDay {
  workDate: string; // YYYY-MM-DD
  entries: TimeClockOverviewEntry[];
  summary: DailyTimeClockSummary;
  earlyDeparture: TimeClockOverviewEarlyDeparture | null;
  occurrences: TimeClockOverviewOccurrence[];
}

export interface TimeClockOverviewUser {
  userId: string;
  name: string;
  days: TimeClockOverviewDay[];
}

export interface GetTimeClockOverviewParams {
  /** null = sem restrição (ADMIN sem filtro de equipe). Sempre já resolvido pelo escopo RBAC do caller. */
  scopeUserIds: string[] | null;
  /** Filtro adicional (ex.: um vendedor específico) — sempre aplicado por cima do escopo, nunca no lugar dele. */
  userId?: string;
  from: Date;
  to: Date;
  now?: Date;
}

function workDateKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Monta a visão de ponto (entradas, resumo diário, saída antecipada,
 * ocorrências) por usuário/dia no período. Usada tanto pela rota de
 * supervisor (equipe) quanto pela de admin (todos) — a diferença entre elas
 * é só o `scopeUserIds` resolvido antes de chamar esta função.
 */
export async function getTimeClockOverview(params: GetTimeClockOverviewParams): Promise<TimeClockOverviewUser[]> {
  const userWhere: Prisma.UserWhereInput = {
    role: { in: ["VENDEDOR", "SUPERVISOR"] },
    ...(params.scopeUserIds ? { id: { in: params.scopeUserIds } } : {}),
    ...(params.userId ? { id: params.userId } : {}),
  };

  const users = await prisma.user.findMany({
    where: userWhere,
    select: { id: true, name: true, sellerProfile: { select: { displayName: true } } },
    orderBy: { name: "asc" },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return [];
  const dayAfterTo = new Date(params.to);
  dayAfterTo.setUTCDate(dayAfterTo.getUTCDate() + 1);

  const [entries, earlyDepartures, occurrences] = await Promise.all([
    prisma.timeClockEntry.findMany({
      where: { userId: { in: userIds }, workDate: { gte: params.from, lte: params.to } },
      orderBy: { occurredAt: "asc" },
      select: {
        id: true, userId: true, eventType: true, workDate: true, occurredAt: true,
        locationStatus: true, latitude: true, longitude: true, accuracyMeters: true,
      },
    }),
    prisma.timeClockEarlyDeparture.findMany({
      where: { userId: { in: userIds }, actualAt: { gte: params.from, lt: dayAfterTo } },
      select: { userId: true, entryId: true, reason: true, description: true, expectedAt: true, actualAt: true },
    }),
    prisma.occurrence.findMany({
      where: { userId: { in: userIds }, occurrenceDate: { gte: params.from, lte: params.to } },
      select: {
        id: true, userId: true, type: true, status: true, description: true, occurrenceDate: true,
        documents: { select: { id: true, fileName: true } },
      },
    }),
  ]);

  const earlyDepartureByEntryId = new Map(earlyDepartures.map((ed) => [ed.entryId, ed]));

  // userId -> workDateKey -> entries
  const entriesByUserDay = new Map<string, Map<string, typeof entries>>();
  for (const entry of entries) {
    const dayKey = workDateKeyOf(entry.workDate);
    if (!entriesByUserDay.has(entry.userId)) entriesByUserDay.set(entry.userId, new Map());
    const byDay = entriesByUserDay.get(entry.userId)!;
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey)!.push(entry);
  }

  // userId -> workDateKey -> occurrences
  const occurrencesByUserDay = new Map<string, Map<string, typeof occurrences>>();
  for (const occurrence of occurrences) {
    const dayKey = workDateKeyOf(occurrence.occurrenceDate);
    if (!occurrencesByUserDay.has(occurrence.userId)) occurrencesByUserDay.set(occurrence.userId, new Map());
    const byDay = occurrencesByUserDay.get(occurrence.userId)!;
    if (!byDay.has(dayKey)) byDay.set(dayKey, []);
    byDay.get(dayKey)!.push(occurrence);
  }

  const now = params.now ?? new Date();

  return users.map((user) => {
    const byDay: Map<string, typeof entries> = entriesByUserDay.get(user.id) ?? new Map();
    const occByDay: Map<string, typeof occurrences> = occurrencesByUserDay.get(user.id) ?? new Map();
    const dayKeys = new Set([...byDay.keys(), ...occByDay.keys()]);

    const days: TimeClockOverviewDay[] = Array.from(dayKeys)
      .sort((a, b) => b.localeCompare(a))
      .map((dayKey) => {
        const dayEntries = (byDay.get(dayKey) ?? []).slice().sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
        const summary = computeDailySummary(dayEntries, { workDate: new Date(`${dayKey}T00:00:00.000Z`), now });
        const clockOutEntry = dayEntries.find((e) => e.eventType === "CLOCK_OUT");
        const earlyDeparture = clockOutEntry ? earlyDepartureByEntryId.get(clockOutEntry.id) ?? null : null;

        return {
          workDate: dayKey,
          entries: dayEntries.map((e) => ({
            id: e.id, eventType: e.eventType, occurredAt: e.occurredAt, locationStatus: e.locationStatus,
            latitude: e.latitude, longitude: e.longitude, accuracyMeters: e.accuracyMeters,
          })),
          summary,
          earlyDeparture: earlyDeparture
            ? {
                entryId: earlyDeparture.entryId, reason: earlyDeparture.reason, description: earlyDeparture.description,
                expectedAt: earlyDeparture.expectedAt, actualAt: earlyDeparture.actualAt,
              }
            : null,
          occurrences: (occByDay.get(dayKey) ?? []).map((o) => ({
            id: o.id, type: o.type, status: o.status, description: o.description, documents: o.documents,
          })),
        };
      });

    return { userId: user.id, name: user.sellerProfile?.displayName ?? user.name, days };
  });
}
