// Botões Atividades / Busca integrada / Avisos da Central: o evento inicial
// do workspace (mesma empresa) não fecha o painel; troca real de empresa fecha.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function load(){
  const listeners={},created=[];
  const element=(tag)=>{const el={tag,dataset:{},children:[],style:{},open:false,listeners:{},
    append(...items){this.children.push(...items);},before(...items){created.push(...items);},remove(){this.removed=true;},
    setAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;},showModal(){this.open=true;},close(){this.open=false;},
    querySelector(selector){return selector==='iframe'?this.children.filter(child=>child.tag==='iframe'&&!child.removed).at(-1)||null:null;}};return el;};
  let workspace={slug:'mibro'};
  const document={body:element('body'),createElement:element,querySelector:()=>element('user'),addEventListener(type,fn){listeners[type]=fn;}};
  const window={CentralWorkspace:{current:()=>workspace}};
  const fetch=async()=>({ok:true,json:async()=>({crmAvailable:true,crmOrigin:'http://127.0.0.1:4038'})});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'attendance/public/js/central-navigation.js'),'utf8'),{fetch,document,window,URL});
  return {listeners,created,dialog:()=>document.body.children.find(child=>child.tag==='dialog'),switchTo:slug=>{workspace={slug};}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Atividades opens the activity center for the active company only',async()=>{
  const ui=load();await tick();
  const button=ui.created.find(item=>item.textContent==='Atividades');assert.ok(button);
  button.listeners.click();const frame=ui.dialog().querySelector('iframe');
  assert.equal(ui.dialog().open,true);assert.equal(new URL(frame.src).searchParams.get('next'),'/central-activities?company=mibro');
});
test('initial workspace event for the same company keeps the panel open; a real switch closes it',async()=>{
  const ui=load();await tick();
  ui.created.find(item=>item.textContent==='Avisos').listeners.click();
  ui.listeners['central:workspace-changed']({detail:{company:{slug:'mibro'},initial:true}});
  assert.equal(ui.dialog().open,true);assert.ok(ui.dialog().querySelector('iframe'));
  ui.switchTo('sincrofit');ui.listeners['central:workspace-changed']({detail:{company:{slug:'sincrofit'}}});
  assert.equal(ui.dialog().open,false);assert.equal(ui.dialog().querySelector('iframe'),null);
});
