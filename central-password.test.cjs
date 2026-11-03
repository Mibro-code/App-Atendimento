const test=require('node:test'),assert=require('node:assert/strict');
const {createCentralPasswordService}=require('./attendance/src/services/central-password-service');
function fixture(){
 const user={id:'a',name:'Pessoa',email:'person@local.invalid',active:true,role:'ATENDENTE',passwordHash:'old',sessionVersion:4};
 const link={attendanceUserId:'a',crmUserId:'c',enabled:true,user:{sessionVersion:4}},audits=[];
 let beforeUpdate=()=>{};
 const db={user:{findUnique:async()=>({...user}),updateMany:async({where,data})=>{
   beforeUpdate();
   if(user.id!==where.id||!user.active||user.role==='BOT'||user.passwordHash!==where.passwordHash||user.sessionVersion!==where.sessionVersion||!link.enabled||link.crmUserId!==where.crmIdentityLink.is.crmUserId)return{count:0};
   user.passwordHash=data.passwordHash;user.sessionVersion++;return{count:1};
 }},auditLog:{create:async({data})=>audits.push(data)},$transaction:async fn=>fn(db)};
 const validate=async(proof,id)=>{if(proof!=='valid'||id!==link.crmUserId||!link.enabled)throw Error('Invalid proof');return link;};
 const crypto={compare:async(p,h)=>p===h,hash:async()=> 'new-hash'};
 return{user,link,audits,db,crypto,input:{crmUserId:'c',primaryProof:'valid',currentPassword:'old',newPassword:'new-secret-123'},change:createCentralPasswordService(db,validate,crypto),race:fn=>{beforeUpdate=fn;}};
}
test('changes only primary hash, revokes old sessions and audits without secrets',async()=>{
 const f=fixture();assert.deepEqual(await f.change(f.input),{ok:true,shared:true,reauthenticate:true});assert.equal(f.user.passwordHash,'new-hash');assert.equal(f.user.sessionVersion,5);
 assert.equal(f.user.role,'ATENDENTE');assert.equal(f.audits.length,1);assert.equal(JSON.stringify(f.audits).includes(f.input.newPassword),false);assert.equal(JSON.stringify(f.audits).includes('new-hash'),false);
});
test('wrong current password cannot change primary credential',async()=>{const f=fixture();await assert.rejects(f.change({...f.input,currentPassword:'old-crm-password'}));assert.equal(f.user.passwordHash,'old');assert.equal(f.audits.length,0);});
test('missing/tampered proof and a different CRM identity cannot target a user',async()=>{
 for(const patch of [{primaryProof:undefined},{primaryProof:'forged'},{crmUserId:'other'}]){const f=fixture();await assert.rejects(f.change({...f.input,...patch}));assert.equal(f.user.passwordHash,'old');}
});
test('invalid lengths including UTF-8 bcrypt overflow never write a password',async()=>{
 for(const patch of [{newPassword:'short'},{newPassword:'é'.repeat(37)},{currentPassword:'a'.repeat(1025)}]){const f=fixture();await assert.rejects(f.change({...f.input,...patch}));assert.equal(f.user.passwordHash,'old');}
});
test('inactive/bot/expired primary accounts cannot change password',async()=>{
 for(const patch of [{active:false},{role:'BOT'},{sessionVersion:5}]){const f=fixture();Object.assign(f.user,patch);await assert.rejects(f.change(f.input));assert.equal(f.audits.length,0);}
});
test('Master reset during hashing cannot be overwritten by the stale CRM request',async()=>{
 const f=fixture();f.race(()=>{f.user.passwordHash='master-password-hash';f.user.sessionVersion++;});
 await assert.rejects(f.change(f.input),{statusCode:409});assert.equal(f.user.passwordHash,'master-password-hash');assert.equal(f.audits.length,0);
});
test('disable/relink during request fails the final conditional write',async()=>{
 for(const action of [f=>{f.link.enabled=false;},f=>{f.link.crmUserId='other';}]){const f=fixture();f.race(()=>action(f));await assert.rejects(f.change(f.input),{statusCode:409});assert.equal(f.user.passwordHash,'old');}
});
test('later Master reset remains the only password after a completed CRM change',async()=>{
 const f=fixture();await f.change(f.input);f.user.passwordHash='master-password-hash';f.user.sessionVersion++;
 await assert.rejects(f.change({...f.input,currentPassword:'new-hash'}));assert.equal(f.user.passwordHash,'master-password-hash');assert.equal(f.user.sessionVersion,6);
});
