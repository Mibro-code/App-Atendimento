// Desempenho dos templates WhatsApp — ranking por empresa (workspace).
//
// Fonte: as próprias mensagens de template gravadas pela Central
// (Message type=template, rawPayload.template = { name, language, category },
// gravado por meta-template-service.sendApprovedTemplate — caminho único de
// envio individual, campanha e Nova conversa). Nada é estimado.
//
// Isolamento: SEMPRE uma empresa só (workspace). A empresa vem da conversa e
// o número do envio precisa ser da mesma empresa — template com o mesmo nome
// na Mibro e na Sincrofit nunca soma.
//
// Resposta = mesma regra dos cartões de Custos Meta (meta-cost-service):
// cada envio conta no máximo uma vez; citação explícita (context.id) vale
// primeiro; sem citação, a resposta vai só para o ÚLTIMO template não falho
// do mesmo chat e número antes dela (empate = nenhum). Reação, resposta que
// cita outra mensagem, envio sem número identificado e resposta depois do fim
// do período não contam. É associação temporal, não prova de causa.
const { Prisma } = require("@prisma/client");
const prisma = require("../database/prisma");
const authorization = require("./authorization-service");
const companyService = require("./company-service");

const TIME_ZONE = "America/Sao_Paulo";
const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90 };
const MAX_CUSTOM_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

