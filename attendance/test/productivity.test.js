// Produtividade e Qualidade — métricas por ciclo de atendimento, atribuição
// com transferência, reaberturas, Bot, SLA, fuso da operação e o escopo de
// acesso (Master / Supervisor / Atendente, Mibro x Sincrofit, Financeiro).
// Nenhuma mensagem real é enviada: canal Meta é um stub em memória.
require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const prisma = require("../src/database/prisma");
const { createApp } = require("../src/app");
const auth = require("../src/services/auth-service");
const companyService = require("../src/services/company-service");
const productivity = require("../src/services/productivity-service");
const reportAccess = require("../src/services/report-access-service");
const analytics = require("../src/services/conversation-analytics-service");
const { resolvePeriod } = require("../src/services/conversation-report-filters-service");
const { closingMessage, finalizeConversation } = require("../src/services/message-service");
const { MIBRO, SINCROFIT } = require("./support/company");

const DOMAIN = "@produtividade.test";
const PASSWORD = "senha-produtividade-123";
const PREFIX = "pd-";
const DAY = { period: "custom", startDate: "2026-03-02", endDate: "2026-03-02" };
const at = (time) => new Date(`2026-03-02T${time}Z`);
const fx = {};

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const contacts = await prisma.contact.findMany({ where: { externalId: { startsWith: PREFIX } }, select: { id: true } });
  const conversations = await prisma.conversation.findMany({ where: { contactId: { in: contacts.map(({ id }) => id) } }, select: { id: true } });
  const conversationIds = conversations.map(({ id }) => id);
  await prisma.conversationActivity.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: contacts.map(({ id }) => id) } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users.map(({ id }) => id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
  await prisma.category.deleteMany({ where: { code: { startsWith: "PD_" } } });
}

async function viewer(user) {
  return auth.publicUser(await prisma.user.findUnique({ where: { id: user.id } }));
}

async function conversation(key, companyId, categoryId, data = {}) {
  const contact = await prisma.contact.create({ data: { companyId, externalId: `${PREFIX}${key}`, phone: `55119${String(key.length).padStart(2, "0")}${Date.now() % 1000000}`, name: `Cliente ${key}` } });
  return prisma.conversation.create({ data: { companyId, contactId: contact.id, categoryId, status: "EM_ATENDIMENTO", createdAt: at("10:00:00"), ...data } });
}
const customer = (conversationId, time, text = "Oi") => prisma.message.create({ data: { conversationId, direction: "RECEBIDA", status: "RECEBIDA", type: "text", text, occurredAt: at(time) } });
const human = (conversationId, user, time, text = "Olá!") => prisma.message.create({ data: { conversationId, direction: "ENVIADA", status: "ENVIADA", type: "text", text, occurredAt: at(time), sentByUserId: user.id } });
const bot = (conversationId, time) => prisma.message.create({ data: { conversationId, direction: "ENVIADA", status: "ENVIADA", type: "text", text: "Bot", occurredAt: at(time) } });
const activity = (conversationId, action, time, actor = null, details = {}) => prisma.conversationActivity.create({ data: { conversationId, action, actorUserId: actor?.id || null, details, createdAt: at(time) } });

