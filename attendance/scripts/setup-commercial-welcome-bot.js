const prisma = require('../src/database/prisma');
const flows = require('../src/services/bot-visual-flow-service');
const audit = require('../src/services/audit-service');
const ACCOUNT_ID = 'cmu17d9o8028hqi0kvr1pdci7';
const BOT_ID = 'commercial-number-welcome-bot';
const PRIMARY_PHONE = '(11) 92607-6026';
const notice = `Olá! Seja bem-vindo(a) ao canal comercial da Mibro Brasil.\n\nNosso atendimento funciona de segunda a sexta-feira, das 8h às 17h (horário de Brasília).\n\nEste número é exclusivo para atendimento comercial de Atacado. Para falar sobre outros assuntos, envie uma mensagem ao nosso atendimento principal: ${PRIMARY_PHONE}.`;
const reception = 'Logo um atendente do comercial estará lhe recepcionando e dará continuidade ao seu atendimento. Se você entrou em contato fora do horário, retornaremos no próximo período de atendimento.';
const node = (key, type, config, x) => ({ key, type, name: key, x, y: 160, config });
const edge = (source, target) => ({ id: `${source}:next`, source, sourceHandle: 'next', target });
(async () => {
  const actor = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN', active: true } });
  const account = await prisma.channelAccount.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
  if (account.name !== 'Mibro Brasil Comercial') throw new Error('Conta inesperada');
  if (await prisma.bot.findUnique({ where: { id: BOT_ID } })) throw new Error('Bot já existe; não sobrescrever');
  const category = await prisma.category.findFirstOrThrow({ where: { name: { contains: 'Atacado' }, active: true, parent: { code: 'COMERCIAL' } } });
  const graph = {
    nodes: [node('start', 'start', { trigger: 'NEW_CONVERSATION', channels: ['META'] }, 0), node('aviso', 'message', { text: notice }, 260), node('recepcao', 'message', { text: reception }, 520), node('atacado', 'transfer_category', { categoryId: category.id }, 780)],
    edges: [edge('start', 'aviso'), edge('aviso', 'recepcao'), edge('recepcao', 'atacado')],
  };
  const bot = await prisma.bot.create({ data: {
    id: BOT_ID, name: 'Recepção Comercial — Atacado', description: 'Exclusivo do número Mibro Brasil Comercial. Duas mensagens de recepção e encaminhamento direto ao Atacado, sem menu.',
    channel: 'META', status: 'PAUSED', autoReplyEnabled: false, executionMode: 'FLOW_BUILDER',
    initialMessage: notice, outsideHoursMessage: notice, fallbackMessage: reception,
    runOnNewConversation: true, runAfterReopen: true,
    featureFlags: { channelAccountIds: [ACCOUNT_ID] },
  } });
  const flow = await flows.createFlow(bot.id, { name: 'Recepção exclusiva do número Comercial' }, actor);
  await flows.saveDraft(bot.id, flow.id, { graph }, actor);
  await flows.publishFlow(bot.id, flow.id, {}, actor);
  const preview = await flows.simulateFlow(bot.id, flow.id, { contactName: 'Cliente', callWebhooks: false }, actor);
  if (preview.status !== 'HANDED_OFF') throw new Error(`Simulação não concluiu: ${preview.status}`);
  await prisma.$transaction(async tx => {
    const current = await tx.channelAccount.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    await tx.channelAccount.update({ where: { id: ACCOUNT_ID }, data: { config: { ...current.config, inboundBotId: BOT_ID } } });
    await tx.bot.update({ where: { id: BOT_ID }, data: { status: 'ACTIVE', autoReplyEnabled: true } });
  });
  await audit.recordAudit({ actor, action: 'CHANNEL_ACCOUNT_BOT_CONFIGURED', entityType: 'CHANNEL_ACCOUNT', entityId: ACCOUNT_ID, summary: 'Configurou recepção exclusiva do Comercial com aviso de horário, telefone principal e encaminhamento ao Atacado.', details: { botId: BOT_ID, flowId: flow.id, categoryId: category.id, primaryPhone: PRIMARY_PHONE } });
  console.log(JSON.stringify({ configured: true, botId: BOT_ID, flowId: flow.id, primaryPhone: PRIMARY_PHONE, preview: preview.status }));
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
