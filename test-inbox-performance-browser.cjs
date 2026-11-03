const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {client,credentials}=require('./local-fixtures.cjs');
const root=path.resolve(__dirname,'../release-03711-security-performance-20261026');fs.mkdirSync(root,{recursive:true});
const id='performance-synthetic-03711';
(async()=>{
 const p=client('attendance'),children=[],contexts=[];let browser;
 const output={at:new Date().toISOString(),syntheticOnly:true,productionAccessed:false,realMessagesSent:false};
 try{
  const companyId='cmp_mibro';
  // Names in SQL-only fixtures are optional; give them labels so the frozen
  // reference can render them too (the candidate also handles absent names).
  await p.contact.updateMany({where:{name:null,OR:[{id:{startsWith:'paging-email-'}},{id:{startsWith:'paging-privacy-'}}]},data:{name:'Contato sintético de validação'}});
  for(let i=0;i<220;i++){
   const item=id+'-'+i;
   await p.contact.upsert({where:{id:item},create:{id:item,companyId,channel:'META',externalId:item,name:'Contato sintético '+i},update:{}});
   await p.conversation.upsert({where:{id:item},create:{id:item,companyId,contactId:item,channel:'META',status:i%2?'FINALIZADO':'AGUARDANDO_EQUIPE',lastMessageAt:new Date(Date.now()-i*1000)},update:{}});
  }
  const conversationId=id+'-0',start=new Date('2026-10-25T12:00:00Z');
  await p.message.createMany({skipDuplicates:true,data:Array.from({length:420},(_,i)=>({id:id+'-message-'+String(i).padStart(4,'0'),conversationId,channel:'META',direction:'RECEBIDA',status:'ENTREGUE',type:'text',text:'Histórico sintético '+i+' — '+('conteúdo de teste '.repeat(10)),occurredAt:new Date(start.getTime()+i*1000)}))});
  await p.message.upsert({where:{id:id+'-old-document'},create:{id:id+'-old-document',conversationId,channel:'META',direction:'RECEBIDA',status:'ENTREGUE',type:'document',mediaStorageKey:'synthetic-not-real',mediaFileName:'old-synthetic.pdf',mediaMimeType:'application/pdf',occurredAt:new Date(start.getTime()-1000)},update:{}});
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|PROGRAMFILES|SYSTEMDRIVE|NODE_PATH)$/i.test(key)));
  for(const [target,port]of [[path.resolve(__dirname,'../release-03710-media-password-20261026/build/attendance'),4039],[path.join(__dirname,'attendance'),4040]]){
   const child=spawn(process.execPath,['--expose-gc',path.join(__dirname,'local-benchmark-server.cjs'),target,String(port)],{cwd:__dirname,env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);
   let errors='';child.stderr.on('data',chunk=>{errors+=chunk;fs.writeFileSync(path.join(root,'benchmark-'+port+'.stderr.log'),errors);});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Benchmark start timeout: '+errors.slice(-800))),20000);child.stdout.on('data',chunk=>{if(String(chunk).includes('Synthetic benchmark ready')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Benchmark exited: '+errors.slice(-800)));});});
  }
  browser=await chromium.launch({channel:'msedge',headless:true});
  for(const [name,port]of [['before',4039],['after',4040]]){
   const origin='http://127.0.0.1:'+port,context=await browser.newContext({serviceWorkers:'block'});contexts.push(context);await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
   assert.equal((await context.request.post(origin+'/api/auth/login',{data:{email:credentials.ownerEmail,password:credentials.password}})).status(),200);
   const apiStart=performance.now(),listResponse=await context.request.get(origin+'/api/conversations'+(name==='after'?'?limit=80':'')),listBytes=(await listResponse.body()).length;
   const listMs=performance.now()-apiStart,list=await listResponse.json();
   if(name==='after'){
    assert.equal(list.items.length,80);assert.ok(list.total>=220);const next=await(await context.request.get(origin+'/api/conversations?limit=80&cursor='+encodeURIComponent(list.nextCursor))).json();assert.equal(new Set([...list.items,...next.items].map(row=>row.id)).size,160);
    const page=await(await context.request.get(origin+'/api/conversations/'+conversationId+'?historyPage=true')).json();assert.equal(page.messages.length,80);assert.equal(page.messagePage.hasMore,true);
    const older=await(await context.request.get(origin+'/api/conversations/'+conversationId+'?historyPage=true&historyBefore='+encodeURIComponent(page.messagePage.nextCursor))).json();assert.equal(older.messages.length,80);assert.equal(new Set([...page.messages,...older.messages].map(row=>row.id)).size,160);
    const denied=await context.request.get(origin+'/api/conversations/'+conversationId+'?historyPage=true&historyBefore=invalid');assert.equal(denied.status(),400);
   }
   const page=await context.newPage();await page.goto(origin+'/');await page.waitForFunction(()=>typeof openConversation==='function'&&state.currentUser);await page.evaluate(id=>openConversation(id),conversationId);await page.locator('#messages [data-message-id]').first().waitFor();
   const initialMessageRows=await page.locator('#messages [data-message-id]').count();
   if(name==='after'){
    const all=(await(await context.request.get(origin+'/api/conversations')).json()).filter(row=>!['MERCADO_LIVRE','TIKTOK_SHOP','AMAZON_MARKETPLACE','SHOPEE','SHEIN_MARKETPLACE'].includes(row.channel)&&(row.channel!=='EMAIL'||row.emailMailbox!=='SPAM'));
    const expected={all:all.length,new:all.filter(row=>row.status==='NOVO').length,waiting:all.filter(row=>row.status==='AGUARDANDO_EQUIPE').length,finalized:all.filter(row=>row.status==='FINALIZADO').length};
    await page.waitForFunction(expected=>Object.entries(expected).every(([key,value])=>Number(document.querySelector('#count-'+key).textContent)===value),expected);
    output.sidebarCounterParity=true;
    assert.equal(await page.evaluate(()=>Boolean(window.MibroChangelog)),false);await page.locator('#changelog-button').click();await page.locator('#changelog-dialog').waitFor({state:'visible'});await page.locator('#close-changelog').click();output.lazyChangelogVerified=true;
    assert.equal(initialMessageRows,80);
    const anchor=await page.evaluate(()=>{setTimelineScroll(60);return captureTimelineAnchor();});
    await page.waitForFunction(()=>state.selectedMessages.length===160&&!historyLoading);
    const restored=await page.evaluate(original=>{const box=document.querySelector('#messages'),row=box.querySelector('[data-message-id="'+CSS.escape(original.id)+'"]');return {id:original.id,offset:row.getBoundingClientRect().top-box.getBoundingClientRect().top,top:box.scrollTop};},anchor);output.scrollAnchorSamples={before:anchor,after:restored};assert.ok(Math.abs(restored.offset-anchor.offset)<3,'older history must preserve the reading anchor');output.scrollAnchorPreserved=true;
    const oldest=await page.locator('#messages [data-message-id]').first().getAttribute('data-message-id');assert.ok(oldest);output.incrementalHistoryVerified=true;
    await page.evaluate(()=>openContactFiles());await page.locator('#contact-files-dialog [data-files-tab="documents"]').click();await page.locator('#contact-files-content').getByText('old-synthetic.pdf',{exact:true}).waitFor();await page.locator('#close-contact-files').click();output.olderSharedFilesPreserved=true;
   }
   await page.locator('#messages').evaluate(box=>box.scrollTop=box.scrollHeight);
   const clicks=[];for(let i=0;i<12;i++)clicks.push(await page.evaluate(async()=>{const button=document.querySelector('#open-attachments'),old=button.getAttribute('aria-expanded'),at=performance.now();button.click();await new Promise(requestAnimationFrame);if(old===button.getAttribute('aria-expanded'))throw Error('button failed');return performance.now()-at;}));
   const arrivals=[];for(let i=0;i<5;i++){
    const text='Evento sintético '+name+' '+Date.now()+'-'+i;await p.message.create({data:{conversationId,channel:'META',direction:'RECEBIDA',status:'ENTREGUE',type:'text',text,occurredAt:new Date()}});await p.conversation.update({where:{id:conversationId},data:{unreadCount:1,lastMessageAt:new Date()}});
    const at=performance.now();await context.request.post(origin+'/api/conversations/'+conversationId+'/read');await page.locator('#messages').getByText(text,{exact:true}).waitFor();arrivals.push(performance.now()-at);
   }
   const memory=await(await context.request.get(origin+'/__localmetrics')).json();
   output[name]={listBytes,listMs:Math.round(listMs),initialMessageRows,buttonP95Ms:Math.round([...clicks].sort((a,b)=>a-b)[Math.ceil(clicks.length*.95)-1]),newMessageP95Ms:Math.round([...arrivals].sort((a,b)=>a-b)[Math.ceil(arrivals.length*.95)-1]),heapUsed:memory.heapUsed,rss:memory.rss};
   await page.screenshot({path:path.join(root,'inbox-'+name+'.png')});await context.close();
  }
  assert.ok(output.after.listBytes<output.before.listBytes,'initial response must be lighter');
  assert.ok(output.after.newMessageP95Ms<=output.before.newMessageP95Ms*1.3+50,'new message latency regression');
  assert.ok(output.after.buttonP95Ms<=output.before.buttonP95Ms*1.3+50,'button latency regression');
  output.passed=true;
 }finally{for(const context of contexts)await context.close().catch(()=>{});if(browser)await browser.close();for(const child of children)child.kill();await p.$disconnect();fs.writeFileSync(path.join(root,'inbox-performance.json'),JSON.stringify(output,null,2));}
 console.log(JSON.stringify(output));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
