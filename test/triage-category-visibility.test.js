const test = require("node:test");
const assert = require("node:assert/strict");
const { simulateTriage } = require("../src/services/triage-bot-service");

function option(id, overrides = {}) {
  return {
    categoryId: id, label: id, enabled: true,
    category: { id, code: id, name: id, active: true, masterOnly: false, parent: null },
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

test("triagem oferece subcategoria liberada e ignora categorias restritas", () => {
  const visibleChild = option("CHILD", { category: {
    id: "CHILD", code: "CHILD", name: "Filho", active: true, masterOnly: false,
    parent: { active: true, masterOnly: false },
  } });
  const restricted = option("TESTE", { category: {
    id: "TESTE", code: "TESTE", name: "TESTE", active: true, masterOnly: true, parent: null,
  } });
  const restrictedParentChild = option("HIDDEN_CHILD", { category: {
    id: "HIDDEN_CHILD", code: "HIDDEN_CHILD", name: "Filho oculto", active: true, masterOnly: false,
    parent: { active: true, masterOnly: true },
  } });
  const result = simulateTriage(bot([visibleChild, restricted, restrictedParentChild]), {
    now: new Date("2026-09-03T12:00:00.000Z"),
  });
  assert.deepEqual(result.options.map(({ id }) => id), ["CHILD"]);
  assert.equal(simulateTriage(bot([visibleChild]), {
    replyId: "CHILD", now: new Date("2026-09-03T12:00:00.000Z"),
  }).category.id, "CHILD");
});
