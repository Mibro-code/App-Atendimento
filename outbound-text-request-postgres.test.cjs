const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
if(process.env.OUTBOUND_DISPOSABLE_TEST!=='20261028')throw Error('Requires dedicated disposable container on port 5562');
const {PrismaClient}=require('./attendance/node_modules/@prisma/client');
const url='postgresql://outbound_test:local_test_only@127.0.0.1:5562/outbound_test?schema=public';
const db=new PrismaClient({datasources:{db:{url}}}),second=new PrismaClient({datasources:{db:{url}}});
const {sendOnce}=require('./attendance/src/services/outbound-text-request-service');
before(async()=>{
 assert.equal(await db.company.count(),0,'Refusing a nonempty database');
 await db.company.create({data:{id:'test-company',slug:'outbound-test',name:'Synthetic',displayName:'TEST',primaryColor:'#000000'}});
 await db.user.create({data:{id:'test-seller',name:'Synthetic seller',email:'outbound@example.invalid'}});
 await db.contact.create({data:{id:'test-contact',companyId:'test-company',externalId:'synthetic'}});
 await db.conversation.create({data:{id:'test-conversation',companyId:'test-company',contactId:'test-contact'}});
});
after(async()=>{await Promise.all([db.$disconnect(),second.$disconnect()]);});
function args(requestId){return{client:db,userId:'test-seller',conversationId:'test-conversation',requestId,text:'ok',send:async before=>{
 await before();
 return{message:await db.message.create({data:{conversationId:'test-conversation',channel:'META',direction:'ENVIADA',status:'ENVIADA',type:'text',text:'ok',occurredAt:new Date(),sentByUserId:'test-seller'}})};
}};}
test('PostgreSQL unique claim prevents six concurrent sends across two clients',async()=>{
 const a=args('postgres-concurrent-12345678');
 const results=await Promise.allSettled(Array.from({length:6},(_,i)=>sendOnce({...a,client:i%2?second:db})));
 assert.equal(results.filter(r=>r.status==='fulfilled'&&!r.value.replayed).length,1);
 assert.equal(await db.message.count(),1);
 assert.equal(await db.externalChannelEvent.count(),1);
 const replay=await sendOnce({...a,client:second});assert.equal(replay.replayed,true);assert.equal(await db.message.count(),1);
});
test('PostgreSQL persists an uncertain provider attempt and refuses a retry',async()=>{
 let calls=0;const a={...args('postgres-timeout-12345678'),send:async before=>{await before();calls++;throw Error('synthetic timeout');}};
 await assert.rejects(sendOnce(a),{code:'SEND_RESULT_UNCERTAIN'});
 await assert.rejects(sendOnce({...a,client:second}),{code:'SEND_ALREADY_PENDING'});assert.equal(calls,1);
});
test('PostgreSQL JSON compare-and-set admits only one safe pre-provider retry',async()=>{
 const a=args('postgres-safe-retry-12345678');
 await assert.rejects(sendOnce({...a,send:async()=>{throw Error('synthetic preflight');}}),/synthetic preflight/);
 const before=await db.message.count();
 const results=await Promise.allSettled(Array.from({length:6},(_,i)=>sendOnce({...a,client:i%2?second:db})));
 assert.equal(results.filter(r=>r.status==='fulfilled'&&!r.value.replayed).length,1);
 assert.equal(await db.message.count(),before+1);
});
test('same text with a distinct request remains a legitimate new message',async()=>{
 const count=await db.message.count();await sendOnce(args('postgres-intentional-12345678'));assert.equal(await db.message.count(),count+1);
});

