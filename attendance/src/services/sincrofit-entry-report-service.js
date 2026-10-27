const { PATTERNS, entryPattern } = require("./sincrofit-entry-patterns");
const { resolvePeriod, buildConversationWhere } = require("./conversation-report-filters-service");
const { readableWhere } = require("./private-segment-service");
const LIMIT = 20000;

function aggregateEntries(rows, patternId = "") {
  const contacts = new Set(), groups = new Map(PATTERNS.map(p => [p.id, { ...p, contacts: new Set(), messages: 0 }]));
  for (const row of rows) {
    const id = entryPattern(row.text);
    if (!id || (patternId && id !== patternId)) continue;
    const key = row.conversation.contactId;
    groups.get(id).contacts.add(key); groups.get(id).messages++;
    contacts.add(key);
  }
  return { uniqueContacts: contacts.size, items: [...groups.values()].filter(g => !patternId || g.id === patternId)
    .map(g => ({ id: g.id, label: g.label, count: g.contacts.size, messages: g.messages })) };
}
async function getEntryReport(access, query = {}, client = require("../database/prisma")) {
  const period = resolvePeriod(query);
  const patternId = String(query.entryPattern || "");
  if (patternId && !PATTERNS.some(p => p.id === patternId)) throw Object.assign(new Error("Mensagem-padrão inválida."), { statusCode: 400 });
  const where = buildConversationWhere({ ...query, companyIds: access.companyIds, scope: access.scope,
    agentId: access.forcedAgentId || query.agentId });
  const accounts = await client.channelAccount.findMany({
    where: { companyId: { in: access.companyIds }, company: { is: { slug: "sincrofit" } }, channel: "META" },
    select: { id: true },
  });
  if (!accounts.length) return { truncated: false, period: { label: period.label }, ...aggregateEntries([], patternId) };
  const rows = await client.message.findMany({
    where: { AND: [readableWhere(access.readablePrivateIds ?? []), {
      direction: "RECEBIDA", channel: "META", type: "text", occurredAt: { gte: period.start, lt: period.end },
      channelAccountId: { in: accounts.map(a => a.id) },
      conversation: { is: { AND: [where, { company: { is: { slug: "sincrofit" } } }] } },
      OR: [{ text: { contains: "atacado", mode: "insensitive" } }, { text: { contains: "informa", mode: "insensitive" } }],
    }] },
    select: { text: true, conversation: { select: { contactId: true } } },
    take: LIMIT + 1,
  });
  // Never show partial values as totals. No customer data leaves this service.
  if (rows.length > LIMIT) return { truncated: true, period: { label: period.label }, items: [] };
  return { truncated: false, period: { label: period.label }, ...aggregateEntries(rows, patternId) };
}
module.exports = { aggregateEntries, getEntryReport };
