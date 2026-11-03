require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/database/prisma");
const adapters = require("../src/services/channels/channel-message-service");
const companyService = require("../src/services/company-service");
const { publicUser } = require("../src/services/auth-service");
const routingService = require("../src/services/template-routing-service");
const { sendApprovedTemplate, listTemplates } = require("../src/services/meta-template-service");
const { updateStatus } = require("../src/services/message-service");
const { findOrCreateCampaignConversation } = require("../src/services/campaign-worker-service");
const { createOutboundConversation } = require("../src/services/outbound-conversation-service");
const privateSegments = require("../src/services/private-segment-service");
const { MIBRO, SINCROFIT } = require("./support/company");

// Destino fixo por template (categoria/subcategoria internas). Meta 100%
// simulada: nenhuma chamada de rede, nenhum envio real.

const DOMAIN = "@template-routing.test";
const PASSWORD = "senha-template-routing-123";
const PREFIX = "TR_";
const WABA = { mibro: "WABA_TR_MIBRO", mibro2: "WABA_TR_MIBRO2", sincro: "WABA_TR_SINCRO" };
const body = [{ type: "BODY", text: "Olá" }];
const tpl = (id, name, extra = {}) => ({ id, name, language: "pt_BR", status: "APPROVED", category: "MARKETING", components: body, ...extra });
let metaTemplates;
const resetMeta = () => {
  metaTemplates = {
    [WABA.mibro]: [tpl("m-1", "marketing_proposta_parceria"), tpl("m-2", "marketing_retorno"), tpl("m-3", "comercial_atacado"),
      tpl("m-4", "suporte_retorno", { category: "UTILITY" }), tpl("m-5", "financeiro_aviso", { category: "UTILITY" }), tpl("m-6", "pausado_tpl", { status: "PAUSED" })],
    [WABA.mibro2]: [tpl("w2-1", "marketing_proposta_parceria")],
    [WABA.sincro]: [tpl("s-1", "marketing_retorno")],
  };
};
const sendLog = [];
let templateListCalls = 0;
const meta = { fail: false };

class FakeMeta {
  constructor(wabaId = null) { this.wabaId = wabaId; }
  forAccount(account) { return new FakeMeta(account?.config?.wabaId || null); }
  async listAllMessageTemplates() { templateListCalls++; return structuredClone(metaTemplates[this.wabaId] || []); }
  async listMessageTemplates() { return (await this.listAllMessageTemplates()).filter((item) => item.status === "APPROVED"); }
  async inspectAccessTokenScopes() { return { scopes: null, valid: null, error: null }; }
  async sendTemplate(to, payload) {
    if (meta.fail) throw Object.assign(new Error("Meta rejeitou o envio (simulado)"), { statusCode: 502 });
    sendLog.push({ to, wabaId: this.wabaId, ...payload });
    return { externalId: `wamid.tr-${crypto.randomUUID()}`, data: { simulated: true } };
  }
  async sendText() { throw new Error("sem texto livre neste teste"); }
  async markAsRead() {}
}