function loadService(file,dependencies){
 const fs=require('node:fs'),vm=require('node:vm');const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/attendance/src/services/'+file,'utf8'),{module,require:name=>{assert.ok(Object.hasOwn(dependencies,name),'Unmocked dependency '+name);return dependencies[name];},console,Date,Promise});
 return module.exports;
}
function incomingService(){return loadService('message-service.js',{
 '../database/prisma':db,'./assignment-period-service':{recordAssignmentChange:async()=>{}},
 './conversation-service':{findOrCreateMetaConversation:async(event,tx)=>({contact:await tx.contact.findUnique({where:{id:'test-contact'}}),conversation:await tx.conversation.findUnique({where:{id:'test-conversation'}})})},
 './whatsapp-account-service':{},'./media-storage-service':{},'./team-message-formatter':{},'./audio-normalization-service':{},
 './conversation-settings-service':{getConversationSettings:async()=>({reopenConversationOnCustomerMessage:true})},
 './channels/channel-message-service':{},'./whatsapp-inbox-service':{},'./channels/social-media-link-service':{},
 './preferred-category-service':require('./attendance/src/services/preferred-category-service'),
});}
function incoming(id){return{externalId:id,type:'text',text:'synthetic incoming',occurredAt:new Date()};}
test('fixed customer reopens in the same category and routes to the fixed seller',async()=>{
 await db.category.create({data:{id:'test-wholesale',companyId:'test-company',code:'wholesale',name:'Synthetic wholesale'}});
 await db.contact.update({where:{id:'test-contact'},data:{preferredAssigneeEnabled:true,preferredAssigneeId:'test-seller'}});
 await db.conversation.update({where:{id:'test-conversation'},data:{categoryId:'test-wholesale',assignedUserId:'test-seller',status:'FINALIZADO',finalizedAt:new Date()}});
 const {saveIncoming}=incomingService();const result=await saveIncoming(incoming('synthetic-reopen-fixed'),{companyId:'test-company'});
 let current=await db.conversation.findUnique({where:{id:'test-conversation'}});assert.equal(current.categoryId,'test-wholesale');assert.equal(current.status,'NOVO');
 const {routeIncomingMessage}=loadService('preferred-assignee-routing-service.js',{
 '../database/prisma':db,'./audit-service':{recordAudit:async()=>{}},'./company-service':{userForCompany:async u=>u},
 './authorization-service':{canAccessCategory:async()=>true,canAccessChannelAccount:async()=>true},
 './conversation-settings-service':{getConversationSettings:async()=>({preferredAssigneeRoutingMessage:''})},
 './bot-visual-flow-engine':{STATUS:{WAITING_CUSTOMER:'WAITING_CUSTOMER',WAITING_TIMER:'WAITING_TIMER',RUNNING:'RUNNING',HANDED_OFF:'HANDED_OFF'}},
 });
 assert.equal(await routeIncomingMessage({type:'text'},result.message,{}, {notify:async()=>{}}),true);
 current=await db.conversation.findUnique({where:{id:'test-conversation'}});assert.equal(current.categoryId,'test-wholesale');assert.equal(current.assignedUserId,'test-seller');assert.equal(current.status,'AGUARDANDO_EQUIPE');
});
test('ordinary customer still reopens without a category',async()=>{
 await db.contact.update({where:{id:'test-contact'},data:{preferredAssigneeEnabled:false,preferredAssigneeId:null}});
 await db.conversation.update({where:{id:'test-conversation'},data:{categoryId:'test-wholesale',assignedUserId:'test-seller',status:'FINALIZADO'}});
 await incomingService().saveIncoming(incoming('synthetic-reopen-ordinary'),{companyId:'test-company'});
 const current=await db.conversation.findUnique({where:{id:'test-conversation'}});assert.equal(current.categoryId,null);assert.equal(current.assignedUserId,null);
});
test('fixed customer previously affected can recover a proven historical category',async()=>{
 await db.contact.update({where:{id:'test-contact'},data:{preferredAssigneeEnabled:true,preferredAssigneeId:'test-seller'}});
 await db.conversationActivity.create({data:{conversationId:'test-conversation',action:'CATEGORY_CHANGED',details:{fromCategoryId:null,toCategoryId:'test-wholesale'}}});
 await db.conversation.update({where:{id:'test-conversation'},data:{status:'FINALIZADO'}});
 await incomingService().saveIncoming(incoming('synthetic-reopen-recover'),{companyId:'test-company'});
 assert.equal((await db.conversation.findUnique({where:{id:'test-conversation'}})).categoryId,'test-wholesale');
});
test('manual category removal is respected when reopening a fixed customer',async()=>{
 await db.conversationActivity.create({data:{conversationId:'test-conversation',action:'CATEGORY_CHANGED',details:{fromCategoryId:'test-wholesale',toCategoryId:null}}});
 await db.conversation.update({where:{id:'test-conversation'},data:{status:'FINALIZADO',categoryId:null}});
 await incomingService().saveIncoming(incoming('synthetic-reopen-manual-null'),{companyId:'test-company'});
 assert.equal((await db.conversation.findUnique({where:{id:'test-conversation'}})).categoryId,null);
});
