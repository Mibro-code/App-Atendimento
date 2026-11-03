import { prisma } from "@/lib/prisma";
import { formatCentsToBRL, formatDateTime } from "@/lib/format";
import { SALE_STAGE_LABELS } from "@/lib/labels";

export default async function AdminVendasPage() {
  const sales = await prisma.sale.findMany({
    include: {
      customer: { select: { contactName: true, tradeName: true } },
      seller: { select: { name: true, sellerProfile: { select: { displayName: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Todas as vendas</h1>
      <p className="text-sm text-gray-500 mb-6">Visão administrativa de todas as vendas registradas.</p>

      <div className="card overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Vendedor</th>
              <th className="px-4 py-2 font-medium">Estágio</th>
              <th className="px-4 py-2 font-medium">Valor</th>
              <th className="px-4 py-2 font-medium">Confirmada em</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sales.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3">{s.customer.tradeName || s.customer.contactName}</td>
                <td className="px-4 py-3 text-gray-600">{s.seller.sellerProfile?.displayName ?? s.seller.name}</td>
                <td className="px-4 py-3">{SALE_STAGE_LABELS[s.stage] ?? s.stage}</td>
                <td className="px-4 py-3">{formatCentsToBRL(s.valueCents)}</td>
                <td className="px-4 py-3 text-gray-500">{s.confirmedAt ? formatDateTime(s.confirmedAt) : "-"}</td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Nenhuma venda registrada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