test.before(async () => {
  await cleanup();
  fx.mibroSupport = await prisma.category.create({ data: { companyId: MIBRO, code: "PD_SUPORTE", name: "PD Suporte" } });
  fx.financeiro = await prisma.category.create({ data: { companyId: MIBRO, code: "PD_FINANCEIRO", name: "PD Financeiro", visibilityMode: "SECTOR_PRIVATE" } });
  fx.sincroSupport = await prisma.category.create({ data: { companyId: SINCROFIT, code: "PD_SUPORTE", name: "PD Suporte Sincro" } });
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const makeUser = (key, role, access, categories, extra = {}) => prisma.user.create({ data: {
    name: `PD ${key}`, email: `${key}${DOMAIN}`, passwordHash, role, ...extra,
    companyAccess: { create: access.map(([companyId, companyRole = null]) => ({ companyId, role: companyRole })) },
    categoryAccess: { create: categories.map((categoryId) => ({ categoryId })) },
  } });
  fx.carlos = await makeUser("carlos", "ATENDENTE", [[MIBRO], [SINCROFIT]], [fx.mibroSupport.id, fx.sincroSupport.id]);
  fx.ana = await makeUser("ana", "ATENDENTE", [[MIBRO]], [fx.mibroSupport.id, fx.financeiro.id]);
  fx.emily = await makeUser("emily", "ATENDENTE", [[MIBRO]], [fx.mibroSupport.id], { canViewOwnProductivity: true });
  fx.sup = await makeUser("sup", "SUPERVISOR", [[MIBRO]], [fx.mibroSupport.id]);
  // A VPS usa equipe explicitamente definida pelo Master, não só categorias.
  await prisma.supervisorTeamMember.createMany({ data: [fx.carlos, fx.ana].map(member => ({ supervisorId: fx.sup.id, memberId: member.id })) });
  fx.sincroOnly = await makeUser("sincro", "ATENDENTE", [[SINCROFIT]], [fx.sincroSupport.id]);
  fx.master = await prisma.user.create({ data: { name: "PD Master", email: `master${DOMAIN}`, passwordHash, role: "ADMIN" } });
  companyService.invalidateCompanyCache();

  // C1 (Mibro/Suporte): Carlos começa, transfere para Ana, Ana responde, o
  // Supervisor finaliza (só enviou a despedida automática). Cliente volta em
  // 3h (reabertura) e Ana resolve o novo ciclo.
  fx.c1 = await conversation("c1", MIBRO, fx.mibroSupport.id, { assignedUserId: fx.ana.id });
  await customer(fx.c1.id, "12:00:00");
  await human(fx.c1.id, fx.carlos, "12:05:00");
  await activity(fx.c1.id, "CONVERSATION_CLAIMED", "12:05:01", fx.carlos, { toUserId: fx.carlos.id, automatic: true });
  await customer(fx.c1.id, "12:10:00");
  await activity(fx.c1.id, "CONVERSATION_TRANSFERRED", "12:20:00", fx.carlos, { fromUserId: fx.carlos.id, toUserId: fx.ana.id });
  await human(fx.c1.id, fx.ana, "12:25:00");
  await human(fx.c1.id, fx.sup, "12:30:00", closingMessage);
  await activity(fx.c1.id, "CONVERSATION_TRANSFERRED", "12:30:01", fx.sup, { fromUserId: fx.ana.id, toUserId: fx.sup.id, automatic: true });
  await activity(fx.c1.id, "STATUS_CHANGED", "12:30:05", fx.sup, { from: "AGUARDANDO_CLIENTE", to: "FINALIZADO" });
  await customer(fx.c1.id, "15:00:00", "Voltei");
  await activity(fx.c1.id, "REOPENED_BY_CUSTOMER_MESSAGE", "15:00:01");
  await human(fx.c1.id, fx.ana, "15:10:00");
  await activity(fx.c1.id, "STATUS_CHANGED", "15:20:00", fx.ana, { from: "AGUARDANDO_CLIENTE", to: "FINALIZADO" });

  // C2 (Mibro/Suporte): resolvido só pelo Bot.
  fx.c2 = await conversation("c2", MIBRO, fx.mibroSupport.id, { status: "FINALIZADO" });
  await customer(fx.c2.id, "13:00:00");
  await bot(fx.c2.id, "13:00:05");
  await activity(fx.c2.id, "BOT_FLOW_COMPLETED", "13:01:00", null, { finalizeConversation: true });

  // C3 (Sincrofit): Carlos atende e finaliza.
  fx.c3 = await conversation("c3", SINCROFIT, fx.sincroSupport.id, { assignedUserId: fx.carlos.id });
  await customer(fx.c3.id, "14:00:00");
  await human(fx.c3.id, fx.carlos, "14:02:00");
  await activity(fx.c3.id, "STATUS_CHANGED", "14:10:00", fx.carlos, { from: "AGUARDANDO_CLIENTE", to: "FINALIZADO" });

  // C4 (Mibro/Financeiro protegido): Ana atende e finaliza.
  fx.c4 = await conversation("c4", MIBRO, fx.financeiro.id, { assignedUserId: fx.ana.id });
  await customer(fx.c4.id, "11:00:00", "Segunda via do boleto");
  await human(fx.c4.id, fx.ana, "11:01:00", "Enviando o boleto 123");
  await activity(fx.c4.id, "STATUS_CHANGED", "11:30:00", fx.ana, { from: "AGUARDANDO_CLIENTE", to: "FINALIZADO" });
});

