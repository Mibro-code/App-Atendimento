const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const { removeImage } = require("./media-storage-service");

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

function activityRecord(conversationId, actorUserId, action, details) {
  return { conversationId, actorUserId: actorUserId || null, action, details: details || undefined };
}

async function recordConversationActivity({ conversationId, actorUserId, action, details }, client = prisma) {
  return client.conversationActivity.create({
    data: activityRecord(conversationId, actorUserId, action, details),
  });
}

function categoryLabelForHistory(category) {
  return category?.parent ? `${category.parent.name}: ${category.name}` : category?.name;
}

function categorySectorId(category) {
  return category?.parentId || category?.id || null;
}

async function listConversations({ search, category, status, assignedUser, activeOnly }, viewer) {
  const where = {};
  if (status) where.status = status;
  else if (activeOnly === "true") where.status = { not: "FINALIZADO" };
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
  if (assignedUser) {
    if (!authorization.isMaster(viewer) && !viewer.canViewTeamActivity && assignedUser !== viewer.id) {
      throw authorization.forbidden("Você não pode consultar os atendimentos de outro usuário.");
    }
    where.assignedUserId = assignedUser;
  }
  const scope = await authorization.conversationScope(viewer);
  return prisma.conversation.findMany({
    where: { AND: [where, scope] },
    include: {
      contact: {
        include: {
          notes: { orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 1 },
          _count: { select: { notes: true } },
        },
      },
      category: { include: { parent: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: { where: { type: { not: "reaction" } }, orderBy: { occurredAt: "desc" }, take: 1 },
      pins: { where: { userId: viewer.id }, select: { createdAt: true }, take: 1 },
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
  }).then((conversations) => conversations
    .map(({ pins, ...conversation }) => ({ ...conversation, isPinned: pins.length > 0 }))
    .sort((left, right) => Number(right.isPinned) - Number(left.isPinned)));
}

function alertSince(value) {
  const parsed = value ? new Date(value) : new Date();
  const minimum = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error("Data inicial inválida."), { statusCode: 400 });
  return parsed < minimum ? minimum : parsed;
}

async function getUserAlerts({ since }, viewer) {
  const checkedAt = new Date();
  const occurredAfter = alertSince(since);
  const scope = await authorization.conversationScope(viewer);
  const waitingForViewer = {
    AND: [scope, { status: "AGUARDANDO_RESPOSTA" }, {
      OR: [{ assignedUserId: null }, { assignedUserId: viewer.id }],
    }],
  };
  const [messages, activities] = await Promise.all([
    prisma.message.findMany({
      where: {
        occurredAt: { gt: occurredAfter, lte: checkedAt }, direction: "RECEBIDA", type: { not: "reaction" },
        conversation: { is: waitingForViewer },
      },
      include: { conversation: { include: { contact: true, category: { include: { parent: true } } } } },
      orderBy: { occurredAt: "asc" }, take: 30,
    }),
    prisma.conversationActivity.findMany({
      where: {
        createdAt: { gt: occurredAfter, lte: checkedAt },
        action: { in: ["CATEGORY_CHANGED", "CONVERSATION_TRANSFERRED"] },
        conversation: { is: scope },
      },
      include: { conversation: { include: { contact: true, category: { include: { parent: true } } } } },
      orderBy: { createdAt: "asc" }, take: 30,
    }),
  ]);
  const incoming = messages.map((message) => ({
    id: `message:${message.id}`, conversationId: message.conversationId,
    title: "Cliente aguardando resposta",
    text: `${message.conversation.contact.name || message.conversation.contact.phone}: ${messagePreviewForAlert(message)}`,
    createdAt: message.occurredAt,
  }));
  const changes = activities.filter((activity) => {
    if (activity.actorUserId === viewer.id) return false;
    if (activity.action === "CONVERSATION_TRANSFERRED") return activity.details?.toUserId === viewer.id;
    return true;
  }).map((activity) => ({
    id: `activity:${activity.id}`, conversationId: activity.conversationId,
    title: activity.action === "CONVERSATION_TRANSFERRED" ? "Conversa transferida para você" : "Nova conversa na sua área",
    text: `${activity.conversation.contact.name || activity.conversation.contact.phone} • ${categoryLabelForHistory(activity.conversation.category) || "Sem categoria"}`,
    createdAt: activity.createdAt,
  }));
  return {
    checkedAt,
    alerts: [...incoming, ...changes]
      .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
      .slice(-30),
  };
}

function messagePreviewForAlert(message) {
  if (message.type === "image") return "enviou uma imagem";
  if (message.type === "audio") return "enviou um áudio";
  if (message.type === "video") return "enviou um vídeo";
  const text = message.text?.trim() || "enviou uma mensagem";
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

async function getConversation(id, viewer) {
  const scope = await authorization.conversationScope(viewer);
  const canViewHistory = authorization.isMaster(viewer) || Boolean(viewer.canViewConversationHistory);
  const access = await prisma.conversation.findFirst({
    where: { AND: [{ id }, scope] }, select: { id: true, assignedUserId: true },
  });
  if (!access) return null;
  let messagesSince = null;
  if (!authorization.isMaster(viewer) && !viewer.canViewPreviousMessages) {
    const transfers = await prisma.conversationActivity.findMany({
      where: { conversationId: id, action: { in: ["CONVERSATION_TRANSFERRED", "CATEGORY_CHANGED"] } },
      select: { createdAt: true, details: true }, orderBy: { createdAt: "desc" }, take: 100,
    });
    const categoryIds = [...new Set(transfers.flatMap(({ details }) => [
      details?.fromCategoryId, details?.toCategoryId,
    ]).filter(Boolean))];
    const categories = categoryIds.length ? await prisma.category.findMany({
      where: { id: { in: categoryIds } }, select: { id: true, parentId: true },
    }) : [];
    const categorySectors = new Map(categories.map((category) => [category.id, category.parentId || category.id]));
    const allowedCategoryIds = new Set(await authorization.allowedCategoryIds(viewer));
    messagesSince = transfers.find((activity) => {
      if (activity.details?.toUserId === viewer.id) return true;
      const fromCategoryId = activity.details?.fromCategoryId || null;
      const toCategoryId = activity.details?.toCategoryId || null;
      if (!allowedCategoryIds.has(toCategoryId)) return false;
      return (categorySectors.get(fromCategoryId) || fromCategoryId)
        !== (categorySectors.get(toCategoryId) || toCategoryId);
    })?.createdAt || null;
  }
  return prisma.conversation.findFirst({
    where: { AND: [{ id }, scope] },
    include: {
      category: { include: { parent: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: {
        where: messagesSince ? { occurredAt: { gte: messagesSince } } : undefined,
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
      pins: { where: { userId: viewer.id }, select: { createdAt: true }, take: 1 },
      activities: canViewHistory ? {
        include: { actorUser: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      } : false,
    },
  }).then((conversation) => {
    if (!conversation) return null;
    const { pins, ...result } = conversation;
    return { ...result, isPinned: pins.length > 0, canViewHistory, messageHistoryLimited: Boolean(messagesSince) };
  });
}

async function getConversationSummary(viewer) {
  const scope = await authorization.conversationScope(viewer);
  const [total, statuses, categories, attentionWaiting] = await Promise.all([
    prisma.conversation.count({ where: scope }),
    prisma.conversation.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.conversation.groupBy({
      by: ["categoryId"],
      where: { AND: [{ categoryId: { not: null } }, scope] },
      _count: { _all: true },
    }),
    prisma.conversation.count({
      where: { AND: [scope, { status: "AGUARDANDO_RESPOSTA" }, {
        OR: [{ assignedUserId: null }, { assignedUserId: viewer.id }],
      }] },
    }),
  ]);
  return {
    total,
    attentionWaiting,
    statuses: Object.fromEntries(statuses.map((item) => [item.status, item._count._all])),
    categories: Object.fromEntries(categories.map((item) => [item.categoryId, item._count._all])),
  };
}

async function addContactNote(contactId, { content, authorId, conversationId }, viewer) {
  await authorization.assertCanAccessContact(viewer, contactId);
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, contactId }, select: { id: true } });
    if (!conversation) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  }
  const text = content?.trim();
  if (!text) throw Object.assign(new Error("A nota não pode ficar vazia."), { statusCode: 400 });
  if (text.length > 2000) throw Object.assign(new Error("A nota deve ter no máximo 2.000 caracteres."), { statusCode: 400 });
  try {
    return await prisma.$transaction(async (transaction) => {
      const note = await transaction.contactNote.create({
        data: { contactId, content: text, authorId: authorId || null },
        include: { author: { select: { id: true, name: true } } },
      });
      if (conversationId) await recordConversationActivity({
        conversationId, actorUserId: authorId, action: "NOTE_ADDED",
        details: { preview: text.slice(0, 120) },
      }, transaction);
      return note;
    });
  } catch (error) {
    if (error.code === "P2003") throw Object.assign(new Error("Contato não encontrado."), { statusCode: 404 });
    throw error;
  }
}

async function deleteContactNote(contactId, noteId, { conversationId }, viewer) {
  authorization.assertMaster(viewer);
  await authorization.assertCanAccessContact(viewer, contactId);
  const note = await prisma.contactNote.findFirst({ where: { id: noteId, contactId } });
  if (!note) throw Object.assign(new Error("Nota não encontrada."), { statusCode: 404 });
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, contactId }, select: { id: true },
  });
  if (!conversation) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  return prisma.$transaction(async (transaction) => {
    await transaction.contactNote.delete({ where: { id: noteId } });
    await recordConversationActivity({
      conversationId, actorUserId: viewer.id, action: "NOTE_DELETED",
      details: { preview: note.content.slice(0, 120), wasPinned: note.pinned },
    }, transaction);
    return { deleted: true };
  });
}

