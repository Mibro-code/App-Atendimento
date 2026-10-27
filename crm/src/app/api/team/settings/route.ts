import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, requireSession } from "@/lib/api-auth";
import { canSupervisorConfigureSeller } from "@/lib/team-rules";
import { logAudit } from "@/lib/audit";

const updateSchema = z.object({
  allowSellerCustomerTransfer: z.boolean(),
  orderFollowUpAssigneeId:z.string().min(1).nullable(),
  sellers: z
    .array(
      z.object({
        id: z.string().min(1),
        followUpAfterDays: z.number().int().min(1).max(365),
        canTransferOwnCustomers: z.boolean(),
        timeClockReminderEnabled:z.boolean(),
        timeClockRequiredEvents:z.array(z.enum(["CLOCK_IN","LUNCH_START","LUNCH_END","CLOCK_OUT"])).max(4),
        timeClockWorkingDays:z.array(z.number().int().min(0).max(6)).min(1).max(7),
        timeClockStartMinutes:z.number().int().min(0).max(1439),
        timeClockLunchStartMinutes:z.number().int().min(0).max(1439),
        timeClockLunchEndMinutes:z.number().int().min(0).max(1439),
        timeClockEndMinutes:z.number().int().min(0).max(1439),
        timeClockReminderIntervalMinutes:z.number().int().min(5).max(180),
        // null = manter como está (sem registro não vira percentual presumido).
        commissionPercent:z.number().min(0).max(100).nullable(),
        commissionMibroPercent:z.number().min(0).max(100).nullable(),
        commissionSincrofitPercent:z.number().min(0).max(100).nullable(),
      })
    )
    .max(500),
});

