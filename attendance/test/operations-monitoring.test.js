// Monitoramento operacional: follow-ups vencidos, falhas de envio, atendente
// fixo ausente, saúde de canais baseada em evidência, diagnóstico só para o
// Master e sanitização de erros. RBAC Master/Supervisor/Atendente e
// isolamento Mibro x Sincrofit.
require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/database/prisma");
const auth = require("../src/services/auth-service");
const companyService = require("../src/services/company-service");
const ops = require("../src/services/operations-panel-service");
const health = require("../src/services/operational-health-service");
const { MIBRO, SINCROFIT } = require("./support/company");

const DOMAIN = "@opsmon.test";
const PREFIX = "opsmon-";
const fx = {};
const viewer = async (user) => auth.publicUser(await prisma.user.findUnique({ where: { id: user.id } }));

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const contacts = await prisma.contact.findMany({ where: { externalId: { startsWith: PREFIX } }, select: { id: true } });
  const ids = contacts.map(({ id }) => id);
  await prisma.followUp.deleteMany({ where: { contactId: { in: ids } } });
  const conversations = (await prisma.conversation.findMany({ where: { contactId: { in: ids } }, select: { id: true } })).map(({ id }) => id);
  await prisma.conversationActivity.deleteMany({ where: { conversationId: { in: conversations } } });
  await prisma.message.deleteMany({ where: { conversationId: { in: conversations } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversations } } });
  await prisma.contact.deleteMany({ where: { id: { in: ids } } });
  await prisma.channelAccount.deleteMany({ where: { name: { startsWith: "OPSMON " } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
  await prisma.category.deleteMany({ where: { code: { startsWith: "OPSMON_" } } });
}

let seq = 0;
async function conversation(companyId, categoryId, data = {}, contactData = {}) {
  seq += 1;
  const contact = await prisma.contact.create({ data: { companyId, externalId: `${PREFIX}${seq}`, phone: `5511966${String(seq).padStart(6, "0")}`, name: `Cliente OPSMON ${seq}`, ...contactData } });
  return prisma.conversation.create({ data: { companyId, contactId: contact.id, categoryId, lastMessageAt: new Date(), ...data } });
}

test.before(async () => {
  await cleanup();
  fx.cat = await prisma.category.create({ data: { companyId: MIBRO, code: "OPSMON_SUP", name: "OPSMON Suporte" } });
  fx.sincroCat = await prisma.category.create({ data: { companyId: SINCROFIT, code: "OPSMON_SUP", name: "OPSMON Sincro" } });
  const make = (key, role, access, categories = []) => prisma.user.create({ data: {
    name: `OPSMON ${key}`, email: `${key}${DOMAIN}`, role,
    companyAccess: { create: access.map(([companyId, companyRole = null]) => ({ companyId, role: companyRole })) },
    categoryAccess: { create: categories.map((categoryId) => ({ categoryId })) },
  } });
  fx.carlos = await make("carlos", "ATENDENTE", [[MIBRO]], [fx.cat.id]);
  fx.fixo = await make("fixo", "ATENDENTE", [[MIBRO]], [fx.cat.id]);
  fx.sup = await make("sup", "ATENDENTE", [[MIBRO, "SUPERVISOR"]], [fx.cat.id]);
  fx.sincro = await make("sincro", "ATENDENTE", [[SINCROFIT]], [fx.sincroCat.id]);
  await prisma.supervisorTeamMember.createMany({ data: [fx.carlos, fx.fixo].map((member) => ({ supervisorId: fx.sup.id, memberId: member.id })) });
  fx.master = await prisma.user.create({ data: { name: "OPSMON Master", email: `master${DOMAIN}`, role: "ADMIN" } });
  companyService.invalidateCompanyCache();

  fx.account = await prisma.channelAccount.create({ data: { companyId: MIBRO, channel: "META", name: "OPSMON Numero Mibro", enabled: true, status: "CONNECTED", config: { phoneNumberId: "opsmon-1", displayNumber: "+55 11 4000-0000" },
    lastErrorAt: new Date(), lastErrorCode: "131047", lastErrorMessage: "Falha Bearer EAABsecretTOKEN1234567890abcdefghijklmnop para +55 11 98888-7777 cliente@exemplo.com" } });
  fx.idleAccount = await prisma.channelAccount.create({ data: { companyId: MIBRO, channel: "META", name: "OPSMON Numero Parado", enabled: true, status: "CONNECTED", config: { phoneNumberId: "opsmon-2" } } });
  fx.sincroAccount = await prisma.channelAccount.create({ data: { companyId: SINCROFIT, channel: "META", name: "OPSMON Numero Sincro", enabled: false, status: "NOT_CONFIGURED", config: {} } });

  // Conversa com envio que falhou (exige ação).
  fx.failed = await conversation(MIBRO, fx.cat.id, { status: "EM_ATENDIMENTO", assignedUserId: fx.carlos.id, channelAccountId: fx.account.id });
  await prisma.message.create({ data: { conversationId: fx.failed.id, channelAccountId: fx.account.id, direction: "RECEBIDA", status: "RECEBIDA", type: "text", text: "oi", externalId: `wamid.opsmon.${Date.now()}`, occurredAt: new Date(Date.now() - 60000) } });
  await prisma.message.create({ data: { conversationId: fx.failed.id, channelAccountId: fx.account.id, direction: "ENVIADA", status: "FALHOU", type: "text", text: "CONTEUDO-QUE-NAO-PODE-VAZAR", occurredAt: new Date(), sentByUserId: fx.carlos.id } });
  // Cliente fixo esperando o atendente fixo.
  fx.waitingFixed = await conversation(MIBRO, fx.cat.id, { status: "AGUARDANDO_EQUIPE", assignedUserId: fx.fixo.id }, { preferredAssigneeId: fx.fixo.id, preferredAssigneeEnabled: true });
  // Follow-ups vencidos: da equipe (Mibro) e da Sincrofit.
  fx.overdue = await prisma.followUp.create({ data: { companyId: MIBRO, contactId: fx.failed.contactId, conversationId: fx.failed.id, assigneeId: fx.carlos.id, createdById: fx.carlos.id, dueAt: new Date(Date.now() - 3600000), reason: "COTACAO", note: "OBSERVACAO-INTERNA" } });
  const sincroConv = await conversation(SINCROFIT, fx.sincroCat.id, { status: "EM_ATENDIMENTO", assignedUserId: fx.sincro.id });
  fx.sincroOverdue = await prisma.followUp.create({ data: { companyId: SINCROFIT, contactId: sincroConv.contactId, conversationId: sincroConv.id, assigneeId: fx.sincro.id, createdById: fx.sincro.id, dueAt: new Date(Date.now() - 3600000), reason: "OUTRO" } });
});

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("Supervisor: follow-ups vencidos da equipe, falha de envio e atendente fixo ausente aparecem em 'Precisa de atenção' — sem conteúdo e sem Sincrofit", async () => {
  const overview = await ops.getOverview(await viewer(fx.sup), {}, { onlineUserIds: new Set() });
  assert.equal(overview.cards.followUpsOverdue, 1);
  assert.equal(overview.cards.sendFailures, 1);
  assert.equal(overview.cards.preferredOffline, 1);
  const reasons = overview.attention.items.map((item) => item.reason);
  assert.ok(reasons.includes("SEND_FAILED"));
  assert.ok(reasons.includes("PREFERRED_OFFLINE"));
  const followUpItem = overview.attention.items.find((item) => item.reason === "FOLLOW_UP_OVERDUE");
  assert.equal(followUpItem.followUpId, fx.overdue.id);
  assert.equal(overview.attention.items.find((item) => item.reason === "SEND_FAILED").severity, "critical");
  const json = JSON.stringify(overview);
  assert.ok(!json.includes("CONTEUDO-QUE-NAO-PODE-VAZAR"));
  assert.ok(!json.includes("OBSERVACAO-INTERNA"));
  assert.ok(!json.includes(fx.sincroOverdue.id));
  const carlos = overview.team.find((member) => member.id === fx.carlos.id);
  assert.equal(carlos.followUpsPending, 1);
  assert.equal(carlos.online, false, "presença só vem da conexão SSE");
  assert.ok(carlos.lastSentAt, "última resposta é evidência separada de presença");
});

test("última resposta respeita empresa e exclui trechos privados não autorizados", async () => {
  const snapshot = await ops.getOverview(await viewer(fx.sup), { company: "mibro" });
  const expected = snapshot.team.find(({ id }) => id === fx.carlos.id).lastSentAt;
  const other = await conversation(SINCROFIT, fx.sincroCat.id, { assignedUserId: fx.carlos.id });
  const future = new Date(Date.now() + 60000);
  await prisma.message.create({ data: { conversationId: other.id, direction: "ENVIADA", status: "ENVIADA", type: "text", text: "QA outra empresa", sentByUserId: fx.carlos.id, occurredAt: future } });
  const privateCategory = await prisma.category.create({ data: { companyId: MIBRO, code: "OPSMON_PRIVATE", name: "OPSMON privado", visibilityMode: "SECTOR_PRIVATE" } });
  try {
    await prisma.message.create({ data: { conversationId: fx.failed.id, direction: "ENVIADA", status: "ENVIADA", type: "text", text: "QA privado", sentByUserId: fx.carlos.id, occurredAt: future, privateCategoryId: privateCategory.id } });
    const actual = await ops.getOverview(await viewer(fx.sup), { company: "mibro" });
    assert.equal(actual.team.find(({ id }) => id === fx.carlos.id).lastSentAt?.toISOString(), expected?.toISOString());
  } finally {
    await prisma.message.deleteMany({ where: { privateCategoryId: privateCategory.id } });
    await prisma.category.delete({ where: { id: privateCategory.id } });
    await prisma.message.deleteMany({ where: { conversationId: other.id } });
    await prisma.conversation.delete({ where: { id: other.id } });
    await prisma.contact.delete({ where: { id: other.contactId } });
  }
});

test("atendente fixo online não é sinalizado como ausente", async () => {
  const overview = await ops.getOverview(await viewer(fx.sup), {}, { onlineUserIds: new Set([fx.fixo.id]) });
  assert.equal(overview.cards.preferredOffline, 0);
  assert.ok(!overview.attention.items.some((item) => item.reason === "PREFERRED_OFFLINE"));
});

test("canais: saúde por evidência, empresas do escopo, erro sanitizado; webhook registrado aparece", async () => {
  health.recordWebhook("META", fx.account.id);
  const channels = await ops.getChannels(await viewer(fx.sup), {});
  const names = channels.accounts.map((account) => account.name);
  assert.ok(names.includes("OPSMON Numero Mibro"));
  assert.ok(!names.includes("OPSMON Numero Sincro"), "Supervisor só da Mibro não vê canal da Sincrofit");
  const active = channels.accounts.find((account) => account.id === fx.account.id);
  assert.equal(active.health, "ATTENTION");
  assert.equal(active.failures24h, 1);
  assert.ok(active.lastWebhookAt);
  assert.ok(active.lastInboundAt);
  const idle = channels.accounts.find((account) => account.id === fx.idleAccount.id);
  assert.equal(idle.health, "NO_EVIDENCE", "marcado como conectado não significa que funciona");
  const json = JSON.stringify(channels);
  for (const secret of ["EAABsecretTOKEN", "98888-7777", "cliente@exemplo.com", "CONTEUDO-QUE-NAO-PODE-VAZAR"]) assert.ok(!json.includes(secret), secret);
  const master = await ops.getChannels(await viewer(fx.master), { company: "sincrofit" });
  assert.deepEqual(master.accounts.filter((account) => account.name.startsWith("OPSMON")).map((account) => account.health), ["DISABLED"]);
});

test("diagnóstico técnico: só Master; mostra versão, banco, jobs e envio em massa desligado — sem segredos", async () => {
  await assert.rejects(health.getDiagnostics(await viewer(fx.sup)), (error) => error.statusCode === 403);
  await assert.rejects(health.getDiagnostics(await viewer(fx.carlos)), (error) => error.statusCode === 403);
  const diagnostics = await health.getDiagnostics(await viewer(fx.master));
  assert.equal(diagnostics.database.ok, true);
  assert.ok(diagnostics.app.version);
  assert.equal(diagnostics.automation.massMessagingEnabled, false);
  assert.ok(!JSON.stringify(diagnostics).match(/DATABASE_URL|postgres(ql)?:\/\/|SESSION_SECRET/i));
});

test("Atendente não acessa a Central de Operação nem os canais", async () => {
  const carlos = await viewer(fx.carlos);
  await assert.rejects(ops.getOverview(carlos, {}), (error) => error.statusCode === 403);
  await assert.rejects(ops.getChannels(carlos, {}), (error) => error.statusCode === 403);
});

test("sanitização de erros remove token, telefone, e-mail e sequências longas", () => {
  const text = health.sanitizeError("Bearer abc.def access_token=XYZ123 EAAB1234567890abcdef +55 (11) 98888-7777 joao@x.com 0123456789abcdef0123456789abcdef01");
  assert.ok(!/abc\.def|XYZ123|EAAB1234|98888|joao@x\.com|0123456789abcdef0123/.test(text), text);
});
