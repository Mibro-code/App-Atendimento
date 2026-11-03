import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { addDashboardDays as addDays, dashboardDateKey as dateKey, dashboardPercentChange as percentChange, resolveDashboardPeriod, type BrandFilter, type DashboardFilters, type TeamType } from "@/lib/supervisor-dashboard-rules";
import { getBrazilWorkDateKey } from "@/lib/time-clock";
export { normalizeDashboardFilters } from "@/lib/supervisor-dashboard-rules";

const hourFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false });
const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

async function teamMembersFor(actor: SessionUser, teamType: TeamType, memberId?: string) {
  if (actor.role !== "SUPERVISOR" && actor.role !== "ADMIN") return [];
  const roleWhere: Prisma.EnumRoleFilter = teamType === "all" ? { in: ["VENDEDOR", "REPRESENTANTE"] } : { equals: teamType };
  return prisma.user.findMany({
    where: {
      role: roleWhere,
      deletedAt: null,
      ...(actor.role === "SUPERVISOR" ? { supervisorId: actor.id } : {}),
      ...(memberId ? { id: memberId } : {}),
    },
    select: {
      id: true, name: true, role: true, active: true, createdAt: true,
      sellerProfile: { select: { displayName: true, avatarUrl: true, jobTitle: true, region: true } },
    },
    orderBy: { name: "asc" },
  });
}

function brandWhere(brand: BrandFilter): Prisma.SaleWhereInput {
  return brand === "all" ? {} : { olistOrder: { is: { brand } } };
}

