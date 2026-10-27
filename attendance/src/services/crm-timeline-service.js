const prisma=require('../database/prisma'),authorization=require('./authorization-service'),companies=require('./company-service'),rules=require('./bulk-send-rules');
async function timeline(user,{companyId,phones,customerId}){
 if(typeof companyId!=='string'||!(await companies.accessibleCompanyIds(user)).includes(companyId)||!Array.isArray(phones)||phones.length>3||typeof customerId!=='string')throw Object.assign(Error('Recurso não encontrado.'),{statusCode:404});
 const variants=[...new Set(phones.map(phone=>rules.normalizeRecipientPhone(phone).phone).filter(Boolean).flatMap(rules.phoneVariants))];
 if(!variants.length)return {events:[]};
 const [scope,readable,accounts]=await Promise.all([authorization.conversationScope(user),require('./private-segment-service').readableWhereFor(user),require('./whatsapp-inbox-service').messageAccountScope(user)]);
 const rows=await prisma.message.findMany({where:{AND:[readable,accounts,{channel:'META',conversation:{is:{AND:[scope,{companyId,contact:{is:{companyId,OR:[{phone:{in:variants}},{externalId:{in:variants}}]}}}]}}},...(authorization.isMaster(user)?[]:[{sentByUserId:user.id,direction:'ENVIADA'}])]},select:{id:true,direction:true,status:true,occurredAt:true,rawPayload:true},orderBy:[{occurredAt:'desc'},{id:'desc'}],take:20});
 return {events:rows.map(row=>({id:'wa-'+row.id,at:row.occurredAt,source:'Atendimento · empresa selecionada',label:row.rawPayload?.crmProposal?.customerId===customerId?`Resumo da proposta #${String(row.rawPayload.crmProposal.quoteId).slice(-6)} · ${row.status}`:row.direction==='RECEBIDA'?'Mensagem recebida':`Mensagem enviada · ${row.status}`}))};
}
module.exports={timeline};
