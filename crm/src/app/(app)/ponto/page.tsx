import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canUseTimeClock, getBrazilWorkDate } from "@/lib/time-clock";
import { getTimeClockOverview } from "@/lib/time-clock-overview";
import { PontoHistory } from "./ponto-history";
import { OccurrencesPanel } from "./occurrences-panel";

function monthRangeFromParam(monthParam: string | undefined): { from: Date; to: Date; monthKey: string } {
  const key = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : getBrazilWorkDate().toISOString().slice(0, 7);
  const from = new Date(`${key}-01T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  to.setUTCDate(to.getUTCDate() - 1);
  return { from, to, monthKey: key };
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export default async function PontoPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; ocorrencia?: string }>;
}) {
  const session = await auth();
  if (!canUseTimeClock(session!.user.role)) redirect("/dashboard");

  const { month, ocorrencia } = await searchParams;
  const { from, to, monthKey } = monthRangeFromParam(month);

  const [overview, occurrences] = await Promise.all([
    getTimeClockOverview({ scopeUserIds: [session!.user.id], userId: session!.user.id, from, to }),
    prisma.occurrence.findMany({
      where: { userId: session!.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, type: true, occurrenceDate: true, description: true, status: true,
        reviewNote: true, createdAt: true,
        documents: { select: { id: true, fileName: true, mimeType: true, uploadedAt: true } },
      },
    }),
  ]);

  const days = overview[0]?.days ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Meu ponto</h1>
          <p className="text-sm text-gray-500 mt-1">Histórico completo, horas trabalhadas e ocorrências.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/ponto?month=${shiftMonth(monthKey, -1)}`} className="btn-secondary px-3 py-1.5">‹</Link>
          <span className="font-medium text-gray-700">{monthKey}</span>
          <Link href={`/ponto?month=${shiftMonth(monthKey, 1)}`} className="btn-secondary px-3 py-1.5">›</Link>
        </div>
      </div>

      <PontoHistory
        days={days.map((d) => ({
          workDate: d.workDate,
          summary: {
            ...d.summary,
            clockIn: d.summary.clockIn?.toISOString() ?? null,
            lunchStart: d.summary.lunchStart?.toISOString() ?? null,
            lunchEnd: d.summary.lunchEnd?.toISOString() ?? null,
            clockOut: d.summary.clockOut?.toISOString() ?? null,
          },
          entries: d.entries.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
          earlyDeparture: d.earlyDeparture
            ? { ...d.earlyDeparture, expectedAt: d.earlyDeparture.expectedAt.toISOString(), actualAt: d.earlyDeparture.actualAt.toISOString() }
            : null,
        }))}
      />

      <OccurrencesPanel
        initialType={ocorrencia}
        occurrences={occurrences.map((o) => ({
          ...o,
          occurrenceDate: o.occurrenceDate.toISOString(),
          createdAt: o.createdAt.toISOString(),
          documents: o.documents.map((doc) => ({ ...doc, uploadedAt: doc.uploadedAt.toISOString() })),
        }))}
      />
    </div>
  );
}
