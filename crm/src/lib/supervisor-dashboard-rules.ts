import type { CommercialBrand } from "@prisma/client";

export type DashboardPeriod = "today" | "week" | "month" | "30days" | "year" | "custom";
export type TeamType = "all" | "VENDEDOR" | "REPRESENTANTE";
export type BrandFilter = "all" | CommercialBrand;
export interface DashboardFilters { period: DashboardPeriod; brand: BrandFilter; teamType: TeamType; from?: string; to?: string }

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
export function dashboardDateKey(date: Date) {
  const parts = dateFmt.formatToParts(date); const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function addDashboardDays(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
export function normalizeDashboardFilters(input: Partial<Record<string, string | null>>): DashboardFilters {
  const periods: DashboardPeriod[] = ["today", "week", "month", "30days", "year", "custom"];
  const period = periods.includes(input.period as DashboardPeriod) ? input.period as DashboardPeriod : "month";
  const brand: BrandFilter = input.brand === "MIBRO" || input.brand === "SINCROFIT" ? input.brand : "all";
  const teamType: TeamType = input.teamType === "VENDEDOR" || input.teamType === "REPRESENTANTE" ? input.teamType : "all";
  const validDate = (value?: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  return { period, brand, teamType, from: validDate(input.from), to: validDate(input.to) };
}
export function resolveDashboardPeriod(filters: DashboardFilters, now = new Date()) {
  const today = dashboardDateKey(now); let fromKey = today; let toKey = today;
  if (filters.period === "week") { const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); fromKey = addDashboardDays(today, -(weekday === 0 ? 6 : weekday - 1)); }
  else if (filters.period === "month") fromKey = `${today.slice(0, 7)}-01`;
  else if (filters.period === "30days") fromKey = addDashboardDays(today, -29);
  else if (filters.period === "year") fromKey = `${today.slice(0, 4)}-01-01`;
  else if (filters.period === "custom" && filters.from && filters.to && filters.from <= filters.to) { fromKey = filters.from; toKey = filters.to; }
  const start = new Date(`${fromKey}T00:00:00-03:00`); const end = new Date(`${toKey}T23:59:59.999-03:00`);
  const duration = end.getTime() - start.getTime() + 1; const previousEnd = new Date(start.getTime() - 1); const previousStart = new Date(previousEnd.getTime() - duration + 1);
  return { start, end, previousStart, previousEnd, fromKey, toKey };
}
export function dashboardPercentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
