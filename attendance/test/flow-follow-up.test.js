// Flow Builder × Agenda: nó "Agendar retorno", Perguntas do tipo Data/Horário,
// variáveis de dia/hora da operação, simulação sem gravação e execução real
// idempotente (reentrega do webhook não duplica o retorno). Bot criado na
// Sincrofit do schema de testes (sem outros Bots lá) — nenhuma mensagem real:
// o canal é um stub em memória.
require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/database/prisma");
const flows = require("../src/services/bot-visual-flow-service");
const { parseCustomerDate, parseCustomerTime, runTurn } = require("../src/services/bot-visual-flow-engine");
const { validateGraph } = require("../src/services/bot-visual-flow-graph");
const companyService = require("../src/services/company-service");
const { MIBRO, SINCROFIT } = require("./support/company");

const PREFIX = "flowfu-";
const fx = {};
const node = (key, type, config = {}) => ({ key, type, name: key, x: 0, y: 0, config });
const edge = (source, sourceHandle, target) => ({ id: `${source}:${sourceHandle}`, source, sourceHandle, target });

function scheduleGraph(userId) {
  return {
    nodes: [
      node("start", "start", {}),
      node("askDate", "question", { text: "Para qual dia?", variable: "flow.dataRetorno", answerType: "DATE" }),
      node("askTime", "question", { text: "Que horas?", variable: "flow.horaRetorno", answerType: "TIME" }),
      node("schedule", "schedule_followup", { whenMode: "VARIABLES", dateVariable: "flow.dataRetorno", timeVariable: "flow.horaRetorno", assigneeMode: "PREFERRED_OR_USER", userId, reason: "RETORNO_COMERCIAL", note: "Pedido pelo cliente no WhatsApp" }),
      node("ok", "message", { text: "Combinado! Retorno agendado para {{flow.followUpAt}}." }),
      node("bad", "message", { text: "Não consegui agendar: {{flow.followUpError}}" }),
      node("human", "human_handoff", { reason: "Agendamento falhou" }),
      node("end", "end", { finalizeConversation: false }),
    ],
    edges: [
      edge("start", "next", "askDate"), edge("askDate", "next", "askTime"), edge("askTime", "next", "schedule"),
      edge("schedule", "next", "ok"), edge("schedule", "failed", "bad"), edge("ok", "next", "end"), edge("bad", "next", "human"),
    ],
  };
}

