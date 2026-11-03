const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const companyService = require("./company-service");
const whatsappAccounts = require("./whatsapp-account-service");
const audit = require("./audit-service");
const inbox = require("./whatsapp-inbox-service");

// Destino fixo (categoria/subcategoria internas) por template da WABA.
// A classificação no envio fica em template-initial-category-service; aqui
// só a configuração: quem edita, validação, auditoria e leitura para a tela.

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

// Master; Supervisor só com as liberações administrativas de setores e de
// templates/campanhas na empresa. Atendente nunca altera (só envia).
function canManageRouting(scoped) {
  if (authorization.isMaster(scoped)) return true;
  return scoped?.role === "SUPERVISOR" && Boolean(scoped.canManageCategories) && Boolean(scoped.canManageCampaigns);
}

// Número escolhido na tela de templates → empresa e WABA da regra. Mesmo
// acesso da listagem de templates (campanhas) da empresa.
async function accountContext(user, channelAccountId) {
  if (!channelAccountId) throw fail("Selecione o número de WhatsApp.");
  const account = await whatsappAccounts.resolveAccountForUser(user, { channelAccountId });
  const scoped = await require("./campaign-service").assertCampaignCompanyPermission(user, account.companyId);
  const wabaId = whatsappAccounts.wabaIdOf(account);
  if (!wabaId) throw fail("Templates da Meta ainda não configurados para este número (WABA ID ausente).", 503);
  return { account, scoped, wabaId, companyId: account.companyId };
}

// Supervisor: só setores liberados a ele e nunca setor restrito ao Master
// ou protegido (Financeiro) — esses ficam com o Master. allowed null = Master.
function supervisorCanUse(allowed, category, subcategory = null) {
  if (allowed === null) return true;
  if (category.masterOnly || category.visibilityMode === "SECTOR_PRIVATE" || subcategory?.masterOnly) return false;
  return allowed.has(category.id) || Boolean(subcategory && allowed.has(subcategory.id));
}

async function categoryScope(scoped) {
  const allowed = await authorization.allowedCategoryIds(scoped);
  return allowed === null ? null : new Set(allowed);
}

async function routingOptions(user, channelAccountId) {
  const { scoped, companyId } = await accountContext(user, channelAccountId);
  const allowed = await categoryScope(scoped);
  const roots = await prisma.category.findMany({
    where: { companyId, parentId: null, active: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: { children: { where: { active: true }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] } },
  });
  const categories = roots.flatMap((category) => {
    const subcategories = category.children.filter((child) => supervisorCanUse(allowed, category, child));
    if (!supervisorCanUse(allowed, category) && !subcategories.length) return [];
    return [{
      id: category.id, name: category.name, protected: category.visibilityMode === "SECTOR_PRIVATE",
      subcategories: subcategories.map((child) => ({ id: child.id, name: child.name })),
    }];
  });
  return { canEdit: canManageRouting(scoped), categories };
}

const routeKey = (name, language) => JSON.stringify([name, language]);
const ROUTE_INCLUDE = {
  category: { select: { id: true, name: true, active: true, parentId: true, visibilityMode: true, masterOnly: true } },
  subcategory: { select: { id: true, name: true, active: true, parentId: true, masterOnly: true } },
  updatedByUser: { select: { name: true } },
};

// Estado exibido: ATIVO, DESATIVADO, INVÁLIDO (setor desativado/movido) ou
// TEMPLATE_INDISPONÍVEL (sumiu/foi pausado/rejeitado/recriado na Meta).
// Mesma validação do envio, sobre os dados já carregados (sem consulta).
function routeSummary(route, template) {
  const { category, subcategory } = route;
  let state = route.enabled ? "ACTIVE" : "DISABLED";
  let issue = null;
  if (!category.active || category.parentId) { state = "INVALID"; issue = "Categoria desativada ou indisponível."; }
  else if (subcategory && (!subcategory.active || subcategory.parentId !== category.id)) { state = "INVALID"; issue = "Subcategoria desativada ou movida para outra categoria."; }
  if (!template) { state = "TEMPLATE_UNAVAILABLE"; issue = "Template não encontrado nesta WABA da Meta (removido ou renomeado). A regra foi preservada para análise."; }
  else if (route.metaTemplateId && template.id && String(template.id) !== route.metaTemplateId) { state = "TEMPLATE_UNAVAILABLE"; issue = "O template foi recriado na Meta com o mesmo nome. Revise e salve o destino novamente para confirmar."; }
  else if (template.status && template.status !== "APPROVED") { state = "TEMPLATE_UNAVAILABLE"; issue = `Template com status ${template.status} na Meta: não pode ser enviado até voltar a APPROVED.`; }
  return {
    id: route.id, enabled: route.enabled, state, issue,
    categoryId: route.categoryId, categoryName: category.name,
    subcategoryId: route.subcategoryId, subcategoryName: subcategory?.name || null,
    protected: category.visibilityMode === "SECTOR_PRIVATE",
    templateName: route.templateName, templateLanguage: route.templateLanguage,
    updatedAt: route.updatedAt, updatedBy: route.updatedByUser?.name || null,
  };
}

