const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {client,credentials:creds,seed}=require('./local-fixtures.cjs');
const a='http://127.0.0.1:4037',c='http://127.0.0.1:4038',changed='Changed-by-profile-20261026!',reset='Reset-by-master-20261026!';
(async()=>{
 await seed();const p=client('attendance'),q=client('crm'),bcrypt=require('./attendance/node_modules/bcryptjs'),browser=await chromium.launch({channel:'msedge',headless:true}),results=[];
 async function context(){const ctx=await browser.newContext({serviceWorkers:'block'});ctx.setDefaultTimeout(30000);await ctx.route('**/*',route=>[a,c].some(origin=>route.request().url().startsWith(origin+'/'))?route.continue():route.abort());return ctx;}
 async function login(ctx,email,password){const page=await ctx.newPage();await page.goto(c+'/login');await page.getByLabel('E-mail',{exact:true}).fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();return page;}
 async function check(name,fn){await fn();results.push({name,passed:true});console.log('PASS',name);}
 const seller=await context(),master=await context();let newer;
 try{
  const beforeA=await p.user.findUnique({where:{id:'merge-local-a'}}),beforeC=await q.user.findUnique({where:{id:'merge-local-c'}});
  await seller.request.post(a+'/api/auth/login',{data:{email:creds.email,password:creds.password}});
  const page=await login(seller,creds.email,creds.password);await page.waitForURL(c+'/dashboard',{timeout:120000});
  await check('wrong current primary password cannot change either stored credential',async()=>{
   const response=await seller.request.patch(c+'/api/profile/password',{data:{currentPassword:creds.oldCrmPassword,newPassword:changed}});assert.equal(response.status(),400);
   assert.equal((await p.user.findUnique({where:{id:beforeA.id}})).passwordHash,beforeA.passwordHash);
   assert.equal((await q.user.findUnique({where:{id:beforeC.id}})).passwordHash,beforeC.passwordHash);
  });
  await check('real CRM profile form changes the general password and redirects to re-login',async()=>{
   await page.goto(c+'/perfil');await page.getByText('Esta é sua senha geral do CRM e do Atendimento.',{exact:false}).waitFor();
   await page.getByLabel('Senha atual',{exact:true}).fill(creds.password);await page.getByLabel('Nova senha',{exact:true}).fill(changed);await page.getByLabel('Confirmar nova senha',{exact:true}).fill(changed);
   await page.getByRole('button',{name:'Alterar senha',exact:true}).click();await page.waitForURL(c+'/login?passwordChanged=1',{timeout:60000});
   const after=await p.user.findUnique({where:{id:beforeA.id}});assert.equal(await bcrypt.compare(changed,after.passwordHash),true);assert.equal(after.sessionVersion,beforeA.sessionVersion+1);
   assert.equal((await q.user.findUnique({where:{id:beforeC.id}})).passwordHash,beforeC.passwordHash);
  });
  await check('old sessions and old password stop working; new password works in both apps',async()=>{
   assert.equal((await(await seller.request.get(a+'/api/auth/status')).json()).authenticated,false);
   assert.equal((await(await seller.request.get(c+'/api/auth/session')).json())?.user,undefined);
   assert.equal((await seller.request.post(a+'/api/auth/login',{data:{email:creds.email,password:creds.password}})).status(),401);
   assert.equal((await seller.request.post(a+'/api/auth/login',{data:{email:creds.email,password:changed}})).status(),200);
   newer=await context();const next=await login(newer,creds.email,changed);await next.waitForURL(c+'/dashboard',{timeout:60000});
   const denied=await context();try{const old=await login(denied,creds.email,creds.password);await old.getByText('E-mail ou senha inválidos.').waitFor();}finally{await denied.close();}
  });
  await check('actual Master reset in Attendance supersedes CRM change and revokes its CRM session',async()=>{
   assert.equal((await master.request.post(a+'/api/auth/login',{data:{email:creds.ownerEmail,password:creds.password}})).status(),200);
   assert.equal((await master.request.patch(a+'/api/admin/users/'+beforeA.id,{data:{password:reset}})).status(),200);
   assert.equal((await(await newer.request.get(c+'/api/auth/session')).json())?.user,undefined);
   assert.equal((await seller.request.post(a+'/api/auth/login',{data:{email:creds.email,password:changed}})).status(),401);
   assert.equal((await seller.request.post(a+'/api/auth/login',{data:{email:creds.email,password:reset}})).status(),200);
   const resetContext=await context();try{const resetPage=await login(resetContext,creds.email,reset);await resetPage.waitForURL(c+'/dashboard',{timeout:60000});}finally{await resetContext.close();}
  });
  await check('representative password change remains local to CRM',async()=>{
   const rep=await context();try{
    const repPage=await login(rep,creds.repEmail,creds.repPassword);await repPage.waitForURL(c+'/dashboard',{timeout:60000});
    const oldPrimary=(await p.user.findUnique({where:{id:beforeA.id}})).passwordHash;
    const response=await rep.request.patch(c+'/api/profile/password',{data:{currentPassword:creds.repPassword,newPassword:'Representative-local-new-20261026!'}});assert.equal(response.status(),200);assert.equal((await response.json()).shared,undefined);
    assert.equal((await p.user.findUnique({where:{id:beforeA.id}})).passwordHash,oldPrimary);
    assert.equal(await bcrypt.compare('Representative-local-new-20261026!',(await q.user.findUnique({where:{id:'merge-local-rep'}})).passwordHash),true);
   }finally{await rep.close();}
  });
 }finally{await seller.close();await master.close();if(newer)await newer.close();await browser.close();await p.$disconnect();await q.$disconnect();await seed();fs.writeFileSync('primary-password-browser-results.json',JSON.stringify({at:new Date().toISOString(),syntheticOnly:true,productionAccessed:false,results},null,2));}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
