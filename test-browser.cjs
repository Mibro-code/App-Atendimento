const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {credentials:creds,seed,client}=require('./local-fixtures.cjs');
const a='http://127.0.0.1:4037',c='http://127.0.0.1:4038';
async function main(){
 await seed();const browser=await chromium.launch({channel:'msedge',headless:true}),results=[];
 async function context(){const ctx=await browser.newContext({serviceWorkers:'block'});ctx.setDefaultTimeout(20000);await ctx.route('**/*',route=>{const url=route.request().url();return url.startsWith(a+'/')||url.startsWith(c+'/')?route.continue():route.abort();});return ctx;}
 async function login(ctx,email,password){const page=await ctx.newPage();await page.goto(c+'/login');await page.getByLabel('E-mail',{exact:true}).fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();return page;}
 async function check(name,fn){const start=Date.now();try{await fn();results.push({name,passed:true,durationMs:Date.now()-start});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.message,durationMs:Date.now()-start});console.error('FAIL',name,e.message);}}
 async function mobileRepresentative(ctx){
  const page=await ctx.newPage();await page.setViewportSize({width:390,height:844});await page.goto(a+'/crm');
  const frame=page.frameLocator('#crm-frame');await frame.getByLabel('E-mail',{exact:true}).fill(creds.repEmail);await frame.getByLabel('Senha',{exact:true}).fill(creds.repPassword);await frame.getByRole('button',{name:'Entrar',exact:true}).click();
  const inner=await(await page.locator('#crm-frame').elementHandle()).contentFrame();await inner.waitForURL(c+'/dashboard',{timeout:30000});await frame.getByRole('button',{name:'Menu',exact:true}).first().waitFor();
  const session=await(await ctx.request.get(c+'/api/auth/session')).json();assert.equal(session.user.role,'REPRESENTANTE');
  assert.equal((await ctx.request.get(a+'/api/conversations')).status(),401);assert.equal(page.url(),a+'/crm');await page.screenshot({path:path.join(__dirname,'preview-mobile-crm.png')});
 }
 try{
  if(process.env.LOCAL_BROWSER_CASE==='mobile'){
   const ctx=await context();try{await mobileRepresentative(ctx);results.push({name:'Representative mobile shell',passed:true});console.log('PASS Representative mobile shell');}finally{await ctx.close();}return;
  }
  await check('Canonical Attendance login at CRM preserves local CRM role; proof is not serialized',async()=>{
   const ctx=await context();try{const page=await login(ctx,creds.email,creds.password);await page.waitForURL(c+'/dashboard',{timeout:120000});const session=await (await ctx.request.get(c+'/api/auth/session')).json();assert.equal(session.user.id,'merge-local-c');assert.equal(session.user.role,'SUPERVISOR');assert.equal(JSON.stringify(session).includes('primaryProof'),false);await page.screenshot({path:path.join(__dirname,'preview-crm.png'),fullPage:false});}finally{await ctx.close();}
  });
  await check('Old CRM password and old CRM e-mail cannot bypass primary credentials',async()=>{
   for(const email of [creds.email,creds.oldCrmEmail]){const ctx=await context();try{const page=await login(ctx,email,creds.oldCrmPassword);await page.getByText('E-mail ou senha inválidos.').waitFor({timeout:30000});const session=await(await ctx.request.get(c+'/api/auth/session')).json();assert.equal(session?.user,undefined);}finally{await ctx.close();}}
  });
  await check('Representative keeps CRM login, sees no Attendance switch and has no Attendance API access',async()=>{
   const ctx=await context();try{const page=await login(ctx,creds.repEmail,creds.repPassword);await page.waitForURL(c+'/dashboard',{timeout:60000});const session=await(await ctx.request.get(c+'/api/auth/session')).json();assert.equal(session.user.role,'REPRESENTANTE');assert.equal(await page.getByRole('link',{name:'← Atendimento',exact:true}).count(),0);assert.equal((await ctx.request.get(a+'/api/conversations')).status(),401);const denied=await ctx.request.get(c+'/api/central/authorize?state='+'a'.repeat(43)+'&challenge='+'b'.repeat(43));assert.equal(denied.status(),403);}finally{await ctx.close();}
  });
  await check('CRM-only seller retains existing login',async()=>{
   const ctx=await context();try{const page=await login(ctx,creds.crmOnlyEmail,creds.crmOnlyPassword);await page.waitForURL(c+'/dashboard',{timeout:60000});assert.equal((await(await ctx.request.get(c+'/api/auth/session')).json()).user.id,'merge-local-crm-only');assert.equal(await page.getByRole('link',{name:'← Atendimento',exact:true}).count(),0);}finally{await ctx.close();}
  });
  await check('CRM to Attendance switches session without importing CRM supervisor privileges',async()=>{
   const ctx=await context();try{const page=await login(ctx,creds.email,creds.password);await page.waitForURL(c+'/dashboard',{timeout:60000});await page.getByRole('link',{name:'← Atendimento',exact:true}).first().click();await page.waitForURL(a+'/',{timeout:60000});const status=await(await ctx.request.get(a+'/api/auth/status')).json();assert.equal(status.user.id,'merge-local-a');assert.equal(status.user.role,'ATENDENTE');}finally{await ctx.close();}
  });
  await check('Attendance to CRM uses lazy same-window shell and completes iframe SSO',async()=>{
   const ctx=await context();try{const response=await ctx.request.post(a+'/api/auth/login',{data:{email:creds.email,password:creds.password}});assert.equal(response.status(),200);const page=await ctx.newPage();await page.goto(a+'/crm?connect=1');await page.frameLocator('#crm-frame').locator('.crm-app-shell').waitFor({timeout:30000});const session=await(await ctx.request.get(c+'/api/auth/session')).json();assert.equal(session.user.id,'merge-local-c');assert.equal(page.url(),a+'/crm?connect=1');await page.screenshot({path:path.join(__dirname,'preview-shell.png')});}finally{await ctx.close();}
  });
  await check('Primary session revocation invalidates linked CRM session',async()=>{
   const ctx=await context(),p=client('attendance');try{const page=await login(ctx,creds.email,creds.password);await page.waitForURL(c+'/dashboard',{timeout:60000});await p.user.update({where:{id:'merge-local-a'},data:{sessionVersion:{increment:1}}});const session=await(await ctx.request.get(c+'/api/auth/session')).json();assert.equal(session?.user,undefined);}finally{await p.$disconnect();await ctx.close();await seed();}
  });
  await check('Representative uses CRM inside mobile shell without receiving Attendance session',async()=>{
   const ctx=await context();try{await mobileRepresentative(ctx);}finally{await ctx.close();}
  });
 }finally{await browser.close();fs.writeFileSync(path.join(__dirname,process.env.LOCAL_BROWSER_CASE==='mobile'?'browser-results-mobile.json':'browser-results.json'),JSON.stringify({at:new Date().toISOString(),results},null,2));}
 if(results.some(r=>!r.passed))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
