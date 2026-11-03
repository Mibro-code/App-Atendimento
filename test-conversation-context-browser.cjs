const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {client,credentials:creds}=require('./local-fixtures.cjs');
const a='http://127.0.0.1:4037',c='http://127.0.0.1:4038';
async function main(){
 const p=client('crm');
 try{for(const [id,brand,value]of [['context-mibro','MIBRO',12345],['context-sincro','SINCROFIT',98765]])await p.quote.upsert({where:{id},create:{id,customerId:'crm-fixture-sent',sellerId:'merge-local-owner-c',brand,totalValueCents:value},update:{}});}finally{await p.$disconnect();}
 const browser=await chromium.launch({channel:'msedge',headless:true}),results=[];
 async function context(){const ctx=await browser.newContext({serviceWorkers:'block'});ctx.setDefaultTimeout(25000);await ctx.route('**/*',route=>{const url=route.request().url();return url.startsWith(a+'/')||url.startsWith(c+'/')?route.continue():route.abort();});return ctx;}
 async function login(ctx,email,password){const page=await ctx.newPage();await page.goto(c+'/login');await page.getByLabel('E-mail',{exact:true}).fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL(c+'/dashboard',{timeout:90000});return page;}
 async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message);}}
 const ctx=await context();
 try{
  const page=await login(ctx,creds.ownerEmail,creds.password);
  page.on('pageerror',error=>console.error('BROWSER',error.message));
  await check('Card respects company proposal brand; no message bodies',async()=>{
   const m=await ctx.request.get(c+'/api/attendance-context?conversationId=crm-fixture-conv-mibro');assert.equal(m.status(),200);const data=await m.json();assert.equal(data.customers[0].id,'crm-fixture-sent');assert.ok(data.customers[0].quotes.length>0);assert.ok(data.customers[0].quotes.every(q=>q.brand==='MIBRO'));assert.equal(JSON.stringify(data).includes('Mensagem fictícia'),false);
   const s=await(await ctx.request.get(c+'/api/attendance-context?conversationId=crm-fixture-conv-sincro')).json();assert.deepEqual(s.customers[0].quotes.map(q=>q.brand),['SINCROFIT']);
  });
  await check('Customer lookup shows only chosen company, never both',async()=>{
   for(const [company,id]of [['cmp_mibro','crm-fixture-conv-mibro'],['cmp_sincrofit','crm-fixture-conv-sincro']]){const response=await ctx.request.get(c+'/api/attendance-context?customerId=crm-fixture-sent&companyId='+company);assert.equal(response.status(),200);assert.deepEqual((await response.json()).conversations.map(row=>row.id),[id]);}
   assert.equal((await ctx.request.get(c+'/api/attendance-context?customerId=crm-fixture-sent&companyId=invalid')).status(),404);
  });
  await check('Compact card loaded on demand inside actual conversation',async()=>{
   await ctx.request.post(a+'/api/auth/login',{data:{email:creds.ownerEmail,password:creds.password}});
   let crmRequests=0;page.on('request',req=>{if(req.url().startsWith(c+'/'))crmRequests++;});
   await page.goto(a+'/?conversation=crm-fixture-conv-mibro');await page.waitForFunction(()=>document.querySelector('#crm-context-frame')?.dataset.conversationId==='crm-fixture-conv-mibro');
   assert.equal(await page.locator('#crm-context-frame iframe').count(),0);assert.equal(crmRequests,0);
   await page.locator('#crm-contact-open').click();
   const frame=page.frameLocator('#crm-context-frame iframe');await frame.getByRole('heading',{name:'Cliente com envio (teste)',exact:true}).waitFor({timeout:90000});assert.equal(await frame.getByRole('link',{name:'Abrir cadastro no CRM →'}).count(),1);
   await page.screenshot({path:path.join(__dirname,'preview-conversation-crm.png')});
   // Reopening the same tab must not repeat SSO or API calls.
   let lookups=0;page.on('request',req=>{if(req.url().includes('/api/attendance-context?conversationId='))lookups++;});
   await page.getByRole('tab',{name:'Detalhes',exact:true}).click();await page.getByRole('tab',{name:'CRM',exact:true}).click();assert.equal(lookups,0);
   await frame.getByRole('link',{name:'Abrir cadastro no CRM →'}).click();await page.waitForURL(a+'/crm?connect=1&customer=crm-fixture-sent');await page.frameLocator('#crm-frame').getByRole('heading',{name:'Cliente com envio (teste)',exact:true}).first().waitFor({timeout:60000});
  });
  await check('CRM customer shortcut opens correct chat without assigning it',async()=>{
   await page.goto(c+'/clientes/crm-fixture-sent');await page.getByRole('link',{name:'Conversas no Atendimento'}).click();await page.getByLabel('Empresa do atendimento').selectOption('cmp_sincrofit');await page.getByRole('link',{name:'Abrir conversa →'}).click();await page.waitForURL(new RegExp(a.replaceAll('.','\\.')+'/\\?conversation='));
   await page.waitForFunction(()=>document.querySelector('#crm-context-frame')?.dataset.conversationId==='crm-fixture-conv-sincro');
   const detail=await(await ctx.request.get(a+'/api/conversations/crm-fixture-conv-sincro')).json();assert.equal(detail.companyId,'cmp_sincrofit');assert.equal(detail.assignedUserId,null);
  });
  await check('Ambiguous phone shows choices without automatic linkage',async()=>{
   const db=client('attendance');try{await db.contact.upsert({where:{id:'context-ambiguous-contact'},create:{id:'context-ambiguous-contact',companyId:'cmp_mibro',channel:'META',externalId:'5511988765432',phone:'5511988765432'},update:{}});await db.conversation.upsert({where:{id:'context-ambiguous-conv'},create:{id:'context-ambiguous-conv',companyId:'cmp_mibro',contactId:'context-ambiguous-contact',channel:'META'},update:{}});}finally{await db.$disconnect();}
   const data=await(await ctx.request.get(c+'/api/attendance-context?conversationId=context-ambiguous-conv')).json();assert.equal(data.ambiguous,true);assert.equal(data.customers.length,2);
   await page.goto(c+'/central-context?conversationId=context-ambiguous-conv');await page.getByText('Há mais de um cadastro com este telefone.',{exact:false}).waitFor();
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(__dirname,'preview-conversation-crm-mobile.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  });
  await check('Agent cannot inspect inaccessible conversation, company or another CRM portfolio',async()=>{
   const limited=await context();try{await login(limited,creds.email,creds.password);const denied=await limited.request.get(c+'/api/attendance-context?conversationId=crm-fixture-conv-sincro');assert.equal(denied.status(),404);const customer=await limited.request.get(c+'/api/attendance-context?customerId=crm-fixture-sent&companyId=cmp_mibro');assert.equal(customer.status(),404);}finally{await limited.close();}
  });
  await check('Agent can read own linked customer without campaign privileges',async()=>{
   const db=client('attendance');try{await db.contact.upsert({where:{id:'context-own-contact'},create:{id:'context-own-contact',companyId:'cmp_mibro',channel:'META',externalId:'5511943210987',phone:'5511943210987'},update:{}});await db.conversation.upsert({where:{id:'context-own-conv'},create:{id:'context-own-conv',companyId:'cmp_mibro',contactId:'context-own-contact',channel:'META',assignedUserId:'merge-local-a'},update:{}});}finally{await db.$disconnect();}
   const limited=await context();try{await login(limited,creds.email,creds.password);const response=await limited.request.get(c+'/api/attendance-context?conversationId=context-own-conv');assert.equal(response.status(),200);assert.equal((await response.json()).customers[0].id,'crm-fixture-owned-c');}finally{await limited.close();}
  });
  await check('Representative denied integrated data and customer shortcut',async()=>{
   const rep=await context();try{await login(rep,creds.repEmail,creds.repPassword);assert.equal((await rep.request.get(c+'/api/attendance-context?options=1')).status(),403);assert.equal((await rep.request.get(a+'/api/conversations')).status(),401);}finally{await rep.close();}
  });
 }finally{await ctx.close();await browser.close();fs.writeFileSync(path.join(__dirname,'conversation-context-browser-results.json'),JSON.stringify({at:new Date().toISOString(),results},null,2));}
 if(results.some(row=>!row.passed))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
