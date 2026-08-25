const prisma = require("../database/prisma");
const { simulateBot } = require("./bot-simulator-service");

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

// Roda o simulador do Bot ativo do canal ao lado da triagem real, apenas
// para log/comparação. Nunca envia mensagem, nunca altera a conversa e
// nunca pode derrubar o processamento real do webhook.
async function observeIncomingMessage(event, message, { now = new Date() } = {}) {
  try {
    if (event.type !== "text" || !event.text) return null;
    const bot = await prisma.bot.findFirst({
      where: { channel: "META", status: "ACTIVE", archivedAt: null },
      include: botInclude,
    });
    if (!bot) return null;

    const result = simulateBot(bot, event.text, { now });
    console.log("[BOT_OBSERVATION]", JSON.stringify({
      conversationId: message.conversationId,
      botId: bot.id,
      botName: bot.name,
      withinHours: result.withinHours,
      intent: result.intent?.name || null,
      matchedExample: result.matchedExample,
      category: result.category?.name || null,
      fallbackAction: result.fallbackAction,
    }));

    await prisma.botObservation.create({
      data: {
        conversationId: message.conversationId,
        messageId: message.id,
        botId: bot.id,
        botName: bot.name,
        channel: bot.channel,
        withinHours: result.withinHours,
        intentId: result.intent?.id || null,
        intentName: result.intent?.name || null,
        matchedExample: result.matchedExample || null,
        categoryId: result.category?.id || null,
        categoryName: result.category?.name || null,
        fallbackAction: result.fallbackAction || null,
      },
    });

    return result;
  } catch (error) {
    console.error("[BOT_OBSERVATION] falha ao simular (ignorada)", error.message);
    return null;
  }
}

module.exports = { observeIncomingMessage };
