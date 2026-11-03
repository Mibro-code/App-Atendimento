const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runTurn } = require('./attendance/src/services/bot-visual-flow-engine');
const { validateGraph } = require('./attendance/src/services/bot-visual-flow-graph');
const { withTechnicalAssistanceIntake, TECHNICAL_ASSISTANCE_MESSAGE } = require('./attendance/src/services/technical-assistance-intake');
const bot = { id: 'mibro-assistant-observer' };
const original = { nodes: [
  { key: 'start', type: 'start', name: 'Start', config: { trigger: 'AFTER_TRIAGE', initialMessage: '' } },
  { key: 'problem', type: 'question', name: 'Problema', config: { text: 'Como posso ajudar?', variable: 'flow.problem', answerType: 'TEXT', maxAttempts: 3 } },
  { key: 'human', type: 'human_handoff', name: 'Equipe', config: { message: '', reason: 'Equipe' } },
], edges: [
  { id: 's:p', source: 'start', sourceHandle: 'next', target: 'problem' },
  { id: 'p:h', source: 'problem', sourceHandle: 'next', target: 'human' },
] };
test('graph is valid, immutable and idempotent', () => {
  const before = JSON.stringify(original);
  const graph = withTechnicalAssistanceIntake(original, bot);
  const checked = validateGraph(graph);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  assert.equal(JSON.stringify(original), before);
  assert.equal(withTechnicalAssistanceIntake(graph, bot), graph);
  assert.equal(withTechnicalAssistanceIntake(original, { id: 'system-triage-bot' }), original);
});
async function turn(code, withinBusinessHours = true, state = null, graph = withTechnicalAssistanceIntake(original, bot)) {
  const messages = [], handoffs = [];
  // Live service refreshes system context from the new schedule on each turn.
  if (state) {
    state = JSON.parse(JSON.stringify(state));
    state.context.bot.withinBusinessHours = withinBusinessHours;
  }
  const result = await runTurn({
    graph, state,
    input: { type: state ? 'MESSAGE' : 'START', text: '' },
    seed: { conversation: { categoryCode: code }, flow: { initialCategoryId: 'technical-category' },
      bot: { assistantAfterTriage: true, availabilityManaged: true, withinBusinessHours, closedMessage: 'Fora do horário' } },
    adapter: { send: async text => messages.push(text), handoff: async data => { handoffs.push(data); return {}; } },
  });
  return { result, messages, handoffs };
}
test('technical assistance asks for SN, purchase location and NF; preserves destination', async () => {
  const { result, messages, handoffs } = await turn('1_ASSISTENCIA_TECNICA');
  assert.deepEqual(messages, [TECHNICAL_ASSISTANCE_MESSAGE]);
  assert.equal(result.state.status, 'HANDED_OFF');
  assert.equal(handoffs.length, 1); assert.equal(handoffs[0].categoryId, 'technical-category');
  assert.equal(handoffs[0].message, '');
  for (const text of ['Serial Number (SN)', 'AW012/12345678', 'estabelecimento', 'NF/DANFE', 'https://mibrobrasil.com.br/pages/check-sn']) assert.ok(messages[0].includes(text));
});
for (const code of ['GARANTIA', 'SUPORTE', 'VAREJO', 'ATENDIMENTO', 'ATACADO']) {
  test(`does not change the existing flow in ${code}`, async () => {
    const { result, messages, handoffs } = await turn(code);
    const baseline = await turn(code, true, null, original);
    assert.deepEqual(messages, baseline.messages); assert.equal(handoffs.length, 0);
    assert.equal(result.state.status, 'WAITING_CUSTOMER');
  });
}
test('outside-hours rule is preserved; checklist arrives only after reopening hours', async () => {
  const closed = await turn('1_ASSISTENCIA_TECNICA', false);
  assert.deepEqual(closed.messages, ['Fora do horário']); assert.equal(closed.handoffs.length, 0);
  const open = await turn('1_ASSISTENCIA_TECNICA', true, closed.result.state);
  assert.deepEqual(open.messages, [TECHNICAL_ASSISTANCE_MESSAGE]); assert.equal(open.handoffs.length, 1);
});
