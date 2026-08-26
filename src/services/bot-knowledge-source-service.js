// CRUD mínimo para a arquitetura-base de conhecimento (KnowledgeSource).
// Sem RAG, sem busca semântica nesta fase — só rastreabilidade (tipo,
// origem, versão, janela de validade) para quando isso for implementado.
const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const audit = require("./audit-service");

const KNOWLEDGE_SOURCE_TYPES = new Set(["FAQ", "MANUAL", "PRODUCT", "POLICY", "WARRANTY", "PROCEDURE", "GENERAL", "OTHER"]);

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function assertBotManager(viewer) {
  if (!authorization.isMaster(viewer)) {
    throw authorization.forbidden("Somente uma conta Master pode gerenciar Bots.");
  }
}

function isActiveNow(source, now = new Date()) {
  if (!source.active) return false;
  if (source.validFrom && now < new Date(source.validFrom)) return false;
  if (source.validUntil && now > new Date(source.validUntil)) return false;
  return true;
}

function withActiveNow(source) {
  return { ...source, activeNow: isActiveNow(source) };
}

async function listKnowledgeSources(filters, viewer) {
  assertBotManager(viewer);
  const where = {};
  if (filters.botId) where.botId = filters.botId;
  if (filters.type) where.type = filters.type;
  if (filters.category) where.category = filters.category;
  if (filters.product) where.product = filters.product;
  if (filters.intentId) where.intentId = filters.intentId;
  if (filters.globalIntentId) where.globalIntentId = filters.globalIntentId;
  if (filters.active !== undefined) where.active = filters.active === "true" || filters.active === true;
  if (filters.q) {
    const term = String(filters.q).trim();
    if (term) {
      where.OR = [
        { title: { contains: term, mode: "insensitive" } },
        { content: { contains: term, mode: "insensitive" } },
        { tags: { has: term } },
      ];
    }
  }
  const rows = await prisma.knowledgeSource.findMany({ where, orderBy: [{ active: "desc" }, { updatedAt: "desc" }] });
  return rows.map(withActiveNow);
}

function validateInput(data, { partial = false } = {}) {
  const input = {};
  if (!partial || data.title !== undefined) {
    const title = String(data.title || "").trim();
    if (!title) throw fail("Título é obrigatório.");
    input.title = title.slice(0, 200);
  }
  if (!partial || data.type !== undefined) {
    if (!KNOWLEDGE_SOURCE_TYPES.has(data.type)) throw fail("Tipo de fonte de conhecimento inválido.");
    input.type = data.type;
  }
  // Item 3: todo conhecimento precisa de uma origem (rastreabilidade) —
  // obrigatório na criação; em edição parcial só valida se veio no payload.
  if (!partial) {
    const source = String(data.source || "").trim();
    if (!source) throw fail("Informe a origem (source) desta fonte de conhecimento.");
    input.source = source.slice(0, 500);
  } else if (data.source !== undefined) {
    const source = String(data.source || "").trim();
    if (!source) throw fail("Informe a origem (source) desta fonte de conhecimento.");
    input.source = source.slice(0, 500);
  }
  if (data.botId !== undefined) input.botId = data.botId || null;
  if (data.globalIntentId !== undefined) input.globalIntentId = data.globalIntentId || null;
  if (data.intentId !== undefined) input.intentId = data.intentId || null;
  if (data.category !== undefined) input.category = data.category ? String(data.category).trim().slice(0, 200) : null;
  if (data.product !== undefined) input.product = data.product ? String(data.product).trim().slice(0, 200) : null;
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) throw fail("Tags devem ser uma lista.");
    input.tags = data.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 30);
  }
  if (data.content !== undefined) input.content = data.content ? String(data.content).trim().slice(0, 8000) : null;
  if (data.active !== undefined) {
    if (typeof data.active !== "boolean") throw fail("Informe se a fonte está ativa.");
    input.active = data.active;
  }
  if (data.validFrom !== undefined) input.validFrom = data.validFrom ? new Date(data.validFrom) : null;
  if (data.validUntil !== undefined) input.validUntil = data.validUntil ? new Date(data.validUntil) : null;
  if (input.validFrom && input.validUntil && input.validFrom > input.validUntil) {
    throw fail("A validade inicial deve ser anterior à validade final.");
  }
  return input;
}

async function createKnowledgeSource(data, actor) {
  assertBotManager(actor);
  const input = validateInput(data);
  const created = await prisma.knowledgeSource.create({ data: input });
  await audit.recordAudit({
    actor, action: "BOT_KNOWLEDGE_SOURCE_CREATED", entityType: "BOT", entityId: input.botId || null,
    summary: `Criou a fonte de conhecimento "${created.title}"`, details: { id: created.id, type: created.type },
  });
  return withActiveNow(created);
}

async function updateKnowledgeSource(id, data, actor) {
  assertBotManager(actor);
  const existing = await prisma.knowledgeSource.findUnique({ where: { id } });
  if (!existing) throw fail("Fonte de conhecimento não encontrada.", 404);
  const input = validateInput(data, { partial: true });
  if (!Object.keys(input).length) throw fail("Informe ao menos um campo para atualizar.");
  const updated = await prisma.knowledgeSource.update({
    where: { id }, data: { ...input, version: { increment: 1 } },
  });
  await audit.recordAudit({
    actor, action: "BOT_KNOWLEDGE_SOURCE_UPDATED", entityType: "BOT", entityId: updated.botId,
    summary: `Atualizou a fonte de conhecimento "${updated.title}"`, details: { id: updated.id },
  });
  return withActiveNow(updated);
}

async function deleteKnowledgeSource(id, actor) {
  assertBotManager(actor);
  const existing = await prisma.knowledgeSource.findUnique({ where: { id } });
  if (!existing) throw fail("Fonte de conhecimento não encontrada.", 404);
  await prisma.knowledgeSource.delete({ where: { id } });
  await audit.recordAudit({
    actor, action: "BOT_KNOWLEDGE_SOURCE_DELETED", entityType: "BOT", entityId: existing.botId,
    summary: `Removeu a fonte de conhecimento "${existing.title}"`, details: { id },
  });
  return { deleted: true };
}

module.exports = {
  KNOWLEDGE_SOURCE_TYPES, createKnowledgeSource, deleteKnowledgeSource, isActiveNow, listKnowledgeSources, updateKnowledgeSource,
};
