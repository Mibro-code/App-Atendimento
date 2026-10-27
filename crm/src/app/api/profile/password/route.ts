import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import {hasPrimaryCredentials} from '@/lib/primary-password';
import {getToken} from 'next-auth/jwt';
import {centralRequest,identityOrigins} from '@/lib/central-identity';

// Troca de senha pelo próprio usuário. Diferente do reset feito por um admin
// em /api/users/[id] (USER_PASSWORD_RESET): aqui é sempre o dono da conta,
// e por isso exige a senha atual antes de aceitar a nova.
const schema = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual.").max(1024),
  newPassword: z.string().min(8, "A nova senha precisa ter pelo menos 8 caracteres.").max(72).refine(value=>Buffer.byteLength(value,'utf8')<=72,'A nova senha excede o limite de 72 bytes.'),
});

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const { currentPassword, newPassword } = parsed.data;

  if(await hasPrimaryCredentials(user.id,user.role)){
    const headers={'Cache-Control':'no-store'};
    // Proof comes only from the encrypted HttpOnly session, never from body IDs
    // or a browser-supplied proof. The bridge changes this user's primary hash.
    try{
      const token=await getToken({req,secret:process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET||'',secureCookie:identityOrigins().crm.startsWith('https:')});
      if(token?.id!==user.id || typeof token.primaryProof!=='string')return NextResponse.json({error:'Sua sessão expirou. Entre novamente.'},{status:401,headers});
      const result=await centralRequest<{ok:boolean;shared:boolean;reauthenticate:boolean}>('/identity/password',{crmUserId:user.id,primaryProof:token.primaryProof,currentPassword,newPassword});
      if(result.ok!==true||result.shared!==true||result.reauthenticate!==true)throw Error('Invalid password confirmation');
      // Attendance already recorded the authoritative audit atomically. A CRM
      // audit outage must not report a committed password change as a failure.
      try{await logAudit({actorId:user.id,action:'USER_PASSWORD_CHANGED',entityType:'User',entityId:user.id,metadata:{credentialAuthority:'ATTENDANCE',sessionsRevoked:true}});}catch{console.error('CRM password audit mirror unavailable; authoritative audit retained in Attendance.');}
      return NextResponse.json(result,{headers});
    }catch(error){
      const failure=error as {statusCode?:number;detail?:string};
      const status=[400,401,403,409,429].includes(failure.statusCode||0)?failure.statusCode!:503;
      const message=status===400?'Senha atual incorreta ou nova senha inválida.':status===409?'A senha ou o acesso foi alterado durante a solicitação. Entre novamente.':status===429?'Muitas tentativas. Aguarde alguns minutos.':status===401||status===403?'Sua sessão expirou ou o acesso foi revogado. Entre novamente.':'Não foi possível confirmar a troca. Tente entrar novamente com a nova senha antes de repetir a operação.';
      return NextResponse.json({error:message},{status,headers});
    }
  }

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, passwordHash: true },
  });
  if (!me) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  const currentOk = await bcrypt.compare(currentPassword, me.passwordHash);
  if (!currentOk) {
    return NextResponse.json({ error: "Senha atual incorreta." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const changed=await prisma.user.updateMany({where:{id:user.id,passwordHash:me.passwordHash,active:true,deletedAt:null},data:{passwordHash}});
  if(changed.count!==1)return NextResponse.json({error:'A senha ou o acesso foi alterado durante a solicitação. Entre novamente.'},{status:409});

  await logAudit({ actorId: user.id, action: "USER_PASSWORD_CHANGED", entityType: "User", entityId: user.id });

  return NextResponse.json({ ok: true, reauthenticate: true });
}