// "2026-10-19" no fuso da operação (Brasília não tem horário de verão).
function localDate(value, endOfDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function templatePeriod({ period = "30d", from, to } = {}, now = new Date()) {
  if (period === "custom") {
    const start = localDate(from, false);
    const requestedEnd = localDate(to, true);
    if (!start || !requestedEnd || start > requestedEnd) throw fail("Período personalizado inválido. Informe início e fim (AAAA-MM-DD).");
    if (requestedEnd - start > MAX_CUSTOM_DAYS * DAY_MS) throw fail(`O período personalizado pode ter no máximo ${MAX_CUSTOM_DAYS} dias.`);
    // Respostas só contam até o fim do período — e nunca depois de "agora".
    return { key: "custom", start, end: requestedEnd > now ? now : requestedEnd };
  }
  const days = PERIOD_DAYS[period];
  if (!days) throw fail("Período inválido (7d, 30d, 90d ou custom).");
  const start = require("./operations-panel-service").startOfToday(now);
  start.setTime(start.getTime() - (days - 1) * DAY_MS);
  return { key: period, start, end: now };
}

const int = (value) => Number(value) || 0;
const rate = (replied, eligible) => (eligible ? Math.round((replied / eligible) * 1000) / 10 : null);

// Uma consulta, agregada no banco: por template, por dia, por número e total.
function aggregate({ companyId, start, end, channelAccountId, template }) {
  return prisma.$queryRaw(Prisma.sql`
    WITH sends AS (
      SELECT m.id, m."conversationId", m."channelAccountId", m."externalId", m."occurredAt", m.status,
        cv."contactId", m."sentByUserId", sender.name AS "senderName", account.name AS "accountName",
        COALESCE(NULLIF(account.config->>'displayNumber', ''), NULLIF(account.config->>'displayPhoneNumber', '')) AS "displayNumber",
        NULLIF(m."rawPayload"->'template'->>'name', '') AS name,
        COALESCE(NULLIF(m."rawPayload"->'template'->>'language', ''), '') AS language,
        COALESCE(NULLIF(m."rawPayload"->'template'->>'category', ''), mc."templateCategory") AS category,
        (mc."deliveredAt" IS NOT NULL) AS "chargeDelivered",
        to_char((m."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TIME_ZONE}, 'YYYY-MM-DD') AS day
      FROM "Message" m
      JOIN "Conversation" cv ON cv.id = m."conversationId"
      LEFT JOIN "ChannelAccount" account ON account.id = m."channelAccountId"
      LEFT JOIN "User" sender ON sender.id = m."sentByUserId"
      LEFT JOIN "MetaMessageCharge" mc ON mc."messageId" = m.id
      WHERE cv."companyId" = ${companyId}
        AND m.channel = 'META' AND m.direction = 'ENVIADA' AND m.type = 'template'
        AND m."occurredAt" >= ${start} AND m."occurredAt" <= ${end}
        AND (m."channelAccountId" IS NULL OR account."companyId" = ${companyId})
        ${channelAccountId ? Prisma.sql`AND m."channelAccountId" = ${String(channelAccountId)}` : Prisma.empty}
        ${template ? Prisma.sql`AND m."rawPayload"->'template'->>'name' = ${template.name}
          AND COALESCE(m."rawPayload"->'template'->>'language', '') = ${template.language || ""}` : Prisma.empty}
    ), scored AS (
      SELECT s.*,
        CASE WHEN s.status = 'FALHOU' OR s."channelAccountId" IS NULL THEN NULL ELSE reply.how END AS how,
        (s.status <> 'FALHOU' AND s."channelAccountId" IS NOT NULL) AS eligible
      FROM sends s
      LEFT JOIN LATERAL (
        SELECT min(CASE WHEN COALESCE(r."rawPayload"->'context'->>'id', '') = '' THEN 2 ELSE 1 END) AS how
        FROM "Message" r
        WHERE r."conversationId" = s."conversationId" AND r."channelAccountId" = s."channelAccountId"
          AND r.channel = 'META' AND r.direction = 'RECEBIDA' AND r.type <> 'reaction'
          AND r."occurredAt" > s."occurredAt" AND r."occurredAt" <= ${end}
          AND (
            r."rawPayload"->'context'->>'id' = s."externalId"
            OR s."channelAccountId" || ':' || (r."rawPayload"->'context'->>'id') = s."externalId"
            OR (COALESCE(r."rawPayload"->'context'->>'id', '') = '' AND NOT EXISTS (
              SELECT 1 FROM "Message" n
              WHERE n."conversationId" = s."conversationId" AND n."channelAccountId" = s."channelAccountId"
                AND n.channel = 'META' AND n.direction = 'ENVIADA' AND n.type = 'template' AND n.status <> 'FALHOU'
                AND n.id <> s.id AND n."occurredAt" >= s."occurredAt" AND n."occurredAt" <= r."occurredAt"
            ))
          )
      ) reply ON TRUE
    )
    SELECT name, language, day, "channelAccountId", "sentByUserId" AS "userId",
      max("senderName") AS "authorName", max("accountName") AS "accountName", max("displayNumber") AS "displayNumber",
      GROUPING(name, language, day, "channelAccountId")::int AS grp,
      count(*)::int AS attempts,
      count(*) FILTER (WHERE status = 'FALHOU')::int AS failed,
      count(*) FILTER (WHERE status <> 'FALHOU')::int AS sent,
      count(*) FILTER (WHERE status IN ('ENTREGUE', 'LIDA') OR "chargeDelivered")::int AS delivered,
      count(*) FILTER (WHERE status = 'LIDA')::int AS read,
      count(*) FILTER (WHERE eligible)::int AS eligible,
      count(*) FILTER (WHERE how IS NOT NULL)::int AS replied,
      count(*) FILTER (WHERE how = 1)::int AS "repliedByCitation",
      count(DISTINCT "contactId") FILTER (WHERE status <> 'FALHOU')::int AS "contactsReached",
      count(DISTINCT "contactId") FILTER (WHERE how IS NOT NULL)::int AS "contactsReplied",
      count(DISTINCT "channelAccountId")::int AS numbers,
      (array_agg(category ORDER BY "occurredAt" DESC) FILTER (WHERE category IS NOT NULL))[1] AS category,
      min("occurredAt") AS "firstSentAt", max("occurredAt") AS "lastSentAt"
    FROM scored
    GROUP BY GROUPING SETS ((name, language), (day), ("channelAccountId"), (), (name, language, "channelAccountId", "sentByUserId", category))
  `);
}

// Bits de GROUPING(name, language, day, channelAccountId): 1 = agrupado.
const GROUP = { TEMPLATE: 0b0011, AUTHOR: 0b0010, DAY: 0b1101, ACCOUNT: 0b1110, TOTAL: 0b1111 };

function authors(rows) {
  return rows.filter((row) => row.grp === GROUP.AUTHOR).map((row) => ({
    userId: row.userId || null,
    authorName: row.userId ? row.authorName || "Usuário removido" : "Origem não registrada",
    templateName: row.name || null, language: row.language || null, category: row.category || null,
    channelAccountId: row.channelAccountId || null,
    accountName: row.channelAccountId ? row.accountName || "Número" : "Sem número registrado",
    displayNumber: row.displayNumber || null,
    ...metrics(row),
  })).sort((a, b) => b.sent - a.sent || a.authorName.localeCompare(b.authorName) || String(a.templateName).localeCompare(String(b.templateName)));
}

function metrics(row = {}) {
  const value = {
    attempts: int(row.attempts), failed: int(row.failed), sent: int(row.sent), delivered: int(row.delivered), read: int(row.read),
    responseEligible: int(row.eligible), replied: int(row.replied), repliedByCitation: int(row.repliedByCitation),
    contactsReached: int(row.contactsReached), contactsReplied: int(row.contactsReplied),
  };
  value.notEvaluable = value.sent - value.responseEligible;
  value.responseRate = rate(value.replied, value.responseEligible);
  return value;
}

// Dias do período (sem buracos) para o gráfico de evolução, no fuso da operação.
function fillDays(rows, start, end) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  const last = format.format(end);
  const days = [];
  for (let at = new Date(`${format.format(start)}T12:00:00-03:00`); format.format(at) <= last; at = new Date(at.getTime() + DAY_MS)) {
    const day = format.format(at);
    days.push({ day, ...metrics(byDay.get(day)) });
  }
  return days;
}

