const test=require('node:test'),assert=require('node:assert/strict');
const {createGrantService}=require('./attendance/src/services/central-identity-grants');
const {opaque,hash}=require('./attendance/src/services/central-identity-crypto');
function fixture() {
 let now=1800000000000;
 const rows=new Map(),nonces=new Set();
 const user={id:'a',active:true,role:'ATENDENTE',sessionVersion:2};
 const link={attendanceUserId:'a',crmUserId:'c',enabled:true,user};
 const db={centralIdentityGrant:{
  create:async({data})=>rows.set(data.codeHash,{...data,usedAt:null}),
  findUnique:async({where})=>{const r=rows.get(where.codeHash);return r?{...r}:null;},
  updateMany:async({where,data})=>{const r=rows.get(where.codeHash);if(!r||r.usedAt||r.expiresAt<=where.expiresAt.gt)return{count:0};r.usedAt=data.usedAt;return{count:1};}
 },centralCrmIdentity:{findUnique:async()=>link},centralIdentityNonce:{create:async({data})=>{if(nonces.has(data.id))throw Error('unique');nonces.add(data.id);}},$transaction:async f=>f(db)};
 const service=createGrantService(db,{clock:()=>new Date(now)}),verifier=opaque();
 return {service,user,link,verifier,advance:n=>now+=n,issue:()=>service.issue({user,link,audience:'crm',pkceChallenge:hash(verifier)})};
}
test('grant is opaque, bound to PKCE/audience, and consumable once',async()=>{
 const f=fixture(),code=await f.issue();assert.equal(code.length,43);
 await assert.rejects(f.service.consume({code,verifier:opaque(),audience:'crm'}));
 await assert.rejects(f.service.consume({code,verifier:f.verifier,audience:'attendance'}));
 assert.deepEqual(await f.service.consume({code,verifier:f.verifier,audience:'crm'}),{attendanceUserId:'a',crmUserId:'c',sessionVersion:2});
 await assert.rejects(f.service.consume({code,verifier:f.verifier,audience:'crm'}));
});
test('two concurrent callbacks cannot both exchange a code',async()=>{
 const f=fixture(),code=await f.issue(),input={code,verifier:f.verifier,audience:'crm'};
 const results=await Promise.allSettled([f.service.consume(input),f.service.consume(input)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('expired, revoked, disabled or re-linked identities reject issued grants',async()=>{
 for(const change of [f=>f.advance(60000),f=>f.user.sessionVersion++,f=>f.user.active=false,f=>f.link.enabled=false,f=>f.link.crmUserId='other']) {
  const f=fixture(),code=await f.issue();change(f);
  await assert.rejects(f.service.consume({code,verifier:f.verifier,audience:'crm'}));
 }
});
test('no grant for inactive, bot, unlinked or incorrectly linked user',async()=>{
 for(const change of [f=>f.user.active=false,f=>f.user.role='BOT',f=>f.link.enabled=false,f=>f.link.attendanceUserId='other']){
  const f=fixture();change(f);await assert.rejects(f.issue());
 }
});
test('nonce persistence rejects duplicates',async()=>{
 const f=fixture(),nonce=opaque();assert.equal(await f.service.consumeNonce(nonce,new Date()),true);assert.equal(await f.service.consumeNonce(nonce,new Date()),false);
});
