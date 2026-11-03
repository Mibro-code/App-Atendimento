const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
  const elements=Object.fromEntries(['status','refresh','toggle'].map(id=>[id,{textContent:'',disabled:true,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}}]));
  const calls=[],responses=[],window={confirm:()=>true};
  const context={document:{querySelector:selector=>elements[selector.split('-').pop()]},window,
    fetch:(url,options)=>{calls.push({url,options});return new Promise(resolve=>responses.push(data=>resolve({ok:!data.error,json:async()=>data})));}};
  vm.runInNewContext(fs.readFileSync(require.resolve('./attendance/public/js/crm-access-admin.js'),'utf8'),context);
  return{elements,calls,responses,window};
}
test('new user requires save first and does not query CRM',async()=>{const f=fixture();await f.window.CrmAccessAdmin.load(null);assert.equal(f.calls.length,0);assert.equal(f.elements.toggle.disabled,true);});
test('CRM permission can be enabled only for an eligible account',async()=>{
  const f=fixture(),loading=f.window.CrmAccessAdmin.load('a');f.responses.shift()({enabled:false,effective:false,eligible:true,account:{name:'Pessoa',email:'p@example.invalid',role:'VENDEDOR'}});await loading;
  assert.equal(f.elements.toggle.disabled,false);assert.match(f.elements.toggle.textContent,/Permitir/);
  const saving=f.elements.toggle.listeners.click();assert.equal(f.calls[1].options.method,'POST');assert.equal(JSON.parse(f.calls[1].options.body).enabled,true);
  f.responses.shift()({status:'LINKED'});await new Promise(resolve=>setImmediate(resolve));
  f.responses.shift()({enabled:true,effective:true,eligible:true,account:{name:'Pessoa',email:'p@example.invalid',role:'VENDEDOR'}});await saving;
  assert.match(f.elements.status.textContent,/ativo/);assert.match(f.elements.toggle.textContent,/Desativar/);
});
test('late response never paints permissions for a different member',async()=>{
  const f=fixture(),a=f.window.CrmAccessAdmin.load('a'),b=f.window.CrmAccessAdmin.load('b');
  f.responses[1]({enabled:false,eligible:false,reason:'Conta B ausente'});await b;
  f.responses[0]({enabled:true,effective:true,eligible:true,account:{name:'Conta A'}});await a;
  assert.equal(f.elements.status.textContent,'Conta B ausente');assert.equal(f.elements.toggle.disabled,true);
});
test('network/server failure is visible and cannot enable unchecked access',async()=>{
  const f=fixture(),loading=f.window.CrmAccessAdmin.load('a');f.responses.shift()({error:'CRM indisponível'});await loading;
  assert.equal(f.elements.status.textContent,'CRM indisponível');assert.equal(f.elements.toggle.disabled,true);assert.equal(f.elements.refresh.disabled,false);
});
test('cancelled confirmation sends no mutation',async()=>{
  const f=fixture(),loading=f.window.CrmAccessAdmin.load('a');f.responses.shift()({enabled:false,eligible:true,account:{name:'Pessoa'}});await loading;
  f.window.confirm=()=>false;await f.elements.toggle.listeners.click();assert.equal(f.calls.length,1);
});
