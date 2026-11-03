const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {client,credentials}=require('./local-fixtures.cjs');
const a='http://127.0.0.1:4037',c='http://127.0.0.1:4038';
(async()=>{
 const p=client('attendance'),q=client('crm'),browser=await chromium.launch({channel:'msedge',headless:true}),results=[];
 const suffix=Date.now(),password=credentials.password,crmPassword=credentials.oldCrmPassword;
 const autoEmail=`auto-${suffix}@local.invalid`,manualEmail=`manual-${suffix}@local.invalid`,repEmail=`rep-${suffix}@local.invalid`;
 const bcrypt=require('./attendance/node_modules/bcryptjs'),passwordHash=await bcrypt.hash(password,10);
 async function context(){const ctx=await browser.newContext({serviceWorkers:'block'});ctx.setDefaultTimeout(30000);await ctx.route('**/*',route=>[a,c].some(origin=>route.request().url().startsWith(origin+'/'))?route.continue():route.abort());return ctx;}
 async function login(ctx,email,pass){const page=await ctx.newPage();await page.goto(c+'/login');await page.getByLabel('E-mail',{exact:true}).fill(email);await page.getByLabel('Senha',{exact:true}).fill(pass);await page.getByRole('button',{name:'Entrar',exact:true}).click();return page;}
 async function check(name,fn){await fn();results.push({name,passed:true});console.log('PASS',name);}
 const master=await context(),seller=await context();
 try{
  const people=await Promise.all([autoEmail,manualEmail,repEmail].map(email=>p.user.create({data:{name:'Teste CRM Access',email,passwordHash,role:'ATENDENTE'}})));
  await master.request.post(a+'/api/auth/login',{data:{email:credentials.ownerEmail,password}});
  const ownerPage=await login(master,credentials.ownerEmail,password);await ownerPage.waitForURL(c+'/dashboard',{timeout:120000});
  let auto;
  await check('create CRM account auto-links same-email Attendance account in both real local databases',async()=>{
   const response=await master.request.post(c+'/api/users',{data:{name:'Teste Auto CRM',email:autoEmail,password:crmPassword,role:'VENDEDOR'}});
   assert.equal(response.status(),201);const body=await response.json();assert.equal(body.centralAccess.status,'LINKED');auto=body.user;
   assert.equal((await p.centralCrmIdentity.findUnique({where:{attendanceUserId:people[0].id}})).crmUserId,auto.id);
   const mirror=await q.centralIdentityLink.findUnique({where:{userId:auto.id}});assert.equal(mirror.attendanceUserId,people[0].id);assert.equal(mirror.enabled,true);
  });
  await check('new linked account logs into CRM with Attendance password, not the newly supplied CRM password',async()=>{
   const page=await login(seller,autoEmail,password);await page.waitForURL(c+'/dashboard',{timeout:60000});
   const response=await seller.request.post(a+'/api/auth/login',{data:{email:autoEmail,password}});assert.equal(response.status(),200);
   assert.equal((await(await seller.request.get(a+'/identity/options')).json()).crmAvailable,true);
   const rejected=await context();try{const page2=await login(rejected,autoEmail,crmPassword);await page2.getByText('E-mail ou senha inválidos.').waitFor();assert.equal((await(await rejected.request.get(c+'/api/auth/session')).json())?.user,undefined);}finally{await rejected.close();}
  });
  const manual=await q.user.create({data:{name:'Teste Manual CRM',email:manualEmail,role:'VENDEDOR',passwordHash:await bcrypt.hash(crmPassword,10),sellerProfile:{create:{displayName:'Teste Manual CRM'}}}});
  const path=a+'/identity/admin-access/'+people[1].id;
  await check('Master sees existing CRM account and links using the real Team UI',async()=>{
   const page=await master.newPage();await page.goto(a+'/');await page.locator('#team-button').click();await page.locator(`[data-edit-user="${people[1].id}"]`).click();
   await page.locator('#team-crm-access-toggle').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#team-crm-access-toggle').disabled);
   assert.match(await page.locator('#team-crm-access-status').textContent(),/Teste Manual CRM/);
   page.once('dialog',dialog=>dialog.accept());await page.locator('#team-crm-access-toggle').click();await page.waitForFunction(()=>document.querySelector('#team-crm-access-status').textContent.includes('Acesso compartilhado ativo'));
   assert.equal((await q.centralIdentityLink.findUnique({where:{userId:manual.id}})).attendanceUserId,people[1].id);
   await page.screenshot({path:'crm-access-team-preview.png'});
  });
  await check('non-Master cannot read or modify another member CRM permission',async()=>{
   assert.equal((await seller.request.get(path)).status(),403);
   assert.equal((await seller.request.post(path,{headers:{Origin:a},data:{enabled:false}})).status(),403);
  });
  await check('disable revokes existing CRM session; manual reenable restores the same linked account',async()=>{
   const autoPath=a+'/identity/admin-access/'+people[0].id;
   assert.equal((await master.request.post(autoPath,{headers:{Origin:a},data:{enabled:false}})).status(),200);
   assert.equal((await(await seller.request.get(a+'/identity/options')).json()).crmAvailable,false);
   assert.equal((await(await seller.request.get(c+'/api/auth/session')).json())?.user,undefined);
   assert.equal((await master.request.post(autoPath,{headers:{Origin:a},data:{enabled:true}})).status(),200);
   assert.equal((await(await seller.request.get(a+'/identity/options')).json()).crmAvailable,true);
  });
  await check('representative creation never links even when Attendance email matches',async()=>{
   const response=await master.request.post(c+'/api/users',{data:{name:'Representante isolado',email:repEmail,password:crmPassword,role:'REPRESENTANTE'}});
   assert.equal(response.status(),201);const body=await response.json();assert.equal(body.centralAccess.status,'NOT_APPLICABLE');assert.equal(await q.centralIdentityLink.findUnique({where:{userId:body.user.id}}),null);
  });
  console.log('ALL_REAL_LOCAL_ACCESS_FLOWS_PASSED');
 }finally{await master.close();await seller.close();await browser.close();await p.$disconnect();await q.$disconnect();fs.writeFileSync('crm-access-browser-results.json',JSON.stringify({at:new Date().toISOString(),syntheticOnly:true,results},null,2));}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
