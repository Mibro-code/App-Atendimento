// Quem pode ver o quê no painel Produtividade e Qualidade (Relatório de
// Conversas). Única fonte de escopo de todos os endpoints de relatório,
// inclusive exportações — a tela só esconde botões, a regra vive aqui.
//
//   MASTER     — todas as empresas (ou a filtrada), todos os atendentes.
//   SUPERVISOR — só as empresas em que é Supervisor e, dentro delas, só as
//                conversas do escopo dele (setores que gerencia + as suas):
//                authorization.conversationScope. Compara a própria equipe.
//   SELF       — Atendente com "Ver minha produtividade": só os próprios
//                números (atribuição = ele mesmo), nas empresas em que o flag
//                vale. Nunca vê linha/conteúdo de outra pessoa.
// Sem nenhum dos três = 403. Empresa pedida fora do alcance = 403 (nunca
// "todas" silenciosamente), mesma régua da Central de Operação.
const authorization = require("./authorization-service");
const companyService = require("./company-service");
const privateSegments = require("./private-segment-service");

const MODES = Object.freeze({ MASTER: "MASTER", SUPERVISOR: "SUPERVISOR", SELF: "SELF" });

async function availableAccess(viewer) {
  const access = await companyService.companyAccess(viewer);
  if (authorization.isMaster(viewer)) return { mode: MODES.MASTER, companyIds: access.map(({ companyId }) => companyId) };
  const supervised = access.filter(({ role }) => role === "SUPERVISOR").map(({ companyId }) => companyId);
  if (supervised.length) return { mode: MODES.SUPERVISOR, companyIds: supervised };
  const own = [];
  for (const { companyId } of access) {
    const scoped = await companyService.userForCompany(viewer, companyId);
    if (scoped?.canViewOwnProductivity) own.push(companyId);
  }
  if (own.length) return { mode: MODES.SELF, companyIds: own };
  return null;
}

async function canOpenReports(viewer) {
  return Boolean(await availableAccess(viewer));
}

// Resolve o acesso para uma requisição: empresas efetivas, escopo Prisma de
// Conversation e o atendente forçado (SELF). `query.company` = ALL|slug|id.
async function resolveReportAccess(viewer, query = {}) {
  const available = await availableAccess(viewer);
  if (!available) throw authorization.forbidden("Você não tem acesso ao painel de Produtividade.");
  let { companyIds } = available;
  if (query.company && query.company !== companyService.ALL_COMPANIES) {
    const requested = await companyService.resolveCompanyFilter(viewer, query.company);
    companyIds = requested.filter((id) => companyIds.includes(id));
    if (!companyIds.length) throw authorization.forbidden("Você não acompanha a produtividade desta empresa.");
  }
  let scope = null;
  if (available.mode === MODES.SUPERVISOR) scope = { AND: [await authorization.conversationScope(viewer), await privateConversationScope(viewer)] };
  // SELF: os próprios atendimentos podem estar hoje em conversas que ele não
  // enxerga mais (transferidas/reabertas com outro) — só agregados dele,
  // nunca conteúdo; a lista de conversas usa conversationScope à parte.
  return {
    mode: available.mode, companyIds, scope,
    forcedAgentId: available.mode === MODES.SELF ? viewer.id : null,
    canCompare: available.mode !== MODES.SELF,
    allowedAgentIds: available.mode === MODES.SUPERVISOR ? await authorization.supervisedUserIds({ ...viewer, role: 'SUPERVISOR' }) : null,
    readablePrivateIds: await readablePrivateIds(viewer),
  };
}

// Escopo para listar/abrir conversas (conteúdo): Master = empresas; demais =
// escopo real de conversa + empresas; SELF ainda restringe às dele.
async function contentScope(viewer, access) {
  const filters = [{ companyId: { in: access.companyIds } }];
  if (access.mode !== MODES.MASTER) filters.push(await authorization.conversationScope(viewer));
  if (access.mode === MODES.SUPERVISOR) filters.push(await privateConversationScope(viewer));
  if (access.mode === MODES.SELF) filters.push({ assignedUserId: viewer.id });
  return { AND: filters };
}

async function privateConversationScope(viewer) {
  const readable = await readablePrivateIds(viewer);
  return { OR: [
    { categoryId: null },
    { category: { is: { parentId: null, visibilityMode: { not: 'SECTOR_PRIVATE' } } } },
    { category: { is: { parent: { is: { visibilityMode: { not: 'SECTOR_PRIVATE' } } } } } },
    { categoryId: { in: readable || [] } },
    { category: { is: { parentId: { in: readable || [] } } } },
  ] };
}

// Setores privados (Financeiro) cujo conteúdo o usuário pode ler. null =
// tudo (Master). Usado para esconder prévia de mensagem e eventos privados.
async function readablePrivateIds(viewer) {
  if (authorization.isMaster(viewer)) return null;
  return (await privateSegments.readablePrivateCategoryIds(viewer)) || [];
}

function canReadPrivate(readable, privateCategoryId) {
  return !privateCategoryId || readable === null || readable.includes(privateCategoryId);
}

module.exports = { MODES, availableAccess, canOpenReports, canReadPrivate, contentScope, readablePrivateIds, resolveReportAccess };
