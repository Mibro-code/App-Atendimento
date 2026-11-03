const test=require('node:test'),assert=require('node:assert/strict');
const {database,seed}=require('./local-fixtures.cjs');
process.env.DATABASE_URL=database('attendance');process.env.NODE_ENV='test';
const prisma=require('./attendance/src/database/prisma');
const {seedContacts,phones}=require('./crm-contact-fixtures.cjs');
const service=require('./attendance/src/services/crm-contact-service');
const auth=require('./attendance/src/services/auth-service');
let owner;
test.before(async()=>{await seed();await seedContacts();owner=auth.publicUser(await prisma.user.findUnique({where:{id:'merge-local-owner-a'}}));await prisma.campaign.deleteMany({where:{name:{startsWith:'Teste CRM contacts'},createdByUserId:owner.id}});});
test.after(()=>prisma.$disconnect());
test('same phone has independent Mibro and Sincrofit history, with actual author and sender',async()=>{
 const input=[{id:'crm-fixture-sent',phone:phones.sent}];
 const [m]=await service.history(owner,'cmp_mibro',input),[s]=await service.history(owner,'cmp_sincrofit',input);
 assert.equal(m.hasSent,true);assert.equal(m.lastStatus,'ENTREGUE');assert.equal(m.senderName,'WhatsApp Mibro (teste)');assert.equal(m.senderPhone,'+55 11 90000-1001');assert.equal(m.agentName,'Administrador — prévia local');
 assert.equal(s.hasSent,false);assert.equal(s.lastStatus,'FALHOU');assert.equal(s.senderName,'WhatsApp Sincrofit (teste)');
});
test('opt-out is company scoped and missing history is not a proof of never contacted',async()=>{
 const [m]=await service.history(owner,'cmp_mibro',[{id:'crm-fixture-optout',phone:phones.optOut}]);
 const [s]=await service.history(owner,'cmp_sincrofit',[{id:'crm-fixture-optout',phone:phones.optOut}]);
 assert.equal(m.optedOut,true);assert.equal(s.optedOut,false);assert.equal(m.coverage,'VISIBLE_WHATSAPP_ONLY');assert.equal(m.hasSent,false);
});
test('selection deduplicates phone, keeps both CRM IDs and binds user/company/expiry',async()=>{
 const draft=await service.createSelection(owner,'merge-local-owner-c',{companyId:'cmp_mibro',recipients:[{id:'crm-fixture-new',phone:phones.fresh,name:'Novo'},{id:'crm-fixture-duplicate',phone:phones.fresh,name:'Duplicado'}]});
 assert.equal(draft.valid,1);assert.equal(draft.duplicates,1);
 const row=await service.readSelection(owner,draft.code,'cmp_mibro');assert.equal(row.recipients[0].crmCustomerIds.length,2);
 await assert.rejects(service.readSelection({...owner,id:'other'},draft.code));await assert.rejects(service.readSelection(owner,draft.code,'cmp_sincrofit'));
 await prisma.crmContactSelection.update({where:{codeHash:row.codeHash},data:{expiresAt:new Date(0)}});await assert.rejects(service.readSelection(owner,draft.code));
});
test('attendance agent without campaign permission cannot list history or prepare a draft',async()=>{
 const agent=auth.publicUser(await prisma.user.findUnique({where:{id:'merge-local-a'}}));
 await assert.rejects(service.history(agent,'cmp_mibro',[{id:'x',phone:phones.sent}]),{statusCode:403});
 await assert.rejects(service.createSelection(agent,'merge-local-c',{companyId:'cmp_mibro',recipients:[{id:'x',phone:phones.fresh}]}),{statusCode:403});
});
test('private segments stay hidden even for own messages; never return message content',async()=>{
 const phone='5511932109876',categoryId='crm-fixture-private';
 await prisma.category.upsert({where:{id:categoryId},create:{id:categoryId,companyId:'cmp_mibro',code:'CRM_LOCAL_PRIVATE',name:'Privado (teste)',visibilityMode:'SECTOR_PRIVATE'},update:{}});
 await prisma.contact.upsert({where:{id:'crm-fixture-private-contact'},create:{id:'crm-fixture-private-contact',companyId:'cmp_mibro',channel:'META',externalId:phone,phone},update:{}});
 await prisma.conversation.upsert({where:{id:'crm-fixture-private-conv'},create:{id:'crm-fixture-private-conv',companyId:'cmp_mibro',contactId:'crm-fixture-private-contact',categoryId,assignedUserId:'merge-local-a'},update:{}});
 await prisma.message.upsert({where:{id:'crm-fixture-private-msg'},create:{id:'crm-fixture-private-msg',conversationId:'crm-fixture-private-conv',channel:'META',direction:'ENVIADA',status:'ENTREGUE',type:'text',text:'PRIVATE_CONTENT_MUST_NOT_LEAK',occurredAt:new Date(),sentByUserId:'merge-local-a',privateCategoryId:categoryId},update:{}});
 const agent=auth.publicUser({...await prisma.user.findUnique({where:{id:'merge-local-a'}}),canManageCampaigns:true});
 const [hidden]=await service.history(agent,'cmp_mibro',[{id:'private',phone}]);assert.equal(hidden.hasSent,false);assert.equal(hidden.lastStatus,null);
 const [master]=await service.history(owner,'cmp_mibro',[{id:'private',phone}]);assert.equal(master.hasSent,true);assert.equal(JSON.stringify(master).includes('PRIVATE_CONTENT_MUST_NOT_LEAK'),false);
});
test('later failed attempt does not replace true sent date or invent its sender number',async()=>{
 await prisma.message.upsert({where:{id:'crm-fixture-later-failure'},create:{id:'crm-fixture-later-failure',conversationId:'crm-fixture-conv-mibro',channel:'META',direction:'ENVIADA',status:'FALHOU',type:'text',occurredAt:new Date('2026-10-20T09:00:00Z'),sentByUserId:owner.id},update:{}});
 try{const [tracked]=await service.history(owner,'cmp_mibro',[{id:'crm-fixture-sent',phone:phones.sent}]);assert.equal(tracked.hasSent,true);assert.equal(tracked.lastStatus,'FALHOU');assert.equal(tracked.senderName,'Número não registrado');assert.equal(new Date(tracked.lastSentAt).toISOString(),'2026-10-19T12:00:00.000Z');}
 finally{await prisma.message.delete({where:{id:'crm-fixture-later-failure'}});}
});
test('bulk handoff revalidates prior sends and company, persists CRM IDs and never calls provider send',async()=>{
 const templates=require('./attendance/src/services/meta-template-service');templates.listApprovedTemplates=async()=>[{name:'local_crm_template',language:'pt_BR',category:'MARKETING',status:'APPROVED',variables:[],supported:true}];
 let sends=0;require('./attendance/src/services/channels/channel-message-service').adapterFor=async()=>({channel:{sendTemplate:async()=>{sends++;throw Error('Real sending disabled');}}});
 const bulk=require('./attendance/src/services/outbound-bulk-service');
 const draft=await service.createSelection(owner,'merge-local-owner-c',{companyId:'cmp_mibro',recipients:[{id:'crm-fixture-new',phone:phones.fresh,name:'Novo'},{id:'crm-fixture-sent',phone:phones.sent,name:'Já contatado'}]});
 const payload={name:'Teste CRM contacts '+Date.now(),accountId:'crm-fixture-account-mibro',crmSelection:draft.code,defaultTemplate:{name:'local_crm_template',language:'pt_BR'},recipients:[{name:'Novo',phone:phones.fresh},{name:'Já contatado',phone:phones.sent}],idempotencyKey:require('./attendance/src/services/central-identity-crypto').opaque()};
 const preview=await bulk.previewBulkSend(owner,payload,{});assert.equal(preview.summary.ready,1);assert.ok(preview.recipients[1].issues.includes('CRM_PREVIOUSLY_SENT'));
 await assert.rejects(bulk.previewBulkSend(owner,{...payload,accountId:'crm-fixture-account-sincro'},{}));
 const created=await bulk.createBulkSend(owner,{...payload,confirmedCount:1},{});assert.equal(created.queued,1);
 const entries=await prisma.campaignContact.findMany({where:{campaignId:created.campaignId}});assert.deepEqual(entries[0].crmCustomerIds,['crm-fixture-new']);
 const retry=await bulk.createBulkSend(owner,payload,{});assert.equal(retry.campaignId,created.campaignId);assert.equal(retry.duplicateRequest,true);
 await assert.rejects(bulk.createBulkSend(owner,{...payload,idempotencyKey:require('./attendance/src/services/central-identity-crypto').opaque()},{}));
 const [tracked]=await service.history(owner,'cmp_mibro',[{id:'crm-fixture-new',phone:phones.fresh}]);assert.equal(tracked.queued,true);assert.equal(tracked.hasSent,false);assert.equal(sends,0);
});
test('resend override permits previous sent message but never silently requeues a pending contact',async()=>{
 const bulk=require('./attendance/src/services/outbound-bulk-service');
 for(const [phone,id,expected]of [[phones.sent,'crm-fixture-sent',true],[phones.fresh,'crm-fixture-new',false]]){
  const selection=await service.createSelection(owner,'merge-local-owner-c',{companyId:'cmp_mibro',skipSent:false,recipients:[{id,phone,name:'Revisão de reenvio'}]});
  const preview=await bulk.previewBulkSend(owner,{accountId:'crm-fixture-account-mibro',crmSelection:selection.code,defaultTemplate:{name:'local_crm_template',language:'pt_BR'},recipients:[{name:'Revisão de reenvio',phone}]},{});
  assert.equal(preview.recipients[0].ok,expected);if(!expected)assert.ok(preview.recipients[0].issues.includes('CRM_ALREADY_QUEUED'));
 }
});
