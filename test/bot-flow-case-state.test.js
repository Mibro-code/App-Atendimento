// Fase 1 do plano de evolução do Bot Mibro ("Case State completo" + "não
// repetir solução já tentada"): cobre a promoção de dados reais do Flow
// Engine para o Case State (bot-orchestrator-service.js#runDecisionPipeline
// -> bot-case-state-service.js#mergeFlowAttemptsIntoCaseState) e o novo
// guard wasAlreadyTried em USE_RESPONSE_BLOCK (bot-flow-service.js). Tudo
// atrás de featureFlags.agentPlannerEnabled — um Bot que não ligar a flag
// continua se comportando exatamente como antes (ver o último teste).
require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/database/prisma");
const { orchestrate } = require("../src/services/bot-orchestrator-service");

const botNamePrefix = "Bot Case State Teste";
const externalId = "bot-case-state-test-contact";

async function cleanup() {
  await prisma.bot.deleteMany({ where: { name: { startsWith: botNamePrefix } } });
  await prisma.contact.deleteMany({ where: { externalId: { startsWith: externalId } } });
}

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

let phoneCounter = 0;
async function seedConversation() {
  phoneCounter += 1;
  const contact = await prisma.contact.create({
    data: { externalId: `${externalId}-${phoneCounter}`, phone: `5511966600${String(phoneCounter).padStart(3, "0")}`, name: "Cliente" },
  });
  return prisma.conversation.create({ data: { contactId: contact.id } });
}

async function sendMessage(conversation, text) {
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id, externalId: `case-state-${conversation.id}-${Math.random()}`,
      direction: "RECEBIDA", status: "RECEBIDA", type: "text", text, occurredAt: new Date(),
    },
  });
  return orchestrate({ conversationId: conversation.id, messageId: message.id, message: text });
}

const CHARGER_INSTRUCTION = "Troque o carregador e teste em outra tomada USB.";

// Duas intenções distintas (diagnósticos diferentes) que, em algum ponto,
// recomendam a MESMA instrução ("Verificar carregador") — como aconteceria
// na prática se o menu guiado do Mibro encaminhasse dois sintomas diferentes
// de bateria para o mesmo passo de checagem de carregador.
async function createBateriaBot() {
  const bot = await prisma.bot.create({
    data: {
      name: `${botNamePrefix} Bateria`, status: "ACTIVE", channel: "META",
      autoReplyEnabled: true, featureFlags: { agentPlannerEnabled: true },
      initialMessage: "Olá!", outsideHoursMessage: "Fora.", fallbackMessage: "Não entendi.",
      intents: {
        create: [
          {
            name: "Bateria não carrega", active: true, priority: 2,
            examples: { create: [{ text: "minha bateria nao carrega" }, { text: "relogio nao carrega mais" }] },
          },
          {
            name: "Bateria descarrega rápido", active: true, priority: 1,
            examples: { create: [{ text: "bateria descarrega muito rapido" }, { text: "bateria acaba rapido demais" }] },
          },
        ],
      },
    },
    include: { intents: true },
  });
  const intentA = bot.intents.find((i) => i.name === "Bateria não carrega");
  const intentB = bot.intents.find((i) => i.name === "Bateria descarrega rápido");

  // Intenção A: verificar carregador -> "funcionou?" -> handoff se não.
  const a1 = await prisma.botFlowStep.create({
    data: {
      intentId: intentA.id, name: "Verificar carregador", order: 1, action: "USE_RESPONSE_BLOCK",
      responseMessage: null,
    },
  });
  await prisma.botResponseBlock.create({
    data: { botId: bot.id, code: "CHECK_CHARGER_A", name: "Checar carregador A", content: CHARGER_INSTRUCTION, kind: "RESPONSE" },
  }).then((block) => prisma.botFlowStep.update({ where: { id: a1.id }, data: { responseBlockId: block.id } }));
  const a2 = await prisma.botFlowStep.create({
    data: { intentId: intentA.id, name: "Funcionou (A)", order: 2, action: "ASK_QUESTION", question: "Depois disso, funcionou?" },
  });
  const a3 = await prisma.botFlowStep.create({
    data: { intentId: intentA.id, name: "Encaminhar (A)", order: 3, action: "HANDOFF_HUMAN", responseMessage: "Vou te encaminhar para um atendente." },
  });
  await prisma.botFlowStep.update({ where: { id: a1.id }, data: { nextStepId: a2.id } });
  await prisma.botFlowStep.update({ where: { id: a2.id }, data: { onFailureStepId: a3.id, onSuccessStepId: a3.id } });

  // Intenção B: primeiro passo é a MESMA instrução ("Verificar carregador")
  // — se já foi tentada e falhou (Intenção A), o Flow Engine deve pular
  // direto para o encaminhamento em vez de repetir o texto.
  const b1 = await prisma.botFlowStep.create({
    data: {
      intentId: intentB.id, name: "Verificar carregador", order: 1, action: "USE_RESPONSE_BLOCK",
    },
  });
  await prisma.botResponseBlock.create({
    data: { botId: bot.id, code: "CHECK_CHARGER_B", name: "Checar carregador B", content: CHARGER_INSTRUCTION, kind: "RESPONSE" },
  }).then((block) => prisma.botFlowStep.update({ where: { id: b1.id }, data: { responseBlockId: block.id } }));
  const b2 = await prisma.botFlowStep.create({
    data: { intentId: intentB.id, name: "Resolvido (B)", order: 2, action: "RESOLVED", responseMessage: "Ótimo!" },
  });
  const b3 = await prisma.botFlowStep.create({
    data: { intentId: intentB.id, name: "Encaminhar (B)", order: 3, action: "HANDOFF_HUMAN", responseMessage: "Vou te encaminhar para um atendente." },
  });
  await prisma.botFlowStep.update({ where: { id: b1.id }, data: { onSuccessStepId: b2.id, onFailureStepId: b3.id } });

  return { bot, intentA, intentB };
}