// Junta a regra de cada template à listagem sincronizada da Meta (sem gravar
// nada): o destino sobrevive a qualquer sincronização porque não mora no
// template. Regras sem template correspondente voltam em `orphans`.
async function attachRouting(templates, account, user) {
  const wabaId = whatsappAccounts.wabaIdOf(account);
  if (!wabaId) return { templates, orphans: [], canEdit: false };
  const routes = await prisma.templateRoutingConfiguration.findMany({ where: { companyId: account.companyId, wabaId }, include: ROUTE_INCLUDE });
  const byKey = new Map(routes.map((route) => [routeKey(route.templateName, route.templateLanguage), route]));
  const enriched = templates.map((template) => {
    const key = routeKey(template.name, template.language);
    const route = byKey.get(key);
    byKey.delete(key);
    return { ...template, routing: route ? routeSummary(route, template) : null };
  });
  const orphans = [...byKey.values()].map((route) => routeSummary(route, null));
  return { templates: enriched, orphans, canEdit: canManageRouting(await companyService.userForCompany(user, account.companyId)) };
}

async function findTemplate(channel, account, name, language) {
  const sender = whatsappAccounts.senderFor(channel, account);
  const rows = typeof sender.listAllMessageTemplates === "function" ? await sender.listAllMessageTemplates() : await sender.listMessageTemplates();
  return (Array.isArray(rows) ? rows : []).find((item) => item.name === name && item.language === language) || null;
}

const routeLabel = (category, subcategory) => category ? `${category.name}${subcategory ? ` → ${subcategory.name}` : ""}` : "Sem destino";

