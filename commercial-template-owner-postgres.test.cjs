const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {client}=require('./commercial-owner-local-db.cjs');
const {fixOwnerAfterTemplate,clearOwnerOnCategoryTransfer,COMMERCIAL_ACCOUNT_ID:A}=require('./attendance/src/services/commercial-template-owner-service');
const p=client();after(()=>p.$disconnect());
const prefix='commercial-owner-local-'+Date.now();let counter=0;
async function fixture(){
 await p.company.upsert({where:{id:'cmp_mibro'},create:{id:'cmp_mibro',name:'Mibro — testes locais',slug:'mibro',displayName:'MIBRO',primaryColor:'#ed5c22'},update:{}});
 for(const [id,role]of [['merge-local-owner-a','ADMIN'],['merge-local-a','ATENDENTE']])await p.user.upsert({where:{id},create:{id,name:'Usuário fictício '+id,email:id+'@commercial-local.invalid',role},update:{}});
 const id=prefix+'-'+(++counter);
 const account=await p.channelAccount.findUnique({where:{id:A},select:{name:true}});
 if(account&&account.name!=='Comercial — teste local')throw Error('Unexpected local account fixture');
 if(!account)await p.channelAccount.create({data:{id:A,companyId:'cmp_mibro',name:'Comercial — teste local',channel:'META',externalAccountId:'LOCAL_ONLY_COMMERCIAL',enabled:true,status:'CONNECTED'}});
 await p.contact.create({data:{id,companyId:'cmp_mibro',channel:'META',externalId:id,phone:'5511900000000',name:'Contato fictício comercial'}});
 await p.conversation.create({data:{id,companyId:'cmp_mibro',contactId:id,channel:'META',channelAccountId:A,assignedUserId:'merge-local-a',status:'AGUARDANDO_CLIENTE'}});
 const message=await p.message.create({data:{conversationId:id,channelAccountId:A,direction:'ENVIADA',status:'ENVIADA',type:'template',text:'Template simulado; sem envio',occurredAt:new Date(),sentByUserId:'merge-local-owner-a'}});
 return {id,message,run:()=>fixOwnerAfterTemplate({messageId:message.id,channelAccountId:A,sentByUserId:'merge-local-owner-a'},p)};
}
test('PostgreSQL: accepted template fixes only contact owner, not active assignee',async()=>{const f=await fixture();assert.equal((await f.run()).applied,true);const contact=await p.contact.findUnique({where:{id:f.id}});assert.equal(contact.preferredAssigneeId,'merge-local-owner-a');assert.equal(contact.preferredAssigneeEnabled,true);const conversation=await p.conversation.findUnique({where:{id:f.id}});assert.equal(conversation.assignedUserId,'merge-local-a');assert.equal(conversation.status,'AGUARDANDO_CLIENTE');assert.equal((await f.run()).reason,'EXISTING_OR_MANUAL_LINK');assert.equal(await p.auditLog.count({where:{entityId:f.id,action:'PREFERRED_ASSIGNEE_SET'}}),1);});
test('PostgreSQL: two simultaneous template callbacks produce one fixed link and one audit',async()=>{const f=await fixture();const results=await Promise.all([f.run(),f.run()]);assert.equal(results.filter(r=>r.applied).length,1);assert.equal(await p.auditLog.count({where:{entityId:f.id,action:'PREFERRED_ASSIGNEE_SET'}}),1);});
test('PostgreSQL: explicit manual removal prevents automatic relinking',async()=>{const f=await fixture();await p.contact.update({where:{id:f.id},data:{preferredAssigneeId:null,preferredAssigneeEnabled:false,preferredAssigneeSetAt:new Date(),preferredAssigneeSetById:'merge-local-owner-a'}});assert.equal((await f.run()).applied,false);assert.equal(await p.auditLog.count({where:{entityId:f.id,action:'PREFERRED_ASSIGNEE_SET'}}),0);});
test('PostgreSQL: actual authorized category transfer clears automatic fixed owner atomically',async()=>{
 const f=await fixture();await f.run();
 const category=await p.category.create({data:{companyId:'cmp_mibro',code:f.id,name:'Suporte — teste local'}});
 process.env.DATABASE_URL=require('./commercial-owner-local-db.cjs').url;
 const inbox=require('./attendance/src/services/inbox-service'),actor=await p.user.findUnique({where:{id:'merge-local-owner-a'}});
 const result=await inbox.updateConversation(f.id,{categoryId:category.id},actor);
 assert.equal(result.categoryId,category.id);assert.equal(result.contact.preferredAssigneeId,null);assert.equal(result.contact.preferredAssigneeEnabled,false);
 assert.equal((await p.contact.findUnique({where:{id:f.id}})).preferredAssigneeId,null);
 assert.equal(await p.auditLog.count({where:{entityId:f.id,action:'PREFERRED_ASSIGNEE_REMOVED'}}),1);
 assert.equal((await f.run()).reason,'TEMPLATE_PRECEDES_TRANSFER');
 await require('./attendance/src/database/prisma').$disconnect();
});
test('PostgreSQL: failed category transfer rolls back category and owner cancellation together',async()=>{
 const f=await fixture();await f.run();const before=await p.conversation.findUnique({where:{id:f.id}});
 const category=await p.category.create({data:{companyId:'cmp_mibro',code:f.id,name:'Destino fictício'}});
 await assert.rejects(p.$transaction(async tx=>{const after=await tx.conversation.update({where:{id:f.id},data:{categoryId:category.id}});assert.equal((await clearOwnerOnCategoryTransfer(tx,{before,after,actor:{id:'merge-local-owner-a',role:'ADMIN'}})).cleared,true);throw Error('rollback-test');}),/rollback-test/);
 assert.equal((await p.conversation.findUnique({where:{id:f.id}})).categoryId,before.categoryId);
 assert.equal((await p.contact.findUnique({where:{id:f.id}})).preferredAssigneeId,'merge-local-owner-a');assert.equal(await p.auditLog.count({where:{entityId:f.id,action:'PREFERRED_ASSIGNEE_REMOVED'}}),0);
});
test('PostgreSQL: a later manual owner definition survives a category transfer',async()=>{
 const f=await fixture();await f.run();const before=await p.conversation.findUnique({where:{id:f.id}}),category=await p.category.create({data:{companyId:'cmp_mibro',code:f.id,name:'Outro setor fictício'}});
 await p.auditLog.create({data:{entityType:'CONTACT',entityId:f.id,companyId:'cmp_mibro',action:'PREFERRED_ASSIGNEE_CHANGED',summary:'Definição manual simulada',details:{newAssigneeId:'merge-local-owner-a'}}});
 await p.$transaction(async tx=>{const after=await tx.conversation.update({where:{id:f.id},data:{categoryId:category.id}});assert.equal((await clearOwnerOnCategoryTransfer(tx,{before,after,actor:{id:'merge-local-owner-a',role:'ADMIN'}})).cleared,false);});assert.equal((await p.contact.findUnique({where:{id:f.id}})).preferredAssigneeId,'merge-local-owner-a');
});

