import 'server-only';
import bcrypt from 'bcryptjs';
import {prisma} from '@/lib/prisma';
import {centralEnabled,centralRequest,type PrimaryIdentity} from '@/lib/central-identity';
export async function hasPrimaryCredentials(userId:string,role:string) {
  if(!centralEnabled()||role==='REPRESENTANTE')return false;
  return Boolean(await prisma.centralIdentityLink.findUnique({where:{userId},select:{id:true}}));
}
// Used for secondary password confirmations (e.g. clock-in), not just login.
export async function verifyCurrentPassword(userId:string,password:string) {
  const user=await prisma.user.findUnique({where:{id:userId}});
  if(!user?.active||user.deletedAt)return false;
  if(centralEnabled()&&user.role!=='REPRESENTANTE'){
    const link=await prisma.centralIdentityLink.findUnique({where:{userId}});
    if(link){
      if(!link.enabled)return false;
      try{
        const result=await centralRequest<PrimaryIdentity>('/identity/credentials',{crmUserId:userId,email:link.primaryEmail,password});
        return result.crmUserId===userId && result.attendanceUserId===link.attendanceUserId;
      }catch{return false;}
    }
  }
  return bcrypt.compare(password,user.passwordHash);
}
