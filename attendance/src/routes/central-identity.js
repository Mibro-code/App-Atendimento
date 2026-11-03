const express=require('express');
const {rateLimit}=require('express-rate-limit');
const jwt=require('jsonwebtoken');
const {createHmac}=require('node:crypto');
const {hash,opaque,proof,readProof,verifyRequest}=require('../services/central-identity-crypto');
const {createGrantService}=require('../services/central-identity-grants');
const fail=()=>Object.assign(new Error('Não foi possível validar o acesso compartilhado.'),{statusCode:401});

function createIdentityRouter({prisma,auth,env=process.env}) {
  const router=express.Router(),grants=createGrantService(prisma);
  const enabled=()=>env.CENTRAL_IDENTITY_ENABLED==='true';
  const urls=()=>{
    const attendance=new URL(env.ATTENDANCE_PUBLIC_URL),crm=new URL(env.CRM_PUBLIC_URL);
    for(const u of [attendance,crm]) if(u.origin!==u.href.replace(/\/$/,'') || u.username || u.password || (u.protocol!=='https:' && !['localhost','127.0.0.1'].includes(u.hostname))) throw Error('Invalid identity origin');
    return {attendance:attendance.origin,crm:crm.origin};
  };
  const cookie='central_return_state';
  const options={httpOnly:true,sameSite:'lax',secure:env.NODE_ENV==='production',path:'/identity',maxAge:120000};
  const stateKey=()=>createHmac('sha256',env.SESSION_SECRET).update('central-return-state:v1').digest('hex');
  const identitySelect={attendanceUserId:true,crmUserId:true,enabled:true,user:{select:{id:true,email:true,active:true,role:true,sessionVersion:true}}};
  async function linked(crmUserId) {
    const link=await prisma.centralCrmIdentity.findUnique({where:{crmUserId},select:identitySelect});
    if(!link?.enabled || !link.user.active || link.user.role==='BOT') throw fail();
    return link;
  }
  async function validateProof(token,crmUserId) {
    const p=readProof(env.SESSION_SECRET,token);
    if(!p || p.crm!==crmUserId) throw fail();
    const link=await linked(crmUserId);
    if(p.sub!==link.attendanceUserId || p.sv!==link.user.sessionVersion) throw fail();
    return link;
  }
  router.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});if(!enabled())return res.sendStatus(404);next();});
  const generalLimit=rateLimit({windowMs:60000,limit:2400,standardHeaders:true,legacyHeaders:false});
  router.use(generalLimit);
  router.get('/available',(_req,res)=>res.json({available:true}));
  let nextCleanup=0;
  async function serviceAuth(req,res,next) {
    const valid=await verifyRequest(env.CENTRAL_IDENTITY_SECRET,{
      method:req.method,path:req.originalUrl,body:req.rawBody?.toString('utf8')||'',
      timestamp:Number(req.get('x-central-time')),nonce:req.get('x-central-nonce'),signature:req.get('x-central-signature')
    },grants.consumeNonce);
    if(!valid)return res.status(401).json({error:'Acesso compartilhado não autorizado.'});
    if(Date.now()>nextCleanup){
      nextCleanup=Date.now()+300000;
      // Only expired ephemeral security records, never users or messages.
      const before=new Date(Date.now()-60000);
      Promise.all([prisma.centralIdentityNonce.deleteMany({where:{expiresAt:{lt:before}}}),prisma.centralIdentityGrant.deleteMany({where:{expiresAt:{lt:before}}}),prisma.crmContactSelection.deleteMany({where:{expiresAt:{lt:before}}})]).catch(()=>{});
    }
    next();
  }
  const credentialLimit=rateLimit({windowMs:900000,limit:10,keyGenerator:req=>hash(String(req.body?.crmUserId||'unknown')),standardHeaders:true,legacyHeaders:false});
  const access=require('../services/crm-access-service').createCrmAccessService(prisma);
  // Browser management is Master-only; the CRM validates an expiring ticket
  // through the existing signed, replay-protected backchannel.
  router.post('/access-admin',serviceAuth,async(req,res)=>{
    let ticket;try{ticket=jwt.verify(req.body?.ticket,env.SESSION_SECRET,{audience:'crm-access-admin',algorithms:['HS256']});}catch{throw fail();}
    const actor=await prisma.user.findFirst({where:{id:ticket.sub,active:true,role:'ADMIN',sessionVersion:ticket.sv}});
    if(!actor || !['inspect','enable'].includes(ticket.operation) || typeof ticket.target!=='string' ||
       !await grants.consumeNonce(`admin:${ticket.jti}`,new Date(Date.now()+120000)))throw fail();
    const target=await prisma.user.findUnique({where:{id:ticket.target},select:{id:true,name:true,email:true,active:true,role:true}});
    if(!target) return res.status(404).json({error:'Conta não encontrada.'});
    const link=await prisma.centralCrmIdentity.findUnique({where:{attendanceUserId:target.id},select:{crmUserId:true,enabled:true}});
    res.json({target,link,operation:ticket.operation});
  });
  router.post('/access-reserve',serviceAuth,async(req,res)=>res.json(await access.reserve(req.body||{})));
  router.post('/access-commit',serviceAuth,async(req,res)=>res.json(await access.commit(req.body||{})));
  async function accessMaster(req){
    const actor=await auth.userFromToken(req.cookies?.[auth.COOKIE_NAME]);
    if(!actor || actor.role!=='ADMIN')throw Object.assign(Error('Somente Master.'),{statusCode:403});
    return actor;
  }
  async function manageAccess(req,res,operation){
    const actor=await accessMaster(req);
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(req.params.userId))return res.status(400).json({error:'Conta inválida.'});
    if(operation!=='inspect' && req.get('origin')!==urls().attendance)return res.sendStatus(403);
    if(operation==='disable')return res.json(await access.disable(req.params.userId,actor));
    const ticket=jwt.sign({sv:actor.sessionVersion,target:req.params.userId,operation},env.SESSION_SECRET,
      {subject:actor.id,audience:'crm-access-admin',jwtid:opaque(),expiresIn:60});
    const response=await fetch(new URL('/api/central/access',urls().crm),{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ticket}),redirect:'error',signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    return res.status(response.ok?200:([400,403,404,409].includes(response.status)?response.status:503)).json(data);
  }
  router.get('/admin-access/:userId',async(req,res)=>manageAccess(req,res,'inspect'));
  router.post('/admin-access/:userId',async(req,res)=>{
    if(typeof req.body?.enabled!=='boolean')return res.status(400).json({error:'Informe se o acesso será ativado.'});
    return manageAccess(req,res,req.body.enabled?'enable':'disable');
  });
  router.post('/credentials',serviceAuth,credentialLimit,async(req,res)=>{
    const {crmUserId,email,password}=req.body||{};
    if(typeof crmUserId!=='string'||typeof email!=='string'||typeof password!=='string'||password.length>1024)throw fail();
    const link=await linked(crmUserId);
    if(email.trim().toLowerCase()!==link.user.email)throw fail();
    const user=await auth.login({email,password});
    if(user.id!==link.attendanceUserId)throw fail();
    return res.json({attendanceUserId:user.id,crmUserId,primaryProof:proof(env.SESSION_SECRET,{attendanceUserId:user.id,crmUserId,sessionVersion:user.sessionVersion})});
  });
  router.post('/verify',serviceAuth,async(req,res)=>{
    const link=await validateProof(req.body?.primaryProof,req.body?.crmUserId);
    res.json({valid:true,attendanceUserId:link.attendanceUserId,crmUserId:link.crmUserId});
  });
  const changePassword=require('../services/central-password-service').createCentralPasswordService(prisma,validateProof);
  const passwordLimit=rateLimit({windowMs:900000,limit:5,keyGenerator:req=>hash(String(req.body?.crmUserId||'unknown')),standardHeaders:true,legacyHeaders:false,
    message:{error:'Muitas tentativas de troca de senha. Aguarde alguns minutos.'}});
  router.post('/password',serviceAuth,passwordLimit,async(req,res)=>res.json(await changePassword(req.body)));
  router.post('/exchange',serviceAuth,async(req,res)=>{
    const identity=await grants.consume({...req.body,audience:'crm'});
    res.json({...identity,primaryProof:proof(env.SESSION_SECRET,identity)});
  });
  router.post('/return',serviceAuth,async(req,res)=>{
    const link=await validateProof(req.body?.primaryProof,req.body?.crmUserId);
    const code=await grants.issue({user:link.user,link,audience:'attendance',pkceChallenge:req.body?.challenge});
    res.json({code});
  });
  async function messagingUser(req){
    const link=await validateProof(req.body?.primaryProof,req.body?.crmUserId);
    const user=await prisma.user.findUnique({where:{id:link.attendanceUserId}});
    return auth.publicUser(user);
  }
  const crmContacts=require('../services/crm-contact-service');
  router.post('/workspace-center',serviceAuth,async(req,res)=>{
    const user=await messagingUser(req),authorization=require('../services/authorization-service'),companies=require('../services/company-service');
    const companyId=await companies.resolveWorkspace(user,req.body.company);
    if(req.body.mode==='notifications'){
      return res.json(await require('../services/inbox-service').getUserAlerts({company:req.body.company,since:new Date(Date.now()-86400000).toISOString()},user));
    }
    const q=String(req.body.q||'').trim().slice(0,100);
    if(q.length<2)return res.json({conversations:[]});
    const digits=q.replace(/\D/g,'');
    const conversations=await prisma.conversation.findMany({where:{AND:[await authorization.conversationScope(user),{companyId,contact:{is:{OR:[{name:{contains:q,mode:'insensitive'}},{customName:{contains:q,mode:'insensitive'}},...(digits.length>=4?[{phone:{contains:digits}}]:[])]}}}]},select:{id:true,status:true,contact:{select:{name:true,customName:true}},channelAccount:{select:{name:true}}},orderBy:[{lastMessageAt:'desc'},{id:'asc'}],take:8});
    return res.json({conversations:conversations.map(row=>({id:row.id,name:row.contact.customName||row.contact.name||'Contato',status:row.status,number:row.channelAccount?.name||'Número não registrado'}))});
  });
  // Central de Atividades: retornos da Agenda da Central sob demanda, sem
  // cópia para o CRM. Erros de regra (pendente, conflito, permissão) voltam
  // com a mensagem do serviço; falhas técnicas seguem a resposta genérica.
  const activityFeed=require('../services/activity-feed-service');
  const ruleError=(res,error)=>[400,403,404,409].includes(error.statusCode)?res.status(error.statusCode).json({error:error.message}):null;
  router.post('/activity-feed',serviceAuth,async(req,res)=>{
    const user=await messagingUser(req);
    try{res.json(await activityFeed.feed(user,req.body));}catch(error){if(!ruleError(res,error))throw error;}
  });
  router.post('/activity-action',serviceAuth,async(req,res)=>{
    const user=await messagingUser(req);
    try{res.json({item:await activityFeed.act(user,req.body)});}catch(error){if(!ruleError(res,error))throw error;}
  });
  router.post('/customer-timeline',serviceAuth,async(req,res)=>res.json(await require('../services/crm-timeline-service').timeline(await messagingUser(req),req.body)));
  router.post('/proposal-selection',serviceAuth,async(req,res)=>{
    const result=await require('../services/crm-proposal-service').create(await messagingUser(req),req.body.crmUserId,req.body);
    const target=new URL('/identity/start',urls().attendance);target.searchParams.set('proposal',result.code);res.json({nextUrl:target.href});
  });
  router.post('/proposal',async(req,res)=>{
    const user=await auth.userFromToken(req.cookies?.[auth.COOKIE_NAME]);if(!user)return res.sendStatus(401);
    res.json(await require('../services/crm-proposal-service').review(auth.publicUser(user),req.body?.code));
  });
  const context=require('../services/crm-conversation-context').createConversationContext({prisma,authorization:require('../services/authorization-service'),companies:require('../services/company-service'),phoneVariants:require('../services/bulk-send-rules').phoneVariants});
  router.post('/conversation-options',serviceAuth,async(req,res)=>res.json({companies:await context.options(await messagingUser(req))}));
  router.post('/conversation-context',serviceAuth,async(req,res)=>res.json(await context.conversation(await messagingUser(req),req.body.conversationId,req.body.forImport===true)));
  router.post('/customer-conversations',serviceAuth,async(req,res)=>res.json({conversations:await context.conversations(await messagingUser(req),req.body.companyId,req.body.phones,req.body.contactIds)}));
  router.post('/contact-options',serviceAuth,async(req,res)=>res.json({companies:await crmContacts.options(await messagingUser(req))}));
  router.post('/contact-history',serviceAuth,async(req,res)=>res.json({history:await crmContacts.history(await messagingUser(req),req.body.companyId,req.body.recipients,{accountId:req.body.accountId})}));
  router.post('/contact-selection',serviceAuth,async(req,res)=>{
    const result=await crmContacts.createSelection(await messagingUser(req),req.body.crmUserId,req.body);
    const target=new URL('/identity/start',urls().attendance);target.searchParams.set('draft',result.code);
    res.json({...result,nextUrl:target.href});
  });
  router.post('/selection',async(req,res)=>{
    const user=await auth.userFromToken(req.cookies?.[auth.COOKIE_NAME]);
    if(!user)return res.status(401).json({error:'Autenticação necessária.'});
    const selection=await crmContacts.readSelection(auth.publicUser(user),req.body?.code);
    if(selection.campaignId)return res.status(409).json({error:'Esta seleção já foi colocada na fila.'});
    res.json({company:selection.company,recipients:selection.recipients,skipSent:selection.skipSent});
  });
  router.get('/options',async(req,res)=>{
    const user=await auth.userFromToken(req.cookies?.[auth.COOKIE_NAME]);
    if(!user)return res.status(401).json({error:'Autenticação necessária.'});
    const link=await prisma.centralCrmIdentity.findUnique({where:{attendanceUserId:user.id},select:{enabled:true}});
    const crmAvailable=Boolean(link?.enabled && user.role!=='BOT');
    res.json({crmAvailable,...(crmAvailable?{crmOrigin:urls().crm}:{})});
  });
  router.get('/authorize',async(req,res)=>{
    const {state,challenge}=req.query;
    if(!/^[A-Za-z0-9_-]{43}$/.test(state||'')||!/^[A-Za-z0-9_-]{43}$/.test(challenge||''))throw fail();
    const user=await auth.userFromToken(req.cookies?.[auth.COOKIE_NAME]);
    if(!user)return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
    const link=await prisma.centralCrmIdentity.findUnique({where:{attendanceUserId:user.id}});
    const code=await grants.issue({user,link,audience:'crm',pkceChallenge:challenge});
    const target=new URL('/api/central/callback',urls().crm);
    target.searchParams.set('code',code);target.searchParams.set('state',state);
    res.redirect(target.href);
  });
  router.get('/start',(req,res)=>{
    const verifier=opaque(),state=opaque();
    const draft=/^[A-Za-z0-9_-]{43}$/.test(req.query.draft||'')?req.query.draft:null;
    const conversation=/^[A-Za-z0-9_-]{1,128}$/.test(req.query.conversation||'')?req.query.conversation:null;
    const proposal=/^[A-Za-z0-9_-]{43}$/.test(req.query.proposal||'')?req.query.proposal:null;
    res.cookie(cookie,jwt.sign({verifier,state,...(draft?{draft}:{}),...(conversation?{conversation}:{}),...(proposal?{proposal}:{})},stateKey(),{expiresIn:120,audience:'central-return'}),options);
    const target=new URL('/api/central/authorize',urls().crm);
    target.searchParams.set('state',state);target.searchParams.set('challenge',hash(verifier));
    res.redirect(target.href);
  });
  router.get('/callback',async(req,res)=>{
    let saved;try{saved=jwt.verify(req.cookies?.[cookie],stateKey(),{audience:'central-return',algorithms:['HS256']});}catch{throw fail();}
    res.clearCookie(cookie,options);
    if(saved.state!==req.query.state)throw fail();
    const identity=await grants.consume({code:req.query.code,verifier:saved.verifier,audience:'attendance'});
    const user=await prisma.user.findFirst({where:{id:identity.attendanceUserId,active:true,sessionVersion:identity.sessionVersion}});
    if(!user)throw fail();
    auth.setSession(res,user);res.redirect(saved.proposal?`/#crmProposal=${encodeURIComponent(saved.proposal)}`:saved.draft?`/#crmSelection=${encodeURIComponent(saved.draft)}`:saved.conversation?`/?conversation=${encodeURIComponent(saved.conversation)}`:'/');
  });
  router.use((error,_req,res,_next)=>res.status(error.statusCode||503).json({error:error.statusCode===401?'Acesso compartilhado inválido ou expirado.':[400,403,404,409].includes(error.statusCode)?error.message:'Acesso compartilhado temporariamente indisponível.'}));
  return router;
}
module.exports={createIdentityRouter};
