const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Pichau/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.join(__dirname,'attendance/public'),out=path.resolve(__dirname,'../profile-polish-20261029');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),source=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
const dialog=html.slice(html.indexOf('<dialog id="contact-files-dialog"'),html.indexOf('</dialog>',html.indexOf('<dialog id="contact-files-dialog"'))+9);
const open=source.slice(source.indexOf('async function openContactFiles()'),source.indexOf('\nfunction syncMessageStatuses',source.indexOf('async function openContactFiles()')));
const handlers=source.slice(source.indexOf("for (const [selector,field,label] of [['#copy-contact-name'"),source.indexOf('$("#copy-conversation-id").addEventListener'));
if(!handlers||!open||!dialog)throw Error('Profile implementation not found');
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');if(u.pathname==='/preview'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html lang="pt-BR" data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/skeleton.css"><link rel="stylesheet" href="/css/bots.css"><link rel="stylesheet" href="/css/app.css"></head><body><aside id="details" style="width:335px;max-width:calc(100vw - 32px);margin:20px"></aside>'+dialog+'</body></html>');}const p=path.resolve(root,'.'+u.pathname);if(!p.startsWith(root+path.sep)){res.writeHead(404).end();return;}try{res.setHeader('Content-Type',p.endsWith('.css')?'text/css':'application/javascript');res.end(fs.readFileSync(p));}catch{res.writeHead(404).end();}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1200,height:800}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/preview');
  await page.addScriptTag({path:path.join(root,'js/conversation-archive.js')});
  await page.evaluate(()=>document.querySelector('#details').innerHTML=window.ConversationArchive.markup({id:'test-chat'}));
  const card=page.locator('.conversation-archive-card');await card.screenshot({path:path.join(out,'archive-card.png')});
  assert.equal(await card.locator('p').count(),1);assert.ok(await card.getByRole('button',{name:'Arquivar conversa'}).evaluate(el=>getComputedStyle(el).fontSize==='11px'));
  assert.ok(await card.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.addScriptTag({content:`const state={selectedId:'test-chat',selectedContactName:'Cliente de demonstração',selectedContactPhone:'5511999999999',currentUser:{isMaster:false}};window.profileState=state;const $=s=>document.querySelector(s);window.copied=[];window.toasts=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copied.push(value);}}});function toast(message,error){window.toasts.push({message,error});}async function loadSharedContent(){$('#contact-files-content').textContent='Nenhuma imagem ou vídeo disponível nesta conversa.';}\n${open}\n${handlers}`});
  await page.evaluate(()=>openContactFiles());
  await page.getByRole('button',{name:'Copiar nome',exact:true}).click();await page.getByRole('button',{name:'Copiar número',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.copied),['Cliente de demonstração','5511999999999']);assert.equal(await page.locator('#contact-files-phone').textContent(),'+5511999999999');
  await page.screenshot({path:path.join(out,'profile-desktop.png')});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'profile-mobile.png')});
  await page.evaluate(()=>window.profileState.selectedId='changed-contact');await page.getByRole('button',{name:'Copiar nome',exact:true}).click();assert.equal(await page.evaluate(()=>window.copied.length),2);
  await page.evaluate(()=>{document.querySelector('#contact-files-dialog').close();Object.assign(window.profileState,{selectedId:'new-contact',selectedContactName:'Cliente sem telefone',selectedContactPhone:''});return openContactFiles();});
  assert.equal(await page.getByRole('button',{name:'Copiar número',exact:true}).isVisible(),false);await page.getByRole('button',{name:'Copiar nome',exact:true}).click();assert.equal(await page.evaluate(()=>window.copied.at(-1)),'Cliente sem telefone');
  await page.evaluate(()=>navigator.clipboard.writeText=async()=>{throw Error('Denied');});await page.getByRole('button',{name:'Copiar nome',exact:true}).click();assert.ok(await page.evaluate(()=>window.toasts.at(-1).error));assert.deepEqual(errors,[]);
  const result={checks:8,passed:true,consoleErrors:errors,clipboardWritesSynthetic:true,realDatabaseAccess:false,realMessagesSent:0};fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.message);server.close();process.exitCode=1});
