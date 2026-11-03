const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Pichau/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const publicRoot=path.join(__dirname,'attendance/public'),out=path.resolve(__dirname,'../conversation-archive-20261029');
fs.mkdirSync(out,{recursive:true});
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://local'),p=path.resolve(publicRoot,'.'+(url.pathname==='/arquivados'?'/arquivados.html':url.pathname));if(!p.startsWith(publicRoot+path.sep)){res.writeHead(404).end();return;}try{res.writeHead(200,{'Content-Type':types[path.extname(p)]||'application/octet-stream'});res.end(fs.readFileSync(p));}catch{res.writeHead(404).end();}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let searches=[],error=false,patches=[];
 const item=(id,name)=>({id,archivedAt:'2026-10-29T12:00:00Z',contact:{name,phone:'5511000000000'},category:{name:'Atacado'},assignedUser:{name:'Vendedor de demonstração'}});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(u.pathname==='/api/companies')return route.fulfill({json:{companies:[{id:'m',slug:'mibro',name:'Mibro Brasil'},{id:'s',slug:'sincrofit',name:'Sincrofit'}],preference:'mibro'}});
  if(u.pathname==='/api/conversations'){
   searches.push(Object.fromEntries(u.searchParams));assert.equal(u.searchParams.get('archived'),'true');
   if(error)return route.fulfill({status:503,json:{error:'Não foi possível consultar agora.'}});
   const more=u.searchParams.get('cursor'),other=u.searchParams.get('company')==='sincrofit';
   return route.fulfill({json:{items:[item(more?'older':other?'sincro':'mibro',more?'Contato anterior':other?'Cliente Sincrofit':'Cliente de demonstração')],total:2,nextCursor:more?null:'synthetic-cursor'}});
  }
  if(u.pathname.endsWith('/archive')){patches.push(route.request().postDataJSON());await new Promise(resolve=>setTimeout(resolve,80));return route.fulfill({json:{id:'test-chat',archivedAt:patches.at(-1).archived?'2026-10-29':null}});}
  return route.continue();
 });
 try{
  await page.goto(origin+'/arquivados');await page.getByRole('link',{name:'Ver conversa e detalhes'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Arquivados',exact:true}).getAttribute('aria-current'),'page');
  assert.ok((await page.getByRole('link',{name:'Ver conversa e detalhes'}).getAttribute('href')).includes('conversation=mibro'));
  await page.getByRole('button',{name:'Carregar mais'}).click();await page.getByText('Contato anterior',{exact:true}).waitFor();assert.equal(await page.locator('.archive-item').count(),2);
  await page.locator('#archive-company').selectOption('sincrofit');await page.getByText('Cliente Sincrofit',{exact:true}).waitFor();assert.equal(await page.getByText('Cliente de demonstração',{exact:true}).count(),0);
  assert.equal(searches.at(-1).company,'sincrofit');
  error=true;await page.getByRole('button',{name:'Buscar',exact:true}).click();await page.getByText('Não foi possível consultar agora.',{exact:true}).waitFor();
  error=false;await page.locator('#archive-company').selectOption('mibro');await page.getByText('Cliente de demonstração',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'arquivados-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'arquivados-mobile.png'),fullPage:true});
  await page.setContent('<main id="details"></main>');await page.addScriptTag({path:path.join(publicRoot,'js/conversation-archive.js')});
  await page.evaluate(()=>{window.archiveEvents=[];document.addEventListener('central:archive-changed',e=>window.archiveEvents.push(e.detail));document.querySelector('#details').innerHTML=window.ConversationArchive.markup({id:'test-chat'});});
  let confirmation='';page.once('dialog',async dialog=>{confirmation=dialog.message();await dialog.accept();});await page.getByRole('button',{name:'Arquivar conversa',exact:true}).click();
  await page.waitForFunction(()=>window.archiveEvents.length===1);assert.equal(patches.length,1);assert.equal(patches[0].archived,true);assert.ok(confirmation.includes('Somente a recuperação manual'));
  await page.evaluate(()=>{document.querySelector('#details').innerHTML=window.ConversationArchive.markup({id:'test-chat',archivedAt:'2026-10-29'});});await page.getByRole('button',{name:'Recuperar conversa',exact:true}).click();await page.waitForFunction(()=>window.archiveEvents.length===2);assert.equal(patches[1].archived,false);
  assert.equal(await page.evaluate(()=>window.ConversationArchive.markup({id:'test-chat',accessMode:'SUPERVISION'})),'');
  assert.equal(await page.evaluate(()=>window.ConversationArchive.markup({id:'<script>'})), '');
  assert.deepEqual(errors,[]);
  const result={checks:9,passed:true,consoleErrors:errors,syntheticPatchRequests:patches.length,realMessagesSent:0,realDatabasesAccessed:false};fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.message);server.close();process.exitCode=1});