async function deleteConversation(id, viewer) {
  authorization.assertMaster(viewer);
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      messages: {
        where: { mediaStorageKey: { not: null } },
        select: { mediaStorageKey: true },
      },
    },
  });
  if (!conversation) {
    throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  }
  await prisma.conversation.delete({ where: { id } });
  const mediaKeys = [...new Set(conversation.messages.map(({ mediaStorageKey }) => mediaStorageKey).filter(Boolean))];
  await Promise.allSettled(mediaKeys.map((storageKey) => removeImage(storageKey)));
  return { deleted: true, id };
}

async function setContactNotePinned(contactId, noteId, { pinned, conversationId }, viewer) {
  await authorization.assertCanAccessContact(viewer, contactId);
  if (typeof pinned !== "boolean") {
    throw Object.assign(new Error("Informe se a nota deve ser fixada."), { statusCode: 400 });
  }
  const note = await prisma.contactNote.findFirst({ where: { id: noteId, contactId } });
  if (!note) throw Object.assign(new Error("Nota não encontrada."), { statusCode: 404 });
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, contactId }, select: { id: true } });
    if (!conversation) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  }
  return prisma.$transaction(async (transaction) => {
    if (pinned) {
      await transaction.contactNote.updateMany({
        where: { contactId, id: { not: noteId }, pinned: true },
        data: { pinned: false },
      });
    }
    const updated = await transaction.contactNote.update({
      where: { id: noteId }, data: { pinned },
      include: { author: { select: { id: true, name: true } } },
    });
    if (conversationId) await recordConversationActivity({
      conversationId, actorUserId: viewer.id, action: pinned ? "NOTE_PINNED" : "NOTE_UNPINNED",
      details: { preview: note.content.slice(0, 120) },
    }, transaction);
    return updated;
  });
}

