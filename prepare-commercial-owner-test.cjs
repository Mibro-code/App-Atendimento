const {url,client}=require('./commercial-owner-local-db.cjs');
const {spawnSync}=require('node:child_process');
(async()=>{
 const p=client();try{
  const tables=await p.$queryRawUnsafe('SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=$1','commercial_owner_test_20261021');
  if(tables[0].n!==0)throw Error('Test schema already contains data; no automatic push or reset');
 }finally{await p.$disconnect();}
 const result=spawnSync(process.execPath,['attendance/node_modules/prisma/build/index.js','db','push','--schema=attendance/prisma/schema.prisma','--skip-generate'],{cwd:__dirname,env:{...process.env,DATABASE_URL:url},stdio:'inherit'});
 if(result.status)process.exitCode=result.status;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
