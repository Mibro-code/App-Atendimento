const prisma = require("../database/prisma");

const conversationStatuses = new Set([
  "NOVO", "EM_ATENDIMENTO", "AGUARDANDO_RESPOSTA", "BOT", "FINALIZADO",
]);
const categoryColorPattern = /^#[0-9a-f]{6}$/i;

function validateCategoryName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw Object.assign(new Error("Nome da categoria é obrigatório."), { statusCode: 400 });
  if (name.length > 60) throw Object.assign(new Error("O nome da categoria deve ter no máximo 60 caracteres."), { statusCode: 400 });
  return name;
}

function validateCategoryColor(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !categoryColorPattern.test(value)) {
    throw Object.assign(new Error("Cor da categoria inválida."), { statusCode: 400 });
  }
  return value.toLowerCase();
}

function categoryCode(name) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "CATEGORIA";
}

async function listConversations({ search, category, status }) {
  const where = {};
  if (status) where.status = status;
  if (category) where.category = { OR: [
    { code: category },
    { parent: { is: { code: category } } },
  ] };
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
          notes: { orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 1 },
          _count: { select: { notes: true } },
        },
      },
      category: { include: { parent: true } },
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
      category: { include: { parent: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: {
        include: { sentByUser: { select: { id: true, name: true } } },
        orderBy: { occurredAt: "asc" },
      },
      contact: {
        include: {
          notes: {
            include: { author: { select: { id: true, name: true } } },
            orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
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

async function setContactNotePinned(contactId, noteId, { pinned }) {
  if (typeof pinned !== "boolean") {
    throw Object.assign(new Error("Informe se a nota deve ser fixada."), { statusCode: 400 });
  }
  const note = await prisma.contactNote.findFirst({ where: { id: noteId, contactId } });
  if (!note) throw Object.assign(new Error("Nota não encontrada."), { statusCode: 404 });
  return prisma.$transaction(async (transaction) => {
    if (pinned) {
      await transaction.contactNote.updateMany({
        where: { contactId, id: { not: noteId }, pinned: true },
        data: { pinned: false },
      });
    }
    return transaction.contactNote.update({
      where: { id: noteId }, data: { pinned },
      include: { author: { select: { id: true, name: true } } },
    });
  });
}

async function updateConversation(id, { categoryId, status, assignedUserId }) {
  if (status && !conversationStatuses.has(status)) {
    throw Object.assign(new Error("Status inválido."), { statusCode: 400 });
  }
  if (categoryId) {
    const category = await prisma.category.findFirst({ where: { id: categoryId, active: true } });
    if (!category) throw Object.assign(new Error("Categoria não encontrada ou inativa."), { statusCode: 400 });
  }
  if (assignedUserId) {
    const user = await prisma.user.findFirst({ where: { id: assignedUserId, active: true } });
    if (!user) throw Object.assign(new Error("Atendente não encontrado ou inativo."), { statusCode: 400 });
  }
  const data = {};
  if (categoryId !== undefined) data.categoryId = categoryId || null;
  if (assignedUserId !== undefined) data.assignedUserId = assignedUserId || null;
  if (status) {
    data.status = status;
    data.finalizedAt = status === "FINALIZADO" ? new Date() : null;
  }
  if (assignedUserId && !status) {
    const current = await prisma.conversation.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
    if (["NOVO", "AGUARDANDO_RESPOSTA", "BOT"].includes(current.status)) data.status = "EM_ATENDIMENTO";
  }
  try {
    return await prisma.conversation.update({
      where: { id }, data,
      include: { contact: true, category: true, assignedUser: { select: { id: true, name: true, email: true } } },
    });
  } catch (error) {
    if (error.code === "P2025") throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
    throw error;
  }
}

async function markAsRead(id, { channel } = {}) {
  const latestUnread = await prisma.message.findFirst({
    where: { conversationId: id, direction: "RECEBIDA", status: { not: "LIDA" }, externalId: { not: null } },
    orderBy: { occurredAt: "desc" },
    select: { externalId: true },
  });
  let readReceiptSent = false;
  if (latestUnread?.externalId && typeof channel?.markAsRead === "function") {
    try {
      await channel.markAsRead(latestUnread.externalId);
      readReceiptSent = true;
      await prisma.message.updateMany({
        where: { conversationId: id, direction: "RECEBIDA", status: { not: "LIDA" } },
        data: { status: "LIDA" },
      });
    } catch (error) {
      console.error("Não foi possível confirmar a leitura na Meta:", { conversationId: id, message: error.message });
    }
  }
  try {
    const conversation = await prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
    return { ...conversation, readReceiptSent };
  } catch (error) {
    if (error.code === "P2025") throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
    throw error;
  }
}

async function listCategories() {
  return prisma.category.findMany({
    include: { parent: { select: { id: true, name: true, code: true, active: true } } },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
}

async function createCategory(data) {
  const name = validateCategoryName(data.name);
  const color = validateCategoryColor(data.color) || "#6b7280";
  const parentId = data.parentId || null;
  if (parentId) {
    const parent = await prisma.category.findFirst({ where: { id: parentId, active: true, parentId: null } });
    if (!parent) throw Object.assign(new Error("A categoria principal não existe, está inativa ou já é uma subcategoria."), { statusCode: 400 });
  }
  const baseCode = categoryCode(name);
  const order = await prisma.category.aggregate({ _max: { displayOrder: true } });
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const code = suffix === 1 ? baseCode : `${baseCode}_${suffix}`;
    try {
      return await prisma.category.create({
        data: { code, name, color, parentId, displayOrder: (order._max.displayOrder || 0) + 10 },
      });
    } catch (error) {
      if (error.code !== "P2002") throw error;
    }
  }
  throw Object.assign(new Error("Não foi possível gerar um código único para a categoria."), { statusCode: 409 });
}

async function updateCategory(id, data) {
  const allowed = {};
  if (data.name !== undefined) allowed.name = validateCategoryName(data.name);
  if (data.color !== undefined) allowed.color = validateCategoryColor(data.color);
  if (typeof data.active === "boolean") allowed.active = data.active;
  if (Number.isInteger(data.displayOrder)) allowed.displayOrder = data.displayOrder;
  if (data.parentId !== undefined) {
    const parentId = data.parentId || null;
    if (parentId === id) throw Object.assign(new Error("Uma categoria não pode ser sua própria categoria principal."), { statusCode: 400 });
    if (parentId) {
      const [parent, children] = await Promise.all([
        prisma.category.findFirst({ where: { id: parentId, active: true, parentId: null } }),
        prisma.category.count({ where: { parentId: id } }),
      ]);
      if (!parent) throw Object.assign(new Error("A categoria principal não existe, está inativa ou já é uma subcategoria."), { statusCode: 400 });
      if (children) throw Object.assign(new Error("Remova ou mova as subcategorias antes de transformar esta categoria em subcategoria."), { statusCode: 400 });
    }
    allowed.parentId = parentId;
  }
  try {
    return await prisma.category.update({ where: { id }, data: allowed });
  } catch (error) {
    if (error.code === "P2025") throw Object.assign(new Error("Categoria não encontrada."), { statusCode: 404 });
    throw error;
  }
}

async function listUsers() {
  return prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
}

module.exports = {
  addContactNote, conversationStatuses, createCategory, getConversation, getConversationSummary, listCategories,
  listConversations, listUsers, markAsRead, setContactNotePinned, updateCategory, updateConversation,
};
