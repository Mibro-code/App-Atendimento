const {test}=require('node:test'),assert=require('node:assert/strict');
const {createConversationContext}=require('./attendance/src/services/crm-conversation-context');
function fixture(){
  const calls=[];let allowed=true;
  const prisma={company:{findMany:async q=>{calls.push(q);return [{id:'mibro'}];}},conversation:{findFirst:async q=>{calls.push(q);return allowed?{id:'conv',company:{id:'mibro'},contact:{phone:'5511987654321'}}:null;},findMany:async q=>{calls.push(q);return [];}}};
  const scope={id:{in:['permitted-conversation']}};
  const service=createConversationContext({prisma,authorization:{conversationScope:async()=>scope},companies:{accessibleCompanyIds:async()=>['mibro']},phoneVariants:p=>[p]});
  return {service,calls,scope,deny:()=>allowed=false};
}
test('CRM card reuses conversation read scope and returns no message bodies',async()=>{
  const {service,calls,scope}=fixture(),data=await service.conversation({id:'agent'},'conv');
  assert.deepEqual(calls[0].where.AND,[{id:'conv',channel:'META'},scope]);assert.deepEqual(data.phones,['5511987654321']);assert.equal(data.messages,undefined);
});
test('inaccessible or invalid conversation cannot be inspected',async()=>{
  const f=fixture();f.deny();await assert.rejects(f.service.conversation({},'conv'),{statusCode:404});await assert.rejects(f.service.conversation({},{}),{statusCode:404});
});
test('customer lookup enforces selected company AND the unchanged inbox scope',async()=>{
  const {service,calls,scope}=fixture();await service.conversations({},'mibro',['5511987654321']);
  const q=calls[0];assert.equal(q.take,20);assert.deepEqual(q.where.AND[0],scope);assert.equal(q.where.AND[1].companyId,'mibro');assert.equal(q.where.AND[1].contact.is.companyId,'mibro');assert.equal(q.select.messages,undefined);
});
test('other companies and malformed/excessive phone lists fail closed without querying',async()=>{
  const {service,calls}=fixture();for(const [company,phones]of [['sincrofit',['5511987654321']],['mibro',[]],['mibro',['12']],['mibro',Array(4).fill('5511987654321')]])await assert.rejects(service.conversations({},company,phones),{statusCode:404});assert.equal(calls.length,0);
});
test('company picker uses company access, not campaign privileges',async()=>{
  const {service,calls}=fixture();await service.options({canManageCampaigns:false});assert.deepEqual(calls[0].where.id,{in:['mibro']});
});

test('import requires operational permission, not supervisor read access',async()=>{
  let queried=false;
  const service=createConversationContext({prisma:{conversation:{findFirst:async()=>{queried=true;}}},authorization:{assertCanActOnConversation:async()=>{throw Object.assign(Error('Read only'),{statusCode:403});}}});
  await assert.rejects(service.conversation({id:'observer'},'conv',true),{statusCode:403});assert.equal(queried,false);
});

test('stable CRM links preserve current company and conversation authorization',async()=>{
  const {service,calls,scope}=fixture();await service.conversations({},'mibro',[],['linked-contact']);
  assert.deepEqual(calls[0].where.AND[0],scope);assert.equal(calls[0].where.AND[1].companyId,'mibro');assert.deepEqual(calls[0].where.AND[1].contact.is.OR[2],{id:{in:['linked-contact']}});
  await assert.rejects(service.conversations({},'mibro',[],Array(21).fill('one')),{statusCode:404});
});
test('lazy UI loads no frame while closed and never reloads on repeated messages',()=>{
  const host={dataset:{},children:[],replaceChildren(...items){this.children=items;}},status={},tab={},button={addEventListener(){}};
  let open=false,created=0;
  const document={querySelector(selector){return ({'#crm-context-frame':host,'#crm-context-status':status,'#crm-contact-open':button,'[data-context-tab="crm"]':tab})[selector]||((selector==='.workspace.context-open'||selector==='[data-context-tab="crm"].active')&&open?{}:null);},createElement(){created++;return {};}};
  const window={};require('node:vm').runInNewContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'attendance/public/js/crm-context.js'),'utf8'),{window,document,URL});
  const ui=window.CrmContext;ui.enable('http://127.0.0.1:4038');ui.select('first');assert.equal(created,0);
  open=true;ui.show();assert.equal(created,1);const frame=host.children[0];for(let i=0;i<100;i++)ui.select('first');ui.show();assert.equal(created,1);assert.equal(host.children[0],frame);
  ui.select(null);assert.equal(host.children.length,0);assert.equal(button.hidden,true);ui.select('second');assert.equal(created,2);assert.match(host.children[0].src,/second/);
});
