const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {database,client}=require('./local-fixtures.cjs');
process.env.DATABASE_URL=database('attendance');
require('./local-network-guard.cjs');
const p=client('attendance'),inbox=require('./attendance/src/services/inbox-service'),servicePrisma=require('./attendance/src/database/prisma');
const paging=require('./attendance/src/services/inbox-pagination'),{emailMailboxes}=require('./attendance/src/services/email-mailbox-query');
after(async()=>{await p.$disconnect();await servicePrisma.$disconnect();});
test('PostgreSQL: paging preserves transfer history restrictions and company boundaries',async()=>{
 const id='paging-privacy-'+Date.now(),reader=await p.user.findUniqueOrThrow({where:{id:'merge-local-a'}}),owner=await p.user.findUniqueOrThrow({where:{id:'merge-local-owner-a'}}),at=new Date();
 await p.contact.create({data:{id,companyId:'cmp_mibro',externalId:id,channel:'META',name:'Sintético privacidade'}});
 await p.conversation.create({data:{id,contactId:id,companyId:'cmp_mibro',channel:'META',assignedUserId:reader.id}});
 await p.message.createMany({data:[{id:id+'-old',conversationId:id,channel:'META',direction:'RECEBIDA',status:'ENTREGUE',type:'text',text:'SEGREDO_ANTERIOR',occurredAt:new Date(at.getTime()-10000)},{id:id+'-new',conversationId:id,channel:'META',direction:'RECEBIDA',status:'ENTREGUE',type:'text',text:'VISIVEL_ATUAL',occurredAt:new Date(at.getTime()+1000)}]});
 await p.conversationActivity.create({data:{conversationId:id,actorUserId:owner.id,action:'CONVERSATION_TRANSFERRED',createdAt:at,details:{fromUserId:owner.id,toUserId:reader.id,historyShared:false}}});
 const current=await inbox.getConversation(id,reader,{limit:80});assert.deepEqual(current.messages.map(row=>row.text),['VISIVEL_ATUAL']);
 const before=await inbox.getConversation(id,reader,{limit:80,before:paging.decodeCursor(current.messagePage.nextCursor)});assert.equal(before.messages.length,0);
 const from=await inbox.getConversation(id,reader,{limit:80,from:{id:'a',at:new Date(0)}});assert.deepEqual(from.messages.map(row=>row.text),['VISIVEL_ATUAL']);
 await p.contact.update({where:{id},data:{whatsappInboxId:id}});
 await p.conversation.create({data:{id:id+'-sibling',contactId:id,companyId:'cmp_mibro',channel:'META',channelScope:'synthetic-sibling',assignedUserId:reader.id}});
 await p.message.create({data:{conversationId:id+'-sibling',channel:'META',direction:'RECEBIDA',status:'ENTREGUE',type:'text',text:'SEGREDO_SIBLING',occurredAt:new Date(at.getTime()-20000)}});
 const unified=await inbox.getConversation(id,reader,{limit:80});assert.deepEqual(unified.messages.map(row=>row.text),['VISIVEL_ATUAL']);
 const foreign=id+'-foreign';await p.contact.create({data:{id:foreign,companyId:'cmp_sincrofit',externalId:foreign,channel:'META'}});await p.conversation.create({data:{id:foreign,companyId:'cmp_sincrofit',contactId:foreign,channel:'META'}});
 try{assert.equal(await inbox.getConversation(foreign,reader,{limit:80}),null);}catch(error){assert.ok([403,404].includes(error.statusCode));}
});
test('PostgreSQL: latest email mailbox uses only latest inbound and stable timestamp ties',async()=>{
 const id='paging-email-'+Date.now(),at=new Date();
 await p.contact.create({data:{id,companyId:'cmp_mibro',externalId:id,channel:'EMAIL'}});await p.conversation.create({data:{id,companyId:'cmp_mibro',contactId:id,channel:'EMAIL'}});
 await p.message.createMany({data:[{id:id+'-a',conversationId:id,channel:'EMAIL',direction:'RECEBIDA',status:'ENTREGUE',type:'text',occurredAt:at,rawPayload:{gmailMailbox:'SPAM'}},{id:id+'-z',conversationId:id,channel:'EMAIL',direction:'RECEBIDA',status:'ENTREGUE',type:'text',occurredAt:at,rawPayload:{gmailMailbox:'GENERAL'}},{id:id+'-out',conversationId:id,channel:'EMAIL',direction:'ENVIADA',status:'ENVIADA',type:'text',occurredAt:new Date(at.getTime()+1000),rawPayload:{gmailMailbox:'SPAM'}}]});
 assert.equal((await emailMailboxes(p,[id])).get(id),'GENERAL');
 const owner=await p.user.findUniqueOrThrow({where:{id:'merge-local-owner-a'}});const page=await inbox.listConversations({limit:'80',channel:'EMAIL',company:'cmp_mibro',mailbox:'GENERAL'},owner);assert.ok(page.items.some(row=>row.id===id));assert.ok(page.items.every(row=>row.emailMailbox==='GENERAL'));
});
