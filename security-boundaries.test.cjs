const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {validatedPushEndpoint}=require('./attendance/src/services/push-endpoint-policy');
const {planInboundRouting}=require('./attendance/src/services/channels/social-webhook-routing');
const adapters=require('./attendance/src/services/channels/meta-messaging-adapter');
test('push supports mainstream providers and rejects arbitrary destinations and URL confusion',()=>{
 for(const host of ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','s.notify.windows.com'])assert.equal(new URL(validatedPushEndpoint('https://'+host+'/synthetic')).hostname,host);
 for(const url of ['https://example.com/a','https://127.0.0.1/a','https://[::1]/','http://fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a','https://fcm.googleapis.com.attacker.invalid/a','https://attackerfcm.googleapis.com/a','https://user:pass@fcm.googleapis.com/a','https://fcm.googleapis.com/a#fragment','not a url'])assert.throws(()=>validatedPushEndpoint(url),{statusCode:400});
});
test('stored unsafe push endpoint never reaches network; legitimate sends have timeout and expired rows clean up',async()=>{
 const sent=[],saved=[],deleted=[];let status=null;
 const db={pushSubscription:{findMany:async()=>[{id:'bad',endpoint:'https://localhost/internal'},{id:'good',endpoint:'https://fcm.googleapis.com/synthetic',p256dh:'key',auth:'key'}],update:async()=>{},upsert:async row=>saved.push(row),delete:async row=>deleted.push(row)}};
 const ctx={module:{exports:{}},process:{env:{VAPID_PUBLIC_KEY:'synthetic',VAPID_PRIVATE_KEY:'synthetic'}},console:{warn(){}},require:name=>name==='web-push'?{setVapidDetails(){},sendNotification:async(...args)=>{sent.push(args);if(status)throw {statusCode:status};}}:name==='../database/prisma'?db:name==='./push-endpoint-policy'?{validatedPushEndpoint}:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'attendance/src/services/push-service.js'),'utf8'),ctx);
 const service=ctx.module.exports;
 await assert.rejects(service.saveSubscription({id:'user'},{endpoint:'https://localhost/a',keys:{p256dh:'k',auth:'k'}},{}),{statusCode:400});assert.equal(saved.length,0);
 await service.notifyUser('user',{});assert.equal(sent.length,1);assert.equal(sent[0][2].timeout,5000);
 status=410;await service.notifyUser('user',{});assert.equal(deleted.length,1);
});
test('all four Meta adapters normalize only their own recipient and preserve ownership',()=>{
 for(const [name,config,field]of [['FacebookMessengerAdapter',{pageId:'A'},'messaging'],['InstagramDirectAdapter',{igUserId:'A'},'messaging'],['FacebookCommentsAdapter',{pageId:'A'},'comments'],['InstagramCommentsAdapter',{igUserId:'A'},'comments']]){
  const adapter=new adapters[name]({config,secrets:{}});
  const entry=id=>field==='messaging'?{id,messaging:[{sender:{id:'customer'},recipient:{id},message:{mid:'message-'+id,text:'synthetic'}}]}:{id,changes:[{field:'comments',value:{id:'comment-'+id,text:'synthetic',from:{id:'customer'}}}]};
  const body={entry:[entry('A'),entry('B')]};assert.equal(adapter.matchesWebhookPayload(body),false);
  const events=adapter.normalizeInboundEvent(body);assert.equal(events.length,1);assert.equal(events[0].recipientEntryId,'A');
  assert.equal(new adapters[name]({config:{},secrets:{}}).matchesWebhookPayload(body),false);
 }
});
test('mixed signed batch is partitioned by account, independent of order, with no partial acceptance',()=>{
 const accounts=[{id:'account-A'},{id:'account-B'}],req={body:{entry:[{id:'B'},{id:'A'}]},rawBody:Buffer.from('full signed body')};let normalized=0;
 const make=account=>({matchesWebhookPayload:body=>body.entry[0].id===account.id.slice(-1),capabilities:()=>({supportsWebhook:true}),validateWebhook:r=>r===req,normalizeInboundEvent:body=>{normalized++;return [{recipient:body.entry[0].id}];}});
 const plan=planInboundRouting('FACEBOOK_MESSENGER',accounts,req,make);assert.deepEqual(plan.map(job=>job.account.id),['account-B','account-A']);
 assert.throws(()=>planInboundRouting('FACEBOOK_MESSENGER',[accounts[0]],req,make),{statusCode:404});
 assert.throws(()=>planInboundRouting('FACEBOOK_MESSENGER',[accounts[0],accounts[0]],{...req,body:{entry:[{id:'A'}]}},make),{statusCode:404});
 const bad=account=>({...make(account),validateWebhook:()=>false});assert.throws(()=>planInboundRouting('FACEBOOK_MESSENGER',accounts,req,bad),{statusCode:401});
});
test('a mismatched inner recipient cannot be normalized by an owned Meta entry',()=>{
 const adapter=new adapters.FacebookMessengerAdapter({config:{pageId:'A'},secrets:{}});
 assert.throws(()=>adapter.normalizeInboundEvent({entry:[{id:'A',messaging:[{recipient:{id:'B'},message:{mid:'synthetic'}}]}]}),{statusCode:404});
});