const fx = {};
const env = {};
let originalAdapterFor;
let seq = 0;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const userIds = users.map(({ id }) => id);
  const categories = await prisma.category.findMany({ where: { code: { startsWith: PREFIX } }, select: { id: true } });
  await prisma.templateRoutingConfiguration.deleteMany({ where: { wabaId: { in: Object.values(WABA) } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { entityType: "TEMPLATE_ROUTING", details: { path: ["wabaId"], string_starts_with: "WABA_TR_" } }, { summary: { contains: "[tr-test]" } }] } });
  const contacts = await prisma.contact.findMany({ where: { externalId: { startsWith: "55119777" } }, select: { id: true } });
  const conversations = await prisma.conversation.findMany({ where: { contactId: { in: contacts.map(({ id }) => id) } }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { entityType: "CONVERSATION", entityId: { in: conversations.map(({ id }) => id) } } });
  await prisma.contact.deleteMany({ where: { id: { in: contacts.map(({ id }) => id) } } });
  await prisma.channelAccount.deleteMany({ where: { name: { startsWith: "TR " } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.category.deleteMany({ where: { id: { in: categories.map(({ id }) => id) }, parentId: { not: null } } });
  await prisma.category.deleteMany({ where: { id: { in: categories.map(({ id }) => id) } } });
}

test.before(async () => {
  for (const key of ["PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_TOKEN", "GRAPH_VERSION"]) env[key] = process.env[key];
  process.env.WHATSAPP_TOKEN = "token-teste-sem-rede";
  process.env.GRAPH_VERSION = "v0.0";
  resetMeta();
  await cleanup();
  const cat = (key, companyId, name, extra = {}) => prisma.category.create({ data: { companyId, code: `${PREFIX}${key}`, name, ...extra } });
  fx.mkt = await cat("MKT", MIBRO, "TR Marketing");
  fx.parc = await cat("PARC", MIBRO, "TR Parcerias", { parentId: fx.mkt.id });
  fx.div = await cat("DIV", MIBRO, "TR Divulgação", { parentId: fx.mkt.id });
  fx.rel = await cat("REL", MIBRO, "TR Relacionamento", { parentId: fx.mkt.id });
  fx.oldSub = await cat("OLD", MIBRO, "TR Parcerias antiga", { parentId: fx.mkt.id, active: false });
  fx.sup = await cat("SUP", MIBRO, "TR Suporte");
  fx.bat = await cat("BAT", MIBRO, "TR Bateria", { parentId: fx.sup.id });
  fx.com = await cat("COM", MIBRO, "TR Comercial");
  fx.atacado = await cat("ATA", MIBRO, "TR Atacado", { parentId: fx.com.id });
  fx.fin = await cat("FIN", MIBRO, "TR Financeiro", { visibilityMode: "SECTOR_PRIVATE" });
  fx.off = await cat("OFF", MIBRO, "TR Inativa", { active: false });
  fx.mktB = await cat("MKTB", MIBRO, "TR Marketing B");
  fx.sfCom = await cat("SFCOM", SINCROFIT, "TR SF Comercial");
  fx.sfPos = await cat("SFPOS", SINCROFIT, "TR SF Pós-venda", { parentId: fx.sfCom.id });

  const account = (name, companyId, config) => prisma.channelAccount.create({ data: { companyId, channel: "META", name, enabled: true, status: "CONNECTED", config } });
  fx.main = await account("TR Mibro Atendimento", MIBRO, { wabaId: WABA.mibro, phoneNumberId: "PN_TR_MAIN", outboundCategoryIds: [fx.mkt.id, fx.sup.id, fx.fin.id] });
  fx.commercial = await account("TR Mibro Comercial", MIBRO, { wabaId: WABA.mibro, phoneNumberId: "PN_TR_COM", outboundTemplateCategoryId: fx.atacado.id, outboundCategoryIds: [fx.atacado.id] });
  fx.waba2 = await account("TR Mibro WABA 2", MIBRO, { wabaId: WABA.mibro2, phoneNumberId: "PN_TR_W2", outboundCategoryIds: [fx.mktB.id] });
  fx.sincro = await account("TR Sincrofit", SINCROFIT, { wabaId: WABA.sincro, phoneNumberId: "PN_TR_SF", outboundCategoryIds: [fx.sfCom.id] });

  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const user = (key, role, { permissions = null, categories = [], companies = [MIBRO] } = {}) => prisma.user.create({ data: {
    name: `TR ${key}`, email: `${key}${DOMAIN}`, passwordHash, role,
    companyAccess: { create: companies.map((companyId) => ({ companyId, permissions })) },
    categoryAccess: { create: categories.map((categoryId) => ({ categoryId })) },
  } });
  fx.master = await prisma.user.create({ data: { name: "TR Master", email: `master${DOMAIN}`, passwordHash, role: "ADMIN" } });
  fx.supOk = await user("supok", "SUPERVISOR", { permissions: { canManageCampaigns: true, canManageCategories: true }, categories: [fx.mkt.id] });
  fx.supNo = await user("supno", "SUPERVISOR", { permissions: { canManageCampaigns: true }, categories: [fx.mkt.id] });
  fx.agent = await user("agent", "ATENDENTE", { permissions: { canManageCampaigns: true, canStartWhatsAppConversations: true }, categories: [fx.sup.id] });
  fx.finAgent = await user("finagent", "ATENDENTE", { categories: [fx.fin.id] });
  await prisma.channelAccountUserAccess.createMany({ data: [fx.supOk, fx.supNo, fx.agent, fx.finAgent].flatMap((u) => [fx.main, fx.commercial, fx.waba2].map((a) => ({ userId: u.id, channelAccountId: a.id }))) });
  companyService.invalidateCompanyCache();

  originalAdapterFor = adapters.adapterFor;
  adapters.adapterFor = async (_channel, accountId) => {
    const row = await prisma.channelAccount.findUniqueOrThrow({ where: { id: accountId } });
    return { channel: new FakeMeta(row.config.wabaId) };
  };
});

test.after(async () => {
  adapters.adapterFor = originalAdapterFor;
  await cleanup();
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await prisma.$disconnect();
});

const as = async (row) => publicUser(await prisma.user.findUniqueOrThrow({ where: { id: row.id } }));
const save = async (row, data, account = fx.main) => routingService.saveRoute(await as(row), { channelAccountId: account.id, templateLanguage: "pt_BR", enabled: true, ...data }, new FakeMeta());
const configOf = (name, waba = WABA.mibro, companyId = MIBRO) => prisma.templateRoutingConfiguration.findUnique({
  where: { companyId_wabaId_templateName_templateLanguage: { companyId, wabaId: waba, templateName: name, templateLanguage: "pt_BR" } },
});

async function conversation({ account = fx.main, companyId = MIBRO, status = "NOVO", categoryId = null, history = false, preferredAssigneeId = null, assignedUserId = null } = {}) {
  const phone = `55119777${String(++seq).padStart(5, "0")}`;
  const contact = await prisma.contact.create({ data: {
    companyId, channel: "META", externalId: phone, phone, name: `Cliente ${seq}`,
    ...(preferredAssigneeId ? { preferredAssigneeId, preferredAssigneeEnabled: true, preferredAssigneeSetById: fx.master.id, preferredAssigneeSetAt: new Date() } : {}),
  } });
  const row = await prisma.conversation.create({ data: { companyId, contactId: contact.id, channel: "META", channelScope: account.id, channelAccountId: account.id, status, categoryId, assignedUserId } });
  if (history) await prisma.message.create({ data: { conversationId: row.id, channel: "META", channelAccountId: account.id, direction: "RECEBIDA", status: "RECEBIDA", type: "text", text: "histórico anterior", externalId: `${account.id}:wamid.tr-old-${seq}`, occurredAt: new Date(Date.now() - 3600_000) } });
  return row;
}
const send = (row, name, { account = fx.main, user = null } = {}) => sendApprovedTemplate({ conversationId: row.id, name, language: "pt_BR", values: {}, sentByUserId: user?.id || null, requestedAccountId: account.id });
const reload = (row) => prisma.conversation.findUnique({ where: { id: row.id } });
const autoActivities = (row) => prisma.conversationActivity.findMany({ where: { conversationId: row.id, action: "CATEGORY_CHANGED" } });

test("1-5: vincula categoria, subcategoria, salva, recupera após reload e altera com auditoria", async () => {
  const onlyCategory = await save(fx.master, { templateName: "suporte_retorno", categoryId: fx.sup.id });
  assert.equal(onlyCategory.categoryId, fx.sup.id);
  assert.equal(onlyCategory.subcategoryId, null);
  assert.equal(onlyCategory.state, "ACTIVE");

  const saved = await save(fx.master, { templateName: "marketing_proposta_parceria", categoryId: fx.mkt.id, subcategoryId: fx.parc.id });
  assert.equal(saved.subcategoryName, "TR Parcerias");
  const stored = await configOf("marketing_proposta_parceria");
  assert.equal(stored.metaTemplateId, "m-1");
  assert.equal(stored.metaCategory, "MARKETING");
  assert.equal(stored.updatedByUserId, fx.master.id);

  // "Reload": nova leitura da listagem sincronizada já traz o destino.
  const listed = await listTemplates(new FakeMeta(), fx.main);
  const view = await routingService.attachRouting(listed.templates, fx.main, await as(fx.master));
  const item = view.templates.find((row) => row.name === "marketing_proposta_parceria");
  assert.equal(item.category, "MARKETING", "categoria Meta preservada");
  assert.equal(item.routing.categoryName, "TR Marketing");
  assert.equal(item.routing.subcategoryName, "TR Parcerias");
  assert.equal(view.canEdit, true);

  const changed = await save(fx.master, { templateName: "marketing_proposta_parceria", categoryId: fx.mkt.id, subcategoryId: fx.div.id });
  assert.equal(changed.subcategoryId, fx.div.id);
  const auditRow = await prisma.auditLog.findFirst({ where: { entityType: "TEMPLATE_ROUTING", entityId: stored.id, action: "TEMPLATE_ROUTING_UPDATED" }, orderBy: { createdAt: "desc" } });
  assert.equal(auditRow.actorUserId, fx.master.id);
  assert.equal(auditRow.companyId, MIBRO);
  assert.equal(auditRow.details.wabaId, WABA.mibro);
  assert.equal(auditRow.details.previous.subcategoryId, fx.parc.id);
  assert.equal(auditRow.details.next.subcategoryId, fx.div.id);
  await save(fx.master, { templateName: "marketing_proposta_parceria", categoryId: fx.mkt.id, subcategoryId: fx.parc.id });
  const history = await routingService.routeHistory(await as(fx.master), { channelAccountId: fx.main.id, templateName: "marketing_proposta_parceria", templateLanguage: "pt_BR" });
  assert.ok(history.length >= 3 && history.every((row) => row.details.templateName === "marketing_proposta_parceria"));
});

test("6: desativar roteamento preserva a regra e deixa de aplicar", async () => {
  await save(fx.master, { templateName: "marketing_retorno", categoryId: fx.mkt.id, subcategoryId: fx.rel.id });
  const disabled = await save(fx.master, { templateName: "marketing_retorno", categoryId: fx.mkt.id, subcategoryId: fx.rel.id, enabled: false });
  assert.equal(disabled.state, "DISABLED");
  assert.ok(await prisma.auditLog.findFirst({ where: { entityType: "TEMPLATE_ROUTING", action: "TEMPLATE_ROUTING_DISABLED", details: { path: ["templateName"], equals: "marketing_retorno" } } }));
  const row = await conversation();
  await send(row, "marketing_retorno");
  assert.equal((await reload(row)).categoryId, null, "sem regra ativa nem do número: segue a triagem");
  await save(fx.master, { templateName: "marketing_retorno", categoryId: fx.mkt.id, subcategoryId: fx.rel.id, enabled: true });
  assert.ok(await prisma.auditLog.findFirst({ where: { entityType: "TEMPLATE_ROUTING", action: "TEMPLATE_ROUTING_ENABLED", details: { path: ["templateName"], equals: "marketing_retorno" } } }));
});

test("7-10: categoria inexistente/inativa, subcategoria inválida, outra empresa e outra WABA", async () => {
  await assert.rejects(save(fx.master, { templateName: "marketing_retorno", categoryId: "nao-existe" }), (error) => error.statusCode === 404);
  await assert.rejects(save(fx.master, { templateName: "marketing_retorno", categoryId: fx.off.id }), /desativada/);
  await assert.rejects(save(fx.master, { templateName: "marketing_retorno", categoryId: fx.mkt.id, subcategoryId: fx.bat.id }), /não pertence/);
  await assert.rejects(save(fx.master, { templateName: "marketing_retorno", categoryId: fx.mkt.id, subcategoryId: fx.oldSub.id }), /desativada/);
  await assert.rejects(save(fx.master, { templateName: "marketing_retorno", categoryId: fx.parc.id }), /categoria principal/);
  await assert.rejects(save(fx.master, { templateName: "nao_existe_na_meta", categoryId: fx.mkt.id }), (error) => error.statusCode === 404);
  await assert.rejects(save(fx.master, { templateName: "pausado_tpl", categoryId: fx.mkt.id }), /aprovados/);
  // Setor sem número desta WABA: a regra nunca teria remetente válido.
  await assert.rejects(save(fx.master, { templateName: "marketing_retorno", categoryId: fx.com.id }), /Nenhum número desta WABA/);
  // Template de outra empresa: categoria Mibro no número Sincrofit.
  await assert.rejects(save(fx.master, { templateName: "marketing_retorno", categoryId: fx.mkt.id }, fx.sincro), (error) => error.statusCode === 404);
  // Supervisor só da Mibro não enxerga o número da Sincrofit.
  await assert.rejects(save(fx.supOk, { templateName: "marketing_retorno", categoryId: fx.sfCom.id }, fx.sincro), (error) => error.statusCode === 404);

  // Mesmo nome em outra WABA da Mibro: sem regra própria, não herda a da WABA principal.
  const other = await conversation({ account: fx.waba2 });
  await send(other, "marketing_proposta_parceria", { account: fx.waba2 });
  assert.equal((await reload(other)).categoryId, null);
  assert.equal(sendLog.at(-1).wabaId, WABA.mibro2);
});

test("11, 17: conversa nova por envio individual nasce com categoria/subcategoria e registra histórico", async () => {
  const row = await conversation();
  const result = await send(row, "marketing_proposta_parceria", { user: fx.master });
  const after = await reload(row);
  assert.equal(after.categoryId, fx.parc.id);
  assert.equal(after.status, "AGUARDANDO_CLIENTE");
  assert.equal(result.message.rawPayload.initialRouting.source, "TEMPLATE");
  const [activity] = await autoActivities(row);
  assert.equal(activity.details.source, "OUTBOUND_TEMPLATE_ROUTING");
  assert.equal(activity.details.to, "TR Marketing: TR Parcerias");
  assert.equal(activity.details.template.name, "marketing_proposta_parceria");
  assert.equal(activity.details.wabaId, WABA.mibro);
  assert.ok(await prisma.auditLog.findFirst({ where: { entityType: "CONVERSATION", entityId: row.id, action: "CONVERSATION_CATEGORY_CHANGED" } }));

  // "Nova conversa" pelo painel (cria a conversa e envia o template).
  const created = await createOutboundConversation({
    phone: "5511977799901", customName: "Cliente painel", template: { name: "marketing_proposta_parceria", language: "pt_BR", values: {} },
    user: await as(fx.master), channel: new FakeMeta(), channelAccountId: fx.main.id,
  });
  assert.equal(created.created, true);
  assert.equal((await prisma.conversation.findUnique({ where: { id: created.conversationId } })).categoryId, fx.parc.id);
});

test("12-13: novo ciclo após finalização aplica destino; atendimento ativo mantém categoria", async () => {
  const finalized = await conversation({ status: "FINALIZADO", categoryId: fx.bat.id, history: true });
  await send(finalized, "marketing_proposta_parceria");
  assert.equal((await reload(finalized)).categoryId, fx.parc.id);
  const messages = await prisma.message.findMany({ where: { conversationId: finalized.id }, orderBy: { occurredAt: "asc" } });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].text, "histórico anterior", "histórico preservado");
  assert.equal((await autoActivities(finalized))[0].details.newCycle, true);

  const active = await conversation({ status: "EM_ATENDIMENTO", categoryId: fx.bat.id, history: true, assignedUserId: fx.agent.id });
  await send(active, "marketing_proposta_parceria");
  assert.equal((await reload(active)).categoryId, fx.bat.id, "Suporte → Bateria continua");
  assert.equal((await autoActivities(active)).length, 0);
});

