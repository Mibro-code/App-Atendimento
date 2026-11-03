// Explicit installation only. Importing has no I/O; does not modify existing bots.
const crypto = require('node:crypto');
const { BOT_ID, TRIAGE_ID, COMPANY_ID, wholesaleGraph } = require('../src/services/sincrofit-wholesale-bot');
const { REVISION } = require('../src/services/assistant-runtime-calendar');
const { validateGraph } = require('../src/services/bot-visual-flow-graph');
const FLOW_ID = BOT_ID + '-flow';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
async function prepare(db) {
  if (await db.bot.findUnique({ where: { id: BOT_ID } })) throw Error('Bot já existe; revisar sem reinstalar');
  const triage = await db.bot.findUnique({ where: { id: TRIAGE_ID }, include: { schedules: true, holidays: true } });
  if (!triage || triage.companyId !== COMPANY_ID || triage.type !== 'SYSTEM_TRIAGE' || triage.archivedAt || !triage.schedules?.length) throw Error('Triagem/calendário Sincrofit inválido');
  const categories = await db.category.findMany({ where: { companyId: COMPANY_ID, code: 'ATACADO', active: true, masterOnly: false }, include: { parent: true } });
  if (categories.length !== 1 || categories[0].parent?.companyId !== COMPANY_ID || !categories[0].parent.active || categories[0].parent.masterOnly || !/comercial/i.test(categories[0].parent.name)) throw Error('Revisar categoria Comercial → Atacado da Sincrofit');
  const category = categories[0];
  const accounts = (await db.channelAccount.findMany({ where: { companyId: COMPANY_ID, channel: 'META', enabled: true }, select: { id: true, config: true, updatedAt: true }, orderBy: { id: 'asc' } })).filter(a => {
    const bound = a.config?.inboundBotId;
    const allowed = a.config?.allowedCategoryIds || [];
    return (!bound || bound === TRIAGE_ID) && (!allowed.length || allowed.includes(category.id) || allowed.includes(category.parentId));
  });
  if (!accounts.length) throw Error('Nenhum número Sincrofit compatível com o destino');
  const graph = wholesaleGraph(category.id);
  const checked = validateGraph(graph);
  if (!checked.valid) throw Error('Grafo inválido: ' + JSON.stringify(checked.errors));
  // Only hashes of existing configuration leave preflight; no credentials.
  return { categoryId: category.id, accountIds: accounts.map(a => a.id), sourceHash: hash({ triage, category, accounts }), graph };
}
async function install(db, expected) {
  return db.$transaction(async tx => {
    const plan = await prepare(tx);
    if (hash(plan) !== hash(expected)) throw Error('Configuração mudou desde a revisão');
    await tx.bot.create({ data: {
      id: BOT_ID, companyId: COMPANY_ID, name: 'Sincrofit • Entrada Atacado', type: 'STANDARD', status: 'ACTIVE', channel: 'META',
      initialMessage: '', outsideHoursMessage: '', fallbackMessage: '', autoReplyEnabled: true, runOnNewConversation: true, runAfterReopen: true,
      featureFlags: { channelAccountIds: plan.accountIds, assistantCalendarRevision: REVISION, scheduleSourceBotId: TRIAGE_ID, availabilityManaged: false },
    } });
    await tx.botFlow.create({ data: { id: FLOW_ID, botId: BOT_ID, name: 'Quero comprar no atacado → Comercial Atacado', draftGraph: plan.graph, status: 'DRAFT' } });
    const version = await tx.botFlowVersion.create({ data: { flowId: FLOW_ID, version: 1, graph: plan.graph, label: 'Entrada Atacado Sincrofit', publishedByName: 'Instalação revisada' } });
    await tx.botFlow.update({ where: { id: FLOW_ID }, data: { activeVersionId: version.id, isDefault: true, status: 'ACTIVE' } });
    return { botId: BOT_ID, flowId: FLOW_ID, categoryId: plan.categoryId, accountIds: plan.accountIds, existingBotsUnchanged: true };
  }, { isolationLevel: 'Serializable', timeout: 15000 });
}
module.exports = { prepare, install };
