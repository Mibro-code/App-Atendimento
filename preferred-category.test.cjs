const test=require('node:test'),assert=require('node:assert/strict');
const {retainedCategory}=require('./attendance/src/services/preferred-category-service');
const base={contact:{id:'contact',companyId:'mibro',preferredAssigneeEnabled:true,preferredAssigneeId:'seller'},conversation:{companyId:'mibro',channel:'META',categoryId:'wholesale'}};
test('fixed owner retains the current category without a history query',async()=>{
 assert.equal(await retainedCategory({},base),'wholesale');
});
test('contacts without an active fixed link retain ordinary reopening behavior',async()=>{
 for(const contact of [{...base.contact,preferredAssigneeEnabled:false},{...base.contact,preferredAssigneeId:null}])assert.equal(await retainedCategory({}, {...base,contact}),null);
});
test('company and channel boundaries cannot be crossed',async()=>{
 assert.equal(await retainedCategory({}, {...base,conversation:{...base.conversation,companyId:'sincrofit'}}),null);
 assert.equal(await retainedCategory({}, {...base,conversation:{...base.conversation,channel:'EMAIL'}}),null);
});
test('a missing category can be recovered only from the same contact/company history',async()=>{
 const db={conversationActivity:{findFirst:async({where})=>{assert.equal(where.conversation.is.contactId,'contact');assert.equal(where.conversation.is.companyId,'mibro');return{action:'CATEGORY_CHANGED',details:{toCategoryId:'wholesale'}};}},category:{findFirst:async({where})=>{assert.equal(where.companyId,'mibro');return{id:'wholesale'};}}};
 assert.equal(await retainedCategory(db,{...base,conversation:{...base.conversation,categoryId:null}}),'wholesale');
});
test('manual category removal takes precedence over older categories',async()=>{
 const db={conversationActivity:{findFirst:async()=>({action:'CATEGORY_CHANGED',details:{fromCategoryId:'wholesale',toCategoryId:null}})}};
 assert.equal(await retainedCategory(db,{...base,conversation:{...base.conversation,categoryId:null}}),null);
});
test('missing/inactive historical category is not guessed or recreated',async()=>{
 const db={conversationActivity:{findFirst:async()=>({action:'CATEGORY_CHANGED',details:{toCategoryId:'removed'}})},category:{findFirst:async()=>null}};
 assert.equal(await retainedCategory(db,{...base,conversation:{...base.conversation,categoryId:null}}),null);
});
