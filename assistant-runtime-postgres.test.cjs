const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
// Deliberately refuses every database except this dedicated disposable container.
const url = 'postgresql://assistant_test:local_test_only@127.0.0.1:5561/assistant_test?schema=public';
if (process.env.ASSISTANT_DISPOSABLE_TEST !== '20261027') throw Error('Explicit disposable test flag required');
const { PrismaClient } = require('./attendance/node_modules/@prisma/client');
const db = new PrismaClient({ datasources: { db: { url } } });
const release = require('./attendance/scripts/assistant-release-20261027.cjs');
const reception = require('./attendance/src/services/outside-hours-reception-service');
const runtime = require('./attendance/src/services/assistant-runtime-calendar');
const { runTurn } = require('./attendance/src/services/bot-visual-flow-engine');
const catalog = require('../audit-vps-20261027/assistant-plan-20261027/reference-catalog.json');
const now = new Date('2026-10-30T21:00:00Z'); // Friday 18h, Sao Paulo
let plan, oldGraph;
before(async () => {
  assert.equal(await db.company.count(), 0, 'Disposable database must start empty');
  await db.company.createMany({ data: ['mibro', 'sincrofit'].map(slug => ({ id: 'test_' + slug, slug, name: slug, displayName: slug, primaryColor: '#ff5500' })) });
  for (const [id, type, status, enabled] of [['mibro-assistant-observer', 'STANDARD', 'PAUSED', false], ['system-triage-bot', 'SYSTEM_TRIAGE', 'ACTIVE', true]]) {
    await db.bot.create({ data: { id, companyId: 'test_mibro', name: id, type, status, autoReplyEnabled: enabled, channel: 'META', initialMessage: '', outsideHoursMessage: 'Existing notice preserved', fallbackMessage: '', featureFlags: {} } });
  }
  await db.botSchedule.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ botId: 'system-triage-bot', dayOfWeek, enabled: dayOfWeek > 0 && dayOfWeek < 6, startTime: '08:00', endTime: '17:00' })) });
  await db.botResponse.createMany({ data: catalog.responses.map(r => ({ ...r, companyId: 'test_mibro', text: 'Synthetic answer' })) });
  await db.afterHoursSettings.create({ data: { id: 'test_global', enabled: false } });
  oldGraph = { nodes: [], edges: [], unsavedOperatorWork: true };
  await db.botFlow.create({ data: { id: 'previous_flow', botId: 'mibro-assistant-observer', name: 'Previous', isDefault: true, draftGraph: oldGraph } });
  plan = await release.prepare(db);
});
after(() => db.$disconnect());

test('installation rejects drift atomically, then installs nine flows preserving disabled flags, drafts and reminder', async () => {
  await assert.rejects(release.install(db, { ...plan, catalogHash: 'changed' }), /changed since preflight/);
  assert.equal(await db.botFlow.count(), 1);
  const result = await release.install(db, plan);
  assert.equal(result.installedFlows.length, 9);
  assert.deepEqual((await db.botFlow.findUnique({ where: { id: 'previous_flow' } })).draftGraph, oldGraph);
  const bot = await db.bot.findUnique({ where: { id: 'mibro-assistant-observer' } });
  assert.equal(bot.status, 'PAUSED'); assert.equal(bot.autoReplyEnabled, false);
  assert.equal((await db.afterHoursSettings.findUnique({ where: { id: 'test_global' } })).enabled, false);
  assert.equal(await db.botFlow.count({ where: { botId: bot.id, isDefault: true } }), 1);
  await assert.rejects(release.install(db, plan), /already installed/);
});

async function fixture(label, companyId = 'test_mibro') {
  const account = await db.channelAccount.create({ data: { companyId, name: label, channel: 'META', enabled: true, status: 'CONNECTED' } });
  const contact = await db.contact.create({ data: { companyId, externalId: label, phone: '5500000000000', name: 'Synthetic' } });
  const conversation = await db.conversation.create({ data: { companyId, contactId: contact.id, channelAccountId: account.id, status: 'NOVO' }, include: { contact: true, channelAccount: true, category: true, botState: true } });
  const message = await db.message.create({ data: { conversationId: conversation.id, channelAccountId: account.id, channel: 'META', direction: 'RECEBIDA', status: 'RECEBIDA', type: 'text', text: 'Synthetic', occurredAt: now } });
  return { conversation, message };
}
function options(f, overrides = {}) {
  return { db, ...f, now, automationEnabled: true, automationStillEnabled: async () => true, isOptedOut: async () => false, assertWindow: async () => {}, privateStamp: async () => null, ...overrides };
}

test('concurrent inbound messages send one notice, survive midnight/restart and permit a new closed interval', async () => {
  const f = await fixture('concurrency'); let sends = 0;
  const opts = options(f, { send: async () => { sends++; return { externalId: 'wamid.synthetic.' + sends }; } });
  await Promise.all(Array.from({ length: 8 }, () => reception.receiveOutsideHours(opts)));
  assert.equal(sends, 1);
  await reception.receiveOutsideHours({ ...opts, now: new Date('2026-10-31T12:00:00Z') });
  assert.equal(sends, 1);
  await reception.receiveOutsideHours({ ...opts, now: new Date('2026-11-03T21:00:00Z') });
  assert.equal(sends, 2);
  assert.equal(await db.message.count({ where: { conversationId: f.conversation.id, direction: 'ENVIADA' } }), 2);
});

