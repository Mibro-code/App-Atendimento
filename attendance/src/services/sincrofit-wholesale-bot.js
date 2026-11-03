// Dedicated entry bot. Importing never connects to a database or sends messages.
const { entryPattern } = require('./sincrofit-entry-patterns');
const BOT_ID = 'sincrofit-wholesale-entry-20261028';
const TRIAGE_ID = 'sincrofit-system-triage-20261022';
const COMPANY_ID = 'cmp_sincrofit';
const REPLY = 'Entendido! Encaminhamos sua solicitação para o Comercial Atacado. Em breve, um atendente dará continuidade ao seu atendimento por aqui.';
const CLOSED_REPLY = 'Entendido! Encaminhamos sua solicitação para o Comercial Atacado. Estamos fora do horário de atendimento; nossa equipe continuará a conversa no próximo expediente.';

function belongsToAccount(bot, conversation) {
  const bound = conversation.channelAccount?.config?.inboundBotId;
  return Boolean(bot?.id === BOT_ID && bot.companyId === COMPANY_ID && conversation.companyId === COMPANY_ID &&
    conversation.channel === 'META' && conversation.channelAccountId &&
    Array.isArray(bot.featureFlags?.channelAccountIds) && bot.featureFlags.channelAccountIds.includes(conversation.channelAccountId) &&
    (!bound || bound === TRIAGE_ID || bound === BOT_ID));
}
function matchesEntry(conversation, event) {
  return conversation.companyId === COMPANY_ID && conversation.channel === 'META' && event.type === 'text' &&
    entryPattern(event.text) === 'wholesale' && !conversation.archivedAt && conversation.status === 'NOVO' && !conversation.categoryId &&
    !conversation.assignedUserId && !conversation.botState?.humanPausedAt &&
    (!conversation.botState?.activeBotId || conversation.botState.activeBotId === BOT_ID);
}
async function findTarget(db, conversation, event) {
  if (!matchesEntry(conversation, event)) return null;
  const bot = await db.bot.findUnique({ where: { id: BOT_ID }, include: { schedules: true, holidays: true } });
  if (!belongsToAccount(bot, conversation) || bot.archivedAt || bot.status !== 'ACTIVE' || !bot.autoReplyEnabled) return null;
  const reopened = await db.conversationActivity.findFirst({ where: { conversationId: conversation.id, action: 'REOPENED_BY_CUSTOMER_MESSAGE' }, select: { id: true } });
  if (reopened ? !bot.runAfterReopen : !bot.runOnNewConversation) return null;
  const flow = await db.botFlow.findFirst({ where: { botId: BOT_ID, archivedAt: null, isDefault: true, status: 'ACTIVE', activeVersionId: { not: null } }, include: { activeVersion: true } });
  return flow?.activeVersion ? { bot, flow, version: flow.activeVersion } : null;
}
function wholesaleGraph(categoryId) {
  if (!categoryId) throw Error('Categoria Atacado obrigatória');
  return { nodes: [
    { key: 'start', type: 'start', name: 'Entrada pelo anúncio de atacado', x: 100, y: 60, config: { trigger: 'NEW_CONVERSATION', channels: ['META'], initialMessage: '' } },
    { key: 'hours', type: 'condition', name: 'Dentro do expediente?', x: 100, y: 220, config: { rules: [{ left: 'bot.withinBusinessHours', operator: '==', right: 'true' }] } },
    ...[['open', REPLY], ['closed', CLOSED_REPLY]].map(([key, message], i) => ({ key, type: 'transfer_category', name: 'Comercial → Atacado', x: 50 + i * 360, y: 390, config: { categoryId, message, reason: 'Cliente entrou com a mensagem: Quero comprar no atacado' } })),
  ], edges: [['start', 'next', 'hours'], ['hours', 'true', 'open'], ['hours', 'false', 'closed']].map(([source, sourceHandle, target]) => ({ id: `${source}:${sourceHandle}:${target}`, source, sourceHandle, target })) };
}
module.exports = { BOT_ID, TRIAGE_ID, COMPANY_ID, REPLY, CLOSED_REPLY, belongsToAccount, matchesEntry, findTarget, wholesaleGraph };
