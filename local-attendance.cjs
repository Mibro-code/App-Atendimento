require('./local-network-guard.cjs');
process.chdir(require('node:path').join(__dirname,'attendance'));
const {database}=require('./local-fixtures.cjs');
if(process.env.DATABASE_URL!==database('attendance'))throw Error('Invalid local database');
// Preview-only adapter. No workers run; even accidental sends throw.
const messages=require('./attendance/src/services/channels/channel-message-service');
const originalAdapter=messages.adapterFor;
messages.adapterFor=async(channel,accountId)=>String(accountId).startsWith('crm-fixture-account-')?{channel:{__crmPreview:true,getPhoneNumberProfile:async()=>({display_phone_number:accountId.endsWith('mibro')?'+55 11 90000-1001':'+55 11 90000-2002',quality_rating:'GREEN'}),sendTemplate:async()=>{throw Error('Envio real bloqueado na prévia');}}}:originalAdapter(channel,accountId);
const templates=require('./attendance/src/services/meta-template-service');
const originalTemplates=templates.listApprovedTemplates;
templates.listApprovedTemplates=async(channel,...rest)=>channel?.__crmPreview?[{id:'local-crm-template',name:'demo_contato_crm',language:'pt_BR',category:'MARKETING',status:'APPROVED',variables:[],components:[{type:'BODY',text:'Olá! Esta é uma prévia local da integração com o CRM.'}],preview:'Olá! Esta é uma prévia local da integração com o CRM.',supported:true,pricing:{rate:0,currency:'BRL'}}]:originalTemplates(channel,...rest);
const {createApp}=require('./attendance/src/app');
const app=createApp({channel:{sendText:async()=>{throw Error('Real sending disabled');}}});
app.listen(4037,'127.0.0.1',()=>console.log('Atendimento local: http://127.0.0.1:4037'));
