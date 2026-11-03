const test=require('node:test');
const assert=require('node:assert/strict');
const {sendOnce}=require('./attendance/src/services/outbound-text-request-service');
function fixture(){
 const events=new Map(),messages=new Map();let calls=0;
 const client={
  conversation:{findUnique:async()=>({channel:'META',channelAccountId:'number-a',companyId:'mibro'})},
  externalChannelEvent:{
   create:async({data})=>{if(events.has(data.externalEventId))throw Object.assign(Error('unique'),{code:'P2002'});const event={...data,id:data.externalEventId};events.set(event.id,event);return event;},
   findUnique:async({where})=>events.get(where.channel_externalEventId.externalEventId),
   update:async({where,data})=>Object.assign(events.get(where.id),data),
   updateMany:async({where,data})=>{const e=events.get(where.id);if(e.status!==where.status||e.payload.retrySafe!==true)return{count:0};Object.assign(e,data);return{count:1};},
  },
  message:{findFirst:async({where})=>{const m=messages.get(where.id);return m?.conversationId===where.conversationId&&m.sentByUserId===where.sentByUserId?m:null;}},
 };
 const args={client,userId:'seller',conversationId:'conversation-a',requestId:'operation-1234567890',text:'ok',send:async before=>{await before();calls++;const message={id:'message-'+calls,conversationId:'conversation-a',sentByUserId:'seller'};messages.set(message.id,message);return{message};}};
 return{args,events,messages,get calls(){return calls;}};
}
test('six concurrent identical requests reach the provider once',async()=>{
 const h=fixture();const result=await Promise.allSettled(Array.from({length:6},()=>sendOnce(h.args)));
 assert.equal(h.calls,1);assert.ok(result.some(r=>r.status==='fulfilled'));
 assert.ok(result.filter(r=>r.status==='rejected').every(r=>r.reason.code==='SEND_ALREADY_PENDING'));
});
test('successful replay returns the same message without resending, even with a new service call',async()=>{
 const h=fixture(),first=await sendOnce(h.args),again=await sendOnce({...h.args});
 assert.equal(again.message.id,first.message.id);assert.equal(again.replayed,true);assert.equal(h.calls,1);
});
test('intentional identical text with a new operation is allowed',async()=>{
 const h=fixture();await sendOnce(h.args);await sendOnce({...h.args,requestId:'another-operation-12345'});assert.equal(h.calls,2);
});
test('same operation with changed text or proposal is rejected',async()=>{
 const h=fixture();await sendOnce(h.args);
 await assert.rejects(sendOnce({...h.args,text:'changed'}),{code:'SEND_REQUEST_CONFLICT'});
 await assert.rejects(sendOnce({...h.args,crmProposal:{quoteId:'other'}}),{code:'SEND_REQUEST_CONFLICT'});
 assert.equal(h.calls,1);
});
test('operation scope separates users, conversations and companies',async()=>{
 const h=fixture();await sendOnce(h.args);
 await sendOnce({...h.args,userId:'other-seller'});
 await sendOnce({...h.args,conversationId:'other-conversation'});
 h.args.client.conversation.findUnique=async()=>({channel:'META',channelAccountId:'number-b',companyId:'sincrofit'});
 await sendOnce(h.args);assert.equal(h.calls,4);
});
test('provider timeout is uncertain and cannot be repeated with the same operation',async()=>{
 const h=fixture();let attempted=0;
 const args={...h.args,send:async before=>{await before();attempted++;throw Error('timeout');}};
 await assert.rejects(sendOnce(args),{code:'SEND_RESULT_UNCERTAIN'});
 await assert.rejects(sendOnce(args),{code:'SEND_ALREADY_PENDING'});assert.equal(attempted,1);
});
test('failure before provider contact can be retried once under concurrency',async()=>{
 const h=fixture();await assert.rejects(sendOnce({...h.args,send:async()=>{throw Error('validation');}}),/validation/);
 await Promise.allSettled(Array.from({length:6},()=>sendOnce(h.args)));assert.equal(h.calls,1);
});
test('completed operation whose message is unavailable never sends again',async()=>{
 const h=fixture();await sendOnce(h.args);h.messages.clear();
 await assert.rejects(sendOnce(h.args),{code:'SEND_RESULT_UNAVAILABLE'});assert.equal(h.calls,1);
});
test('invalid operation IDs are rejected before accessing a provider',async()=>{
 const h=fixture();for(const requestId of ['',null,12,'short','a'.repeat(101)])await assert.rejects(sendOnce({...h.args,requestId}),{code:'INVALID_SEND_REQUEST'});
 assert.equal(h.calls,0);
});
test('older clients remain compatible without a request ID',async()=>{
 const h=fixture();await sendOnce({...h.args,requestId:undefined});assert.equal(h.calls,1);assert.equal(h.events.size,0);
});
