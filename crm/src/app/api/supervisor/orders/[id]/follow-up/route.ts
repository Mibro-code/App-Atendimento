import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";

const schema=z.object({status:z.enum(["NOTIFIED","RESOLVED"])});

export async function PATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const {user,error}=await requireSession();if(error)return error;
  if(user.role!=="SUPERVISOR"&&user.role!=="ADMIN")return forbidden("Acesso restrito a supervisores e administradores.");
  const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return badRequest("Status inválido.");
  const {id}=await params;
  const order=await prisma.olistOrder.findUnique({where:{id},select:{id:true,followUpStatus:true,customer:{select:{sellerId:true,seller:{select:{supervisorId:true}}}}}});
  if(!order)return notFound("Pedido não encontrado.");
  if(user.role==="SUPERVISOR"&&order.customer.sellerId!==user.id&&order.customer.seller.supervisorId!==user.id)return forbidden("Este pedido não pertence à sua equipe.");
  const now=new Date();
  const updated=await prisma.olistOrder.update({where:{id},data:parsed.data.status==="NOTIFIED"?{followUpStatus:"NOTIFIED",followUpNotifiedAt:now,followUpNotifiedById:user.id}:{followUpStatus:"RESOLVED",followUpResolvedAt:now,followUpResolvedById:user.id,...(order.followUpStatus==="PENDING"?{followUpNotifiedAt:now,followUpNotifiedById:user.id}:{})},select:{id:true,followUpStatus:true,followUpNotifiedAt:true,followUpResolvedAt:true}});
  await logAudit({actorId:user.id,action:parsed.data.status==="NOTIFIED"?"ORDER_FOLLOWUP_NOTIFIED":"ORDER_FOLLOWUP_RESOLVED",entityType:"OlistOrder",entityId:id,metadata:{previousStatus:order.followUpStatus,status:parsed.data.status}});
  return NextResponse.json({order:updated});
}
