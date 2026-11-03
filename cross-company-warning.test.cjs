const {test}=require('node:test'),assert=require('node:assert/strict');
const {createWarnings}=require('./attendance/src/services/cross-company-contact-warning');
function setup({visible=['current','other'],contacts=[],batches=[],allow=true}={}){
  const queries=[];
  const db={contact:{findMany:async q=>{queries.push(q);return contacts;}},campaignContact:{findMany:async q=>{queries.push(q);return batches;}},company:{findMany:async q=>q.where.id.in.map(id=>({id,name:id==='other'?'Mibro Brasil':'Sincrofit'}))}};
  const auth={forCompany:async()=>{if(!allow)throw Object.assign(Error('denied'),{statusCode:403});return {};},canStartConversations:()=>true,canManageCampaigns:()=>false,forbidden:()=>Object.assign(Error('denied'),{statusCode:403})};
  return {queries,check:createWarnings({db,auth,companyService:{accessibleCompanyIds:async()=>visible}}).check};
}
test('outreach signal is exact-phone based, excludes current company and failed/queued/inbound messages',async()=>{
  const f=setup({contacts:[{phone:'5511987654321',companyId:'other'}]});const rows=await f.check({},'current',['(11) 98765-4321','11911112222']);
  assert.equal(rows[0].contactedElsewhere,true);assert.deepEqual(rows[0].companies,['Mibro Brasil']);assert.equal(rows[1].contactedElsewhere,false);
  assert.deepEqual(f.queries[0].where.companyId,{not:'current'});assert.deepEqual(f.queries[0].where.conversations.some.messages.some,{direction:'ENVIADA',status:{in:['ENVIADA','ENTREGUE','LIDA']}});
  assert.equal(f.queries[1].where.isTest,false);assert.deepEqual(f.queries[1].where.status.in,['SENT','DELIVERED','READ','REPLIED']);
});
test('restricted-company existence warning never exposes source IDs or source details',async()=>{
 const f=setup({visible:['current'],batches:[{phone:'5511987654321',campaign:{companyId:'secret-company'}}]});const [row]=await f.check({},'current',['5511987654321']);
 assert.equal(row.contactedElsewhere,true);assert.equal(row.restrictedCompany,true);assert.deepEqual(row.companies,[]);assert.equal(JSON.stringify(row).includes('secret-company'),false);assert.deepEqual(Object.keys(row).sort(),['companies','contactedElsewhere','phone','restrictedCompany']);
});
test('invalid phones do not query history and inaccessible current company is denied',async()=>{
 const f=setup();assert.equal((await f.check({},'current',['123']))[0].contactedElsewhere,false);assert.equal(f.queries.length,0);await assert.rejects(f.check({},'current',Array(501).fill('11987654321')),{statusCode:400});await assert.rejects(setup({allow:false}).check({},'current',['11987654321']),{statusCode:403});
});
test('phone 9-digit variants match without merging client identities',async()=>{
 const f=setup({contacts:[{phone:'551187654321',companyId:'other'}]});const rows=await f.check({},'current',['5511987654321','551187654321']);assert.ok(rows.every(row=>row.contactedElsewhere));assert.equal(rows.length,2);
});
test('warning UI requests explicit continuation, preserves cancel and never treats lookup errors as a clean result',async()=>{
 let prompts=0,accept=false,fail=false,requests=0;
 const window={confirm:()=>{prompts++;return accept;}},banner={};
 require('node:vm').runInNewContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'attendance/public/js/contact-warning.js'),'utf8'),{window,document:{querySelector:()=>banner},Map,Set,Date,JSON,AbortSignal,fetch:async()=>{requests++;if(fail)throw Error('offline');return {ok:true,json:async()=>({warnings:[{contactedElsewhere:true,companies:[],restrictedCompany:true}]})};}});
 assert.equal(await window.ContactWarning.confirm({conversationId:'one'}),false);accept=true;assert.equal(await window.ContactWarning.confirm({conversationId:'one'}),true);assert.equal(await window.ContactWarning.confirm({conversationId:'one'}),true);assert.equal(prompts,2);assert.equal(requests,1);
 fail=true;accept=false;assert.equal(await window.ContactWarning.confirm({phone:'another'}),false);assert.equal(prompts,3);
});
