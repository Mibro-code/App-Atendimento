const prisma = require('../database/prisma');
const audit = require('./audit-service');
const privateSegments = require('./private-segment-service');
const whatsappAccounts = require('./whatsapp-account-service');
const inbox = require('./whatsapp-inbox-service');

// Classificação inicial de um atendimento aberto por template. Precedência:
//   1. atendimento ativo: nunca muda (só inicia/reinicia um ciclo);
//   2. destino fixo do template (TemplateRoutingConfiguration da WABA);
//   3. destino do número (ChannelAccount.config.outboundTemplateCategoryId —
//      ex.: Comercial → Atacado);
//   4. nada: segue a triagem de sempre.
// Só calcula; a gravação acontece depois que a Meta aceita o envio.

// Ciclo novo: conversa finalizada ou contato sem nenhuma mensagem WhatsApp.
async function eligible(conversation, client) {
  if (conversation.channel !== 'META') return false;
  if (conversation.status === 'FINALIZADO') return true;
  return !(await client.message.findFirst({
    where: { conversation: { contactId: conversation.contactId, channel: 'META' }, type: { not: 'reaction' } },
    select: { id: true },
  }));
}

async function channelCategory(conversation, account, client) {
  const targetId = account?.config?.outboundTemplateCategoryId;
  if (!targetId || account.companyId !== conversation.companyId || !account.enabled || account.status !== 'CONNECTED') return null;
  const category = await client.category.findFirst({
    where: { id: targetId, companyId: conversation.companyId, active: true },
    select: { id: true, parentId: true, name: true },
  });
  if (!category || !(account.config.outboundCategoryIds || []).some(id => id === category.id || id === category.parentId)) return null;
  return category;
}

// Configuração explícita por número. Só inicia/reinicia um ciclo: nunca move
// um atendimento em andamento nem reclassifica o histórico já gravado.
async function initialCategory(conversation, requestedAccountId, client = prisma) {
  if (conversation.channel !== 'META') return null;
  const accountId = requestedAccountId === 'legacy' ? null : requestedAccountId || conversation.channelAccountId;
  if (!accountId) return null;
  const category = await channelCategory(conversation, await client.channelAccount.findUnique({ where: { id: accountId } }), client);
  return category && (await eligible(conversation, client)) ? category : null;
}

// Categoria gravada na conversa (a subcategoria, se houver), revalidada no
// envio — a regra pode ter ficado inválida desde que foi salva.
async function templateTarget(config, companyId, client) {
  if (!config?.enabled || config.companyId !== companyId) return null;
  const category = await client.category.findFirst({ where: { id: config.categoryId, companyId, active: true, parentId: null }, select: { id: true } });
  if (!category || !config.subcategoryId) return category;
  return client.category.findFirst({ where: { id: config.subcategoryId, companyId, active: true, parentId: category.id }, select: { id: true, parentId: true } });
}

async function templateCategory(conversation, account, { name, language, sentByUserId }, client) {
  const wabaId = whatsappAccounts.wabaIdOf(account);
  if (!wabaId || !name || !language) return null;
  const config = await client.templateRoutingConfiguration.findUnique({
    where: { companyId_wabaId_templateName_templateLanguage: { companyId: conversation.companyId, wabaId, templateName: name, templateLanguage: language } },
  });
  const category = await templateTarget(config, conversation.companyId, client);
  if (!category) return null;
  const sender = sentByUserId ? await client.user.findUnique({ where: { id: sentByUserId } }) : null;
  // O setor precisa continuar saindo por este número; senão o envio cairia
  // em "número não corresponde ao setor" ou trocaria o remetente escolhido.
  const contact = await client.contact.findUnique({ where: { id: conversation.contactId }, select: { whatsappInboxId: true } });
  if (contact?.whatsappInboxId) {
    const state = await inbox.senderState({ ...conversation, categoryId: category.id }, sender, client, account.config?.isLegacyWhatsApp ? 'legacy' : account.id);
    if (state.account?.id !== account.id) return null;
  } else {
    const candidates = inbox.routingCandidates(category, await client.channelAccount.findMany({ where: { channel: 'META', companyId: conversation.companyId } }));
    if (candidates.length && !candidates.some(item => item.id === account.id)) return null;
  }
  // Setor protegido (Financeiro): a regra não dá acesso a ninguém. Quem
  // envia precisa já ser do setor; envio sem usuário (campanha) não atribui.
  const privateCategoryId = await privateSegments.privateRootFor(category.id, client);
  if (privateCategoryId && sentByUserId) {
    const readable = sender ? await privateSegments.readablePrivateCategoryIds(sender, client) : [];
    if (readable !== null && !readable.includes(privateCategoryId)) return null;
  }
  return { category, config, privateCategoryId, source: 'TEMPLATE' };
}

