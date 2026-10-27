const {Prisma}=require('@prisma/client');
async function emailMailboxes(client,ids){
  if(!ids.length)return new Map();
  const result=new Map();
  for(let offset=0;offset<ids.length;offset+=500){
    const values=ids.slice(offset,offset+500).map(id=>Prisma.sql`(${id}::text)`);
    const rows=await client.$queryRaw(Prisma.sql`SELECT requested.id AS "conversationId", latest.mailbox FROM (VALUES ${Prisma.join(values)}) AS requested(id) CROSS JOIN LATERAL (SELECT "rawPayload"->>'gmailMailbox' AS mailbox FROM "Message" WHERE "conversationId"=requested.id AND "channel"='EMAIL' AND "direction"='RECEBIDA' AND "type"<>'reaction' ORDER BY "occurredAt" DESC, "id" DESC LIMIT 1) AS latest`);
    for(const row of rows)result.set(row.conversationId,row.mailbox||'GENERAL');
  }
  return result;
}
module.exports={emailMailboxes};