test("solução já tentada e confirmada como falha fica registrada no Case State", async () => {
  await cleanup();
  await createBateriaBot();
  const conversation = await seedConversation();

  const first = await sendMessage(conversation, "minha bateria nao carrega");
  assert.match(first.response, new RegExp(CHARGER_INSTRUCTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const second = await sendMessage(conversation, "nao funcionou");
  assert.equal(second.action, "HANDOFF_HUMAN");

  const state = await prisma.conversationBotState.findUnique({ where: { conversationId: conversation.id } });
  const failed = (state.caseState.solutionsFailed || []).map((item) => item.description);
  assert.ok(failed.includes("Verificar carregador"), `solutionsFailed deveria conter "Verificar carregador", veio ${JSON.stringify(failed)}`);
});

test("uma solução já tentada e falha não é repetida num fluxo diferente da mesma conversa", async () => {
  await cleanup();
  await createBateriaBot();
  const conversation = await seedConversation();

  await sendMessage(conversation, "minha bateria nao carrega");
  const failedConfirmation = await sendMessage(conversation, "nao funcionou");
  assert.equal(failedConfirmation.action, "HANDOFF_HUMAN");

  // Novo assunto na mesma conversa: outro sintoma de bateria cujo primeiro
  // passo é a MESMA instrução já tentada e confirmada como ineficaz.
  const third = await sendMessage(conversation, "bateria descarrega muito rapido");

  assert.doesNotMatch(third.response || "", new RegExp(CHARGER_INSTRUCTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // A etapa foi pulada como FAILURE (onFailureStepId da Intenção B aponta
  // para o encaminhamento) — nunca finge que resolveu sozinha.
  assert.equal(third.action, "HANDOFF_HUMAN");
});

test("Bot sem agentPlannerEnabled (default): Case State nunca é lido/escrito, comportamento idêntico ao de antes", async () => {
  await cleanup();
  const bot = await prisma.bot.create({
    data: {
      name: `${botNamePrefix} Legado`, status: "ACTIVE", channel: "META", autoReplyEnabled: true,
      initialMessage: "Olá!", outsideHoursMessage: "Fora.", fallbackMessage: "Não entendi.",
      intents: { create: [{
        name: "Bateria não carrega", active: true, priority: 1,
        examples: { create: [{ text: "minha bateria nao carrega" }] },
      }] },
    },
    include: { intents: true },
  });
  const intentId = bot.intents[0].id;
  const s1 = await prisma.botFlowStep.create({ data: { intentId, name: "Verificar carregador", order: 1, action: "USE_RESPONSE_BLOCK" } });
  const block = await prisma.botResponseBlock.create({
    data: { botId: bot.id, code: "CHECK_CHARGER_LEGACY", name: "Checar carregador", content: CHARGER_INSTRUCTION, kind: "RESPONSE" },
  });
  await prisma.botFlowStep.update({ where: { id: s1.id }, data: { responseBlockId: block.id } });
  const s2 = await prisma.botFlowStep.create({ data: { intentId, name: "Encaminhar", order: 2, action: "HANDOFF_HUMAN", responseMessage: "Vou te encaminhar." } });
  await prisma.botFlowStep.update({ where: { id: s1.id }, data: { nextStepId: s2.id } });

  const conversation = await seedConversation();
  const result = await sendMessage(conversation, "minha bateria nao carrega");
  assert.match(result.response, new RegExp(CHARGER_INSTRUCTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const state = await prisma.conversationBotState.findUnique({ where: { conversationId: conversation.id } });
  assert.equal(state.caseState, null, "Case State nunca deveria ser criado para um Bot sem agentPlannerEnabled");
});