test("14-16: envio rejeitado não classifica; envio duplicado e webhook reprocessado não reclassificam", async () => {
  const row = await conversation();
  meta.fail = true;
  try { await assert.rejects(send(row, "marketing_proposta_parceria"), /rejeitou/); } finally { meta.fail = false; }
  const unchanged = await reload(row);
  assert.equal(unchanged.categoryId, null);
  assert.equal(unchanged.status, "NOVO");
  assert.equal(await prisma.message.count({ where: { conversationId: row.id } }), 0);
  assert.equal((await autoActivities(row)).length, 0);

  const first = await send(row, "marketing_proposta_parceria");
  await prisma.conversation.update({ where: { id: row.id }, data: { categoryId: fx.bat.id } });
  await send(row, "marketing_proposta_parceria");
  assert.equal((await reload(row)).categoryId, fx.bat.id, "segundo envio não volta para o destino do template");
  assert.equal((await autoActivities(row)).length, 1);

  const externalId = first.message.externalId.split(":").slice(1).join(":");
  for (const status of ["sent", "delivered", "delivered", "read"]) await updateStatus({ status, externalId, channelAccountId: fx.main.id });
  assert.equal((await prisma.message.findUnique({ where: { id: first.message.id } })).status, "LIDA", "entrega é da Meta; aceitação ≠ entrega");
  assert.equal((await reload(row)).categoryId, fx.bat.id);
  assert.equal((await autoActivities(row)).length, 1);
});

