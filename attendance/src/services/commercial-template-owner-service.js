// Only the verified Mibro Comercial account. Never infer this from a label,
// a template category, a CRM interest, or the currently assigned attendant.
const COMMERCIAL_ACCOUNT_ID='cmu17d9o8028hqi0kvr1pdci7';
const COMMERCIAL_COMPANY_ID='cmp_mibro';
function eligibleUserWhere(id){return {id,active:true,role:{not:'BOT'},OR:[{role:'ADMIN'},{companyAccess:{some:{companyId:COMMERCIAL_COMPANY_ID,active:true}},channelAccountAccess:{some:{channelAccountId:COMMERCIAL_ACCOUNT_ID}}}]};}
async function fixOwnerAfterTemplate({messageId,channelAccountId,sentByUserId,categoryIdAtSend},client=require('../database/prisma')){
  if(channelAccountId!==COMMERCIAL_ACCOUNT_ID||!sentByUserId||!messageId)return {applied:false,reason:'NOT_COMMERCIAL_HUMAN_TEMPLATE'};
  return client.$transaction(async tx=>{
    const message=await tx.message.findUnique({where:{id:messageId},select:{id:true,type:true,direction:true,status:true,channelAccountId:true,sentByUserId:true,conversationId:true,occurredAt:true}});
    if(!message||message.type!=='template'||message.direction!=='ENVIADA'||!['ENVIADA','ENTREGUE','LIDA'].includes(message.status)||message.channelAccountId!==COMMERCIAL_ACCOUNT_ID||message.sentByUserId!==sentByUserId)return {applied:false,reason:'NO_ACCEPTED_TEMPLATE'};
    // Same lock ordering as manual transfer: a late send callback cannot
    // recreate a link after a category transfer has already cancelled it.
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id=${message.conversationId} FOR UPDATE`;
    const current=await tx.conversation.findUnique({where:{id:message.conversationId},include:{contact:true}});
    const contact=current?.contact;
    if(!current||current.channel!=='META'||current.companyId!==COMMERCIAL_COMPANY_ID||contact?.companyId!==COMMERCIAL_COMPANY_ID||contact.whatsappInboxId&&contact.whatsappInboxId!==current.id)return {applied:false,reason:'SCOPE_CHANGED'};
    if(categoryIdAtSend!==undefined&&current.categoryId!==categoryIdAtSend)return {applied:false,reason:'CATEGORY_CHANGED_SINCE_TEMPLATE'};
    if(contact.preferredAssigneeId||contact.preferredAssigneeEnabled)return {applied:false,reason:'EXISTING_OR_MANUAL_LINK'};
    const history=await tx.auditLog.findFirst({where:{entityType:'CONTACT',entityId:contact.id,action:{startsWith:'PREFERRED_ASSIGNEE_'}},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,action:true,details:true,createdAt:true}});
    const automaticReset=history?.action==='PREFERRED_ASSIGNEE_REMOVED'&&['COMMERCIAL_TEMPLATE_CATEGORY_TRANSFER','COMMERCIAL_TEMPLATE_PERSON_TRANSFER'].includes(history.details?.source)&&history.details.channelAccountId===COMMERCIAL_ACCOUNT_ID;
    if(!automaticReset&&(history||contact.preferredAssigneeSetAt||contact.preferredAssigneeSetById))return {applied:false,reason:'MANUAL_HISTORY'};
    if(automaticReset&&(!contact.preferredAssigneeSetAt||!message.occurredAt||new Date(message.occurredAt)<=new Date(contact.preferredAssigneeSetAt)))return {applied:false,reason:'TEMPLATE_PRECEDES_TRANSFER'};
    const owner=await tx.user.findFirst({where:eligibleUserWhere(sentByUserId),select:{id:true,name:true}});
    if(!owner)return {applied:false,reason:'INELIGIBLE_AUTHOR'};
    const account=await tx.channelAccount.findFirst({where:{id:COMMERCIAL_ACCOUNT_ID,companyId:COMMERCIAL_COMPANY_ID,channel:'META',enabled:true,status:'CONNECTED'},select:{id:true}});
    if(!account)return {applied:false,reason:'COMMERCIAL_UNAVAILABLE'};
    const currentAccount=contact.whatsappInboxId?(await require('./whatsapp-inbox-service').senderState(current,null,tx)).account?.id:current.channelAccountId;
    if(currentAccount!==COMMERCIAL_ACCOUNT_ID)return {applied:false,reason:'LEFT_COMMERCIAL'};
    const occurredAt=new Date();
    const changed=await tx.contact.updateMany({
      where:{id:contact.id,companyId:COMMERCIAL_COMPANY_ID,updatedAt:contact.updatedAt,preferredAssigneeId:null,preferredAssigneeEnabled:false,preferredAssigneeSetAt:contact.preferredAssigneeSetAt,preferredAssigneeSetById:contact.preferredAssigneeSetById,conversations:{some:{id:current.id,companyId:COMMERCIAL_COMPANY_ID,categoryId:current.categoryId,channelAccountId:current.channelAccountId}}},
      data:{preferredAssigneeId:owner.id,preferredAssigneeEnabled:true,preferredAssigneeSetAt:occurredAt,preferredAssigneeSetById:owner.id},
    });
    if(!changed.count)return {applied:false,reason:'CONCURRENT_CHANGE'};
    await tx.auditLog.create({data:{actorUserId:owner.id,actorName:owner.name,companyId:COMMERCIAL_COMPANY_ID,entityType:'CONTACT',entityId:contact.id,action:'PREFERRED_ASSIGNEE_SET',summary:'Atendente fixo definido pelo template no número Comercial: '+owner.name,details:{source:'COMMERCIAL_TEMPLATE_SEND',channelAccountId:COMMERCIAL_ACCOUNT_ID,messageId:message.id,conversationId:current.id,previousAssigneeId:null,previousEnabled:false,newAssigneeId:owner.id,newAssignee:owner.name,enabled:true}}});
    return {applied:true,ownerId:owner.id};
  });
}

// Called only from the authorized manual update path, inside the transfer
// transaction. Initial template classification and bots do not call it.
async function clearOwnerOnCategoryTransfer(tx,{before,after,actor}){
  if(!actor?.id||actor.role==='BOT'||before.channel!=='META'||before.companyId!==COMMERCIAL_COMPANY_ID||after.companyId!==COMMERCIAL_COMPANY_ID)return {cleared:false};
  const categoryChanged=before.categoryId!==after.categoryId;
  const personChanged=Boolean(after.assignedUserId&&before.assignedUserId!==after.assignedUserId);
  if(!categoryChanged&&!personChanged)return {cleared:false};
  const contact=await tx.contact.findUnique({where:{id:after.contactId}});
  if(!contact?.preferredAssigneeId||!contact.preferredAssigneeEnabled||contact.companyId!==COMMERCIAL_COMPANY_ID||(contact.whatsappInboxId&&contact.whatsappInboxId!==after.id))return {cleared:false};
  if(!categoryChanged){
    // Claiming one's own fixed customer from the free queue is not a transfer.
    if(!before.assignedUserId&&after.assignedUserId===contact.preferredAssigneeId)return {cleared:false};
    const currentAccount=contact.whatsappInboxId?(await require('./whatsapp-inbox-service').senderState(before,null,tx)).account?.id:before.channelAccountId;
    if(currentAccount!==COMMERCIAL_ACCOUNT_ID)return {cleared:false};
  }
  const latest=await tx.auditLog.findFirst({where:{entityType:'CONTACT',entityId:contact.id,action:{startsWith:'PREFERRED_ASSIGNEE_'}},orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,action:true,details:true}});
  if(latest?.action!=='PREFERRED_ASSIGNEE_SET'||!['COMMERCIAL_TEMPLATE_SEND','COMMERCIAL_TEMPLATE_BACKFILL'].includes(latest.details?.source)||latest.details.channelAccountId!==COMMERCIAL_ACCOUNT_ID||latest.details.newAssigneeId!==contact.preferredAssigneeId)return {cleared:false};
  const data={preferredAssigneeId:null,preferredAssigneeEnabled:false,preferredAssigneeSetAt:new Date(),preferredAssigneeSetById:actor.id};
  const result=await tx.contact.updateMany({where:{id:contact.id,companyId:COMMERCIAL_COMPANY_ID,updatedAt:contact.updatedAt,preferredAssigneeId:contact.preferredAssigneeId,preferredAssigneeEnabled:true,preferredAssigneeSetAt:contact.preferredAssigneeSetAt,preferredAssigneeSetById:contact.preferredAssigneeSetById},data});
  if(!result.count)return {cleared:false};
  await tx.auditLog.create({data:{actorUserId:actor.id,actorName:actor.name||null,companyId:COMMERCIAL_COMPANY_ID,entityType:'CONTACT',entityId:contact.id,action:'PREFERRED_ASSIGNEE_REMOVED',summary:'Vínculo automático do Comercial removido por transferência de '+(categoryChanged?'categoria':'atendente'),details:{source:categoryChanged?'COMMERCIAL_TEMPLATE_CATEGORY_TRANSFER':'COMMERCIAL_TEMPLATE_PERSON_TRANSFER',channelAccountId:COMMERCIAL_ACCOUNT_ID,conversationId:after.id,fromCategoryId:before.categoryId,toCategoryId:after.categoryId,fromUserId:before.assignedUserId||null,toUserId:after.assignedUserId||null,previousAssigneeId:contact.preferredAssigneeId,previousEnabled:true,newAssigneeId:null,enabled:false,originalLinkAuditId:latest.id}}});
  return {cleared:true,contactPatch:data};
}
module.exports={COMMERCIAL_ACCOUNT_ID,COMMERCIAL_COMPANY_ID,eligibleUserWhere,fixOwnerAfterTemplate,clearOwnerOnCategoryTransfer};
