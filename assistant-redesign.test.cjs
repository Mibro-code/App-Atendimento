const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildAssistantDraftBundle } = require('./attendance/src/services/assistant-redesign-blueprint');
const { assistantCalendar, planAssistantEntry, calendarMismatchWarnings } = require('./attendance/src/services/assistant-business-policy');
const { validateGraph } = require('./attendance/src/services/bot-visual-flow-graph');
const { runTurn } = require('./attendance/src/services/bot-visual-flow-engine');
const { withTechnicalAssistanceIntake } = require('./attendance/src/services/technical-assistance-intake');
const calendar = require('./attendance/src/services/business-hours-service');

const keys = new Set(['ASSIST_MIBRO_GARANTIA', 'ASSIST_MIBRO_TROCAS', 'ASSIST_MIBRO_PAGAMENTO', 'ASSIST_MIBRO_EMPRESA', 'ASSIST_MIBRO_SUPORTE', 'PRO1', 'PRO2']);
const products = [{ product: 'GS Pro', title: 'Mibro GS Pro', key: 'PRO1' }, { product: 'GS Pro 2', title: 'Mibro GS Pro 2', key: 'PRO2' }];
const bundle = buildAssistantDraftBundle({ availableKeys: keys, products });
const main = bundle.flows.find(f => f.key === 'main');
const responses = new Map([...keys].map(k => [k, `Resposta sintética ${k}`]));
const baseSeed = { bot: { assistantAfterTriage: true }, conversation: { categoryCode: 'COMERCIAL', categoryName: 'Comercial' }, flow: { initialCategoryId: 'sector-original' } };

async function simulate({ need = '', seed = {}, state, text, replyId } = {}) {
  const output = [], handoffs = [], finishes = [];
  const active = state ? bundle.flows.find(f => f.id === state.flow.flowId) : main;
  const result = await runTurn({
    graph: active.graph, flow: { flowId: active.id, name: active.name }, responses, state,
    seed: { ...baseSeed, ...seed, flow: { ...baseSeed.flow, initialNeed: need, ...(seed.flow || {}) } },
    input: state ? { type: 'MESSAGE', text: text || '', replyId } : { type: 'START' },
    adapter: {
      send: async text => output.push(text), sendMenu: async menu => output.push(menu),
      handoff: async x => handoffs.push(x), finish: async x => finishes.push(x),
      loadFlow: async id => { const f = bundle.flows.find(f => f.id === id); assert.ok(f); return { graph: f.graph, flowId: f.id, name: f.name }; },
    },
  });
  return { ...result, output, handoffs, finishes };
}

test('nine draft graphs validate, have real references and do not publish or replace a default', () => {
  assert.equal(bundle.flows.length, 9); assert.equal(bundle.activatesBot, false); assert.equal(bundle.publishesVersions, false);
  assert.equal(main.graph.nodes.length, 9);
  for (const f of bundle.flows) {
    assert.equal(f.status, 'DRAFT'); assert.equal(f.isDefault, false);
    const check = validateGraph(f.graph, { currentFlowId: f.id, flowIds: new Set(bundle.flows.map(x => x.id)), responseKeys: keys });
    assert.equal(check.valid, true, f.name + ': ' + JSON.stringify(check.errors));
  }
});

test('technical intake requests documents and starts collection without approving warranty', async () => {
  const result = await simulate({ seed: { conversation: { categoryCode: '1_ASSISTENCIA_TECNICA' } } });
    assert.equal(result.state.status, 'WAITING_CUSTOMER'); assert.equal(result.output.length, 2);
  assert.match(result.output[0], /Serial Number/); assert.match(result.output[0], /NF\/DANFE/);
    assert.equal(result.handoffs.length, 0); assert.equal(result.finishes.length, 0);
  assert.equal(withTechnicalAssistanceIntake(main.graph, { id: 'mibro-assistant-observer' }), main.graph);
});