export async function getSupervisorDashboard(actor: SessionUser, filters: DashboardFilters, memberId?: string) {
  const period = resolveDashboardPeriod(filters);
  const members = await teamMembersFor(actor, filters.teamType, memberId);
  const memberIds = members.map((member) => member.id);
  if (memberId && members.length === 0) return null;
  const operationalSellerIds = actor.role === "SUPERVISOR" && !memberId
    ? [actor.id, ...memberIds]
    : memberIds;

  const salesWhere: Prisma.SaleWhereInput = {
    sellerId: { in: memberIds }, stage: "PAGAMENTO_CONFIRMADO", confirmedAt: { gte: period.previousStart, lte: period.end }, ...brandWhere(filters.brand),
  };
  const todayKey=getBrazilWorkDateKey();
  const todayStart=new Date(`${todayKey}T00:00:00-03:00`);
  const todayEnd=new Date(`${todayKey}T23:59:59.999-03:00`);
  const quoteBrandWhere = { deletedAt: null, ...(filters.brand === "all" ? {} : { brand: filters.brand }) };
  const orderBrandWhere=filters.brand === "all" ? {} : { brand:filters.brand };
  const [sales, customerCounts, goals, openQuotes, dailyOrders, supervisorSettings] = await Promise.all([
    memberIds.length ? prisma.sale.findMany({
      where: salesWhere,
      select: {
        id: true, sellerId: true, valueCents: true, confirmedAt: true,
        customer: { select: { id: true, contactName: true, tradeName: true, legalName: true, phoneDigits: true, status: true, temperature: true, lastInteractionAt: true, lastSaleAt: true } },
        olistOrder: { select: { brand: true, orderNumber: true, olistOrderId: true, crmStatus: true } },
      },
      orderBy: { confirmedAt: "desc" },
    }) : Promise.resolve([]),
    memberIds.length ? prisma.customer.groupBy({ by: ["sellerId"], where: { sellerId: { in: memberIds } }, _count: { _all: true } }) : Promise.resolve([]),
    memberIds.length ? prisma.salesGoal.findMany({
      where: { sellerId: { in: memberIds }, status: { in: ["ACTIVE", "ACHIEVED", "EXPIRED"] }, startDate: { lte: period.end }, endDate: { gte: period.start } },
      orderBy: { startDate: "desc" },
    }) : Promise.resolve([]),
    operationalSellerIds.length ? prisma.quote.count({where:{sellerId:{in:operationalSellerIds},status:{in:["ABERTA","CALCULADA","ENVIADA","ENVIADA_PARA_ANALISE"]},createdAt:{gte:period.start,lte:period.end},...quoteBrandWhere}}):Promise.resolve(0),
    operationalSellerIds.length ? prisma.olistOrder.findMany({where:{customer:{sellerId:{in:operationalSellerIds}},createdAt:{gte:todayStart,lte:todayEnd},...orderBrandWhere},select:{id:true,brand:true,orderNumber:true,olistOrderId:true,valueCents:true,crmStatus:true,followUpStatus:true,createdAt:true,customer:{select:{id:true,contactName:true,tradeName:true,seller:{select:{id:true,name:true,sellerProfile:{select:{displayName:true}}}}}},followUpNotifiedAt:true,followUpResolvedAt:true},orderBy:{createdAt:"desc"}}):Promise.resolve([]),
    actor.role === "SUPERVISOR" ? prisma.user.findUnique({where:{id:actor.id},select:{orderFollowUpAssignee:{select:{id:true,name:true,sellerProfile:{select:{displayName:true}}}}}}):Promise.resolve(null),
  ]);

  const currentSales = sales.filter((sale) => sale.confirmedAt && sale.confirmedAt >= period.start);
  const previousSales = sales.filter((sale) => sale.confirmedAt && sale.confirmedAt <= period.previousEnd);
  const totalValueCents = currentSales.reduce((sum, sale) => sum + sale.valueCents, 0);
  const previousValueCents = previousSales.reduce((sum, sale) => sum + sale.valueCents, 0);
  const goalBySeller = new Map<string, (typeof goals)[number]>();
  goals.forEach((goal) => { if (!goalBySeller.has(goal.sellerId)) goalBySeller.set(goal.sellerId, goal); });
  const customersBySeller = new Map(customerCounts.map((row) => [row.sellerId, row._count._all]));
  const salesBySeller = new Map<string, typeof currentSales>();
  for (const sale of currentSales) {
    const sellerSales = salesBySeller.get(sale.sellerId);
    if (sellerSales) sellerSales.push(sale);
    else salesBySeller.set(sale.sellerId, [sale]);
  }

  const team = members.map((member) => {
    const memberSales = salesBySeller.get(member.id) ?? [];
    const salesValueCents = memberSales.reduce((sum, sale) => sum + sale.valueCents, 0);
    const orders = memberSales.length;
    const goal = goalBySeller.get(member.id) ?? null;
    const goalTarget = goal?.type === "REVENUE" ? goal.targetValueCents ?? 0 : goal?.targetSalesCount ?? 0;
    const goalCurrent = goal?.type === "SALES_COUNT" ? orders : salesValueCents;
    const goalPercent = goalTarget > 0 ? (goalCurrent / goalTarget) * 100 : 0;
    return {
      id: member.id,
      name: member.sellerProfile?.displayName || member.name,
      role: member.role,
      active: member.active,
      avatarUrl: member.sellerProfile?.avatarUrl ?? null,
      jobTitle: member.sellerProfile?.jobTitle ?? null,
      region: member.sellerProfile?.region ?? null,
      salesValueCents, orders, averageTicketCents: orders ? Math.round(salesValueCents / orders) : 0,
      customers: customersBySeller.get(member.id) ?? 0,
      goal: goal ? { id: goal.id, type: goal.type, target: goalTarget, current: goalCurrent, percent: goalPercent, startDate: goal.startDate.toISOString(), endDate: goal.endDate.toISOString(), status: goal.status } : null,
    };
  }).sort((a, b) => b.salesValueCents - a.salesValueCents);

  const revenueGoals = team.filter((item) => item.goal?.type === "REVENUE");
  const teamGoalTargetCents = revenueGoals.reduce((sum, item) => sum + (item.goal?.target ?? 0), 0);
  const teamGoalCurrentCents = revenueGoals.reduce((sum, item) => sum + item.salesValueCents, 0);

  const trendMap = new Map<string, number>();
  const isToday = filters.period === "today";
  const isYear = filters.period === "year";
  for (const sale of currentSales) {
    const when = sale.confirmedAt!;
    const key = isToday
      ? hourFormatter.format(when)
      : isYear ? dateKey(when).slice(0, 7) : dateKey(when);
    trendMap.set(key, (trendMap.get(key) ?? 0) + sale.valueCents);
  }
  const trend: Array<{ key: string; label: string; valueCents: number }> = [];
  if (isToday) {
    for (let hour = 0; hour < 24; hour += 1) { const key = String(hour).padStart(2, "0"); trend.push({ key, label: `${key}h`, valueCents: trendMap.get(key) ?? 0 }); }
  } else if (isYear) {
    for (let month = 1; month <= 12; month += 1) { const key = `${period.fromKey.slice(0, 4)}-${String(month).padStart(2, "0")}`; trend.push({ key, label: monthFormatter.format(new Date(`${key}-15T12:00:00Z`)), valueCents: trendMap.get(key) ?? 0 }); }
  } else {
    for (let key = period.fromKey; key <= period.toKey; key = addDays(key, 1)) trend.push({ key, label: key.slice(8, 10) + "/" + key.slice(5, 7), valueCents: trendMap.get(key) ?? 0 });
  }

  return {
    filters,
    period: { from: period.fromKey, to: period.toKey },
    summary: {
      totalValueCents, orders: currentSales.length, openQuotes, averageTicketCents: currentSales.length ? Math.round(totalValueCents / currentSales.length) : 0,
      salesChangePercent: percentChange(totalValueCents, previousValueCents),
      ordersChangePercent: percentChange(currentSales.length, previousSales.length),
      teamGoalTargetCents, teamGoalCurrentCents, teamGoalPercent: teamGoalTargetCents ? (teamGoalCurrentCents / teamGoalTargetCents) * 100 : 0,
    },
    team,
    trend,
    orderFollowUpAssignee:supervisorSettings?.orderFollowUpAssignee ? {id:supervisorSettings.orderFollowUpAssignee.id,name:supervisorSettings.orderFollowUpAssignee.sellerProfile?.displayName||supervisorSettings.orderFollowUpAssignee.name}:null,
    dailyOrders:dailyOrders.map((order)=>({
      id:order.id,brand:order.brand,number:order.orderNumber||order.olistOrderId,valueCents:order.valueCents,status:order.crmStatus,followUpStatus:order.followUpStatus,createdAt:order.createdAt.toISOString(),
      customer:{id:order.customer.id,name:order.customer.tradeName||order.customer.contactName},seller:{id:order.customer.seller.id,name:order.customer.seller.sellerProfile?.displayName||order.customer.seller.name},
      notifiedAt:order.followUpNotifiedAt?.toISOString()??null,resolvedAt:order.followUpResolvedAt?.toISOString()??null,
    })),
    recentSales: currentSales.slice(0, 20).map((sale) => ({
      id: sale.id, valueCents: sale.valueCents, confirmedAt: sale.confirmedAt!.toISOString(),
      customer: sale.customer, brand: sale.olistOrder?.brand ?? null,
      orderNumber: sale.olistOrder?.orderNumber || sale.olistOrder?.olistOrderId || null,
      status: sale.olistOrder?.crmStatus ?? "PAGAMENTO_CONFIRMADO",
    })),
  };
}

export async function getTeamMemberCustomers(actor: SessionUser, memberId: string) {
  const allowed = await teamMembersFor(actor, "all", memberId);
  if (!allowed.length) return null;
  return prisma.customer.findMany({
    where: { sellerId: memberId },
    select: { id: true, contactName: true, tradeName: true, legalName: true, phoneDigits: true, businessType: true, temperature: true, status: true, lastInteractionAt: true, lastSaleAt: true },
    orderBy: { updatedAt: "desc" }, take: 50,
  });
}
