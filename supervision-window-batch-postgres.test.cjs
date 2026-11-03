const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {client}=require('./commercial-owner-local-db.cjs'),p=client();
const {supervisionWindows}=require('./attendance/src/services/assignment-period-service'),{supervisionWindowsMany}=require('./attendance/src/services/supervision-window-batch-service');
after(()=>p.$disconnect());
test('PostgreSQL: batch and existing supervision produce identical historical boundaries',async()=>{
 const prefix='windows-batch-'+Date.now(),users=[];
 for(const suffix of ['a','b','other'])users.push(await p.user.create({data:{name:'Fictício '+suffix,email:prefix+suffix+'@local.invalid',role:'ATENDENTE'}}));
 const conversations=[];
 for(let i=0;i<6;i++){
  const id=prefix+'-'+i;await p.contact.create({data:{id,companyId:'cmp_mibro',externalId:id}});
  conversations.push(await p.conversation.create({data:{id,companyId:'cmp_mibro',contactId:id,assignedUserId:i===5?null:users[i%3].id}}));
 }
 await p.conversationAssignmentPeriod.createMany({data:[
  {conversationId:conversations[0].id,userId:users[0].id,startedAt:new Date(1000),endedAt:new Date(2000),startReason:'TEST'},
  {conversationId:conversations[1].id,userId:users[1].id,startedAt:new Date(1000),endedAt:null,startReason:'TEST'},
  {conversationId:conversations[2].id,userId:users[0].id,startedAt:new Date(1000),endedAt:new Date(2000),startReason:'TEST'},
  {conversationId:conversations[3].id,userId:users[2].id,startedAt:new Date(1000),endedAt:null,startReason:'TEST'},
 ]});
 await p.conversationActivity.createMany({data:[
  {conversationId:conversations[0].id,action:'CONVERSATION_TRANSFERRED',createdAt:new Date(3000),details:{toUserId:users[0].id}},
  {conversationId:conversations[0].id,action:'CONVERSATION_TRANSFERRED',createdAt:new Date(4000),details:{toUserId:users[2].id}},
  {conversationId:conversations[3].id,action:'CONVERSATION_CLAIMED',createdAt:new Date(3500),details:{toUserId:users[0].id}},
 ]});
 const team=users.slice(0,2).map(u=>u.id),actual=await supervisionWindowsMany(conversations,team,p);
 for(const conversation of conversations)assert.deepEqual(actual.get(conversation.id),await supervisionWindows(conversation,team,p));
});
