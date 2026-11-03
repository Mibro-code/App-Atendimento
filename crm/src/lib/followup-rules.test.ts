import { describe, expect, it } from "vitest";
import { getAutomaticFollowUpSchedule, shouldMaterializeAutomaticFollowUp } from "./followup-rules";

const customer = {
  customerId: "customer-1",
  createdAt: new Date("2026-01-01T12:00:00.000Z"),
  lastInteractionAt: new Date("2026-06-01T12:00:00.000Z"),
  lastSaleAt: null,
};

describe("follow-up individual por vendedor", () => {
  it("calcula prazos diferentes para vendedores diferentes", () => {
    const joao = getAutomaticFollowUpSchedule(customer, 15, new Date("2026-07-01T12:00:00.000Z"));
    const maria = getAutomaticFollowUpSchedule(customer, 30, new Date("2026-07-01T12:00:00.000Z"));
    expect(joao.dueAt.toISOString()).toBe("2026-06-16T12:00:00.000Z");
    expect(maria.dueAt.toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(joao.dedupeKey).not.toBe(maria.dedupeKey);
  });

  it("gera chave estável para não duplicar o mesmo ciclo de inatividade", () => {
    const first = getAutomaticFollowUpSchedule(customer, 30);
    const second = getAutomaticFollowUpSchedule(customer, 30);
    expect(first.dedupeKey).toBe(second.dedupeKey);
  });
});

describe("materialização do follow-up", () => {
  it("não cria aviso futuro antes do primeiro contato", () => {
    expect(shouldMaterializeAutomaticFollowUp({ lastInteractionAt: null, lastSaleAt: null }, false)).toBe(false);
  });

  it("cria o aviso futuro imediatamente após o primeiro contato ou venda", () => {
    expect(shouldMaterializeAutomaticFollowUp({ lastInteractionAt: new Date(), lastSaleAt: null }, false)).toBe(true);
    expect(shouldMaterializeAutomaticFollowUp({ lastInteractionAt: null, lastSaleAt: new Date() }, false)).toBe(true);
  });
});
