const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {client,credentials:creds}=require('./local-fixtures.cjs');
const a='http://127.0.0.1:4037',c='http://127.0.0.1:4038',results=[];
async function main(){
 const adb=client('attendance'),db=client('crm');
 const unique=String(Date.now()).slice(-7),source='import-local-'+unique,phone='55119'+unique+'9',duplicatePhone='55119'+unique+'8';
 try{
  for(const suffix of ['one','two'])await db.customer.create({data:{id:source+'-'+suffix,contactName:'Possível cadastro '+suffix,phoneDigits:duplicatePhone,sellerId:'merge-local-owner-c'}});
  for(const [id,name,num,company] of [[source,'Lead importação '+unique,phone,'cmp_mibro'],[source+'-duplicate','Nome busca Mibro '+unique,duplicatePhone,'cmp_mibro'],[source+'-sincro','Nome busca Sincro '+unique,'55119'+unique+'7','cmp_sincrofit']]){
   await adb.contact.create({data:{id,companyId:company,channel:'META',externalId:num,phone:num,name}});
   await adb.conversation.create({data:{id,companyId:company,channel:'META',contactId:id,status:'AGUARDANDO_EQUIPE'}});
   await adb.message.create({data:{conversationId:id,direction:'RECEBIDA',status:'ENTREGUE',type:'text',text:'Mensagem fictícia para abrir janela local',occurredAt:new Date()}});
  }
 }finally{await adb.$disconnect();}
 const browser=await chromium.launch({channel:'msedge',headless:true});
 async function context(){const ctx=await browser.newContext({serviceWorkers:'block'});ctx.setDefaultTimeout(30000);await ctx.route('**/*',route=>{const u=route.request().url();return u.startsWith(a+'/')||u.startsWith(c+'/')?route.continue():route.abort();});return ctx;}
 async function login(ctx,email,password){const page=await ctx.newPage();await page.goto(c+'/login');await page.getByLabel('E-mail',{exact:true}).fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL(c+'/dashboard',{timeout:90000});return page;}
 async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.stack});console.error('FAIL',name,e.stack);await page?.screenshot({path:path.join(__dirname,'failure-'+results.length+'.png')}).catch(()=>{});if(page)console.error(await page.locator('iframe').evaluateAll(frames=>frames.map(f=>({title:f.title,src:f.src}))));}}
 const ctx=await context();let page;
 try{
  page=await login(ctx,creds.ownerEmail,creds.password);
  await ctx.request.post(a+'/api/auth/login',{data:{email:creds.ownerEmail,password:creds.password}});
  await check('Inline profile form prefilled; no provider calls or forced CRM navigation',async()=>{
   await page.goto(a+'/?conversation='+source);await page.locator('#crm-contact-open:not([hidden])').waitFor();
   await page.locator('#contact-details').click();await page.locator('[data-files-tab="crm"]').click();
   const frame=page.frameLocator('#contact-files-content iframe');await frame.getByLabel('Nome do contato *',{exact:true}).waitFor({timeout:90000});
   assert.equal(await frame.getByLabel('Nome do contato *',{exact:true}).inputValue(),'Lead importação '+unique);assert.equal(await frame.getByLabel('WhatsApp',{exact:true}).inputValue(),phone);
   const element=await page.locator('#contact-files-content iframe').elementHandle();await frame.getByLabel('Cidade',{exact:true}).fill('Cidade local');
   await page.evaluate(()=>renderContactFiles('crm'));assert.equal(await page.locator('#contact-files-content iframe').evaluate((node,old)=>node===old,element),true);assert.equal(await frame.getByLabel('Cidade',{exact:true}).inputValue(),'Cidade local');
   await page.screenshot({path:path.join(__dirname,'preview-inline-crm-import.png')});
  });
  await check('Create customer and explicit stable link atomically',async()=>{
   const frame=page.frameLocator('#contact-files-content iframe');
   assert.equal(await frame.locator('form').evaluate(node=>node.checkValidity()),true);
   await frame.getByRole('button',{name:'Enviar para o CRM',exact:true}).click();await frame.getByRole('status').filter({hasText:'Contato vinculado ao CRM'}).waitFor();
   const link=await db.centralContactLink.findUnique({where:{attendanceCompanyId_attendanceContactId:{attendanceCompanyId:'cmp_mibro',attendanceContactId:source}},include:{customer:true}});assert.ok(link);assert.equal(link.customer.phoneDigits,phone);assert.equal(link.customer.city,'Cidade local');assert.equal(link.customer.sellerId,'merge-local-owner-c');
   assert.equal(await clientCountMessages(source),0);
  });
  await check('Repeated import cannot duplicate or replace linked customer',async()=>{
   const response=await ctx.request.post(c+'/api/customers',{headers:{Origin:c},data:{contactName:'Do not duplicate',phoneDigits:phone,attendanceConversationId:source}});assert.equal(response.status(),409);
   assert.equal(await db.customer.count({where:{phoneDigits:phone}}),1);
   const link=await db.centralContactLink.findUnique({where:{attendanceCompanyId_attendanceContactId:{attendanceCompanyId:'cmp_mibro',attendanceContactId:source}}});
   await db.customer.update({where:{id:link.customerId},data:{phoneDigits:'5511900000001'}});
   const data=await(await ctx.request.get(c+'/api/attendance-context?conversationId='+source)).json();assert.equal(data.linked,true);assert.equal(data.customers[0].id,link.customerId);
   const reverse=await(await ctx.request.get(c+'/api/attendance-context?customerId='+link.customerId+'&companyId=cmp_mibro')).json();assert.ok(reverse.conversations.some(row=>row.id===source));
  });
  await check('Phone candidates require confirmation; no automatic contact merge',async()=>{
   const response=await ctx.request.get(c+'/api/attendance-context?conversationId='+source+'-duplicate');const body=await response.json();assert.equal(body.linked,false);assert.ok(body.customers.length>=2);
   const customerId=body.customers[0].id;
   assert.equal((await ctx.request.post(c+'/api/central-contact-link',{headers:{Origin:c},data:{conversationId:source+'-duplicate',customerId,confirm:false}})).status(),400);
   assert.equal((await ctx.request.post(c+'/api/central-contact-link',{headers:{Origin:c},data:{conversationId:source+'-duplicate',customerId,confirm:true}})).status(),200);
   assert.equal((await ctx.request.post(c+'/api/central-contact-link',{headers:{Origin:c},data:{conversationId:source+'-duplicate',customerId:body.customers[1].id,confirm:true}})).status(),409);
  });
  await check('Cross-origin integrated creation/link rejected',async()=>{
   assert.equal((await ctx.request.post(c+'/api/central-contact-link',{headers:{Origin:'https://untrusted.invalid'},data:{conversationId:source,customerId:'crm-fixture-sent',confirm:true}})).status(),403);
  });
  await check('Concurrent creation yields one customer and one link, with no orphan duplicate',async()=>{
   const adb=client('attendance'),id=source+'-race',num='55119'+unique+'6';try{await adb.contact.create({data:{id,companyId:'cmp_mibro',channel:'META',externalId:num,phone:num,name:'Concorrência local'}});await adb.conversation.create({data:{id,companyId:'cmp_mibro',channel:'META',contactId:id}});}finally{await adb.$disconnect();}
   const responses=await Promise.all([1,2,3].map(()=>ctx.request.post(c+'/api/customers',{headers:{Origin:c},data:{contactName:'Concorrência local',phoneDigits:num,attendanceConversationId:id}})));
   assert.deepEqual(responses.map(r=>r.status()).sort(),[201,409,409]);assert.equal(await db.customer.count({where:{phoneDigits:num}}),1);assert.equal(await db.centralContactLink.count({where:{attendanceContactId:id}}),1);
  });
  await check('Template wizard searches allowed contacts by name and fills selected phone',async()=>{
   await page.locator('#close-contact-files').click();await page.evaluate(()=>window.WaSendWizard.open());
   const search=page.locator('[data-wa-contact-search]');await search.fill('Nome busca Mibro '+unique);
   const result=page.locator('[data-wa-contact-result]').filter({hasText:'Nome busca Mibro '+unique});await result.waitFor();await result.click();
   assert.equal(await page.locator('[data-wa-ind="name"]').inputValue(),'Nome busca Mibro '+unique);assert.equal((await page.locator('[data-wa-ind="phone"]').inputValue()).replace(/\D/g,''),duplicatePhone);
   await search.fill('Sincro');await page.getByText('Nenhum contato encontrado no seu acesso.',{exact:true}).waitFor();
   await page.locator('[data-wa-close]').first().click();
  });
  await check('Unified search and alerts accessible on demand without background CRM polling',async()=>{
   await page.getByRole('button',{name:'Busca integrada',exact:true}).click();
   const center=page.frameLocator('dialog[aria-label="Busca e avisos integrados"] iframe');await center.getByLabel('Buscar nome, telefone, proposta ou pedido').fill('Nome busca Mibro '+unique);
   await center.getByRole('link').filter({hasText:'Nome busca Mibro '+unique}).waitFor({timeout:90000});
   await page.getByRole('button',{name:'Fechar',exact:true}).last().click();await page.getByRole('button',{name:'Avisos',exact:true}).click();await center.getByRole('heading',{name:'Central de avisos',exact:true}).waitFor({timeout:90000});await center.getByRole('heading',{name:'Avisos do CRM',exact:true}).waitFor();
   await page.getByRole('button',{name:'Fechar',exact:true}).last().click();
  });
  await check('Draft isolated per chat and preserved through module round trip',async()=>{
   await page.evaluate(async id=>{await openConversationInWorkspace(id);},source);await page.locator('#message-input').fill('Rascunho local — não enviar');
   await page.evaluate(async id=>{await openConversationInWorkspace(id);},source+'-duplicate');assert.equal(await page.locator('#message-input').inputValue(),'');
   await page.evaluate(async id=>{await openConversationInWorkspace(id);},source);assert.equal(await page.locator('#message-input').inputValue(),'Rascunho local — não enviar');
   await page.goto(a+'/crm?connect=1');await page.frameLocator('#crm-frame').locator('.crm-app-shell').waitFor({timeout:90000});
   const crmFrame=page.frames().find(frame=>frame.url().startsWith(c+'/'));await crmFrame.goto(c+'/clientes?q=Lead');await crmFrame.locator('.crm-app-shell').waitFor();
   await crmFrame.waitForFunction(()=>Object.keys(sessionStorage).some(key=>key.startsWith('central-crm-view-v1:')&&JSON.parse(sessionStorage.getItem(key)).path==='/clientes?q=Lead'));
   await page.goto(a+'/');
   await page.waitForFunction(id=>document.querySelector('#crm-context-frame')?.dataset.conversationId===id,source);assert.equal(await page.locator('#message-input').inputValue(),'Rascunho local — não enviar');
   await page.goto(a+'/crm?connect=1');await page.frameLocator('#crm-frame').locator('.crm-app-shell').waitFor({timeout:90000});
   await page.frames().find(frame=>frame.url().startsWith(c+'/')).waitForURL(c+'/clientes?q=Lead');
   assert.ok(page.frames().some(frame=>frame.url()===c+'/clientes?q=Lead'));
  });
  await check('Representative cannot use integrated import, link, search or notifications',async()=>{
   const rep=await context();try{await login(rep,creds.repEmail,creds.repPassword);assert.equal((await rep.request.get(c+'/api/central-center?company=mibro&mode=search&q=Nome')).status(),403);assert.equal((await rep.request.post(c+'/api/central-contact-link',{headers:{Origin:c},data:{conversationId:source,customerId:'crm-fixture-sent',confirm:true}})).status(),403);assert.equal((await rep.request.post(c+'/api/customers',{headers:{Origin:c},data:{contactName:'Denied',attendanceConversationId:source}})).status(),403);}finally{await rep.close();}
  });
  await check('Limited account cannot search Sincrofit or link another portfolio',async()=>{
   const limited=await context();try{await login(limited,creds.email,creds.password);const response=await limited.request.get(c+'/api/central-center?company=sincrofit&mode=search&q=Nome');assert.equal(response.status(),503);assert.equal(JSON.stringify(await response.json()).includes('Nome busca Sincro'),false);assert.equal((await limited.request.post(c+'/api/central-contact-link',{headers:{Origin:c},data:{conversationId:source,customerId:'crm-fixture-sent',confirm:true}})).status(),403);}finally{await limited.close();}
  });
 }finally{await ctx.close();await browser.close();await db.$disconnect();fs.writeFileSync(path.join(__dirname,'contact-integration-browser-results.json'),JSON.stringify({at:new Date().toISOString(),results},null,2));}
 if(results.some(row=>!row.passed))process.exitCode=1;
}
async function clientCountMessages(conversationId){const p=client('attendance');try{return await p.message.count({where:{conversationId,direction:'ENVIADA'}});}finally{await p.$disconnect();}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
