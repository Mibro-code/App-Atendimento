const path=require('node:path');
const root=__dirname;
const base='postgresql://ux_test:ux-local-disposable-20261015@127.0.0.1:5559/central_ux_test';
const database=app=>`${base}?schema=merge_${app}_20261020`;
function assertLocal(url,app){const u=new URL(url);if(u.hostname!=='127.0.0.1'||u.port!=='5559'||u.pathname!=='/central_ux_test'||u.searchParams.get('schema')!==`merge_${app}_20261020`)throw Error('Only the isolated local test schema is allowed');}
function client(app){const url=database(app);assertLocal(url,app);const {PrismaClient}=require(path.join(root,app==='attendance'?'attendance':'crm','node_modules','@prisma','client'));return new PrismaClient({datasources:{db:{url}}});}
const credentials={email:'linked@local.invalid',password:'Attendance-local-20261020!',ownerEmail:'owner@local.invalid',oldCrmEmail:'old-crm@local.invalid',oldCrmPassword:'CRM-old-local-20261020!',repEmail:'representative@local.invalid',repPassword:'Representative-local-20261020!',crmOnlyEmail:'crm-only@local.invalid',crmOnlyPassword:'CRM-only-local-20261020!'};
async function seed(){
 const a=client('attendance'),c=client('crm'),bcrypt=require('./attendance/node_modules/bcryptjs');
 try{
  const passwordHash=await bcrypt.hash(credentials.password,10),oldHash=await bcrypt.hash(credentials.oldCrmPassword,10);
  const initial=require('./attendance/prisma/seed');await initial.seedCompanies(a);await initial.seedTriageBot(a);
  for(const [code,name,color] of [['ATENDIMENTO','Atendimento','#0f766e'],['SUPORTE','Suporte','#2563eb'],['COMERCIAL','Comercial','#059669']])await a.category.upsert({where:{companyId_code:{companyId:'cmp_mibro',code}},create:{companyId:'cmp_mibro',code,name,color},update:{}});
  await a.user.upsert({where:{id:'merge-local-owner-a'},create:{id:'merge-local-owner-a',name:'Administrador — prévia local',email:credentials.ownerEmail,passwordHash,role:'ADMIN'},update:{active:true,passwordHash}});
  await c.user.upsert({where:{id:'merge-local-owner-c'},create:{id:'merge-local-owner-c',name:'Administrador — prévia local',email:'owner-old@local.invalid',passwordHash:oldHash,role:'ADMIN'},update:{active:true,passwordHash:oldHash}});
  await a.centralCrmIdentity.upsert({where:{attendanceUserId:'merge-local-owner-a'},create:{attendanceUserId:'merge-local-owner-a',crmUserId:'merge-local-owner-c',enabled:true,confirmation:'LOCAL_SYNTHETIC'},update:{enabled:true}});
  await c.centralIdentityLink.upsert({where:{userId:'merge-local-owner-c'},create:{userId:'merge-local-owner-c',attendanceUserId:'merge-local-owner-a',primaryEmail:credentials.ownerEmail,enabled:true,confirmation:'LOCAL_SYNTHETIC'},update:{enabled:true}});
  await a.user.upsert({where:{id:'merge-local-a'},create:{id:'merge-local-a',name:'Conta integrada (teste)',email:credentials.email,passwordHash,role:'ATENDENTE'},update:{active:true,sessionVersion:0,passwordHash}});
  await a.userCompanyAccess.upsert({where:{userId_companyId:{userId:'merge-local-a',companyId:'cmp_mibro'}},create:{userId:'merge-local-a',companyId:'cmp_mibro'},update:{active:true}});
  for(const u of [{id:'merge-local-c',name:'Conta CRM vinculada (teste)',email:credentials.oldCrmEmail,passwordHash:oldHash,role:'SUPERVISOR'},{id:'merge-local-rep',name:'Representante (teste)',email:credentials.repEmail,passwordHash:await bcrypt.hash(credentials.repPassword,10),role:'REPRESENTANTE'},{id:'merge-local-crm-only',name:'Somente CRM (teste)',email:credentials.crmOnlyEmail,passwordHash:await bcrypt.hash(credentials.crmOnlyPassword,10),role:'VENDEDOR'}]){
   await c.user.upsert({where:{id:u.id},create:u,update:{...u,active:true,deletedAt:null}});
  }
  await a.centralCrmIdentity.upsert({where:{attendanceUserId:'merge-local-a'},create:{attendanceUserId:'merge-local-a',crmUserId:'merge-local-c',enabled:true,confirmation:'LOCAL_SYNTHETIC'},update:{enabled:true}});
  await c.centralIdentityLink.upsert({where:{userId:'merge-local-c'},create:{userId:'merge-local-c',attendanceUserId:'merge-local-a',primaryEmail:credentials.email,enabled:true,confirmation:'LOCAL_SYNTHETIC'},update:{enabled:true}});
 }finally{await Promise.all([a.$disconnect(),c.$disconnect()]);}
}
module.exports={database,client,credentials,seed};
if(require.main===module)seed().then(()=>console.log('Synthetic local accounts ready; no production data used.')).catch(()=>{console.error('Local fixture setup failed');process.exitCode=1;});
