const prisma=require('../database/prisma');
const companies=require('./company-service');
const authorization=require('./authorization-service');
const rules=require('./bulk-send-rules');
const {hash,opaque}=require('./central-identity-crypto');
const fail=()=>Object.assign(Error('Rascunho comercial indisponível ou fora do seu acesso.'),{statusCode:404});
async function proposalOrigin(user,conversationId,expected={}){
  if(typeof conversationId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(conversationId))throw fail();
  await authorization.assertCanActOnConversation(user,conversationId);
  const row=await prisma.conversation.findUnique({where:{id:conversationId},include:{contact:true}});
  if(!row||row.channel!=='META'||row.contact.companyId!==row.companyId)throw fail();
  const scoped=await authorization.forCompany(user,row.companyId);
  const phone=rules.normalizeRecipientPhone(row.contact.phone||row.contact.externalId).phone;
  const sender=await require('./whatsapp-inbox-service').senderState(row,scoped);
  if(!phone||!sender.account)throw fail();
  const channelAccountId=sender.account.config?.isLegacyWhatsApp?null:sender.account.id;
  if(expected.companyId&&expected.companyId!==row.companyId||expected.phone&&rules.dedupeKey(expected.phone)!==rules.dedupeKey(phone)
    ||Object.hasOwn(expected,'originChannelAccountId')&&expected.originChannelAccountId!==channelAccountId)throw fail();
  return {originConversationId:row.id,originChannelAccountId:channelAccountId,companyId:row.companyId,phone};
}
async function create(user,crmUserId,data){
  const origin=data.originConversationId?await proposalOrigin(user,data.originConversationId,{phone:data.phone}):null;
  const company=await prisma.company.findUnique({where:origin?{id:origin.companyId}:{slug:String(data.brand||'').toLowerCase()},select:{id:true,active:true,name:true}});
  if(!company?.active)throw fail();
  const scoped=await authorization.forCompany(user,company.id);
  if(!origin&&!authorization.canStartConversations(scoped,'META'))throw authorization.forbidden();
  const phone=rules.normalizeRecipientPhone(data.phone).phone;
  if(!phone||typeof data.text!=='string'||data.text.length>3500||!data.text.trim()||![data.customerId,data.quoteId].every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id)))throw fail();
  const code=opaque();
  await prisma.crmContactSelection.create({data:{codeHash:hash(code),userId:user.id,crmUserId,companyId:company.id,expiresAt:new Date(Date.now()+15*60000),recipients:[{purpose:'PROPOSAL_DRAFT',phone,text:data.text,quoteId:data.quoteId,customerId:data.customerId,...(origin?{originConversationId:origin.originConversationId,originChannelAccountId:origin.originChannelAccountId}:{})}],skipSent:false}});
  return {code};
}
async function read(user,code){
  if(!/^[A-Za-z0-9_-]{43}$/.test(code||''))throw fail();
  const row=await prisma.crmContactSelection.findUnique({where:{codeHash:hash(code)}}),draft=row?.recipients?.[0];
  if(!row||row.userId!==user.id||row.expiresAt<=new Date()||draft?.purpose!=='PROPOSAL_DRAFT')throw fail();
  const link=await prisma.centralCrmIdentity.findUnique({where:{attendanceUserId:user.id},select:{crmUserId:true,enabled:true}});
  if(!link?.enabled||link.crmUserId!==row.crmUserId)throw fail();
  const scoped=await authorization.forCompany(user,row.companyId);
  if(draft.originConversationId)await proposalOrigin(user,draft.originConversationId,{...draft,companyId:row.companyId});
  else if(!authorization.canStartConversations(scoped,'META'))throw authorization.forbidden();
  return {...draft,companyId:row.companyId,crmUserId:row.crmUserId};
}
async function review(user,code){
  const draft=await read(user,code),variants=rules.phoneVariants(draft.phone);
  const conversations=await prisma.conversation.findMany({where:{AND:[await authorization.operationalScope(user),{...(draft.originConversationId?{id:draft.originConversationId}:{}),companyId:draft.companyId,channel:'META',contact:{is:{companyId:draft.companyId,OR:[{phone:{in:variants}},{externalId:{in:variants}}]}}}]},orderBy:{updatedAt:'desc'},take:20,select:{id:true,assignedUser:{select:{name:true}},channelAccount:{select:{name:true}}}});
  return {text:draft.text,phone:draft.phone,company:await companies.getCompany(draft.companyId),quoteId:draft.quoteId,conversations};
}
async function validateForMessage(user,code,conversationId){
  const draft=await read(user,code);
  if(draft.originConversationId&&draft.originConversationId!==conversationId)throw fail();
  await authorization.assertCanActOnConversation(user,conversationId);
  const conversation=await prisma.conversation.findUnique({where:{id:conversationId},select:{companyId:true,channel:true,contact:{select:{phone:true}}}});
  const phone=rules.normalizeRecipientPhone(conversation.contact.phone).phone;
  if(conversation.channel!=='META'||conversation.companyId!==draft.companyId||!phone||rules.dedupeKey(phone)!==rules.dedupeKey(draft.phone))throw fail();
  return {quoteId:draft.quoteId,customerId:draft.customerId,crmUserId:draft.crmUserId,draftHash:hash(code),...(draft.originConversationId?{originConversationId:draft.originConversationId,originChannelAccountId:draft.originChannelAccountId}:{})};
}
module.exports={create,read,review,validateForMessage};
