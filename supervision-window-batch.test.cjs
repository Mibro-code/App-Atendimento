const {test}=require('node:test'),assert=require('node:assert/strict');
const {supervisionWindows}=require('./attendance/src/services/assignment-period-service');
const {supervisionWindowsMany}=require('./attendance/src/services/supervision-window-batch-service');
function mock(periods=[],activities=[]){
 const calls={periods:0,activities:0};
 const inScope=(value,filter)=>typeof filter==='string'?value===filter:filter.in.includes(value);
 const matchActivity=(row,where)=>inScope(row.conversationId,where.conversationId)&&where.action.in.includes(row.action)&&(where.details?row.details?.toUserId===where.details.equals:where.OR.some(f=>f.details.equals===row.details?.toUserId));
 const ordered=rows=>rows.slice().sort((a,b)=>b.createdAt-a.createdAt);
 return {calls,conversationAssignmentPeriod:{findMany:async({where})=>{calls.periods++;return periods.filter(p=>inScope(p.conversationId,where.conversationId)&&where.userId.in.includes(p.userId));}},conversationActivity:{findFirst:async({where})=>{calls.activities++;return ordered(activities.filter(a=>matchActivity(a,where)))[0]||null;},findMany:async({where})=>{calls.activities++;return ordered(activities.filter(a=>matchActivity(a,where)));}}};
}
test('250 supervised conversations use one period query with identical windows',async()=>{
 const conversations=Array.from({length:250},(_,i)=>({id:'c'+i,assignedUserId:'other'})),periods=conversations.map((c,i)=>({conversationId:c.id,userId:'team',startedAt:new Date(i*1000),endedAt:new Date(i*1000+500)}));
 const db=mock(periods),actual=await supervisionWindowsMany(conversations,['team'],db);
 for(const c of conversations)assert.deepEqual(actual.get(c.id),await supervisionWindows(c,['team'],mock(periods)));
 assert.equal(db.calls.periods,1);assert.equal(db.calls.activities,0);
});
test('legacy fallback, current owner, missing history and outside-team events retain exact boundaries',async()=>{
 const conversations=[{id:'closed',assignedUserId:'team'},{id:'open',assignedUserId:'team'},{id:'unknown',assignedUserId:'team'},{id:'other',assignedUserId:'other'},{id:'free',assignedUserId:null}];
 const periods=[{conversationId:'closed',userId:'team',startedAt:new Date(1000),endedAt:new Date(2000)},{conversationId:'open',userId:'team',startedAt:new Date(1000),endedAt:null},{conversationId:'other',userId:'outsider',startedAt:new Date(0),endedAt:null}];
 const activities=[{conversationId:'closed',action:'CONVERSATION_TRANSFERRED',details:{toUserId:'team'},createdAt:new Date(3000)},{conversationId:'closed',action:'CONVERSATION_TRANSFERRED',details:{toUserId:'outsider'},createdAt:new Date(4000)}];
 const db=mock(periods,activities),actual=await supervisionWindowsMany(conversations,['team'],db);
 for(const c of conversations)assert.deepEqual(actual.get(c.id),await supervisionWindows(c,['team'],mock(periods,activities)));
 assert.deepEqual(db.calls,{periods:1,activities:1});
});
test('no team or conversations means no database access',async()=>{const db=mock();assert.deepEqual(await supervisionWindowsMany([],['team'],db),new Map());assert.deepEqual(await supervisionWindowsMany([{id:'c'}],[],db),new Map([['c',[]]]));assert.deepEqual(db.calls,{periods:0,activities:0});});
test('randomized histories preserve the original windows, including overlaps and fallback',async()=>{
 let seed=12345;const rand=n=>(seed=(seed*1664525+1013904223)>>>0)%n;
 const conversations=[],periods=[],activities=[];
 for(let i=0;i<200;i++){const c={id:'random'+i,assignedUserId:['a','b','outsider',null][rand(4)]};conversations.push(c);for(let j=0;j<rand(7);j++){const start=rand(30)*1000;periods.push({conversationId:c.id,userId:['a','b','outsider'][rand(3)],startedAt:new Date(start),endedAt:rand(4)?new Date(start+rand(10)*1000):null});}for(let j=0;j<rand(5);j++)activities.push({conversationId:c.id,action:rand(2)?'CONVERSATION_CLAIMED':'CONVERSATION_TRANSFERRED',details:{toUserId:['a','b','outsider'][rand(3)]},createdAt:new Date(rand(100)*1000)});}
 const actual=await supervisionWindowsMany(conversations,['a','b'],mock(periods,activities));for(const c of conversations)assert.deepEqual(actual.get(c.id),await supervisionWindows(c,['a','b'],mock(periods,activities)));
});
