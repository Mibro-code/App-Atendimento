// Filtros compartilhados do Relatório de Conversas — único lugar que
// interpreta query params (período/vendedor/canal/categoria/status/
// prioridade) e monta o WHERE do Prisma. Todo endpoint do relatório usa
// isto, nunca reimplementa o parsing — garante que "o mesmo filtro sempre
// significa a mesma coisa" em todo o dashboard (item 2 do pedido: "os
// filtros devem afetar TODO o dashboard").
const { CONVERSATION_STATUSES, CONVERSATION_PRIORITIES, CHANNELS } = require("./conversation-report-constants");

const PERIOD_PRESETS = new Set(["today", "yesterday", "7d", "30d", "this_month", "last_month", "all", "custom"]);

const {
  TIME_ZONE, addZonedDays, parseZonedDate, startOfZonedDay, startOfZonedMonth,
} = require("./operation-time");

// Retorna { start, end, previousStart, previousEnd, label } — `end` é
// EXCLUSIVO (< end), nunca inclusivo, para nunca depender de milissegundos
// exatos de "fim do dia". O período anterior tem sempre a MESMA duração do
// período atual, imediatamente antes dele (item 3: "variação vs período
// anterior" nunca compara janelas de tamanhos diferentes). Dias e meses são
// os do fuso da operação (America/Sao_Paulo), nunca o fuso do servidor.
function resolvePeriod({ period = "7d", startDate, endDate } = {}, now = new Date()) {
  const preset = PERIOD_PRESETS.has(period) ? period : "7d";
  const today = startOfZonedDay(now);
  const tomorrow = addZonedDays(today, 1);
  let start;
  let end;

  if (preset === "today") { start = today; end = tomorrow; }
  else if (preset === "yesterday") { start = addZonedDays(today, -1); end = today; }
  else if (preset === "7d") { end = tomorrow; start = addZonedDays(today, -6); }
  else if (preset === "30d") { end = tomorrow; start = addZonedDays(today, -29); }
  else if (preset === "this_month") { start = startOfZonedMonth(now); end = tomorrow; }
  else if (preset === "last_month") { start = startOfZonedMonth(now, -1); end = startOfZonedMonth(now); }
  else if (preset === "all") { start = new Date(Date.UTC(2000, 0, 1)); end = tomorrow; }
  else {
    // custom (datas do calendário da operação; fim inclusivo na tela)
    const parsedStart = parseZonedDate(startDate);
    const parsedEnd = parseZonedDate(endDate);
    start = parsedStart || addZonedDays(today, -6);
    end = parsedEnd ? addZonedDays(parsedEnd, 1) : tomorrow;
    if (end <= start) end = addZonedDays(start, 1);
  }

  const durationMs = end.getTime() - start.getTime();
  const previousEnd = start;
  const previousStart = new Date(start.getTime() - durationMs);

  const fmt = (date) => date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIME_ZONE });
  const label = preset === "all" ? "Todo o histórico" : `${fmt(start)} a ${fmt(new Date(end.getTime() - 1))}`;

  return { start, end, previousStart, previousEnd, preset, label };
}

// `agentId="unassigned"` filtra conversas sem responsável — vocabulário
// controlado próprio (nunca confundido com um id real de usuário).
// `companyIds` (multiempresa) já chega resolvido e validado pelo controller
// (company-service#resolveCompanyFilter) — aqui só vira filtro.
// `categoryId` é a "equipe" (setor): inclui as subcategorias dele.
// `scope` é o escopo de acesso do usuário (report-access-service) — sempre
// combinado em AND, nunca substituído por um filtro da tela.
// Sempre devolve { AND: [...] } para nunca colidir com OR/AND do chamador.
function buildConversationWhere({ agentId, channel, categoryId, status, priority, companyIds, scope } = {}) {
  const filters = [];
  if (scope) filters.push(scope);
  if (Array.isArray(companyIds)) filters.push({ companyId: { in: companyIds } });
  if (agentId === "unassigned") filters.push({ assignedUserId: null });
  else if (agentId) filters.push({ assignedUserId: agentId });
  if (channel && CHANNELS.includes(channel)) filters.push({ channel });
  if (categoryId === "UNCATEGORIZED") filters.push({ categoryId: null });
  else if (categoryId) filters.push({ OR: [{ categoryId }, { category: { is: { parentId: categoryId } } }] });
  if (status && CONVERSATION_STATUSES.includes(status)) filters.push({ status });
  if (priority && CONVERSATION_PRIORITIES.includes(priority)) filters.push({ priority });
  return { AND: filters };
}

function resolveFilters(query = {}) {
  const period = resolvePeriod(query);
  const dimensions = buildConversationWhere(query);
  return { ...period, dimensions, raw: query };
}

module.exports = { resolvePeriod, buildConversationWhere, resolveFilters, PERIOD_PRESETS };
