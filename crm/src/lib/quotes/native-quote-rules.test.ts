import { describe, expect, it } from "vitest";
import { buildProductsSummary, isEditableNativeQuote, itemsFromQuantities, nextNativeQuoteStatus } from "./native-quote-rules";

describe("cotação nativa: edição e status", () => {
  it("só cotações do CRM, não excluídas, em rascunho ou calculadas são editáveis", () => {
    expect(isEditableNativeQuote({ origin: "CRM", mode: "SIMULATION", status: "ABERTA", deletedAt: null })).toBe(true);
    expect(isEditableNativeQuote({ origin: "CRM", mode: "SIMULATION", status: "CALCULADA", deletedAt: null })).toBe(true);
    expect(isEditableNativeQuote({ origin: "SHOPIFY", mode: "SIMULATION", status: "ABERTA", deletedAt: null })).toBe(false);
    expect(isEditableNativeQuote({ origin: "CRM", mode: "SIMULATION", status: "ENVIADA", deletedAt: null })).toBe(false);
    expect(isEditableNativeQuote({ origin: "CRM", mode: "SIMULATION", status: "ABERTA", deletedAt: new Date() })).toBe(false);
    expect(isEditableNativeQuote({ origin: "CRM", mode: "REAL", status: "CALCULADA", deletedAt: null })).toBe(false);
  });

  it("concluir → CALCULADA; autosave mantém CALCULADA só com cálculo válido", () => {
    expect(nextNativeQuoteStatus({ previous: null, finalize: false, pricingValid: true })).toBe("ABERTA");
    expect(nextNativeQuoteStatus({ previous: "ABERTA", finalize: true, pricingValid: true })).toBe("CALCULADA");
    expect(nextNativeQuoteStatus({ previous: "CALCULADA", finalize: false, pricingValid: true })).toBe("CALCULADA");
    expect(nextNativeQuoteStatus({ previous: "CALCULADA", finalize: false, pricingValid: false })).toBe("ABERTA");
  });
});

describe("itens e resumo", () => {
  it("ignora quantidades zeradas ou inválidas", () => {
    expect(itemsFromQuantities({ "C4-BLACK": 10, "C4-SILVER": 0, "A3-MOCHA": 2.5, "NEO-ROSA": -1 })).toEqual([{ sku: "C4-BLACK", quantity: 10 }]);
  });

  it("productsSummary no formato do app Shopify, com grupo e faixas", () => {
    const summary = buildProductsSummary(
      [{ sku: "C4-BLACK", productName: "Mibro C4", colorName: "Black", quantity: 10, unitPriceCents: 24200, lineSubtotalCents: 242000, appliedTier: "TIER3", automaticTier: "TIER1", manualTier: true }],
      { priceGroup: "REPRESENTATIVE", priceTableVersion: 1, selectedTier: "TIER3" }
    );
    expect(summary.products[0]).toEqual({
      sku: "C4-BLACK", name: "Mibro C4", variant: "Black", quantity: 10, unitPriceCents: 24200, subtotalCents: 242000,
      priceTier: "TIER3", automaticTier: "TIER1", manualTier: true,
    });
    expect(summary).toMatchObject({ origin: "CRM", priceGroup: "REPRESENTATIVE", totalQuantity: 10, selectedTier: "TIER3" });
  });
});
