const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const audit = require("./audit-service");
const { normalizeText } = require("./bot-simulator-service");
const { simulateOrchestration } = require("./bot-orchestrator-service");
const { validateConfidenceThresholds, DEFAULT_HIGH_CONFIDENCE_THRESHOLD, DEFAULT_LOW_CONFIDENCE_THRESHOLD } = require("./bot-constants");

const botStatuses = new Set(["DRAFT", "ACTIVE", "PAUSED"]);
const botChannels = new Set([
  "META",
  "INSTAGRAM_DIRECT",
  "INSTAGRAM_COMMENTS",
  "FACEBOOK_MESSENGER",
  "FACEBOOK_COMMENTS",
  "EMAIL",
  "MERCADO_LIVRE",
  "TIKTOK_SHOP",
  "AMAZON_MARKETPLACE",
  "SHOPEE",
  "SHEIN_MARKETPLACE",
  "GOOGLE_REVIEWS",
  "RECLAME_AQUI",
]);
const fallbackActions = new Set(["USE_BOT_FALLBACK", "TRANSFER_TO_CATEGORY", "TRANSFER_TO_HUMAN"]);
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const categorySelection = { id: true, code: true, name: true, color: true, active: true };
const botInclude = {
  defaultCategory: { select: categorySelection },
  schedules: { orderBy: { dayOfWeek: "asc" } },
  intents: {
    include: {
      category: { select: categorySelection },
      examples: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  },
};

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function assertBotManager(viewer) {
  if (!authorization.isMaster(viewer)) {
    throw authorization.forbidden("Somente uma conta Master pode gerenciar Bots.");
  }
}

function requiredText(value, label, maxLength = 4000) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw fail(`${label} é obrigatório.`);
  if (text.length > maxLength) throw fail(`${label} deve ter no máximo ${maxLength.toLocaleString("pt-BR")} caracteres.`);
  return text;
}

function optionalText(value, label, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw fail(`${label} inválido.`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) throw fail(`${label} deve ter no máximo ${maxLength.toLocaleString("pt-BR")} caracteres.`);
  return text;
}

function validateTimezone(value) {
  const timezone = requiredText(value || "America/Sao_Paulo", "Timezone", 100);
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: timezone }).format(new Date());
  } catch (_error) {
    throw fail("Timezone inválida.");
  }
  return timezone;
}

async function validateCategoryId(value, client = prisma) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw fail("Categoria inválida.");
  const category = await client.category.findFirst({
    where: { id: value, active: true },
    select: { id: true },
  });
  if (!category) throw fail("Categoria não encontrada ou inativa.");
  return category.id;
}

function validateStatus(value) {
  if (!botStatuses.has(value)) throw fail("Status do Bot inválido.");
  return value;
}

function validateChannel(value) {
  if (!botChannels.has(value)) throw fail("Canal do Bot inválido.");
  return value;
}

function validatePriority(value) {
  const priority = value === undefined ? 0 : value;
  if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) {
    throw fail("A prioridade deve ser um número inteiro entre -1000 e 1000.");
  }
  return priority;
}

function validateThresholds(low, high) {
  const lowValue = low === undefined ? DEFAULT_LOW_CONFIDENCE_THRESHOLD : Number(low);
  const highValue = high === undefined ? DEFAULT_HIGH_CONFIDENCE_THRESHOLD : Number(high);
  if (!validateConfidenceThresholds(lowValue, highValue)) {
    throw fail("Os limites de confiança devem satisfazer 0 <= baixo <= alto <= 1.");
  }
  return { lowConfidenceThreshold: lowValue, highConfidenceThreshold: highValue };
}

function validateFallbackAction(value) {
  const action = value || "USE_BOT_FALLBACK";
  if (!fallbackActions.has(action)) throw fail("Ação de fallback inválida.");
  return action;
}

