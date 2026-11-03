const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/database/prisma');
const adapters = require('../src/services/channels/channel-message-service');
const { sendApprovedTemplate } = require('../src/services/meta-template-service');

test('envio simulado: template inicia em Atacado, falha não muda categoria e atendimento ativo permanece no setor',async()=>{
  const tag=`commercial-template-${Date.now()}`;
  let account, root, child, contact;
  const originalAdapter=adapters.adapterFor;
  const sent=[];
  let fail=false;
  adapters.adapterFor=async()=>({channel:{listMessageTemplates:async()=>[{name:'teste',language:'pt_BR',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Olá'}]}],sendTemplate:async()=>{if(fail)throw Error('Falha simulada');sent.push(1);return{externalId:`wamid.${tag}.${sent.length}`,data:{}}}}});
  try {
    root=await prisma.category.create({data:{companyId:'cmp_mibro',code:tag,name:'Comercial QA'}});
    child=await prisma.category.create({data:{companyId:'cmp_mibro',code:`${tag}-atacado`,name:'Atacado QA',parentId:root.id}});
    account=await prisma.channelAccount.create({data:{companyId:'cmp_mibro',channel:'META',name:tag,enabled:true,status:'CONNECTED',config:{outboundTemplateCategoryId:child.id,outboundCategoryIds:[child.id]}}});
    contact=await prisma.contact.create({data:{companyId:'cmp_mibro',channel:'META',externalId:tag,phone:'5511000000000'}});
    const c=await prisma.conversation.create({data:{companyId:'cmp_mibro',contactId:contact.id,channel:'META',channelAccountId:account.id,status:'NOVO'}});
    const send=()=>sendApprovedTemplate({conversationId:c.id,name:'teste',language:'pt_BR',requestedAccountId:account.id});
    fail=true;await assert.rejects(send(),/Falha simulada/);
    assert.equal((await prisma.conversation.findUnique({where:{id:c.id}})).categoryId,null);
    assert.equal(await prisma.message.count({where:{conversationId:c.id}}),0);
    fail=false;const result=await send();
    assert.equal((await prisma.conversation.findUnique({where:{id:c.id}})).categoryId,child.id);
    assert.equal(result.message.externalId,`${account.id}:wamid.${tag}.1`);
    await prisma.conversation.update({where:{id:c.id},data:{categoryId:root.id,status:'EM_ATENDIMENTO'}});
    await send();assert.equal((await prisma.conversation.findUnique({where:{id:c.id}})).categoryId,root.id);
    await prisma.conversation.update({where:{id:c.id},data:{status:'FINALIZADO'}});
    await send();assert.equal((await prisma.conversation.findUnique({where:{id:c.id}})).categoryId,child.id);
  } finally {
    adapters.adapterFor=originalAdapter;
    if(contact) await prisma.contact.delete({where:{id:contact.id}});
    if(account) await prisma.channelAccount.delete({where:{id:account.id}});
    if(child) await prisma.category.delete({where:{id:child.id}});
    if(root) await prisma.category.delete({where:{id:root.id}});
    await prisma.$disconnect();
  }
});
