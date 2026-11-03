// Produtividade e Qualidade (Relatório de Conversas) — controller fino.
// Todo handler resolve o acesso no backend antes de qualquer consulta
// (report-access-service): Master vê tudo; Supervisor só as empresas em que
// é Supervisor e o escopo de conversa dele; Atendente com "Ver minha
// produtividade" só os próprios números. Vale também para as exportações.
const prisma = require("../database/prisma");
const analytics = require("../services/conversation-analytics-service");
const productivity = require("../services/productivity-service");
const reportAccess = require("../services/report-access-service");
const { STATUS_LABELS } = require("../services/conversation-report-constants");

const EXPORT_LIMIT = 10000;

// Query + escopo efetivo. `agentId` do Atendente é sempre ele mesmo.
async function reportContext(req) {
  const access = await reportAccess.resolveReportAccess(req.user, req.query);
  const query = { ...req.query, companyIds: access.companyIds, scope: access.scope, readablePrivateIds: access.readablePrivateIds };
  if (access.forcedAgentId) query.agentId = access.forcedAgentId;
  return { access, query };
}

// Listagem/abertura de conversa (conteúdo): escopo real de conversa.
async function contentContext(req) {
  const { access, query } = await reportContext(req);
  const scope = await reportAccess.contentScope(req.user, access);
  const readablePrivateIds = await reportAccess.readablePrivateIds(req.user);
  return { access, query: { ...query, scope }, readablePrivateIds };
}

