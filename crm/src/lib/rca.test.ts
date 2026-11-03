import { describe, expect, it } from "vitest";
import { formatRca, nextRca, normalizeRca, rcaFromQuery } from "./rca";
import { userOptionMatches } from "./user-search";

describe("RCA", () => {
  it("normaliza para no mínimo 3 dígitos", () => {
    expect(normalizeRca("27")).toBe("027");
    expect(normalizeRca("027")).toBe("027");
    expect(normalizeRca("RCA 027")).toBe("027");
    expect(normalizeRca("rca-145")).toBe("145");
    expect(normalizeRca("1234")).toBe("1234");
  });

  it("rejeita valores que não são RCA (inclusive ids técnicos)", () => {
    expect(normalizeRca("")).toBeNull();
    expect(normalizeRca("abc")).toBeNull();
    expect(normalizeRca("000")).toBeNull();
    expect(normalizeRca("clx9a8b7c0000abcd")).toBeNull();
  });

  it("gera o próximo sequencial sem repetir", () => {
    expect(nextRca([])).toBe("001");
    expect(nextRca(["001", "002", "027"])).toBe("028");
    expect(nextRca(["009", null, undefined])).toBe("010");
    expect(nextRca(["999"])).toBe("1000");
  });

  it("identifica busca por RCA", () => {
    expect(rcaFromQuery("027")).toBe("027");
    expect(rcaFromQuery("RCA 27")).toBe("027");
    expect(rcaFromQuery("Rafaela")).toBeNull();
    expect(rcaFromQuery("11987654321")).toBeNull();
  });

  it("exibe de forma discreta", () => {
    expect(formatRca("027")).toBe("RCA 027");
    expect(formatRca(null)).toBe("");
  });
});

describe("busca de responsável", () => {
  const rafaela = { id: "u1", name: "Rafaela Alexandre", rca: "027", role: "REPRESENTANTE", email: "rafaela@x.com", representativeType: "VAREJO", regions: [{ state: "SP", city: "Campinas" }] };
  const joao = { id: "u2", name: "João Vendedor", rca: "003", role: "VENDEDOR", regions: [] };

  it("“027” encontra Rafaela Alexandre", () => {
    expect(userOptionMatches(rafaela, "027")).toBe(true);
    expect(userOptionMatches(joao, "027")).toBe(false);
    expect(userOptionMatches(rafaela, "rca 27")).toBe(true);
  });

  it("busca por nome, e-mail, tipo e região (sem acento/caixa)", () => {
    expect(userOptionMatches(rafaela, "rafa")).toBe(true);
    expect(userOptionMatches(joao, "joao")).toBe(true);
    expect(userOptionMatches(rafaela, "rafaela@x")).toBe(true);
    expect(userOptionMatches(rafaela, "varejo")).toBe(true);
    expect(userOptionMatches(rafaela, "campinas")).toBe(true);
    expect(userOptionMatches(joao, "campinas")).toBe(false);
  });
});