test('wholesale remains human-only and sends no assistant greeting', async () => {
  const result = await simulate({ seed: { conversation: { categoryCode: 'ATACADO' } } });
  assert.equal(result.state.status, 'HANDED_OFF'); assert.equal(result.output.length, 0); assert.equal(result.finishes.length, 0);
});

test('reuses triage need and sends generic delivery-time question to freight FAQ, not order collection', async () => {
  const result = await simulate({ need: 'Qual o prazo de entrega e o frete?' });
  assert.ok(result.output.includes('Resposta sintética ASSIST_MIBRO_PAGAMENTO'));
  assert.equal(result.state.context.flow.customerProblem, 'Qual o prazo de entrega e o frete?');
  assert.equal(result.state.currentNodeKey, 'next'); assert.equal(result.state.flow.flowId, 'draft_assistant_closure');
  assert.ok(!result.output.some(x => typeof x === 'string' && /número do pedido|Conte sua/.test(x)));
});

test('changing a strap is treated as support, not a return', async () => {
  const result = await simulate({ need: 'Como trocar pulseira?' });
  assert.ok(result.output.includes('Resposta sintética ASSIST_MIBRO_SUPORTE'));
  assert.ok(!result.output.includes('Resposta sintética ASSIST_MIBRO_TROCAS')); assert.equal(result.state.currentNodeKey, 'ask');
});

test('known order is reused; explicit human request stops the flow immediately', async () => {
  const known = await simulate({ need: 'Onde está meu pedido?', seed: { flow: { orderNumber: 'synthetic-order' } } });
  assert.equal(known.state.status, 'HANDED_OFF'); assert.equal(known.output.length, 0);
  assert.match(known.handoffs[0].reason, /synthetic-order/);
  const human = await simulate({ need: 'quero falar com atendente' });
  assert.equal(human.state.status, 'HANDED_OFF'); assert.equal(human.output.length, 0);
});

test('similar models stay separate; unknown model shows a choice instead of fabricating a specification', async () => {
  const known = await simulate({ need: 'Quero conhecer os produtos', seed: { flow: { model: 'GS Pro 2' } } });
  assert.ok(known.output.includes('Resposta sintética PRO2')); assert.ok(!known.output.includes('Resposta sintética PRO1'));
  const unknown = await simulate({ need: 'Quero conhecer os produtos', seed: { flow: { model: 'GS Pro 3' } } });
  assert.equal(unknown.state.currentNodeKey, 'models'); assert.ok(!unknown.output.includes('Resposta sintética PRO1'));
});

test('another topic opens the menu without replaying the old answer; completion is explicit', async () => {
  const first = await simulate({ need: 'a empresa é oficial?' });
  const another = await simulate({ state: first.state, text: 'Outro assunto' });
  assert.equal(another.state.currentNodeKey, 'topics'); assert.ok(!another.output.includes('Resposta sintética ASSIST_MIBRO_EMPRESA'));
  const done = await simulate({ state: first.state, text: 'Encerrar' });
  assert.equal(done.state.status, 'COMPLETED'); assert.equal(done.finishes.length, 1);
});

test('missing library sources create valid human fallbacks instead of a fake answer', () => {
  const empty = buildAssistantDraftBundle();
  for (const f of empty.flows) assert.equal(validateGraph(f.graph, { responseKeys: new Set(), flowIds: new Set(empty.flows.map(f => f.id)), currentFlowId: f.id }).valid, true, f.name);
});

const bot = { id: 'mibro-assistant-observer', companyId: 'mibro', status: 'ACTIVE', autoReplyEnabled: true };
const triage = { id: 'triage-mibro', type: 'SYSTEM_TRIAGE', companyId: 'mibro', timezone: 'America/Sao_Paulo', schedules: [0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, enabled: dayOfWeek >= 1 && dayOfWeek <= 5, startTime: '08:00', endTime: '17:00' })) };
const conversation = { companyId: 'mibro', channel: 'META', status: 'NOVO', categoryCode: '1_ASSISTENCIA_TECNICA' };
const reminder = { enabled: false, timezone: 'America/Sao_Paulo', businessDays: [1, 2, 3, 4, 5], businessStartTime: '08:00', businessEndTime: '17:00', quietHoursEnabled: true, quietStartTime: '22:00', quietEndTime: '08:00' };
const availability = date => assistantCalendar({ bot, triage, companyId: 'mibro', now: new Date(date) });

