const prisma=require('../database/prisma');
const companies=require('./company-service');
const authorization=require('./authorization-service');
const rules=require('./bulk-send-rules');
const invalid=()=>Object.assign(Error('Consulta de contato inválida.'),{statusCode:400});
// Deliberately narrow cross-company signal authorized for duplicate outreach.
// Never return source conversation, message, agent, template, timestamp or account.
function createWarnings({db=prisma,companyService=companies,auth=authorization}={}){
  async function check(user,companyId,values,{replyAllowed=false}={}){
    if(typeof companyId!=='string'||!companyId||!Array.isArray(values)||values.length>500)throw invalid();
    const scoped=await auth.forCompany(user,companyId);
    // replyAllowed is set only by the server after assertCanActOnConversation;
    // agents who may reply need not have permission to start NEW conversations.
    if(!replyAllowed&&!auth.canStartConversations(scoped,'META')&&!auth.canManageCampaigns(scoped))throw auth.forbidden();
    const phones=values.map(value=>typeof value==='string'?rules.normalizeRecipientPhone(value).phone:null);
    const variants=[...new Set(phones.filter(Boolean).flatMap(rules.phoneVariants))];
    if(!variants.length)return phones.map(phone=>({phone,contactedElsewhere:false,companies:[],restrictedCompany:false}));
    const [contacts,batches,visible]=await Promise.all([
      db.contact.findMany({where:{companyId:{not:companyId},channel:'META',OR:[{phone:{in:variants}},{externalId:{in:variants}}],conversations:{some:{companyId:{not:companyId},channel:'META',messages:{some:{direction:'ENVIADA',status:{in:['ENVIADA','ENTREGUE','LIDA']}}}}}},select:{phone:true,externalId:true,companyId:true}}),
      db.campaignContact.findMany({where:{phone:{in:variants},isTest:false,status:{in:['SENT','DELIVERED','READ','REPLIED']},campaign:{companyId:{not:companyId},channel:'META'}},distinct:['phone','campaignId'],select:{phone:true,campaign:{select:{companyId:true}}}}),
      companyService.accessibleCompanyIds(user)
    ]);
    const byPhone=new Map();
    for(const row of [...contacts.map(c=>({phone:c.phone||c.externalId,companyId:c.companyId})),...batches.map(c=>({phone:c.phone,companyId:c.campaign.companyId}))]){
      const phone=rules.normalizeRecipientPhone(row.phone).phone;if(!phone)continue;
      const key=rules.dedupeKey(phone);if(!byPhone.has(key))byPhone.set(key,new Set());byPhone.get(key).add(row.companyId);
    }
    const namedIds=[...new Set([...byPhone.values()].flatMap(ids=>[...ids].filter(id=>visible.includes(id))))];
    const named=namedIds.length?await db.company.findMany({where:{id:{in:namedIds}},select:{id:true,name:true}}):[];
    const names=new Map(named.map(row=>[row.id,row.name]));
    return phones.map(phone=>{
      const ids=phone?[...(byPhone.get(rules.dedupeKey(phone))||[])]:[];
      return {phone,contactedElsewhere:ids.length>0,companies:ids.filter(id=>names.has(id)).map(id=>names.get(id)),restrictedCompany:ids.some(id=>!names.has(id))};
    });
  }
  return {check};
}
module.exports={createWarnings,...createWarnings()};
