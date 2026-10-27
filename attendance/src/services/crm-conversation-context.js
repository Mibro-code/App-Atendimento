// Read-only bridge. Reuses inbox authorization; never assigns or sends.
function createConversationContext({prisma,authorization,companies,phoneVariants}) {
  const fail=()=>Object.assign(Error('Recurso não encontrado.'),{statusCode:404});
  async function options(user){
    const ids=await companies.accessibleCompanyIds(user);
    return prisma.company.findMany({where:{id:{in:ids},active:true},select:{id:true,name:true,slug:true},orderBy:{displayOrder:'asc'}});
  }
  async function conversation(user,id,forImport=false){
    if(typeof id!=='string'||!id||id.length>128)throw fail();
    if(forImport)await authorization.assertCanActOnConversation(user,id);
    const row=await prisma.conversation.findFirst({where:{AND:[{id,channel:'META'},await authorization.conversationScope(user)]},select:{id:true,contactId:true,company:{select:{id:true,name:true,slug:true}},contact:{select:{phone:true,externalId:true,name:true,customName:true}}}});
    if(!row)throw fail();
    return {id:row.id,contactId:row.contactId,company:row.company,name:row.contact.customName||row.contact.name||'',phones:phoneVariants(row.contact.phone||row.contact.externalId)};
  }
  async function conversations(user,companyId,phones,contactIds=[]){
    if(typeof companyId!=='string'||!(await companies.accessibleCompanyIds(user)).includes(companyId))throw fail();
    if(!Array.isArray(contactIds)||contactIds.length>20||contactIds.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id)))throw fail();
    if(!Array.isArray(phones)||(!phones.length&&!contactIds.length)||phones.length>3||phones.some(p=>typeof p!=='string'||!/^\d{10,15}$/.test(p)))throw fail();
    const variants=[...new Set(phones.flatMap(phoneVariants))];
    return prisma.conversation.findMany({where:{AND:[await authorization.conversationScope(user),{companyId,channel:'META',contact:{is:{companyId,OR:[{phone:{in:variants}},{externalId:{in:variants}},...(contactIds.length?[{id:{in:contactIds}}]:[])]}}}]},select:{id:true,status:true,assignedUser:{select:{name:true}},channelAccount:{select:{name:true}},updatedAt:true},orderBy:[{updatedAt:'desc'},{id:'desc'}],take:20});
  }
  return {options,conversation,conversations};
}
module.exports={createConversationContext};