test("18: campanha simulada reutiliza o destino do template (mesma chamada do worker)", async () => {
  await save(fx.master, { templateName: "marketing_retorno", categoryId: fx.mkt.id, subcategoryId: fx.div.id });
  const sentBefore = sendLog.length;
  const target = await findOrCreateCampaignConversation({ phone: "5511977799902", name: "Lead campanha", account: fx.main });
  await sendApprovedTemplate({ conversationId: target.id, name: "marketing_retorno", language: "pt_BR", values: {}, sentByUserId: null, channel: new FakeMeta(), requestedAccountId: fx.main.id });
  assert.equal((await reload(target)).categoryId, fx.div.id);
  assert.equal(sendLog.length, sentBefore + 1, "um único envio simulado");
  // Lead já em atendimento: a campanha não muda o setor dele.
  await prisma.conversation.update({ where: { id: target.id }, data: { categoryId: fx.bat.id, status: "EM_ATENDIMENTO" } });
  await sendApprovedTemplate({ conversationId: target.id, name: "marketing_retorno", language: "pt_BR", values: {}, sentByUserId: null, channel: new FakeMeta(), requestedAccountId: fx.main.id });
  assert.equal((await reload(target)).categoryId, fx.bat.id);
});

test("19-20: número Comercial mantém Comercial → Atacado como padrão e fallback", async () => {
  const plain = await conversation({ account: fx.commercial });
  await send(plain, "comercial_atacado", { account: fx.commercial });
  assert.equal((await reload(plain)).categoryId, fx.atacado.id);
  assert.equal((await autoActivities(plain))[0].details.source, "OUTBOUND_TEMPLATE_INITIAL_CATEGORY");

  // Regra do template cujo setor não sai pelo número Comercial: não troca o
  // remetente nem quebra o envio — vale a regra do número.
  await save(fx.master, { templateName: "comercial_atacado", categoryId: fx.mkt.id, subcategoryId: fx.parc.id });
  const fallback = await conversation({ account: fx.commercial });
  await send(fallback, "comercial_atacado", { account: fx.commercial });
  assert.equal((await reload(fallback)).categoryId, fx.atacado.id);
  assert.equal(sendLog.at(-1).wabaId, WABA.mibro);
});

