const test=require('node:test'),assert=require('node:assert/strict');
const {prepareLinks,crmCredentialPolicy,canEnterAttendance}=require('./identity-policy.cjs');
const a={id:'a',name:'Pessoa',email:'Main@Example.test',role:'ATENDENTE',active:true};
const c={id:'c',name:'Nome diferente',email:' main@example.test ',role:'SUPERVISOR',active:true};
test('links preserve both IDs/roles and select Attendance credentials',()=>{
 const p=prepareLinks([a],[c]);assert.equal(p.pairs.length,1);
 assert.equal(p.pairs[0].attendanceRole,'ATENDENTE');assert.equal(p.pairs[0].crmRole,'SUPERVISOR');
 assert.equal(p.pairs[0].primaryEmail,'main@example.test');assert.equal(p.pairs[0].credentialAuthority,'ATTENDANCE');
});
test('same name with different emails does not link',()=>assert.equal(prepareLinks([a],[{...c,email:'other@example.test'}]).pairs.length,0));
test('duplicate normalized emails require investigation',()=>{
 const p=prepareLinks([a,{...a,id:'b'}],[c]);assert.equal(p.pairs.length,0);assert.equal(p.blocked[0].reason,'AMBIGUOUS_EMAIL');
});
test('inactive/deleted accounts are not reactivated',()=>{
 for(const override of [{active:false},{deletedAt:new Date()}])assert.equal(prepareLinks([a],[{...c,...override}]).pairs.length,0);
});
test('representatives retain CRM credentials and never enter Attendance',()=>{
 const u={...c,role:'REPRESENTANTE'},link={enabled:true,attendanceId:a.id};
 assert.equal(prepareLinks([a],[u]).pairs.length,0);assert.equal(crmCredentialPolicy(u,link),'CRM_LOCAL');
 assert.equal(canEnterAttendance(u,link),false);
});
test('CRM-only users retain their login',()=>assert.equal(crmCredentialPolicy(c,null),'CRM_LOCAL'));
test('linked users use primary credentials without overwriting either password hash',()=>{
 const u={...c,passwordHash:'keep-original'},link={enabled:true,attendanceId:a.id};
 assert.equal(crmCredentialPolicy(u,link),'ATTENDANCE_PRIMARY');assert.equal(u.passwordHash,'keep-original');
});
test('different emails may link only after explicit owner confirmation',()=>{
 const remote={...c,email:'other@example.test'};
 assert.throws(()=>prepareLinks([a],[remote],[{attendanceId:a.id,crmId:c.id}]));
 const p=prepareLinks([a],[remote],[{attendanceId:a.id,crmId:c.id,approved:true}]);
 assert.equal(p.pairs[0].primaryEmail,'main@example.test');assert.equal(p.pairs[0].method,'OWNER_CONFIRMED');
});
test('one-to-one linkage prevents accidental many-to-one mappings',()=>{
 assert.throws(()=>prepareLinks([a],[c],[{attendanceId:a.id,crmId:c.id,approved:true}]));
});
