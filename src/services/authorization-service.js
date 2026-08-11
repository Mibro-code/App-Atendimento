const prisma = require("../database/prisma");

const isMaster = (user) => user?.role === "ADMIN";

function forbidden(message = "Você não possui permissão para esta ação.") {
  return Object.assign(new Error(message), { statusCode: 403 });
}

async function allowedCategoryIds(user) {
  if (isMaster(user)) return null;
  const access = await prisma.userCategoryAccess.findMany({
    where: { userId: user.id },
    include: { category: { select: { id: true, children: { select: { id: true } } } } },
  });
  return [...new Set(access.flatMap(({ category }) => [category.id, ...category.children.map(({ id }) => id)]))];
}

async function conversationScope(user) {
  if (isMaster(user)) return {};
  const categoryIds = await allowedCategoryIds(user);
  const visible = [];
  if (categoryIds.length) visible.push({ categoryId: { in: categoryIds } });
  if (user.canViewUncategorized) visible.push({ categoryId: null });
  return visible.length ? { OR: visible } : { id: { in: [] } };
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

module.exports = {
  allowedCategoryIds, assertCanAccessContact, assertCanManageCategories, assertCanViewConversation,
  assertMaster, canAccessCategory, canTransfer, conversationScope, forbidden, isMaster,
};