// null (segue a triagem) ou { category, source, config?, fallback }. `fallback`
// é a regra do número, usada se o template na Meta não for o mesmo da
// configuração (templateMatches).
async function resolveInitialRouting(conversation, requestedAccountId, template = {}, client = prisma) {
  if (!(await eligible(conversation, client))) return null;
  const accountId = requestedAccountId === 'legacy' ? null : requestedAccountId || conversation.channelAccountId;
  const account = accountId ? await client.channelAccount.findUnique({ where: { id: accountId } }) : await whatsappAccounts.getLegacyAccount(client);
  if (!account || account.companyId !== conversation.companyId || !account.enabled || account.status !== 'CONNECTED') return null;
  // Número original (.env) nunca teve regra de número — mantido.
  const channel = accountId ? await channelCategory(conversation, account, client) : null;
  const fallback = channel ? { category: channel, source: 'CHANNEL' } : null;
  const routed = await templateCategory(conversation, account, template, client);
  return routed ? { ...routed, fallback } : fallback;
}

function templateMatches(routing, template) {
  if (routing?.source !== 'TEMPLATE' || !routing.config.metaTemplateId || !template?.id) return true;
  return String(template.id) === routing.config.metaTemplateId;
}

async function persistInitialCategory(client, original, category, sentByUserId, occurredAt, extra = {}) {
  if (!category || original.categoryId === category.id) return false;
  // Compare-and-set: uma transferência/entrada simultânea nunca é sobrescrita.
  const changed = await client.conversation.updateMany({
    where: { id: original.id, categoryId: original.categoryId, status: original.status, updatedAt: original.updatedAt },
    data: { categoryId: category.id },
  });
  if (changed.count) await client.conversationActivity.create({ data: {
    conversationId: original.id, actorUserId: sentByUserId || null, createdAt: occurredAt, action: 'CATEGORY_CHANGED',
    ...(extra.privateCategoryId !== undefined ? { privateCategoryId: extra.privateCategoryId } : {}),
    details: { fromCategoryId: original.categoryId, toCategoryId: category.id, source: 'OUTBOUND_TEMPLATE_INITIAL_CATEGORY', ...(extra.details || {}) },
  } });
  return Boolean(changed.count);
}

// Grava a classificação resolvida (mesma transação da mensagem enviada).
// Devolve o carimbo de setor privado para a mensagem quando a conversa entrou
// num setor protegido — o carimbo automático lê fora desta transação.
async function persistInitialRouting(client, original, routing, { sentByUserId, occurredAt, template }) {
  if (!routing?.category) return { applied: false };
  const fromTemplate = routing.source === 'TEMPLATE';
  const labels = new Map((await client.category.findMany({
    where: { id: { in: [original.categoryId, routing.category.id].filter(Boolean) } },
    select: { id: true, name: true, parent: { select: { name: true } } },
  })).map(item => [item.id, item.parent ? `${item.parent.name}: ${item.name}` : item.name]));
  const details = {
    from: labels.get(original.categoryId) || 'Sem categoria', to: labels.get(routing.category.id),
    template: { name: template.name, language: template.language, metaTemplateId: template.id ? String(template.id) : null },
    newCycle: original.status === 'FINALIZADO',
    ...(fromTemplate ? { source: 'OUTBOUND_TEMPLATE_ROUTING', routingConfigurationId: routing.config.id, wabaId: routing.config.wabaId } : {}),
  };
  const privateCategoryId = fromTemplate ? routing.privateCategoryId || null : undefined;
  // A mensagem enviada para um destino privado continua privada mesmo se
  // a categoria já era a mesma ou um atendimento concorrente ganhou o CAS.
  if (!(await persistInitialCategory(client, original, routing.category, sentByUserId, occurredAt, { privateCategoryId, details }))) return { applied: false, privateCategoryId: privateCategoryId || undefined };
  if (privateCategoryId) await client.conversationActivity.create({ data: {
    conversationId: original.id, actorUserId: sentByUserId || null, createdAt: occurredAt, action: 'PRIVATE_SEGMENT_STARTED', privateCategoryId,
    details: { categoryId: privateCategoryId, category: details.to.split(': ')[0], from: 'OUTBOUND_TEMPLATE_ROUTING' },
  } });
  await audit.recordAudit({
    actor: null, action: 'CONVERSATION_CATEGORY_CHANGED', entityType: 'CONVERSATION', entityId: original.id, companyId: original.companyId,
    summary: `Classificação automática pelo template "${template.name}" (${template.language}): ${details.to}`,
    details: { ...details, fromCategoryId: original.categoryId, toCategoryId: routing.category.id, sentByUserId: sentByUserId || null },
  }, client);
  return { applied: true, privateCategoryId: privateCategoryId || undefined };
}

module.exports = { initialCategory, persistInitialCategory, persistInitialRouting, resolveInitialRouting, templateMatches };
