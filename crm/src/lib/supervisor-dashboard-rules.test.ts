import { describe, expect, it } from "vitest";
import { dashboardPercentChange, normalizeDashboardFilters, resolveDashboardPeriod } from "./supervisor-dashboard-rules";

describe("supervisor dashboard rules", () => {
  const now = new Date("2026-09-16T15:00:00-03:00");
  it("resolves month and previous period in Brazil timezone", () => {
    const period = resolveDashboardPeriod({ period: "month", brand: "all", teamType: "all" }, now);
    expect(period.fromKey).toBe("2026-09-01");
    expect(period.toKey).toBe("2026-09-16");
    expect(period.start.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(period.previousEnd.getTime()).toBe(period.start.getTime() - 1);
  });
  it("resolves the last 30 inclusive days", () => {
    expect(resolveDashboardPeriod({ period: "30days", brand: "MIBRO", teamType: "VENDEDOR" }, now).fromKey).toBe("2026-08-18");
  });
  it("accepts a valid custom period and rejects invalid filters", () => {
    const filters = normalizeDashboardFilters({ period: "custom", brand: "SINCROFIT", teamType: "REPRESENTANTE", from: "2026-08-01", to: "2026-08-31" });
    expect(resolveDashboardPeriod(filters, now).fromKey).toBe("2026-08-01");
    expect(normalizeDashboardFilters({ period: "x", brand: "x", teamType: "x" })).toMatchObject({ period: "month", brand: "all", teamType: "all" });
  });
  it("calculates comparison without dividing by zero", () => {
    expect(dashboardPercentChange(120, 100)).toBe(20);
    expect(dashboardPercentChange(0, 0)).toBe(0);
    expect(dashboardPercentChange(100, 0)).toBeNull();
  });
});
