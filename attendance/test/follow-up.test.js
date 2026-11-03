// Agenda e Follow-ups — criação, edição, reagendamento, conclusão,
// cancelamento, atraso derivado, fuso da operação, responsável (atendente
// fixo), RBAC Master/Supervisor/Atendente, isolamento Mibro x Sincrofit,
// Financeiro protegido, lembretes idempotentes, janela de 24h por número e
// IDOR pelas rotas HTTP. Nenhuma mensagem é enviada (nada aqui chama canal).
require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const prisma = require("../src/database/prisma");
const { createApp } = require("../src/app");
const auth = require("../src/services/auth-service");
const companyService = require("../src/services/company-service");
const followUps = require("../src/services/follow-up-service");
const privateSegments = require("../src/services/private-segment-service");
const { MIBRO, SINCROFIT } = require("./support/company");

const DOMAIN = "@followup.test";
const PASSWORD = "senha-followup-123";
const PREFIX = "fu-";
const NOW = new Date("2026-03-02T15:00:00.000Z"); // 12:00 em Brasília
const fx = {};

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const contacts = await prisma.contact.findMany({ where: { externalId: { startsWith: PREFIX } }, select: { id: true } });
  const contactIds = contacts.map(({ id }) => id);
  await prisma.followUp.deleteMany({ where: { contactId: { in: contactIds } } });
  const conversations = await prisma.conversation.findMany({ where: { contactId: { in: contactIds } }, select: { id: true } });
  const conversationIds = conversations.map(({ id }) => id);
  await prisma.conversationActivity.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
  await prisma.channelAccount.deleteMany({ where: { name: { startsWith: "FU " } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users.map(({ id }) => id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
  await prisma.category.deleteMany({ where: { code: { startsWith: "FU_" } } });
}

async function viewer(user) {
  return auth.publicUser(await prisma.user.findUnique({ where: { id: user.id } }));
}

let seq = 0;
async function conversation(companyId, categoryId, data = {}, contactData = {}) {
  seq += 1;
  const contact = await prisma.contact.create({ data: { companyId, externalId: `${PREFIX}${seq}`, phone: `5511977${String(seq).padStart(6, "0")}`, name: `Cliente FU ${seq}`, ...contactData } });
  return prisma.conversation.create({ data: { companyId, contactId: contact.id, categoryId, status: "EM_ATENDIMENTO", ...data } });
}

const tomorrowLocal = () => {
  const d = new Date(Date.now() + 36 * 3600 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

test.before(async () => {
  await cleanup();
  fx.suporte = await prisma.category.create({ data: { companyId: MIBRO, code: "FU_SUPORTE", name: "FU Suporte" } });
  fx.financeiro = await prisma.category.create({ data: { companyId: MIBRO, code: "FU_FINANCEIRO", name: "FU Financeiro", visibilityMode: "SECTOR_PRIVATE" } });
  fx.sincro = await prisma.category.create({ data: { companyId: SINCROFIT, code: "FU_SUPORTE", name: "FU Suporte Sincro" } });
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const makeUser = (key, role, access, categories, extra = {}) => prisma.user.create({ data: {
    name: `FU ${key}`, email: `${key}${DOMAIN}`, passwordHash, role, ...extra,
    companyAccess: { create: access.map(([companyId, companyRole = null]) => ({ companyId, role: companyRole })) },
    categoryAccess: { create: categories.map((categoryId) => ({ categoryId })) },
  } });
  // Atendente A: Mibro + Sincrofit. Atendente B (ana): só Mibro, membro do
  // Financeiro. Supervisor C: Supervisor na Mibro e Atendente na Sincrofit.
  fx.carlos = await makeUser("carlos", "ATENDENTE", [[MIBRO], [SINCROFIT]], [fx.suporte.id, fx.sincro.id]);
  fx.ana = await makeUser("ana", "ATENDENTE", [[MIBRO]], [fx.suporte.id, fx.financeiro.id]);
  fx.bia = await makeUser("bia", "ATENDENTE", [[MIBRO]], [fx.suporte.id]);
  fx.sup = await makeUser("sup", "ATENDENTE", [[MIBRO, "SUPERVISOR"], [SINCROFIT, "ATENDENTE"]], [fx.suporte.id, fx.sincro.id]);
  await prisma.supervisorTeamMember.create({ data: { supervisorId: fx.sup.id, memberId: fx.carlos.id } });
  fx.sincroOnly = await makeUser("sincro", "ATENDENTE", [[SINCROFIT]], [fx.sincro.id]);
  fx.master = await prisma.user.create({ data: { name: "FU Master", email: `master${DOMAIN}`, passwordHash, role: "ADMIN" } });
  companyService.invalidateCompanyCache();

  fx.convCarlos = await conversation(MIBRO, fx.suporte.id, { assignedUserId: fx.carlos.id });
  fx.convFixed = await conversation(MIBRO, fx.suporte.id, { assignedUserId: fx.bia.id }, { preferredAssigneeId: fx.carlos.id, preferredAssigneeEnabled: true });
  fx.convSincro = await conversation(SINCROFIT, fx.sincro.id, { assignedUserId: fx.sincroOnly.id });
  fx.convFinanceiro = await conversation(MIBRO, fx.financeiro.id, { assignedUserId: fx.ana.id }, { preferredAssigneeId: fx.carlos.id, preferredAssigneeEnabled: true });
});

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("data/hora local da operação vira UTC correto e o atraso é derivado do relógio", () => {
  assert.equal(followUps.parseDueAt({ date: "2026-03-02", time: "14:00" }).toISOString(), "2026-03-02T17:00:00.000Z");
  assert.equal(followUps.parseDueAt({ date: "2026-03-02", time: "25:00" }), null);
  assert.equal(followUps.parseDueAt({ date: "02/03/2026", time: "10:00" }), null);
  const pending = { status: "PENDENTE", dueAt: new Date("2026-03-02T14:00:00Z") };
  assert.equal(followUps.derivedState(pending, NOW), "ATRASADO");
  assert.equal(followUps.derivedState(pending, new Date("2026-03-02T13:00:00Z")), "PENDENTE");
  assert.equal(followUps.derivedState({ ...pending, status: "CONCLUIDO" }, NOW), "CONCLUIDO");
});

test("visões Hoje/Amanhã seguem o calendário de Brasília, mesmo perto da meia-noite UTC", () => {
  // 23:30 de 02/03 em Brasília = 02:30Z de 03/03.
  const lateNight = new Date("2026-03-03T02:30:00Z");
  const today = followUps.viewWhere("TODAY", lateNight).dueAt;
  const tomorrow = followUps.viewWhere("TOMORROW", lateNight).dueAt;
  assert.equal(today.gte.toISOString(), "2026-03-02T03:00:00.000Z");
  assert.equal(today.lt.toISOString(), "2026-03-03T03:00:00.000Z");
  assert.equal(tomorrow.gte.toISOString(), "2026-03-03T03:00:00.000Z");
  // Semana termina no fim do domingo (02/03/2026 é segunda-feira).
  assert.equal(followUps.viewWhere("WEEK", NOW).dueAt.lt.toISOString(), "2026-03-09T03:00:00.000Z");
});

test("atendente agenda retorno na conversa: empresa/número vêm da conversa, atividade e auditoria registradas", async () => {
  const carlos = await viewer(fx.carlos);
  const { followUp, created } = await followUps.createFollowUp(carlos, {
    conversationId: fx.convCarlos.id, date: "2026-03-03", time: "10:30", reason: "COTACAO", note: "Enviar cotação do GS Pro", priority: "ALTA",
  }, { now: NOW });
  assert.equal(created, true);
  assert.equal(followUp.companyId, MIBRO);
  assert.equal(followUp.assigneeId, fx.carlos.id);
  assert.equal(followUp.dueAt.toISOString(), "2026-03-03T13:30:00.000Z");
  assert.equal(followUp.privateCategoryId, null);
  const activity = await prisma.conversationActivity.findFirst({ where: { conversationId: fx.convCarlos.id, action: "FOLLOW_UP_CREATED" } });
  assert.equal(activity.details.followUpId, followUp.id);
  assert.equal(activity.details.note, undefined, "observação nunca vai para a linha do tempo");
  assert.ok(await prisma.auditLog.findFirst({ where: { entityType: "FOLLOW_UP", entityId: followUp.id } }));
  fx.carlosFollowUp = followUp;

  await assert.rejects(followUps.createFollowUp(carlos, { conversationId: fx.convCarlos.id, date: "2026-03-01", time: "10:00", reason: "COTACAO" }, { now: NOW }), /já passou/);
  await assert.rejects(followUps.createFollowUp(carlos, { conversationId: fx.convCarlos.id, date: "2026-03-03", time: "10:00", reason: "INVENTADO" }, { now: NOW }), /Motivo inválido/);
  await assert.rejects(followUps.createFollowUp(carlos, { conversationId: fx.convCarlos.id, date: "2026-03-03", time: "10:00", reason: "OUTRO", priority: "MAXIMA" }, { now: NOW }), /Prioridade inválida/);
});

test("responsável: atendente fixo é sugerido; atendente comum não agenda para colega qualquer", async () => {
  const bia = await viewer(fx.bia);
  const options = await followUps.formOptions(bia, { conversationId: fx.convFixed.id });
  assert.equal(options.suggestedAssigneeId, fx.carlos.id, "atendente fixo sugerido");
  assert.deepEqual(options.assignees.map(({ id }) => id).sort(), [fx.bia.id, fx.carlos.id].sort());
  const { followUp } = await followUps.createFollowUp(bia, { conversationId: fx.convFixed.id, date: "2026-03-04", time: "09:00", reason: "RETORNO_COMERCIAL", assigneeId: fx.carlos.id }, { now: NOW });
  assert.equal(followUp.assigneeId, fx.carlos.id);
  // O atendente fixo do cliente continua o mesmo (agenda nunca mexe nisso).
  const contact = await prisma.contact.findUnique({ where: { id: fx.convFixed.contactId } });
  assert.equal(contact.preferredAssigneeId, fx.carlos.id);
  await assert.rejects(
    followUps.createFollowUp(bia, { conversationId: fx.convFixed.id, date: "2026-03-04", time: "09:00", reason: "OUTRO", assigneeId: fx.ana.id }, { now: NOW }),
    (error) => error.statusCode === 403,
  );
  // Usuário sem acesso à empresa nunca é responsável (nem para o Master).
  await assert.rejects(
    followUps.createFollowUp(await viewer(fx.master), { conversationId: fx.convFixed.id, date: "2026-03-04", time: "09:00", reason: "OUTRO", assigneeId: fx.sincroOnly.id }, { now: NOW }),
    /Responsável inválido/,
  );
  fx.fixedFollowUp = followUp;
});

test("Agenda por papel: Atendente vê os próprios, Supervisor a equipe, Master tudo; empresas nunca se misturam", async () => {
  const sincro = await viewer(fx.sincroOnly);
  const { followUp: sincroFollowUp } = await followUps.createFollowUp(sincro, { conversationId: fx.convSincro.id, date: "2026-03-03", time: "11:00", reason: "POS_VENDA" }, { now: NOW });
  const ids = async (user, query = {}) => (await followUps.listFollowUps(await viewer(user), { view: "ALL", ...query }, { now: NOW })).items.map(({ id }) => id);

  const carlosIds = await ids(fx.carlos);
  assert.ok(carlosIds.includes(fx.carlosFollowUp.id) && carlosIds.includes(fx.fixedFollowUp.id));
  assert.ok(!carlosIds.includes(sincroFollowUp.id), "Carlos acessa a Sincrofit, mas o retorno é de outra pessoa");
  const biaIds = await ids(fx.bia);
  assert.ok(biaIds.includes(fx.fixedFollowUp.id), "quem criou também acompanha");
  assert.ok(!biaIds.includes(fx.carlosFollowUp.id));
  const sincroIds = await ids(fx.sincroOnly);
  assert.deepEqual(sincroIds, [sincroFollowUp.id], "usuário só-Sincrofit nunca recebe item da Mibro");

  // Supervisor C: Supervisor na Mibro (vê a equipe: Carlos), Atendente na
  // Sincrofit (lá não ganha visão de equipe).
  const supIds = await ids(fx.sup);
  assert.ok(supIds.includes(fx.carlosFollowUp.id) && supIds.includes(fx.fixedFollowUp.id));
  assert.ok(!supIds.includes(sincroFollowUp.id));
  const masterIds = await ids(fx.master);
  for (const id of [fx.carlosFollowUp.id, fx.fixedFollowUp.id, sincroFollowUp.id]) assert.ok(masterIds.includes(id));
  assert.ok(!(await ids(fx.master, { company: "sincrofit" })).includes(fx.carlosFollowUp.id));
  await assert.rejects(followUps.listFollowUps(sincro, { company: "mibro" }, { now: NOW }), (error) => error.statusCode === 403);
  fx.sincroFollowUp = sincroFollowUp;
});

test("editar, reagendar e trocar responsável: contador, lembretes zerados e conflito de edição simultânea", async () => {
  const carlos = await viewer(fx.carlos);
  await prisma.followUp.update({ where: { id: fx.carlosFollowUp.id }, data: { remindedAt: NOW } });
  const updated = await followUps.updateFollowUp(carlos, fx.carlosFollowUp.id, { date: "2026-03-05", time: "16:00", note: "Ligar à tarde" }, { now: NOW });
  assert.equal(updated.rescheduleCount, 1);
  assert.equal(new Date(updated.dueAt).toISOString(), "2026-03-05T19:00:00.000Z");
  assert.equal(updated.note, "Ligar à tarde");
  const stored = await prisma.followUp.findUnique({ where: { id: fx.carlosFollowUp.id } });
  assert.equal(stored.remindedAt, null, "reagendar permite novo lembrete");
  assert.ok(await prisma.conversationActivity.findFirst({ where: { action: "FOLLOW_UP_RESCHEDULED", details: { path: ["followUpId"], equals: fx.carlosFollowUp.id } } }));

  // Supervisor da equipe troca o responsável para outro membro elegível.
  const sup = await viewer(fx.sup);
  const reassigned = await followUps.updateFollowUp(sup, fx.carlosFollowUp.id, { assigneeId: fx.sup.id }, { now: NOW });
  assert.equal(reassigned.assignee.id, fx.sup.id);
  await followUps.updateFollowUp(sup, fx.carlosFollowUp.id, { assigneeId: fx.carlos.id }, { now: NOW });

  // Atendente fora da equipe/sem vínculo não altera.
  await assert.rejects(followUps.updateFollowUp(await viewer(fx.ana), fx.carlosFollowUp.id, { priority: "URGENTE" }, { now: NOW }), (error) => [403, 404].includes(error.statusCode));
});

test("concluir e cancelar: somente pendentes, sem reabrir em silêncio", async () => {
  const carlos = await viewer(fx.carlos);
  const done = await followUps.completeFollowUp(carlos, fx.fixedFollowUp.id, { note: "Cliente fechou pedido" }, { now: NOW });
  assert.equal(done.status, "CONCLUIDO");
  assert.match(done.note, /Conclusão: Cliente fechou pedido/);
  await assert.rejects(followUps.updateFollowUp(carlos, fx.fixedFollowUp.id, { priority: "ALTA" }, { now: NOW }), (error) => error.statusCode === 409);
  await assert.rejects(followUps.cancelFollowUp(carlos, fx.fixedFollowUp.id, {}, { now: NOW }), (error) => error.statusCode === 409);
  const { followUp } = await followUps.createFollowUp(carlos, { conversationId: fx.convCarlos.id, date: "2026-03-06", time: "08:00", reason: "AGUARDAR_DOCUMENTO" }, { now: NOW });
  const cancelled = await followUps.cancelFollowUp(carlos, followUp.id, { reason: "Cliente desistiu" }, { now: NOW });
  assert.equal(cancelled.status, "CANCELADO");
  const list = await followUps.listFollowUps(carlos, { view: "CANCELLED" }, { now: NOW });
  assert.ok(list.items.some(({ id }) => id === followUp.id));
  assert.equal(list.counts.CANCELLED >= 1, true);
});

test("atrasado aparece em Atrasados com estado ATRASADO; conversa finalizada e reaberta não mexe no retorno", async () => {
  const carlos = await viewer(fx.carlos);
  const late = await prisma.followUp.create({ data: {
    companyId: MIBRO, contactId: fx.convCarlos.contactId, conversationId: fx.convCarlos.id, assigneeId: fx.carlos.id, createdById: fx.carlos.id,
    dueAt: new Date("2026-03-02T12:00:00Z"), reason: "NEGOCIACAO",
  } });
  const overdue = await followUps.listFollowUps(carlos, { view: "OVERDUE" }, { now: NOW });
  const item = overdue.items.find(({ id }) => id === late.id);
  assert.equal(item.state, "ATRASADO");
  assert.ok(overdue.counts.OVERDUE >= 1);
  await prisma.conversation.update({ where: { id: fx.convCarlos.id }, data: { status: "FINALIZADO", finalizedAt: NOW } });
  await prisma.conversation.update({ where: { id: fx.convCarlos.id }, data: { status: "AGUARDANDO_EQUIPE", finalizedAt: null } });
  assert.equal((await prisma.followUp.findUnique({ where: { id: late.id } })).status, "PENDENTE");
  await prisma.conversation.update({ where: { id: fx.convCarlos.id }, data: { status: "EM_ATENDIMENTO" } });
  fx.late = late;
});

test("Financeiro: retorno nasce protegido; atendente fixo não lê a observação; membro do setor e Master leem", async () => {
  const ana = await viewer(fx.ana);
  const { followUp } = await followUps.createFollowUp(ana, {
    conversationId: fx.convFinanceiro.id, date: "2026-03-03", time: "15:00", reason: "AGUARDAR_DOCUMENTO", note: "Boleto vencido 2x — negociar juros", assigneeId: fx.carlos.id,
  }, { now: NOW });
  assert.equal(followUp.privateCategoryId, fx.financeiro.id);
  const carlosView = (await followUps.listFollowUps(await viewer(fx.carlos), { view: "ALL" }, { now: NOW })).items.find(({ id }) => id === followUp.id);
  assert.equal(carlosView.restricted, true);
  assert.equal(carlosView.note, null);
  assert.equal(carlosView.privateSector, "Setor protegido");
  assert.equal(carlosView.canOpenConversation, false, "atendente fixo não abre a conversa do Financeiro");
  await assert.rejects(followUps.updateFollowUp(await viewer(fx.carlos), followUp.id, { note: "tentativa" }, { now: NOW }), (error) => error.statusCode === 403);
  const anaView = await followUps.getFollowUp(ana, followUp.id, { now: NOW });
  assert.equal(anaView.note, "Boleto vencido 2x — negociar juros");
  const masterView = await followUps.getFollowUp(await viewer(fx.master), followUp.id, { now: NOW });
  assert.equal(masterView.note, "Boleto vencido 2x — negociar juros");
  // Linha do tempo: o evento do retorno é privado e some para quem não lê.
  const activities = await prisma.conversationActivity.findMany({ where: { conversationId: fx.convFinanceiro.id } });
  const visibleToCarlos = privateSegments.sanitizeActivities(activities, await privateSegments.readablePrivateCategoryIds(await viewer(fx.carlos)));
  assert.equal(visibleToCarlos.some((activity) => activity.action === "FOLLOW_UP_CREATED"), false);
  fx.financeiroFollowUp = followUp;
});

test("lembretes: próximo e vencido avisam uma única vez, mesmo com ticks concorrentes; empresa inativa não avisa", async () => {
  const carlos = await viewer(fx.carlos);
  const { followUp: soon } = await followUps.createFollowUp(carlos, { conversationId: fx.convCarlos.id, dueAt: new Date(NOW.getTime() + 10 * 60000).toISOString(), reason: "RETORNO_COMERCIAL" }, { now: NOW });
  const calls = [];
  const notify = async (followUp, kind) => { calls.push([followUp.id, kind]); };
  const [a, b] = await Promise.all([
    followUps.runReminderTick({ now: NOW, lead: 15, notify }),
    followUps.runReminderTick({ now: NOW, lead: 15, notify }),
  ]);
  assert.equal(calls.filter(([id, kind]) => id === soon.id && kind === "DUE_SOON").length, 1);
  assert.equal(calls.filter(([id, kind]) => id === fx.late.id && kind === "OVERDUE").length, 1);
  assert.ok(a.dueSoon + b.dueSoon >= 1);
  calls.length = 0;
  await followUps.runReminderTick({ now: new Date(NOW.getTime() + 11 * 60000), lead: 15, notify });
  assert.deepEqual(calls.filter(([id]) => id === fx.late.id), [], "vencido não repete");
  assert.deepEqual(calls.filter(([id]) => id === soon.id).map(([, kind]) => kind), ["OVERDUE"], "o mesmo retorno avisa quando vence");

  // Sincrofit desativada (estado de produção): nenhum aviso sai.
  await prisma.company.update({ where: { id: SINCROFIT }, data: { active: false } });
  companyService.invalidateCompanyCache();
  try {
    calls.length = 0;
    await followUps.runReminderTick({ now: new Date("2026-03-03T14:30:00Z"), lead: 60, notify });
    assert.equal(calls.some(([id]) => id === fx.sincroFollowUp.id), false);
    // E o usuário perde a Agenda daquela empresa junto com o acesso.
    const list = await followUps.listFollowUps(await viewer(fx.sincroOnly), { view: "ALL" }, { now: NOW });
    assert.equal(list.items.length, 0);
  } finally {
    await prisma.company.update({ where: { id: SINCROFIT }, data: { active: true } });
    companyService.invalidateCompanyCache();
  }
});

test("reagendamento entre seleção e reivindicação não consome nem envia o lembrete da nova data", async () => {
  const original = prisma.followUp.findMany.bind(prisma.followUp);
  for (const advance of [0, 10]) {
    const { followUp } = await followUps.createFollowUp(await viewer(fx.carlos), { conversationId: fx.convCarlos.id, dueAt: new Date(NOW.getTime() + 5 * 60000).toISOString() }, { now: NOW });
    const later = new Date(NOW.getTime() + 86400000);
    let changed = false;
    const notifications = [];
    prisma.followUp.findMany = async (args) => {
      const rows = await original(args);
      if (!changed && rows.some(({ id }) => id === followUp.id)) {
        changed = true;
        await prisma.followUp.update({ where: { id: followUp.id }, data: { dueAt: later, remindedAt: null, overdueNotifiedAt: null } });
      }
      return rows;
    };
    try {
      await followUps.runReminderTick({ now: new Date(NOW.getTime() + advance * 60000), lead: 15, notify: async (row) => notifications.push(row.id) });
      assert.equal(changed, true);
      assert.ok(!notifications.includes(followUp.id));
      const row = await prisma.followUp.findUnique({ where: { id: followUp.id } });
      assert.equal(row.remindedAt, null);
      assert.equal(row.overdueNotifiedAt, null);
    } finally { prisma.followUp.findMany = original; }
  }
});

test("lembretes não notificam usuário inativo ou sem acesso atual à empresa; usuário autorizado continua recebendo", async () => {
  const push = require("../src/services/push-service");
  const events = require("../src/realtime/inbox-events");
  const originalPush = push.notifyUser;
  const originalPublish = events.publishToUsers;
  const calls = [];
  push.notifyUser = async (id) => calls.push(["push", id]);
  events.publishToUsers = (ids) => calls.push(["sse", ...ids]);
  try {
    const { followUp } = await followUps.createFollowUp(await viewer(fx.bia), { conversationId: fx.convFixed.id, dueAt: new Date(NOW.getTime() + 5 * 60000).toISOString() }, { now: NOW });
    const tick = async () => {
      await prisma.followUp.update({ where: { id: followUp.id }, data: { remindedAt: null } });
      calls.length = 0;
      await followUps.runReminderTick({ now: NOW, lead: 15 });
      return calls.filter((entry) => entry.includes(fx.bia.id));
    };
    await prisma.userCompanyAccess.update({ where: { userId_companyId: { userId: fx.bia.id, companyId: MIBRO } }, data: { active: false } });
    assert.deepEqual(await tick(), []);
    await prisma.userCompanyAccess.update({ where: { userId_companyId: { userId: fx.bia.id, companyId: MIBRO } }, data: { active: true } });
    await prisma.user.update({ where: { id: fx.bia.id }, data: { active: false } });
    assert.deepEqual(await tick(), []);
    await prisma.user.update({ where: { id: fx.bia.id }, data: { active: true } });
    await prisma.user.update({ where: { id: fx.bia.id }, data: { role: "BOT" } });
    assert.deepEqual(await tick(), []);
    await prisma.user.update({ where: { id: fx.bia.id }, data: { role: "ATENDENTE" } });
    await prisma.company.update({ where: { id: MIBRO }, data: { active: false } });
    companyService.invalidateCompanyCache();
    assert.deepEqual(await tick(), []);
    await prisma.company.update({ where: { id: MIBRO }, data: { active: true } });
    companyService.invalidateCompanyCache();
    assert.ok((await tick()).some(([type]) => type === "push"));
  } finally {
    push.notifyUser = originalPush;
    events.publishToUsers = originalPublish;
    await prisma.user.update({ where: { id: fx.bia.id }, data: { active: true, role: "ATENDENTE" } });
    await prisma.company.update({ where: { id: MIBRO }, data: { active: true } });
    companyService.invalidateCompanyCache();
    await prisma.userCompanyAccess.update({ where: { userId_companyId: { userId: fx.bia.id, companyId: MIBRO } }, data: { active: true } });
  }
});

test("reatribuição invalida a agenda dos dois responsáveis elegíveis sem enviar conteúdo ao anterior", async () => {
  const events = require("../src/realtime/inbox-events");
  const push = require("../src/services/push-service");
  const originalPublish = events.publishToUsers;
  const originalPush = push.notifyUser;
  const calls = [];
  events.publishToUsers = (ids) => calls.push(["sse", ...ids]);
  push.notifyUser = async (id) => calls.push(["push", id]);
  try {
    const { followUp } = await followUps.createFollowUp(await viewer(fx.bia), { conversationId: fx.convFixed.id, date: tomorrowLocal(), time: "14:00" });
    calls.length = 0;
    await followUps.updateFollowUp(await viewer(fx.master), followUp.id, { assigneeId: fx.carlos.id });
    assert.ok(calls.some(([kind, id]) => kind === "sse" && id === fx.bia.id));
    assert.ok(calls.some(([kind, id]) => kind === "push" && id === fx.carlos.id));
    assert.ok(!calls.some(([kind, id]) => kind === "push" && id === fx.bia.id));
  } finally { events.publishToUsers = originalPublish; push.notifyUser = originalPush; }
});

test("reagendamento depois da reivindicação também impede aviso vencido", async () => {
  const { followUp } = await followUps.createFollowUp(await viewer(fx.bia), { conversationId: fx.convFixed.id, dueAt: NOW.toISOString() }, { now: NOW });
  const push = require("../src/services/push-service");
  const originalPush = push.notifyUser;
  const originalUpdate = prisma.followUp.updateMany.bind(prisma.followUp);
  const notified = [];
  push.notifyUser = async (id) => notified.push(id);
  prisma.followUp.updateMany = async (args) => {
    const result = await originalUpdate(args);
    if (args.where.id === followUp.id && result.count === 1) await prisma.followUp.update({ where: { id: followUp.id }, data: { dueAt: new Date(NOW.getTime() + 86400000), remindedAt: null, overdueNotifiedAt: null } });
    return result;
  };
  try {
    await followUps.runReminderTick({ now: NOW });
    assert.ok(!notified.includes(fx.bia.id));
    assert.equal((await prisma.followUp.findUnique({ where: { id: followUp.id } })).remindedAt, null);
  } finally { prisma.followUp.updateMany = originalUpdate; push.notifyUser = originalPush; }
});

test("atendente offline: lembrete é registrado sem conexão SSE e sem push configurado (não derruba o worker)", async () => {
  const carlos = await viewer(fx.carlos);
  const { followUp } = await followUps.createFollowUp(carlos, { conversationId: fx.convCarlos.id, dueAt: new Date(NOW.getTime() + 5 * 60000).toISOString(), reason: "OUTRO" }, { now: NOW });
  await followUps.runReminderTick({ now: NOW, lead: 15 });
  assert.ok((await prisma.followUp.findUnique({ where: { id: followUp.id } })).remindedAt);
});

test("cliente com retorno pendente volta a escrever: avisa o responsável uma vez por janela", async () => {
  const calls = [];
  const inboxEvents = require("../src/realtime/inbox-events");
  const original = inboxEvents.publishToUsers;
  inboxEvents.publishToUsers = (users, event, data) => calls.push([users, event, data]);
  try {
    const message = { conversationId: fx.convCarlos.id, direction: "RECEBIDA" };
    const first = await followUps.notifyCustomerReturned(message, { now: NOW });
    const second = await followUps.notifyCustomerReturned(message, { now: new Date(NOW.getTime() + 60000) });
    assert.ok(first >= 1);
    assert.equal(second, 0);
    assert.ok(calls.every(([users, , data]) => users.includes(fx.carlos.id) && data.kind === "CUSTOMER_RETURNED" && !("note" in data)));
  } finally {
    inboxEvents.publishToUsers = original;
  }
});

test("janela de 24h é do número do retorno: outra conta com janela aberta não libera envio comum", async () => {
  const accountA = await prisma.channelAccount.create({ data: { companyId: MIBRO, channel: "META", name: "FU Numero A", enabled: true, config: { phoneNumberId: "fu-a", wabaId: "waba-fu" } } });
  const accountB = await prisma.channelAccount.create({ data: { companyId: MIBRO, channel: "META", name: "FU Numero B", enabled: true, config: { phoneNumberId: "fu-b", wabaId: "waba-fu" } } });
  const conv = await conversation(MIBRO, fx.suporte.id, { channelAccountId: accountA.id });
  const now = new Date();
  await prisma.message.create({ data: { conversationId: conv.id, channelAccountId: accountA.id, direction: "RECEBIDA", status: "RECEBIDA", type: "text", text: "Oi", externalId: `wamid.fu-a-${Date.now()}`, occurredAt: new Date(now.getTime() - 30 * 3600000) } });
  await prisma.message.create({ data: { conversationId: conv.id, channelAccountId: accountB.id, direction: "RECEBIDA", status: "RECEBIDA", type: "text", text: "Oi pelo B", externalId: `${accountB.id}:wamid.fu-b-${Date.now()}`, occurredAt: new Date(now.getTime() - 3600000) } });
  const master = await viewer(fx.master);
  const { followUp } = await followUps.createFollowUp(master, { conversationId: conv.id, date: tomorrowLocal(), time: "10:00", reason: "RETORNO_COMERCIAL", assigneeId: fx.carlos.id });
  assert.equal(followUp.channelAccountId, accountA.id);
  const detail = await followUps.getFollowUp(master, followUp.id);
  assert.equal(detail.customerServiceWindow.open, false);
  assert.equal(detail.customerServiceWindow.requiresTemplate, true);
  assert.equal(detail.channelAccount.name, "FU Numero A");
});

test("criação automática (Flow Builder) é idempotente por chave de origem", async () => {
  const input = { conversationId: fx.convCarlos.id, date: "2026-03-07", time: "10:00", reason: "RETORNO_COMERCIAL", assigneeId: fx.carlos.id };
  const system = { sourceKey: "flow:exec-fu:node-1:3" };
  const [first, second] = await Promise.all([
    followUps.createFollowUp(null, input, { now: NOW, system }),
    followUps.createFollowUp(null, input, { now: NOW, system }),
  ]);
  assert.equal(first.followUp.id, second.followUp.id);
  assert.equal(await prisma.followUp.count({ where: { sourceKey: system.sourceKey } }), 1);
  assert.equal(first.followUp.source, "FLOW");
});

test("ficha do cliente: quem acessa o contato vê os retornos dele; outra empresa não", async () => {
  const list = await followUps.listForContact(await viewer(fx.carlos), fx.convCarlos.contactId, { now: NOW });
  assert.ok(list.items.length >= 2);
  assert.ok(list.overdue >= 1);
  await assert.rejects(followUps.listForContact(await viewer(fx.sincroOnly), fx.convCarlos.contactId, { now: NOW }), (error) => [403, 404].includes(error.statusCode));
});

test("HTTP: rotas exigem sessão; IDOR de retorno de outra empresa/pessoa devolve 404; página /agenda protegida", async () => {
  const server = createApp({ channel: {} }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (key) => {
    const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${key}${DOMAIN}`, password: PASSWORD }) });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  const call = (cookie, path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json" }, redirect: "manual" });
  try {
    assert.equal((await call(null, "/api/follow-ups")).status, 401);
    assert.equal((await call(null, "/agenda")).status, 302);
    const sincro = await login("sincro");
    assert.equal((await call(sincro, "/agenda")).status, 200);
    assert.equal((await call(sincro, `/api/follow-ups/${fx.carlosFollowUp.id}`)).status, 404);
    assert.equal((await call(sincro, `/api/follow-ups/${fx.carlosFollowUp.id}`, { method: "PATCH", body: JSON.stringify({ priority: "URGENTE" }) })).status, 404);
    assert.equal((await call(sincro, `/api/follow-ups/${fx.carlosFollowUp.id}/complete`, { method: "POST", body: "{}" })).status, 404);
    assert.equal((await call(sincro, "/api/follow-ups", { method: "POST", body: JSON.stringify({ conversationId: fx.convCarlos.id, date: tomorrowLocal(), time: "10:00", reason: "OUTRO" }) })).status, 404);
    const bia = await login("bia");
    // Bia acessa o contato do Carlos? Não (conversa assumida por ele).
    assert.equal((await call(bia, `/api/follow-ups/${fx.carlosFollowUp.id}`)).status, 404);
    const carlos = await login("carlos");
    const created = await call(carlos, "/api/follow-ups", { method: "POST", body: JSON.stringify({ conversationId: fx.convCarlos.id, date: tomorrowLocal(), time: "10:00", reason: "COTACAO", note: "via HTTP" }) });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.company.slug, "mibro");
    assert.equal(body.state, "PENDENTE");
    const listed = await (await call(carlos, "/api/follow-ups?view=PENDING")).json();
    assert.ok(listed.items.some(({ id }) => id === body.id));
    const summary = await (await call(carlos, "/api/follow-ups/summary")).json();
    assert.equal(typeof summary.overdue, "number");
    assert.equal((await call(carlos, `/api/contacts/${fx.convSincro.contactId}/follow-ups`)).status >= 403, true);
  } finally {
    server.close();
  }
});