test('company calendar handles Friday closing, weekend, holiday and exact reopening', () => {
  assert.equal(availability('2026-10-30T16:59:00-03:00').open, true);
  assert.equal(availability('2026-10-30T17:00:00-03:00').open, false);
  assert.equal(availability('2026-10-31T12:00:00-03:00').open, false);
  assert.equal(availability('2026-11-02T10:00:00-03:00').open, false);
  assert.equal(availability('2026-11-03T08:00:00-03:00').open, true);
});

test('missing schedule fails closed and schedules from another company cannot be inherited', () => {
  assert.equal(assistantCalendar({ bot, triage: { ...triage, schedules: [] }, companyId: 'mibro' }).configured, false);
  assert.equal(assistantCalendar({ bot, triage: { ...triage, companyId: 'sincrofit' }, companyId: 'mibro' }).configured, false);
  assert.equal(planAssistantEntry({ bot, conversation, globalAutomationEnabled: true, availability: { configured: true, companyId: 'sincrofit', open: true } }).action, 'BLOCK');
});

test('outside-hours policy reuses the notice and queues documents, without starting long menus or a second reminder worker', () => {
  const result = planAssistantEntry({ bot, conversation, availability: availability('2026-10-31T12:00:00-03:00'), globalAutomationEnabled: true, noticeAlreadySent: true });
  assert.equal(result.sendExistingNotice, false); assert.equal(result.collect, 'SN_PURCHASE_INVOICE_ONCE');
  assert.equal(result.startLongMenu, false); assert.equal(result.queueForHuman, true);
  assert.equal(result.reminderOwner, 'EXISTING_AFTER_HOURS_WORKER');
  assert.equal(planAssistantEntry({ bot: { ...bot, status: 'PAUSED' }, conversation, availability: availability('2026-10-31T12:00:00-03:00'), globalAutomationEnabled: true }).action, 'BLOCK');
  assert.equal(planAssistantEntry({ bot, conversation: { ...conversation, assignedUserId: 'human' }, availability: availability('2026-10-31T12:00:00-03:00'), globalAutomationEnabled: true }).action, 'BLOCK');
});

test('Friday 18h plus ten hours waits until Saturday 08h; Monday reopening is already business time', () => {
  const due = new Date(new Date('2026-10-30T18:00:00-03:00').getTime() + 600 * 60000);
  assert.equal(calendar.isQuietTime(due, reminder), true);
  assert.equal(calendar.quietHoursEnd(due, reminder).toISOString(), '2026-10-31T11:00:00.000Z');
  assert.equal(availability('2026-11-09T08:00:00-03:00').open, true);
  assert.equal(calendarMismatchWarnings(triage, reminder).length, 1); // disabled, not silently enabled
  assert.equal(calendarMismatchWarnings(triage, { ...reminder, businessEndTime: '18:00' }).length, 2);
});

test('editor describes paused bot, published flow and AFTER_TRIAGE as separate states', () => {
  const raw = fs.readFileSync('attendance/public/js/flow-builder.js', 'utf8');
  const code = raw.slice(raw.indexOf('  function describeResponseMode('), raw.indexOf('  function renderHeader()'));
  const context = {}; vm.createContext(context); vm.runInContext(code, context);
  const mode = context.describeResponseMode({ status: 'PAUSED', autoReplyEnabled: false }, { isDefault: true, activeVersion: 1, status: 'ACTIVE' }, main.graph);
  assert.match(mode.entry, /após a triagem/); assert.match(mode.status, /pausado/);
  assert.ok(!mode.status.includes('Bot respondendo clientes'));
});
