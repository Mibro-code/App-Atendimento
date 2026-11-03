const test = require('node:test');
const assert = require('node:assert/strict');
const {senderState,applySender} = require('../src/services/whatsapp-inbox-service');
const master={id:'master',role:'ADMIN',active:true};
const agent={id:'agent',role:'ATENDENTE',active:true};
const conversation={id:'conversation',companyId:'company',contactId:'contact',categoryId:'finance',channel:'META'};
const legacy={id:'primary',name:'Principal',enabled:true,status:'CONNECTED',config:{isLegacyWhatsApp:true},accessUsers:[]};
const commercial={id:'commercial',name:'Comercial',enabled:true,status:'CONNECTED',config:{outboundCategoryIds:['sales']},accessUsers:[]};
const setup=(accounts=[legacy,commercial],incoming=null,hasMessage=true)=>({
  channelAccount:{findMany:async query=>{assert.equal(query.where.companyId,'company');return accounts}},
  category:{findUnique:async query=>({id:query.where.id,parentId:null})},
  message:{findFirst:async()=>hasMessage?{channelAccountId:incoming}:null},
  contact:{findUnique:async()=>({whatsappInboxId:conversation.id})},
  user:{findUnique:async()=>master},
});

test('Master no Financeiro sem remetente usa o número original, sem precisar assumir a conversa',async()=>{
  const db=setup();
  const state=await senderState(conversation,master,db);
  assert.equal(state.selectedId,'legacy');
  assert.equal(state.reason,null);
  assert.equal((await applySender({...conversation},master.id,db)).channelAccountId,null);
  assert.equal((await senderState(conversation,master,setup(undefined,'commercial'))).selectedId,'commercial');
});
test('Master pode indicar conta disponível da mesma empresa no setor sem remetente',async()=>{
  assert.equal((await senderState(conversation,master,setup(),'commercial')).selectedId,'commercial');
  await assert.rejects(applySender({...conversation},master.id,setup(),'unknown'),e=>e.code==='WHATSAPP_SENDER_REQUIRED');
});
test('atendente e bot continuam bloqueados quando o setor não possui número',async()=>{
  assert.equal((await senderState(conversation,agent,setup())).selectedId,null);
  assert.equal((await senderState(conversation,null,setup())).selectedId,null);
});
test('Master não pula conta desconectada, remetente explícito ou configuração ambígua',async()=>{
  assert.equal((await senderState(conversation,master,setup([{...legacy,enabled:false},commercial]))).selectedId,null);
  const configured={...conversation,categoryId:'sales'};
  assert.equal((await senderState(configured,master,setup(),'legacy')).selectedId,'commercial');
  const ambiguous=[{...legacy,config:{...legacy.config,outboundCategoryIds:['finance']}},{...commercial,config:{outboundCategoryIds:['finance']}}];
  assert.equal((await senderState(conversation,master,setup(ambiguous))).selectedId,null);
  assert.equal((await senderState(conversation,master,setup(undefined,null,false))).selectedId,null);
});