test.after(async () => { await cleanup(); await prisma.$disconnect(); });

// ---------------------------------------------------------------- puros
test("período 'hoje' e datas personalizadas usam o calendário de Brasília, não o fuso do servidor", () => {
  const today = resolvePeriod({ period: "today" }, new Date("2026-10-09T02:00:00Z")); // 08/10 23h em Brasília
  assert.equal(today.start.toISOString(), "2026-10-08T03:00:00.000Z");
  assert.equal(today.end.toISOString(), "2026-10-09T03:00:00.000Z");
  const custom = resolvePeriod(DAY);
  assert.equal(custom.start.toISOString(), "2026-03-02T03:00:00.000Z");
  assert.equal(custom.end.toISOString(), "2026-03-03T03:00:00.000Z");
  const lastMonth = resolvePeriod({ period: "last_month" }, new Date("2026-10-01T01:00:00Z")); // ainda 30/09 em Brasília
  assert.equal(lastMonth.start.toISOString(), "2026-08-01T03:00:00.000Z");
  assert.equal(lastMonth.end.toISOString(), "2026-09-01T03:00:00.000Z");
});

test("ciclo: transferência, despedida automática e Bot — nota de atribuição e tempos corretos", () => {
  const conv = { id: "x", companyId: MIBRO, createdAt: at("09:00:00"), category: null };
  const msg = (id, direction, time, sentByUserId = null) => ({ id, direction, occurredAt: at(time), sentByUserId });
  const act = (action, time, actorUserId, details = {}) => ({ action, createdAt: at(time), actorUserId, details });
  const walk = productivity.walkConversation(conv, [
    msg("m1", "RECEBIDA", "10:00:00"),
    msg("m2", "ENVIADA", "10:00:10"), // Bot: nunca é resposta
    msg("m3", "ENVIADA", "10:02:00", "carlos"),
    msg("m4", "RECEBIDA", "10:03:00"),
    msg("m5", "ENVIADA", "10:13:00", "ana"),
    msg("m6", "ENVIADA", "10:20:00", "sup"), // despedida automática
  ], [
    act("CONVERSATION_TRANSFERRED", "10:10:00", "carlos", { fromUserId: "carlos", toUserId: "ana" }),
    act("CONVERSATION_TRANSFERRED", "10:20:01", "sup", { fromUserId: "ana", toUserId: "sup", automatic: true }),
    act("STATUS_CHANGED", "10:20:03", "sup", { to: "FINALIZADO" }),
  ], { from: at("00:00:00"), closingIds: new Set(["m6"]) });
  assert.equal(walk.cycles.length, 1);
  const [cycle] = walk.cycles;
  assert.equal(cycle.attributedAgentId, "ana", "quem finalizou sem atender não leva o atendimento");
  assert.equal(cycle.finalizerId, "sup");
  assert.deepEqual([...cycle.participants].sort(), ["ana", "carlos"]);
  assert.deepEqual(walk.responses.map((r) => [r.agentId, r.seconds, r.first]), [["carlos", 0, true], ["ana", 0, false]], "07h em Brasília: antes do expediente");
  assert.equal(walk.transfers.length, 1, "transferência gerada pela despedida não conta");
  assert.equal(walk.humanMessages.length, 2, "despedida automática não conta como mensagem de atendimento");
});

