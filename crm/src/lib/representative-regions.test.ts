import { describe, expect, it } from "vitest";
import { formatRegions, normalizeRegions, regionMatchScore } from "./representative-regions";

describe("regiões de atendimento do representante", () => {
  it("aceita várias cidades e vários estados, sem duplicar", () => {
    const { regions, invalid } = normalizeRegions([
      { state: "sp", city: "São Paulo" },
      { state: "SP", city: " Campinas " },
      { state: "SP", city: "Santos" },
      { state: "MG", city: "Belo Horizonte" },
      { state: "MG", city: "Uberlândia" },
      { state: "SP", city: "sao paulo" }, // duplicado (acento/caixa)
    ]);
    expect(invalid).toEqual([]);
    expect(regions).toEqual([
      { state: "MG", city: "Belo Horizonte" },
      { state: "MG", city: "Uberlândia" },
      { state: "SP", city: "Campinas" },
      { state: "SP", city: "Santos" },
      { state: "SP", city: "São Paulo" },
    ]);
  });

  it("cidade vazia = estado inteiro; UF inválida é rejeitada", () => {
    const { regions, invalid } = normalizeRegions([{ state: "PR" }, { state: "XX", city: "Lugar" }]);
    expect(regions).toEqual([{ state: "PR", city: "" }]);
    expect(invalid).toEqual(["XX"]);
  });

  it("prioriza quem atende a cidade do cliente (ex.: Campinas/SP)", () => {
    const regions = [{ state: "SP", city: "Campinas" }, { state: "MG", city: "" }];
    expect(regionMatchScore(regions, "SP", "campinas")).toBe(2);
    expect(regionMatchScore(regions, "SP", "Santos")).toBe(0);
    expect(regionMatchScore(regions, "MG", "Uberlândia")).toBe(1);
    expect(regionMatchScore(regions, null, "Campinas")).toBe(0);
  });

  it("resumo legível", () => {
    expect(formatRegions([{ state: "SP", city: "Campinas" }, { state: "SP", city: "Santos" }, { state: "PR", city: "" }]))
      .toBe("SP: Campinas, Santos · PR: todo o estado");
  });
});
