const {spawn}=require('node:child_process'),path=require('node:path'),{randomBytes}=require('node:crypto');
const {database,seed}=require('./local-fixtures.cjs');
async function main(){
 await seed();
 await require('./crm-contact-fixtures.cjs').seedContacts();
 // Never import .env or production provider credentials into the preview.
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE)$/i.test(key)));
 Object.assign(env,{NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',CENTRAL_IDENTITY_LOCAL_PREVIEW:'true',CENTRAL_IDENTITY_ENABLED:'true',CENTRAL_IDENTITY_SECRET:randomBytes(48).toString('base64url'),SESSION_SECRET:randomBytes(48).toString('base64url'),AUTH_SECRET:randomBytes(48).toString('base64url'),ATTENDANCE_PUBLIC_URL:'http://127.0.0.1:4037',CRM_PUBLIC_URL:'http://127.0.0.1:4038',AUTH_URL:'http://127.0.0.1:4038',AUTH_TRUST_HOST:'true'});
 const children=[];
 children.push(spawn(process.execPath,[path.join(__dirname,'local-attendance.cjs')],{cwd:__dirname,env:{...env,DATABASE_URL:database('attendance')},stdio:'inherit',windowsHide:true}));
 children.push(spawn(process.execPath,['--require',path.join(__dirname,'local-network-guard.cjs'),path.join(__dirname,'crm/node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','4038'],{cwd:path.join(__dirname,'crm'),env:{...env,DATABASE_URL:database('crm')},stdio:'inherit',windowsHide:true}));
 for(const child of children)child.on('exit',code=>{if(code)console.error('A local preview process stopped:',code);});
 process.on('SIGINT',()=>{for(const child of children)child.kill();process.exit();});
}
main().catch(()=>{console.error('Local preview setup failed');process.exitCode=1;});
