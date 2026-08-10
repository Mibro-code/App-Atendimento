const prisma = require("../database/prisma");

const conversationStatuses = new Set([
  "NOVO", "EM_ATENDIMENTO", "AGUARDANDO_CLIENTE", "BOT", "FINALIZADO",
]);

async function listConversations({ search, category, status }) {
  const where = {};
  if (status) where.status = status;
  if (category) where.category = { code: category };
  if (search) {
    where.contact = { OR: [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ] };
  }
  return prisma.conversation.findMany({
    where,
    include: {
      contact: {
        include: {
          notes: { orderBy: { createdAt: "desc" }, take: 1 },
          _count: { select: { notes: true } },
        },
      },
      category: true,
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { occurredAt: "desc" }, take: 1 },
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
  });
}

async function getConversation(id) {
  return prisma.conversation.findUnique({
    where: { id },
    include: {
      category: true,
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: {
        include: { sentByUser: { select: { id: true, name: true } } },
        orderBy: { occurredAt: "asc" },
      },
      contact: {
        include: {
          notes: {
            include: { author: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });
}

async function getConversationSummary() {
  const [total, statuses, categories] = await Promise.all([
    prisma.conversation.count(),
    prisma.conversation.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.conversation.groupBy({
      by: ["categoryId"],
      where: { categoryId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  return {
    total,
    statuses: Object.fromEntries(statuses.map((item) => [item.status, item._count._all])),
    categories: Object.fromEntries(categories.map((item) => [item.categoryId, item._count._all])),
  };
}

async function addContactNote(contactId, { content, authorId }) {
  const text = content?.trim();
  if (!text) throw Object.assign(new Error("A nota não pode ficar vazia."), { statusCode: 400 });
  if (text.length > 2000) throw Object.assign(new Error("A nota deve ter no máximo 2.000 caracteres."), { statusCode: 400 });
  try {
    return await prisma.contactNote.create({
      data: { contactId, content: text, authorId: authorId || null },
      include: { author: { select: { id: true, name: true } } },
    });
  } catch (error) {
    if (error.code === "P2003") throw Object.assign(new Error("Contato não encontrado."), { statusCode: 404 });
    throw error;
  }
}

async function updateConversation(id, { categoryId, status }) {
  if (status && !conversationStatuses.has(status)) {
    throw Object.assign(new Error("Status inválido."), { statusCode: 400 });
  }
  if (categoryId) {
    const category = await prisma.category.findFirst({ where: { id: categoryId, active: true } });
    if (!category) throw Object.assign(new Error("Categoria não encontrada ou inativa."), { statusCode: 400 });
  }
  const data = {};
  if (categoryId !== undefined) data.categoryId = categoryId || null;
  if (status) {
    data.status = status;
    data.finalizedAt = status === "FINALIZADO" ? new Date() : null;
  }
  try {
    return await prisma.conversation.update({ where: { id }, data, include: { contact: true, category: true } });
  } catch (error) {
    if (error.code === "P2025") throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
    throw error;
  }
}

async function markAsRead(id) {
  try {
    return await prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
  } catch (error) {
    if (error.code === "P2025") throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
    throw error;
  }
}

async function listCategories() {
  return prisma.category.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
}

async function updateCategory(id, data) {
  const allowed = {};
  if (typeof data.name === "string" && data.name.trim()) allowed.name = data.name.trim();
  if (typeof data.color === "string") allowed.color = data.color || null;
  if (typeof data.active === "boolean") allowed.active = data.active;
  if (Number.isInteger(data.displayOrder)) allowed.displayOrder = data.displayOrder;
  try {
    return await prisma.category.update({ where: { id }, data: allowed });
  } catch (error) {
    if (error.code === "P2025") throw Object.assign(new Error("Categoria não encontrada."), { statusCode: 404 });
    throw error;
  }
}

module.exports = {
  addContactNote, conversationStatuses, getConversation, getConversationSummary, listCategories, listConversations,
  markAsRead, updateCategory, updateConversation,
};
