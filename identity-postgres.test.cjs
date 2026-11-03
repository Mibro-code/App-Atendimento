const test=require('node:test'),assert=require('node:assert/strict');
const {client,seed}=require('./local-fixtures.cjs');
const {createGrantService}=require('./attendance/src/services/central-identity-grants');
const {opaque,hash}=require('./attendance/src/services/central-identity-crypto');
test('real PostgreSQL: one callback wins under concurrency; account revocation rejects grants',async()=>{
 await seed();const p=client('attendance');
 try{
  const service=createGrantService(p),user=await p.user.findUnique({where:{id:'merge-local-a'}}),link=await p.centralCrmIdentity.findUnique({where:{attendanceUserId:user.id}}),verifier=opaque();
  const code=await service.issue({user,link,audience:'crm',pkceChallenge:hash(verifier)});
  const results=await Promise.allSettled(Array.from({length:10},()=>service.consume({code,verifier,audience:'crm'})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const second=await service.issue({user,link,audience:'crm',pkceChallenge:hash(verifier)});
  await p.user.update({where:{id:user.id},data:{sessionVersion:{increment:1}}});
  await assert.rejects(service.consume({code:second,verifier,audience:'crm'}));
  const nonce=opaque(),nonces=await Promise.all(Array.from({length:10},()=>service.consumeNonce(nonce,new Date(Date.now()+120000))));
  assert.equal(nonces.filter(Boolean).length,1);
 }finally{await p.$disconnect();await seed();}
});
