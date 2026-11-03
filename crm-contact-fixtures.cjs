const {client}=require('./local-fixtures.cjs');
const phones={fresh:'5511988765432',sent:'5511976543210',optOut:'5511965432109',outside:'5511954321098'};
async function seedContacts(){
 const a=client('attendance'),c=client('crm');
 try{
  await a.channelAccount.updateMany({where:{id:'chacc_mibro_whatsapp'},data:{enabled:false,status:'NOT_CONFIGURED'}});
  await a.campaign.deleteMany({where:{name:{startsWith:'Teste CRM contacts'},createdByUserId:'merge-local-owner-a'}});
  const rows=[['crm-fixture-new','Cliente Novo (teste)',phones.fresh,'merge-local-owner-c'],['crm-fixture-duplicate','Mesmo telefone (teste)',phones.fresh,'merge-local-owner-c'],['crm-fixture-sent','Cliente com envio (teste)',phones.sent,'merge-local-owner-c'],['crm-fixture-optout','Contato com opt-out (teste)',phones.optOut,'merge-local-owner-c'],['crm-fixture-outside','Outra carteira (teste)',phones.outside,'merge-local-crm-only'],['crm-fixture-owned-c','Carteira do usuário vinculado (teste)','5511943210987','merge-local-c']];
  for(const [id,contactName,phoneDigits,sellerId]of rows)await c.customer.upsert({where:{id},create:{id,contactName,phoneDigits,sellerId,city:'São Paulo',state:'SP'},update:{contactName,phoneDigits,sellerId}});
  for(const [companyId,suffix,name,displayPhoneNumber]of [['cmp_mibro','mibro','WhatsApp Mibro (teste)','+55 11 90000-1001'],['cmp_sincrofit','sincro','WhatsApp Sincrofit (teste)','+55 11 90000-2002']]){
   const accountId=`crm-fixture-account-${suffix}`;
   await a.channelAccount.upsert({where:{id:accountId},create:{id:accountId,companyId,channel:'META',name,status:'CONNECTED',enabled:true,config:{phoneNumberId:`LOCAL_${suffix}`,wabaId:`LOCAL_WABA_${suffix}`,displayPhoneNumber}},update:{}});
   const contactId=`crm-fixture-contact-${suffix}`,conversationId=`crm-fixture-conv-${suffix}`;
   await a.contact.upsert({where:{id:contactId},create:{id:contactId,companyId,channel:'META',externalId:phones.sent,phone:phones.sent,name:'Cliente com envio (teste)'},update:{}});
   await a.conversation.upsert({where:{id:conversationId},create:{id:conversationId,companyId,contactId,channel:'META',channelAccountId:accountId,channelScope:accountId},update:{}});
   const messageId=`crm-fixture-msg-${suffix}`;
   await a.message.upsert({where:{id:messageId},create:{id:messageId,conversationId,channel:'META',channelAccountId:accountId,direction:'ENVIADA',status:suffix==='mibro'?'ENTREGUE':'FALHOU',type:'text',text:'Mensagem fictícia, não enviada pela Meta.',occurredAt:new Date('2026-10-19T12:00:00Z'),sentByUserId:'merge-local-owner-a'},update:{status:suffix==='mibro'?'ENTREGUE':'FALHOU'}});
  }
  await a.optOut.upsert({where:{companyId_phone:{companyId:'cmp_mibro',phone:phones.optOut}},create:{companyId:'cmp_mibro',phone:phones.optOut,source:'LOCAL_TEST'},update:{removedAt:null}});
 }finally{await Promise.all([a.$disconnect(),c.$disconnect()]);}
}
module.exports={seedContacts,phones};
