const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {client,credentials}=require('./local-fixtures.cjs');
const origin='http://127.0.0.1:4037',out=path.resolve(__dirname,'../release-03710-media-password-20261026');
(async()=>{
 const p=client('attendance'),id='media-release-synthetic-20261026';let browser,ctx;
 const result={at:new Date().toISOString(),syntheticOnly:true,productionAccessed:false,realMessagesSent:false};
 try{
  await p.contact.upsert({where:{id},create:{id,companyId:'cmp_mibro',channel:'META',externalId:'media-release-synthetic',name:'Validação local de anexos'},update:{}});
  await p.conversation.upsert({where:{id},create:{id,companyId:'cmp_mibro',channel:'META',contactId:id,status:'AGUARDANDO_EQUIPE',lastMessageAt:new Date()},update:{lastMessageAt:new Date()}});
  if(!await p.message.findFirst({where:{conversationId:id,type:'unsupported'}}))await p.message.create({data:{conversationId:id,channel:'META',direction:'RECEBIDA',status:'ENTREGUE',type:'unsupported',text:'[unsupported]',occurredAt:new Date(),rawPayload:{type:'unsupported',unsupported:{type:'unknown'},errors:[{code:131051}]}}});
  browser=await chromium.launch({channel:'msedge',headless:true});ctx=await browser.newContext({serviceWorkers:'block'});
  await ctx.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  assert.equal((await ctx.request.post(origin+'/api/auth/login',{data:{email:credentials.ownerEmail,password:credentials.password}})).status(),200);
  const page=await ctx.newPage();page.setDefaultTimeout(15000);await page.goto(origin+'/');await page.waitForFunction(()=>typeof openConversation==='function'&&state.currentUser);
  await page.evaluate(id=>openConversation(id),id);await page.locator('#messages').getByText('Mensagem não suportada',{exact:true}).waitFor();
  result.unsupportedNoticeVisible=true;
  const bmp=Buffer.alloc(58);bmp.write('BM');bmp.writeUInt32LE(58,2);bmp.writeUInt32LE(54,10);bmp.writeUInt32LE(40,14);bmp.writeInt32LE(1,18);bmp.writeInt32LE(1,22);bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);bmp[54]=255;
  await page.locator('#attachment-input').setInputFiles({name:'imagem-teste.bmp',mimeType:'image/bmp',buffer:bmp});await page.locator('#attachment-preview').waitFor({state:'visible'});assert.match(await page.locator('#attachment-name').innerText(),/será convertido/);result.bmpPreview=true;
  await page.locator('#attachment-input').setInputFiles({name:'animacao-teste.gif',mimeType:'image/gif',buffer:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')});assert.equal(await page.locator('#attachment-type').innerText(),'VÍDEO');result.gifRoutedAsVideo=true;
  await page.evaluate(()=>clearSelectedAttachment());
  const clicks=[];
  for(let i=0;i<10;i++)clicks.push(await page.evaluate(async()=>{const button=document.querySelector('#open-attachments'),before=button.getAttribute('aria-expanded'),start=performance.now();button.click();await new Promise(requestAnimationFrame);if(button.getAttribute('aria-expanded')===before)throw Error('button did not toggle');return performance.now()-start;}));
  result.buttonClickToFrameMs={samples:clicks.length,p95:Math.round([...clicks].sort((a,b)=>a-b)[Math.ceil(clicks.length*.95)-1]*10)/10};
  const arrivals=[];
  for(let i=0;i<3;i++){
   const text='Mensagem sintética de latência '+Date.now()+'-'+i;
   await p.message.create({data:{conversationId:id,channel:'META',direction:'RECEBIDA',status:'ENTREGUE',type:'text',text,occurredAt:new Date()}});
   await p.conversation.update({where:{id},data:{unreadCount:1,lastMessageAt:new Date()}});
   const start=performance.now();await ctx.request.post(origin+'/api/conversations/'+id+'/read');await page.locator('#messages').getByText(text,{exact:true}).waitFor();arrivals.push(Math.round(performance.now()-start));
  }
  result.localEventToMessageVisibleMs=arrivals;
  for(const width of [1280,390]){await page.setViewportSize({width,height:900});await page.evaluate(async id=>{closeMobileDrawers();await openConversation(id);},id);await page.screenshot({path:path.join(out,'media-preview-'+width+'.png')});}
  result.passed=true;
 }finally{if(ctx)await ctx.close();if(browser)await browser.close();await p.$disconnect();fs.writeFileSync(path.join(out,'media-browser-verification.json'),JSON.stringify(result,null,2));}
 console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
