import { describe, expect, it } from "vitest";
import {
  canManagePriceTables,
  canViewPriceTables,
  centsToReaisInput,
  diffEntries,
  parseReaisToCents,
  percentDiff,
  tierOrderWarnings,
  validateDraftEntries,
  validatePublish,
} from "./price-admin-rules";

describe("permissões da Gestão Comercial", () => {
  it("só admin edita; admin e supervisor consultam", () => {
    expect(canManagePriceTables("ADMIN")).toBe(true);
    for (const role of ["SUPERVISOR", "VENDEDOR", "REPRESENTANTE"] as const) expect(canManagePriceTables(role)).toBe(false);
    expect(canViewPriceTables("SUPERVISOR")).toBe(true);
    expect(canViewPriceTables("VENDEDOR")).toBe(false);
    expect(canViewPriceTables("REPRESENTANTE")).toBe(false);
  });
});

describe("valores em reais → centavos", () => {
  it.each([
    ["278", 27800], ["278,5", 27850], ["278,50", 27850], ["1.278,50", 127850], ["278.50", 27850], ["R$ 242,00", 24200], ["0,01", 1],
  ])("%s → %i", (text, cents) => expect(parseReaisToCents(text)).toBe(cents));

  it("vazio é null; inválido é NaN", () => {
    expect(parseReaisToCents("  ")).toBeNull();
    for (const bad of ["abc", "2,345", "1,2,3", "-10", "12.345.6"]) expect(parseReaisToCents(bad)).toBeNaN();
  });

  it("ida e volta", () => {
    expect(centsToReaisInput(24200)).toBe("242,00");
    expect(centsToReaisInput(5)).toBe("0,05");
    expect(parseReaisToCents(centsToReaisInput(123456))).toBe(123456);
  });
});

describe("validação do rascunho", () => {
  const ids = new Set(["p1"]);
  it("aceita valores válidos e faixa vazia", () => {
    expect(validateDraftEntries([{ productId: "p1", tier: "TIER1", unitPriceCents: 100 }, { productId: "p1", tier: "TIER3", unitPriceCents: null }], ids)).toEqual({});
  });
  it("recusa zero, negativo, fracionado, produto de outra marca e repetição", () => {
    const errors = validateDraftEntries([
      { productId: "p1", tier: "TIER1", unitPriceCents: 0 },
      { productId: "p1", tier: "TIER2", unitPriceCents: -5 },
      { productId: "p1", tier: "TIER3", unitPriceCents: 1.5 },
      { productId: "x", tier: "TIER1", unitPriceCents: 100 },
      { productId: "p1", tier: "TIER1", unitPriceCents: 100 },
    ], ids);
    expect(Object.keys(errors).sort()).toEqual(["p1:TIER1", "p1:TIER2", "p1:TIER3", "x:TIER1"]);
  });
  it("avisa quando faixa maior está mais cara", () => {
    expect(tierOrderWarnings([{ productId: "p1", tier: "TIER1", unitPriceCents: 100 }, { productId: "p1", tier: "TIER2", unitPriceCents: 120 }], new Map([["p1", "C4"]]))).toHaveLength(1);
  });
});

describe("publicação", () => {
  const now = new Date("2026-10-08T15:00:00Z");
  it("exige motivo, vigência não retroativa e preços", () => {
    expect(validatePublish({ reason: "", effectiveFrom: new Date("2026-10-01T00:00:00Z"), entryCount: 0 }, now)).toEqual({
      reason: expect.any(String), effectiveFrom: expect.any(String), entries: expect.any(String),
    });
  });
  it("aceita agora e futuro", () => {
    expect(validatePublish({ reason: "Reajuste de outubro", effectiveFrom: now, entryCount: 3 }, now)).toEqual({});
    expect(validatePublish({ reason: "Reajuste de novembro", effectiveFrom: new Date("2026-11-01T03:00:00Z"), entryCount: 3 }, now)).toEqual({});
  });
});

describe("diferenças", () => {
  it("lista só o que mudou, entrou ou saiu", () => {
    expect(diffEntries(
      [{ productId: "p", tier: "TIER1", unitPriceCents: 100 }, { productId: "p", tier: "TIER2", unitPriceCents: 90 }, { productId: "p", tier: "TIER3", unitPriceCents: 80 }],
      [{ productId: "p", tier: "TIER1", unitPriceCents: 110 }, { productId: "p", tier: "TIER2", unitPriceCents: 90 }, { productId: "q", tier: "TIER1", unitPriceCents: 50 }],
    )).toEqual([
      { productId: "p", tier: "TIER1", before: 100, after: 110 },
      { productId: "p", tier: "TIER3", before: 80, after: null },
      { productId: "q", tier: "TIER1", before: null, after: 50 },
    ]);
  });
  it("percentual entre grupos", () => {
    expect(percentDiff(27000, 27800)).toBe(3);
    expect(percentDiff(null, 100)).toBeNull();
  });
});
