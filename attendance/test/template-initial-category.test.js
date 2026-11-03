const test = require('node:test');
const assert = require('node:assert/strict');
const { initialCategory, persistInitialCategory } = require('../src/services/template-initial-category-service');
const { walkConversation } = require('../src/services/productivity-service');
const conversation = {id:'c',companyId:'mibro',contactId:'p',channel:'META',channelAccountId:'commercial',categoryId:null,status:'NOVO',updatedAt:new Date()};
const category = {id:'atacado',parentId:'comercial',name:'Atacado'};
function client({prior=false,foreign=false,active=true,mapped=true,configured=true}={}) {
  return {channelAccount:{findUnique:async()=>({companyId:foreign?'other':'mibro',enabled:true,status:'CONNECTED',config:{outboundTemplateCategoryId:configured?'atacado':undefined,outboundCategoryIds:mapped?['atacado']:[]}})},category:{findFirst:async()=>active?category:null},message:{findFirst:async()=>prior?{id:'old'}:null}};
}
test('template comercial inicia em Atacado e pode reiniciar ciclo finalizado',async()=>{
  assert.deepEqual(await initialCategory(conversation,'commercial',client()),category);
  assert.deepEqual(await initialCategory({...conversation,status:'FINALIZADO'},'commercial',client({prior:true})),category);
});
test('não muda atendimento em andamento, outro número/empresa ou configuração inválida',async()=>{
  assert.equal(await initialCategory(conversation,'commercial',client({prior:true})),null);
  for(const options of [{foreign:true},{active:false},{mapped:false},{configured:false}]) assert.equal(await initialCategory(conversation,'commercial',client(options)),null);
  assert.equal(await initialCategory(conversation,'legacy',client()),null);
  assert.equal(await initialCategory({...conversation,channel:'EMAIL'},'commercial',client()),null);
});
test('persistência após envio usa compare-and-set e registra categoria sem sobrescrever transferência simultânea',async()=>{
  let recorded=0;
  const db={conversation:{updateMany:async q=>{assert.equal(q.where.updatedAt,conversation.updatedAt);assert.equal(q.where.status,'NOVO');assert.equal(q.data.categoryId,'atacado');return{count:1}}},conversationActivity:{create:async()=>recorded++}};
  await persistInitialCategory(db,conversation,category,'agent',new Date());assert.equal(recorded,1);
  db.conversation.updateMany=async()=>({count:0});
  await persistInitialCategory(db,conversation,category,'agent',new Date());assert.equal(recorded,1);
});
test('produtividade exclui noite/fim de semana da resposta sem alterar reabertura de 24h',()=>{
  const friday=new Date('2026-10-09T19:00:00Z'),monday=new Date('2026-10-12T12:00:00Z');
  const c={...conversation,createdAt:friday};
  const walk=walkConversation(c,[{direction:'RECEBIDA',occurredAt:friday},{direction:'ENVIADA',sentByUserId:'agent',occurredAt:monday}],[],{from:friday});
  assert.equal(walk.responses[0].seconds,7200);
});
