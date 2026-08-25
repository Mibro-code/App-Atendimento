// Avaliação do atendimento (BotRating) e ranking dos Bots.
//
// IMPORTANTE (separação exigida): métricas de "atendimento" (attendance)
// só podem vir de BotRating/BotAgentFeedback — sinais de que o Bot
// realmente atendeu. BotObservation é modo sombra (shadow mode) e nunca
// conta como atendimento real; por isso os números derivados dela ficam
// isolados em `interpretation`, nunca somados a `attendance`.
const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const audit = require("./audit-service");
const { getGlobalSettings } = require("./bot-governance-service");
const {
  MINIMUM_RATINGS_FOR_METRICS_PERCENTAGE, RATING_NEGATIVE_MAX_SCORE, RATING_POSITIVE_MIN_SCORE,
  RATING_SCORE_MAX, RATING_SCORE_MIN,
} = require("./bot-constants");

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function assertBotManager(viewer) {
  if (!authorization.isMaster(viewer)) {
    throw authorization.forbidden("Somente uma conta Master pode gerenciar Bots.");
  }
}

function periodRange(period) {
  const now = new Date();
  const from = new Date(now);
  switch (period?.preset) {
    case "today": from.setHours(0, 0, 0, 0); break;
    case "7d": from.setDate(from.getDate() - 7); break;
    case "30d": from.setDate(from.getDate() - 30); break;
    case "90d": from.setDate(from.getDate() - 90); break;
    case "custom": {
      const customFrom = period.from ? new Date(period.from) : null;
      const customTo = period.to ? new Date(period.to) : now;
      if (customFrom && Number.isNaN(customFrom.getTime())) throw fail("Data inicial inválida.");
      if (Number.isNaN(customTo.getTime())) throw fail("Data final inválida.");
      return { gte: customFrom || undefined, lte: customTo };
    }
    default: return null; // sem filtro de período (tudo)
  }
  return { gte: from, lte: now };
}

// Não é autenticado por RBAC de usuário interno — quem "avalia" é o
// cliente/atendimento real. Validação é toda de dado (Bot existente,
// toggles ligados, nota no intervalo, uma avaliação por conversa).
async function submitRating(data) {
  const botId = data?.botId;
  if (!botId) throw fail("Bot é obrigatório para registrar a avaliação.");
  const bot = await prisma.bot.findFirst({ where: { id: botId, archivedAt: null } });
  if (!bot) throw fail("Bot não encontrado.", 404);
  if (!bot.ratingEnabled) throw fail("A avaliação do atendimento não está habilitada para este Bot.");
  const globalSettings = await getGlobalSettings();
  if (!globalSettings.ratingsEnabled) throw fail("As avaliações estão desativadas globalmente.");

  const score = Number(data.score);
  if (!Number.isInteger(score) || score < RATING_SCORE_MIN || score > RATING_SCORE_MAX) {
    throw fail(`A nota deve ser um número inteiro entre ${RATING_SCORE_MIN} e ${RATING_SCORE_MAX}.`);
  }
  const comment = bot.requestRatingComment && typeof data.comment === "string"
    ? data.comment.trim().slice(0, 1000) || null : null;

  try {
    return await prisma.botRating.create({
      data: {
        botId,
        conversationId: data.conversationId || null,
        channel: data.channel || "META",
        score,
        comment,
        resolvedByBot: Boolean(data.resolvedByBot),
        intentId: data.intentId || null,
        handoffOccurred: Boolean(data.handoffOccurred),
        metadata: data.metadata || undefined,
      },
    });
  } catch (error) {
    if (error.code === "P2002") throw fail("Esta conversa já recebeu uma avaliação.");
    throw error;
  }
}