async function saveRoute(user, body, channel) {
  const { account, scoped, wabaId, companyId } = await accountContext(user, body?.channelAccountId);
  if (!canManageRouting(scoped)) throw authorization.forbidden("Você não pode alterar o destino automático dos templates.");
  const templateName = String(body.templateName || "").trim();
  const templateLanguage = String(body.templateLanguage || "").trim();
  const categoryId = String(body.categoryId || "").trim();
  const subcategoryId = String(body.subcategoryId || "").trim() || null;
  const enabled = body.enabled;
  if (!templateName || !templateLanguage) throw fail("Informe o template e o idioma.");
  if (typeof enabled !== "boolean") throw fail("Informe se a classificação automática fica ativada.");
  if (!categoryId) throw fail("Selecione a categoria fixa.");

  const where = { companyId_wabaId_templateName_templateLanguage: { companyId, wabaId, templateName, templateLanguage } };
  const previous = await prisma.templateRoutingConfiguration.findUnique({ where, include: ROUTE_INCLUDE });
  const template = await findTemplate(channel, account, templateName, templateLanguage);
  if (!template && !previous) throw fail("Template não encontrado nesta WABA da Meta.", 404);
  if (!previous && template.status !== "APPROVED") throw fail("Somente templates aprovados pela Meta podem receber um destino.");

  // Empresa certa, categoria principal ativa, subcategoria filha dela. Setor
  // inativo só é aceito para desativar uma regra sem trocar o destino.
  const changedTarget = !previous || previous.categoryId !== categoryId || previous.subcategoryId !== subcategoryId;
  const mustBeActive = enabled || changedTarget;
  const category = await prisma.category.findFirst({ where: { id: categoryId, companyId } });
  if (!category) throw fail("Categoria não encontrada nesta empresa.", 404);
  if (category.parentId) throw fail("Selecione uma categoria principal; a subcategoria vai no campo próprio.");
  if (!category.active && mustBeActive) throw fail("A categoria selecionada está desativada.");
  const subcategory = subcategoryId ? await prisma.category.findFirst({ where: { id: subcategoryId, companyId } }) : null;
  if (subcategoryId && subcategory?.parentId !== category.id) throw fail("A subcategoria não pertence à categoria selecionada.");
  if (subcategory && !subcategory.active && mustBeActive) throw fail("A subcategoria selecionada está desativada.");
  const allowed = await categoryScope(scoped);
  if (!supervisorCanUse(allowed, category, subcategory)) throw authorization.forbidden("Você não tem acesso a esta categoria.");
  if (previous && changedTarget && !supervisorCanUse(allowed, previous.category, previous.subcategory)) throw authorization.forbidden("O destino atual pertence a uma categoria que você não gerencia.");

  // O setor precisa sair por algum número desta WABA (Integrações → Acessos);
  // sem isso o envio não teria remetente válido e a regra nunca valeria.
  if (enabled) {
    const target = subcategory || category;
    const accounts = await prisma.channelAccount.findMany({ where: { channel: "META", companyId } });
    if (!inbox.routingCandidates(target, accounts).some((item) => whatsappAccounts.wabaIdOf(item) === wabaId)) {
      throw fail(`Nenhum número desta WABA está configurado para enviar por "${target.name}". Ajuste em Integrações → Acessos do número antes de ativar.`);
    }
  }

  const data = {
    categoryId, subcategoryId, enabled, updatedByUserId: user.id,
    ...(template ? { metaTemplateId: template.id ? String(template.id) : null, metaCategory: template.category || null } : {}),
  };
  const action = !previous ? "TEMPLATE_ROUTING_CREATED"
    : previous.enabled !== enabled && !changedTarget ? (enabled ? "TEMPLATE_ROUTING_ENABLED" : "TEMPLATE_ROUTING_DISABLED")
      : "TEMPLATE_ROUTING_UPDATED";
  const saved = await prisma.$transaction(async (transaction) => {
    const route = await transaction.templateRoutingConfiguration.upsert({
      where, update: data, create: { companyId, wabaId, templateName, templateLanguage, ...data }, include: ROUTE_INCLUDE,
    });
    await audit.recordAudit({
      actor: user, action, entityType: "TEMPLATE_ROUTING", entityId: route.id, companyId,
      summary: `Destino do template "${templateName}" (${templateLanguage}): ${routeLabel(previous?.category, previous?.subcategory)} → ${routeLabel(category, subcategory)} · ${enabled ? "ativado" : "desativado"}`,
      details: {
        templateName, templateLanguage, wabaId, channelAccountId: account.id, metaTemplateId: route.metaTemplateId,
        previous: previous ? { categoryId: previous.categoryId, categoryName: previous.category.name, subcategoryId: previous.subcategoryId, subcategoryName: previous.subcategory?.name || null, enabled: previous.enabled } : null,
        next: { categoryId, categoryName: category.name, subcategoryId, subcategoryName: subcategory?.name || null, enabled },
      },
    }, transaction);
    return route;
  });
  return routeSummary(saved, template);
}

// Histórico das alterações de destino desta WABA (auditoria existente),
// opcionalmente de um template só.
async function routeHistory(user, { channelAccountId, templateName, templateLanguage } = {}) {
  const { scoped, companyId, wabaId } = await accountContext(user, channelAccountId);
  if (!canManageRouting(scoped)) throw authorization.forbidden("Você não pode consultar o histórico de destinos.");
  const filters = [["wabaId", wabaId], ["templateName", templateName], ["templateLanguage", templateLanguage]]
    .filter(([, value]) => value).map(([key, value]) => ({ details: { path: [key], equals: String(value) } }));
  return prisma.auditLog.findMany({
    where: { entityType: "TEMPLATE_ROUTING", companyId, AND: filters },
    orderBy: { createdAt: "desc" }, take: 100,
    select: { id: true, action: true, summary: true, actorName: true, createdAt: true, details: true },
  });
}

module.exports = { attachRouting, routeHistory, routingOptions, saveRoute };
