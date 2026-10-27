import { NextRequest, NextResponse } from "next/server";
import { requireSession, forbidden, notFound } from "@/lib/api-auth";
import { getSupervisorDashboard, getTeamMemberCustomers, normalizeDashboardFilters } from "@/lib/supervisor-analytics";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "SUPERVISOR" && user.role !== "ADMIN") return forbidden("Acesso restrito.");
  const { id } = await params;
  const query = req.nextUrl.searchParams;
  const filters = normalizeDashboardFilters({ period: query.get("period"), brand: query.get("brand"), from: query.get("from"), to: query.get("to") });
  const [dashboard, customers] = await Promise.all([
    getSupervisorDashboard(user, { ...filters, teamType: "all" }, id),
    getTeamMemberCustomers(user, id),
  ]);
  if (!dashboard || !customers) return notFound("Profissional não encontrado na sua equipe.");
  return NextResponse.json({ ...dashboard, customers });
}
