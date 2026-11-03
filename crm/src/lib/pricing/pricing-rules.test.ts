import { describe, expect, it } from "vitest";
import type { CommercialBrand, PriceGroup, PriceTier } from "@prisma/client";
import { SEED_PRODUCTS } from "./catalog-seed-data";
import {
  PricingError,
  allocateDiscount,
  pickEffectiveTable,
  priceGroupForRole,
  priceQuote,
  tierForQuantity,
  type LoadedPriceTable,
  type PricingLineInput,
} from "./pricing-rules";

// Tabelas montadas a partir dos dados do seed (mesma origem do banco).
function tableFor(brand: CommercialBrand, group: PriceGroup): LoadedPriceTable {
  const prices = new Map<string, Partial<Record<PriceTier, number>>>();
  for (const p of SEED_PRODUCTS.filter((x) => x.brand === brand)) {
    prices.set(p.slug, group === "REPRESENTATIVE" ? p.representative : p.standard);
  }
  return { id: `${brand}-${group}`, version: 1, priceGroup: group, prices };
}

function line(brand: CommercialBrand, slug: string, quantity: number, variantIndex = 0, client?: number): PricingLineInput {
  const p = SEED_PRODUCTS.find((x) => x.brand === brand && x.slug === slug)!;
  return {
    sku: p.variants[variantIndex].sku,
    productId: p.slug,
    productName: p.name,
    quantity,
    clientUnitPriceCents: client,
  };
}

function quote(brand: CommercialBrand, group: PriceGroup, lines: PricingLineInput[], requestedTier: PriceTier | null = null, discountCents = 0) {
  return priceQuote({ priceGroup: group, table: tableFor(brand, group), lines, requestedTier, quantityRule: "MIX", discountCents });
}

describe("tabelas oficiais iniciais", () => {
  const expectedRep: Record<string, [number, number, number]> = {
    "Mibro C4": [278, 257, 242],
    "Mibro A3": [386, 355, 335],
    "Mibro Lite 3": [401, 370, 350],
    "Mibro Lite 3 Pro": [556, 515, 489],
    "Mibro GS Pro": [499, 463, 438],
    "Mibro GS Pro 2": [731, 680, 643],
    "Mibro GS Active": [422, 391, 370],
    "Mibro GS Active 2": [576, 535, 510],
    Neo: [216, 193, 173],
    "Motion GPS": [298, 268, 242],
    "Titan Pro": [422, 391, 360],
  };

  it("REPRESENTATIVE confere exatamente com os catálogos de outubro", () => {
    for (const p of SEED_PRODUCTS) {
      const [t1, t2, t3] = expectedRep[p.name];
      expect(p.representative, p.name).toEqual({ TIER1: t1 * 100, TIER2: t2 * 100, TIER3: t3 * 100 });
    }
    expect(SEED_PRODUCTS).toHaveLength(Object.keys(expectedRep).length);
  });

  it("STANDARD preserva os valores do servidor Shopify (Sincrofit sem TIER3)", () => {
    const c4 = SEED_PRODUCTS.find((p) => p.slug === "c4")!;
    expect(c4.standard).toEqual({ TIER1: 27000, TIER2: 25000, TIER3: 23500 });
    for (const p of SEED_PRODUCTS.filter((x) => x.brand === "SINCROFIT")) {
      expect(p.standard.TIER3, p.name).toBeUndefined();
    }
  });

  it("variações Sincrofit e SKUs oficiais preservados", () => {
    const skus = (slug: string) => SEED_PRODUCTS.find((p) => p.slug === slug)!.variants.map((v) => `${v.sku}=${v.colorName}`);
    expect(skus("neo")).toEqual(["NEO-PRETO=Preto", "NEO-ROSA=Rosa"]);
    expect(skus("motion-gps")).toEqual(["MOTION-GPS-PRATA=Prata", "MOTION-GPS-PRETO=Preto", "MOTION-GPS-DOURADO=Rose Gold"]);
    expect(skus("titan-pro")).toEqual(["TITAN-PRO-PRATA=Prata", "TITAN-PRO-PRETO=Preto"]);
  });

  it("SKU é único por marca", () => {
    for (const brand of ["MIBRO", "SINCROFIT"] as const) {
      const all = SEED_PRODUCTS.filter((p) => p.brand === brand).flatMap((p) => p.variants.map((v) => v.sku));
      expect(new Set(all).size).toBe(all.length);
    }
  });
});

describe("faixa por quantidade (sem mínimo)", () => {
  it.each([
    [1, "TIER1"], [10, "TIER1"], [49, "TIER1"], [50, "TIER2"], [60, "TIER2"], [99, "TIER2"], [100, "TIER3"], [120, "TIER3"],
  ] as const)("%i unidades → %s", (qty, tier) => expect(tierForQuantity(qty)).toBe(tier));

  it("quantidade inválida não tem faixa", () => {
    expect(tierForQuantity(0)).toBeNull();
    expect(tierForQuantity(-5)).toBeNull();
    expect(tierForQuantity(2.5)).toBeNull();
  });
});

