import { describe, expect, it } from "vitest";
import {
  onlyDigits, normalizeEmail, formatCnpj, formatCpf, formatPhone, formatCentsToBRL,
  formatDateBR, formatDateTimeBR, formatDate, formatDateTime, searchDigits,
} from "./format";

describe("format helpers", () => {
  it("onlyDigits remove tudo que não é dígito", () => {
    expect(onlyDigits("11.222.333/0001-81")).toBe("11222333000181");
    expect(onlyDigits(null)).toBe("");
  });

  it("normalizeEmail faz trim e lowercase", () => {
    expect(normalizeEmail("  Fulano@Exemplo.COM  ")).toBe("fulano@exemplo.com");
  });

  it("formatCnpj formata 14 dígitos", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("formatCpf formata 11 dígitos", () => {
    expect(formatCpf("12345678909")).toBe("123.456.789-09");
  });

  it("formatPhone formata celular com 11 dígitos", () => {
    expect(formatPhone("11988887777")).toBe("(11) 98888-7777");
  });

  it("formatCentsToBRL converte centavos para BRL", () => {
    expect(formatCentsToBRL(250000)).toContain("2.500,00");
  });

  // Regressão do bug de fuso: sem `timeZone` explícito, toLocaleString usa o
  // fuso do processo (UTC em produção/Docker), então um horário perto da
  // meia-noite UTC mostrava a DATA ERRADA além do horário errado. Este
  // horário (02:30 UTC) é 23:30 do dia anterior em América/São_Paulo — se o
  // helper não estiver convertendo o fuso corretamente, a data exibida vira
  // 31/08 em vez de 30/08.
  it("formatDateBR/formatDateTimeBR convertem para America/Sao_Paulo, inclusive na virada do dia", () => {
    const utcNearMidnight = new Date("2026-08-31T02:30:00.000Z"); // 30/08 23:30 em São Paulo (UTC-3)
    expect(formatDateBR(utcNearMidnight)).toBe("30/08/2026");
    expect(formatDateTimeBR(utcNearMidnight)).toBe("30/08/2026 23:30:00");
  });

  it("formatDateBR/formatDateTimeBR aplicam o deslocamento de -3h em horário comum (não só na virada do dia)", () => {
    const utcAfternoon = new Date("2026-08-31T16:20:37.000Z");
    expect(formatDateBR(utcAfternoon)).toBe("31/08/2026");
    expect(formatDateTimeBR(utcAfternoon)).toBe("31/08/2026 13:20:37");
  });

  it("formatDate/formatDateTime continuam disponíveis como alias (mesmas telas, mesmo import)", () => {
    expect(formatDate).toBe(formatDateBR);
    expect(formatDateTime).toBe(formatDateTimeBR);
  });

  it("formatDateBR/formatDateTimeBR tratam ausência/data inválida sem lançar", () => {
    expect(formatDateBR(null)).toBe("-");
    expect(formatDateBR(undefined)).toBe("-");
    expect(formatDateTimeBR("data-invalida")).toBe("-");
  });
});

describe("searchDigits", () => {
  it("usa dígitos só quando o termo é numérico (documento/telefone)", () => {
    expect(searchDigits("11.222.333/0001-81")).toBe("11222333000181");
    expect(searchDigits("(11) 98765-4321")).toBe("11987654321");
    expect(searchDigits("123")).toBe("123");
  });
  it("ignora dígitos dentro de texto e termos curtos", () => {
    expect(searchDigits("Loja 2")).toBe("");
    expect(searchDigits("E2E Funil mgu12 x9k2a")).toBe("");
    expect(searchDigits("12")).toBe("");
    expect(searchDigits("")).toBe("");
  });
});
