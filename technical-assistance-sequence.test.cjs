const test=require('node:test'),assert=require('node:assert/strict');
const {technicalAssistanceGraph}=require('./attendance/src/services/technical-assistance-sequence');
const {validateGraph}=require('./attendance/src/services/bot-visual-flow-graph');
const {runTurn}=require('./attendance/src/services/bot-visual-flow-engine');
async function turn({state,text='',messageType,seed={}}={}){
 const sent=[],handoffs=[];const result=await runTurn({graph:technicalAssistanceGraph(),state,
  seed:{bot:{assistantAfterTriage:true},flow:{initialCategoryId:'technical',...seed}},
  input:state?{type:'MESSAGE',text,messageType}:{type:'START'},
  adapter:{send:async text=>sent.push(text),handoff:async value=>handoffs.push(value)}});
 return{...result,sent,handoffs};
}
test('technical graph is valid and asks documents once before collecting model and problem',async()=>{
 assert.equal(validateGraph(technicalAssistanceGraph()).valid,true);
 let t=await turn();assert.equal(t.state.status,'WAITING_CUSTOMER');assert.match(t.sent[0],/Serial Number/);assert.match(t.sent[1],/modelo/);
 t=await turn({state:t.state,text:'GS Pro'});assert.equal(t.sent.length,1);assert.match(t.sent[0],/deixou de funcionar/);
 t=await turn({state:t.state,text:'Parou de carregar'});assert.match(t.sent[0],/Há quanto tempo/);
 t=await turn({state:t.state,text:'Ontem; ainda não tentei nada'});assert.equal(t.state.status,'HANDED_OFF');assert.match(t.handoffs[0].reason,/GS Pro.*Parou de carregar.*Ontem/s);
 assert.equal(t.handoffs[0].categoryId,'technical');
});
test('known model and triage problem are reused without repeating questions',async()=>{
 const t=await turn({seed:{model:'A2',initialNeed:'Meu relógio não carrega'}});
 assert.equal(t.state.context.flow.customerProblem,'Meu relógio não carrega');assert.equal(t.sent.length,2);assert.match(t.sent[1],/Há quanto tempo/);
});
test('documents do not consume attempts, trigger repeated questions or approve warranty',async()=>{
 const first=await turn();let t=await turn({state:first.state,messageType:'document'});
 assert.equal(t.state.status,'WAITING_CUSTOMER');assert.equal(t.sent.length,0);assert.deepEqual(t.state.context._engine.attempts,{});
 t=await turn({state:t.state,messageType:'image'});assert.equal(t.sent.length,0);assert.equal(t.state.context.flow.technicalAttachmentCount,2);
 t=await turn({state:t.state,text:'A2'});assert.match(t.sent[0],/deixou de funcionar/);
});
test('explicit request for an attendant ends collection without extra questions',async()=>{
 const first=await turn();const t=await turn({state:first.state,text:'quero falar com atendente'});assert.equal(t.state.status,'HANDED_OFF');
});
test('invalid written answers have a bounded human fallback',async()=>{
 let t=await turn();t=await turn({state:t.state,text:''});t=await turn({state:t.state,text:''});assert.equal(t.state.status,'HANDED_OFF');
});
test('problem supplied instead of model is remembered and not requested again',async()=>{
 let t=await turn();t=await turn({state:t.state,text:'meu mibro parou de carregar'});
 assert.match(t.sent[0],/Já registrei/);assert.equal(t.state.context.flow.customerProblem,'meu mibro parou de carregar');
 t=await turn({state:t.state,text:'A2'});assert.match(t.sent[0],/Há quanto tempo/);assert.equal(t.state.context.flow.model,'A2');
});