async function cleanup() {
  const bots = await prisma.bot.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const contacts = await prisma.contact.findMany({ where: { externalId: { startsWith: PREFIX } }, select: { id: true } });
  await prisma.followUp.deleteMany({ where: { contactId: { in: contacts.map(({ id }) => id) } } });
  await prisma.botFlowExecution.deleteMany({ where: { botId: { in: bots.map(({ id }) => id) } } });
  await prisma.bot.deleteMany({ where: { id: { in: bots.map(({ id }) => id) } } });
  const conversations = await prisma.conversation.findMany({ where: { contactId: { in: contacts.map(({ id }) => id) } }, select: { id: true } });
  await prisma.botFlowExecution.deleteMany({ where: { conversationId: { in: conversations.map(({ id }) => id) } } });
  await prisma.conversationActivity.deleteMany({ where: { conversationId: { in: conversations.map(({ id }) => id) } } });
  await prisma.message.deleteMany({ where: { conversationId: { in: conversations.map(({ id }) => id) } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversations.map(({ id }) => id) } } });
  await prisma.contact.deleteMany({ where: { id: { in: contacts.map(({ id }) => id) } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@flowfu.test" } } });
}

test.before(async () => {
  await cleanup();
  fx.vendedor = await prisma.user.create({ data: { name: "FlowFU Vendedor", email: "vendedor@flowfu.test", role: "ATENDENTE", companyAccess: { create: [{ companyId: SINCROFIT }] } } });
  fx.fixo = await prisma.user.create({ data: { name: "FlowFU Fixo", email: "fixo@flowfu.test", role: "ATENDENTE", companyAccess: { create: [{ companyId: SINCROFIT }] } } });
  fx.soMibro = await prisma.user.create({ data: { name: "FlowFU Só Mibro", email: "mibro@flowfu.test", role: "ATENDENTE", companyAccess: { create: [{ companyId: MIBRO }] } } });
  companyService.invalidateCompanyCache();
  fx.bot = await prisma.bot.create({ data: { companyId: SINCROFIT, name: `${PREFIX}bot`, type: "STANDARD", channel: "META", status: "ACTIVE", autoReplyEnabled: true, initialMessage: "Olá", outsideHoursMessage: "Fechado", fallbackMessage: "Equipe" } });
  const graph = scheduleGraph(fx.vendedor.id);
  fx.flow = await prisma.botFlow.create({ data: { botId: fx.bot.id, name: `${PREFIX}fluxo`, draftGraph: graph, isDefault: true } });
  const version = await prisma.botFlowVersion.create({ data: { flowId: fx.flow.id, version: 1, graph } });
  await prisma.botFlow.update({ where: { id: fx.flow.id }, data: { status: "ACTIVE", activeVersionId: version.id } });
});

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("Pergunta Data/Horário: linguagem do cliente vira AAAA-MM-DD / HH:MM no fuso de Brasília", () => {
  const now = new Date("2026-03-02T02:30:00Z"); // 23:30 de 01/03 em Brasília
  assert.equal(parseCustomerDate("hoje", now), "2026-03-01");
  assert.equal(parseCustomerDate("Amanhã!", now), "2026-03-02");
  assert.equal(parseCustomerDate("depois de amanhã", now), "2026-03-03");
  assert.equal(parseCustomerDate("10/03", now), "2026-03-10");
  assert.equal(parseCustomerDate("15/02", now), "2027-02-15", "sem ano e já passou: próxima ocorrência");
  assert.equal(parseCustomerDate("10/03/27", now), "2027-03-10");
  assert.equal(parseCustomerDate("31/02/2026", now), null);
  assert.equal(parseCustomerDate("semana que vem", now), null);
  assert.equal(parseCustomerTime("14h"), "14:00");
  assert.equal(parseCustomerTime("14h30"), "14:30");
  assert.equal(parseCustomerTime("às 9"), "09:00");
  assert.equal(parseCustomerTime("9:05"), "09:05");
  assert.equal(parseCustomerTime("25h"), null);
  assert.equal(parseCustomerTime("de tarde"), null);
});

test("validação: responsável obrigatório, variáveis válidas e as duas saídas conectadas", () => {
  const valid = validateGraph(scheduleGraph("user-x"), { userIds: new Set(["user-x"]) });
  assert.equal(valid.valid, true, JSON.stringify(valid.errors));
  const missingUser = validateGraph(scheduleGraph(""), {});
  assert.ok(missingUser.errors.some((error) => error.code === "MISSING_USER"));
  const graph = scheduleGraph("user-x");
  graph.edges = graph.edges.filter((item) => item.sourceHandle !== "failed");
  assert.ok(validateGraph(graph, {}).errors.some((error) => error.nodeKey === "schedule" && error.code === "OUTPUT_MISSING"));
  const badVariable = scheduleGraph("user-x");
  badVariable.nodes.find((item) => item.key === "schedule").config.dateVariable = "contact.name";
  assert.ok(validateGraph(badVariable, {}).errors.some((error) => error.code === "FOLLOW_UP_DATE_VARIABLE"));
  // Variáveis novas de sistema são aceitas em Condições.
  const clock = { nodes: [node("start", "start"), node("c", "condition", { rules: [{ left: "conversation.weekday", operator: "==", right: "sabado" }, { left: "bot.isHoliday", operator: "==", right: "true" }], match: "ANY" }), node("a", "end"), node("b", "end")],
    edges: [edge("start", "next", "c"), edge("c", "true", "a"), edge("c", "false", "b")] };
  assert.equal(validateGraph(clock, {}).valid, true);
});

test("motor: prazo relativo, data no passado vai para 'Não agendado' e falha do adapter nunca confirma", async () => {
  const now = new Date("2026-03-02T15:00:00Z");
  const calls = [];
  const adapter = (result) => ({ async send() {}, async scheduleFollowUp(args) { calls.push(args); return result; }, async finish() {}, async handoff() {} });
  const relative = { nodes: [node("start", "start"), node("s", "schedule_followup", { whenMode: "RELATIVE", amount: 2, unit: "DAYS", time: "10:30", userId: "u" }), node("ok", "end"), node("bad", "end")],
    edges: [edge("start", "next", "s"), edge("s", "next", "ok"), edge("s", "failed", "bad")] };
  let turn = await runTurn({ graph: relative, state: null, input: { type: "START" }, adapter: adapter({ ok: true, followUpId: "f1" }), now });
  assert.equal(calls[0].dueAt.toISOString(), "2026-03-04T13:30:00.000Z");
  assert.equal(turn.state.context.flow.followUpAt, "04/03/2026 às 10:30");
  assert.equal(turn.trace.find((entry) => entry.nodeKey === "s").branch, "next");

  turn = await runTurn({ graph: relative, state: null, input: { type: "START" }, adapter: adapter({ ok: false, error: "Nenhum responsável elegível para o retorno." }), now });
  assert.equal(turn.trace.find((entry) => entry.nodeKey === "s").branch, "failed");
  assert.equal(turn.state.context.flow.followUpAt, "");
  assert.match(turn.state.context.flow.followUpError, /responsável/);

  const past = { ...relative, nodes: relative.nodes.map((item) => (item.key === "s" ? node("s", "schedule_followup", { whenMode: "VARIABLES", dateVariable: "flow.d", time: "08:00", userId: "u" }) : item)) };
  const before = calls.length;
  turn = await runTurn({ graph: past, state: null, input: { type: "START" }, adapter: adapter({ ok: true }), now, seed: { flow: { d: "2026-03-01" } } });
  assert.equal(turn.trace.find((entry) => entry.nodeKey === "s").branch, "failed");
  assert.equal(calls.length, before, "data no passado nem chega ao adapter");
});

async function sincroConversation(extra = {}) {
  const contact = await prisma.contact.create({ data: { companyId: SINCROFIT, externalId: `${PREFIX}${Date.now()}-${Math.random()}`, phone: `55219${String(Date.now()).slice(-8)}`, name: "Cliente FlowFU", ...extra } });
  return prisma.conversation.create({ data: { companyId: SINCROFIT, contactId: contact.id, channel: "META", status: "NOVO" } });
}

const fakeChannel = () => {
  const sent = [];
  return { sent, sendText: async (_phone, text) => { sent.push(text); return { externalId: `wamid.flowfu.${sent.length}.${Math.random()}` }; } };
};

async function say(conversation, text, channel) {
  const message = await prisma.message.create({ data: { conversationId: conversation.id, channel: "META", direction: "RECEBIDA", status: "RECEBIDA", type: "text", text, occurredAt: new Date(), externalId: `wamid.in.${Math.random()}` } });
  await flows.handleIncomingVisualFlow({ type: "text", text }, message, channel);
  return message;
}

test("execução real: cliente informa data/hora, retorno nasce com o atendente fixo; reentrega do webhook não duplica", async () => {
  const conversation = await sincroConversation({ preferredAssigneeId: fx.fixo.id, preferredAssigneeEnabled: true });
  const channel = fakeChannel();
  await say(conversation, "Oi, quero que me liguem", channel);
  assert.match(channel.sent.at(-1), /Para qual dia/);
  await say(conversation, "amanhã", channel);
  assert.match(channel.sent.at(-1), /Que horas/);
  const last = await say(conversation, "15h", channel);
  assert.match(channel.sent.at(-1), /Retorno agendado para \d{2}\/\d{2}\/\d{4} às 15:00/);
  const created = await prisma.followUp.findMany({ where: { conversationId: conversation.id } });
  assert.equal(created.length, 1);
  assert.equal(created[0].assigneeId, fx.fixo.id, "atendente fixo tem prioridade");
  assert.equal(created[0].companyId, SINCROFIT);
  assert.equal(created[0].source, "FLOW");
  assert.equal(created[0].createdById, null);
  const local = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(created[0].dueAt);
  assert.equal(local, "15:00");
  assert.ok(await prisma.conversationActivity.findFirst({ where: { conversationId: conversation.id, action: "BOT_FLOW_FOLLOW_UP_SCHEDULED" } }));
  const sentBefore = channel.sent.length;
  await flows.handleIncomingVisualFlow({ type: "text", text: "15h" }, last, channel);
  assert.equal(await prisma.followUp.count({ where: { conversationId: conversation.id } }), 1, "mesma mensagem reentregue não cria outro retorno");
  assert.equal(channel.sent.length, sentBefore, "nem reenvia a confirmação");
});

test("execução real: sem atendente fixo usa o responsável do nó; responsável sem acesso à empresa vai para 'Não agendado'", async () => {
  const conversation = await sincroConversation();
  const channel = fakeChannel();
  await say(conversation, "Oi", channel);
  await say(conversation, "10/12", channel);
  await say(conversation, "9h", channel);
  const [followUp] = await prisma.followUp.findMany({ where: { conversationId: conversation.id } });
  assert.equal(followUp.assigneeId, fx.vendedor.id);

  // Atendente fixo sem acesso à Sincrofit + nó em modo USER apontando para
  // usuário só-Mibro: nunca vira responsável de cliente da outra empresa.
  const graph = scheduleGraph(fx.soMibro.id);
  graph.nodes.find((item) => item.key === "schedule").config.assigneeMode = "USER";
  const version = await prisma.botFlowVersion.create({ data: { flowId: fx.flow.id, version: 2, graph } });
  await prisma.botFlow.update({ where: { id: fx.flow.id }, data: { activeVersionId: version.id } });
  try {
    const other = await sincroConversation();
    await say(other, "Oi", channel);
    await say(other, "10/12", channel);
    await say(other, "9h", channel);
    assert.equal(await prisma.followUp.count({ where: { conversationId: other.id } }), 0);
    assert.match(channel.sent.at(-1), /Não consegui agendar: Nenhum responsável elegível/);
    const updated = await prisma.conversation.findUnique({ where: { id: other.id } });
    assert.equal(updated.status, "HANDOFF_BOT", "falha vai para a equipe, nunca some em silêncio");
  } finally {
    const original = await prisma.botFlowVersion.findFirst({ where: { flowId: fx.flow.id, version: 1 } });
    await prisma.botFlow.update({ where: { id: fx.flow.id }, data: { activeVersionId: original.id } });
  }
});

test("conversa em andamento mantém a versão em que começou (publicar não troca o fluxo no meio)", async () => {
  const conversation = await sincroConversation();
  const channel = fakeChannel();
  await say(conversation, "Oi", channel);
  const execution = await prisma.botFlowExecution.findFirst({ where: { conversationId: conversation.id } });
  const graph = scheduleGraph(fx.vendedor.id);
  graph.nodes.find((item) => item.key === "askTime").config.text = "VERSÃO NOVA: que horas?";
  const version = await prisma.botFlowVersion.create({ data: { flowId: fx.flow.id, version: 3, graph } });
  await prisma.botFlow.update({ where: { id: fx.flow.id }, data: { activeVersionId: version.id } });
  try {
    await say(conversation, "amanhã", channel);
    assert.match(channel.sent.at(-1), /^Que horas\?/, "execução segue a versão fixada");
    assert.equal((await prisma.botFlowExecution.findUnique({ where: { id: execution.id } })).versionId, execution.versionId);
  } finally {
    const original = await prisma.botFlowVersion.findFirst({ where: { flowId: fx.flow.id, version: 1 } });
    await prisma.botFlow.update({ where: { id: fx.flow.id }, data: { activeVersionId: original.id } });
  }
});

test("simulador: mostra o retorno que seria criado, sem gravar nada", async () => {
  const before = await prisma.followUp.count();
  const messagesBefore = await prisma.message.count();
  const admin = { role: "ADMIN" };
  const now = new Date("2026-03-02T15:00:00Z");
  let result = await flows.simulateFlow(fx.bot.id, fx.flow.id, { source: "ACTIVE" }, admin, { now });
  result = await flows.simulateFlow(fx.bot.id, fx.flow.id, { source: "ACTIVE", state: result.state, message: "amanhã" }, admin, { now });
  result = await flows.simulateFlow(fx.bot.id, fx.flow.id, { source: "ACTIVE", state: result.state, message: "16h" }, admin, { now });
  assert.ok(result.outputs.some((output) => output.type === "event" && /Agendaria retorno .*03\/03\/2026.*16:00/.test(output.text)), JSON.stringify(result.outputs));
  assert.ok(result.outputs.some((output) => /Retorno agendado para 03\/03\/2026 às 16:00/.test(output.text || "")));
  const step = result.trace.find((entry) => entry.nodeKey === "schedule");
  assert.equal(step.branch, "next");
  assert.equal(result.state.context.flow.dataRetorno, "2026-03-03");
  assert.equal(await prisma.followUp.count(), before);
  assert.equal(await prisma.message.count(), messagesBefore);
});

test("isolamento: fluxo da Sincrofit nunca roda para conversa da Mibro", async () => {
  const contact = await prisma.contact.create({ data: { companyId: MIBRO, externalId: `${PREFIX}mibro-${Date.now()}`, phone: "5511900000999", name: "Cliente Mibro FlowFU" } });
  const conversation = await prisma.conversation.create({ data: { companyId: MIBRO, contactId: contact.id, channel: "META", status: "NOVO" } });
  const channel = fakeChannel();
  await say(conversation, "Oi", channel);
  assert.equal(await prisma.botFlowExecution.count({ where: { conversationId: conversation.id, botId: fx.bot.id } }), 0);
  assert.equal(channel.sent.some((text) => /Para qual dia/.test(text)), false);
});
