import { NextRequest, NextResponse } from "next/server";
import { requireSession, forbidden } from "@/lib/api-auth";
import { getBrazilWorkDate } from "@/lib/time-clock";
import { getTimeClockOverview } from "@/lib/time-clock-overview";
import { applyFilters, buildCards, flattenRows } from "@/lib/time-clock-rows";
import { prisma } from "@/lib/prisma";

// Mesma visão de /api/team/time-clock, mas sem restrição de equipe (ADMIN
// only) — com filtro opcional por supervisor/vendedor específico.
export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "ADMIN") return forbidden("Disponível somente para administradores.");

  const sp = req.nextUrl.searchParams;
  const targetUserId = sp.get("userId") || undefined;
  const supervisorId = sp.get("supervisorId") || undefined;

  let scopeUserIds: string[] | null = null;
  if (supervisorId) {
    const team = await prisma.user.findMany({ where: { supervisorId }, select: { id: true } });
    scopeUserIds = [supervisorId, ...team.map((t) => t.id)];
  }

  const { from, to } = parsePeriod(sp);
  const today = getBrazilWorkDate();

  const [overview, todayOverview, pendingOccurrences] = await Promise.all([
    getTimeClockOverview({ scopeUserIds, userId: targetUserId, from, to }),
    getTimeClockOverview({ scopeUserIds, from: today, to: today }),
    prisma.occurrence.count({
      where: { status: "PENDING", ...(scopeUserIds ? { userId: { in: scopeUserIds } } : {}) },
    }),
  ]);

  const rows = flattenRows(overview);
  const filteredRows = applyFilters(rows, sp);
  const cards = buildCards(todayOverview, pendingOccurrences);

  const supervisors = await prisma.user.findMany({
    where: { role: "SUPERVISOR", active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    rows: filteredRows,
    cards,
    supervisors,
    period: { from: from.toISOString(), to: to.toISOString() },
  });
}

function parsePeriod(sp: URLSearchParams): { from: Date; to: Date } {
  const fromParam = sp.get("from");
  const toParam = sp.get("to");
  if (fromParam && toParam) {
    const from = new Date(`${fromParam}T00:00:00.000Z`);
    const to = new Date(`${toParam}T00:00:00.000Z`);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) return { from, to };
  }
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = getBrazilWorkDate(now);
  return { from, to };
}