describe("grupo comercial pelo cargo", () => {
  it("vendedor/supervisor/admin → STANDARD; representante → REPRESENTATIVE", () => {
    expect(priceGroupForRole("VENDEDOR")).toBe("STANDARD");
    expect(priceGroupForRole("SUPERVISOR")).toBe("STANDARD");
    expect(priceGroupForRole("ADMIN")).toBe("STANDARD");
    expect(priceGroupForRole("REPRESENTANTE")).toBe("REPRESENTATIVE");
  });
});

describe("cenários obrigatórios", () => {
  it("1. vendedor Mibro vê STANDARD", () => {
    expect(quote("MIBRO", "STANDARD", [line("MIBRO", "c4", 10)]).lines[0].unitPriceCents).toBe(27000);
  });
  it("2. representante Mibro vê REPRESENTATIVE", () => {
    expect(quote("MIBRO", "REPRESENTATIVE", [line("MIBRO", "c4", 10)]).lines[0].unitPriceCents).toBe(27800);
  });
  it("3. vendedor Sincrofit vê STANDARD", () => {
    expect(quote("SINCROFIT", "STANDARD", [line("SINCROFIT", "neo", 10)]).lines[0].unitPriceCents).toBe(21000);
  });
  it("4. representante Sincrofit vê REPRESENTATIVE", () => {
    expect(quote("SINCROFIT", "REPRESENTATIVE", [line("SINCROFIT", "neo", 10)]).lines[0].unitPriceCents).toBe(21600);
  });

  it("5. representante C4 x10 automático → R$ 278", () => {
    const r = quote("MIBRO", "REPRESENTATIVE", [line("MIBRO", "c4", 10)]);
    expect(r.lines[0]).toMatchObject({ automaticTier: "TIER1", appliedTier: "TIER1", manualTier: false, unitPriceCents: 27800 });
    expect(r.subtotalCents).toBe(278000);
  });

  it("6. representante C4 x10 com TIER3 manual → R$ 242, subtotal R$ 2.420", () => {
    const r = quote("MIBRO", "REPRESENTATIVE", [line("MIBRO", "c4", 10)], "TIER3");
    expect(r.lines[0]).toMatchObject({ automaticTier: "TIER1", appliedTier: "TIER3", manualTier: true, unitPriceCents: 24200 });
    expect(r.subtotalCents).toBe(242000);
    expect(r.totalCents).toBe(242000);
    expect(r.priceGroup).toBe("REPRESENTATIVE");
  });

  it("7. representante Neo x10 com TIER3 manual → R$ 173", () => {
    const r = quote("SINCROFIT", "REPRESENTATIVE", [line("SINCROFIT", "neo", 10)], "TIER3");
    expect(r.lines[0].unitPriceCents).toBe(17300);
  });

  it("8. 50 unidades → TIER2 automático", () => {
    expect(quote("MIBRO", "REPRESENTATIVE", [line("MIBRO", "c4", 50)]).lines[0].appliedTier).toBe("TIER2");
  });

  it("9. 100 unidades → TIER3 automático (inclusive Sincrofit representante)", () => {
    expect(quote("MIBRO", "STANDARD", [line("MIBRO", "c4", 100)]).lines[0].unitPriceCents).toBe(23500);
    expect(quote("SINCROFIT", "REPRESENTATIVE", [line("SINCROFIT", "titan-pro", 100)]).lines[0].unitPriceCents).toBe(36000);
  });

  it("10. voltar ao automático recalcula pela quantidade", () => {
    const lines = [line("MIBRO", "c4", 60)];
    expect(quote("MIBRO", "REPRESENTATIVE", lines, "TIER3").lines[0].appliedTier).toBe("TIER3");
    const auto = quote("MIBRO", "REPRESENTATIVE", lines, null);
    expect(auto.lines[0]).toMatchObject({ appliedTier: "TIER2", manualTier: false, unitPriceCents: 25700 });
  });

  it("11. faixa manual mantém o grupo comercial (TIER3 rep ≠ TIER3 standard)", () => {
    const rep = quote("MIBRO", "REPRESENTATIVE", [line("MIBRO", "c4", 10)], "TIER3");
    const std = quote("MIBRO", "STANDARD", [line("MIBRO", "c4", 10)], "TIER3");
    expect(rep.lines[0].unitPriceCents).toBe(24200);
    expect(std.lines[0].unitPriceCents).toBe(23500);
    expect(rep.priceGroup).toBe("REPRESENTATIVE");
  });

  it("12. preço enviado pelo navegador é ignorado e registrado como divergência", () => {
    const r = quote("MIBRO", "REPRESENTATIVE", [line("MIBRO", "c4", 10, 0, 23500)], "TIER3");
    expect(r.lines[0].unitPriceCents).toBe(24200);
    expect(r.mismatches).toEqual([{ sku: "C4-BLACK", expectedUnitPriceCents: 24200, receivedUnitPriceCents: 23500 }]);
  });

  it("12b. tabela de outro grupo é recusada", () => {
    expect(() =>
      priceQuote({
        priceGroup: "REPRESENTATIVE",
        table: tableFor("MIBRO", "STANDARD"),
        lines: [line("MIBRO", "c4", 10)],
        requestedTier: null,
        quantityRule: "MIX",
        discountCents: 0,
      })
    ).toThrow(expect.objectContaining({ code: "PRICE_GROUP_MISMATCH" }));
  });
});

