import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCustomerScopeFilter } from "@/lib/authz";
import { formatCentsToBRL, formatDateTime } from "@/lib/format";
import { SALE_STAGE_LABELS } from "@/lib/labels";
import { commissionStatusLabel, formatCommissionPercent } from "@/lib/representative-commission";
import { SaleCommissionEditor } from "./sale-commission-editor";

const PAGE_SIZE = 100;

export default async function VendasPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await auth();
  const user = { id: session!.user.id, role: session!.user.role };
  const canSeeSeller = user.role !== "VENDEDOR" && user.role !== "REPRESENTANTE";
  const canEditCommission = user.role === "ADMIN" || user.role === "SUPERVISOR";
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const scope = await getCustomerScopeFilter(user);

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where: { customer: scope },
      include: {
        customer: { select: { id: true, contactName: true, tradeName: true } },
        seller: { select: { id: true, name: true, rca: true, role: true } },
        olistOrder: { select: { orderNumber: true, olistOrderId: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.sale.count({ where: { customer: scope } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Vendas</h1>
      <p className="text-sm text-gray-500 mb-6">
        Listagem de vendas da sua carteira. A criação/confirmação de vendas segue o fluxo de pedidos
        Olist/Shopify e transições de estágio confirmadas por servidor. A comissão aparece somente nas vendas de representantes;
        cada representante vê apenas a própria.
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Pedido</th>
              <th className="px-4 py-2 font-medium">Cliente</th>
              {canSeeSeller && <th className="px-4 py-2 font-medium">Vendedor</th>}
              <th className="px-4 py-2 font-medium">Estágio</th>
              <th className="px-4 py-2 font-medium">Valor</th>
              <th className="px-4 py-2 font-medium">Comissão</th>
              <th className="px-4 py-2 font-medium">Confirmada em</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sales.map((s) => {
              // Representante nunca vê comissão de outro representante.
              const showCommission = s.seller.role === "REPRESENTANTE" && (canSeeSeller || s.seller.id === user.id);
              const order = s.olistOrder?.orderNumber || s.olistOrder?.olistOrderId;
              return (
                <tr key={s.id}>
                  <td className="px-4 py-3 text-gray-700">{order ? `#${order}` : "—"}</td>
                  <td className="px-4 py-3"><Link className="hover:text-brand" href={`/clientes/${s.customer.id}`}>{s.customer.tradeName || s.customer.contactName}</Link></td>
                  {canSeeSeller && <td className="px-4 py-3 text-gray-600">{s.seller.name}{s.seller.rca && <span className="block text-xs text-gray-400">RCA {s.seller.rca}</span>}</td>}
                  <td className="px-4 py-3">{SALE_STAGE_LABELS[s.stage] ?? s.stage}</td>
                  <td className="px-4 py-3">{formatCentsToBRL(s.valueCents)}</td>
                  <td className="px-4 py-3">
                    {showCommission ? (
                      <div className="space-y-0.5">
                        <div className="font-medium text-gray-800">
                          {formatCommissionPercent(s.commissionRateBps)}{s.commissionCents !== null ? ` · ${formatCentsToBRL(s.commissionCents)}` : ""}
                        </div>
                        <div className="text-xs text-gray-500">
                          {commissionStatusLabel(s, s.commissionRateBps)}{s.commissionSource === "CUSTOM_ORDER" ? " · específica do pedido" : s.commissionSource === "DEFAULT" ? " · padrão" : ""}
                        </div>
                        {canEditCommission && (
                          <SaleCommissionEditor saleId={s.id} currentPercent={s.commissionRateBps === null ? null : s.commissionRateBps / 100} isCustom={s.commissionSource === "CUSTOM_ORDER"} />
                        )}
                      </div>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.confirmedAt ? formatDateTime(s.confirmedAt) : "-"}</td>
                </tr>
              );
            })}
            {sales.length === 0 && (
              <tr>
                <td colSpan={canSeeSeller ? 7 : 6} className="px-4 py-8 text-center text-gray-400">
                  Nenhuma venda registrada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2 text-sm">
          {page > 1 && <Link className="btn-secondary" href={`/vendas?page=${page - 1}`}>← Anterior</Link>}
          <span className="text-gray-500">{page} / {totalPages}</span>
          {page < totalPages && <Link className="btn-secondary" href={`/vendas?page=${page + 1}`}>Próxima →</Link>}
        </nav>
      )}
    </div>
  );
}
