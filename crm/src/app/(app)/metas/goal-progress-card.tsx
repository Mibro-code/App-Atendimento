import { formatCentsToBRL, formatDate } from "@/lib/format";
import { GoalRiskBadge } from "@/components/badges";
import type { GoalRiskStatus, GoalType } from "@/lib/goal-rules";

export interface GoalCardData {
  type: GoalType;
  targetValueCents: number | null;
  targetSalesCount: number | null;
  startDate: Date | string;
  endDate: Date | string;
}

export interface GoalCardProgress {
  currentValueCents: number;
  currentSalesCount: number;
  progressPercent: number;
  remaining: number;
  daysRemaining: number;
  riskStatus: GoalRiskStatus;
}

export function GoalProgressCard({
  goal,
  progress,
  title = "Meta atual",
}: {
  goal: GoalCardData;
  progress: GoalCardProgress;
  title?: string;
}) {
  const percent = Math.min(100, Math.max(0, progress.progressPercent));
  const isRevenue = goal.type === "REVENUE";

  const currentLabel = isRevenue ? formatCentsToBRL(progress.currentValueCents) : `${progress.currentSalesCount}`;
  const targetLabel = isRevenue ? formatCentsToBRL(goal.targetValueCents ?? 0) : `${goal.targetSalesCount ?? 0}`;
  const remainingLabel = isRevenue ? formatCentsToBRL(progress.remaining) : `${progress.remaining} vendas`;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <GoalRiskBadge status={progress.riskStatus} />
      </div>

      <div>
        <p className="text-2xl font-semibold text-gray-900">
          {currentLabel}
          {isRevenue ? "" : " vendas"} <span className="text-gray-400 text-lg font-normal">/ {targetLabel}{isRevenue ? "" : " vendas"}</span>
        </p>
        <p className="text-sm text-gray-500 mt-1">{Math.round(progress.progressPercent)}% atingida</p>
      </div>

      <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-gray-400">Faltam</p>
          <p className="font-medium text-gray-900">{progress.riskStatus === "ATINGIDA" ? "Meta concluída" : remainingLabel}</p>
        </div>
        <div>
          <p className="text-gray-400">Dias restantes</p>
          <p className="font-medium text-gray-900">{progress.daysRemaining}</p>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Período: {formatDate(goal.startDate)} — {formatDate(goal.endDate)}
      </p>
    </div>
  );
}
