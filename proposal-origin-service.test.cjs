const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const rules=require('./attendance/src/services/bulk-send-rules');
function fixture(){
 let stored,number='commercial',access=true;const queries=[];
 const user={id:'seller'};
 const db={
  conversation:{findUnique:async()=>({id:'origin-conversation',companyId:'mibro',channel:'META',contact:{companyId:'mibro',phone:'5511999999999'}}),findMany:async q=>{queries.push(q);return[{id:'origin-conversation'}];}},
  company:{findUnique:async({where})=>({id:where.id||where.slug,active:true,name:'Company'})},
  crmContactSelection:{create:async({data})=>{stored=data;},findUnique:async()=>stored},
  centralCrmIdentity:{findUnique:async()=>({enabled:true,crmUserId:'crm-seller'})},
 };
 const deps={'../database/prisma':db,'./company-service':{getCompany:async id=>({id})},'./authorization-service':{
  assertCanActOnConversation:async()=>{if(!access)throw Object.assign(Error('denied'),{statusCode:403});},forCompany:async()=>user,canStartConversations:()=>true,operationalScope:async()=>({}),
 },'./bulk-send-rules':rules,'./central-identity-crypto':{hash:x=>'hash:'+x,opaque:()=> 'x'.repeat(43)},'./whatsapp-inbox-service':{senderState:async()=>({account:{id:number,config:{}}})}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/attendance/src/services/crm-proposal-service.js','utf8'),{require:name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},module,Date,Error,URL,Object});
 const data={brand:'SINCROFIT',phone:'5511999999999',text:'Resumo fictício',customerId:'customer',quoteId:'quote',originConversationId:'origin-conversation'};
 return{service:module.exports,user,data,db,deps,queries,get stored(){return stored;},setNumber:n=>number=n,revoke:()=>access=false};
}
test('proposal brand does not change origin company or account',async()=>{
 const f=fixture();await f.service.create(f.user,'crm-seller',f.data);
 assert.equal(f.stored.companyId,'mibro');assert.equal(f.stored.recipients[0].originConversationId,'origin-conversation');assert.equal(f.stored.recipients[0].originChannelAccountId,'commercial');
});
test('legacy proposal without an origin retains explicit brand behavior',async()=>{
 const f=fixture();await f.service.create(f.user,'crm-seller',{...f.data,originConversationId:undefined});assert.equal(f.stored.companyId,'sincrofit');
});
test('different recipient phone cannot be attached to origin conversation',async()=>{
 const f=fixture();await assert.rejects(f.service.create(f.user,'crm-seller',{...f.data,phone:'5511888888888'}),{statusCode:404});assert.equal(f.stored,undefined);
});
test('review limits recipient selection to the originating chat',async()=>{
 const f=fixture();const {code}=await f.service.create(f.user,'crm-seller',f.data);await f.service.review(f.user,code);assert.equal(f.queries[0].where.AND[1].id,'origin-conversation');
});
test('changed sender or revoked rights invalidate the draft before sending',async()=>{
 const f=fixture();const {code}=await f.service.create(f.user,'crm-seller',f.data);f.setNumber('different-account');await assert.rejects(f.service.read(f.user,code),{statusCode:404});
 f.setNumber('commercial');f.revoke();await assert.rejects(f.service.read(f.user,code),{statusCode:403});
});
test('same phone in another conversation cannot consume an origin-bound draft',async()=>{
 const f=fixture();const {code}=await f.service.create(f.user,'crm-seller',f.data);await assert.rejects(f.service.validateForMessage(f.user,code,'other-conversation'),{statusCode:404});
 const metadata=await f.service.validateForMessage(f.user,code,'origin-conversation');assert.equal(metadata.originChannelAccountId,'commercial');
});
test('ordinary reply permission suffices for origin while no new conversation is created',async()=>{
 const f=fixture();f.deps['./authorization-service'].canStartConversations=()=>false;await f.service.create(f.user,'crm-seller',f.data);assert.equal(f.stored.companyId,'mibro');
});
function senderFixture(account){
 const counters={provider:0,window:0,claim:0};
 const row={id:'origin-conversation',channel:'META',channelAccountId:account,contact:{phone:'5511999999999'},category:null};
 const prisma={conversation:{findUnique:async()=>row},message:{create:async({data})=>({id:'synthetic-message',...data})}};
 const code=fs.readFileSync(__dirname+'/attendance/src/services/message-service.js','utf8');
 const start=code.indexOf('async function sendText('),end=code.indexOf('async function sendEmailMedia(',start),module={exports:{}};
 vm.runInNewContext(code.slice(start,end)+'\nmodule.exports=sendText;',{
  module,prisma,Date,whatsappInbox:{applySender:async()=>{}},formatTeamMessage:(_,text)=>text,
  require:name=>{assert.equal(name,'./meta-template-service');return{assertFreeFormAllowed:async()=>{counters.window++;}};},
  sendMetaForConversation:async()=>{counters.provider++;return{externalId:'synthetic-provider-id',data:{synthetic:true}};},updateConversationAfterSending:async()=>{},
 });
 return{counters,send:()=>module.exports({conversationId:'origin-conversation',text:'Resumo fictício',sentByUserId:'seller',crmProposal:{originConversationId:'origin-conversation',originChannelAccountId:'commercial'},beforeProviderSend:async()=>{counters.claim++;}})};
}
test('actual text path refuses a changed origin number before contacting the provider',async()=>{
 const f=senderFixture('another-number');await assert.rejects(f.send(),{statusCode:409});assert.equal(f.counters.provider,0);assert.equal(f.counters.claim,0);
});
test('actual text path retains the WhatsApp window check and records proposal metadata',async()=>{
 const f=senderFixture('commercial'),result=await f.send();assert.equal(f.counters.provider,1);assert.equal(f.counters.window,1);assert.equal(f.counters.claim,1);assert.equal(result.message.rawPayload.crmProposal.originChannelAccountId,'commercial');
});