function wrap(handler) {
  return async (req, res, next) => {
    try { return res.json(await handler(req, await reportContext(req))); }
    catch (error) { return next(error); }
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  // Também neutraliza fórmulas (=,+,-,@) ao abrir no Excel/Planilhas.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
function sendCsv(res, name, header, rows) {
  const lines = [header.map(csvEscape).join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(`﻿${lines.join("\n")}`);
}
const seconds = (value) => (value === null || value === undefined ? "" : Math.round(value));
const pct = (value) => (value === null || value === undefined ? "" : value.toFixed(1));

module.exports = {
  access: wrap((req, { access }) => ({ mode: access.mode, canCompare: access.canCompare, agentId: access.forcedAgentId })),
  productivity: wrap((req, { access }) => productivity.getProductivity(access, req.query)),
  sincrofitEntries: wrap((req, { access }) => require("../services/sincrofit-entry-report-service").getEntryReport(access, req.query)),
  productivityAgent: wrap((req, { access }) => productivity.getAgentProductivity(access, req.params.userId, req.query, req.user)),

  summary: wrap((req, { query }) => analytics.getSummary(query)),
  timeseries: wrap((req, { query }) => analytics.getTimeseries(query)),
  statusBreakdown: wrap((req, { query }) => analytics.getStatusBreakdown(query)),
  channelBreakdown: wrap((req, { query }) => analytics.getChannelBreakdown(query)),
  categoryBreakdown: wrap((req, { query }) => analytics.getCategoryBreakdown(query)),
  companyBreakdown: wrap((req, { query }) => analytics.getCompanyBreakdown(query)),
  heatmap: wrap((req, { query }) => analytics.getHeatmap(query)),
  waitTimeBuckets: wrap((req, { query }) => analytics.getWaitTimeBuckets(query)),
  alerts: wrap((req, { query }) => analytics.getAlerts(query)),

  // Ranking antigo (por responsável atual) — mantido por compatibilidade; a
  // tela usa /api/reports/productivity (por ciclo/atribuição).
  agentRanking: wrap(async (req, { access, query }) => {
    const ranking = await analytics.getAgentRanking(query);
    return { ...ranking, agents: ranking.agents.filter((row) => (!access.forcedAgentId || row.userId === access.forcedAgentId) && (!access.allowedAgentIds || access.allowedAgentIds.includes(row.userId))) };
  }),
  agentDetail: wrap((req, { access }) => productivity.getAgentProductivity(access, req.params.userId, req.query, req.user)),
  compareAgents: wrap(async (req, { access }) => {
    if (!access.canCompare) throw Object.assign(new Error("Comparação disponível só para Supervisor ou Master."), { statusCode: 403 });
    const ids = String(req.query.userIds || "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 8);
    if (!ids.length) throw Object.assign(new Error("Informe ao menos um atendente para comparar."), { statusCode: 400 });
    const data = await productivity.getProductivity(access, { ...req.query, agentId: undefined });
    return data.agents.filter((row) => ids.includes(row.userId));
  }),

  async listConversations(req, res, next) {
    try {
      const { query, readablePrivateIds } = await contentContext(req);
      return res.json(await analytics.listConversations(query, { readablePrivateIds, viewer: req.user }));
    } catch (error) { return next(error); }
  },
  async conversationDetail(req, res, next) {
    try {
      const { query, readablePrivateIds } = await contentContext(req);
      // IDOR: a conversa precisa estar no escopo de conteúdo do usuário.
      const visible = await prisma.conversation.findFirst({
        where: { AND: [{ id: req.params.conversationId }, query.scope] }, select: { id: true },
      });
      const detail = visible ? await analytics.getConversationDetail(req.params.conversationId, { readablePrivateIds, viewer: req.user }) : null;
      if (!detail) throw Object.assign(new Error("Conversa não encontrada."), { statusCode: 404 });
      return res.json(detail);
    } catch (error) { return next(error); }
  },

  // CSV respeitando filtros E escopo; todas as linhas até EXPORT_LIMIT
  // (antes saíam só as 100 primeiras, sem aviso).
  async exportCsv(req, res, next) {
    try {
      const { query, readablePrivateIds } = await contentContext(req);
      const { items, total } = await analytics.listConversations(query, { readablePrivateIds, viewer: req.user, exportLimit: EXPORT_LIMIT });
      const rows = items.map((item) => [
        item.contactName, item.contactPhone, item.channelLabel, item.categoryName, STATUS_LABELS[item.status] || item.status,
        item.priority, item.assignedUserName, item.createdAt?.toISOString(), item.lastMessageAt?.toISOString(),
        item.finalizedAt?.toISOString(), item.lastMessagePreview,
      ]);
      if (total > items.length) rows.push([`Exportação limitada a ${EXPORT_LIMIT} de ${total} conversas — refine os filtros.`]);
      return sendCsv(res, "relatorio-conversas",
        ["Contato", "Telefone", "Canal", "Categoria", "Status", "Prioridade", "Atendente", "Criada em", "Última atividade", "Finalizada em", "Última mensagem"], rows);
    } catch (error) { return next(error); }
  },

  async exportAgentsCsv(req, res, next) {
    try {
      const { access } = await reportContext(req);
      const data = await productivity.getProductivity(access, req.query);
      if (data.truncated) throw Object.assign(new Error("Período grande demais para exportar. Refine o período."), { statusCode: 413 });
      const rows = data.agents.map((agent) => [
        agent.name, agent.role, agent.teams.join(" / "), agent.finalized, agent.claimed, agent.transfersOut, agent.transfersIn,
        agent.reopened, agent.activeNow, agent.startedByAgent, agent.messagesSent,
        seconds(agent.firstResponseAvgSeconds), agent.firstResponseSamples, seconds(agent.responseAvgSeconds), agent.responseSamples,
        seconds(agent.handlingAvgSeconds), agent.handlingSamples, pct(agent.slaMetPercent), agent.slaMeasured, agent.slaBreached,
      ]);
      return sendCsv(res, "produtividade-atendentes", [
        "Atendente", "Cargo", "Equipes", "Finalizados", "Assumidos", "Transferiu", "Recebeu transferência", "Reabertos (24h)",
        "Ativos agora", "Iniciados pelo atendente", "Mensagens enviadas", "1ª resposta média (s)", "Amostras 1ª resposta",
        "Resposta média (s)", "Amostras resposta", "Tempo médio de atendimento (s)", "Amostras atendimento", "SLA cumprido (%)",
        "Respostas medidas (SLA)", "Respostas fora do SLA",
      ], rows);
    } catch (error) { return next(error); }
  },
};