// Funil comercial: só o que a Central registra de fato. Interesse, negociação
// e venda NÃO são deduzidos de resposta — ficam como pendências de integração.
function funnel(total) {
  return {
    available: [
      { key: "sent", label: "Mensagens enviadas", value: total.sent },
      { key: "delivered", label: "Mensagens entregues", value: total.delivered },
      { key: "read", label: "Mensagens lidas", value: total.read, note: "Depende da confirmação de leitura do cliente; quem desativa o recibo de leitura nunca aparece como lido." },
      { key: "contactsReplied", label: "Contatos que responderam", value: total.contactsReplied },
    ],
    pending: [
      { key: "interested", label: "Contatos interessados", reason: "A Central não registra interesse comercial. A campanha tem o campo de prospecção, mas nenhuma tela ou integração marca \"interessado\". Uma resposta não é tratada como interesse." },
      { key: "negotiations", label: "Negociações iniciadas", reason: "Não há registro de negociação/oportunidade na Central. Depende de integração com CRM ou de uma marcação manual pela equipe." },
      { key: "sales", label: "Vendas concluídas", reason: "Não há dados de pedidos/vendas vinculados às conversas. Depende de integração com o sistema de vendas (pedido ↔ contato ↔ conversa)." },
    ],
  };
}

async function scope(viewer, query, now) {
  authorization.assertMaster(viewer);
  const companyId = await companyService.resolveWorkspace(viewer, query.company);
  const period = templatePeriod(query, now);
  let channelAccountId = query.channelAccountId ? String(query.channelAccountId) : null;
  if (channelAccountId) {
    const account = await prisma.channelAccount.findFirst({ where: { id: channelAccountId, companyId, channel: "META" }, select: { id: true } });
    if (!account) throw fail("Número não pertence a esta empresa.", 403);
  }
  const company = await companyService.getCompany(companyId);
  return { companyId, company: company ? companyService.publicCompany(company) : null, period, channelAccountId };
}