test("ciclo: reabertura em até 24h marca o atendimento anterior; Bot sozinho não tem atendente", () => {
  const conv = { id: "y", companyId: MIBRO, createdAt: at("09:00:00"), category: null };
  const walk = productivity.walkConversation(conv, [
    { id: "a", direction: "RECEBIDA", occurredAt: at("10:00:00") },
    { id: "b", direction: "ENVIADA", occurredAt: at("10:00:05"), sentByUserId: null },
    { id: "c", direction: "RECEBIDA", occurredAt: at("12:00:00") },
    { id: "d", direction: "ENVIADA", occurredAt: at("12:01:00"), sentByUserId: "ana" },
  ], [
    { action: "BOT_FLOW_COMPLETED", createdAt: at("10:01:00"), actorUserId: null, details: { finalizeConversation: true } },
    { action: "REOPENED_BY_CUSTOMER_MESSAGE", createdAt: at("12:00:01"), actorUserId: null, details: {} },
  ], { from: at("00:00:00") });
  assert.equal(walk.cycles.length, 2);
  assert.equal(walk.cycles[0].attributedAgentId, null);
  assert.equal(walk.cycles[0].finalKind, "BOT");
  assert.equal(walk.cycles[0].reopened, true);
  assert.equal(walk.cycles[1].finalizedAt, null, "ciclo atual segue aberto");
  assert.equal(walk.responses[0].first, true);
  assert.equal(walk.responses[0].seconds, 60);
});

test("ciclo iniciado antes da janela lida não entra na média de 1ª resposta nem no tempo de atendimento", () => {
  const conv = { id: "z", companyId: MIBRO, createdAt: new Date("2025-01-01T00:00:00Z"), category: null };
  const walk = productivity.walkConversation(conv, [
    { id: "a", direction: "RECEBIDA", occurredAt: at("10:00:00") },
    { id: "b", direction: "ENVIADA", occurredAt: at("10:05:00"), sentByUserId: "ana" },
  ], [{ action: "STATUS_CHANGED", createdAt: at("10:10:00"), actorUserId: "ana", details: { to: "FINALIZADO" } }], { from: at("00:00:00") });
  assert.equal(walk.cycles[0].startKnown, false);
  assert.equal(walk.responses[0].measurable, false);
});

test("SLA de cada resposta segue os prazos configurados; sem SLA ligado, não é medido", () => {
  const settings = { firstResponseSlaEnabled: true, firstResponseSlaMinutes: 10, responseSlaEnabled: false, responseSlaMinutes: 15, slaNearBreachPercent: 80 };
  assert.equal(productivity.slaStateFor({ first: true, seconds: 300 }, settings), "WITHIN");
  assert.equal(productivity.slaStateFor({ first: true, seconds: 540 }, settings), "NEAR");
  assert.equal(productivity.slaStateFor({ first: true, seconds: 601 }, settings), "BREACHED");
  assert.equal(productivity.slaStateFor({ first: false, seconds: 9999 }, settings), null);
});

// ---------------------------------------------------------------- serviço
test("Master: contadores, médias, Bot, reabertura e transferências por ciclo (todas as empresas)", async () => {
  const access = await reportAccess.resolveReportAccess(await viewer(fx.master), {});
  const data = await productivity.getProductivity(access, { ...DAY, categoryId: undefined });
  const mine = (id) => data.agents.find((row) => row.userId === id);
  // Isola as linhas deste teste (o schema de teste é compartilhado).
  const ana = mine(fx.ana.id); const carlos = mine(fx.carlos.id); const sup = mine(fx.sup.id);
  assert.equal(ana.finalized, 3, "C1 (2 ciclos) + C4");
  assert.equal(ana.reopened, 1);
  assert.equal(ana.transfersIn, 1);
  assert.equal(carlos.finalized, 1, "C3 (Sincrofit)");
  assert.equal(carlos.claimed, 1);
  assert.equal(carlos.transfersOut, 1);
  assert.equal(carlos.firstResponseAvgSeconds, (300 + 120) / 2);
  assert.equal(ana.handlingSamples, 3);
  assert.equal(sup?.finalized || 0, 0, "Supervisor que só finalizou não recebe o atendimento");
  assert.equal(sup?.finalizedClicked, 1);
  assert.equal(sup?.messagesSent || 0, 0);
  assert.ok(data.summary.current.finalizedWithoutHuman >= 1, "C2 resolvida só pelo Bot");
  const c1Categories = data.categories.find((c) => c.label === "PD Suporte");
  assert.equal(c1Categories.finalized, 3, "C1 x2 + C2");
});

