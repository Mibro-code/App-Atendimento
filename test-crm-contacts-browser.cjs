const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {seed,client,credentials}=require('./local-fixtures.cjs');
const {seedContacts}=require('./crm-contact-fixtures.cjs');
const a='http://127.0.0.1:4037',c='http://127.0.0.1:4038';
async function main(){
 await seed();await seedContacts();const browser=await chromium.launch({channel:'msedge',headless:true}),results=[];
 const contexts=[];
 async function login(email,password){const ctx=await browser.newContext({serviceWorkers:'block'});contexts.push(ctx);ctx.setDefaultTimeout(30000);await ctx.route('**/*',r=>{const u=r.request().url();return u.startsWith(a+'/')||u.startsWith(c+'/')?r.continue():r.abort();});const csrf=await(await ctx.request.get(c+'/api/auth/csrf')).json();await ctx.request.post(c+'/api/auth/callback/credentials',{form:{email,password,csrfToken:csrf.csrfToken,callbackUrl:c+'/dashboard'},headers:{'X-Auth-Return-Redirect':'1'}});assert.ok((await(await ctx.request.get(c+'/api/auth/session')).json())?.user);return ctx;}
 async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message);}}
 let owner;
 try{
  owner=await login(credentials.ownerEmail,credentials.password);
  await check('CRM UI requires company, displays distinct delivery history and actual source',async()=>{
   const page=await owner.newPage();await page.goto(c+'/envios-whatsapp');await page.getByText('Selecione a empresa para consultar o histórico e preparar o envio.').waitFor();
   await page.getByLabel('Empresa do envio',{exact:true}).selectOption('cmp_mibro');
   const row=page.getByRole('row').filter({hasText:'Cliente com envio (teste)'});await row.getByText('Entregue',{exact:true}).waitFor();assert.equal(await row.getByRole('checkbox').isDisabled(),true);await row.getByText('WhatsApp Mibro (teste)',{exact:false}).waitFor();await page.screenshot({path:path.join(__dirname,'preview-crm-contacts.png'),fullPage:true});
   await page.getByLabel('Empresa do envio',{exact:true}).selectOption('cmp_sincrofit');await row.getByText('Falhou',{exact:true}).waitFor();assert.equal(await row.getByRole('checkbox').isDisabled(),false);await page.close();
  });
  await check('Representative cannot list contacts for messaging or stage selection',async()=>{
   const rep=await login(credentials.repEmail,credentials.repPassword);assert.equal((await rep.request.get(c+'/api/whatsapp-contacts?options=1')).status(),403);assert.equal((await rep.request.post(c+'/api/whatsapp-contacts',{data:{companyId:'cmp_mibro',ids:['crm-fixture-new']}})).status(),403);
  });
  await check('Phone-only classification is enforced by CRM backend, not just the checkbox',async()=>{
   const p=client('crm');try{await p.customer.update({where:{id:'crm-fixture-new'},data:{phoneChannel:'PHONE'}});assert.equal((await owner.request.post(c+'/api/whatsapp-contacts',{data:{companyId:'cmp_mibro',ids:['crm-fixture-new']}})).status(),400);}
   finally{await p.customer.update({where:{id:'crm-fixture-new'},data:{phoneChannel:null}});await p.$disconnect();}
  });
  await check('Current portfolio enforced for list and selection; disallowed company rejected',async()=>{
   const p=client('attendance');try{await p.user.update({where:{id:'merge-local-a'},data:{canManageCampaigns:true}});const agent=await login(credentials.email,credentials.password);
    const options=await(await agent.request.get(c+'/api/whatsapp-contacts?options=1')).json();assert.deepEqual(options.companies.map(r=>r.id),['cmp_mibro']);
    const listed=await(await agent.request.get(c+'/api/whatsapp-contacts?companyId=cmp_mibro')).json();assert.deepEqual(listed.contacts.map(r=>r.id),['crm-fixture-owned-c']);
    assert.equal((await agent.request.post(c+'/api/whatsapp-contacts',{data:{companyId:'cmp_mibro',ids:['crm-fixture-outside']}})).status(),403);
    assert.equal((await agent.request.post(c+'/api/whatsapp-contacts',{data:{companyId:'cmp_sincrofit',ids:['crm-fixture-owned-c']}})).status(),403);
   }finally{await p.user.update({where:{id:'merge-local-a'},data:{canManageCampaigns:false}});await p.$disconnect();}
  });
  await check('Selection deduplicates and opens existing bulk review without queueing or sending',async()=>{
   const p=client('attendance');try{const count=await p.campaign.count();const staged=await owner.request.post(c+'/api/whatsapp-contacts',{data:{companyId:'cmp_mibro',ids:['crm-fixture-new','crm-fixture-duplicate'],phone:'malicious-client-value'}});assert.equal(staged.status(),200);const result=await staged.json();assert.equal(result.valid,1);assert.equal(result.duplicates,1);
    const page=await owner.newPage();await page.goto(result.nextUrl);await page.waitForURL(a+'/**',{timeout:60000});await page.locator('#wa-send-dialog[open]').waitFor({timeout:60000});await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByText('CRM',{exact:true}).first().waitFor();await page.screenshot({path:path.join(__dirname,'preview-crm-bulk-review.png')});assert.equal(await p.campaign.count(),count);await page.close();
   }finally{await p.$disconnect();}
  });
 }finally{for(const ctx of contexts)await ctx.close();await browser.close();fs.writeFileSync(path.join(__dirname,'crm-contacts-browser-results.json'),JSON.stringify({at:new Date().toISOString(),results},null,2));}
 if(results.some(r=>!r.passed))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
