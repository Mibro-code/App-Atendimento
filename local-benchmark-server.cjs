// Isolated synthetic-only benchmark server, not part of either app build.
const path=require('node:path'),Module=require('node:module');
const {database}=require('./local-fixtures.cjs');
const target=path.resolve(process.argv[2]),port=Number(process.argv[3]);
if(![4039,4040].includes(port)||!target.startsWith('C:\\App Whats\\'))throw Error('Invalid local benchmark target');
process.env.DATABASE_URL=database('attendance');process.env.NODE_ENV='test';process.env.SESSION_SECRET='benchmark-local-not-for-production';process.env.CENTRAL_IDENTITY_ENABLED='false';
process.env.NODE_PATH=path.join(__dirname,'attendance/node_modules');Module._initPaths();
// The independent release copy has no node_modules; never pick the unrelated
// Prisma client from C:\App Whats\node_modules through ancestor resolution.
const appRequire=Module.createRequire(path.join(__dirname,'attendance/package.json'));
const prismaClientPath=appRequire.resolve('@prisma/client');
const originalResolve=Module._resolveFilename;
const appParent=new Module(path.join(__dirname,'attendance/package.json'));appParent.filename=path.join(__dirname,'attendance/package.json');appParent.paths=Module._nodeModulePaths(path.join(__dirname,'attendance'));
Module._resolveFilename=function(request,parent,...args){if(request==='@prisma/client')return prismaClientPath;const directApp=parent?.filename?.startsWith(target+path.sep)&&!parent.filename.includes(path.sep+'node_modules'+path.sep);if(directApp&&!request.startsWith('.')&&!path.isAbsolute(request)&&!request.startsWith('node:')&&!Module.builtinModules.includes(request))return originalResolve.call(this,request,appParent,...args);return originalResolve.call(this,request,parent,...args);};
require('./local-network-guard.cjs');process.chdir(target);
const {createApp}=require(path.join(target,'src/app'));
const express=require('./attendance/node_modules/express'),outer=express();
outer.get('/__localmetrics',(_req,res)=>{global.gc?.();res.json(process.memoryUsage());});
outer.use(createApp({channel:{sendText:async()=>{throw Error('Synthetic benchmark: sends disabled');}}}));
outer.listen(port,'127.0.0.1',()=>console.log('Synthetic benchmark ready '+port));
