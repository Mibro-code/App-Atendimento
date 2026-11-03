import "server-only";
import { prisma } from "@/lib/prisma";
import { computeGoalProgress } from "@/lib/goals";
import { formatCentsToBRL } from "@/lib/format";
import { notifyOnce } from "@/lib/notifications";

/**
 * Varre TODAS as metas ACTIVE do sistema (não só as do usuário logado) e
 * decide, para cada uma: atingiu 100% -> ACHIEVED; passou do prazo sem
 * atingir -> EXPIRED; entrou na janela de aviso -> GOAL_WARNING. Chamado de
 * forma "pull" (sem cron/worker) em qualquer carregamento de página
 * autenticada relevante, no mesmo padrão de
 * syncAutomaticFollowUpsForScope/lib/automatic-followups.ts — mas aqui sem
 * filtro de escopo, porque o vendedor e o supervisor precisam do aviso
 * mesmo que só um dos dois abra o app primeiro.
 *
 * Idempotência em duas camadas:
 *  1) uma vez que o status muda (ACHIEVED/EXPIRED), a meta some do filtro
 *     `status: "ACTIVE"` do próximo sync — nunca reprocessada.
 *  2) mesmo assim, cada notificação usa uma dedupeKey única (ver
 *     notifyOnce) — protege contra duas execuções concorrentes do sync.
 */
export async function syncGoalAlerts(now: Date = new Date()): Promise<void> {
  const activeGoals = await prisma.salesGoal.findMany({
    where: { status: "ACTIVE" },
    include: {
      seller: {
        select: {
          id: true,
          name: true,
          supervisorId: true,
          sellerProfile: { select: { displayName: true } },
        },
      },
    },
  });

  for (const goal of activeGoals) {
    const progress = await computeGoalProgress(goal, now);
    const sellerName = goal.seller.sellerProfile?.displayName || goal.seller.name;
    const supervisorId = goal.seller.supervisorId;
    const percent = Math.round(progress.progressPercent);
    const remainingLabel =
      goal.type === "REVENUE" ? formatCentsToBRL(progress.remaining) : `${progress.remaining} vendas`;

    if (progress.progressPercent >= 100) {
      const targetLabel =
        goal.type === "REVENUE" ? formatCentsToBRL(goal.targetValueCents ?? 0) : `${goal.targetSalesCount} vendas`;

      await prisma.salesGoal.update({
        where: { id: goal.id },
        data: { status: "ACHIEVED", achievedAt: now, achievedNotifiedAt: now },
      });

      await notifyOnce({
        recipientId: goal.sellerId,
        type: "GOAL_ACHIEVED",
        title: "Meta atingida!",
        message: `Você atingiu 100% da meta de ${targetLabel}.`,
        goalId: goal.id,
        dedupeKey: `goal-achieved:${goal.id}:seller`,
      });
      if (supervisorId) {
        await notifyOnce({
          recipientId: supervisorId,
          type: "GOAL_ACHIEVED",
          title: "Meta atingida",
          message: `${sellerName} atingiu 100% da meta de ${targetLabel}.`,
          goalId: goal.id,
          dedupeKey: `goal-achieved:${goal.id}:supervisor`,
        });
      }
      continue;
    }

    if (now.getTime() > goal.endDate.getTime()) {
      await prisma.salesGoal.update({
        where: { id: goal.id },
        data: { status: "EXPIRED", expiredNotifiedAt: now },
      });

      await notifyOnce({
        recipientId: goal.sellerId,
        type: "GOAL_EXPIRED",
        title: "Meta expirada",
        message: `O prazo da sua meta terminou. Você atingiu ${percent}%.`,
        goalId: goal.id,
        dedupeKey: `goal-expired:${goal.id}:seller`,
      });
      if (supervisorId) {
        await notifyOnce({
          recipientId: supervisorId,
          type: "GOAL_EXPIRED",
          title: "Meta expirada",
          message: `A meta de ${sellerName} expirou com ${percent}% atingido.`,
          goalId: goal.id,
          dedupeKey: `goal-expired:${goal.id}:supervisor`,
        });
      }
      continue;
    }

    if (progress.riskStatus === "ATENCAO" && !goal.warningNotifiedAt) {
      await prisma.salesGoal.update({ where: { id: goal.id }, data: { warningNotifiedAt: now } });

      await notifyOnce({
        recipientId: goal.sellerId,
        type: "GOAL_WARNING",
        title: "Meta perto do prazo",
        message: `Faltam ${progress.daysRemaining} dias para o fim da sua meta. Você atingiu ${percent}%. Faltam ${remainingLabel} para alcançar 100%.`,
        goalId: goal.id,
        dedupeKey: `goal-warning:${goal.id}:seller`,
      });
      if (supervisorId) {
        await notifyOnce({
          recipientId: supervisorId,
          type: "GOAL_WARNING",
          title: "Meta perto do prazo",
          message: `${sellerName} está com ${percent}% da meta. Faltam ${remainingLabel} e ${progress.daysRemaining} dias para o prazo.`,
          goalId: goal.id,
          dedupeKey: `goal-warning:${goal.id}:supervisor`,
        });
      }
    }
  }
}
