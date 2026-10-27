import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest, forbidden, notFound } from "@/lib/api-auth";
import { canManageGoalForSeller } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { resolvePeriodDates, type GoalPeriodPreset } from "@/lib/goal-rules";

// Edição só é permitida enquanto a meta está ACTIVE — uma vez ACHIEVED,
// EXPIRED ou CANCELLED ela vira histórico imutável (nunca reaberta aqui).
const updateSchema = z
  .object({
    type: z.enum(["REVENUE", "SALES_COUNT"]).optional(),
    targetValueCents: z.number().int().positive().optional(),
    targetSalesCount: z.number().int().positive().optional(),
    periodPreset: z.enum(["7", "15", "30", "custom"]).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    status: z.enum(["CANCELLED"]).optional(),
  })
  .refine((data) => data.periodPreset !== "custom" || (!!data.startDate && !!data.endDate), {
    message: "Período personalizado exige data inicial e final.",
  });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role === "VENDEDOR" || user.role === "REPRESENTANTE") return forbidden("Este perfil não pode alterar metas.");

  const goal = await prisma.salesGoal.findUnique({ where: { id } });
  if (!goal) return notFound("Meta não encontrada.");
  if (!(await canManageGoalForSeller(user, goal.sellerId))) {
    return forbidden("Você não pode editar meta de vendedor de outra equipe.");
  }
  if (goal.status !== "ACTIVE") {
    return badRequest(`Meta com status "${goal.status}" não pode mais ser editada.`);
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const data = parsed.data;

  if (data.status === "CANCELLED") {
    const updated = await prisma.salesGoal.update({ where: { id }, data: { status: "CANCELLED" } });
    await logAudit({ actorId: user.id, action: "GOAL_UPDATED", entityType: "SalesGoal", entityId: id, metadata: { status: "CANCELLED" } });
    return NextResponse.json({ goal: updated });
  }

  const type = data.type ?? goal.type;
  const targetValueCents =
    type === "REVENUE" ? (data.targetValueCents ?? goal.targetValueCents) : null;
  const targetSalesCount =
    type === "SALES_COUNT" ? (data.targetSalesCount ?? goal.targetSalesCount) : null;
  if (type === "REVENUE" && !targetValueCents) return badRequest("Informe o valor da meta.");
  if (type === "SALES_COUNT" && !targetSalesCount) return badRequest("Informe a quantidade de vendas da meta.");

  let period = { startDate: goal.startDate, endDate: goal.endDate };
  if (data.periodPreset) {
    try {
      period = resolvePeriodDates(
        data.periodPreset as GoalPeriodPreset,
        data.periodPreset === "custom" ? { startDate: new Date(data.startDate!), endDate: new Date(data.endDate!) } : null
      );
    } catch (e) {
      return badRequest(e instanceof Error ? e.message : "Período inválido.");
    }
  }

  // Período/alvo mudou: limpa o marcador de aviso já enviado para que a
  // janela "próximo do prazo" possa disparar de novo sob as novas regras —
  // nunca herdar um "já avisei" de antes da edição.
  const updated = await prisma.salesGoal.update({
    where: { id },
    data: {
      type,
      targetValueCents,
      targetSalesCount,
      startDate: period.startDate,
      endDate: period.endDate,
      warningNotifiedAt: null,
    },
  });

  await logAudit({
    actorId: user.id,
    action: "GOAL_UPDATED",
    entityType: "SalesGoal",
    entityId: id,
    metadata: { type, targetValueCents, targetSalesCount, startDate: period.startDate.toISOString(), endDate: period.endDate.toISOString() },
  });

  return NextResponse.json({ goal: updated });
}