function normalizeExamples(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw fail("Os exemplos da intenção devem ser uma lista.");
  const examples = [];
  const normalized = new Set();
  for (const entry of value) {
    const text = requiredText(entry, "Exemplo da intenção", 500);
    const key = normalizeText(text);
    if (normalized.has(key)) throw fail("Remova exemplos repetidos da intenção.");
    normalized.add(key);
    examples.push(text);
  }
  if (examples.length > 100) throw fail("Cada intenção pode ter no máximo 100 exemplos.");
  return examples;
}

function validateSchedules(value) {
  if (!Array.isArray(value)) throw fail("Os horários devem ser uma lista.");
  if (value.length > 7) throw fail("Configure no máximo um horário para cada dia da semana.");
  const days = new Set();
  return value.map((item) => {
    if (!item || !Number.isInteger(item.dayOfWeek) || item.dayOfWeek < 0 || item.dayOfWeek > 6) {
      throw fail("O dia da semana deve estar entre 0 e 6.");
    }
    if (days.has(item.dayOfWeek)) throw fail("Existe mais de um horário configurado para o mesmo dia.");
    days.add(item.dayOfWeek);
    if (typeof item.enabled !== "boolean") throw fail("Informe se o horário está habilitado.");
    if (!timePattern.test(item.startTime || "") || !timePattern.test(item.endTime || "")) {
      throw fail("Os horários devem usar o formato HH:mm.");
    }
    if (item.endTime <= item.startTime) throw fail("O horário final deve ser posterior ao horário inicial.");
    return {
      dayOfWeek: item.dayOfWeek,
      enabled: item.enabled,
      startTime: item.startTime,
      endTime: item.endTime,
    };
  });
}

async function ensureBot(botId, client = prisma, include = undefined) {
  const bot = await client.bot.findFirst({
    where: { id: botId, archivedAt: null },
    ...(include ? { include } : {}),
  });
  if (!bot) throw fail("Bot não encontrado.", 404);
  return bot;
}

function botSnapshot(bot) {
  return {
    name: bot.name,
    description: bot.description,
    status: bot.status,
    channel: bot.channel,
    timezone: bot.timezone,
    defaultCategoryId: bot.defaultCategoryId,
  };
}

