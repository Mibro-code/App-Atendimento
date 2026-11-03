const test=require('node:test'),assert=require('node:assert/strict');
const express=require('./attendance/node_modules/express');
const jwt=require('./attendance/node_modules/jsonwebtoken');
const {createIdentityRouter}=require('./attendance/src/routes/central-identity');
const {opaque,requestSignature}=require('./attendance/src/services/central-identity-crypto');

test('HTTP management: Master, origin, expiring ticket, replay and signed service boundaries',async()=>{
  const env={CENTRAL_IDENTITY_ENABLED:'true',CENTRAL_IDENTITY_SECRET:'fixture-service-'.repeat(4),SESSION_SECRET:'fixture-session-'.repeat(4),ATTENDANCE_PUBLIC_URL:'http://127.0.0.1:4037',CRM_PUBLIC_URL:'http://127.0.0.1:4038'};
  const master={id:'master',role:'ADMIN',active:true,sessionVersion:2}; let session=null, updates=0;
  const nonces=new Set();
  const prisma={user:{findFirst:async({where})=>where.id===master.id&&where.sessionVersion===master.sessionVersion&&master.active?master:null,
    findUnique:async()=>({id:'a',name:'Pessoa',email:'person@example.invalid',active:true,role:'ATENDENTE'})},
    centralCrmIdentity:{findUnique:async()=>null,updateMany:async()=>{updates++;return{count:0};}},
    centralIdentityNonce:{create:async({data})=>{if(nonces.has(data.id))throw Error('unique');nonces.add(data.id);},deleteMany:async()=>({count:0})},
    centralIdentityGrant:{deleteMany:async()=>({count:0})},crmContactSelection:{deleteMany:async()=>({count:0})},$transaction:async fn=>fn(prisma)};
  const auth={COOKIE_NAME:'session',userFromToken:async()=>session};
  const app=express();app.use(express.json({verify:(req,_res,buf)=>req.rawBody=Buffer.from(buf)}));
  app.use('/identity',createIdentityRouter({prisma,auth,env}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const signed=(path,data)=>{const body=JSON.stringify(data),timestamp=Date.now(),nonce=opaque();return{method:'POST',headers:{'Content-Type':'application/json','x-central-time':String(timestamp),'x-central-nonce':nonce,'x-central-signature':requestSignature(env.CENTRAL_IDENTITY_SECRET,{method:'POST',path,body,timestamp,nonce})},body};};
  const ticket=(patch={},options={})=>jwt.sign({sv:2,target:'a',operation:'inspect',...patch},env.SESSION_SECRET,{subject:'master',audience:'crm-access-admin',jwtid:opaque(),expiresIn:60,...options});
  try{
    assert.equal((await fetch(base+'/identity/admin-access/a')).status,403);
    session={...master,role:'ATENDENTE'};assert.equal((await fetch(base+'/identity/admin-access/a')).status,403);
    session=master;
    const post={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false})};
    assert.equal((await fetch(base+'/identity/admin-access/a',post)).status,403);
    assert.equal((await fetch(base+'/identity/admin-access/a',{...post,headers:{...post.headers,Origin:'https://attacker.invalid'}})).status,403);
    assert.equal(updates,0);
    assert.equal((await fetch(base+'/identity/admin-access/a',{...post,headers:{...post.headers,Origin:env.ATTENDANCE_PUBLIC_URL}})).status,200);
    assert.equal(updates,1);
    for(const path of ['/identity/access-admin','/identity/access-reserve','/identity/access-commit','/identity/password'])assert.equal((await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    const path='/identity/access-admin',value=ticket();
    let response=await fetch(base+path,signed(path,{ticket:value}));assert.equal(response.status,200);const data=await response.json();assert.equal(data.target.email,'person@example.invalid');assert.equal(data.target.passwordHash,undefined);
    assert.equal((await fetch(base+path,signed(path,{ticket:value}))).status,401);
    assert.notEqual((await fetch(base+path,signed(path,{ticket:ticket({sv:1})}))).status,200);
    assert.notEqual((await fetch(base+path,signed(path,{ticket:ticket({}, {expiresIn:-1})}))).status,200);
    assert.notEqual((await fetch(base+path,signed(path,{ticket:ticket({operation:'delete'})}))).status,200);
    master.active=false;assert.notEqual((await fetch(base+path,signed(path,{ticket:ticket()}))).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
