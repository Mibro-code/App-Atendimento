import { auth } from "@/auth";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getVisibleSellerIds } from "@/lib/authz";
import { NewCustomerForm } from "./new-customer-form";
import { ImportCustomersForm } from "./import-customers-form";

export default async function NovoClientePage({
  searchParams,
}: {
  searchParams: Promise<{ modo?: string;conversationId?:string }>;
}) {
  const session = await auth();
  const user = { id: session!.user.id, role: session!.user.role };
  const { modo,conversationId } = await searchParams;
  const importing = modo === "importar";
  const visibleSellerIds = await getVisibleSellerIds(user);
  const sellers = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] },
      ...(visibleSellerIds ? { id: { in: visibleSellerIds } } : {}),
    },
    select: { id: true, name: true, sellerProfile: { select: { displayName: true } } },
    orderBy: { name: "asc" },
  });
  const sellerOptions = sellers.map((seller) => ({ id: seller.id, name: seller.sellerProfile?.displayName ?? seller.name }));

  return (
    <div className={importing ? "max-w-4xl" : "max-w-2xl"}>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Adicionar clientes</h1>
      <p className="text-sm text-gray-500 mb-6">
        Cadastre um cliente manualmente ou importe vários de uma planilha.
      </p>
      <div className="flex gap-2 mb-4 border-b border-gray-200">
        <Link href="/clientes/novo" className={`px-4 py-2 text-sm font-medium border-b-2 ${!importing ? "border-brand text-brand" : "border-transparent text-gray-500"}`}>Cadastro manual</Link>
        <Link href="/clientes/novo?modo=importar" className={`px-4 py-2 text-sm font-medium border-b-2 ${importing ? "border-brand text-brand" : "border-transparent text-gray-500"}`}>Importar planilha</Link>
      </div>
      <div className="card p-6">
        {importing ? <ImportCustomersForm sellers={sellerOptions} currentUserId={user.id} /> : <NewCustomerForm conversationId={conversationId} />}
      </div>
    </div>
  );
}
