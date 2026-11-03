// Regras puras de meta de venda (sem acesso a banco) — cálculo de progresso,
// prazo e janela de aviso. Mantido separado de lib/goals.ts (que faz as
// queries) para poder testar sem Prisma, no mesmo padrão de
// followup-rules.ts / lib/automatic-followups.ts.

const DAY_MS = 24 * 60 * 60 * 1000;

export type GoalPeriodPreset = "7" | "15" | "30" | "custom";

export interface GoalPeriod {
  startDate: Date;
  endDate: Date;
}

export function periodDays(period: GoalPeriod): number {
  return Math.max(1, Math.round((period.endDate.getTime() - period.startDate.getTime()) / DAY_MS));
}

/**
 * Janela de aviso "próximo do prazo", proporcional ao tamanho do período.
 * Validada exatamente contra os três exemplos do pedido:
 *   30 dias -> avisar faltando 7 dias
 *   15 dias -> avisar faltando 4 dias
 *   7  dias -> avisar faltando 2 dias
 * Math.round(dias * 0.24) reproduz os três casos (7.2->7, 3.6->4, 1.68->2).
 * Períodos personalizados usam a mesma fórmula (regra proporcional
 * equivalente pedida no requisito), com mínimo de 1 dia e nunca maior que o
 * próprio período.
 */
export function warningWindowDays(days: number): number {
  const raw = Math.round(days * 0.24);
  return Math.max(1, Math.min(days, raw));
}

export function daysRemaining(endDate: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / DAY_MS));
}

export function isPastEndDate(endDate: Date, now: Date = new Date()): boolean {
  return now.getTime() > endDate.getTime();
}

export function resolvePeriodDates(
  preset: GoalPeriodPreset,
  custom: { startDate: Date; endDate: Date } | null,
  now: Date = new Date()
): { startDate: Date; endDate: Date } {
  if (preset === "custom") {
    if (!custom) throw new Error("Período personalizado requer data inicial e final.");
    if (custom.endDate.getTime() <= custom.startDate.getTime()) {
      throw new Error("Data final deve ser depois da data inicial.");
    }
    return custom;
  }
  const days = Number(preset);
  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + days);
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

export type GoalType = "REVENUE" | "SALES_COUNT";
export type GoalLifecycleStatus = "ACTIVE" | "ACHIEVED" | "EXPIRED" | "CANCELLED";

// Cinco estados visuais pedidos — texto sempre exibido junto (nunca só cor).
export type GoalRiskStatus = "EM_ANDAMENTO" | "PROXIMO_DA_META" | "ATENCAO" | "ATINGIDA" | "EXPIRADA";

export interface GoalProgressInput {
  type: GoalType;
  targetValueCents: number | null;
  targetSalesCount: number | null;
  currentValueCents: number;
  currentSalesCount: number;
}

export function computeGoalProgressPercent(goal: GoalProgressInput): number {
  if (goal.type === "REVENUE") {
    const target = goal.targetValueCents ?? 0;
    if (target <= 0) return 0;
    return (goal.currentValueCents / target) * 100;
  }
  const target = goal.targetSalesCount ?? 0;
  if (target <= 0) return 0;
  return (goal.currentSalesCount / target) * 100;
}

export function computeGoalRemaining(goal: GoalProgressInput): number {
  if (goal.type === "REVENUE") {
    return Math.max(0, (goal.targetValueCents ?? 0) - goal.currentValueCents);
  }
  return Math.max(0, (goal.targetSalesCount ?? 0) - goal.currentSalesCount);
}

export function computeGoalRiskStatus(params: {
  progressPercent: number;
  lifecycleStatus: GoalLifecycleStatus;
  startDate: Date;
  endDate: Date;
  now?: Date;
}): GoalRiskStatus {
  const now = params.now ?? new Date();

  if (params.lifecycleStatus === "ACHIEVED" || params.progressPercent >= 100) return "ATINGIDA";
  if (params.lifecycleStatus === "EXPIRED" || isPastEndDate(params.endDate, now)) return "EXPIRADA";
  if (params.progressPercent >= 80) return "PROXIMO_DA_META";

  const days = periodDays({ startDate: params.startDate, endDate: params.endDate });
  const window = warningWindowDays(days);
  if (daysRemaining(params.endDate, now) <= window) return "ATENCAO";

  return "EM_ANDAMENTO";
}
