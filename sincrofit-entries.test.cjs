const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const patterns = require('./attendance/src/services/sincrofit-entry-patterns');
const { runTurn } = require('./attendance/src/services/bot-visual-flow-engine');
const { validateGraph } = require('./attendance/src/services/bot-visual-flow-graph');
const bot = { id: 'sincrofit-system-triage-20261022' };
const graph = { nodes: [
  { key: 'start', type: 'start', name: 'Recepção', config: { trigger: 'NEW_CONVERSATION', initialMessage: 'Olá, Sincrofit!' } },
  { key: 'question', type: 'question', name: 'Setor', config: { text: 'Escolha o setor', variable: 'flow.sector', answerType: 'TEXT', maxAttempts: 3 } },
  { key: 'human', type: 'human_handoff', name: 'Equipe', config: { message: '', reason: 'Setor escolhido' } },
], edges: [
  { id: 'a', source: 'start', sourceHandle: 'next', target: 'question' },
  { id: 'b', source: 'question', sourceHandle: 'next', target: 'human' },
] };
test('phrases match accents/case/spacing/punctuation, not unrelated sentences', () => {
  assert.equal(patterns.entryPattern(' OLÁ! Posso ter mais informacoes sobre isso? '), 'information');
  assert.equal(patterns.entryPattern('Quero comprar no atacado'), 'wholesale');
  assert.equal(patterns.entryPattern('Não quero comprar no atacado'), null);
  assert.equal(patterns.entryPattern('Posso ter informações sobre garantia?'), null);
});
test('graph is valid, immutable, idempotent and Sincrofit only', () => {
  const before = JSON.stringify(graph), transformed = patterns.withSincrofitEntryReply(graph, bot);
  const checked = validateGraph(transformed);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  assert.equal(JSON.stringify(graph), before);
  assert.equal(patterns.withSincrofitEntryReply(transformed, bot), transformed);
  assert.equal(patterns.withSincrofitEntryReply(graph, { id: 'system-triage-bot' }), graph);
});
async function execute(text, { original = false, hours = true, state = null } = {}) {
  const messages = [], handoffs = [];
  const input = { type: state ? 'MESSAGE' : 'START', text };
  const seed = patterns.seedEntryPattern({ flow: {}, bot: { availabilityManaged: true, withinBusinessHours: hours, closedMessage: 'Fora do horário' } }, bot, input);
  if (state) { state = structuredClone(state); state.context.bot.withinBusinessHours = hours; }
  const result = await runTurn({ graph: original ? graph : patterns.withSincrofitEntryReply(graph, bot), input, state, seed,
    adapter: { send: async text => messages.push(text), handoff: async data => { handoffs.push(data); return {}; } } });
  return { result, messages, handoffs };
}
test('information entry gets the site only, then human handoff', async () => {
  const actual = await execute(patterns.PATTERNS[1].label);
  assert.deepEqual(actual.messages, [patterns.INFORMATION_REPLY]);
  assert.equal(actual.handoffs.length, 1); assert.equal(actual.result.state.status, 'HANDED_OFF');
});
for (const text of ['Quero comprar no atacado', 'Bom dia']) test(`preserves original triage for: ${text}`, async () => {
  const actual = await execute(text), before = await execute(text, { original: true });
  assert.deepEqual(actual.messages, before.messages); assert.equal(actual.result.state.status, before.result.state.status);
});
test('outside-hours wait preserves initial entry on the next customer message', async () => {
  const closed = await execute(patterns.PATTERNS[1].label, { hours: false });
  assert.deepEqual(closed.messages, ['Fora do horário']);
  const open = await execute('Bom dia', { state: closed.result.state });
  assert.deepEqual(open.messages, [patterns.INFORMATION_REPLY]);
});
// Import only the report's business logic, mocking the existing private-record
// scope. No Prisma connection, provider, server or data fixture is created.
const reportPath = require.resolve('./attendance/src/services/sincrofit-entry-report-service');
const localRequire = createRequire(reportPath), sandbox = { module: { exports: {} }, require: name => {
  if (name === './private-segment-service') return { readableWhere: ids => ids === null ? {} : { privateCategoryId: null } };
  return localRequire(name);
} };
vm.runInNewContext(fs.readFileSync(reportPath, 'utf8'), sandbox);
const { aggregateEntries, getEntryReport } = sandbox.module.exports;
const row = (contactId, pattern) => ({ text: patterns.PATTERNS.find(p => p.id === pattern).label, conversation: { contactId } });
test('counts each contact once per phrase, separately from repeated messages', () => {
  const data = aggregateEntries([row('a', 'information'), row('a', 'information'), row('a', 'wholesale'), row('b', 'wholesale')]);
  assert.equal(data.uniqueContacts, 2);
  assert.equal(data.items[0].count, 2); assert.equal(data.items[0].messages, 2);
  assert.equal(data.items[1].count, 1); assert.equal(data.items[1].messages, 2);
  assert.equal(aggregateEntries([row('a', 'information'), row('b', 'wholesale')], 'information').uniqueContacts, 1);
});
const access = { companyIds: ['sincro'], forcedAgentId: 'self', scope: { assignedUserId: 'self' }, readablePrivateIds: [] };
test('query enforces account/company/private/self scope and date bounds', async () => {
  let query;
  const data = await getEntryReport(access, { agentId: 'someone-else', period: 'today', status: 'NOVO', channel: 'EMAIL' }, {
    channelAccount: { findMany: async ({ where }) => { assert.equal(where.companyId.in[0], 'sincro'); assert.equal(where.company.is.slug, 'sincrofit'); return [{ id: 'number' }]; } },
    message: { findMany: async q => { query = q; return []; } },
  });
  const text = JSON.stringify(query.where);
  assert.ok(text.includes('"assignedUserId":"self"')); assert.ok(!text.includes('someone-else'));
  assert.ok(text.includes('"privateCategoryId":null')); assert.ok(text.includes('"channel":"EMAIL"'));
  assert.ok(text.includes('"channel":"META"')); assert.ok(text.includes('number')); assert.ok(text.includes('sincrofit'));
  assert.ok(query.where.AND[1].occurredAt.lt > query.where.AND[1].occurredAt.gte);
  assert.equal(data.uniqueContacts, 0); assert.equal(query.take, 20001);
  assert.equal(query.select.text, true); assert.equal(query.select.conversation.select.contactId, true);
});
test('no authorized Sincrofit number means no message query', async () => {
  const data = await getEntryReport(access, {}, { channelAccount: { findMany: async () => [] }, message: { findMany: () => { throw Error('Must not read'); } } });
  assert.equal(data.uniqueContacts, 0);
});
test('oversized result is explicitly unavailable, never a partial total', async () => {
  const data = await getEntryReport(access, {}, { channelAccount: { findMany: async () => [{ id: 'number' }] }, message: { findMany: async () => Array(20001).fill(row('a', 'information')) } });
  assert.equal(data.truncated, true); assert.equal(data.uniqueContacts, undefined);
});
test('rejects unsupported phrase filter', async () => {
  await assert.rejects(getEntryReport(access, { entryPattern: 'unknown' }, {}), /inválida/);
});

