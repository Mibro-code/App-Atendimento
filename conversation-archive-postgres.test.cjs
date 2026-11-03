const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
if(process.env.ARCHIVE_DISPOSABLE_TEST!=='20261029')throw Error('Explicit disposable archive test flag required');
const {PrismaClient}=require('./attendance/node_modules/@prisma/client');
const db=new PrismaClient({datasources:{db:{url:'postgresql://archive_test:archive_test_only@127.0.0.1:5563/archive_test'}},log:[]});
const {setArchived}=require('./attendance/src/services/conversation-archive-service');
const user={id:'test-agent',companyId:'test-mibro',name:'Test Agent'},other={...user,companyId:'test-sincrofit'};
const auth={isMaster:()=>true,operationalScope:async u=>({companyId:u.companyId}),conversationScope:async u=>({companyId:u.companyId}),assertCanActOnConversation:async(u,id,options)=>{assert.equal(options.allowArchived,true);if(!await db.conversation.findFirst({where:{id,companyId:u.companyId}}))throw Object.assign(Error('Forbidden'),{statusCode:403});}};
function moduleWith(file,deps){const m={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:m,require:name=>deps[name]||{},Buffer,Date,Map,Set});return m.exports;}
let inbox,messages;
before(async()=>{
 assert.equal(await db.company.count(),0,'Dedicated disposable database must start empty');
 for(const slug of ['mibro','sincrofit'])await db.company.create({data:{id:'test-'+slug,name:slug,slug,displayName:slug,primaryColor:'#ff5500'}});
 await db.user.create({data:{id:user.id,name:user.name,email:'archive-test@example.invalid',role:'ADMIN'}});
 for(const [id,companyId]of [['test-contact','test-mibro'],['test-other-contact','test-sincrofit']])await db.contact.create({data:{id,companyId,channel:'META',externalId:id,phone:'5511999999999',name:'Synthetic customer',preferredAssigneeId:user.id,preferredAssigneeEnabled:true}});
 for(const [id,companyId,contactId]of [['test-chat','test-mibro','test-contact'],['test-other-chat','test-sincrofit','test-other-contact']])await db.conversation.create({data:{id,companyId,contactId,channel:'META',status:'FINALIZADO',assignedUserId:user.id}});
 await db.message.create({data:{id:'test-message',conversationId:'test-chat',externalId:'test-original',channel:'META',direction:'RECEBIDA',status:'RECEBIDA',type:'text',text:'Original synthetic history',occurredAt:new Date()}});
 const common={'../database/prisma':db,'./authorization-service':auth,'./company-service':{resolveWorkspace:async u=>u.companyId},'./whatsapp-inbox-service':{canonicalScope:{},messageAccountScope:async()=>({})},'./conversation-settings-service':{getConversationSettings:async()=>({reopenConversationOnCustomerMessage:true})},'./private-segment-service':{readableWhereFor:async()=>({})},'./email-mailbox-query':{emailMailboxes:async()=>new Map()},'./master-unread-service':{masterUnreadCounts:async rows=>new Map(rows.map(r=>[r.id,r.unreadCount||0]))},'./inbox-pagination':require('./attendance/src/services/inbox-pagination')};
 inbox=moduleWith(require.resolve('./attendance/src/services/inbox-service'),common);
 messages=moduleWith(require.resolve('./attendance/src/services/message-service'),{...common,'./conversation-service':{findOrCreateMetaConversation:async(_event,tx)=>({contact:await tx.contact.findUnique({where:{id:'test-contact'}}),conversation:await tx.conversation.findUnique({where:{id:'test-chat'}})})}});
});
after(()=>db.$disconnect());
test('archive is scoped, preserves messages/category/assignee/fixed owner and is idempotent',async()=>{
 await assert.rejects(setArchived(db,auth,user,'test-chat','true'),e=>e.statusCode===400);
 await assert.rejects(setArchived(db,auth,other,'test-chat',true),e=>e.statusCode===403);
 const before=await db.conversation.findUnique({where:{id:'test-chat'}});
 const result=await setArchived(db,auth,user,'test-chat',true);assert.ok(result.archivedAt);
 const row=await db.conversation.findUnique({where:{id:'test-chat'}});
 assert.equal(row.assignedUserId,before.assignedUserId);assert.equal(row.categoryId,before.categoryId);assert.equal(row.status,before.status);
 assert.equal(await db.message.count(),1);assert.equal((await db.contact.findUnique({where:{id:'test-contact'}})).preferredAssigneeId,user.id);
 assert.equal((await setArchived(db,auth,user,'test-chat',true)).unchanged,true);assert.equal(await db.auditLog.count(),1);
});
test('real inbox query hides archive from Todos, returns it explicitly and preserves company isolation',async()=>{
 const normal=await inbox.listConversations({limit:'50'},user);assert.equal(normal.total,0);
 const archive=await inbox.listConversations({limit:'50',archived:'true'},user);assert.equal(archive.total,1);assert.equal(archive.items[0].id,'test-chat');
 const otherArchive=await inbox.listConversations({limit:'50',archived:'true'},other);assert.equal(otherArchive.total,0);
 await assert.rejects(inbox.listConversations({archived:'all'},user),e=>e.statusCode===400);
 assert.equal((await inbox.getSidebarSummary(user)).total,0);
});
test('actual inbound persistence retains archive, status, assignee and stores new messages once',async()=>{
 const event={externalId:'test-new-inbound',type:'text',text:'New synthetic message while archived',occurredAt:new Date(),rawPayload:{test:true}};
 const r=await messages.saveIncoming(event,{companyId:'test-mibro'});assert.equal(r.duplicate,false);assert.equal(r.archived,true);
 const duplicate=await messages.saveIncoming(event,{companyId:'test-mibro'});assert.equal(duplicate.duplicate,true);
 const row=await db.conversation.findUnique({where:{id:'test-chat'}});assert.ok(row.archivedAt);assert.equal(row.status,'FINALIZADO');assert.equal(row.assignedUserId,user.id);assert.equal(row.unreadCount,1);assert.equal(await db.message.count(),2);
 const normal=await inbox.listConversations({limit:'50'},user);assert.equal(normal.total,0);
});
test('actual send functions refuse archived conversation before calling providers',async()=>{
 for(const method of ['sendText','sendImage','sendVideo','sendDocument','sendAudio'])await assert.rejects(messages[method]({conversationId:'test-chat',text:'no-send'}),e=>e.code==='CONVERSATION_ARCHIVED');
 assert.equal(await db.message.count(),2);
});
test('manual restore returns all history and leaves other company untouched',async()=>{
 await setArchived(db,auth,user,'test-chat',false);const row=await db.conversation.findUnique({where:{id:'test-chat'}});assert.equal(row.archivedAt,null);assert.equal(row.archivedByUserId,null);
 assert.equal((await inbox.listConversations({limit:'50'},user)).total,1);assert.equal((await inbox.listConversations({limit:'50',archived:'true'},user)).total,0);
 assert.equal(await db.message.count(),2);assert.equal((await db.conversation.findUnique({where:{id:'test-other-chat'}})).companyId,'test-sincrofit');
 assert.equal(await db.auditLog.count(),2);
});
test('running bot blocks archive; queued bot is stopped without deleting execution/history',async()=>{
 await db.bot.create({data:{id:'test-bot',companyId:'test-mibro',name:'Test',channel:'META',initialMessage:'',outsideHoursMessage:'',fallbackMessage:''}});
 await db.botFlow.create({data:{id:'test-flow',botId:'test-bot',name:'Test flow',draftGraph:{}}});
 await db.botFlowVersion.create({data:{id:'test-version',flowId:'test-flow',version:1,graph:{}}});
 await db.botFlowExecution.create({data:{id:'test-execution',conversationId:'test-chat',botId:'test-bot',flowId:'test-flow',versionId:'test-version',status:'RUNNING'}});
 await assert.rejects(setArchived(db,auth,user,'test-chat',true),/bot está respondendo/);assert.equal((await db.conversation.findUnique({where:{id:'test-chat'}})).archivedAt,null);
 await db.botFlowExecution.update({where:{id:'test-execution'},data:{status:'WAITING_TIMER'}});
 await setArchived(db,auth,user,'test-chat',true);assert.equal((await db.botFlowExecution.findUnique({where:{id:'test-execution'}})).status,'HANDED_OFF');assert.equal(await db.message.count(),2);
});
test('concurrent archives produce one transition/audit; the other request is idempotent or gets 409',async()=>{
 await db.conversation.update({where:{id:'test-chat'},data:{archivedAt:null,archivedByUserId:null}});
 const before=await db.auditLog.count();
 const results=await Promise.allSettled([setArchived(db,auth,user,'test-chat',true),setArchived(db,auth,user,'test-chat',true)]);
 assert.ok(results.some(r=>r.status==='fulfilled'));
 for(const r of results)if(r.status==='rejected')assert.equal(r.reason.statusCode,409);
 assert.equal(await db.auditLog.count(),before+1);assert.equal(await db.message.count(),2);
});