test("21: atendente fixo é preservado (template define só o setor)", async () => {
  const row = await conversation({ preferredAssigneeId: fx.agent.id });
  await send(row, "marketing_proposta_parceria");
  const contact = await prisma.contact.findUnique({ where: { id: row.contactId } });
  assert.equal(contact.preferredAssigneeId, fx.agent.id);
  assert.equal(contact.preferredAssigneeEnabled, true);
  assert.equal((await reload(row)).categoryId, fx.parc.id);
});

test("22: Financeiro protegido — sem acesso novo, carimbo privado e só para quem já é do setor", async () => {
  await assert.rejects(save(fx.supOk, { templateName: "financeiro_aviso", categoryId: fx.fin.id }), (error) => error.statusCode === 403);
  await save(fx.master, { templateName: "financeiro_aviso", categoryId: fx.fin.id });

  const outsider = await conversation();
  await send(outsider, "financeiro_aviso", { user: fx.agent });
  assert.equal((await reload(outsider)).categoryId, null, "atendente fora do Financeiro não coloca a conversa lá");

  const member = await conversation();
  const result = await send(member, "financeiro_aviso", { user: fx.finAgent });
  assert.equal((await reload(member)).categoryId, fx.fin.id);
  assert.equal(result.message.privateCategoryId, fx.fin.id);
  assert.ok(await prisma.conversationActivity.findFirst({ where: { conversationId: member.id, action: "PRIVATE_SEGMENT_STARTED", privateCategoryId: fx.fin.id } }));
  const agentReadable = await privateSegments.readablePrivateCategoryIds(await as(fx.agent));
  assert.ok(!agentReadable.includes(fx.fin.id), "classificação não concede leitura do histórico privado");
  const finalized = await conversation({ categoryId: fx.fin.id, status: "FINALIZADO", history: true });
  const reopened = await send(finalized, "financeiro_aviso", { user: fx.finAgent });
  assert.equal(reopened.message.privateCategoryId, fx.fin.id, "novo ciclo no mesmo setor privado não pode perder o carimbo");
});

