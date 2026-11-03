const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {client,url}=require('./commercial-owner-local-db.cjs');process.env.DATABASE_URL=url;
const p=client(),inbox=require('./attendance/src/services/inbox-service');
after(async()=>{await p.$disconnect();await require('./attendance/src/database/prisma').$disconnect();});
test('Minhas uses existing server-side responsibility and workspace scope',async t=>{
 const prefix='my-conversations-local-'+Date.now();
 const user=await p.user.create({data:{email:prefix+'@local.invalid',name:'Vendedor fictício',role:'ADMIN'}}),other=await p.user.create({data:{email:prefix+'-other@local.invalid',name:'Outro fictício',role:'ADMIN'}});
 await p.company.upsert({where:{id:'cmp_sincrofit'},update:{},create:{id:'cmp_sincrofit',name:'Sincrofit fictícia',slug:'sincrofit',displayName:'SINCROFIT',primaryColor:'#008899'}});
 async function fixture(suffix,companyId,assignedUserId,preferredAssigneeId,status='AGUARDANDO_CLIENTE'){
  const id=prefix+'-'+suffix;await p.contact.create({data:{id,companyId,externalId:id,name:'Contato fictício '+suffix,preferredAssigneeId,preferredAssigneeEnabled:Boolean(preferredAssigneeId)}});
  return p.conversation.create({data:{id,companyId,contactId:id,channel:'META',assignedUserId,status}});
 }
 const own=await fixture('own','cmp_mibro',user.id,other.id),fixedButNotOwn=await fixture('fixed','cmp_mibro',other.id,user.id),free=await fixture('free','cmp_mibro',null,null),foreign=await fixture('sincro','cmp_sincrofit',user.id,null),closed=await fixture('closed','cmp_mibro',user.id,null,'FINALIZADO');
 const list=async company=>(await inbox.listConversations({assignedUser:user.id,company,search:'Contato fictício'},user)).filter(c=>c.id.startsWith(prefix));
 await t.test('current owner only, not fixed owner or free queue',async()=>{const rows=await list('mibro');assert.ok(rows.some(c=>c.id===own.id));assert.ok(rows.every(c=>c.assignedUserId===user.id));assert.ok(!rows.some(c=>[fixedButNotOwn.id,free.id].includes(c.id)));});
 await t.test('workspace stays isolated even when owner has access to both',async()=>{assert.ok(!(await list('mibro')).some(c=>c.id===foreign.id));assert.deepEqual((await list('sincrofit')).map(c=>c.id),[foreign.id]);});
 await t.test('assigned finalized conversations are included',async()=>{assert.ok((await list('mibro')).some(c=>c.id===closed.id));});
 await t.test('transfer to another seller removes the contact from Minhas',async()=>{await p.conversation.update({where:{id:own.id},data:{assignedUserId:other.id}});assert.ok(!(await list('mibro')).some(c=>c.id===own.id));});
});
