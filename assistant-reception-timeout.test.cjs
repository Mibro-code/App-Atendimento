const { test } = require('node:test');
const assert = require('node:assert/strict');
const { boundedSend, noticeText } = require('./attendance/src/services/outside-hours-reception-service');
test('unresponsive provider has a bounded wait and no automatic retry', async () => {
  let calls = 0;
  await assert.rejects(boundedSend(() => { calls++; return new Promise(() => {}); }, 20), /OUTCOME_UNKNOWN/);
  assert.equal(calls, 1);
});
test('normal provider response passes through unchanged', async () => {
  const result = { externalId: 'synthetic' };
  assert.equal(await boundedSend(async () => result, 100), result);
});
test('initial notice remains editable in the bot and preserves a custom holiday notice', () => {
  const bot = { outsideHoursMessage: '{{saudacao}}! Retornaremos no próximo expediente.', holidayMessage: 'Aviso de feriado personalizado' };
  assert.equal(noticeText(bot, { contact: { name: 'Cliente Teste' } }, false), 'Olá, Cliente! Retornaremos no próximo expediente.');
  assert.equal(noticeText(bot, { contact: {} }, true), bot.holidayMessage);
});