async function updateConversation(id, { categoryId, status, assignedUserId }, viewer) {
  const currentAccess = await authorization.assertCanViewConversation(viewer, id);
  const currentSnapshot = await prisma.conversation.findUnique({
    where: { id },
    include: {
      category: { include: { parent: true } },
      assignedUser: { select: { id: true, name: true } },
    },
  });
  if (!currentSnapshot) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
  if (status && !conversationStatuses.has(status)) {
    throw Object.assign(new Error("Status inválido."), { statusCode: 400 });
  }
  let targetCategory = currentSnapshot.category;
  if (categoryId) {
    targetCategory = await prisma.category.findFirst({
      where: { id: categoryId, active: true }, include: { parent: true },
    });
    if (!targetCategory) throw Object.assign(new Error("Categoria não encontrada ou inativa."), { statusCode: 400 });
    if (!authorization.canTransfer(viewer) && !(await authorization.canAccessCategory(viewer, categoryId))) {
      throw authorization.forbidden("Você não possui acesso à categoria selecionada.");
    }
  }
  if (categoryId === null) targetCategory = null;
  if (categoryId === null && !authorization.canTransfer(viewer)
    && !(await authorization.canAccessCategory(viewer, null))) {
    throw authorization.forbidden("Você não pode remover a categoria desta conversa.");
  }
  if (assignedUserId) {
    const user = await prisma.user.findFirst({ where: { id: assignedUserId, active: true } });
    if (!user) throw Object.assign(new Error("Atendente não encontrado ou inativo."), { statusCode: 400 });
    const targetCategoryId = categoryId !== undefined ? categoryId : currentAccess.categoryId;
    if (!(await authorization.canAccessCategory(user, targetCategoryId))) {
      throw Object.assign(new Error("O atendente não possui acesso à categoria desta conversa."), { statusCode: 400 });
    }
  }
  if (assignedUserId !== undefined && !authorization.canTransfer(viewer) && assignedUserId !== viewer.id) {
    throw authorization.forbidden("Você não pode transferir esta conversa.");
  }
  const data = {};
  if (categoryId !== undefined) data.categoryId = categoryId || null;
  if (assignedUserId !== undefined) data.assignedUserId = assignedUserId || null;
  const sectorChanged = categoryId !== undefined
    && categorySectorId(currentSnapshot.category) !== categorySectorId(targetCategory);
  if (sectorChanged && assignedUserId === undefined) data.assignedUserId = null;
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
    return await prisma.$transaction(async (transaction) => {
      const updated = await transaction.conversation.update({
        where: { id }, data,
        include: { contact: true, category: { include: { parent: true } }, assignedUser: { select: { id: true, name: true, email: true } } },
      });
      const activities = [];
      if (categoryId !== undefined && currentSnapshot.categoryId !== updated.categoryId
        && (sectorChanged || currentSnapshot.assignedUserId !== viewer.id)) {
        activities.push(activityRecord(id, viewer.id, "CATEGORY_CHANGED", {
          from: currentSnapshot.category ? categoryLabelForHistory(currentSnapshot.category) : "Sem categoria",
          to: updated.category ? categoryLabelForHistory(updated.category) : "Sem categoria",
          fromCategoryId: currentSnapshot.categoryId, toCategoryId: updated.categoryId,
          sectorChanged,
        }));
      }
      if (currentSnapshot.assignedUserId !== updated.assignedUserId) {
        const action = !updated.assignedUserId ? "ASSIGNEE_REMOVED"
          : !currentSnapshot.assignedUserId && updated.assignedUserId === viewer.id ? "CONVERSATION_CLAIMED"
            : "CONVERSATION_TRANSFERRED";
        activities.push(activityRecord(id, viewer.id, action, {
          from: currentSnapshot.assignedUser?.name || "Sem responsável",
          to: updated.assignedUser?.name || "Sem responsável",
          fromUserId: currentSnapshot.assignedUserId, toUserId: updated.assignedUserId,
        }));
      }
      if (status && currentSnapshot.status !== updated.status) {
        activities.push(activityRecord(id, viewer.id, "STATUS_CHANGED", { from: currentSnapshot.status, to: updated.status }));
      }
      if (activities.length) await transaction.conversationActivity.createMany({ data: activities });
      return updated;
    });
  } catch (error) {
    if (error.code === "P2025") throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
    throw error;
  }
}