function browserHarness(api) {
  const elements = {
    '#sincrofit-entries-summary': { textContent: '' },
    '#sincrofit-entry-bars': { replaceChildren() {} },
    '#sincrofit-entries-panel': { hidden: false },
    '#sincrofit-entry-pattern': { value: '', addEventListener() {} },
  };
  const source = fs.readFileSync(require.resolve('./attendance/public/js/relatorio-conversas.js'), 'utf8');
  const part = source.slice(source.indexOf('let sincrofitEntriesRequest = 0;'), source.indexOf('async function loadAll()'));
  const context = {
    $: key => elements[key], $$: () => [], api, state: { company: 'sincrofit' },
    filterContext: { companies: [{ id: 'sincro', slug: 'sincrofit' }, { id: 'mibro', slug: 'mibro' }] },
    queryFromState: extra => new URLSearchParams({ period: '7d', ...extra }).toString(),
    renderRank: (_id, items) => { context.rendered = items; },
  };
  vm.runInNewContext(part, context);
  return { context, elements, load: () => context.loadSincrofitEntries() };
}
const chartData = { period: { label: 'Últimos 7 dias' }, uniqueContacts: 2, items: [{ count: 2, messages: 3, label: 'Mais informações' }] };
test('chart loads period/phrase filter and hides for Mibro', async () => {
  let calls = 0;
  const h = browserHarness(async url => { calls++; assert.ok(url.includes('period=7d')); assert.ok(url.includes('entryPattern=information')); return chartData; });
  h.elements['#sincrofit-entry-pattern'].value = 'information';
  await h.load(); assert.ok(h.elements['#sincrofit-entries-summary'].textContent.includes('2 contato(s)'));
  assert.equal(h.context.rendered, chartData.items);
  h.context.state.company = 'mibro'; await h.load();
  assert.equal(h.elements['#sincrofit-entries-panel'].hidden, true); assert.equal(calls, 1);
});
test('chart ignores stale filter responses', async () => {
  let release;
  const oldResponse = new Promise(resolve => { release = resolve; }); let calls = 0;
  const h = browserHarness(async () => ++calls === 1 ? oldResponse : chartData);
  const old = h.load(); await h.load();
  release({ ...chartData, uniqueContacts: 99 }); await old;
  assert.ok(h.elements['#sincrofit-entries-summary'].textContent.includes('2 contato(s)'));
});
test('chart shows errors and oversized periods without fabricated totals', async () => {
  const h = browserHarness(async () => { throw Error('Falha temporária'); });
  await h.load(); assert.ok(h.elements['#sincrofit-entries-summary'].textContent.includes('Falha temporária'));
  h.context.api = async () => ({ truncated: true }); await h.load();
  assert.ok(h.elements['#sincrofit-entries-summary'].textContent.includes('Reduza o período'));
  assert.equal(h.context.rendered, undefined);
});
