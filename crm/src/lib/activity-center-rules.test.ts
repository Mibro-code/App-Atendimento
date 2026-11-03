import { describe, expect, it } from "vitest";
import { filterActivities, groupActivities, groupOf, summarizeByAssignee, type ActivityItem } from "./activity-center-rules";

// 21/10/2026 10:00 em São Paulo.
const NOW = new Date("2026-10-21T13:00:00.000Z");

function item(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    key: `CRM_AGENDA:${Math.random()}`, source: "CRM_AGENDA", id: "a", title: "Retorno", kind: "Follow-up",
    at: "2026-10-21T15:00:00.000Z", allDay: false, state: "PENDENTE", priority: "NORMAL",
    assignee: { key: "u1", name: "Ana" }, customer: null, company: null, conversationId: null, note: null,
    canEdit: true, completedAt: null, ...overrides,
  };
}

describe("Central de Atividades — agrupamento", () => {
  it("usa o dia de São Paulo, não o UTC", () => {
    // 22/10 01:30 UTC = 21/10 22:30 em São Paulo → ainda é hoje.
    expect(groupOf(item({ at: "2026-10-22T01:30:00.000Z" }), NOW)).toBe("HOJE");
    expect(groupOf(item({ at: "2026-10-22T13:00:00.000Z" }), NOW)).toBe("AMANHA");
    expect(groupOf(item({ at: "2026-10-25T13:00:00.000Z" }), NOW)).toBe("PROXIMOS");
  });

  it("atraso e conclusão vêm do estado da origem", () => {
    expect(groupOf(item({ state: "ATRASADO", at: "2026-10-01T13:00:00.000Z" }), NOW)).toBe("ATRASADAS");
    expect(groupOf(item({ state: "CONCLUIDO", at: "2026-10-30T13:00:00.000Z" }), NOW)).toBe("CONCLUIDAS");
  });

  it("ordena por horário e, no mesmo horário, pela prioridade", () => {
    const at = "2026-10-21T18:00:00.000Z";
    const groups = groupActivities([
      item({ key: "b", at, priority: "NORMAL" }),
      item({ key: "a", at, priority: "URGENTE" }),
      item({ key: "c", at: "2026-10-21T14:00:00.000Z" }),
    ], NOW);
    expect(groups.find((g) => g.group === "HOJE")!.items.map((i) => i.key)).toEqual(["c", "a", "b"]);
  });

  it("mantém um registro por atividade (sem mesclar origens diferentes)", () => {
    const groups = groupActivities([item({ key: "CENTRAL:1", source: "CENTRAL" }), item({ key: "CRM_AGENDA:1" })], NOW);
    expect(groups.flatMap((g) => g.items)).toHaveLength(2);
  });
});

describe("Central de Atividades — supervisor", () => {
  it("soma carga por responsável vinculado e conta pendentes sem responsável à parte", () => {
    const { rows, unassigned } = summarizeByAssignee([
      item({ source: "CENTRAL", assignee: { key: "u1", name: "Ana" }, state: "ATRASADO", at: "2026-10-20T13:00:00.000Z" }),
      item({ assignee: { key: "u1", name: "Ana" } }),
      item({ assignee: { key: "u2", name: "Bruno" }, state: "CONCLUIDO" }),
      item({ assignee: null }),
      item({ assignee: null, state: "CONCLUIDO" }),
    ], NOW);
    expect(rows[0]).toMatchObject({ key: "u1", pending: 2, overdue: 1, today: 1, done: 0 });
    expect(rows[1]).toMatchObject({ key: "u2", pending: 0, done: 1 });
    expect(unassigned).toBe(1);
  });
});

describe("Central de Atividades — filtros", () => {
  it("filtra por origem, prioridade e texto", () => {
    const items = [
      item({ key: "1", source: "CENTRAL", priority: "URGENTE", title: "Negociação · Loja Azul" }),
      item({ key: "2", source: "CRM_RECOMPRA", customer: { id: "c", name: "Mercado Sol" } }),
    ];
    expect(filterActivities(items, { source: "CENTRAL" }).map((i) => i.key)).toEqual(["1"]);
    expect(filterActivities(items, { priority: "ALTA_OU_MAIS" }).map((i) => i.key)).toEqual(["1"]);
    expect(filterActivities(items, { q: "sol" }).map((i) => i.key)).toEqual(["2"]);
  });
});
