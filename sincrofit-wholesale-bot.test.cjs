const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const policy = require('./attendance/src/services/sincrofit-wholesale-bot');
const installer = require('./attendance/scripts/sincrofit-wholesale-install-20261028.cjs');
const { runTurn } = require('./attendance/src/services/bot-visual-flow-engine');
const { validateGraph } = require('./attendance/src/services/bot-visual-flow-graph');
const entry = { type: 'text', text: 'Quero comprar no atacado' };
const conversation = () => ({ id: 'test-chat', companyId: policy.COMPANY_ID, channel: 'META', status: 'NOVO', categoryId: null, assignedUserId: null, channelAccountId: 'test-number', channelAccount: { config: { inboundBotId: policy.TRIAGE_ID } } });
const bot = () => ({ id: policy.BOT_ID, companyId: policy.COMPANY_ID, status: 'ACTIVE', autoReplyEnabled: true, runAfterReopen: true, runOnNewConversation: true, featureFlags: { channelAccountIds: ['test-number'] } });

test('only the exact normalized wholesale phrase in an untouched Sincrofit chat matches', () => {
  const c = conversation();
  assert.ok(policy.matchesEntry(c, { ...entry, text: ' QUERO comprar no ATACADO!!! ' }));
  for (const change of [{ companyId: 'cmp_mibro' }, { channel: 'EMAIL' }, { status: 'EM_ATENDIMENTO' }, { categoryId: 'manual-category' }, { assignedUserId: 'seller' }, { botState: { humanPausedAt: new Date() } }, { botState: { activeBotId: 'campaign-bot' } }]) assert.equal(policy.matchesEntry({ ...c, ...change }, entry), false);
  for (const text of ['Não quero comprar no atacado', 'Olá! Posso ter mais informações sobre isso?', 'Quero comprar no atacado amanhã']) assert.equal(policy.matchesEntry(c, { ...entry, text }), false);
  assert.equal(policy.matchesEntry(c, { type: 'image', text: entry.text }), false);
});
test('account/company binding never bypasses another custom bot', () => {
  assert.ok(policy.belongsToAccount(bot(), conversation()));
  assert.equal(policy.belongsToAccount(bot(), { ...conversation(), channelAccountId: 'other' }), false);
  assert.equal(policy.belongsToAccount(bot(), { ...conversation(), companyId: 'cmp_mibro' }), false);
  assert.equal(policy.belongsToAccount(bot(), { ...conversation(), channelAccount: { config: { inboundBotId: 'custom' } } }), false);
});
test('valid graph transfers once, with open or closed-hours confirmation and no triage menu', async () => {
  const graph = policy.wholesaleGraph('test-atacado');
  assert.equal(validateGraph(graph).valid, true);
  for (const open of [true, false]) {
    const transfers = [], messages = [];
    const result = await runTurn({ graph, input: { type: 'START', text: entry.text }, seed: { bot: { withinBusinessHours: open } },
      adapter: { send: async t => messages.push(t), categoryName: async () => 'Atacado', transferToCategory: async data => { transfers.push(data); return { categoryId: data.categoryId }; } } });
    assert.equal(result.state.status, 'HANDED_OFF');
    assert.equal(transfers.length, 1); assert.equal(transfers[0].categoryId, 'test-atacado');
    assert.equal(transfers[0].message, open ? policy.REPLY : policy.CLOSED_REPLY);
    assert.deepEqual(messages, []);
  }
});