test('PostgreSQL: authorized person transfer clears fixed ownership and keeps the target assignee',async()=>{
 const f=await fixture();await f.run();
 process.env.DATABASE_URL=require('./commercial-owner-local-db.cjs').url;
 const inbox=require('./attendance/src/services/inbox-service'),actor=await p.user.findUnique({where:{id:'merge-local-owner-a'}});
 const result=await inbox.updateConversation(f.id,{assignedUserId:actor.id,status:'AGUARDANDO_CLIENTE'},actor);
 assert.equal(result.assignedUserId,actor.id);assert.equal(result.status,'AGUARDANDO_CLIENTE');assert.equal(result.contact.preferredAssigneeId,null);assert.equal(result.contact.preferredAssigneeEnabled,false);
 const audit=await p.auditLog.findFirst({where:{entityId:f.id,action:'PREFERRED_ASSIGNEE_REMOVED'}});assert.equal(audit.details.source,'COMMERCIAL_TEMPLATE_PERSON_TRANSFER');
 assert.equal((await f.run()).reason,'TEMPLATE_PRECEDES_TRANSFER');
 await require('./attendance/src/database/prisma').$disconnect();
});
test('PostgreSQL: failure rolls back person transfer and fixed-owner removal together',async()=>{
 const f=await fixture();await f.run();const before=await p.conversation.findUnique({where:{id:f.id}});
 await assert.rejects(p.$transaction(async tx=>{const after=await tx.conversation.update({where:{id:f.id},data:{assignedUserId:'merge-local-owner-a'}});assert.equal((await clearOwnerOnCategoryTransfer(tx,{before,after,actor:{id:'merge-local-owner-a',role:'ADMIN'}})).cleared,true);throw Error('rollback-person-transfer');}),/rollback-person-transfer/);
 assert.equal((await p.conversation.findUnique({where:{id:f.id}})).assignedUserId,before.assignedUserId);assert.equal((await p.contact.findUnique({where:{id:f.id}})).preferredAssigneeEnabled,true);
 assert.equal(await p.auditLog.count({where:{entityId:f.id,action:'PREFERRED_ASSIGNEE_REMOVED'}}),0);
});
