const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=process.argv[2]||process.env.MINHAS_TEST_ROOT||'attendance';
const source=fs.readFileSync(root+'/public/js/app.js','utf8'),index=fs.readFileSync(root+'/public/index.html','utf8');
const start=source.indexOf('async function loadConversations() {'),end=source.indexOf('  const companyOnly =',start);
const query=source.slice(start,end)+'window.lastParams=params.toString();window.requests=(window.requests||0)+1;}';
const handlerStart=source.indexOf('document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => {');
const handler=source.slice(handlerStart,source.indexOf('// Filtros combináveis adicionais',handlerStart));
const navStart=index.indexOf('<p class="nav-title">ATENDIMENTO</p>'),nav=index.slice(navStart,index.indexOf('</nav>',navStart));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage();await page.setContent('<nav>'+nav+'</nav><select id="preferred-assignee-filter"><option value="">Todos</option></select>');
 await page.addScriptTag({content:`const $=selector=>document.querySelector(selector);const state=window.testState={currentUser:{id:'seller'},status:'',search:'Carla',channel:'META',assignedUser:'other',assignedUserActiveOnly:true,category:'old',unassigned:true,preferredAssignee:'ME',statusToggle:new Set(['NOVO']),priorityToggle:new Set()};const companyQuery=()=>window.testCompany||'mibro';${query}\n${handler}`});
 await page.getByRole('button',{name:'Minhas',exact:true}).click();
 let p=new URLSearchParams(await page.evaluate(()=>window.lastParams));assert.equal(p.get('assignedUser'),'seller');assert.equal(p.has('status'),false);assert.equal(p.has('unassigned'),false);assert.equal(p.has('preferredAssignee'),false);assert.equal(p.get('company'),'mibro');assert.equal(p.get('search'),'Carla');assert.equal(p.get('channel'),'META');
 assert.match(await page.getByRole('button',{name:'Minhas',exact:true}).getAttribute('class'),/active/);
 console.log('PASS Minhas click selects current owner and clears conflicting filters in one request');
 await page.locator('[data-status=""]').click();p=new URLSearchParams(await page.evaluate(()=>window.lastParams));assert.equal(p.has('assignedUser'),false);console.log('PASS Todos removes the ownership shortcut');
 await page.evaluate(()=>window.testCompany='sincrofit');await page.getByRole('button',{name:'Minhas',exact:true}).click();p=new URLSearchParams(await page.evaluate(()=>window.lastParams));assert.equal(p.get('company'),'sincrofit');assert.equal(p.get('assignedUser'),'seller');assert.equal(await page.evaluate(()=>window.requests),3);console.log('PASS Minhas follows active company without an extra ownership request');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