test("filtros combinados: empresa + equipe + atendente nunca misturam Mibro e Sincrofit", async () => {
  const access = await reportAccess.resolveReportAccess(await viewer(fx.master), { company: "mibro" });
  assert.deepEqual(access.companyIds, [MIBRO]);
  const mibro = await productivity.getProductivity(access, { ...DAY, company: "mibro" });
  assert.equal(mibro.agents.find((row) => row.userId === fx.carlos.id)?.finalized || 0, 0, "atendimento da Sincrofit fora do filtro Mibro");
  assert.ok(!mibro.companies.some((row) => row.company.id === SINCROFIT));
  const team = await productivity.getProductivity(access, { ...DAY, categoryId: fx.financeiro.id });
  assert.equal(team.summary.current.finalized, 1);
  const onlyAna = await productivity.getProductivity(access, { ...DAY, agentId: fx.ana.id });
  assert.equal(onlyAna.agents.length, 1);
  assert.equal(onlyAna.summary.current.finalized, 3);
});

test("período sem dados devolve zeros/null, nunca valores inventados", async () => {
  const access = await reportAccess.resolveReportAccess(await viewer(fx.master), {});
  const data = await productivity.getProductivity(access, { period: "custom", startDate: "2001-01-01", endDate: "2001-01-02", agentId: fx.ana.id });
  assert.equal(data.summary.current.finalized, 0);
  assert.equal(data.summary.current.firstResponseAvgSeconds, null);
  assert.equal(data.summary.current.slaMetPercent, null);
  assert.ok(data.timeseries.points.every((p) => p.finalized === 0));
});

test("Supervisor: só a empresa e as equipes que supervisiona (sem Sincrofit, sem Financeiro protegido)", async () => {
  const access = await reportAccess.resolveReportAccess(await viewer(fx.sup), {});
  assert.equal(access.mode, "SUPERVISOR");
  assert.deepEqual(access.companyIds, [MIBRO]);
  const data = await productivity.getProductivity(access, DAY);
  assert.equal(data.agents.find((row) => row.userId === fx.ana.id).finalized, 2, "só C1 — C4 é do Financeiro protegido");
  assert.equal(data.agents.find((row) => row.userId === fx.carlos.id)?.finalized || 0, 0);
  await assert.rejects(reportAccess.resolveReportAccess(await viewer(fx.sup), { company: "sincrofit" }), { statusCode: 403 });
  await assert.rejects(productivity.getAgentProductivity(access, fx.sincroOnly.id, DAY, await viewer(fx.sup)), { statusCode: 404 });
});

test("Atendente: sem permissão não abre; com permissão vê só os próprios números", async () => {
  await assert.rejects(reportAccess.resolveReportAccess(await viewer(fx.ana), {}), { statusCode: 403 });
  const access = await reportAccess.resolveReportAccess(await viewer(fx.emily), {});
  assert.equal(access.mode, "SELF");
  const data = await productivity.getProductivity(access, { ...DAY, agentId: fx.ana.id });
  assert.equal(data.summary.current.finalized, 0, "pedir outro atendente não vaza os números dele");
  assert.ok(data.agents.every((row) => row.userId === fx.emily.id));
  await assert.rejects(productivity.getAgentProductivity(access, fx.ana.id, DAY, await viewer(fx.emily)), { statusCode: 404 });
});

test("Financeiro protegido: prévia e eventos privados não aparecem para quem não é do setor", async () => {
  const [last] = await prisma.message.findMany({ where: { conversationId: fx.c4.id }, orderBy: { occurredAt: "desc" }, take: 1 });
  assert.ok(last.privateCategoryId, "mensagem do Financeiro carimbada como privada");
  const query = { ...DAY, scope: { id: fx.c4.id } };
  const outsider = await analytics.listConversations(query, { readablePrivateIds: [] });
  assert.equal(outsider.items[0].lastMessagePreview, "[Conteúdo de setor protegido]");
  const member = await analytics.listConversations(query, { readablePrivateIds: [fx.financeiro.id] });
  assert.match(member.items[0].lastMessagePreview, /boleto/);
});

