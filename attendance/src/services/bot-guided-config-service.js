const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const audit = require("./audit-service");
const { normalizeText } = require("./bot-simulator-service");

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function assertManager(actor) {
  if (!authorization.isMaster(actor)) throw authorization.forbidden("Somente uma conta Master pode configurar o fluxo guiado.");
}

async function ensureBot(botId) {
  const bot = await prisma.bot.findFirst({ where: { id: botId, archivedAt: null }, select: { id: true, name: true } });
  if (!bot) throw fail("Bot não encontrado.", 404);
  return bot;
}

function required(value, label, max) {
  const text = String(value || "").trim();
  if (!text) throw fail(`${label} é obrigatório.`);
  if (text.length > max) throw fail(`${label} deve ter no máximo ${max} caracteres.`);
  return text;
}

function blockData(body = {}) {
  const code = required(body.code, "Código", 80).toLocaleUpperCase("pt-BR").replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return {
    code,
    name: required(body.name || code, "Nome", 120),
    content: required(body.content, "Conteúdo", 4000),
    kind: ["QUESTION", "RESPONSE", "HANDOFF"].includes(body.kind) ? body.kind : "RESPONSE",
    active: body.active !== false,
  };
}

function synonymData(body = {}) {
  const key = normalizeText(required(body.key, "Chave", 80)).replace(/\s+/g, "_").toLocaleUpperCase("pt-BR");
  const terms = [...new Set((Array.isArray(body.terms) ? body.terms : String(body.terms || "").split(","))
    .map((term) => normalizeText(term)).filter(Boolean))].slice(0, 100);
  if (!terms.length) throw fail("Adicione ao menos um sinônimo.");
  return { key, label: required(body.label || key, "Nome", 120), terms, active: body.active !== false };
}

async function list(botId, actor) {
  assertManager(actor);
  await ensureBot(botId);
  const [responseBlocks, synonymGroups] = await Promise.all([
    prisma.botResponseBlock.findMany({ where: { botId }, orderBy: [{ code: "asc" }] }),
    prisma.botSynonymGroup.findMany({ where: { botId }, orderBy: [{ label: "asc" }] }),
  ]);
  return { responseBlocks, synonymGroups };
}

async function createBlock(botId, body, actor) {
  assertManager(actor); const bot = await ensureBot(botId);
  const row = await prisma.botResponseBlock.create({ data: { botId, ...blockData(body) } });
  await audit.recordAudit({ actor, action: "BOT_RESPONSE_BLOCK_CREATED", entityType: "BOT", entityId: botId, summary: `Criou o bloco ${row.code} no Bot ${bot.name}`, details: { blockId: row.id, code: row.code } });
  return row;
}

async function updateBlock(botId, blockId, body, actor) {
  assertManager(actor); await ensureBot(botId);
  const current = await prisma.botResponseBlock.findFirst({ where: { id: blockId, botId } });
  if (!current) throw fail("Bloco não encontrado.", 404);
  return prisma.botResponseBlock.update({ where: { id: blockId }, data: blockData({ ...current, ...body }) });
}

async function deleteBlock(botId, blockId, actor) {
  assertManager(actor); await ensureBot(botId);
  const result = await prisma.botResponseBlock.deleteMany({ where: { id: blockId, botId } });
  if (!result.count) throw fail("Bloco não encontrado.", 404);
  return { deleted: true };
}

async function createSynonym(botId, body, actor) {
  assertManager(actor); const bot = await ensureBot(botId);
  const row = await prisma.botSynonymGroup.create({ data: { botId, ...synonymData(body) } });
  await audit.recordAudit({ actor, action: "BOT_SYNONYM_CREATED", entityType: "BOT", entityId: botId, summary: `Criou o grupo ${row.key} no Bot ${bot.name}`, details: { synonymId: row.id, key: row.key } });
  return row;
}

async function updateSynonym(botId, synonymId, body, actor) {
  assertManager(actor); await ensureBot(botId);
  const current = await prisma.botSynonymGroup.findFirst({ where: { id: synonymId, botId } });
  if (!current) throw fail("Grupo de sinônimos não encontrado.", 404);
  return prisma.botSynonymGroup.update({ where: { id: synonymId }, data: synonymData({ ...current, ...body }) });
}

async function deleteSynonym(botId, synonymId, actor) {
  assertManager(actor); await ensureBot(botId);
  const result = await prisma.botSynonymGroup.deleteMany({ where: { id: synonymId, botId } });
  if (!result.count) throw fail("Grupo de sinônimos não encontrado.", 404);
  return { deleted: true };
}

module.exports = { list, createBlock, updateBlock, deleteBlock, createSynonym, updateSynonym, deleteSynonym };