async function listBots(viewer) {
  assertBotManager(viewer);
  return prisma.bot.findMany({
    where: { archivedAt: null },
    include: {
      defaultCategory: { select: categorySelection },
      _count: { select: { schedules: true, intents: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  });
}

async function getBot(botId, viewer) {
  assertBotManager(viewer);
  return ensureBot(botId, prisma, botInclude);
}

async function createBot(data, actor) {
  assertBotManager(actor);
  const create = {
    name: requiredText(data.name, "Nome", 100),
    description: optionalText(data.description, "Descrição", 500),
    channel: validateChannel(data.channel),
    initialMessage: requiredText(data.initialMessage, "Mensagem inicial"),
    outsideHoursMessage: requiredText(data.outsideHoursMessage, "Mensagem fora do horário"),
    fallbackMessage: requiredText(data.fallbackMessage, "Mensagem de fallback"),
    timezone: validateTimezone(data.timezone),
    defaultCategoryId: await validateCategoryId(data.defaultCategoryId),
    ...validateThresholds(data.lowConfidenceThreshold, data.highConfidenceThreshold),
  };
  return prisma.$transaction(async (transaction) => {
    const bot = await transaction.bot.create({ data: create, include: botInclude });
    await audit.recordAudit({
      actor,
      action: "BOT_CREATED",
      entityType: "BOT",
      entityId: bot.id,
      summary: `Criou o Bot ${bot.name}`,
      details: { bot: botSnapshot(bot) },
    }, transaction);
    return bot;
  });
}

async function updateBot(botId, data, actor) {
  assertBotManager(actor);
  const existing = await ensureBot(botId);
  const update = {};
  if (data.name !== undefined) update.name = requiredText(data.name, "Nome", 100);
  if (data.description !== undefined) update.description = optionalText(data.description, "Descrição", 500);
  if (data.channel !== undefined) update.channel = validateChannel(data.channel);
  if (data.initialMessage !== undefined) update.initialMessage = requiredText(data.initialMessage, "Mensagem inicial");
  if (data.outsideHoursMessage !== undefined) update.outsideHoursMessage = requiredText(data.outsideHoursMessage, "Mensagem fora do horário");
  if (data.fallbackMessage !== undefined) update.fallbackMessage = requiredText(data.fallbackMessage, "Mensagem de fallback");
  if (data.timezone !== undefined) update.timezone = validateTimezone(data.timezone);
  if (data.defaultCategoryId !== undefined) update.defaultCategoryId = await validateCategoryId(data.defaultCategoryId);
  if (data.lowConfidenceThreshold !== undefined || data.highConfidenceThreshold !== undefined) {
    Object.assign(update, validateThresholds(
      data.lowConfidenceThreshold !== undefined ? data.lowConfidenceThreshold : existing.lowConfidenceThreshold,
      data.highConfidenceThreshold !== undefined ? data.highConfidenceThreshold : existing.highConfidenceThreshold,
    ));
  }
  if (!Object.keys(update).length) throw fail("Informe ao menos um campo para atualizar.");

  return prisma.$transaction(async (transaction) => {
    const bot = await transaction.bot.update({ where: { id: botId }, data: update, include: botInclude });
    await audit.recordAudit({
      actor,
      action: "BOT_UPDATED",
      entityType: "BOT",
      entityId: bot.id,
      summary: `Alterou o Bot ${bot.name}`,
      details: { before: botSnapshot(existing), after: botSnapshot(bot) },
    }, transaction);
    return bot;
  });
}

async function updateBotStatus(botId, status, actor) {
  assertBotManager(actor);
  const existing = await ensureBot(botId);
  const nextStatus = validateStatus(status);
  if (existing.status === nextStatus) return ensureBot(botId, prisma, botInclude);
  return prisma.$transaction(async (transaction) => {
    const bot = await transaction.bot.update({
      where: { id: botId },
      data: { status: nextStatus },
      include: botInclude,
    });
    await audit.recordAudit({
      actor,
      action: "BOT_STATUS_CHANGED",
      entityType: "BOT",
      entityId: bot.id,
      summary: `Alterou o status do Bot ${bot.name} de ${existing.status} para ${nextStatus}`,
      details: { from: existing.status, to: nextStatus },
    }, transaction);
    return bot;
  });
}

async function archiveBot(botId, actor) {
  assertBotManager(actor);
  const existing = await ensureBot(botId);
  return prisma.$transaction(async (transaction) => {
    const bot = await transaction.bot.update({
      where: { id: botId },
      data: { archivedAt: new Date(), status: "PAUSED" },
      include: botInclude,
    });
    await audit.recordAudit({
      actor,
      action: "BOT_ARCHIVED",
      entityType: "BOT",
      entityId: bot.id,
      summary: `Arquivou o Bot ${bot.name}`,
      details: { before: botSnapshot(existing), archivedAt: bot.archivedAt },
    }, transaction);
    return bot;
  });
}

async function replaceSchedules(botId, value, actor) {
  assertBotManager(actor);
  const bot = await ensureBot(botId);
  const schedules = validateSchedules(value);
  return prisma.$transaction(async (transaction) => {
    await transaction.botSchedule.deleteMany({ where: { botId } });
    if (schedules.length) {
      await transaction.botSchedule.createMany({
        data: schedules.map((schedule) => ({ ...schedule, botId })),
      });
    }
    await audit.recordAudit({
      actor,
      action: "BOT_SCHEDULES_UPDATED",
      entityType: "BOT",
      entityId: bot.id,
      summary: `Alterou os horários do Bot ${bot.name}`,
      details: { schedules },
    }, transaction);
    return transaction.bot.findUnique({ where: { id: botId }, include: botInclude });
  });
}

async function intentInput(data, { partial = false, existing = null } = {}) {
  const input = {};
  if (!partial || data.name !== undefined) input.name = requiredText(data.name, "Nome da intenção", 100);
  if (!partial || data.description !== undefined) input.description = optionalText(data.description, "Descrição da intenção", 500);
  if (!partial || data.responseMessage !== undefined) input.responseMessage = optionalText(data.responseMessage, "Mensagem de resposta", 4000);
  if (!partial || data.priority !== undefined) input.priority = validatePriority(data.priority);
  if (!partial || data.active !== undefined) {
    if (data.active !== undefined && typeof data.active !== "boolean") throw fail("Informe se a intenção está ativa.");
    input.active = data.active === undefined ? true : data.active;
  }
  if (!partial || data.fallbackAction !== undefined) input.fallbackAction = validateFallbackAction(data.fallbackAction);
  if (!partial || data.categoryId !== undefined) input.categoryId = await validateCategoryId(data.categoryId);
  const examples = normalizeExamples(data.examples);
  const resultingAction = input.fallbackAction ?? existing?.fallbackAction ?? "USE_BOT_FALLBACK";
  const resultingCategoryId = input.categoryId !== undefined ? input.categoryId : existing?.categoryId;
  if (resultingAction === "TRANSFER_TO_CATEGORY" && !resultingCategoryId) {
    throw fail("Selecione uma categoria para transferir esta intenção.");
  }
  return { input, examples };
}

async function createIntent(botId, data, actor) {
  assertBotManager(actor);
  const bot = await ensureBot(botId);
  const { input, examples = [] } = await intentInput(data);
  return prisma.$transaction(async (transaction) => {
    const intent = await transaction.botIntent.create({
      data: {
        ...input,
        botId,
        examples: { create: examples.map((text) => ({ text })) },
      },
      include: {
        category: { select: categorySelection },
        examples: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    await audit.recordAudit({
      actor,
      action: "BOT_INTENT_CREATED",
      entityType: "BOT",
      entityId: bot.id,
      summary: `Criou a intenção ${intent.name} no Bot ${bot.name}`,
      details: { intentId: intent.id, name: intent.name },
    }, transaction);
    return intent;
  });
}

async function ensureIntent(botId, intentId) {
  await ensureBot(botId);
  const intent = await prisma.botIntent.findFirst({ where: { id: intentId, botId } });
  if (!intent) throw fail("Intenção não encontrada.", 404);
  return intent;
}

async function updateIntent(botId, intentId, data, actor) {
  assertBotManager(actor);
  const existing = await ensureIntent(botId, intentId);
  const { input, examples } = await intentInput(data, { partial: true, existing });
  if (!Object.keys(input).length && examples === undefined) throw fail("Informe ao menos um campo para atualizar.");

  return prisma.$transaction(async (transaction) => {
    if (examples !== undefined) {
      await transaction.botIntentExample.deleteMany({ where: { intentId } });
    }
    const intent = await transaction.botIntent.update({
      where: { id: intentId },
      data: {
        ...input,
        ...(examples !== undefined ? { examples: { create: examples.map((text) => ({ text })) } } : {}),
      },
      include: {
        category: { select: categorySelection },
        examples: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    const bot = await transaction.bot.findUnique({ where: { id: botId }, select: { name: true } });
    await audit.recordAudit({
      actor,
      action: "BOT_INTENT_UPDATED",
      entityType: "BOT",
      entityId: botId,
      summary: `Alterou a intenção ${intent.name} no Bot ${bot.name}`,
      details: { intentId: intent.id, before: { name: existing.name }, after: { name: intent.name } },
    }, transaction);
    return intent;
  });
}

async function deleteIntent(botId, intentId, actor) {
  assertBotManager(actor);
  const existing = await ensureIntent(botId, intentId);
  return prisma.$transaction(async (transaction) => {
    await transaction.botIntent.delete({ where: { id: intentId } });
    const bot = await transaction.bot.findUnique({ where: { id: botId }, select: { name: true } });
    await audit.recordAudit({
      actor,
      action: "BOT_INTENT_DELETED",
      entityType: "BOT",
      entityId: botId,
      summary: `Removeu a intenção ${existing.name} do Bot ${bot.name}`,
      details: { intentId, name: existing.name },
    }, transaction);
    return { deleted: true };
  });
}

function normalizeSimulatorState(state) {
  if (!state || typeof state !== "object") return null;
  return {
    activeBotId: typeof state.activeBotId === "string" ? state.activeBotId : null,
    lastIntentId: typeof state.lastIntentId === "string" ? state.lastIntentId : null,
    lastConfidence: typeof state.lastConfidence === "number" ? state.lastConfidence : null,
    failedInterpretations: Number.isInteger(state.failedInterpretations) ? state.failedInterpretations : 0,
    pendingClarification: Boolean(state.pendingClarification),
    extractedEntities: state.extractedEntities && typeof state.extractedEntities === "object" ? state.extractedEntities : {},
  };
}

function normalizeSimulatorHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => entry && typeof entry.text === "string")
    .slice(-20)
    .map((entry) => ({
      direction: entry.direction === "ENVIADA" ? "ENVIADA" : "RECEBIDA",
      text: entry.text,
    }));
}

// Simulador multi-turno: nunca usa o canal real da Meta nem toca em
// Conversation/ConversationBotState. O "estado" e o "histórico" trafegam
// inteiramente pelo cliente (tela de Bots), que os devolve a cada chamada.
async function simulate(botId, message, viewer, { state, history } = {}) {
  assertBotManager(viewer);
  const bot = await ensureBot(botId, prisma, botInclude);
  if (typeof message !== "string" || !message.trim()) throw fail("Digite uma mensagem para executar a simulação.");
  const result = await simulateOrchestration({
    bot,
    message,
    context: normalizeSimulatorHistory(history),
    state: normalizeSimulatorState(state),
  });
  return { ...result, simulation: true, sent: false, warning: "Simulação - nenhuma mensagem foi enviada" };
}

async function listObservations(filters, viewer) {
  assertBotManager(viewer);
  const where = {};
  if (filters.botId) where.botId = filters.botId;
  if (filters.intentId) where.intentId = filters.intentId;
  if (filters.intentName) where.intentName = { contains: filters.intentName, mode: "insensitive" };
  if (filters.minConfidence !== undefined) where.confidence = { gte: Number(filters.minConfidence) };
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = new Date(filters.from);
    if (filters.to) where.createdAt.lte = new Date(filters.to);
  }
  const take = Math.min(Number(filters.limit) || 50, 200);
  const rows = await prisma.botObservation.findMany({
    where,
    include: {
      conversation: { include: { contact: { select: { name: true, customName: true, phone: true } } } },
      message: { select: { text: true, occurredAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    conversationId: row.conversationId,
    contact: row.conversation?.contact
      ? (row.conversation.contact.customName || row.conversation.contact.name || row.conversation.contact.phone)
      : null,
    message: row.message?.text || null,
    botId: row.botId,
    botName: row.botName,
    intentId: row.intentId,
    intentName: row.intentName,
    confidence: row.confidence,
    action: row.action,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    provider: row.provider,
    status: row.status,
    errorCode: row.errorCode,
    extractedEntities: row.extractedEntities,
  }));
}

module.exports = {
  archiveBot,
  assertBotManager,
  createBot,
  createIntent,
  deleteIntent,
  getBot,
  listBots,
  listObservations,
  replaceSchedules,
  simulate,
  updateBot,
  updateBotStatus,
  updateIntent,
  validateSchedules,
};
