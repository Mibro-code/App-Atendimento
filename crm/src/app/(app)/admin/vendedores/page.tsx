import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS } from "@/lib/labels";
import { NewSellerForm } from "./new-seller-form";

export default async function VendedoresPage() {
  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      deletedAt: true,
      _count: { select: { customers: true } },
    },
  });

  const supervisors = users.filter((u) => u.role === "SUPERVISOR" || u.role === "ADMIN");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Vendedores</h1>
        <p className="text-sm text-gray-500">Gerencie usuários, papéis e status de acesso.</p>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Novo usuário</h2>
        <NewSellerForm supervisors={supervisors.map((s) => ({ id: s.id, name: s.name }))} />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">E-mail</th>
              <th className="px-4 py-2 font-medium">Papel</th>
              <th className="px-4 py-2 font-medium">Clientes</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/admin/vendedores/${u.id}`} className="font-medium text-gray-900 hover:text-brand">
                    {u.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-600">{u.email}</td>
                <td className="px-4 py-3">{ROLE_LABELS[u.role]}</td>
                <td className="px-4 py-3">{u._count.customers}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${u.deletedAt ? "bg-red-100 text-red-700" : u.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {u.deletedAt ? "Excluído" : u.active ? "Ativo" : "Desativado"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
