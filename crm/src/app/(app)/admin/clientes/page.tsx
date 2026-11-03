import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { StatusBadge, TemperatureBadge } from "@/components/badges";

export default async function AdminClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  const customers = await prisma.customer.findMany({
    where: q
      ? {
          OR: [
            { contactName: { contains: q, mode: "insensitive" } },
            { tradeName: { contains: q, mode: "insensitive" } },
            { legalName: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    include: { seller: { select: { name: true, sellerProfile: { select: { displayName: true } } } } },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Todos os clientes</h1>
      <p className="text-sm text-gray-500 mb-6">Visão administrativa, sem restrição de carteira.</p>

      <form className="mb-4">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar cliente..."
          className="input-field max-w-md"
        />
      </form>

      <div className="card overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Vendedor</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Temperatura</th>
              <th className="px-4 py-2 font-medium">Última interação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/clientes/${c.id}`} className="font-medium text-gray-900 hover:text-brand">
                    {c.tradeName || c.contactName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-600">{c.seller.sellerProfile?.displayName ?? c.seller.name}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-4 py-3">
                  <TemperatureBadge temperature={c.temperature} />
                </td>
                <td className="px-4 py-3 text-gray-500">{formatDate(c.lastInteractionAt)}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