async function setConversationPinned(id, { pinned }, viewer) {
  await authorization.assertCanViewConversation(viewer, id);
  if (typeof pinned !== "boolean") {
    throw Object.assign(new Error("Informe se a conversa deve ser fixada."), { statusCode: 400 });
  }
  if (pinned) {
    await prisma.conversationPin.upsert({
      where: { userId_conversationId: { userId: viewer.id, conversationId: id } },
      update: {}, create: { userId: viewer.id, conversationId: id },
    });
  } else {
    await prisma.conversationPin.deleteMany({ where: { userId: viewer.id, conversationId: id } });
  }
  return { conversationId: id, pinned };
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

async function listCategories(viewer) {
  let where;
  let selectableIds = null;
  if (!authorization.isMaster(viewer) && !viewer.canManageCategories && !authorization.canTransfer(viewer)) {
    const categoryIds = await authorization.allowedCategoryIds(viewer);
    selectableIds = new Set(categoryIds);
    where = { OR: [
      { id: { in: categoryIds } },
      { children: { some: { id: { in: categoryIds } } } },
    ] };
  }
  const categories = await prisma.category.findMany({
    where,
    include: { parent: { select: { id: true, name: true, code: true, active: true } } },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  return categories.map((category) => ({
    ...category, selectable: selectableIds ? selectableIds.has(category.id) : true,
  }));
}

async function createCategory(data, viewer) {
  authorization.assertCanManageCategories(viewer);
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

async function updateCategory(id, data, viewer) {
  authorization.assertCanManageCategories(viewer);
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

async function listUsers(viewer) {
  const where = authorization.isMaster(viewer) || viewer.canViewTeamActivity || viewer.canTransferConversations
    ? { active: true } : { id: viewer.id, active: true };
  return prisma.user.findMany({
    where,
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
}

module.exports = {
  addContactNote, conversationStatuses, createCategory, deleteContactNote, deleteConversation, getConversation, getConversationSummary, getUserAlerts, listCategories,
  listConversations, listUsers, markAsRead, recordConversationActivity, setContactNotePinned, setConversationPinned,
  updateCategory, updateConversation,
};
