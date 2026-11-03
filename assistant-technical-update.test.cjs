const test=require('node:test'),assert=require('node:assert/strict');
const {prepare,install}=require('./attendance/scripts/assistant-technical-update-20261028.cjs');
function fixture(draftEdited=false){
 const old={nodes:[{key:'start'},{key:'tech_intake_documents'},{key:'human'}],edges:[]};
 const bot={id:'mibro-assistant-observer',companyId:'cmp_mibro',status:'PAUSED',autoReplyEnabled:false,archivedAt:null,updatedAt:new Date(0),featureFlags:{preserve:'yes'}};
 const flow={id:'asst_20261027_technical',botId:bot.id,updatedAt:new Date(0),activeVersionId:'old-version',activeVersion:{graph:old},draftGraph:draftEdited?{...old,operatorUnsavedNote:'preserve'}:old};
 const writes=[];const db={bot:{findUnique:async()=>bot},botFlow:{findUnique:async()=>flow,update:async({data})=>{writes.push(data);}},botFlowVersion:{aggregate:async()=>({_max:{version:1}}),create:async({data})=>{writes.push(data);return{id:'version-2'};}},$queryRaw:async()=>{},$transaction:async fn=>fn(db)};
 return{db,bot,flow,writes};
}
test('only the technical version changes, leaving activation flags untouched',async()=>{
 const f=fixture(),before=JSON.stringify(f.bot),p=await prepare(f.db),r=await install(f.db,p);
 assert.equal(r.version,2);assert.equal(JSON.stringify(f.bot),before);assert.equal(r.botStatusUnchanged,'PAUSED');assert.equal(f.writes.length,2);assert.ok(f.writes[1].draftGraph);
});
test('an operator draft is preserved while publishing a new version',async()=>{
 const f=fixture(true),p=await prepare(f.db),r=await install(f.db,p);assert.equal(r.operatorDraftPreserved,true);assert.equal(f.writes[1].draftGraph,undefined);
});
test('concurrent activation or graph edits block publication',async()=>{
 const f=fixture(),p=JSON.parse(JSON.stringify(await prepare(f.db)));f.bot.autoReplyEnabled=true;await assert.rejects(install(f.db,p),/changed since preflight/);assert.equal(f.writes.length,0);
});
test('custom published nodes must be merged, never silently removed',async()=>{
 const f=fixture();f.flow.activeVersion.graph.nodes.push({key:'operator-custom-node'});await assert.rejects(prepare(f.db),/reviewed merge/);assert.equal(f.writes.length,0);
});
