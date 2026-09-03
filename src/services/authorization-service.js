const prisma = require("../database/prisma");

const isMaster = (user) => user?.role === "ADMIN";

function forbidden(message = "Você não possui permissão para esta ação.") {
  return Object.assign(new Error(message), { statusCode: 403 });
}

async function allowedCategoryIds(user) {
  if (isMaster(user)) return null;
  const access = await prisma.userCategoryAccess.findMany({
    where: {
      userId: user.id,
      category: { is: {
        masterOnly: false,
        OR: [{ parentId: null }, { parent: { is: { masterOnly: false } } }],
      } },
    },
    select: { categoryId: true },
  });
  return access.map(({ categoryId }) => categoryId);
}

async function conversationScope(user) {
  if (isMaster(user)) return {};
  const categoryIds = await allowedCategoryIds(user);
  const visible = [{ assignedUserId: user.id }];
  if (categoryIds.length) visible.push({ categoryId: { in: categoryIds } });
  if (user.canViewUncategorized) visible.push({ categoryId: null });
  const operationalScope = visible.length ? { OR: visible } : { id: { in: [] } };
  const emailAccountScope = {
    OR: [
      { channel: { not: "EMAIL" } },
      { channelAccount: { is: { accessUsers: { some: { userId: user.id } } } } },
    ],
  };
  const categoryScope = {
    OR: [
      { categoryId: null },
      { category: { is: {
        masterOnly: false,
        OR: [{ parentId: null }, { parent: { is: { masterOnly: false } } }],
      } } },
    ],
  };
  return { AND: [operationalScope, categoryScope, emailAccountScope] };
}

async function canAccessCategory(user, categoryId) {
  if (isMaster(user)) return true;
  if (!categoryId) return Boolean(user.canViewUncategorized);
  return (await allowedCategoryIds(user)).includes(categoryId);
}

async function assertCanViewConversation(user, conversationId) {
  const scope = await conversationScope(user);
  const conversation = await prisma.conversation.findFirst({
    where: { AND: [{ id: conversationId }, scope] },
    select: { id: true, categoryId: true, assignedUserId: true, contactId: true },
  });
  if (!conversation) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  return conversation;
}

async function assertCanAccessContact(user, contactId) {
  const scope = await conversationScope(user);
  const conversation = await prisma.conversation.findFirst({
    where: { AND: [{ contactId }, scope] }, select: { id: true },
  });
  if (!conversation) throw forbidden("Você não tem acesso a este contato.");
}

function assertMaster(user) {
  if (!isMaster(user)) throw forbidden("Somente uma conta Master pode gerenciar usuários.");
}

function assertCanManageCategories(user) {
  if (!isMaster(user) && !user?.canManageCategories) throw forbidden("Você não pode gerenciar categorias.");
}

function canTransfer(user) {
  return isMaster(user) || Boolean(user?.canTransferConversations);
}

// Prioridade manual de conversa (item 16 — RBAC do pedido de SLA/
// prioridade): Admin/Supervisor sempre podem; Atendente só com o flag
// explícito, mesmo padrão de canManageCampaigns/canTransfer acima.
function canSetPriority(user) {
  return isMaster(user) || user?.role === "SUPERVISOR" || Boolean(user?.canSetConversationPriority);
}

function assertCanSetPriority(user) {
  if (!canSetPriority(user)) throw forbidden("Você não pode alterar a prioridade desta conversa.");
}

// Campanhas/prospecção (item 27): Admin e Supervisor por padrão; Atendente
// só com o flag explícito canManageCampaigns.
function canStartConversations(user) {
  return isMaster(user) || Boolean(user?.canStartConversations);
}

function assertCanStartConversations(user) {
  if (!canStartConversations(user)) throw forbidden("Você não tem permissão para iniciar conversas.");
}

function canMergeContacts(user) {
  return isMaster(user) || Boolean(user?.canMergeContacts);
}

function assertCanMergeContacts(user) {
  if (!canMergeContacts(user)) throw forbidden("Você não tem permissão para fundir contatos.");
}

function canManageCampaigns(user) {
  return isMaster(user) || user?.role === "SUPERVISOR" || Boolean(user?.canManageCampaigns);
}

function assertCanManageCampaigns(user) {
  if (!canManageCampaigns(user)) throw forbidden("Você não tem permissão para gerenciar campanhas.");
}

// Configurações → Conversas: Admin edita (via assertMaster), Supervisor só
// visualiza — mesma régua de "edição de alto risco não delegável" usada em
// Campanhas/Bots, mas com leitura liberada para Supervisor acompanhar SLAs.
function canViewConversationSettings(user) {
  return isMaster(user) || user?.role === "SUPERVISOR";
}

function assertCanViewConversationSettings(user) {
  if (!canViewConversationSettings(user)) {
    throw forbidden("Você não pode visualizar as configurações de Conversas.");
  }
}

module.exports = {
  allowedCategoryIds, assertCanAccessContact, assertCanManageCampaigns, assertCanManageCategories, assertCanMergeContacts, assertCanStartConversations,
  assertCanSetPriority, assertCanViewConversation, assertCanViewConversationSettings, assertMaster,
  canAccessCategory, canManageCampaigns, canMergeContacts, canSetPriority, canStartConversations, canTransfer, canViewConversationSettings,
  conversationScope, forbidden, isMaster,
};
