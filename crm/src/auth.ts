import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type { Role } from "@prisma/client";
import {cache} from 'react';
import authConfig from '@/auth.config';
import {centralEnabled,centralRequest,type PrimaryIdentity} from '@/lib/central-identity';
import {localCredentialProof,validLocalCredentialProof} from '@/lib/local-credential-proof';

const nextAuth = NextAuth({
  ...authConfig,
  // A aplicação roda atrás de uma URL fixa e conhecida (definida via
  // NEXTAUTH_URL/AUTH_URL), então confiar no host aqui é seguro — sem isso o
  // NextAuth v5 rejeita requisições quando o host não bate exatamente com o
  // valor configurado (ex.: ao publicar a porta do Docker em 3001).
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const matches = centralEnabled()
          ? await prisma.user.findMany({where:{OR:[{email},{centralIdentityLink:{primaryEmail:email}}]},take:2})
          : [await prisma.user.findUnique({ where: { email } })].filter(Boolean);
        const user=matches.length===1?matches[0]:null;
        if (!user || !user.active || user.deletedAt) return null;
        let primaryProof:string|undefined;
        const link=centralEnabled()?await prisma.centralIdentityLink.findUnique({where:{userId:user.id}}):null;
        if(centralEnabled() && user.role!=='REPRESENTANTE' && link){
          if(!link.enabled || email!==link.primaryEmail)return null;
          try {
            const identity=await centralRequest<PrimaryIdentity>('/identity/credentials',{crmUserId:user.id,email,password});
            if(identity.attendanceUserId!==link.attendanceUserId || identity.crmUserId!==user.id)return null;
            primaryProof=identity.primaryProof;
          }catch{return null;}
        }else if(!(await bcrypt.compare(password,user.passwordHash)))return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        await logAudit({
          actorId: user.id,
          action: "LOGIN_SUCCESS",
          entityType: "User",
          entityId: user.id,
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          primaryProof,
          localCredentialProof:primaryProof?undefined:localCredentialProof(user.id,user.passwordHash),
        };
      },
    }),
    Credentials({id:'central-sso',name:'Acesso compartilhado',credentials:{code:{},verifier:{}},async authorize(credentials){
      if(!centralEnabled())return null;
      try {
        const identity=await centralRequest<PrimaryIdentity>('/identity/exchange',{code:credentials?.code,verifier:credentials?.verifier});
        const link=await prisma.centralIdentityLink.findUnique({where:{userId:identity.crmUserId},include:{user:true}});
        if(!link?.enabled || link.attendanceUserId!==identity.attendanceUserId || !link.user.active || link.user.deletedAt || link.user.role==='REPRESENTANTE')return null;
        await logAudit({actorId:link.user.id,action:'LOGIN_SUCCESS',entityType:'User',entityId:link.user.id});
        return {id:link.user.id,name:link.user.name,email:link.user.email,role:link.user.role,primaryProof:identity.primaryProof};
      }catch{return null;}
    }}),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: Role }).role;
        token.primaryProof=user.primaryProof;
        token.localCredentialProof=user.localCredentialProof;
      }
      if(typeof token.id!=='string'||!token.id)return null;
      {
        const account=await prisma.user.findUnique({where:{id:token.id},select:{id:true,role:true,passwordHash:true,active:true,deletedAt:true,centralIdentityLink:{select:{enabled:true,attendanceUserId:true}}}});
        if(!account?.active || account.deletedAt)return null;
        token.role=account.role;
        const link=centralEnabled()?account.centralIdentityLink:null;
        if(!centralEnabled()&&token.primaryProof)return null;
        if(account.role==='REPRESENTANTE'){
          if(token.primaryProof||!validLocalCredentialProof(token.localCredentialProof,account.id,account.passwordHash))return null;
        }else if(link || token.primaryProof){
          if(!link?.enabled || !token.primaryProof)return null;
          try{
            const result=await centralRequest<{valid:boolean;attendanceUserId:string;crmUserId:string}>('/identity/verify',{crmUserId:account.id,primaryProof:token.primaryProof});
            if(!result.valid || result.attendanceUserId!==link.attendanceUserId || result.crmUserId!==account.id)return null;
          }catch{return null;}
        }else if(!validLocalCredentialProof(token.localCredentialProof,account.id,account.passwordHash))return null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      // primaryProof deliberately stays inside the encrypted HttpOnly JWT.
      return session;
    },
  },
});
export const {handlers,signIn,signOut}=nextAuth;
// RSC layout and page share one validation within the same request only.
// No identity/proof is cached across users or subsequent requests.
export const auth=cache(()=>nextAuth.auth());
