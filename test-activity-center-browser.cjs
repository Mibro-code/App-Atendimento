// Central de Atividades — ponta a ponta na prévia local (PostgreSQL descartável,
// rede externa bloqueada, contas sintéticas). Não envia mensagens e não toca
// em pedidos/propostas do Olist: as contagens são conferidas antes e depois.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {client,credentials,seed}=require('./local-fixtures.cjs');
const {seedContacts}=require('./crm-contact-fixtures.cjs');
const a='http://127.0.0.1:4037',c='http://127.0.0.1:4038';
const HOUR=3600000;

async function seedActivities(){
 const db=client('attendance'),crm=client('crm'),now=Date.now();
 try{
  for(const [id,companyId,phone] of [['activity-contact-mibro','cmp_mibro','5511931112222'],['activity-contact-sincro','cmp_sincrofit','5511931113333']]){
   await db.contact.upsert({where:{id},create:{id,companyId,channel:'META',phone,externalId:phone,name:id.endsWith('mibro')?'Loja Atividade (teste)':'Sincro Atividade (teste)'},update:{}});
  }
  await db.conversation.upsert({where:{id:'activity-conv-mibro'},create:{id:'activity-conv-mibro',companyId:'cmp_mibro',contactId:'activity-contact-mibro',channel:'META',assignedUserId:'merge-local-a'},update:{assignedUserId:'merge-local-a'}});
  const followUps=[
   {id:'activity-fu-overdue',companyId:'cmp_mibro',contactId:'activity-contact-mibro',conversationId:'activity-conv-mibro',assigneeId:'merge-local-a',createdById:'merge-local-a',dueAt:new Date(now-26*HOUR),reason:'NEGOCIACAO',priority:'ALTA',note:'Retomar negociação (teste)'},
   {id:'activity-fu-tomorrow',companyId:'cmp_mibro',contactId:'activity-contact-mibro',conversationId:'activity-conv-mibro',assigneeId:'merge-local-a',createdById:'merge-local-a',dueAt:new Date(now+30*HOUR),reason:'COTACAO',priority:'NORMAL',note:null},
   {id:'activity-fu-sincro',companyId:'cmp_sincrofit',contactId:'activity-contact-sincro',conversationId:null,assigneeId:'merge-local-owner-a',createdById:'merge-local-owner-a',dueAt:new Date(now+5*HOUR),reason:'POS_VENDA',priority:'NORMAL',note:'SINCROFIT_MUST_NOT_LEAK'},
  ];
  for(const row of followUps){
   const reset={status:'PENDENTE',dueAt:row.dueAt,completedAt:null,completedById:null,cancelledAt:null,cancelledById:null,rescheduleCount:0,remindedAt:null,overdueNotifiedAt:null,note:row.note,assigneeId:row.assigneeId};
   await db.followUp.upsert({where:{id:row.id},create:row,update:reset});
  }
  await crm.centralContactLink.upsert({where:{attendanceCompanyId_attendanceContactId:{attendanceCompanyId:'cmp_mibro',attendanceContactId:'activity-contact-mibro'}},create:{attendanceCompanyId:'cmp_mibro',attendanceContactId:'activity-contact-mibro',customerId:'crm-fixture-owned-c',confirmedBy:'LOCAL_SYNTHETIC'},update:{}});
  const appointment={title:'Visita local de teste',type:'VISITA',status:'PENDENTE',priority:'NORMAL',startsAt:new Date(now+3*HOUR),allDay:false,assignedToId:'merge-local-c',createdById:'merge-local-c',customerId:'crm-fixture-owned-c',completedAt:null,completedById:null,cancelledAt:null,cancelledById:null};
  await crm.appointment.upsert({where:{id:'activity-appt-1'},create:{id:'activity-appt-1',...appointment},update:appointment});
 }finally{await db.$disconnect();await crm.$disconnect();}
}

async function counts(){
 const db=client('attendance'),crm=client('crm');
 try{return {messages:await db.message.count(),campaigns:await db.campaign.count(),orders:await crm.olistOrder.count(),quotes:await crm.quote.count(),olistHistory:await crm.olistStatusHistory.count(),followUps:await db.followUp.count(),appointments:await crm.appointment.count()};}
 finally{await db.$disconnect();await crm.$disconnect();}
}

