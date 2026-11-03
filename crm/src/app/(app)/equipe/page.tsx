import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatCentsToBRL } from "@/lib/format";
import { calculateCommissionForSales, getBrazilMonthRange } from "@/lib/representative-commission";
import { formatRca } from "@/lib/rca";
import { TeamSettingsForm } from "./team-settings-form";
import { TeamMemberForm } from "./team-member-form";

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await auth();
  if (session!.user.role !== "SUPERVISOR") redirect("/dashboard");
  const period = getBrazilMonthRange((await searchParams).month);

  const [supervisor, sellers, representatives, assigneeOptions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session!.user.id },
      select: { id: true, name: true, allowSellerCustomerTransfer: true, canCreateTeamUsers: true, orderFollowUpAssigneeId: true },
    }),
    prisma.user.findMany({
      where: { supervisorId: session!.user.id, role: { in: ["VENDEDOR", "REPRESENTANTE"] }, deletedAt: null },
      select: {
        id: true,
        name: true,
        role: true,
        followUpAfterDays: true,
        canTransferOwnCustomers: true,
        timeClockReminderEnabled:true,timeClockRequiredEvents:true,timeClockWorkingDays:true,
        timeClockStartMinutes:true,timeClockLunchStartMinutes:true,timeClockLunchEndMinutes:true,
        timeClockEndMinutes:true,timeClockReminderIntervalMinutes:true,
        active: true,
        rca: true,
        sellerProfile: { select: { displayName: true, representativeType: true } },
        representativeRegions: { select: { state: true, city: true }, orderBy: [{ state: "asc" }, { city: "asc" }] },
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { supervisorId: session!.user.id, role: "REPRESENTANTE", active: true },
      select: { id: true, name: true, rca: true, sellerProfile: { select: { displayName: true, representativeType: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { active:true, deletedAt:null },
      select: { id:true, name:true, role:true, sellerProfile:{select:{displayName:true}} },
      orderBy: { name:"asc" },
    }),
  ]);

  const representativeIds = representatives.map((representative) => representative.id);
  const [sales, commissionPlans, typeDefaults] = representativeIds.length
    ? await Promise.all([prisma.sale.findMany({
        where: {
          sellerId: { in: representativeIds },
          stage: "PAGAMENTO_CONFIRMADO",
          confirmedAt: { gte: period.start, lt: period.end },
        },
        select:{ sellerId:true,valueCents:true,confirmedAt:true,commissionRateBps:true,commissionSource:true,olistOrder:{select:{brand:true}} },
      }), prisma.commissionPlan.findMany({
        where:{ representativeId:{in:representativeIds} },
        orderBy:{startDate:"desc"},
      }), prisma.representativeTypeCommission.findMany()])
    : [[], [], []] as const;
  const now = new Date();
  // Percentual registrado vigente, sem fallback: sem plano = em branco.
  const registeredPercent = (sellerId: string, brand: "MIBRO" | "SINCROFIT" | null) => {
    const plan = commissionPlans.find((item) => item.representativeId === sellerId && item.brand === brand && item.startDate <= now && (!item.endDate || item.endDate > now));
    return plan ? plan.rateBps / 100 : null;
  };
  const typeDefaultBps = (type: string | null | undefined) => typeDefaults.find((item) => item.type === type)?.rateBps ?? null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Minha equipe</h1>
        <p className="text-sm text-gray-500 mt-1">Controle sua equipe, follow-ups, repasses e comissões dentro do seu alcance.</p>
      </div>
      <section className="card p-5">
        <h2 className="text-sm font-semibold text-gray-800">O que você pode ver e fazer</h2>
        <ul className="mt-3 grid list-disc grid-cols-1 gap-3 pl-5 text-sm text-gray-600 sm:grid-cols-2">
          <li>Ver clientes, propostas, vendas e follow-ups próprios e dos integrantes da equipe.</li>
          <li>Filtrar e exportar somente dados da própria equipe.</li>
          <li>Configurar dias de follow-up e repasse individual de cada integrante.</li>
          <li>Transferir clientes apenas dentro da própria equipe.</li>
          <li>Criar e acompanhar metas dos vendedores; representantes não possuem meta.</li>
          <li>Ver o ponto dos vendedores; representantes não utilizam ponto.</li>
          <li>Definir e acompanhar a comissão variável dos representantes vinculados.</li>
          <li>{supervisor?.canCreateTeamUsers ? "Criar vendedores e representantes para sua equipe." : "Criação de contas não liberada pelo administrador."}</li>
        </ul>
        <p className="mt-4 text-xs font-medium text-red-600">Nunca é permitido visualizar, exportar ou transferir dados de outra equipe.</p>
      </section>
      {supervisor?.canCreateTeamUsers && <TeamMemberForm />}
      <TeamSettingsForm
        supervisor={{ id: session!.user.id, name: supervisor?.name ?? "Meu usuário" }}
        initialAllowTransfer={supervisor?.allowSellerCustomerTransfer ?? false}
        initialOrderFollowUpAssigneeId={supervisor?.orderFollowUpAssigneeId ?? null}
        assigneeOptions={assigneeOptions.map((option)=>({id:option.id,name:option.sellerProfile?.displayName||option.name,role:option.role}))}
        initialSellers={sellers.map((seller) => ({
          id: seller.id,
          name: seller.name,
          displayName: seller.sellerProfile?.displayName ?? null,
          role: seller.role,
          followUpAfterDays: seller.followUpAfterDays,
          canTransferOwnCustomers: seller.canTransferOwnCustomers,
          active: seller.active,
          timeClockReminderEnabled:seller.timeClockReminderEnabled,
          timeClockRequiredEvents:seller.timeClockRequiredEvents,
          timeClockWorkingDays:seller.timeClockWorkingDays,
          timeClockStartMinutes:seller.timeClockStartMinutes,
          timeClockLunchStartMinutes:seller.timeClockLunchStartMinutes,
          timeClockLunchEndMinutes:seller.timeClockLunchEndMinutes,
          timeClockEndMinutes:seller.timeClockEndMinutes,
          timeClockReminderIntervalMinutes:seller.timeClockReminderIntervalMinutes,
          commissionPercent:seller.role === "REPRESENTANTE" ? registeredPercent(seller.id,null) : null,
          commissionMibroPercent:seller.role === "REPRESENTANTE" ? registeredPercent(seller.id,"MIBRO") : null,
          commissionSincrofitPercent:seller.role === "REPRESENTANTE" ? registeredPercent(seller.id,"SINCROFIT") : null,
          rca:seller.rca,
          representativeProfile:seller.role === "REPRESENTANTE" ? { representativeType:seller.sellerProfile?.representativeType ?? null, regions:seller.representativeRegions } : null,
        }))}
      />

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Comissões dos representantes</h2>
            <p className="mt-1 text-xs text-gray-500">Percentual vigente na data de cada venda confirmada, incluindo variações por empresa. Visível somente para você.</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link className="btn-secondary" href={`/equipe?month=${period.previousMonth}`}>←</Link>
            <span className="min-w-24 text-center font-medium text-gray-700">{period.month.split("-").reverse().join("/")}</span>
            <Link className="btn-secondary" href={`/equipe?month=${period.nextMonth}`}>→</Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr><th className="px-4 py-2">Representante</th><th className="px-4 py-2">Vendas confirmadas</th><th className="px-4 py-2">Total vendido</th><th className="px-4 py-2">Comissão</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {representatives.map((representative) => {
                const representativeSales = sales.filter((sale)=>sale.sellerId===representative.id && sale.confirmedAt).map((sale)=>({valueCents:sale.valueCents,confirmedAt:sale.confirmedAt!,brand:sale.olistOrder?.brand??null,customRateBps:sale.commissionSource==="CUSTOM_ORDER"?sale.commissionRateBps:null}));
                const plans = commissionPlans.filter((plan)=>plan.representativeId===representative.id);
                const typeBps = typeDefaultBps(representative.sellerProfile?.representativeType);
                const hasAnyRate = plans.length > 0 || typeBps !== null || representativeSales.some((sale)=>sale.customRateBps!==null);
                const total = representativeSales.reduce((sum,sale)=>sum+sale.valueCents,0);
                return <tr key={representative.id}><td className="px-4 py-3 font-medium text-gray-800">{representative.sellerProfile?.displayName || representative.name}{representative.rca && <span className="ml-2 text-xs font-normal text-gray-400">{formatRca(representative.rca)}</span>}</td><td className="px-4 py-3">{representativeSales.length}</td><td className="px-4 py-3">{formatCentsToBRL(total)}</td><td className="px-4 py-3 font-semibold text-gray-900">{hasAnyRate ? formatCentsToBRL(calculateCommissionForSales(representativeSales,plans,typeBps)) : <span className="font-normal text-gray-400">A definir</span>}</td></tr>;
              })}
              {representatives.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Nenhum representante vinculado à sua equipe.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
