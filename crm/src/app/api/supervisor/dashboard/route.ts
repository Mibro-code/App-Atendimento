import { NextRequest, NextResponse } from "next/server";
import { requireSession, forbidden } from "@/lib/api-auth";
import { getSupervisorDashboard, normalizeDashboardFilters } from "@/lib/supervisor-analytics";

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "SUPERVISOR" && user.role !== "ADMIN") return forbidden("Acesso restrito a supervisores e administradores.");
  const params = req.nextUrl.searchParams;
  const filters = normalizeDashboardFilters({
    period: params.get("period"), brand: params.get("brand"), teamType: params.get("teamType"),
    from: params.get("from"), to: params.get("to"),
  });
  return NextResponse.json(await getSupervisorDashboard(user, filters));
}
