const test=require('node:test'),assert=require('node:assert/strict');
const express=require('./attendance/node_modules/express');
const {createIdentityRouter}=require('./attendance/src/routes/central-identity');
const {opaque,proof,requestSignature}=require('./attendance/src/services/central-identity-crypto');
const {client,seed,credentials}=require('./local-fixtures.cjs');
test('real local HTTP: signed backchannel, replay defense, primary password and revocation',async()=>{
 await seed();const p=client('attendance'),env={CENTRAL_IDENTITY_ENABLED:'true',CENTRAL_IDENTITY_SECRET:'fixture-service-key-'.repeat(3),SESSION_SECRET:'fixture-primary-key-'.repeat(3),ATTENDANCE_PUBLIC_URL:'http://127.0.0.1:4037',CRM_PUBLIC_URL:'http://127.0.0.1:4038'};
 const app=express();app.use(express.json({verify:(req,_res,buf)=>req.rawBody=Buffer.from(buf)}));app.use(require('./attendance/node_modules/cookie-parser')());
 const auth={COOKIE_NAME:'test',userFromToken:async()=>null,login:async({email,password})=>{const u=await p.user.findUnique({where:{email}});if(!u?.active||!(await require('./attendance/node_modules/bcryptjs').compare(password,u.passwordHash)))throw Object.assign(Error('invalid'),{statusCode:401});return u;}};
 app.use('/identity',createIdentityRouter({prisma:p,auth,env}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base=`http://127.0.0.1:${server.address().port}`;
 function signed(path,data){const body=JSON.stringify(data),timestamp=Date.now(),nonce=opaque(),signature=requestSignature(env.CENTRAL_IDENTITY_SECRET,{method:'POST',path,body,timestamp,nonce});return{method:'POST',headers:{'Content-Type':'application/json','x-central-time':String(timestamp),'x-central-nonce':nonce,'x-central-signature':signature},body};}
 try{
  assert.equal((await fetch(base+'/identity/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  const input={crmUserId:'merge-local-c',email:credentials.email,password:credentials.password};
  const signedReq=signed('/identity/credentials',input),response=await fetch(base+'/identity/credentials',signedReq);assert.equal(response.status,200);
  const identity=await response.json();assert.equal(identity.attendanceUserId,'merge-local-a');assert.equal(identity.passwordHash,undefined);
  assert.equal((await fetch(base+'/identity/credentials',signedReq)).status,401);
  assert.equal((await fetch(base+'/identity/credentials',signed('/identity/credentials',{...input,password:credentials.oldCrmPassword}))).status,401);
  assert.equal((await fetch(base+'/identity/verify',signed('/identity/verify',identity))).status,200);
  const forged={...identity,primaryProof:proof('other-local-key-'.repeat(4),{attendanceUserId:'merge-local-a',crmUserId:'merge-local-c',sessionVersion:0})};
  assert.equal((await fetch(base+'/identity/verify',signed('/identity/verify',forged))).status,401);
  await p.user.update({where:{id:'merge-local-a'},data:{sessionVersion:{increment:1}}});
  assert.equal((await fetch(base+'/identity/verify',signed('/identity/verify',identity))).status,401);
  assert.equal((await fetch(base+'/identity/callback?state=forged&code=forged')).status,401);
  assert.equal((await fetch(base+'/identity/options')).status,401);
  env.CENTRAL_IDENTITY_ENABLED='false';assert.equal((await fetch(base+'/identity/available')).status,404);
 }finally{await new Promise(r=>server.close(r));await p.$disconnect();await seed();}
});
