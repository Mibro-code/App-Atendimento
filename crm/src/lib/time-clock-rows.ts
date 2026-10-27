import "server-only";
import type { getTimeClockOverview } from "@/lib/time-clock-overview";

// Extraído de src/app/api/team/time-clock/route.ts para um módulo de lib:
// route.ts do App Router só pode exportar handlers HTTP (GET/POST/...) e
// alguns campos de config — qualquer outro export quebra o build do Next.
export function flattenRows(overview: Awaited<ReturnType<typeof getTimeClockOverview>>) {
  return overview.flatMap((u) => u.days.map((d) => ({ userId: u.userId, name: u.name, ...d })));
}

export function applyFilters<T extends { summary: { status: string }; earlyDeparture: unknown; occurrences: { type: string; documents: unknown[] }[] }>(
  rows: T[],
  sp: URLSearchParams
): T[] {
  const late = sp.get("late") === "true";
  const earlyDeparture = sp.get("earlyDeparture") === "true";
  const incomplete = sp.get("incomplete") === "true";
  const withJustification = sp.get("withJustification") === "true";
  const withDocuments = sp.get("withDocuments") === "true";

  return rows.filter((row) => {
    if (late && !row.occurrences.some((o) => o.type === "ATRASO")) return false;
    if (earlyDeparture && !row.earlyDeparture) return false;
    if (incomplete && row.summary.status !== "INCOMPLETE") return false;
    if (withJustification && row.occurrences.length === 0) return false;
    if (withDocuments && !row.occurrences.some((o) => o.documents.length > 0)) return false;
    return true;
  });
}

export function buildCards(
  todayOverview: Awaited<ReturnType<typeof getTimeClockOverview>>,
  pendingOccurrences: number
) {
  let presentesHoje = 0;
  let aindaNaoEntraram = 0;
  let atrasados = 0;
  let saidasAntecipadas = 0;

  for (const user of todayOverview) {
    const today = user.days[0];
    if (!today) {
      aindaNaoEntraram++;
      continue;
    }
    if (today.summary.status === "WORKING" || today.summary.status === "ON_BREAK") presentesHoje++;
    if (today.summary.status === "NOT_STARTED") aindaNaoEntraram++;
    if (today.occurrences.some((o) => o.type === "ATRASO")) atrasados++;
    if (today.earlyDeparture) saidasAntecipadas++;
  }

  return {
    presentesHoje,
    aindaNaoEntraram,
    atrasados,
    saidasAntecipadas,
    justificativasPendentes: pendingOccurrences,
  };
}