async function getTemplateRanking(viewer, query = {}, { now = new Date() } = {}) {
  const { companyId, company, period, channelAccountId } = await scope(viewer, query, now);
  const rows = await aggregate({
    companyId, start: period.start, end: period.end, channelAccountId,
  });
  const totalRow = rows.find((row) => row.grp === GROUP.TOTAL);
  const total = metrics(totalRow);
  const sort = query.sort === "rate" ? "rate" : "sent";
  const templates = rows.filter((row) => row.grp === GROUP.TEMPLATE).map((row) => ({
    name: row.name, language: row.language || null, category: row.category || null,
    identified: Boolean(row.name), numbers: int(row.numbers), firstSentAt: row.firstSentAt, lastSentAt: row.lastSentAt,
    ...metrics(row),
  })).sort(sort === "rate"
    ? (a, b) => (b.responseRate ?? -1) - (a.responseRate ?? -1) || b.responseEligible - a.responseEligible || b.sent - a.sent
    : (a, b) => b.sent - a.sent || b.replied - a.replied || String(a.name).localeCompare(String(b.name)));
  return {
    company, companyId, channelAccountId, sort,
    period: { key: period.key, start: period.start, end: period.end },
    total, templates, byAuthorAndTemplate: authors(rows),
    series: fillDays(rows.filter((row) => row.grp === GROUP.DAY), period.start, period.end),
    funnel: funnel(total),
    attribution: {
      rule: "Cada envio conta uma vez. Citação do envio vale primeiro; sem citação, a resposta vai para o último template do mesmo chat e número. Reações, envios sem número identificado e respostas após o fim do período não contam.",
      repliedByCitation: total.repliedByCitation, repliedByLatestTemplate: total.replied - total.repliedByCitation,
      notEvaluable: total.notEvaluable, unidentifiedTemplates: templates.filter((item) => !item.identified).reduce((sum, item) => sum + item.attempts, 0),
    },
  };
}

async function getTemplateDetail(viewer, query = {}, { now = new Date() } = {}) {
  const { companyId, company, period, channelAccountId } = await scope(viewer, query, now);
  const name = String(query.name || "").trim();
  if (!name) throw fail("Informe o template.");
  const language = String(query.language || "").trim();
  const rows = await aggregate({
    companyId, start: period.start, end: period.end, channelAccountId, template: { name, language },
  });
  const accountIds = rows.filter((row) => row.grp === GROUP.ACCOUNT && row.channelAccountId).map((row) => row.channelAccountId);
  const [accounts, campaigns] = await Promise.all([
    accountIds.length ? prisma.channelAccount.findMany({ where: { id: { in: accountIds }, companyId }, select: { id: true, name: true } }) : [],
    // Campanhas que usaram este template (por campanha ou por destinatário), só desta empresa.
    prisma.campaign.findMany({
      where: { companyId, OR: [{ templateName: name, ...(language ? { templateLanguage: language } : {}) }, { contacts: { some: { templateName: name } } }] },
      select: { id: true, name: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 10,
    }).catch(() => []),
  ]);
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  const total = metrics(rows.find((row) => row.grp === GROUP.TOTAL));
  const totalRow = rows.find((row) => row.grp === GROUP.TOTAL) || {};
  return {
    company, companyId, channelAccountId,
    template: { name, language: language || null, category: totalRow.category || null, firstSentAt: totalRow.firstSentAt || null, lastSentAt: totalRow.lastSentAt || null },
    period: { key: period.key, start: period.start, end: period.end },
    total, byAuthorAndTemplate: authors(rows),
    series: fillDays(rows.filter((row) => row.grp === GROUP.DAY), period.start, period.end),
    byNumber: rows.filter((row) => row.grp === GROUP.ACCOUNT).map((row) => ({
      channelAccountId: row.channelAccountId, name: row.channelAccountId ? names.get(row.channelAccountId) || "Número" : "Sem número registrado", ...metrics(row),
    })).sort((a, b) => b.sent - a.sent),
    campaigns,
  };
}

module.exports = { getTemplateDetail, getTemplateRanking, templatePeriod };