describe("faixa automática: mix x por modelo", () => {
  const lines = () => [line("MIBRO", "c4", 30), line("MIBRO", "c4", 30, 1), line("MIBRO", "a3", 40)];

  it("MIX soma o pedido inteiro (100 → TIER3)", () => {
    const r = quote("MIBRO", "STANDARD", lines());
    expect(r.totalQuantity).toBe(100);
    expect(r.lines.map((l) => l.appliedTier)).toEqual(["TIER3", "TIER3", "TIER3"]);
  });

  it("PER_MODEL soma por modelo (C4=60 → TIER2, A3=40 → TIER1)", () => {
    const r = priceQuote({
      priceGroup: "STANDARD", table: tableFor("MIBRO", "STANDARD"), lines: lines(),
      requestedTier: null, quantityRule: "PER_MODEL", discountCents: 0,
    });
    expect(r.lines.map((l) => l.appliedTier)).toEqual(["TIER2", "TIER2", "TIER1"]);
  });
});

describe("validações", () => {
  it("Sincrofit STANDARD em TIER3 é recusada até a tabela ser configurada", () => {
    expect(() => quote("SINCROFIT", "STANDARD", [line("SINCROFIT", "neo", 100)])).toThrow(
      expect.objectContaining({ code: "PRICE_TIER_NOT_CONFIGURED" })
    );
  });

  it("sem produtos, quantidade zero/negativa/fracionada e SKU duplicado são recusados", () => {
    expect(() => quote("MIBRO", "STANDARD", [])).toThrow(PricingError);
    for (const q of [0, -1, 1.5]) {
      expect(() => quote("MIBRO", "STANDARD", [line("MIBRO", "c4", q)])).toThrow(expect.objectContaining({ code: "INVALID_QUANTITY" }));
    }
    expect(() => quote("MIBRO", "STANDARD", [line("MIBRO", "c4", 1), line("MIBRO", "c4", 2)])).toThrow(
      expect.objectContaining({ code: "DUPLICATE_SKU" })
    );
  });

  it("uma unidade é aceita (sem pedido mínimo)", () => {
    expect(quote("SINCROFIT", "STANDARD", [line("SINCROFIT", "neo", 1)]).totalCents).toBe(21000);
  });

  it("desconto negativo, fracionado ou >= subtotal é recusado", () => {
    for (const d of [-1, 0.5, 278000, 999999]) {
      expect(() => quote("MIBRO", "REPRESENTATIVE", [line("MIBRO", "c4", 10)], null, d)).toThrow(
        expect.objectContaining({ code: "INVALID_DISCOUNT" })
      );
    }
  });
});

describe("desconto rateado igual ao app Shopify", () => {
  it("soma dos itens fecha exatamente com o total", () => {
    const r = quote("MIBRO", "REPRESENTATIVE", [line("MIBRO", "c4", 7), line("MIBRO", "a3", 3), line("MIBRO", "gs-pro", 11)], null, 12345);
    const totalLines = r.lines.reduce((s, l) => s + l.lineSubtotalCents - l.lineDiscountCents, 0);
    expect(totalLines).toBe(r.totalCents);
    expect(r.lines.reduce((s, l) => s + l.lineDiscountCents, 0)).toBe(12345);
  });

  it("reproduz allocateCommercialItemPrices (maiores restos)", () => {
    expect(allocateDiscount([{ quantity: 1, unitPriceCents: 100 }, { quantity: 1, unitPriceCents: 100 }, { quantity: 1, unitPriceCents: 100 }], 100)).toEqual([
      { lineTotalCents: 67, lineDiscountCents: 33, unitPrice: 0.67 },
      { lineTotalCents: 67, lineDiscountCents: 33, unitPrice: 0.67 },
      { lineTotalCents: 66, lineDiscountCents: 34, unitPrice: 0.66 },
    ]);
  });
});

describe("vigência", () => {
  it("usa a versão publicada mais recente já iniciada", () => {
    const t = (v: number, from: string, status = "PUBLISHED") => ({ version: v, status, effectiveFrom: new Date(from) });
    const tables = [t(1, "2026-10-01"), t(2, "2026-11-01"), t(3, "2026-10-15", "DRAFT")];
    expect(pickEffectiveTable(tables, new Date("2026-10-20"))?.version).toBe(1);
    expect(pickEffectiveTable(tables, new Date("2026-11-02"))?.version).toBe(2);
    expect(pickEffectiveTable(tables, new Date("2026-09-01"))).toBeNull();
  });
});
