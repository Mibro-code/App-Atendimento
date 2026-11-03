import { describe, expect, it } from "vitest";
import { calculateCommissionForSales, calculateRepresentativeCommissionCents, commissionCentsFor, commissionRateForSale, commissionStatusLabel, formatCommissionPercent, getBrazilMonthRange, resolveSaleCommission } from "./representative-commission";

describe("representative commission", () => {
  it("calcula 1% em centavos com arredondamento", () => {
    expect(calculateRepresentativeCommissionCents(100_000)).toBe(1_000);
    expect(calculateRepresentativeCommissionCents(10_050)).toBe(101);
  });

  it("não gera comissão negativa", () => {
    expect(calculateRepresentativeCommissionCents(-100)).toBe(0);
  });

  it("gera limites mensais no fuso do Brasil", () => {
    const range = getBrazilMonthRange("2026-09");
    expect(range.start.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(range.previousMonth).toBe("2026-08");
    expect(range.nextMonth).toBe("2026-10");
  });
});

describe("planos variáveis de comissão", () => {
  const start = new Date("2026-09-01T00:00:00Z");
  it("prioriza a taxa específica da empresa", () => expect(commissionRateForSale([
    { brand:null,rateBps:100,startDate:start,endDate:null },
    { brand:"SINCROFIT",rateBps:250,startDate:start,endDate:null },
  ], "SINCROFIT", new Date("2026-09-10T00:00:00Z"))).toBe(250));
  it("calcula cada venda com a taxa histórica aplicável — sem plano, nada é presumido", () => expect(calculateCommissionForSales([
    { valueCents:10000,brand:"MIBRO",confirmedAt:new Date("2026-09-10T00:00:00Z") },
    { valueCents:10000,brand:"SINCROFIT",confirmedAt:new Date("2026-09-10T00:00:00Z") },
  ], [{ brand:"SINCROFIT",rateBps:200,startDate:start,endDate:null }])).toBe(200));
});

describe("comissão: padrão por tipo e específica por pedido", () => {
  const at = new Date("2026-09-10T00:00:00Z");
  const start = new Date("2026-09-01T00:00:00Z");

  it("Varejo sem plano próprio usa o padrão do tipo (5%)", () => {
    expect(resolveSaleCommission({ plans: [], typeDefaultBps: 500, brand: null, at })).toEqual({ rateBps: 500, source: "DEFAULT", origin: "TIPO" });
    expect(commissionCentsFor(1_250_000, 500)).toBe(62_500);
  });

  it("Atacado sem percentual configurado fica em branco (nenhum % inventado)", () => {
    expect(resolveSaleCommission({ plans: [], typeDefaultBps: null, brand: null, at })).toEqual({ rateBps: null, source: null, origin: null });
    expect(commissionCentsFor(1_250_000, null)).toBeNull();
    expect(formatCommissionPercent(null)).toBe("A definir");
  });

  it("quem já tem percentual registrado mantém o próprio (prioridade sobre o tipo)", () => {
    const plans = [{ brand: null, rateBps: 300, startDate: start, endDate: null }];
    expect(resolveSaleCommission({ plans, typeDefaultBps: 500, brand: null, at })).toEqual({ rateBps: 300, source: "DEFAULT", origin: "PLANO" });
  });

  it("comissão específica do pedido tem prioridade (5% padrão, pedido a 7%)", () => {
    const plans = [{ brand: null, rateBps: 500, startDate: start, endDate: null }];
    expect(resolveSaleCommission({ customRateBps: 700, plans, typeDefaultBps: 500, brand: null, at })).toEqual({ rateBps: 700, source: "CUSTOM_ORDER", origin: "PEDIDO" });
    expect(calculateCommissionForSales([{ valueCents: 100_000, brand: null, confirmedAt: at, customRateBps: 700 }], plans, 500)).toBe(7_000);
    expect(formatCommissionPercent(700)).toBe("7%");
  });

  it("status da comissão segue o estágio da venda", () => {
    expect(commissionStatusLabel({ stage: "PAGAMENTO_CONFIRMADO", confirmedAt: at }, 500)).toBe("Confirmada");
    expect(commissionStatusLabel({ stage: "PEDIDO_CRIADO", confirmedAt: null }, 500)).toBe("Prevista");
    expect(commissionStatusLabel({ stage: "CANCELADO", confirmedAt: at }, 500)).toBe("Cancelada");
    expect(commissionStatusLabel({ stage: "PAGAMENTO_CONFIRMADO", confirmedAt: at }, null)).toBe("A definir");
  });
});