test('provider ambiguity is recorded once and never blindly retried', async () => {
  const f = await fixture('unknown'); let sends = 0;
  const opts = options(f, { send: async () => { sends++; throw Error('Network uncertain'); } });
  await reception.receiveOutsideHours(opts); await reception.receiveOutsideHours(opts);
  assert.equal(sends, 1);
  const marker = await db.conversationActivity.findFirst({ where: { conversationId: f.conversation.id } });
  assert.equal(marker.details.state, 'UNKNOWN');
});

test('historical primary number uses its own account and null-scoped window/storage', async () => {
  const f = await fixture('legacy');
  const legacy = await db.channelAccount.create({ data: { companyId: 'test_mibro', name: 'Legacy', channel: 'META', enabled: true, status: 'CONNECTED', config: { isLegacyWhatsApp: true } } });
  await db.conversation.update({ where: { id: f.conversation.id }, data: { channelAccountId: null } });
  f.conversation.channelAccountId = null; f.message.channelAccountId = null;
  let sent = false;
  await reception.receiveOutsideHours(options(f, { assertWindow: async (_id, _now, scope) => assert.equal(scope, null), send: async account => { assert.equal(account.id, legacy.id); sent = true; return { externalId: 'wamid.legacy' }; } }));
  assert.equal(sent, true);
  const outbound = await db.message.findFirst({ where: { conversationId: f.conversation.id, direction: 'ENVIADA' } });
  assert.equal(outbound.channelAccountId, null); assert.equal(outbound.externalId, 'wamid.legacy');
});

test('unified conversation replies on the inbound number without changing its selected sender', async () => {
  const f = await fixture('unified'); const original = f.conversation.channelAccountId;
  const inbound = await db.channelAccount.create({ data: { companyId: 'test_mibro', name: 'Incoming number', channel: 'META', enabled: true, status: 'CONNECTED' } });
  f.message.channelAccountId = inbound.id;
  let sent = false;
  await reception.receiveOutsideHours(options(f, { assertWindow: async (_id, _now, scope) => assert.equal(scope, inbound.id), send: async account => { assert.equal(account.id, inbound.id); sent = true; return { externalId: 'wamid.unified' }; } }));
  assert.equal(sent, true);
  assert.equal((await db.conversation.findUnique({ where: { id: f.conversation.id } })).channelAccountId, original);
});

test('no other company, disabled number, opt-out, expired window, human pause or kill switch can receive a notice', async () => {
  const foreign = await fixture('foreign', 'test_sincrofit');
  let sends = 0; const send = async () => { sends++; };
  assert.equal(await reception.receiveOutsideHours(options(foreign, { send })), false);
  const paused = await fixture('human');
  await db.conversationBotState.create({ data: { conversationId: paused.conversation.id, humanPausedAt: now } });
  await reception.receiveOutsideHours(options(paused, { send }));
  const disabled = await fixture('disabled');
  await db.channelAccount.update({ where: { id: disabled.conversation.channelAccountId }, data: { enabled: false } });
  await reception.receiveOutsideHours(options(disabled, { send }));
  await reception.receiveOutsideHours(options(await fixture('optout'), { send, isOptedOut: async () => true }));
  await reception.receiveOutsideHours(options(await fixture('expired'), { send, assertWindow: async () => { throw Error('Expired'); } }));
  await reception.receiveOutsideHours(options(await fixture('kill'), { send, automationStillEnabled: async () => false }));
  assert.equal(sends, 0);
});

test('closed calendar is shared, holidays override days and reopening stops reception', async () => {
  const bot = await db.bot.findUnique({ where: { id: 'mibro-assistant-observer' } });
  const resolved = await runtime.resolveCalendar(db, bot, now);
  // November 2 is a national holiday; next opening is Tuesday, not Monday.
  assert.equal(runtime.closedPeriod({ bot, ...resolved }, now), '2026-11-03T11:00:00.000Z');
  const f = await fixture('open'); let sends = 0;
  assert.equal(await reception.receiveOutsideHours(options(f, { now: new Date('2026-11-03T11:00:00Z'), send: async () => sends++ })), false);
  assert.equal(sends, 0);
});

test('simulation queues a closed assistant without a repeated notice, menu or timer', async () => {
  const calls = [];
  const result = await runTurn({ graph: plan.flows[0].graph, flow: { flowId: plan.flows[0].id }, seed: { bot: { availabilityManaged: true, withinBusinessHours: false, queueOutsideHours: true }, flow: {}, conversation: {} }, input: { type: 'START' }, adapter: { handoff: async value => calls.push(value), send: async () => { throw Error('No notice in engine'); } } });
  assert.equal(result.state.status, 'HANDED_OFF'); assert.equal(calls.length, 1); assert.equal(calls[0].message, '');
});
