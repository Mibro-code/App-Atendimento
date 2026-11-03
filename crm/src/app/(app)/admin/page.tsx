import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatCentsToBRL } from "@/lib/format";
import { getFollowupCutoffDate } from "@/lib/followups";
import { CommissionDefaultsForm } from "./commission-defaults-form";
import { PAUSED_PIPELINE_STAGES } from "@/lib/pipeline-rules";

export default async function AdminDashboardPage() {
  const [sellerCount, customerCount, salesCount, salesAggregate, overdueFollowUps, sellers, commissionDefaults] = await Promise.all([
    prisma.user.count({ where: { active: true, role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] } } }),
    prisma.customer.count(),
    prisma.sale.count({ where: { stage: "PAGAMENTO_CONFIRMADO" } }),
    prisma.sale.aggregate({ where: { stage: "PAGAMENTO_CONFIRMADO" }, _sum: { valueCents: true } }),
    prisma.followUp.count({
      where: { status: "PENDENTE", dueAt: { lt: new Date() } },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] } },
      select: {
        id: true,
        name: true,
        rca: true,
        _count: { select: { customers: true, sales: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.representativeTypeCommission.findMany(),
  ]);

  const cutoff = getFollowupCutoffDate();
  // Reciclagem/Inativos não contam como atraso: estão fora das filas ativas.
  const staleCount = await prisma.customer.count({
    where: {
      pipelineStage: { notIn: PAUSED_PIPELINE_STAGES },
      OR: [{ lastInteractionAt: { lt: cutoff } }, { lastInteractionAt: null, createdAt: { lt: cutoff } }],
    },
  });

  const salesBySeller = await prisma.sale.groupBy({
    by: ["sellerId"],
    where: { stage: "PAGAMENTO_CONFIRMADO" },
    _sum: { valueCents: true },
    _count: true,
  });
  const salesMap = new Map(salesBySeller.map((s) => [s.sellerId, s]));

  const cards = [
    { label: "Vendedores ativos", value: sellerCount },
    { label: "Clientes cadastrados", value: customerCount },
    { label: "Vendas confirmadas", value: salesCount },
    { label: "Valor vendido (total)", value: formatCentsToBRL(salesAggregate._sum.valueCents ?? 0) },
    { label: "Follow-ups atrasados", value: overdueFollowUps + staleCount },
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Administração</h1>
      <p className="text-sm text-gray-500 mb-6">Visão geral de toda a operação comercial.</p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-6">
        <Link href="/admin/vendedores" className="btn-primary">Vendedores</Link>
        <Link href="/admin/clientes" className="btn-secondary">Todos os clientes</Link>
        <Link href="/admin/vendas" className="btn-secondary">Todas as vendas</Link>
        <Link href="/admin/mapa" className="btn-secondary">Mapa comercial</Link>
      </div>

      <CommissionDefaultsForm initial={Object.fromEntries(commissionDefaults.map((row) => [row.type, row.rateBps]))} />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Vendedor</th>
              <th className="px-4 py-2 font-medium">Clientes</th>
              <th className="px-4 py-2 font-medium">Vendas confirmadas</th>
              <th className="px-4 py-2 font-medium">Valor vendido</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sellers.map((s) => {
              const agg = salesMap.get(s.id);
              return (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}{s.rca && <span className="ml-2 text-xs font-normal text-gray-400">RCA {s.rca}</span>}</td>
                  <td className="px-4 py-3">{s._count.customers}</td>
                  <td className="px-4 py-3">{agg?._count ?? 0}</td>
                  <td className="px-4 py-3">{formatCentsToBRL(agg?._sum.valueCents ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
