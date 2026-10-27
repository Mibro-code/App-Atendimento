const prisma=require('../database/prisma');
const companies=require('./company-service');
const authorization=require('./authorization-service');
const rules=require('./bulk-send-rules');
const {hash,opaque}=require('./central-identity-crypto');
const fail=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});
const SENT=['ENVIADA','ENTREGUE','LIDA'];
const CAMPAIGN_SENT=['SENT','DELIVERED','READ','REPLIED'];
const PENDING=['PENDING','QUEUED','SENDING'];
function normalized(phone){return rules.normalizeRecipientPhone(phone).phone||null;}
function recipientKey(phone){const value=normalized(phone);return value?rules.dedupeKey(value):null;}

async function assertCompany(user,companyId){
  if(typeof companyId!=='string'||!companyId)throw fail('Escolha a empresa do envio.');
  const allowed=await require('./campaign-service').manageableCompanyIds(user);
  if(!allowed.includes(companyId))throw fail('Você não tem permissão para campanhas nesta empresa.',403);
  return companies.getCompany(companyId);
}
async function options(user){
  const ids=await require('./campaign-service').manageableCompanyIds(user);
  return prisma.company.findMany({where:{id:{in:ids},active:true},orderBy:{displayOrder:'asc'},select:{id:true,slug:true,name:true,displayName:true}});
}
function summarizeHistory(phone,events=[],optedOut=false){
  const ordered=events.slice().sort((a,b)=>new Date(b.at||0)-new Date(a.at||0));
  const latest=ordered[0];
  const sent=ordered.filter(event=>event.sent).sort((a,b)=>new Date(b.sentAt||b.at||0)-new Date(a.sentAt||a.at||0));
  return {phone,hasSent:sent.length>0,lastSentAt:sent[0]?.sentAt||sent[0]?.at||null,lastEventAt:latest?.at||null,lastStatus:latest?.status||null,
    senderName:latest?.senderName||null,senderPhone:latest?.senderPhone||null,agentName:latest?.agentName||null,
    templateName:latest?.templateName||null,queued:events.some(event=>event.pending),failed:latest?.failed||false,optedOut,
    coverage:'VISIBLE_WHATSAPP_ONLY',match:'PHONE_OR_EXPLICIT_CRM_ID'};
}
async function history(user,companyId,recipients,{accountId,includeCrossCompany=true}={}){
  await assertCompany(user,companyId);
  if(!Array.isArray(recipients)||recipients.length>500)throw fail('Consulte até 500 contatos por vez.');
  const rows=recipients.map(row=>({id:String(row.id||''),phone:normalized(row.phone)}));
  const phones=[...new Set(rows.map(row=>row.phone).filter(Boolean).flatMap(rules.phoneVariants))];
  const ids=rows.map(row=>row.id).filter(Boolean);
  const source=accountId?{channelAccountId:accountId==='legacy'?null:accountId}:{};
  if(accountId && accountId!=='legacy' && !(await authorization.canAccessChannelAccount(user,accountId)))throw fail('Número fora do seu acesso.',403);
  const scope=await authorization.operationalScope(user);
  const readable=await require('./private-segment-service').readableWhereFor(user);
  const accountScope=await require('./whatsapp-inbox-service').messageAccountScope(user);
  // Conservative scope for non-Masters: never reveal another agent's older
  // messages through reporting when transfer-history visibility is narrower.
  const messageWhere={AND:[readable,accountScope,{direction:'ENVIADA',channel:'META',...source,...(authorization.isMaster(user)?{}:{sentByUserId:user.id})}]};
  const [contacts,batches,optOut,crossWarnings]=await Promise.all([
    phones.length?prisma.contact.findMany({where:{companyId,channel:'META',OR:[{externalId:{in:phones}},{phone:{in:phones}}]},select:{phone:true,externalId:true,conversations:{where:{AND:[scope,{companyId,channel:'META'}]},select:{id:true,
      messages:{where:messageWhere,orderBy:[{occurredAt:'desc'},{id:'desc'}],take:1,select:{status:true,occurredAt:true,channelAccountId:true,sentByUser:{select:{name:true}},metaCharge:{select:{templateName:true,channelAccountId:true}}}},
      _count:{select:{messages:{where:{AND:[messageWhere,{status:{in:SENT}}]}}}}
    }}}}):[],
    (phones.length||ids.length)?prisma.campaignContact.findMany({where:{isTest:false,OR:[{phone:{in:phones}},...(ids.length?[{crmCustomerIds:{hasSome:ids}}]:[])],AND:[{OR:[{status:{notIn:PENDING}},{campaign:{status:{in:['SCHEDULED','QUEUED','RUNNING','PAUSED']}}}]}],campaign:{companyId,...source,...(authorization.isMaster(user)?{}:{createdByUserId:user.id})}},
      distinct:['phone','status'],orderBy:[{updatedAt:'desc'},{id:'desc'}],select:{phone:true,crmCustomerIds:true,status:true,sentAt:true,updatedAt:true,templateName:true,campaign:{select:{templateName:true,createdBy:{select:{name:true}},channelAccount:{select:{name:true,config:true}}}}}}):[],
    prisma.optOut.findMany({where:{companyId,removedAt:null,phone:{in:phones}},select:{phone:true}}),
    includeCrossCompany?require('./cross-company-contact-warning').check(user,companyId,rows.map(row=>row.phone)):rows.map(()=>null)
  ]);
  const conversationIds=contacts.flatMap(contact=>contact.conversations.map(conv=>conv.id));
  const lastSent=conversationIds.length?await prisma.message.findMany({where:{AND:[messageWhere,{conversationId:{in:conversationIds},status:{in:SENT}}]},distinct:['conversationId'],orderBy:[{occurredAt:'desc'},{id:'desc'}],select:{conversationId:true,occurredAt:true}}):[];
  const sentAtByConversation=new Map(lastSent.map(row=>[row.conversationId,row.occurredAt]));
  const senderIds=[...new Set(contacts.flatMap(contact=>contact.conversations.flatMap(conv=>conv.messages.map(m=>m.channelAccountId||m.metaCharge?.channelAccountId))).filter(Boolean))];
  const senders=senderIds.length?await prisma.channelAccount.findMany({where:{id:{in:senderIds},companyId},select:{id:true,name:true,config:true}}):[];
  const senderById=new Map(senders.map(row=>[row.id,row]));
  const eventsByPhone=new Map(),eventsById=new Map();
  function add(map,key,event){if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(event);}
  for(const contact of contacts)for(const conv of contact.conversations){
    const m=conv.messages[0];if(!m)continue;
    const sender=senderById.get(m.channelAccountId||m.metaCharge?.channelAccountId);
    add(eventsByPhone,recipientKey(contact.phone||contact.externalId),{at:m.occurredAt,sentAt:sentAtByConversation.get(conv.id),status:m.status,sent:conv._count.messages>0,pending:m.status==='PENDENTE',failed:m.status==='FALHOU',agentName:m.sentByUser?.name,templateName:m.metaCharge?.templateName,senderName:sender?.name||'Número não registrado',senderPhone:sender?.config?.displayPhoneNumber});
  }
  for(const batch of batches){
    const event={at:batch.sentAt||batch.updatedAt,sentAt:batch.sentAt,status:batch.status,sent:CAMPAIGN_SENT.includes(batch.status)||Boolean(batch.sentAt),pending:PENDING.includes(batch.status),failed:batch.status==='FAILED',agentName:batch.campaign.createdBy?.name,templateName:batch.templateName||batch.campaign.templateName,senderName:batch.campaign.channelAccount?.name||'WhatsApp principal',senderPhone:batch.campaign.channelAccount?.config?.displayPhoneNumber};
    add(eventsByPhone,recipientKey(batch.phone),event);for(const id of batch.crmCustomerIds)add(eventsById,id,event);
  }
  const blocked=new Set(optOut.map(row=>recipientKey(row.phone)));
  return rows.map((row,index)=>({id:row.id,...summarizeHistory(row.phone,[...(eventsByPhone.get(recipientKey(row.phone))||[]),...(eventsById.get(row.id)||[])],blocked.has(recipientKey(row.phone))),crossCompany:crossWarnings[index]}));
}
async function createSelection(user,crmUserId,{companyId,recipients,skipSent=true}){
  await assertCompany(user,companyId);
  if(!Array.isArray(recipients)||!recipients.length||recipients.length>500)throw fail('Selecione de 1 a 500 contatos.');
  const byPhone=new Map();let invalid=0;
  for(const row of recipients){
    if(typeof row.id!=='string'||!row.id)throw fail('Contato sem identificador do CRM.');
    const phone=normalized(row.phone);if(!phone){invalid++;continue;}
    const key=recipientKey(phone);
    if(!byPhone.has(key))byPhone.set(key,{phone,name:String(row.name||'').slice(0,160),crmCustomerIds:[]});
    byPhone.get(key).crmCustomerIds.push(row.id);
  }
  if(!byPhone.size)throw fail('Nenhum telefone válido na seleção.');
  const code=opaque();
  await prisma.crmContactSelection.create({data:{codeHash:hash(code),userId:user.id,crmUserId,companyId,recipients:[...byPhone.values()],skipSent:skipSent!==false,expiresAt:new Date(Date.now()+15*60000)}});
  return {code,valid:byPhone.size,invalid,duplicates:recipients.length-invalid-byPhone.size};
}
async function readSelection(user,code,companyId){
  if(!/^[A-Za-z0-9_-]{43}$/.test(code||''))throw fail('Seleção do CRM inválida.',404);
  const row=await prisma.crmContactSelection.findUnique({where:{codeHash:hash(code)}});
  if(row?.recipients?.some(recipient=>recipient.purpose))throw fail('Esta seleção não é um lote de contatos.',404);
  if(!row||row.userId!==user.id||row.expiresAt<=new Date()||(companyId&&row.companyId!==companyId))throw fail('Seleção do CRM expirada ou fora do seu acesso.',404);
  const link=await prisma.centralCrmIdentity.findUnique({where:{attendanceUserId:user.id},select:{enabled:true,crmUserId:true}});
  if(!link?.enabled||link.crmUserId!==row.crmUserId)throw fail('Vínculo do CRM indisponível.',403);
  const company=await assertCompany(user,row.companyId);
  return {...row,company};
}
module.exports={assertCompany,options,history,createSelection,readSelection,summarizeHistory,normalized,recipientKey};
