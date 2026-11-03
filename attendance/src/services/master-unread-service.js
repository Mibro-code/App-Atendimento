const { Prisma } = require('@prisma/client');

// Input must be the rows ALREADY authorized by the inbox/summary service.
// Use the readAt snapshot returned with those rows, not a second read of the
// master's state: a concurrent mark-as-read must not change this request's cut.
async function masterUnreadCounts(conversations, client) {
  const counts = new Map(conversations.map(row => [row.id, row.masterReads?.[0]?.readAt ? 0 : row.unreadCount]));
  const recorded = conversations.filter(row => row.masterReads?.[0]?.readAt);
  // Bound parameters and temporary SQL size even before inbox pagination.
  for (let offset = 0; offset < recorded.length; offset += 500) {
    const batch = recorded.slice(offset, offset + 500);
    const values = batch.map(row => Prisma.sql`(${row.id}::text, ${row.masterReads[0].readAt}::timestamp)`);
    const rows = await client.$queryRaw(Prisma.sql`
      SELECT m."conversationId", COUNT(*) AS "unreadCount"
      FROM "Message" m
      JOIN (VALUES ${Prisma.join(values)}) AS requested("conversationId", "readAt")
        ON m."conversationId" = requested."conversationId"
      WHERE m."direction" = 'RECEBIDA' AND m."type" <> 'reaction'
        AND m."createdAt" > requested."readAt"
      GROUP BY m."conversationId"
    `);
    for (const row of rows) counts.set(row.conversationId, Number(row.unreadCount));
  }
  return counts;
}

module.exports = { masterUnreadCounts };
