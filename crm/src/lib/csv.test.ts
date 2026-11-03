import { describe, expect, it } from "vitest";
import { buildCsv, csvCell } from "./csv";

describe("exportação CSV", () => {
  it("escapa aspas e bloqueia fórmulas", () => {
    expect(csvCell('Empresa "Teste"')).toBe('"Empresa ""Teste"""');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
  });

  it("gera CSV UTF-8 com separador compatível com Excel pt-BR", () => {
    expect(buildCsv(["Nome", "Vendas"], [["Mibro", 2]])).toContain("\uFEFF\"Nome\";\"Vendas\"");
  });
});
