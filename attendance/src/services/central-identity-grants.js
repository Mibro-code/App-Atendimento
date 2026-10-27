const { hash,opaque,equal }=require('./central-identity-crypto');
const invalid=()=>Object.assign(new Error('Acesso compartilhado inválido ou expirado.'),{statusCode:401});
// Database dependency injected for isolated tests. No network/session side effects.
function createGrantService(prisma,{clock=()=>new Date()}={}) {
  async function issue({user,link,audience,pkceChallenge}) {
    if (!user?.active || user.role==='BOT' || !link?.enabled || link.attendanceUserId!==user.id || !link.crmUserId || !Number.isSafeInteger(user.sessionVersion)) throw invalid();
    if (!['crm','attendance'].includes(audience) || !/^[A-Za-z0-9_-]{43}$/.test(pkceChallenge||'')) throw invalid();
    const code=opaque(),now=clock();
    await prisma.centralIdentityGrant.create({data:{codeHash:hash(code),audience,attendanceUserId:user.id,crmUserId:link.crmUserId,sessionVersion:user.sessionVersion,pkceChallenge,expiresAt:new Date(now.getTime()+60000)}});
    return code;
  }
  async function consume({code,verifier,audience}) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(code||'') || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier||'') || !['crm','attendance'].includes(audience)) throw invalid();
    const codeHash=hash(code),now=clock();
    return prisma.$transaction(async tx=>{
      const grant=await tx.centralIdentityGrant.findUnique({where:{codeHash}});
      if (!grant || grant.usedAt || grant.expiresAt<=now || grant.audience!==audience || !equal(grant.pkceChallenge,hash(verifier))) throw invalid();
      const link=await tx.centralCrmIdentity.findUnique({where:{attendanceUserId:grant.attendanceUserId},include:{user:true}});
      if (!link?.enabled || link.crmUserId!==grant.crmUserId || !link.user.active || link.user.role==='BOT' || link.user.sessionVersion!==grant.sessionVersion) throw invalid();
      // Conditional write guarantees only one callback wins, even across workers.
      const result=await tx.centralIdentityGrant.updateMany({where:{codeHash,usedAt:null,expiresAt:{gt:now}},data:{usedAt:now}});
      if(result.count!==1) throw invalid();
      return {attendanceUserId:link.attendanceUserId,crmUserId:link.crmUserId,sessionVersion:link.user.sessionVersion};
    });
  }
  async function consumeNonce(nonce,expiresAt) {
    try { await prisma.centralIdentityNonce.create({data:{id:nonce,expiresAt}}); return true; }
    catch { return false; }
  }
  return {issue,consume,consumeNonce};
}
module.exports={createGrantService};
