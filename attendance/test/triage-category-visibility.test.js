const test = require("node:test");
const assert = require("node:assert/strict");
const { simulateTriage } = require("../src/services/triage-bot-service");

function option(id, overrides = {}) {
  return {
    categoryId: id, label: id, enabled: true,
    category: { id, code: id, name: id, active: true, masterOnly: false, parentId: null, parent: null },
    ...overrides,
  };
}

function bot(options) {
  return {
    status: "ACTIVE", timezone: "UTC", holidays: [],
    schedules: [{ dayOfWeek: 4, startTime: "00:00", endTime: "23:59", enabled: true }],
    initialMessage: "Escolha", outsideHoursMessage: "Fechado", fallbackMessage: "Fallback",
    handoffMessage: "Destino {{categoria}}", triageOptions: options,
  };
}

test("triagem oferece categoria e depois somente subcategorias liberadas", () => {
  const visibleChild = option("CHILD", { category: {
    id: "CHILD", code: "CHILD", name: "Filho", active: true, masterOnly: false, parentId: "ROOT",
    parent: { id: "ROOT", code: "ROOT", name: "Suporte", active: true, masterOnly: false },
  } });
  const root = option("ROOT", { label: "Suporte" });
  const restricted = option("TESTE", { category: {
    id: "TESTE", code: "TESTE", name: "TESTE", active: true, masterOnly: true, parentId: null, parent: null,
  } });
  const restrictedParentChild = option("HIDDEN_CHILD", { category: {
    id: "HIDDEN_CHILD", code: "HIDDEN_CHILD", name: "Filho oculto", active: true, masterOnly: false,
    parentId: "HIDDEN_ROOT",
    parent: { id: "HIDDEN_ROOT", name: "Oculta", active: true, masterOnly: true },
  } });
  const result = simulateTriage(bot([root, visibleChild, restricted, restrictedParentChild]), {
    now: new Date("2026-09-03T12:00:00.000Z"),
  });
  assert.deepEqual(result.options.map(({ id }) => id), ["ROOT"]);
  const subcategories = simulateTriage(bot([root, visibleChild]), {
    replyId: "ROOT", now: new Date("2026-09-03T12:00:00.000Z"),
  });
  assert.equal(subcategories.step, "SUBCATEGORY");
  assert.deepEqual(subcategories.options.map(({ id }) => id), ["CHILD"]);
  assert.equal(simulateTriage(bot([root, visibleChild]), {
    replyId: "CHILD", now: new Date("2026-09-03T12:00:00.000Z"),
  }).category.id, "CHILD");
});
