import { formatCentsToBRL, formatDate } from "@/lib/format";
import { GOAL_STATUS_LABELS } from "@/lib/labels";
import type { GoalType } from "@/lib/goal-rules";

interface HistoryGoal {
  id: string;
  type: GoalType;
  targetValueCents: number | null;
  targetSalesCount: number | null;
  startDate: Date;
  endDate: Date;
  status: string;
  achievedAt: Date | null;
}

export function GoalHistoryList({ goals }: { goals: HistoryGoal[] }) {
  if (goals.length === 0) return <p className="text-sm text-gray-400">Nenhuma meta anterior.</p>;

  return (
    <ul className="divide-y divide-gray-100">
      {goals.map((g) => {
        const targetLabel = g.type === "REVENUE" ? formatCentsToBRL(g.targetValueCents ?? 0) : `${g.targetSalesCount} vendas`;
        return (
          <li key={g.id} className="py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-gray-900">{targetLabel}</p>
              <span className="text-xs text-gray-500">{GOAL_STATUS_LABELS[g.status] ?? g.status}</span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatDate(g.startDate)} — {formatDate(g.endDate)}
              {g.achievedAt ? ` · atingida em ${formatDate(g.achievedAt)}` : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
