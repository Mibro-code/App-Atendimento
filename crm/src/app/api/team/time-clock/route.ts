import { NextRequest, NextResponse } from "next/server";
import { requireSession, forbidden } from "@/lib/api-auth";
import { getVisibleSellerIds } from "@/lib/authz";
import { getBrazilWorkDate } from "@/lib/time-clock";
import { getTimeClockOverview } from "@/lib/time-clock-overview";
import { applyFilters, buildCards, flattenRows } from "@/lib/time-clock-rows";
import { prisma } from "@/lib/prisma";

// Visão de ponto da EQUIPE do supervisor logado — escopo sempre resolvido no
// servidor via getVisibleSellerIds (nunca substituído por um parâmetro do
// cliente; um ?userId= vira filtro adicional "AND"-ado por cima do escopo).
export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "SUPERVISOR") return forbidden("Disponível somente para supervisores.");

  const scopeUserIds = await getVisibleSellerIds(user); // nunca null para SUPERVISOR
  const sp = req.nextUrl.searchParams;
  const targetUserId = sp.get("userId") || undefined;
  if (targetUserId && scopeUserIds && !scopeUserIds.includes(targetUserId)) {
    return forbidden("Este vendedor não faz parte da sua equipe.");
  }

  const { from, to } = parsePeriod(sp);
  const today = getBrazilWorkDate();

  const [overview, todayOverview, pendingOccurrences] = await Promise.all([
    getTimeClockOverview({ scopeUserIds, userId: targetUserId, from, to }),
    getTimeClockOverview({ scopeUserIds, from: today, to: today }),
    prisma.occurrence.count({ where: { userId: { in: scopeUserIds ?? [] }, status: "PENDING" } }),
  ]);

  const rows = flattenRows(overview);
  const filteredRows = applyFilters(rows, sp);
  const cards = buildCards(todayOverview, pendingOccurrences);

  return NextResponse.json({ rows: filteredRows, cards, period: { from: from.toISOString(), to: to.toISOString() } });
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
