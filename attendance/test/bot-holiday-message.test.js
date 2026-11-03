const test = require("node:test");
const assert = require("node:assert/strict");
const { simulateTriage } = require("../src/services/triage-bot-service");
const { simulateBot } = require("../src/services/bot-simulator-service");

const holidayNow = new Date("2026-12-25T14:00:00-03:00");
const baseBot = {
  status: "ACTIVE",
  timezone: "America/Sao_Paulo",
  initialMessage: "Olá",
  outsideHoursMessage: "Mensagem fora do horário",
  holidayMessage: "Mensagem especial de feriado",
  fallbackMessage: "Fallback",
  schedules: [],
  holidays: [{ date: "2026-12-25", name: "Natal", enabled: true }],
  triageOptions: [],
  intents: [],
};

test("feriado usa mensagem personalizada no Bot de Triagem e no simulador comum", () => {
  assert.equal(simulateTriage(baseBot, { message: "Oi", now: holidayNow }).response, "Mensagem especial de feriado");
  assert.equal(simulateBot(baseBot, "Oi", { now: holidayNow }).response, "Mensagem especial de feriado");
});

test("feriado sem mensagem própria mantém fallback para fora do horário", () => {
  const bot = { ...baseBot, holidayMessage: null };
  assert.equal(simulateTriage(bot, { message: "Oi", now: holidayNow }).response, "Mensagem fora do horário");
  assert.equal(simulateBot(bot, "Oi", { now: holidayNow }).response, "Mensagem fora do horário");
});