test("finalizar conversa de outro atendente não troca o responsável nem cria transferência (sem envio real)", async () => {
  const conv = await conversation("fin", MIBRO, fx.mibroSupport.id, { assignedUserId: fx.ana.id, createdAt: new Date() });
  await prisma.message.create({ data: { conversationId: conv.id, direction: "RECEBIDA", status: "RECEBIDA", type: "text", text: "oi", externalId: `wamid.${PREFIX}${Date.now()}`, occurredAt: new Date() } });
  const sent = [];
  const channel = { sendText: async (to, text) => { sent.push({ to, text }); return { externalId: `wamid.${PREFIX}closing-${Date.now()}`, data: {} }; } };
  await finalizeConversation({ conversationId: conv.id, sentByUserId: fx.sup.id, channel });
  const after = await prisma.conversation.findUnique({ where: { id: conv.id } });
  assert.equal(after.status, "FINALIZADO");
  assert.equal(after.assignedUserId, fx.ana.id);
  assert.equal(await prisma.conversationActivity.count({ where: { conversationId: conv.id, action: { in: ["CONVERSATION_TRANSFERRED", "CONVERSATION_CLAIMED"] } } }), 0);
  assert.equal(sent.length, 1, "só o stub recebeu a despedida");
});

// ---------------------------------------------------------------- HTTP
async function withServer(run) {
  const sent = [];
  const channel = { sendText: async (...args) => { sent.push(args); return { externalId: "wamid.fake", data: {} }; }, forAccount() { return this; } };
  const server = createApp({ channel }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (key) => {
    const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${key}${DOMAIN}`, password: PASSWORD }) });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  const call = (cookie, path) => fetch(`${base}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
  try { await run({ login, call }); } finally { server.close(); }
  assert.equal(sent.length, 0, "nenhuma mensagem enviada pelos endpoints de relatório");
}

const qs = new URLSearchParams(DAY).toString();

test("HTTP: página e APIs respeitam o papel; IDOR de conversa e de atendente devolve 404", async () => {
  await withServer(async ({ login, call }) => {
    const ana = await login("ana");
    assert.equal((await call(ana, "/produtividade")).status, 403);
    assert.equal((await call(ana, `/api/reports/productivity?${qs}`)).status, 403);
    assert.equal((await call(ana, `/api/reports/conversations/summary?${qs}`)).status, 403);

    const emily = await login("emily");
    assert.equal((await call(emily, "/produtividade")).status, 200);
    const status = await (await call(emily, "/api/auth/status")).json();
    assert.equal(status.user.canOpenProductivity, true);
    const own = await (await call(emily, `/api/reports/productivity?${qs}&agentId=${fx.ana.id}`)).json();
    assert.equal(own.access.mode, "SELF");
    assert.equal(own.summary.current.finalized, 0);
    assert.equal((await call(emily, `/api/reports/conversations/agents/compare?${qs}&userIds=${fx.ana.id}`)).status, 403);
    const csv = await (await call(emily, `/api/reports/productivity/export?${qs}`)).text();
    assert.ok(!csv.includes("PD ana"), "exportação do Atendente nunca traz outra pessoa");

    const sup = await login("sup");
    assert.equal((await call(sup, `/api/reports/productivity?${qs}&company=sincrofit`)).status, 403);
    assert.equal((await call(sup, `/api/reports/conversations/${fx.c3.id}?${qs}`)).status, 404, "Sincrofit");
    assert.equal((await call(sup, `/api/reports/conversations/${fx.c4.id}?${qs}`)).status, 404, "Financeiro protegido");
    assert.equal((await call(sup, `/api/reports/conversations/${fx.c1.id}?${qs}`)).status, 200);
    assert.equal((await call(sup, `/api/reports/productivity/agents/${fx.sincroOnly.id}?${qs}`)).status, 404);
    const supCsv = await (await call(sup, `/api/reports/productivity/export?${qs}`)).text();
    assert.ok(supCsv.includes("PD ana") && !supCsv.includes("PD sincro"));
    const list = await (await call(sup, `/api/reports/conversations?${qs}&pageSize=100`)).json();
    assert.ok(!list.items.some((item) => [fx.c3.id, fx.c4.id].includes(item.id)));

    const master = await login("master");
    const detail = await (await call(master, `/api/reports/conversations/${fx.c1.id}?${qs}`)).json();
    assert.ok(detail.timeline.some((event) => event.label === "Reaberta por mensagem do cliente"), "timeline com rótulos legíveis");
    assert.equal((await call(master, `/api/reports/productivity?${qs}&company=sincrofit`)).status, 200);
  });
});
