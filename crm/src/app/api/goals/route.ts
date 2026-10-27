import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest, forbidden } from "@/lib/api-auth";
import { canManageGoalForSeller, getVisibleSellerIds } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { resolvePeriodDates, type GoalPeriodPreset } from "@/lib/goal-rules";
import { syncGoalAlerts } from "@/lib/goal-alerts";
import { computeGoalProgress } from "@/lib/goals";

const createSchema = z
  .object({
    sellerId: z.string().min(1),
    type: z.enum(["REVENUE", "SALES_COUNT"]),
    targetValueCents: z.number().int().positive().optional(),
    targetSalesCount: z.number().int().positive().optional(),
    periodPreset: z.enum(["7", "15", "30", "custom"]),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  })
  .refine((data) => (data.type === "REVENUE" ? !!data.targetValueCents : !!data.targetSalesCount), {
    message: "Informe o valor da meta (REVENUE) ou a quantidade de vendas (SALES_COUNT), de acordo com o tipo.",
  })
  .refine((data) => data.periodPreset !== "custom" || (!!data.startDate && !!data.endDate), {
    message: "Período personalizado exige data inicial e final.",
  });

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role === "REPRESENTANTE") return forbidden("Representantes não possuem metas.");

  await syncGoalAlerts();

  const sellerIdFilter = req.nextUrl.searchParams.get("sellerId");
  const visible = await getVisibleSellerIds(user);
  const scopeWhere =
    visible === null
      ? {}
      : { sellerId: { in: visible } };

  if (sellerIdFilter && visible !== null && !visible.includes(sellerIdFilter)) {
    return forbidden();
  }

  const goals = await prisma.salesGoal.findMany({
    where: { ...scopeWhere, ...(sellerIdFilter ? { sellerId: sellerIdFilter } : {}) },
    include: {
      seller: { select: { id: true, name: true, sellerProfile: { select: { displayName: true } } } },
    },
    orderBy: [{ status: "asc" }, { endDate: "desc" }],
  });

  const goalsWithProgress = await Promise.all(
    goals.map(async (goal) => ({ goal, progress: await computeGoalProgress(goal) }))
  );

  return NextResponse.json({ goals: goalsWithProgress });
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role === "VENDEDOR" || user.role === "REPRESENTANTE") return forbidden("Este perfil não pode criar metas.");

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const data = parsed.data;

  if (!(await canManageGoalForSeller(user, data.sellerId))) {
    return forbidden("Você não pode criar meta para um vendedor de outra equipe.");
  }

  const seller = await prisma.user.findUnique({
    where: { id: data.sellerId },
    select: { id: true, active: true, role: true },
  });
  if (!seller || !seller.active || seller.role !== "VENDEDOR") {
    return badRequest("Vendedor inválido ou inativo.");
  }

  let period: { startDate: Date; endDate: Date };
  try {
    period = resolvePeriodDates(
      data.periodPreset as GoalPeriodPreset,
      data.periodPreset === "custom" ? { startDate: new Date(data.startDate!), endDate: new Date(data.endDate!) } : null
    );
  } catch (e) {
    return badRequest(e instanceof Error ? e.message : "Período inválido.");
  }

  const goal = await prisma.salesGoal.create({
    data: {
      sellerId: data.sellerId,
      createdById: user.id,
      type: data.type,
      targetValueCents: data.type === "REVENUE" ? data.targetValueCents : null,
      targetSalesCount: data.type === "SALES_COUNT" ? data.targetSalesCount : null,
      startDate: period.startDate,
      endDate: period.endDate,
    },
  });

  await logAudit({
    actorId: user.id,
    action: "GOAL_CREATED",
    entityType: "SalesGoal",
    entityId: goal.id,
    metadata: {
      sellerId: data.sellerId,
      type: data.type,
      targetValueCents: goal.targetValueCents,
      targetSalesCount: goal.targetSalesCount,
      startDate: goal.startDate.toISOString(),
      endDate: goal.endDate.toISOString(),
    },
  });

  return NextResponse.json({ goal }, { status: 201 });
}
