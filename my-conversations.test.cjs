const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('attendance/public/js/app.js','utf8'),index=fs.readFileSync('attendance/public/index.html','utf8');
const start=source.indexOf('async function loadConversations() {'),end=source.indexOf('  const companyOnly =',start);
const query=source.slice(start,end).replace('async function loadConversations() {','function paramsForTest() {')+'return params; } paramsForTest();';
function params(values={},company='mibro'){
 const state={currentUser:{id:'seller'},status:'',category:'',search:'',channel:'',assignedUser:'',assignedUserActiveOnly:false,statusToggle:new Set(),priorityToggle:new Set(),...values};
 return vm.runInNewContext(query,{state,URLSearchParams,companyQuery:()=>company});
}
test('Minhas is directly below Todos in the Atendimento sidebar',()=>{assert.match(index,/data-status=""[^>]*>[\s\S]*?<\/button>\s*<button[^>]*data-status="MINE"[^>]*><span>Minhas<\/span>/);});
test('Minhas uses current assigned user, never a fixed owner or a fake status',()=>{const p=params({status:'MINE'});assert.equal(p.get('assignedUser'),'seller');assert.equal(p.has('status'),false);assert.equal(p.has('preferredAssignee'),false);});
test('Minhas preserves workspace, channel and text search',()=>{const p=params({status:'MINE',channel:'META',search:'Carla'},'sincrofit');assert.equal(p.get('company'),'sincrofit');assert.equal(p.get('channel'),'META');assert.equal(p.get('search'),'Carla');});
test('stale team selection cannot override current user or hide assigned finalized conversations',()=>{const p=params({status:'MINE',assignedUser:'another',assignedUserActiveOnly:true});assert.equal(p.get('assignedUser'),'seller');assert.equal(p.has('activeOnly'),false);});
test('Todos and ordinary status filters remain unchanged',()=>{assert.equal(params().has('assignedUser'),false);assert.equal(params({status:'AGUARDANDO_EQUIPE'}).get('status'),'AGUARDANDO_EQUIPE');});
test('Minhas does not issue an unrestricted query before the user is known',()=>{assert.equal(params({status:'MINE',currentUser:null}),undefined);});
test('Minhas is retained by existing per-workspace status persistence',()=>{assert.match(source,/WORKSPACE_FILTER_KEYS\s*=\s*\[[^\]]*"status"/);assert.match(source,/dataset.status === state.status/);});
