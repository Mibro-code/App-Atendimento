import { describe, expect, it } from "vitest";
import {
  computeGoalProgressPercent,
  computeGoalRemaining,
  computeGoalRiskStatus,
  daysRemaining,
  isPastEndDate,
  periodDays,
  resolvePeriodDates,
  warningWindowDays,
} from "./goal-rules";

describe("cálculo de progresso", () => {
  it("meta de R$ 10.000 com R$ 7.000 vendido -> 70%", () => {
    const percent = computeGoalProgressPercent({
      type: "REVENUE",
      targetValueCents: 1_000_000,
      targetSalesCount: null,
      currentValueCents: 700_000,
      currentSalesCount: 0,
    });
    expect(percent).toBe(70);
  });

  it("meta de 10 vendas com 7 confirmadas -> 70%", () => {
    const percent = computeGoalProgressPercent({
      type: "SALES_COUNT",
      targetValueCents: null,
      targetSalesCount: 10,
      currentValueCents: 0,
      currentSalesCount: 7,
    });
    expect(percent).toBe(70);
  });

  it("calcula quanto falta para cada tipo de meta", () => {
    expect(
      computeGoalRemaining({
        type: "REVENUE",
        targetValueCents: 5_000_000,
        targetSalesCount: null,
        currentValueCents: 3_500_000,
        currentSalesCount: 0,
      })
    ).toBe(1_500_000);

    expect(
      computeGoalRemaining({
        type: "SALES_COUNT",
        targetValueCents: null,
        targetSalesCount: 20,
        currentValueCents: 0,
        currentSalesCount: 14,
      })
    ).toBe(6);
  });

  it("meta sem alvo definido nunca gera progresso negativo/infinito", () => {
    expect(
      computeGoalProgressPercent({
        type: "REVENUE",
        targetValueCents: 0,
        targetSalesCount: null,
        currentValueCents: 100,
        currentSalesCount: 0,
      })
    ).toBe(0);
  });
});

describe("janela de aviso proporcional", () => {
  it("meta de 30 dias avisa faltando 7 dias", () => {
    expect(warningWindowDays(30)).toBe(7);
  });

  it("meta de 15 dias avisa faltando 4 dias", () => {
    expect(warningWindowDays(15)).toBe(4);
  });

  it("meta de 7 dias avisa faltando 2 dias", () => {
    expect(warningWindowDays(7)).toBe(2);
  });

  it("período personalizado usa a mesma fórmula proporcional (nunca 0 dias)", () => {
    expect(warningWindowDays(3)).toBeGreaterThanOrEqual(1);
    expect(warningWindowDays(3)).toBeLessThanOrEqual(3);
  });

  it("periodDays calcula a duração do período a partir das datas", () => {
    const days = periodDays({
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-01-31T00:00:00.000Z"),
    });
    expect(days).toBe(30);
  });
});

describe("status de risco (indicador visual)", () => {
  const startDate = new Date("2026-01-01T00:00:00.000Z");
  const endDate = new Date("2026-01-31T00:00:00.000Z"); // período de 30 dias, aviso aos 7 dias restantes

  it("ATINGIDA quando progresso >= 100%, mesmo antes do prazo", () => {
    const status = computeGoalRiskStatus({
      progressPercent: 100,
      lifecycleStatus: "ACTIVE",
      startDate,
      endDate,
      now: new Date("2026-01-10T00:00:00.000Z"),
    });
    expect(status).toBe("ATINGIDA");
  });

  it("EXPIRADA quando passou do prazo sem atingir 100%", () => {
    const status = computeGoalRiskStatus({
      progressPercent: 60,
      lifecycleStatus: "ACTIVE",
      startDate,
      endDate,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(status).toBe("EXPIRADA");
  });

  it("PROXIMO_DA_META quando progresso >= 80% e ainda no prazo", () => {
    const status = computeGoalRiskStatus({
      progressPercent: 85,
      lifecycleStatus: "ACTIVE",
      startDate,
      endDate,
      now: new Date("2026-01-15T00:00:00.000Z"),
    });
    expect(status).toBe("PROXIMO_DA_META");
  });

  it("ATENCAO quando entrou na janela de aviso (30d -> faltam 7d) e está abaixo de 100%", () => {
    const status = computeGoalRiskStatus({
      progressPercent: 72,
      lifecycleStatus: "ACTIVE",
      startDate,
      endDate,
      now: new Date("2026-01-24T00:00:00.000Z"), // faltam 7 dias
    });
    expect(status).toBe("ATENCAO");
  });

  it("EM_ANDAMENTO fora da janela de aviso e abaixo de 80%", () => {
    const status = computeGoalRiskStatus({
      progressPercent: 30,
      lifecycleStatus: "ACTIVE",
      startDate,
      endDate,
      now: new Date("2026-01-05T00:00:00.000Z"),
    });
    expect(status).toBe("EM_ANDAMENTO");
  });
});

describe("dias restantes / prazo", () => {
  it("daysRemaining nunca fica negativo", () => {
    expect(daysRemaining(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-02-01T00:00:00.000Z"))).toBe(0);
  });

  it("isPastEndDate detecta prazo vencido", () => {
    expect(isPastEndDate(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-02T00:00:00.000Z"))).toBe(true);
    expect(isPastEndDate(new Date("2026-01-05T00:00:00.000Z"), new Date("2026-01-02T00:00:00.000Z"))).toBe(false);
  });
});

describe("resolução de período configurável", () => {
  it("presets 7/15/30 geram período a partir de agora", () => {
    const now = new Date();
    const { startDate, endDate } = resolvePeriodDates("15", null, now);
    // startDate é hoje às 00:00 (fuso local) e endDate é o 15º dia seguinte
    // às 23:59:59 (inclui o último dia inteiro) — por isso a diferença em ms
    // passa de 15 dias "cheios"; o que importa é a distância em dias de
    // calendário local, não a duração exata em milissegundos.
    expect(startDate.getHours()).toBe(0);
    expect(endDate.getHours()).toBe(23);
    expect(endDate.getDate()).toBe(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 15).getDate());
  });

  it("período personalizado usa as datas informadas", () => {
    const custom = {
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-10T00:00:00.000Z"),
    };
    const { startDate, endDate } = resolvePeriodDates("custom", custom);
    expect(startDate).toEqual(custom.startDate);
    expect(endDate).toEqual(custom.endDate);
  });

  it("período personalizado sem datas lança erro", () => {
    expect(() => resolvePeriodDates("custom", null)).toThrow();
  });

  it("data final antes da inicial lança erro", () => {
    expect(() =>
      resolvePeriodDates("custom", {
        startDate: new Date("2026-05-10T00:00:00.000Z"),
        endDate: new Date("2026-05-01T00:00:00.000Z"),
      })
    ).toThrow();
  });
});