export async function GET() {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "SUPERVISOR") return forbidden("Apenas supervisores podem configurar a própria equipe.");

  const [supervisor, sellers] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { allowSellerCustomerTransfer: true, orderFollowUpAssigneeId:true },
    }),
    prisma.user.findMany({
      where: { supervisorId: user.id, role: { in: ["VENDEDOR", "REPRESENTANTE"] }, active: true },
      select: {
        id: true,
        name: true,
        followUpAfterDays: true,
        canTransferOwnCustomers: true,
        timeClockReminderEnabled:true,timeClockRequiredEvents:true,timeClockWorkingDays:true,
        timeClockStartMinutes:true,timeClockLunchStartMinutes:true,timeClockLunchEndMinutes:true,
        timeClockEndMinutes:true,timeClockReminderIntervalMinutes:true,
        sellerProfile: { select: { displayName: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({
    allowSellerCustomerTransfer: supervisor?.allowSellerCustomerTransfer ?? false,
    orderFollowUpAssigneeId:supervisor?.orderFollowUpAssigneeId??null,
    sellers,
  });
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "SUPERVISOR") return forbidden("Apenas supervisores podem configurar a própria equipe.");

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return badRequest("Configuração inválida.", parsed.error.flatten());
  const data = parsed.data;

  if (new Set(data.sellers.map((seller) => seller.id)).size !== data.sellers.length) {
    return badRequest("Há vendedores duplicados na configuração.");
  }
  if (data.orderFollowUpAssigneeId) {
    const assignee=await prisma.user.findFirst({where:{id:data.orderFollowUpAssigneeId,active:true,deletedAt:null},select:{id:true}});
    if(!assignee)return badRequest("Responsável pelos pedidos inválido ou inativo.");
  }
  if(data.sellers.some((seller)=>!(seller.timeClockStartMinutes<=seller.timeClockLunchStartMinutes&&seller.timeClockLunchStartMinutes<=seller.timeClockLunchEndMinutes&&seller.timeClockLunchEndMinutes<=seller.timeClockEndMinutes))){
    return badRequest("Os horários do ponto devem seguir a ordem entrada, almoço, retorno e saída.");
  }

  const sellers = await prisma.user.findMany({
    where: { id: { in: data.sellers.map((seller) => seller.id) } },
    select: { id: true, role: true, supervisorId: true, followUpAfterDays: true, canTransferOwnCustomers: true, deletedAt: true },
  });
  if (
    sellers.length !== data.sellers.length ||
    sellers.some((seller) => seller.deletedAt || !canSupervisorConfigureSeller(user.id, seller))
  ) {
    return forbidden("Você só pode configurar vendedores diretamente vinculados à sua equipe.");
  }

  const currentPlans=await prisma.commissionPlan.findMany({where:{representativeId:{in:sellers.filter((seller)=>seller.role==="REPRESENTANTE").map((seller)=>seller.id)},endDate:null},orderBy:{startDate:"desc"}});
  const now=new Date();
  await prisma.$transaction(async(tx)=>{
    await tx.user.update({
      where: { id: user.id },
      data: { allowSellerCustomerTransfer: data.allowSellerCustomerTransfer,orderFollowUpAssigneeId:data.orderFollowUpAssigneeId },
    });
    for(const seller of data.sellers){
      await tx.user.update({
        where: { id: seller.id },
        data: {
          followUpAfterDays: seller.followUpAfterDays,
          canTransferOwnCustomers: seller.canTransferOwnCustomers,
          timeClockReminderEnabled:seller.timeClockReminderEnabled,
          timeClockRequiredEvents:seller.timeClockRequiredEvents,
          timeClockWorkingDays:seller.timeClockWorkingDays,
          timeClockStartMinutes:seller.timeClockStartMinutes,
          timeClockLunchStartMinutes:seller.timeClockLunchStartMinutes,
          timeClockLunchEndMinutes:seller.timeClockLunchEndMinutes,
          timeClockEndMinutes:seller.timeClockEndMinutes,
          timeClockReminderIntervalMinutes:seller.timeClockReminderIntervalMinutes,
        },
      });
      const target=sellers.find((item)=>item.id===seller.id);
      if(target?.role!=="REPRESENTANTE")continue;
      const rates:Array<{brand:"MIBRO"|"SINCROFIT"|null;percent:number|null}>=[
        {brand:null,percent:seller.commissionPercent},
        {brand:"MIBRO",percent:seller.commissionMibroPercent},
        {brand:"SINCROFIT",percent:seller.commissionSincrofitPercent},
      ];
      for(const {brand,percent} of rates){
        if(percent===null)continue;
        const rate={brand,rateBps:Math.round(percent*100)};
        const existing=currentPlans.find((plan)=>plan.representativeId===seller.id&&plan.brand===rate.brand);
        if(existing?.rateBps===rate.rateBps)continue;
        await tx.commissionPlan.updateMany({where:{representativeId:seller.id,brand:rate.brand,endDate:null},data:{endDate:now}});
        await tx.commissionPlan.create({data:{representativeId:seller.id,createdById:user.id,brand:rate.brand,rateBps:rate.rateBps,startDate:now}});
      }
    }
  });

  await logAudit({
    actorId: user.id,
    action: "TEAM_SETTINGS_UPDATED",
    entityType: "User",
    entityId: user.id,
    metadata: {
      allowSellerCustomerTransfer: data.allowSellerCustomerTransfer,
      orderFollowUpAssigneeId:data.orderFollowUpAssigneeId,
      followUpAfterDays: data.sellers.map((seller) => ({ id: seller.id, days: seller.followUpAfterDays })),
      individualTransferPermissions: data.sellers.map((seller) => ({
        id: seller.id,
        allowed: seller.canTransferOwnCustomers,
      })),
      timeClockReminders:data.sellers.map((seller)=>({id:seller.id,enabled:seller.timeClockReminderEnabled,requiredEvents:seller.timeClockRequiredEvents,intervalMinutes:seller.timeClockReminderIntervalMinutes})),
    },
  });

  const representativeRates=data.sellers.filter((seller)=>sellers.find((item)=>item.id===seller.id)?.role==="REPRESENTANTE").map((seller)=>({id:seller.id,general:seller.commissionPercent,mibro:seller.commissionMibroPercent,sincrofit:seller.commissionSincrofitPercent}));
  if(representativeRates.length)await logAudit({actorId:user.id,action:"COMMISSION_PLAN_UPDATED",entityType:"CommissionPlan",metadata:{rates:representativeRates,effectiveAt:now.toISOString()}});

  const previousById = new Map(sellers.map((seller) => [seller.id, seller]));
  await Promise.all(data.sellers.map(async (seller) => {
    const previous = previousById.get(seller.id)!;
    const changes: Record<string, { from: number | boolean; to: number | boolean }> = {};
    if (previous.followUpAfterDays !== seller.followUpAfterDays) {
      changes.followUpAfterDays = { from: previous.followUpAfterDays, to: seller.followUpAfterDays };
    }
    if (previous.canTransferOwnCustomers !== seller.canTransferOwnCustomers) {
      changes.canTransferOwnCustomers = { from: previous.canTransferOwnCustomers, to: seller.canTransferOwnCustomers };
    }
    if (Object.keys(changes).length > 0) {
      await logAudit({
        actorId: user.id,
        action: "USER_PERMISSIONS_UPDATED",
        entityType: "User",
        entityId: seller.id,
        metadata: { changes },
      });
    }
  }));

  return NextResponse.json({ success: true });
}
