const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const paging=require('./attendance/src/services/inbox-pagination');
test('stable pages preserve pinned items and timestamp/id ties without duplicates',()=>{
 const rows=Array.from({length:201},(_,i)=>({id:String(i).padStart(4,'0'),lastMessageAt:new Date('2026-10-26T00:00:00Z'),createdAt:new Date(),pins:i===0?[{}]:[]}));
 const ids=[];let cursor=null;
 do{const page=paging.listPage(rows,80,cursor);ids.push(...page.items.map(row=>row.id));cursor=paging.decodeCursor(page.nextCursor);}while(cursor);
 assert.equal(ids[0],'0000');assert.equal(ids.length,201);assert.equal(new Set(ids).size,201);
 assert.throws(()=>paging.decodeCursor('invalid'),{statusCode:400});
});
test('history cursors use timestamp plus id and preserve inclusive loaded ranges',()=>{
 const row={id:'same-time-2',occurredAt:new Date('2026-10-26T00:00:00Z')},cursor=paging.encodeCursor(row);
 const options=paging.historyOptions({historyPage:'true',historyBefore:cursor});assert.equal(options.limit,80);assert.equal(paging.historyWhere(options).OR[1].id.lt,row.id);
 assert.equal(paging.historyWhere(paging.historyOptions({historyPage:'true',historyFrom:cursor})).OR[1].id.gte,row.id);
});
test('empty contact names cannot crash inbox rendering',()=>{
 const source=fs.readFileSync('attendance/public/js/app.js','utf8'),line=source.split('\n').find(line=>line.startsWith('const initials = '));
 const ctx={};vm.createContext(ctx);vm.runInContext(line+';this.initials=initials;',ctx);assert.equal(ctx.initials(null),'?');assert.equal(ctx.initials('  '),'?');assert.equal(ctx.initials('Nome Cliente'),'NC');
});
test('a realtime event arriving during refresh schedules a subsequent refresh',async()=>{
 const source=fs.readFileSync('attendance/public/js/app.js','utf8'),start=source.indexOf('let realtimeRefreshTimer;'),end=source.indexOf('// Estado visual de conexão perdida',start);
 let detail=0,release;const wait=new Promise(resolve=>release=resolve),scheduled=[];
 const ctx={historyLoading:false,historyNeedsRefresh:false,state:{selectedId:'synthetic'},document:{hidden:false},loadCategories:async()=>{},openConversation:async()=>{detail++;},loadConversations:()=>wait,checkAlerts:async()=>{},scheduleWorkspaceUnread(){},setTimeout:fn=>scheduled.push(fn),closeConversationView(){},toast(){}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 const first=ctx.refreshInbox();await new Promise(setImmediate);await ctx.refreshInbox();release();await first;assert.equal(detail,1);assert.equal(scheduled.length,1);await scheduled[0]();await new Promise(setImmediate);assert.equal(detail,2);
});
