// Central de Atividades — lado da Central: o feed reaproveita o
// follow-up-service (escopo, setor protegido, regras de alteração) e só
// devolve os campos exibidos. Serviço da Agenda substituído por um dublê.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const servicePath=path.join(__dirname,'attendance/src/services/follow-up-service.js');
const calls=[];let failNext=null,concurrentCompletion=false;
const row=(over={})=>({id:'f1',company:{id:'co-mibro',slug:'mibro',name:'Mibro',displayName:'Mibro Brasil'},contact:{id:'ct1',name:'Loja Azul',phone:'5511999990000'},reason:'NEGOCIACAO',reasonLabel:'Negociação',note:'Ligar após 14h',restricted:false,privateSector:null,priority:'ALTA',status:'PENDENTE',state:'PENDENTE',dueAt:new Date('2026-10-22T15:00:00Z'),completedAt:null,rescheduleCount:0,assignee:{id:'u1',name:'Ana',active:true},createdBy:{id:'u1',name:'Ana'},conversationId:'conv1',canOpenConversation:true,channelAccount:{id:'acc',name:'Comercial'},canEdit:true,...over});
require.cache[servicePath]={id:servicePath,filename:servicePath,loaded:true,exports:{
  listFollowUps:async(user,query)=>{calls.push(['list',user.id,query]);return query.view==='DONE'
    ?{items:concurrentCompletion?[row({id:'f1',status:'CONCLUIDO',state:'CONCLUIDO',completedAt:new Date('2026-10-20T12:00:00Z')})]:[row({id:'old',status:'CONCLUIDO',state:'CONCLUIDO',completedAt:new Date('2026-09-01T12:00:00Z')}),row({id:'recent',status:'CONCLUIDO',state:'CONCLUIDO',completedAt:new Date('2026-10-20T12:00:00Z')})],counts:{},truncated:concurrentCompletion}
    :{items:[row(),row({id:'hidden',canOpenConversation:false,restricted:true,note:null,privateSector:'Setor protegido'})],counts:{OVERDUE:3,TODAY:1},truncated:false};},
  completeFollowUp:async(user,id,input)=>{calls.push(['complete',user.id,id,input]);if(failNext)throw failNext;return row({id,status:'CONCLUIDO',state:'CONCLUIDO'});},
  updateFollowUp:async(user,id,input)=>{calls.push(['update',user.id,id,input]);return row({id,dueAt:new Date('2026-10-23T12:00:00Z')});},
}};
const feed=require('./attendance/src/services/activity-feed-service');
const NOW=new Date('2026-10-21T13:00:00Z'),user={id:'u1',role:'AGENT'};

test('requires an explicit company and never mixes workspaces',async()=>{
  calls.length=0;
  for(const company of [undefined,'','ALL','mibro,sincrofit','outra'])await assert.rejects(feed.feed(user,{company},{now:NOW}),{statusCode:400});
  assert.equal(calls.length,0);
  await feed.feed(user,{company:'sincrofit'},{now:NOW});
  assert.ok(calls.every(([,, query])=>query.company==='sincrofit'));
});

test('"mine" restricts to own follow-ups; "team" delegates the scope to the Agenda service',async()=>{
  calls.length=0;await feed.feed(user,{company:'mibro',scope:'mine'},{now:NOW});
  assert.ok(calls.every(([,, query])=>query.assigneeId==='me'));
  calls.length=0;await feed.feed(user,{company:'mibro',scope:'team'},{now:NOW});
  assert.ok(calls.every(([,, query])=>query.assigneeId===undefined));
  const pending=calls.find(([,, query])=>query.view==='PENDING')[2];
  assert.equal(pending.to,'2026-11-04');assert.equal(pending.limit,200);
});

test('returns only displayed fields: no phone, no channel, no hidden conversation link',async()=>{
  const data=await feed.feed(user,{company:'mibro'},{now:NOW});
  const [visible,hidden]=data.items;
  assert.equal(visible.contact.phone,undefined);assert.equal(visible.channelAccount,undefined);
  assert.equal(visible.conversationId,'conv1');assert.deepEqual(visible.company,{id:'co-mibro',slug:'mibro',name:'Mibro Brasil'});
  assert.equal(hidden.conversationId,null);assert.equal(hidden.note,null);assert.equal(hidden.privateSector,'Setor protegido');
  assert.deepEqual(data.counts,{overdue:3,today:1});
});

test('includes only follow-ups completed in the last 7 days',async()=>{
  const ids=(await feed.feed(user,{company:'mibro'},{now:NOW})).items.map(item=>item.id);
  assert.ok(ids.includes('recent'));assert.ok(!ids.includes('old'));
});

test('completion during parallel reads cannot duplicate a task and completed limits remain visible',async()=>{
 concurrentCompletion=true;
 try {
  const data=await feed.feed(user,{company:'mibro'},{now:NOW});
  assert.equal(data.items.filter(item=>item.id==='f1').length,1);
  assert.equal(data.items.find(item=>item.id==='f1').state,'CONCLUIDO');
  assert.equal(data.truncated,true);
 } finally { concurrentCompletion=false; }
});

test('actions go through the Agenda rules and validate input first',async()=>{
  calls.length=0;
  await assert.rejects(feed.act(user,{id:'../x',action:'COMPLETE'}),{statusCode:404});
  await assert.rejects(feed.act(user,{id:'f1',action:'DELETE'}),{statusCode:400});
  await assert.rejects(feed.act(user,{id:'f1',action:'RESCHEDULE',date:'22/10/2026',time:'10:00'}),{statusCode:400});
  assert.equal(calls.length,0);
  assert.equal((await feed.act(user,{id:'f1',action:'COMPLETE',note:'Cliente pediu proposta'},{now:NOW})).status,'CONCLUIDO');
  await feed.act(user,{id:'f1',action:'RESCHEDULE',date:'2026-10-23',time:'09:00'},{now:NOW});
  assert.deepEqual(calls.map(c=>c[0]),['complete','update']);
  assert.deepEqual(calls[1][3],{date:'2026-10-23',time:'09:00'});
});

test('rule errors from the Agenda (conflict, already finished) propagate unchanged',async()=>{
  failNext=Object.assign(Error('Este retorno já foi concluído ou cancelado.'),{statusCode:409});
  await assert.rejects(feed.act(user,{id:'f1',action:'COMPLETE'}),{statusCode:409,message:/já foi concluído/});
  failNext=null;
});