test("23-24: permissões no backend — Supervisor sem liberação e Atendente bloqueados; Master e Supervisor autorizado", async () => {
  await assert.rejects(save(fx.supNo, { templateName: "marketing_retorno", categoryId: fx.mkt.id }), (error) => error.statusCode === 403);
  await assert.rejects(save(fx.agent, { templateName: "suporte_retorno", categoryId: fx.sup.id }), (error) => error.statusCode === 403);
  await assert.rejects(routingService.routeHistory(await as(fx.agent), { channelAccountId: fx.main.id }), (error) => error.statusCode === 403);
  const view = await routingService.attachRouting([], fx.main, await as(fx.agent));
  assert.equal(view.canEdit, false);

  const bySupervisor = await save(fx.supOk, { templateName: "marketing_retorno", categoryId: fx.mkt.id, subcategoryId: fx.rel.id });
  assert.equal(bySupervisor.subcategoryId, fx.rel.id);
  await assert.rejects(save(fx.supOk, { templateName: "marketing_retorno", categoryId: fx.sup.id }), (error) => error.statusCode === 403);
  // Regra de setor que ele não gerencia não pode ser "sequestrada".
  await assert.rejects(save(fx.supOk, { templateName: "suporte_retorno", categoryId: fx.mkt.id }), /não gerencia/);
  const options = await routingService.routingOptions(await as(fx.supOk), fx.main.id);
  assert.deepEqual(options.categories.map((item) => item.id), [fx.mkt.id]);
  assert.ok(options.categories[0].subcategories.every((item) => item.id !== fx.oldSub.id), "subcategoria inativa não aparece");
  const masterOptions = await routingService.routingOptions(await as(fx.master), fx.main.id);
  assert.ok(!masterOptions.categories.some((item) => item.id === fx.off.id), "categoria inativa não aparece");
  assert.ok(masterOptions.categories.find((item) => item.id === fx.fin.id).protected);
});

