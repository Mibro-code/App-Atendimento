const fs=require('node:fs'),{chromium}=require('playwright');
const old=fs.readFileSync('../internal-history-release-20261021/baseline/public/js/internal-chat.js','utf8'),current=fs.readFileSync('attendance/public/js/internal-chat.js','utf8');
const oldRender=old.slice(old.indexOf('  function renderMessages('),old.indexOf('  function setComposerState(')).replace('function renderMessages(','function oldRenderMessages(');
const harness=current.slice(0,current.indexOf('  async function loadUsers()'))+oldRender+'window.Bench={state,renderMessages,oldRenderMessages};})();';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage();await page.setContent('<style>#internal-chat-messages{height:350px;overflow:auto}.internal-message-row{min-height:65px}</style><div id="internal-chat-messages"></div>');await page.addScriptTag({content:harness});
 const metrics=await page.evaluate(()=>{
  const p=document.querySelector('#internal-chat-messages'),messages=Array.from({length:301},(_,i)=>({id:'b'+i,createdAt:new Date(i+1000).toISOString(),type:'USER',text:'Mensagem fictícia '+i,senderUser:{name:'Fictício'}}));
  const measure=fn=>{const values=[];for(let i=0;i<25;i++){const time=performance.now();fn();values.push(performance.now()-time);}values.sort((a,b)=>a-b);return {medianMs:values[12],p95Ms:values[23]};};
  const initialOld=measure(()=>{p.innerHTML='';Bench.oldRenderMessages(messages.slice(0,300));});
  const initialNew=measure(()=>{p.innerHTML='';Bench.renderMessages(messages.slice(-60));});
  const updateOld=measure(()=>{Bench.oldRenderMessages(messages.slice(0,300));});
  Bench.state.hasOlder=true;p.innerHTML='';Bench.renderMessages(messages);
  const updateNew=measure(()=>{Bench.renderMessages(messages);});
  return {environment:'LOCAL_EDGE_HEADLESS_SYNTHETIC_NO_NETWORK',iterations:25,initialOld300:initialOld,initialNew60:initialNew,refreshOld300:updateOld,refreshNew301Reused:updateNew};
 });
 fs.writeFileSync('../internal-history-release-20261021/local-render-performance.json',JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics,null,2));
 if(metrics.initialNew60.p95Ms>metrics.initialOld300.p95Ms+5||metrics.refreshNew301Reused.p95Ms>metrics.refreshOld300.p95Ms+5)throw Error('Relevant local render regression');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
