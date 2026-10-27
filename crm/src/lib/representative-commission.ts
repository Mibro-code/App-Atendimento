export const REPRESENTATIVE_COMMISSION_PERCENT = 1;
export const REPRESENTATIVE_COMMISSION_BPS = 100;

export function calculateRepresentativeCommissionCents(salesValueCents: number): number {
  if (!Number.isFinite(salesValueCents) || salesValueCents <= 0) return 0;
  return Math.round(salesValueCents * REPRESENTATIVE_COMMISSION_PERCENT / 100);
}

export interface CommissionPlanLike {
  brand: "MIBRO" | "SINCROFIT" | null;
  rateBps: number;
  startDate: Date;
  endDate: Date | null;
}

/**
 * Percentual (bps) do plano do representante vigente na data. Sem plano
 * registrado retorna null: nenhum percentual é presumido.
 */
export function commissionRateForSale(plans: CommissionPlanLike[], brand: "MIBRO" | "SINCROFIT" | null, confirmedAt: Date): number | null {
  const applicable = plans
    .filter((plan) => plan.startDate <= confirmedAt && (!plan.endDate || plan.endDate > confirmedAt) && (plan.brand === brand || plan.brand === null))
    .sort((a, b) => Number(b.brand !== null) - Number(a.brand !== null) || b.startDate.getTime() - a.startDate.getTime());
  return applicable[0]?.rateBps ?? null;
}

export type CommissionOrigin = "PEDIDO" | "PLANO" | "TIPO";

export interface ResolvedCommission {
  rateBps: number | null;
  source: "CUSTOM_ORDER" | "DEFAULT" | null;
  origin: CommissionOrigin | null;
}

/**
 * Prioridade: comissão específica do pedido (CUSTOM_ORDER) > plano individual
 * do representante > padrão do tipo (ex.: VAREJO 5%). Sem nenhum deles, a
 * comissão fica em branco ("a definir").
 */
export function resolveSaleCommission(input: {
  customRateBps?: number | null;
  plans: CommissionPlanLike[];
  typeDefaultBps?: number | null;
  brand: "MIBRO" | "SINCROFIT" | null;
  at: Date;
}): ResolvedCommission {
  if (input.customRateBps !== null && input.customRateBps !== undefined) {
    return { rateBps: input.customRateBps, source: "CUSTOM_ORDER", origin: "PEDIDO" };
  }
  const planRate = commissionRateForSale(input.plans, input.brand, input.at);
  if (planRate !== null) return { rateBps: planRate, source: "DEFAULT", origin: "PLANO" };
  if (input.typeDefaultBps !== null && input.typeDefaultBps !== undefined) {
    return { rateBps: input.typeDefaultBps, source: "DEFAULT", origin: "TIPO" };
  }
  return { rateBps: null, source: null, origin: null };
}

export function commissionCentsFor(valueCents: number, rateBps: number | null): number | null {
  if (rateBps === null || !Number.isFinite(valueCents) || valueCents <= 0) return rateBps === null ? null : 0;
  return Math.round(valueCents * rateBps / 10_000);
}

export function formatCommissionPercent(rateBps: number | null | undefined): string {
  if (rateBps === null || rateBps === undefined) return "A definir";
  return `${(rateBps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/** Status exibido da comissão, derivado do estágio da venda (não há controle de pagamento). */
export function commissionStatusLabel(sale: { stage: string; confirmedAt: Date | null }, rateBps: number | null): string {
  if (sale.stage === "CANCELADO") return "Cancelada";
  if (rateBps === null) return "A definir";
  return sale.confirmedAt ? "Confirmada" : "Prevista";
}

export function calculateCommissionForSales(
  sales: Array<{ valueCents: number; confirmedAt: Date; brand: "MIBRO" | "SINCROFIT" | null; customRateBps?: number | null }>,
  plans: CommissionPlanLike[],
  typeDefaultBps: number | null = null
): number {
  return sales.reduce((total, sale) => {
    const { rateBps } = resolveSaleCommission({ customRateBps: sale.customRateBps, plans, typeDefaultBps, brand: sale.brand, at: sale.confirmedAt });
    return total + (commissionCentsFor(sale.valueCents, rateBps) ?? 0);
  }, 0);
}

export function getBrazilMonthRange(month?: string): {
  month: string;
  start: Date;
  end: Date;
  previousMonth: string;
  nextMonth: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const currentBrazilMonth = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
  const selected = /^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? "") ? month! : currentBrazilMonth;
  const [year, monthNumber] = selected.split("-").map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonthNumber = monthNumber === 12 ? 1 : monthNumber + 1;
  const previousYear = monthNumber === 1 ? year - 1 : year;
  const previousMonthNumber = monthNumber === 1 ? 12 : monthNumber - 1;
  const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

  return {
    month: selected,
    start: new Date(`${selected}-01T00:00:00-03:00`),
    end: new Date(`${key(nextYear, nextMonthNumber)}-01T00:00:00-03:00`),
    previousMonth: key(previousYear, previousMonthNumber),
    nextMonth: key(nextYear, nextMonthNumber),
  };
}
