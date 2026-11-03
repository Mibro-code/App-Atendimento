const bcrypt=require('bcryptjs');
const invalid=()=>Object.assign(Error('Acesso compartilhado inválido ou expirado.'),{statusCode:401});
const conflict=()=>Object.assign(Error('A senha ou o acesso foi alterado durante a solicitação. Entre novamente e tente outra vez.'),{statusCode:409});
function createCentralPasswordService(prisma,validateProof,crypto=bcrypt){
  return async function change({crmUserId,primaryProof,currentPassword,newPassword}={}){
    if(typeof crmUserId!=='string'||!crmUserId||crmUserId.length>128||typeof primaryProof!=='string'||primaryProof.length>4096)throw invalid();
    if(typeof currentPassword!=='string'||!currentPassword||currentPassword.length>1024||typeof newPassword!=='string'||newPassword.length<8||Buffer.byteLength(newPassword,'utf8')>72){
      throw Object.assign(Error('Informe a senha atual e uma nova senha de no mínimo 8 caracteres e no máximo 72 bytes.'),{statusCode:400});
    }
    const link=await validateProof(primaryProof,crmUserId);
    const me=await prisma.user.findUnique({where:{id:link.attendanceUserId},select:{id:true,name:true,email:true,active:true,role:true,passwordHash:true,sessionVersion:true}});
    if(!me?.active||me.role==='BOT'||me.sessionVersion!==link.user.sessionVersion)throw invalid();
    if(!await crypto.compare(currentPassword,me.passwordHash))throw Object.assign(Error('Senha atual incorreta.'),{statusCode:400});
    // Slow hashing is outside the transaction. A Master reset wins if it
    // happens while this request is verifying/hashing the old credential.
    const passwordHash=await crypto.hash(newPassword,12);
    await prisma.$transaction(async tx=>{
      const result=await tx.user.updateMany({where:{id:me.id,active:true,role:{not:'BOT'},passwordHash:me.passwordHash,sessionVersion:me.sessionVersion,
        crmIdentityLink:{is:{crmUserId,enabled:true}}},data:{passwordHash,sessionVersion:{increment:1}}});
      if(result.count!==1)throw conflict();
      await tx.auditLog.create({data:{actorUserId:me.id,actorName:me.name,actorEmail:me.email,action:'USER_PASSWORD_CHANGED',entityType:'USER',entityId:me.id,
        summary:'Senha principal alterada pelo próprio usuário no perfil do CRM.',details:{source:'CRM_PROFILE',crmUserId,sessionsRevoked:true}}});
    });
    return {ok:true,shared:true,reauthenticate:true};
  };
}
module.exports={createCentralPasswordService};
