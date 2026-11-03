import "server-only";
import { prisma } from "@/lib/prisma";
import {
  computeGoalProgressPercent,
  computeGoalRemaining,
  computeGoalRiskStatus,
  daysRemaining as computeDaysRemaining,
  type GoalLifecycleStatus,
  type GoalRiskStatus,
  type GoalType,
} from "@/lib/goal-rules";

export interface GoalLike {
  type: GoalType;
  targetValueCents: number | null;
  targetSalesCount: number | null;
  startDate: Date;
  endDate: Date;
  status: GoalLifecycleStatus;
  sellerId: string;
}

export interface GoalProgress {
  currentValueCents: number;
  currentSalesCount: number;
  progressPercent: number;
  remaining: number; // em centavos (REVENUE) ou unidades (SALES_COUNT)
  daysRemaining: number;
  riskStatus: GoalRiskStatus;
}

/**
 * Soma/conta só vendas CONFIRMADAS (Sale.stage === "PAGAMENTO_CONFIRMADO")
 * do vendedor, dentro do período da meta (por confirmedAt, não createdAt —
 * uma venda só entra na meta quando de fato confirmada). NUNCA considera
 * Quote (simulação nem cotação real ainda não convertida em pedido) e nunca
 * conta Sale cancelado, pois esses nunca têm esse stage.
 */
export async function getGoalSalesAggregate(
  sellerId: string,
  startDate: Date,
  endDate: Date
): Promise<{ valueCents: number; count: number }> {
  const [agg, count] = await Promise.all([
    prisma.sale.aggregate({
      where: {
        sellerId,
        stage: "PAGAMENTO_CONFIRMADO",
        confirmedAt: { gte: startDate, lte: endDate },
      },
      _sum: { valueCents: true },
    }),
    prisma.sale.count({
      where: {
        sellerId,
        stage: "PAGAMENTO_CONFIRMADO",
        confirmedAt: { gte: startDate, lte: endDate },
      },
    }),
  ]);
  return { valueCents: agg._sum.valueCents ?? 0, count };
}

export async function computeGoalProgress(goal: GoalLike, now: Date = new Date()): Promise<GoalProgress> {
  const { valueCents, count } = await getGoalSalesAggregate(goal.sellerId, goal.startDate, goal.endDate);
  const input = {
    type: goal.type,
    targetValueCents: goal.targetValueCents,
    targetSalesCount: goal.targetSalesCount,
    currentValueCents: valueCents,
    currentSalesCount: count,
  };
  const progressPercent = computeGoalProgressPercent(input);
  const remaining = computeGoalRemaining(input);
  const riskStatus = computeGoalRiskStatus({
    progressPercent,
    lifecycleStatus: goal.status,
    startDate: goal.startDate,
    endDate: goal.endDate,
    now,
  });

  return {
    currentValueCents: valueCents,
    currentSalesCount: count,
    progressPercent,
    remaining,
    daysRemaining: computeDaysRemaining(goal.endDate, now),
    riskStatus,
  };
}
