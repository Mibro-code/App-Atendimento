import { describe, expect, it } from "vitest";
import { buildQuoteFilterWhere, parseQuoteFilters, quoteFiltersToQuery } from "./quote-filters";
import { quoteAlertDedupeKey, quoteAlertText } from "./quote-alert-rules";

describe("filtros da lista de propostas", () => {
  it("ignora valores inválidos", () => {
    expect(parseQuoteFilters({ brand: "OUTRA", grupo: "VIP", faixa: "tier3", de: "01/10/2026", manual: "talvez" })).toEqual({
      brand: undefined, mode: undefined, status: undefined, open: false, sellerId: undefined, origin: undefined,
      priceGroup: undefined, tier: undefined, manual: undefined, from: undefined, to: undefined,
    });
  });

  it("monta grupo, faixa aplicada, condição manual e período (dia inteiro em São Paulo)", () => {
    const f = parseQuoteFilters({ grupo: "REPRESENTATIVE", faixa: "TIER3", manual: "1", de: "2026-10-01", ate: "2026-10-08", origem: "CRM" });
    expect(buildQuoteFilterWhere(f, { canFilterSeller: true })).toEqual({
      AND: [
        { origin: "CRM" },
        { priceGroup: "REPRESENTATIVE" },
        { items: { some: { appliedTier: "TIER3" } } },
        { items: { some: { manualTier: true } } },
        { createdAt: { gte: new Date("2026-10-01T03:00:00.000Z"), lt: new Date("2026-10-09T03:00:00.000Z") } },
      ],
    });
  });

  it("filtro de vendedor só vale para quem pode ver a equipe", () => {
    const f = parseQuoteFilters({ sellerId: "u1" });
    expect(buildQuoteFilterWhere(f, { canFilterSeller: false })).toEqual({});
    expect(buildQuoteFilterWhere(f, { canFilterSeller: true })).toEqual({ AND: [{ sellerId: "u1" }] });
  });

  it("'sem faixa manual' inclui propostas sem itens (Shopify)", () => {
    expect(buildQuoteFilterWhere(parseQuoteFilters({ manual: "0" }), { canFilterSeller: false })).toEqual({ AND: [{ items: { none: { manualTier: true } } }] });
  });

  it("em aberto tem prioridade sobre status", () => {
    expect(buildQuoteFilterWhere(parseQuoteFilters({ open: "1", status: "CANCELADA" }), { canFilterSeller: false })).toEqual({
      AND: [{ status: { in: ["ABERTA", "CALCULADA", "ENVIADA", "ENVIADA_PARA_ANALISE"] } }],
    });
  });

  it("links preservam os demais filtros", () => {
    const f = parseQuoteFilters({ brand: "MIBRO", grupo: "REPRESENTATIVE", manual: "1" });
    expect(quoteFiltersToQuery(f, { brand: "SINCROFIT" })).toBe("brand=SINCROFIT&grupo=REPRESENTATIVE&manual=1");
    expect(quoteFiltersToQuery(f, { brand: "ALL" })).toBe("grupo=REPRESENTATIVE&manual=1");
  });
});

describe("aviso de cotação ao supervisor", () => {
  it("resume vendedor, cliente, valor e condições especiais", () => {
    const text = quoteAlertText({
      sellerName: "Ana", customerName: "Loja X", brand: "MIBRO", mode: "SIMULATION", origin: "CRM",
      totalValueCents: 242000, priceGroup: "REPRESENTATIVE", selectedTier: "TIER3",
    });
    expect(text.title).toBe("Simulação Mibro de Ana");
    expect(text.message).toContain("Loja X");
    expect(text.message).toContain("2.420,00");
    expect(text.message).toContain("tabela de representantes · Tabela 3 manual");
  });
  it("uma chave por proposta", () => expect(quoteAlertDedupeKey("q1")).toBe("quote-created:q1"));
});