async function listRatings(filters, viewer) {
  assertBotManager(viewer);
  const where = {};
  if (filters.botId) where.botId = filters.botId;
  const createdAt = periodRange(filters);
  if (createdAt) where.createdAt = createdAt;
  const take = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  return prisma.botRating.findMany({
    where, include: { intent: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" }, take,
  });
}

function classifyScore(score) {
  if (score >= RATING_POSITIVE_MIN_SCORE) return "positive";
  if (score <= RATING_NEGATIVE_MAX_SCORE) return "negative";
  return "neutral";
}

async function ratingMetrics(botId, filters, viewer) {
  assertBotManager(viewer);
  if (!botId) throw fail("Bot é obrigatório.");
  const createdAt = periodRange(filters);
  const ratingWhere = { botId, ...(createdAt ? { createdAt } : {}) };

  const [ratings, observedTotal, observedHandoffs, observedFallbacks, observedLowConfidence] = await Promise.all([
    prisma.botRating.findMany({ where: ratingWhere, select: { score: true, handoffOccurred: true, resolvedByBot: true } }),
    prisma.botObservation.count({ where: { botId, ...(createdAt ? { createdAt } : {}) } }),
    prisma.botObservation.count({ where: { botId, action: "HANDOFF_HUMAN", ...(createdAt ? { createdAt } : {}) } }),
    prisma.botObservation.count({ where: { botId, intentId: null, ...(createdAt ? { createdAt } : {}) } }),
    prisma.botObservation.count({ where: { botId, confidence: { lt: 0.55 }, ...(createdAt ? { createdAt } : {}) } }),
  ]);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let positive = 0; let neutral = 0; let negative = 0;
  for (const rating of ratings) {
    distribution[rating.score] = (distribution[rating.score] || 0) + 1;
    sum += rating.score;
    const bucket = classifyScore(rating.score);
    if (bucket === "positive") positive += 1;
    else if (bucket === "negative") negative += 1;
    else neutral += 1;
  }
  const total = ratings.length;
  const hasEnoughForPercentage = total >= MINIMUM_RATINGS_FOR_METRICS_PERCENTAGE;

  return {
    // Diagnóstico do interpretador (BotObservation) — NUNCA é "atendimento real".
    interpretation: {
      totalObserved: observedTotal, handoffs: observedHandoffs, fallbacks: observedFallbacks,
      lowConfidence: observedLowConfidence,
    },
    // Sinais de atendimento real (só existem quando alguém de fato avaliou).
    attendance: {
      resolvedByBot: ratings.filter((rating) => rating.resolvedByBot).length,
      handoffOccurred: ratings.filter((rating) => rating.handoffOccurred).length,
    },
    ratings: {
      total, average: total ? Number((sum / total).toFixed(2)) : null, distribution,
      positive, neutral, negative,
      positivePct: hasEnoughForPercentage ? Number(((positive / total) * 100).toFixed(1)) : null,
      neutralPct: hasEnoughForPercentage ? Number(((neutral / total) * 100).toFixed(1)) : null,
      negativePct: hasEnoughForPercentage ? Number(((negative / total) * 100).toFixed(1)) : null,
      sampleWarning: total > 0 && !hasEnoughForPercentage
        ? `Amostra pequena (${total} avaliação(ões)) — percentuais podem não ser representativos.` : null,
    },
  };
}

// Ranking com score equilibrado (média Bayesiana, estilo "IMDB top 250"):
//   score = (v / (v + m)) * R + (m / (v + m)) * C
// v = nº de avaliações do Bot · m = amostra mínima global · R = média do
// Bot · C = média entre todos os Bots elegíveis. Isso evita que 1 avaliação
// 5 estrelas vença 2.000 avaliações com média 4,8: quanto menor v em
// relação a m, mais o score do Bot é "puxado" para a média geral C.
async function getRanking(viewer) {
  assertBotManager(viewer);
  const globalSettings = await getGlobalSettings();
  if (!globalSettings.rankingEnabled) return { enabled: false, ranked: [], excluded: [] };

  const bots = await prisma.bot.findMany({ where: { archivedAt: null, ratingEnabled: true }, select: { id: true, name: true } });
  const grouped = await prisma.botRating.groupBy({ by: ["botId"], _avg: { score: true }, _count: { _all: true } });
  const byBotId = new Map(grouped.map((row) => [row.botId, { average: row._avg.score || 0, count: row._count._all }]));

  const m = globalSettings.minimumRatingsForRanking;
  const eligible = bots.map((bot) => ({ bot, stats: byBotId.get(bot.id) || { average: 0, count: 0 } }))
    .filter((entry) => entry.stats.count >= m);
  const globalAverage = eligible.length
    ? eligible.reduce((acc, entry) => acc + entry.stats.average, 0) / eligible.length
    : 0;

  const ranked = eligible.map(({ bot, stats }) => {
    const { average, count } = stats;
    const score = (count / (count + m)) * average + (m / (count + m)) * globalAverage;
    return {
      botId: bot.id, botName: bot.name, averageScore: Number(average.toFixed(2)),
      ratingsCount: count, rankingScore: Number(score.toFixed(3)),
    };
  }).sort((left, right) => right.rankingScore - left.rankingScore);

  const excluded = bots
    .filter((bot) => (byBotId.get(bot.id)?.count || 0) < m)
    .map((bot) => ({ botId: bot.id, botName: bot.name, ratingsCount: byBotId.get(bot.id)?.count || 0, reason: "INSUFFICIENT_SAMPLE" }));

  return { enabled: true, minimumRatingsForRanking: m, ranked, excluded };
}

async function updateRatingConfig(botId, data, actor) {
  assertBotManager(actor);
  const bot = await prisma.bot.findFirst({ where: { id: botId, archivedAt: null } });
  if (!bot) throw fail("Bot não encontrado.", 404);
  const update = {};
  if (data.ratingEnabled !== undefined) {
    if (typeof data.ratingEnabled !== "boolean") throw fail("ratingEnabled deve ser verdadeiro ou falso.");
    update.ratingEnabled = data.ratingEnabled;
  }
  if (data.ratingMessage !== undefined) update.ratingMessage = data.ratingMessage?.trim().slice(0, 500) || null;
  if (data.ratingFollowupMessage !== undefined) update.ratingFollowupMessage = data.ratingFollowupMessage?.trim().slice(0, 500) || null;
  if (data.requestRatingComment !== undefined) {
    if (typeof data.requestRatingComment !== "boolean") throw fail("requestRatingComment deve ser verdadeiro ou falso.");
    update.requestRatingComment = data.requestRatingComment;
  }
  if (data.requestRatingOn !== undefined) {
    const { RATING_REQUEST_MODES } = require("./bot-constants");
    if (!RATING_REQUEST_MODES.includes(data.requestRatingOn)) throw fail("Momento de solicitar avaliação inválido.");
    update.requestRatingOn = data.requestRatingOn;
  }
  if (!Object.keys(update).length) throw fail("Informe ao menos um campo para atualizar.");

  const updated = await prisma.bot.update({ where: { id: botId }, data: update });
  await audit.recordAudit({
    actor, action: "BOT_RATING_CONFIG_UPDATED", entityType: "BOT", entityId: botId,
    summary: `Atualizou a configuração de avaliação do Bot ${bot.name}`,
    details: { before: { ratingEnabled: bot.ratingEnabled }, after: { ratingEnabled: updated.ratingEnabled } },
  });
  return updated;
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// Gráfico 1: nota média ao longo do tempo. Gráfico 4 (metade "atendimentos
// x handoffs") fica em observationTimeSeries — nunca somamos os dois.
async function ratingTimeSeries(botId, filters, viewer) {
  assertBotManager(viewer);
  const createdAt = periodRange(filters) || { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) };
  const rows = await prisma.botRating.findMany({
    where: { botId, createdAt }, select: { score: true, createdAt: true }, orderBy: { createdAt: "asc" },
  });
  const byDay = new Map();
  for (const row of rows) {
    const key = dayKey(row.createdAt);
    const bucket = byDay.get(key) || { date: key, sum: 0, count: 0 };
    bucket.sum += row.score; bucket.count += 1;
    byDay.set(key, bucket);
  }
  return [...byDay.values()].map((bucket) => ({
    date: bucket.date, averageScore: Number((bucket.sum / bucket.count).toFixed(2)), count: bucket.count,
  }));
}

// Gráfico 4: interpretações (BotObservation) x handoffs, ao longo do tempo —
// dado de diagnóstico, rotulado como tal (nunca chamado de "atendimentos").
async function observationTimeSeries(botId, filters, viewer) {
  assertBotManager(viewer);
  const createdAt = periodRange(filters) || { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) };
  const rows = await prisma.botObservation.findMany({
    where: { botId, createdAt }, select: { action: true, createdAt: true }, orderBy: { createdAt: "asc" },
  });
  const byDay = new Map();
  for (const row of rows) {
    const key = dayKey(row.createdAt);
    const bucket = byDay.get(key) || { date: key, totalObserved: 0, handoffs: 0 };
    bucket.totalObserved += 1;
    if (row.action === "HANDOFF_HUMAN") bucket.handoffs += 1;
    byDay.set(key, bucket);
  }
  return [...byDay.values()];
}

module.exports = {
  getRanking, listRatings, observationTimeSeries, ratingMetrics, ratingTimeSeries, submitRating, updateRatingConfig,
};
