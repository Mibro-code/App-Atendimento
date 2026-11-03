import { describe, expect, it } from "vitest";
import { canDeleteSimulation, canRestoreSimulation, quoteRestoreDeadline } from "./quote-trash-rules";
describe("simulações excluídas", () => {
  const deleted = new Date("2026-10-05T15:00:00Z");
  it("supervisor exclui simulação apenas da própria equipe", () => {
    expect(canDeleteSimulation("SUPERVISOR", true, "SIMULATION")).toBe(true);
    expect(canDeleteSimulation("SUPERVISOR", false, "SIMULATION")).toBe(false);
  });
  it("vendedor e representante nunca excluem; cotação real nunca é excluída", () => {
    for (const role of ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR", "ADMIN"] as const) {
      expect(canDeleteSimulation(role, true, "REAL")).toBe(false);
    }
    expect(canDeleteSimulation("VENDEDOR", true, "SIMULATION")).toBe(false);
    expect(canDeleteSimulation("REPRESENTANTE", true, "SIMULATION")).toBe(false);
    expect(canDeleteSimulation("ADMIN", false, "SIMULATION")).toBe(true);
  });
  it("restauração é exclusiva de admin/master por até 7 dias corridos", () => {
    const deadline = quoteRestoreDeadline(deleted);
    expect(deadline.toISOString()).toBe("2026-10-12T15:00:00.000Z");
    expect(canRestoreSimulation("ADMIN", deleted, deadline)).toBe(true);
    expect(canRestoreSimulation("ADMIN", deleted, new Date(deadline.getTime() + 1))).toBe(false);
    expect(canRestoreSimulation("SUPERVISOR", deleted, deleted)).toBe(false);
    expect(canRestoreSimulation("ADMIN", null, deleted)).toBe(false);
  });
});