async function main(){
 await seed();await seedContacts();await seedActivities();
 const before=await counts();
 const browser=await chromium.launch({channel:'msedge',headless:true}),contexts=[],results=[];
 async function login(email,password){const ctx=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:900}});contexts.push(ctx);ctx.setDefaultTimeout(30000);await ctx.route('**/*',r=>{const url=r.request().url();return url.startsWith(a+'/')||url.startsWith(c+'/')?r.continue():r.abort();});const csrf=await(await ctx.request.get(c+'/api/auth/csrf')).json();await ctx.request.post(c+'/api/auth/callback/credentials',{form:{email,password,csrfToken:csrf.csrfToken,callbackUrl:c+'/dashboard'},headers:{'X-Auth-Return-Redirect':'1'}});assert.ok((await(await ctx.request.get(c+'/api/auth/session')).json()).user);await ctx.request.post(a+'/api/auth/login',{data:{email,password}});return ctx;}
 async function check(name,fn){try{await fn();results.push({name,passed:true});console.log('PASS',name);}catch(e){results.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message);}}
 const feed=async(ctx,query)=>{const response=await ctx.request.get(c+'/api/activity-center?'+new URLSearchParams(query));assert.equal(response.status(),200);return response.json();};
 try{
  const linked=await login(credentials.email,credentials.password);
  await check('Linked user sees CRM agenda + Central follow-ups of the chosen company only',async()=>{
   const data=await feed(linked,{company:'mibro'});const keys=data.items.map(i=>i.key);
   assert.equal(data.central.status,'ok');
   for(const key of ['CENTRAL:activity-fu-overdue','CENTRAL:activity-fu-tomorrow','CRM_AGENDA:activity-appt-1'])assert.ok(keys.includes(key),key);
   assert.ok(!keys.includes('CENTRAL:activity-fu-sincro'));
   const raw=JSON.stringify(data);assert.ok(!raw.includes('SINCROFIT_MUST_NOT_LEAK'));assert.ok(!raw.includes('5511931112222'));
   const overdue=data.items.find(i=>i.key==='CENTRAL:activity-fu-overdue');
   assert.equal(overdue.state,'ATRASADO');assert.equal(overdue.company.slug,'mibro');assert.equal(overdue.conversationId,'activity-conv-mibro');
   // Contato vinculado explicitamente + cliente na carteira visível → atalho para o cliente.
   assert.deepEqual(overdue.customer,{id:'crm-fixture-owned-c',name:'Carteira do usuário vinculado (teste)'});
   // Responsável da Central mapeado ao usuário do CRM pelo vínculo de identidade.
   assert.equal(overdue.assignee.key,'merge-local-c');
   assert.equal(new Set(keys).size,keys.length);
  });
  await check('Company without Atendimento access is reported as forbidden, never as empty',async()=>{
   const data=await feed(linked,{company:'sincrofit'});assert.equal(data.central.status,'forbidden');assert.ok(data.items.every(i=>i.source!=='CENTRAL'));
   assert.ok(!JSON.stringify(data).includes('SINCROFIT_MUST_NOT_LEAK'));
  });
  await check('Complete a Central follow-up from the CRM: original record changes once, with author and timeline',async()=>{
   const where={conversationId:'activity-conv-mibro',action:'FOLLOW_UP_COMPLETED',details:{path:['followUpId'],equals:'activity-fu-overdue'}};
   const pre=client('attendance');let timelineBefore;try{timelineBefore=await pre.conversationActivity.count({where});}finally{await pre.$disconnect();}
   const response=await linked.request.post(c+'/api/activity-center',{data:{id:'activity-fu-overdue',action:'COMPLETE'}});assert.equal(response.status(),200);
   const again=await linked.request.post(c+'/api/activity-center',{data:{id:'activity-fu-overdue',action:'COMPLETE'}});assert.equal(again.status(),409);assert.match((await again.json()).error,/já foi concluído|Somente retornos pendentes/);
   const db=client('attendance');try{
    const row=await db.followUp.findUnique({where:{id:'activity-fu-overdue'}});assert.equal(row.status,'CONCLUIDO');assert.equal(row.completedById,'merge-local-a');
    assert.equal(await db.conversationActivity.count({where}),timelineBefore+1);
   }finally{await db.$disconnect();}
   const data=await feed(linked,{company:'mibro'});assert.equal(data.items.find(i=>i.key==='CENTRAL:activity-fu-overdue').state,'CONCLUIDO');
  });
  await check('Reschedule a Central follow-up keeps São Paulo time and counts the reschedule',async()=>{
   const response=await linked.request.post(c+'/api/activity-center',{data:{id:'activity-fu-tomorrow',action:'RESCHEDULE',date:'2027-01-15',time:'14:30'}});assert.equal(response.status(),200);
   const db=client('attendance');try{const row=await db.followUp.findUnique({where:{id:'activity-fu-tomorrow'}});assert.equal(row.dueAt.toISOString(),'2027-01-15T17:30:00.000Z');assert.equal(row.rescheduleCount,1);}finally{await db.$disconnect();}
  });
  await check('Linked user cannot act on another company follow-up through the bridge',async()=>{
   const response=await linked.request.post(c+'/api/activity-center',{data:{id:'activity-fu-sincro',action:'COMPLETE'}});assert.equal(response.status(),404);
   const db=client('attendance');try{assert.equal((await db.followUp.findUnique({where:{id:'activity-fu-sincro'}})).status,'PENDENTE');}finally{await db.$disconnect();}
  });
  await check('CRM appointment actions keep using the CRM agenda rules',async()=>{
   const response=await linked.request.patch(c+'/api/agenda/activity-appt-1',{data:{action:'COMPLETE'}});assert.equal(response.status(),200);
   const data=await feed(linked,{company:'mibro'});assert.equal(data.items.find(i=>i.key==='CRM_AGENDA:activity-appt-1').state,'CONCLUIDO');
  });
  await check('Representative keeps CRM-only access: no Central data and no bridge actions',async()=>{
   const rep=await login(credentials.repEmail,credentials.repPassword);
   const data=await feed(rep,{company:'mibro'});assert.equal(data.central.status,'unlinked');assert.ok(data.items.every(i=>i.source!=='CENTRAL'));
   assert.equal((await rep.request.post(c+'/api/activity-center',{data:{id:'activity-fu-tomorrow',action:'COMPLETE'}})).status(),403);
   assert.equal((await rep.request.get(c+'/api/activity-center?company=outra')).status(),400);
  });
  await check('Central header opens the activity center for the active workspace; CRM menu page renders',async()=>{
   const page=await linked.newPage();page.on('pageerror',e=>console.error('BROWSER',e.message));
   // Clique assim que o botão aparece: o evento inicial do workspace não pode fechar o painel.
   await page.goto(a+'/');await page.waitForFunction(()=>Boolean(window.CentralWorkspace?.current()?.slug),null,{timeout:90000});await page.getByRole('button',{name:'Atividades',exact:true}).click();
   await page.waitForTimeout(3000);assert.equal(await page.locator('dialog[open] iframe[title="Atividades"]').count(),1);
   const frame=page.frameLocator('dialog iframe[title="Atividades"]');await frame.getByRole('heading',{name:'Central de Atividades'}).waitFor({timeout:90000}).catch(async error=>{const inner=page.frames().find(f=>f.url().startsWith(c));throw Error(error.message.split('\n')[0]+' | frames='+page.frames().map(f=>f.url()).join(',')+' | dialog='+(await page.locator('dialog').evaluateAll(list=>list.map(d=>d.open+':'+(d.querySelector('iframe')?.src||'-')).join(';')))+' | text='+(inner?(await inner.evaluate(()=>document.body.innerText)).slice(0,300):''));});
   await frame.getByText('Visita local de teste').waitFor();await frame.getByText('Negociação · Loja Atividade (teste)').waitFor();
   assert.equal(await frame.getByText('SINCROFIT_MUST_NOT_LEAK').count(),0);
   await page.screenshot({path:path.join(__dirname,'preview-activity-center-central.png')});
   await page.goto(c+'/atividades');await page.getByRole('heading',{name:'Central de Atividades'}).first().waitFor({timeout:90000});
   await page.getByRole('link',{name:'Central de Atividades'}).first().waitFor();
   await page.getByText('Visita local de teste').waitFor({timeout:90000});
   const [team]=await Promise.all([page.waitForResponse(r=>r.url().includes('/api/activity-center?')&&r.url().includes('scope=team')),page.getByRole('button',{name:'Equipe',exact:true}).click()]);
   assert.equal(team.status(),200);assert.equal((await team.json()).scope,'team');await page.getByRole('heading',{name:'Carga por responsável'}).waitFor();
   await page.screenshot({path:path.join(__dirname,'preview-activity-center-crm.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});await page.goto(c+'/central-activities?company=mibro');await page.getByRole('heading',{name:'Central de Atividades'}).waitFor({timeout:90000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(__dirname,'preview-activity-center-mobile.png'),fullPage:true});
  });
  await check('Reschedule from the screen sends the change to the origin system',async()=>{
   const db=client('attendance');try{await db.followUp.update({where:{id:'activity-fu-tomorrow'},data:{dueAt:new Date(Date.now()+30*HOUR),rescheduleCount:0}});}finally{await db.$disconnect();}
   const page=await linked.newPage();await page.goto(c+'/atividades?company=mibro');
   const row=page.getByRole('listitem').filter({hasText:'Cotação · Loja Atividade (teste)'});await row.waitFor({timeout:90000});
   await row.getByRole('button',{name:'Reagendar'}).click();await row.getByLabel('Data').fill('2027-02-10');await row.getByLabel('Horário').fill('09:15');
   await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/activity-center')&&r.request().method()==='POST'&&r.status()===200),row.getByRole('button',{name:'Salvar',exact:true}).click()]);
   const check=client('attendance');try{assert.equal((await check.followUp.findUnique({where:{id:'activity-fu-tomorrow'}})).dueAt.toISOString(),'2027-02-10T12:15:00.000Z');}finally{await check.$disconnect();}
  });
  await check('No message, campaign, proposal or Olist record was created or changed',async()=>{
   const after=await counts();
   for(const key of ['messages','campaigns','orders','quotes','olistHistory','followUps','appointments'])assert.equal(after[key],before[key],key);
  });
 }finally{for(const ctx of contexts)await ctx.close();await browser.close();}
 fs.writeFileSync(path.join(__dirname,'activity-center-browser-results.json'),JSON.stringify({at:new Date().toISOString(),results},null,1));
 if(results.some(r=>!r.passed))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
