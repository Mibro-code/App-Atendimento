const test=require('node:test'),assert=require('node:assert/strict');
const c=require('./attendance/src/services/central-identity-crypto');
const secret='local-test-only-'.repeat(4),now=1800000000000;
const claims={attendanceUserId:'a',crmUserId:'c',sessionVersion:3};
test('primary proof preserves IDs and does not include roles/passwords',()=>{
 const token=c.proof(secret,claims,now),p=c.readProof(secret,token,now);
 assert.equal(p.sub,'a');assert.equal(p.crm,'c');assert.equal(p.sv,3);
 assert.equal(p.role,undefined);assert.equal(p.passwordHash,undefined);
});
test('primary proof rejects wrong key, tamper, future and expiry',()=>{
 const token=c.proof(secret,claims,now);
 assert.equal(c.readProof('different-key'.repeat(4),token,now),null);
 assert.equal(c.readProof(secret,token+'x',now),null);
 assert.equal(c.readProof(secret,token,now-1000),null);
 assert.equal(c.readProof(secret,token,now+43200000),null);
});
test('service requests bind body/path and reject replay across consumers',async()=>{
 const r={method:'POST',path:'/identity/verify',body:'{"id":"a"}',timestamp:now,nonce:c.opaque()};
 r.signature=c.requestSignature(secret,r);
 const seen=new Set(),consume=async n=>{if(seen.has(n))return false;seen.add(n);return true;};
 assert.equal(await c.verifyRequest(secret,{...r,body:'{}'},consume,now),false);
 assert.equal(await c.verifyRequest(secret,{...r,path:'/identity/other'},consume,now),false);
 assert.equal(await c.verifyRequest(secret,r,consume,now),true);
 assert.equal(await c.verifyRequest(secret,r,consume,now),false);
});
test('expired request, unavailable nonce store and weak keys fail closed',async()=>{
 const r={method:'POST',path:'/identity/verify',body:'',timestamp:now,nonce:c.opaque()};
 r.signature=c.requestSignature(secret,r);
 assert.equal(await c.verifyRequest(secret,r,async()=>true,now+60001),false);
 assert.equal(await c.verifyRequest(secret,r,async()=>{throw Error('db unavailable');},now),false);
 assert.throws(()=>c.proof('short',claims,now));
});