test("25-26: sincronização preserva destinos; template removido/recriado/pausado é sinalizado e nunca herda a regra", async () => {
  await save(fx.master, { templateName: "marketing_proposta_parceria", categoryId: fx.mkt.id, subcategoryId: fx.parc.id });
  const before = await configOf("marketing_proposta_parceria");
  // Meta altera o texto do template: sincronizar de novo não mexe na regra.
  metaTemplates[WABA.mibro][0].components = [{ type: "BODY", text: "Olá, texto novo aprovado" }];
  const synced = await routingService.attachRouting((await listTemplates(new FakeMeta(), fx.main)).templates, fx.main, await as(fx.master));
  assert.equal(synced.templates.find((row) => row.name === "marketing_proposta_parceria").routing.state, "ACTIVE");
  assert.deepEqual(await configOf("marketing_proposta_parceria"), before);

  // Recriado com o mesmo nome (outro id): sinaliza e não aplica.
  metaTemplates[WABA.mibro][0].id = "m-1-recriado";
  const recreated = await routingService.attachRouting((await listTemplates(new FakeMeta(), fx.main)).templates, fx.main, await as(fx.master));
  assert.equal(recreated.templates.find((row) => row.name === "marketing_proposta_parceria").routing.state, "TEMPLATE_UNAVAILABLE");
  const row = await conversation();
  const callsBeforeFallback = templateListCalls;
  await send(row, "marketing_proposta_parceria");
  assert.equal(templateListCalls - callsBeforeFallback, 1, "fallback no mesmo número consulta o catálogo uma única vez por envio");
  assert.equal((await reload(row)).categoryId, null);

  // Removido da Meta: regra preservada como "órfã" para análise.
  metaTemplates[WABA.mibro] = metaTemplates[WABA.mibro].filter((item) => item.name !== "marketing_proposta_parceria");
  const removed = await routingService.attachRouting((await listTemplates(new FakeMeta(), fx.main)).templates, fx.main, await as(fx.master));
  const orphan = removed.orphans.find((item) => item.templateName === "marketing_proposta_parceria");
  assert.equal(orphan.state, "TEMPLATE_UNAVAILABLE");
  assert.ok(await configOf("marketing_proposta_parceria"), "configuração não apagada");
  // Ainda é possível desativar a regra órfã (sem tocar na Meta).
  assert.equal((await save(fx.master, { templateName: "marketing_proposta_parceria", categoryId: fx.mkt.id, subcategoryId: fx.parc.id, enabled: false })).enabled, false);

  // Pausado na Meta.
  await prisma.templateRoutingConfiguration.create({ data: { companyId: MIBRO, wabaId: WABA.mibro, templateName: "pausado_tpl", templateLanguage: "pt_BR", metaTemplateId: "m-6", categoryId: fx.mkt.id } });
  const paused = removed.templates.find((item) => item.name === "pausado_tpl");
  assert.equal(paused.routing, null);
  const pausedView = await routingService.attachRouting((await listTemplates(new FakeMeta(), fx.main)).templates, fx.main, await as(fx.master));
  assert.equal(pausedView.templates.find((item) => item.name === "pausado_tpl").routing.state, "TEMPLATE_UNAVAILABLE");
  assert.ok(sendLog.every((item) => item.name !== "pausado_tpl"));

  // Subcategoria desativada depois de salva: regra inválida, não aplicada.
  resetMeta();
  await save(fx.master, { templateName: "marketing_proposta_parceria", categoryId: fx.mkt.id, subcategoryId: fx.parc.id });
  await prisma.category.update({ where: { id: fx.parc.id }, data: { active: false } });
  try {
    const invalid = await routingService.attachRouting((await listTemplates(new FakeMeta(), fx.main)).templates, fx.main, await as(fx.master));
    assert.equal(invalid.templates.find((item) => item.name === "marketing_proposta_parceria").routing.state, "INVALID");
    const target = await conversation();
    await send(target, "marketing_proposta_parceria");
    assert.equal((await reload(target)).categoryId, null);
  } finally { await prisma.category.update({ where: { id: fx.parc.id }, data: { active: true } }); }
});

