// Perfil 360° do cliente: múltiplas conversas, contato fundido, atendente
// fixo, agenda, notas, Financeiro protegido, permissão de histórico,
// Supervisor (janelas da equipe), Master, isolamento Mibro x Sincrofit e
// paginação da linha do tempo — sem carregar mensagens.
require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const prisma = require("../src/database/prisma");
const { createApp } = require("../src/app");
const auth = require("../src/services/auth-service");
const companyService = require("../src/services/company-service");
const profiles = require("../src/services/contact-profile-service");
const { MIBRO, SINCROFIT } = require("./support/company");

const DOMAIN = "@perfil360.test";
const PASSWORD = "senha-perfil-360";
const PREFIX = "p360-";
const fx = {};
const at = (time) => new Date(`2026-03-02T${time}Z`);

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const contacts = await prisma.contact.findMany({ where: { externalId: { startsWith: PREFIX } }, select: { id: true, identityId: true } });
  const ids = contacts.map(({ id }) => id);
  await prisma.followUp.deleteMany({ where: { contactId: { in: ids } } });
  const conversations = (await prisma.conversation.findMany({ where: { contactId: { in: ids } }, select: { id: true } })).map(({ id }) => id);
  await prisma.conversationAssignmentPeriod.deleteMany({ where: { conversationId: { in: conversations } } });
  await prisma.conversationActivity.deleteMany({ where: { conversationId: { in: conversations } } });
  await prisma.message.deleteMany({ where: { conversationId: { in: conversations } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversations } } });
  await prisma.contactNote.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { id: { in: ids } } });
  await prisma.contactIdentity.deleteMany({ where: { displayName: { startsWith: PREFIX } } });
  await prisma.channelAccount.deleteMany({ where: { name: { startsWith: "P360 " } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: users.map(({ id }) => id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
  await prisma.category.deleteMany({ where: { code: { startsWith: "P360_" } } });
}

const viewer = async (user) => auth.publicUser(await prisma.user.findUnique({ where: { id: user.id } }));
const activity = (conversationId, action, time, actor = null, details = {}, extra = {}) => prisma.conversationActivity.create({ data: { conversationId, action, actorUserId: actor?.id || null, details, createdAt: at(time), ...extra } });

test.before(async () => {
  await cleanup();
  fx.comercial = await prisma.category.create({ data: { companyId: MIBRO, code: "P360_COMERCIAL", name: "P360 Comercial" } });
  fx.financeiro = await prisma.category.create({ data: { companyId: MIBRO, code: "P360_FIN", name: "P360 Financeiro", visibilityMode: "SECTOR_PRIVATE" } });
  fx.sincro = await prisma.category.create({ data: { companyId: SINCROFIT, code: "P360_SINCRO", name: "P360 Sincro" } });
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const makeUser = (key, role, access, categories, extra = {}) => prisma.user.create({ data: {
    name: `P360 ${key}`, email: `${key}${DOMAIN}`, passwordHash, role, ...extra,
    companyAccess: { create: access.map(([companyId, companyRole = null]) => ({ companyId, role: companyRole })) },
    categoryAccess: { create: categories.map((categoryId) => ({ categoryId })) },
  } });
  fx.carlos = await makeUser("carlos", "ATENDENTE", [[MIBRO]], [fx.comercial.id], { canViewConversationHistory: true });
  fx.semHistorico = await makeUser("semhist", "ATENDENTE", [[MIBRO]], [fx.comercial.id]);
  fx.ana = await makeUser("ana", "ATENDENTE", [[MIBRO]], [fx.comercial.id, fx.financeiro.id], { canViewConversationHistory: true });
  fx.sup = await makeUser("sup", "ATENDENTE", [[MIBRO, "SUPERVISOR"]], [], { canViewConversationHistory: true });
  await prisma.supervisorTeamMember.create({ data: { supervisorId: fx.sup.id, memberId: fx.carlos.id } });
  fx.sincroOnly = await makeUser("sincro", "ATENDENTE", [[SINCROFIT]], [fx.sincro.id], { canViewConversationHistory: true });
  fx.master = await prisma.user.create({ data: { name: "P360 Master", email: `master${DOMAIN}`, passwordHash, role: "ADMIN" } });
  companyService.invalidateCompanyCache();

  // Mesmo cliente com dois cadastros (dois números da empresa) fundidos, e o
  // mesmo telefone também na Sincrofit (outro cliente, outra empresa).
  const identity = await prisma.contactIdentity.create({ data: { displayName: `${PREFIX}loja` } });
  fx.contact = await prisma.contact.create({ data: { companyId: MIBRO, externalId: `${PREFIX}a`, phone: "5511955550001", name: "Loja Centro P360", identityId: identity.id, preferredAssigneeId: fx.carlos.id, preferredAssigneeEnabled: true } });
  fx.merged = await prisma.contact.create({ data: { companyId: MIBRO, externalId: `${PREFIX}b`, phone: "5511955550002", name: "Loja Centro (2º número)", identityId: identity.id } });
  fx.sincroContact = await prisma.contact.create({ data: { companyId: SINCROFIT, externalId: `${PREFIX}c`, phone: "5511955550001", name: "Mesmo telefone na Sincrofit" } });

  fx.conv = await prisma.conversation.create({ data: { companyId: MIBRO, contactId: fx.contact.id, categoryId: fx.comercial.id, status: "EM_ATENDIMENTO", assignedUserId: fx.carlos.id, createdAt: at("09:00:00"), lastMessageAt: at("10:15:00") } });
  fx.conv2 = await prisma.conversation.create({ data: { companyId: MIBRO, contactId: fx.merged.id, channelScope: "B", categoryId: fx.comercial.id, status: "FINALIZADO", assignedUserId: fx.carlos.id, createdAt: at("06:00:00"), lastMessageAt: at("07:00:00"), originSource: "OUTBOUND_CAMPAIGN" } });
  fx.sincroConv = await prisma.conversation.create({ data: { companyId: SINCROFIT, contactId: fx.sincroContact.id, categoryId: fx.sincro.id, status: "EM_ATENDIMENTO", assignedUserId: fx.sincroOnly.id, createdAt: at("08:00:00") } });
  await prisma.conversationAssignmentPeriod.create({ data: { conversationId: fx.conv.id, userId: fx.carlos.id, startedAt: at("09:05:00"), startReason: "CLAIMED" } });
  await prisma.message.create({ data: { conversationId: fx.conv.id, direction: "RECEBIDA", status: "RECEBIDA", type: "text", text: "TEXTO-SIGILOSO-DA-MENSAGEM", occurredAt: at("09:00:00") } });

  await activity(fx.conv.id, "BOT_FLOW_STARTED", "09:01:00");
  await activity(fx.conv.id, "CONVERSATION_CLAIMED", "09:05:00", fx.carlos, { to: "P360 carlos", toUserId: fx.carlos.id });
  await activity(fx.conv.id, "CATEGORY_CHANGED", "09:30:00", fx.carlos, { from: "P360 Comercial", to: "P360 Financeiro", reason: "MOTIVO-SIGILOSO" }, { privateCategoryId: fx.financeiro.id });
  await activity(fx.conv.id, "FOLLOW_UP_CREATED", "09:40:00", fx.ana, { followUpId: "x", dueAt: at("12:00:00"), reason: "NEGOCIACAO" }, { privateCategoryId: fx.financeiro.id });
  await activity(fx.conv.id, "CONVERSATION_TRANSFERRED", "10:00:00", fx.ana, { from: "P360 ana", to: "P360 carlos", reason: "MOTIVO-TRANSFER" });
  await activity(fx.conv2.id, "STATUS_CHANGED", "06:50:00", fx.carlos, { from: "EM_ATENDIMENTO", to: "FINALIZADO" });
  await activity(fx.conv.id, "MESSAGE_DELIVERY_TECHNICAL", "10:01:00");

  await prisma.contactNote.create({ data: { contactId: fx.contact.id, authorId: fx.carlos.id, content: "Prefere contato à tarde", pinned: true } });
  await prisma.contactNote.create({ data: { contactId: fx.contact.id, authorId: fx.ana.id, content: "NOTA-FINANCEIRA-PRIVADA", privateCategoryId: fx.financeiro.id } });
  await prisma.followUp.create({ data: { companyId: MIBRO, contactId: fx.contact.id, conversationId: fx.conv.id, assigneeId: fx.carlos.id, createdById: fx.carlos.id, dueAt: new Date(Date.now() + 86400000), reason: "COTACAO", note: "Enviar cotação" } });
});

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("perfil: conversas do contato e do contato fundido, atendente fixo, agenda, origem — sem mensagens nem dados de outra empresa", async () => {
  const profile = await profiles.getProfile(await viewer(fx.carlos), fx.contact.id);
  assert.equal(profile.company.slug, "mibro");
  assert.deepEqual(profile.conversations.map(({ id }) => id).sort(), [fx.conv.id, fx.conv2.id].sort());
  assert.equal(profile.contact.mergedContacts, 2);
  assert.equal(profile.preferredAssignee.id, fx.carlos.id);
  assert.equal(profile.current.conversationId, fx.conv.id);
  assert.equal(profile.agenda.pending, 1);
  assert.equal(profile.stats.finalizedCycles, 1);
  assert.equal(profile.stats.transfers, 1);
  assert.equal(profile.stats.firstContactAt.toISOString(), at("06:00:00").toISOString());
  assert.match(profile.commercial.origin, /campanha/);
  assert.equal(profile.commercial.orders, null, "sem integração de pedidos: nunca inventado");
  const json = JSON.stringify(profile);
  assert.ok(!json.includes("TEXTO-SIGILOSO-DA-MENSAGEM"), "perfil não carrega mensagens");
  assert.ok(!json.includes(fx.sincroConv.id), "Sincrofit com o mesmo telefone nunca entra");
});

test("Financeiro: nota e eventos privados não aparecem para quem não é do setor; membro do setor e Master veem", async () => {
  const carlosProfile = await profiles.getProfile(await viewer(fx.carlos), fx.contact.id);
  assert.ok(!JSON.stringify(carlosProfile).includes("NOTA-FINANCEIRA-PRIVADA"));
  const carlosTimeline = await profiles.getTimeline(await viewer(fx.carlos), fx.contact.id, { limit: 50 });
  const json = JSON.stringify(carlosTimeline);
  assert.ok(!json.includes("MOTIVO-SIGILOSO"));
  assert.ok(!carlosTimeline.items.some((item) => item.action === "FOLLOW_UP_CREATED"), "evento não estrutural de setor privado some");
  const structural = carlosTimeline.items.find((item) => item.action === "CATEGORY_CHANGED");
  assert.equal(structural.restricted, true, "entrada no setor fica como marcador estrutural");
  assert.ok(!carlosTimeline.items.some((item) => item.action === "MESSAGE_DELIVERY_TECHNICAL"), "eventos técnicos não entram");

  // Ana (membro do Financeiro) sem conversa deste contato: nem abre o perfil.
  await assert.rejects(profiles.getTimeline(await viewer(fx.ana), fx.contact.id, { limit: 50 }), (error) => error.statusCode === 403);
  const masterProfile = await profiles.getProfile(await viewer(fx.master), fx.contact.id);
  assert.ok(masterProfile.notes.some((note) => note.content === "NOTA-FINANCEIRA-PRIVADA"));
  const masterTimeline = await profiles.getTimeline(await viewer(fx.master), fx.contact.id, { limit: 50 });
  assert.ok(masterTimeline.items.some((item) => item.action === "FOLLOW_UP_CREATED" && /negociação/.test(item.label)));
});

test("sem permissão de histórico: perfil permitido, estatísticas nulas e linha do tempo bloqueada", async () => {
  // Coloca a conversa na fila do setor para o atendente sem histórico acessar o contato.
  await prisma.conversation.update({ where: { id: fx.conv2.id }, data: { assignedUserId: null } });
  try {
    const user = await viewer(fx.semHistorico);
    const profile = await profiles.getProfile(user, fx.merged.id);
    assert.deepEqual(profile.conversations.map(({ id }) => id), [fx.conv2.id], "só a conversa que ele acessa");
    assert.equal(profile.canViewHistory, false);
    assert.equal(profile.stats.finalizedCycles, null);
    await assert.rejects(profiles.getTimeline(user, fx.merged.id, {}), (error) => error.statusCode === 403);
    await assert.rejects(profiles.getTimeline(user, fx.merged.id, { before: at("12:00:00").toISOString() }), (error) => error.statusCode === 403);
  } finally {
    await prisma.conversation.update({ where: { id: fx.conv2.id }, data: { assignedUserId: fx.carlos.id } });
  }
});

test("linha do tempo paginada: páginas sem repetição, em ordem decrescente", async () => {
  const user = await viewer(fx.master);
  const first = await profiles.getTimeline(user, fx.contact.id, { limit: 2 });
  assert.ok(first.nextCursor);
  const second = await profiles.getTimeline(user, fx.contact.id, { limit: 2, before: first.nextCursor });
  const ids = [...first.items, ...second.items].map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  const times = [...first.items, ...second.items].map(({ at: time }) => new Date(time).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
  let cursor = first.nextCursor;
  let all = [...first.items];
  while (cursor) {
    const page = await profiles.getTimeline(user, fx.contact.id, { limit: 2, before: cursor });
    all = all.concat(page.items);
    cursor = page.nextCursor;
  }
  assert.equal(all.filter((item) => item.action === "CONVERSATION_STARTED").length, 2, "cada início aparece uma vez");
});

test("paginação preserva todos os eventos com o mesmo milissegundo", async () => {
  const same = at("11:00:00");
  const added = [];
  for (let i = 0; i < 4; i++) added.push(await prisma.conversationActivity.create({ data: { conversationId: fx.conv.id, action: "PRIORITY_CHANGED", details: { to: "ALTA" }, createdAt: same } }));
  try {
    const ids = [];
    let cursor;
    do {
      const page = await profiles.getTimeline(await viewer(fx.master), fx.contact.id, { limit: 1, ...(cursor ? { before: cursor } : {}) });
      ids.push(...page.items.map(({ id }) => id));
      cursor = page.nextCursor;
    } while (cursor);
    for (const row of added) assert.equal(ids.filter((id) => id === row.id).length, 1);
    assert.equal(new Set(ids).size, ids.length);
  } finally { await prisma.conversationActivity.deleteMany({ where: { id: { in: added.map(({ id }) => id) } } }); }
});

test("Supervisor vê o perfil pela equipe; usuário de outra empresa não acessa", async () => {
  const sup = await viewer(fx.sup);
  const profile = await profiles.getProfile(sup, fx.contact.id);
  assert.ok(profile.conversations.some(({ id }) => id === fx.conv.id));
  assert.ok(profile.notes.every((note) => note.content !== "NOTA-FINANCEIRA-PRIVADA"));
  await assert.rejects(profiles.getTimeline({ ...sup, canViewConversationHistory: false }, fx.contact.id, {}), (error) => error.statusCode === 403, "Supervisor também precisa da permissão de histórico");
  await assert.rejects(profiles.getProfile(await viewer(fx.sincroOnly), fx.contact.id), (error) => [403, 404].includes(error.statusCode));
  await assert.rejects(profiles.getTimeline(await viewer(fx.sincroOnly), fx.contact.id, {}), (error) => [403, 404].includes(error.statusCode));
});

test("notas do perfil verificam acesso operacional em uma consulta com o mesmo escopo", async () => {
  const authorization = require('../src/services/authorization-service');
  const user = await viewer(fx.carlos);
  const scope = await authorization.operationalScope(user);
  const original = prisma.conversation.findFirst;
  const queries = [];
  prisma.conversation.findFirst = function(args) {
    if (args.where?.AND?.some(part => Array.isArray(part.id?.in))) queries.push(args);
    return original.call(this, args);
  };
  try {
    const profile = await profiles.getProfile(user, fx.contact.id);
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].where.AND[0].id.in.sort(), profile.conversations.map(({id})=>id).sort());
    assert.deepEqual(queries[0].where.AND[1], scope);
    assert.deepEqual(queries[0].select, {id:true});
    assert.ok(profile.notes.some(note => note.content === 'Prefere contato à tarde'));
    assert.ok(!profile.notes.some(note => note.content === 'NOTA-FINANCEIRA-PRIVADA'));
  } finally { prisma.conversation.findFirst = original; }
});

test("HTTP: perfil e linha do tempo exigem sessão e respeitam a empresa", async () => {
  const server = createApp({ channel: {} }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (key) => (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${key}${DOMAIN}`, password: PASSWORD }) })).headers.get("set-cookie").split(";")[0];
  try {
    assert.equal((await fetch(`${base}/api/contacts/${fx.contact.id}/profile`)).status, 401);
    const carlos = await login("carlos");
    const response = await fetch(`${base}/api/contacts/${fx.contact.id}/profile`, { headers: { Cookie: carlos } });
    assert.equal(response.status, 200);
    await prisma.conversation.update({ where: { id: fx.conv2.id }, data: { assignedUserId: null } });
    try {
      const semHistorico = await login("semhist");
      assert.equal((await fetch(`${base}/api/contacts/${fx.merged.id}/profile`, { headers: { Cookie: semHistorico } })).status, 200);
      const blocked = await fetch(`${base}/api/contacts/${fx.merged.id}/timeline`, { headers: { Cookie: semHistorico } });
      assert.equal(blocked.status, 403);
      const deniedBody = await blocked.json();
      assert.equal(deniedBody.items, undefined, "API não devolve eventos sem permissão");
    } finally {
      await prisma.conversation.update({ where: { id: fx.conv2.id }, data: { assignedUserId: fx.carlos.id } });
    }
    const sincro = await login("sincro");
    assert.ok([403, 404].includes((await fetch(`${base}/api/contacts/${fx.contact.id}/timeline`, { headers: { Cookie: sincro } })).status));
  } finally {
    server.close();
  }
});
