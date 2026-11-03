// Explicit release operation. Importing this module never connects or writes.
const crypto = require('node:crypto');
const { buildAssistantDraftBundle } = require('../src/services/assistant-redesign-blueprint');
const { validateGraph } = require('../src/services/bot-visual-flow-graph');
const { REVISION } = require('../src/services/assistant-runtime-calendar');
const { MESSAGE } = require('../src/services/outside-hours-reception-service');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const botSelect = { id: true, companyId: true, status: true, autoReplyEnabled: true, archivedAt: true, updatedAt: true, featureFlags: true, outsideHoursMessage: true, holidayMessage: true };

async function prepare(db) {
  const assistant = await db.bot.findUnique({ where: { id: 'mibro-assistant-observer' }, select: botSelect });
  const triage = await db.bot.findUnique({ where: { id: 'system-triage-bot' }, select: { ...botSelect, type: true, schedules: true, holidays: true } });
  if (!assistant || !triage || assistant.companyId !== triage.companyId || triage.type !== 'SYSTEM_TRIAGE' || !triage.schedules.length) throw Error('Company/calendar precondition failed');
  if (assistant.status !== 'PAUSED' || assistant.autoReplyEnabled || assistant.archivedAt || triage.status !== 'ACTIVE' || !triage.autoReplyEnabled || triage.archivedAt) throw Error('Bot activation state changed; refusing automatic activation');
  const responses = await db.botResponse.findMany({ where: { companyId: assistant.companyId, active: true }, select: { key: true, title: true }, orderBy: { key: 'asc' } });
  const keys = new Set(responses.map(r => r.key));
  if (!keys.has('ASSIST_MIBRO_SUPORTE') || responses.filter(r => r.key.startsWith('ASSIST_MIBRO_PRODUTO_')).length !== 8) throw Error('Response catalog changed');
  const flowIds = Object.fromEntries(['main', 'router', 'technical', 'support', 'orders', 'resale', 'products', 'faq', 'closure'].map(key => [key, 'asst_20261027_' + key]));
  const bundle = buildAssistantDraftBundle({ flowIds, availableKeys: keys, products: responses.filter(r => r.key.startsWith('ASSIST_MIBRO_PRODUTO_')).map(r => ({ key: r.key, title: r.title, product: r.title.replace(/^Mibro\s+/i, '') })) });
  for (const f of bundle.flows) {
    const result = validateGraph(f.graph, { currentFlowId: f.id, flowIds: new Set(Object.values(flowIds)), responseKeys: keys });
    if (!result.valid) throw Error('Invalid graph: ' + f.key);
  }
  const defaults = await db.botFlow.findMany({ where: { botId: assistant.id, isDefault: true }, select: { id: true, updatedAt: true, activeVersionId: true }, orderBy: { id: 'asc' } });
  const remindersHash = digest(await db.afterHoursSettings.findMany({ orderBy: { id: 'asc' } }));
  return { revision: REVISION, assistant, triage, defaults, remindersHash, catalogHash: digest(responses), flows: bundle.flows };
}

async function install(db, expected) {
  return db.$transaction(async tx => {
    const current = await prepare(tx);
    if (current.assistant.featureFlags?.assistantCalendarRevision === REVISION) throw Error('Release already installed; use verify, never reinstall');
    if (digest(current) !== digest(expected)) throw Error('Configuration changed since preflight');
    const assistantFlags = { ...(current.assistant.featureFlags || {}), assistantCalendarRevision: REVISION, scheduleSourceBotId: current.triage.id, availabilityManaged: true, assistantAfterTriage: true };
    const triageFlags = { ...(current.triage.featureFlags || {}), assistantCalendarRevision: REVISION, outsideHoursReceptionRevision: REVISION, assistantBotId: current.assistant.id };
    for (const [bot, featureFlags] of [[current.assistant, assistantFlags], [current.triage, triageFlags]]) {
      const changed = await tx.bot.updateMany({ where: { id: bot.id, updatedAt: new Date(bot.updatedAt), status: bot.status, autoReplyEnabled: bot.autoReplyEnabled }, data: { featureFlags, ...(bot.id === current.triage.id ? { outsideHoursMessage: MESSAGE } : {}) } });
      if (changed.count !== 1) throw Error('Concurrent bot edit');
    }
    // Existing graphs and all versions remain untouched for recovery.
    await tx.botFlow.updateMany({ where: { botId: current.assistant.id, isDefault: true }, data: { isDefault: false } });
    for (const f of current.flows) {
      await tx.botFlow.create({ data: { id: f.id, botId: current.assistant.id, name: f.name, status: 'DRAFT', draftGraph: f.graph, isDefault: false, createdByName: 'Release 0.37.12' } });
      const version = await tx.botFlowVersion.create({ data: { id: f.id + '_v1', flowId: f.id, version: 1, graph: f.graph, label: 'Assistente modular • 0.37.12', publishedByName: 'Release 0.37.12' } });
      await tx.botFlow.update({ where: { id: f.id }, data: { status: 'ACTIVE', activeVersionId: version.id, isDefault: f.key === 'main' } });
    }
    if (current.remindersHash !== digest(await tx.afterHoursSettings.findMany({ orderBy: { id: 'asc' } }))) throw Error('Reminder settings changed');
    return { version: '0.37.12', revision: REVISION, installedFlows: current.flows.map(f => f.id), assistantPaused: true, assistantAutoReply: false, reminderSettingsUnchanged: true, migration: false };
  }, { timeout: 15000 });
}

module.exports = { prepare, install, digest };
if (require.main === module) {
  const fs = require('node:fs');
  const db = require('../src/database/prisma');
  (async () => {
    if (process.argv[2] === 'prepare') console.log(JSON.stringify(await prepare(db)));
    else if (process.argv[2] === 'install' && process.argv[3]) console.log(JSON.stringify(await install(db, JSON.parse(fs.readFileSync(process.argv[3], 'utf8')))));
    else throw Error('Use prepare or install <reviewed-plan.json>');
  })().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
}