test("28: isolamento Mibro/Sincrofit com o mesmo nome de template", async () => {
  await save(fx.master, { templateName: "marketing_retorno", categoryId: fx.mkt.id, subcategoryId: fx.rel.id });
  await save(fx.master, { templateName: "marketing_retorno", categoryId: fx.sfCom.id, subcategoryId: fx.sfPos.id }, fx.sincro);
  assert.equal((await configOf("marketing_retorno")).subcategoryId, fx.rel.id);
  assert.equal((await configOf("marketing_retorno", WABA.sincro, SINCROFIT)).subcategoryId, fx.sfPos.id);
  const mibro = await conversation();
  const sincro = await conversation({ account: fx.sincro, companyId: SINCROFIT });
  await send(mibro, "marketing_retorno");
  await send(sincro, "marketing_retorno", { account: fx.sincro });
  assert.equal((await reload(mibro)).categoryId, fx.rel.id);
  assert.equal((await reload(sincro)).categoryId, fx.sfPos.id);
  const sincroView = await routingService.attachRouting((await listTemplates(new FakeMeta(), fx.sincro)).templates, fx.sincro, await as(fx.master));
  assert.equal(sincroView.templates[0].routing.categoryName, "TR SF Comercial");
  assert.equal(sincroView.orphans.length, 0, "regras da Mibro não aparecem na WABA da Sincrofit");
});

test("23-24, 27 (HTTP): autorização nas rotas e atualização via SSE após o envio", async () => {
  const { createApp } = require("../src/app");
  const server = createApp({ channel: new FakeMeta() }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (key) => {
    const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${key}${DOMAIN}`, password: PASSWORD }) });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  const call = (cookie, path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { Cookie: cookie, "Content-Type": "application/json", ...(options.headers || {}) } });
  const payload = JSON.stringify({ channelAccountId: fx.main.id, templateName: "suporte_retorno", templateLanguage: "pt_BR", categoryId: fx.sup.id, subcategoryId: fx.bat.id, enabled: true });
  const controller = new AbortController();
  try {
    const agent = await login("agent");
    assert.equal((await call(agent, "/api/template-routing", { method: "PUT", body: payload })).status, 403);
    const supNo = await login("supno");
    assert.equal((await call(supNo, "/api/template-routing", { method: "PUT", body: payload })).status, 403);
    const master = await login("master");
    const saved = await call(master, "/api/template-routing", { method: "PUT", body: payload });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).subcategoryName, "TR Bateria");
    const listing = await (await call(master, `/api/campaign-templates?channelAccountId=${fx.main.id}`)).json();
    assert.equal(listing.routingCanEdit, true);
    assert.equal(listing.templates.find((item) => item.name === "suporte_retorno").routing.subcategoryName, "TR Bateria");
    const agentListing = await (await call(agent, `/api/campaign-templates?channelAccountId=${fx.main.id}`)).json();
    assert.equal(agentListing.routingCanEdit, false, "atendente vê, mas não edita");
    assert.equal((await call(master, `/api/template-routing/options?channelAccountId=${fx.main.id}`)).status, 200);
    assert.equal((await call(master, `/api/template-routing/history?channelAccountId=${fx.main.id}`)).status, 200);

    const row = await conversation();
    const events = await fetch(`${base}/api/events`, { headers: { Cookie: master }, signal: controller.signal });
    const reader = events.body.getReader();
    await reader.read(); // ": connected"
    const sent = await call(master, `/api/conversations/${row.id}/templates`, { method: "POST", body: JSON.stringify({ name: "suporte_retorno", language: "pt_BR", values: {} }) });
    assert.equal(sent.status, 201);
    let stream = "";
    const deadline = Date.now() + 5000;
    while (!stream.includes("event: inbox.updated") && Date.now() < deadline) stream += new TextDecoder().decode((await reader.read()).value || new Uint8Array());
    assert.match(stream, /event: inbox\.updated/);
    assert.doesNotMatch(stream, /TR Bateria|suporte_retorno/, "SSE sem conteúdo");
    assert.equal((await reload(row)).categoryId, fx.bat.id);
  } finally {
    controller.abort();
    server.close();
  }
});