function runtimeFixture({ text = entry.text, automation = true, active = null, consumed = false, claimed = 0 } = {}) {
  const calls = { reception: 0, defaultQueries: 0, claims: 0, executions: 0 };
  const c = conversation();
  const b = bot();
  const flow = { id: 'test-flow', name: 'Atacado', activeVersion: { id: 'version', graph: policy.wholesaleGraph('cat') } };
  const db = {
    conversation: { findUnique: async () => c, updateMany: async () => { calls.claims++; return { count: claimed }; } },
    bot: { findUnique: async () => b, findMany: async q => { calls.defaultQueries++; assert.equal(q.where.NOT.id, policy.BOT_ID); return []; } },
    botFlow: { findFirst: async () => flow },
    conversationActivity: { findFirst: async () => null },
    botFlowExecution: { findFirst: async q => q.where.status ? active : (consumed ? { id: 'consumed' } : null), count: async () => 0 },
  };
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === '../database/prisma') return db;
    if (name === './sincrofit-wholesale-bot') return policy;
    if (name === './bot-visual-flow-engine') return require('./attendance/src/services/bot-visual-flow-engine');
    if (name === './bot-governance-service') return { getGlobalSettings: async () => ({ automationEnabled: automation }) };
    if (name === './outside-hours-reception-service') return { receiveOutsideHours: async () => { calls.reception++; return false; } };
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('./attendance/src/services/bot-visual-flow-service'), 'utf8'), sandbox);
  return { calls, c, b, run: () => sandbox.module.exports.handleIncomingVisualFlow({ type: 'text', text }, { id: 'inbound', conversationId: c.id, channelAccountId: c.channelAccountId }, {}) };
}
test('actual incoming hook chooses dedicated bot, preserving original default routing for other text', async () => {
  const f = runtimeFixture(); await f.run();
  assert.equal(f.calls.claims, 1); assert.equal(f.calls.defaultQueries, 0); assert.equal(f.calls.reception, 0);
  const other = runtimeFixture({ text: 'Olá! Posso ter mais informações sobre isso?' }); await other.run();
  assert.equal(other.calls.defaultQueries, 1); assert.equal(other.calls.reception, 1); assert.equal(other.calls.claims, 0);
});
test('actual hook respects kill switch, duplicate delivery, human claims and manual categories', async () => {
  for (const options of [{ automation: false }, { consumed: true }]) {
    const f = runtimeFixture(options); await f.run(); assert.equal(f.calls.claims, 0);
  }
  for (const change of [{ assignedUserId: 'seller' }, { categoryId: 'manual-category' }, { botState: { humanPausedAt: new Date() } }]) {
    const f = runtimeFixture(); Object.assign(f.c, change); await f.run(); assert.equal(f.calls.claims, 0);
  }
});
test('paused bot and disabled new/reopen settings fall back without claiming', async () => {
  for (const change of [{ status: 'PAUSED' }, { autoReplyEnabled: false }, { runOnNewConversation: false }]) {
    const f = runtimeFixture(); Object.assign(f.b, change); await f.run(); assert.equal(f.calls.claims, 0);
  }
});

function installFixture() {
  const writes = [];
  const triage = { id: policy.TRIAGE_ID, companyId: policy.COMPANY_ID, type: 'SYSTEM_TRIAGE', schedules: [{ dayOfWeek: 1 }], status: 'ACTIVE' };
  const category = { id: 'cat', parentId: 'parent', parent: { companyId: policy.COMPANY_ID, active: true, name: 'Comercial' } };
  const db = { bot: { findUnique: async q => q.where.id === policy.BOT_ID ? null : triage, create: async q => writes.push(q) }, category: { findMany: async () => [category] }, channelAccount: { findMany: async q => { assert.equal(q.where.enabled, true); return [{ id: 'number', config: { inboundBotId: policy.TRIAGE_ID } }]; } }, botFlow: { create: async q => writes.push(q), update: async q => writes.push(q) }, botFlowVersion: { create: async q => { writes.push(q); return { id: 'version' }; } }, $transaction: async (fn, opts) => { assert.equal(opts.isolationLevel, 'Serializable'); return fn(db); } };
  return { db, triage, category, writes };
}
test('installation creates only new bot/flow/version; fails before writes on drift or wrong destination', async () => {
  const f = installFixture(), plan = await installer.prepare(f.db), before = JSON.stringify(f.triage);
  await installer.install(f.db, plan); assert.equal(f.writes.length, 4); assert.equal(JSON.stringify(f.triage), before);
  const changed = installFixture(), old = await installer.prepare(changed.db); changed.triage.status = 'PAUSED';
  await assert.rejects(installer.install(changed.db, old), /mudou/); assert.equal(changed.writes.length, 0);
  const wrong = installFixture(); wrong.category.parent.companyId = 'cmp_mibro';
  await assert.rejects(installer.prepare(wrong.db), /categoria/); assert.equal(wrong.writes.length, 0);
});
