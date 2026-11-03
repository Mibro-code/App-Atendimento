const {test}=require('node:test'),assert=require('node:assert/strict');
const {database,seed}=require('./local-fixtures.cjs');
process.env.DATABASE_URL=database('attendance');process.env.NODE_ENV='test';require('./local-network-guard.cjs');
const prisma=require('./attendance/src/database/prisma'),auth=require('./attendance/src/services/auth-service'),proposal=require('./attendance/src/services/crm-proposal-service');
let user;
test.before(async()=>{
 await seed();
 // Remove only our earlier mock-provider fixtures from the shared sample;
 // the test database URL is fixed to the disposable loopback schema above.
 await prisma.message.deleteMany({where:{conversationId:'crm-fixture-conv-mibro',externalId:{startsWith:'local-summary-'},OR:[{rawPayload:{path:['providerMessage','localMock'],equals:true}},{rawPayload:{path:['localMock'],equals:true}}]}});
 user=auth.publicUser(await prisma.user.findUnique({where:{id:'merge-local-owner-a'}}));
});
test.after(()=>prisma.$disconnect());
test('proposal handoff is user-bound, company-bound, expiring and cannot be used as bulk selection',async()=>{
 const {code}=await proposal.create(user,'merge-local-owner-c',{brand:'MIBRO',quoteId:'operations-proposal',customerId:'crm-fixture-sent',phone:'11976543210',text:'Resumo fictício, sem envio externo'});
 const row=await proposal.read(user,code);assert.equal(row.companyId,'cmp_mibro');assert.equal(row.purpose,'PROPOSAL_DRAFT');
 await assert.rejects(proposal.read({...user,id:'other'},code),{statusCode:404});
 await assert.rejects(require('./attendance/src/services/crm-contact-service').readSelection(user,code),{statusCode:404});
 await assert.rejects(proposal.validateForMessage(user,code,'crm-fixture-conv-sincro'),{statusCode:404});
 const metadata=await proposal.validateForMessage(user,code,'crm-fixture-conv-mibro');assert.equal(metadata.quoteId,'operations-proposal');assert.equal(metadata.customerId,'crm-fixture-sent');
 await prisma.crmContactSelection.update({where:{codeHash:require('./attendance/src/services/central-identity-crypto').hash(code)},data:{expiresAt:new Date(0)}});await assert.rejects(proposal.read(user,code),{statusCode:404});
});
test('normal text path retains WhatsApp window validation and saves proposal metadata only with explicit handoff',async()=>{
 await prisma.contact.upsert({where:{id:'proposal-unit-contact'},create:{id:'proposal-unit-contact',companyId:'cmp_mibro',channel:'META',externalId:'5511923456780',phone:'5511923456780'},update:{}});
 await prisma.conversation.upsert({where:{id:'proposal-unit-conversation'},create:{id:'proposal-unit-conversation',companyId:'cmp_mibro',contactId:'proposal-unit-contact',channel:'META',channelAccountId:'crm-fixture-account-mibro'},update:{}});
 const channel=require('./attendance/src/services/channels/channel-message-service'),templates=require('./attendance/src/services/meta-template-service'),inbox=require('./attendance/src/services/whatsapp-inbox-service');
 let providerCalls=0,windowChecks=0;
 channel.send=async()=>{providerCalls++;return {externalId:'local-summary-'+Date.now()+'-'+providerCalls,data:{localMock:true}};};
 templates.assertFreeFormAllowed=async()=>{windowChecks++;};inbox.applySender=async()=>{};
 const service=require('./attendance/src/services/message-service');
 const result=await service.sendText({conversationId:'proposal-unit-conversation',text:'Resumo fictício da proposta — teste local',sentByUserId:user.id,keepAssignee:true,crmProposal:{quoteId:'operations-proposal',customerId:'crm-fixture-sent',crmUserId:'merge-local-owner-c',draftHash:'LOCAL_MOCK'}});
 assert.equal(windowChecks,1);assert.equal(providerCalls,1);assert.equal(result.message.rawPayload.crmProposal.quoteId,'operations-proposal');assert.equal(result.message.rawPayload.providerMessage.localMock,true);
 const regular=await service.sendText({conversationId:'proposal-unit-conversation',text:'Mensagem comum — teste local',sentByUserId:user.id,keepAssignee:true});assert.deepEqual(regular.message.rawPayload,{localMock:true});assert.equal(windowChecks,2);
});
