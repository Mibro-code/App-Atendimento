const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { skipPostTriageAssistant } = require('./attendance/src/services/post-triage-assistant-policy');
const bot = { id: 'mibro-assistant-observer' };
test('Mibro assistant skips Atacado only', () => {
  assert.equal(skipPostTriageAssistant(bot, { code: 'ATACADO' }), true);
  for (const code of ['COMERCIAL', 'VAREJO', 'SUPORTE', 'GARANTIA', 'ATENDIMENTO', 'PARCERIAS']) {
    assert.equal(skipPostTriageAssistant(bot, { code }), false);
  }
});
test('commercial reception, triage and Sincrofit are unchanged', () => {
  for (const id of ['commercial-number-welcome-bot', 'system-triage-bot', 'sincrofit-system-triage-20261022']) {
    assert.equal(skipPostTriageAssistant({ id }, { code: 'ATACADO' }), false);
  }
  assert.equal(skipPostTriageAssistant(null, null), false);
});
// Execute the actual entry function with all external dependencies mocked.
const source = fs.readFileSync(require.resolve('./attendance/src/services/bot-visual-flow-service'), 'utf8');
const entry = source.slice(source.indexOf('async function startPostTriageAssistant('), source.indexOf('// Hook do webhook do WhatsApp.'));
for (const code of ['ATACADO', 'SUPORTE', 'VAREJO', 'GARANTIA']) {
  test(`post-triage entry gate: ${code}`, async () => {
    let checks = 0;
    const sandbox = {
      prisma: { conversation: { findUnique: async () => ({ id: 'chat', status: 'NOVO', categoryId: 'category', category: { code, masterOnly: false } }) } },
      conversationInclude: {}, botIsAllowedToRespond: () => true,
      findStartBot: async () => ({ bot }), skipPostTriageAssistant,
      getGlobalSettings: async () => { checks++; return {}; },
      // Stop at eligibility for allowed categories: no providers or DB writes.
      botEligible: () => false,
    };
    const start = vm.runInNewContext(`(${entry})`, sandbox);
    assert.equal(await start({ triageExecution: { conversationId: 'chat' } }), false);
    assert.equal(checks, code === 'ATACADO' ? 0 : 1);
  });
}
