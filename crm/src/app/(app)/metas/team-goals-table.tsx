import { formatCentsToBRL, formatDate } from "@/lib/format";
import { GoalRiskBadge } from "@/components/badges";
import { GoalRowActions } from "./goal-row-actions";
import type { GoalCardProgress } from "./goal-progress-card";
import type { GoalType } from "@/lib/goal-rules";

interface Row {
  goal: {
    id: string;
    type: GoalType;
    targetValueCents: number | null;
    targetSalesCount: number | null;
    startDate: Date;
    endDate: Date;
    seller: { name: string; sellerProfile: { displayName: string | null } | null };
  };
  progress: GoalCardProgress;
}

export function TeamGoalsTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400">Nenhuma meta ativa no momento.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Vendedor</th>
            <th className="px-3 py-2 font-medium">Meta</th>
            <th className="px-3 py-2 font-medium">Progresso</th>
            <th className="px-3 py-2 font-medium">Falta</th>
            <th className="px-3 py-2 font-medium">Dias restantes</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(({ goal, progress }) => {
            const isRevenue = goal.type === "REVENUE";
            const targetLabel = isRevenue
              ? formatCentsToBRL(goal.targetValueCents ?? 0)
              : `${goal.targetSalesCount} vendas`;
            const remainingLabel = isRevenue ? formatCentsToBRL(progress.remaining) : `${progress.remaining} vendas`;
            return (
              <tr key={goal.id}>
                <td className="px-3 py-2 font-medium text-gray-900">
                  {goal.seller.sellerProfile?.displayName || goal.seller.name}
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {targetLabel}
                  <div className="text-xs text-gray-400">
                    {formatDate(goal.startDate)} — {formatDate(goal.endDate)}
                  </div>
                </td>
                <td className="px-3 py-2 text-gray-900">{Math.round(progress.progressPercent)}%</td>
                <td className="px-3 py-2 text-gray-600">{remainingLabel}</td>
                <td className="px-3 py-2 text-gray-600">{progress.daysRemaining}</td>
                <td className="px-3 py-2">
                  <GoalRiskBadge status={progress.riskStatus} />
                </td>
                <td className="px-3 py-2">
                  <GoalRowActions id={goal.id} type={goal.type} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
