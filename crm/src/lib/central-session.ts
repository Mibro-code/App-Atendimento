import 'server-only';
import {NextRequest} from 'next/server';
import {getToken} from 'next-auth/jwt';
import {prisma} from '@/lib/prisma';
import {centralEnabled,identityOrigins} from '@/lib/central-identity';
export async function centralSession(req:NextRequest,user:{id:string;role:string}){
  if(!centralEnabled()||user.role==='REPRESENTANTE')return null;
  const link=await prisma.centralIdentityLink.findUnique({where:{userId:user.id},select:{enabled:true}});
  if(!link?.enabled)return null;
  const token=await getToken({req,secret:process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET||'',secureCookie:identityOrigins().crm.startsWith('https:')});
  return token?.id===user.id&&typeof token.primaryProof==='string'?{crmUserId:user.id,primaryProof:token.primaryProof}:null;
}
