// One-time, transactional publication of the two explicitly selected Q&A bots.
// Never sends messages, touches conversations, deletes data, or reads environment credentials.
const { createHash } = require("node:crypto");
const prisma = require("../database/prisma");
const audit = require("./audit-service");
const { prepareAnswers, buildPostTriageAssistantGraph } = require("./mibro-assistant-question-answer");
const { validateGraph } = require("./bot-visual-flow-graph");
const RELEASE = "0.34.13";

async function ensurePostTriageRelease({ client = prisma, log = console } = {}) {
  const bot = await client.bot.findUnique({ where: { id: "mibro-assistant-observer" } });
  if (!bot || bot.featureFlags?.postTriageQaRelease === RELEASE) return { migrated: false };
  const sources = await client.knowledgeSource.findMany({ where: { active: true }, orderBy: { id: "asc" } });
  const prepared = prepareAnswers(sources);
  if (!prepared.products.length || !prepared.answers.length) throw new Error("Base de assistência ausente; publicação bloqueada sem inventar respostas.");
  const checked = validateGraph(buildPostTriageAssistantGraph({ products: prepared.products, availableKeys: new Set(prepared.answers.map((answer) => answer.key)) }), { responseKeys: new Set(prepared.answers.map((answer) => answer.key)) });
  if (!checked.valid) throw new Error("Fluxo de assistência inválido: " + JSON.stringify(checked.errors));
  const hash = createHash("sha256").update(JSON.stringify({ graph: checked.graph, answers: prepared.answers })).digest("hex");
  await client.$transaction(async (tx) => {
    for (const answer of prepared.answers) {
      const data = { title: answer.title, text: answer.text, category: "GERAL", active: true };
      await tx.botResponse.upsert({ where: { key: answer.key }, update: data, create: { key: answer.key, ...data } });
    }
    await tx.botFlow.updateMany({ where: { botId: bot.id, isDefault: true }, data: { isDefault: false } });
    const flow = await tx.botFlow.create({ data: { botId: bot.id, name: "Assistência após Triagem", description: "Perguntas e respostas, sem IA ou chamadas externas", draftGraph: checked.graph, isDefault: true } });
    const version = await tx.botFlowVersion.create({ data: { flowId: flow.id, version: 1, graph: checked.graph, label: "v" + RELEASE } });
    await tx.botFlow.update({ where: { id: flow.id }, data: { activeVersionId: version.id, status: "ACTIVE" } });
    await tx.bot.update({ where: { id: bot.id }, data: {
      status: "ACTIVE", autoReplyEnabled: true, executionMode: "FLOW_BUILDER", runOnNewConversation: false,
      description: "Atende após a Triagem no setor escolhido, com orientações da base cadastrada e encaminhamento à equipe.",
      initialMessage: "Olá! Sou o Assistente Mibro Brasil. Vou te ajudar por aqui e, se precisar, chamar nossa equipe 😊",
      featureFlags: { ...(bot.featureFlags || {}), assistantAfterTriage: true, availabilityManaged: true, postTriageQaRelease: RELEASE,
        assistantKnowledgeHash: hash, assistantKnowledgeSources: sources.filter((source) => prepared.answers.some((answer) => answer.sourceIds.includes(source.id))).map((source) => ({ id: source.id, hash: createHash("sha256").update(source.content).digest("hex") })) },
    } });
    await audit.recordAudit({ actor: null, action: "BOT_POST_TRIAGE_QA_RELEASE", entityType: "BOT", entityId: bot.id, summary: "Publicou assistência determinística após Triagem", details: { release: RELEASE, flowId: flow.id, answers: prepared.answers.length, products: prepared.products.length } }, tx);
  });
  log.info?.("[BOT_FLOW] assistência após Triagem publicada; " + prepared.answers.length + " respostas.");
  return { migrated: true, answers: prepared.answers.length, products: prepared.products.length };
}
module.exports = { ensurePostTriageRelease };
