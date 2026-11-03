import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatCentsToBRL, formatDateTime } from "@/lib/format";

export default async function DeletedSimulationsPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/cotacoes");
  // Histórico permanente: continua visível após restaurar e após vencer os 7 dias.
  const records = await prisma.auditLog.findMany({ where: { action: "SIMULATION_DELETED", entityType: "Quote" },
    include: { actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return <div className="space-y-4">
    <h1 className="text-xl font-semibold">Histórico de simulações excluídas</h1>
    <p className="text-sm text-gray-500">Somente Admin/Master. Valores e produtos permanecem registrados. A restauração é permitida em até 7 dias após a exclusão.</p>
    <Link href="/cotacoes" className="underline text-sm">Voltar para propostas</Link>
    {records.length === 0 && <p className="text-sm">Nenhuma exclusão registrada.</p>}
    {records.map(record => {
      const meta = record.metadata as { snapshot?: { customerName?: string; sellerName?: string; brand?: string; valueCents?: number; productsSummary?: { products?: Array<{ name?: string; sku?: string; quantity?: number; unitPriceCents?: number; subtotalCents?: number }> } } } | null;
      const snapshot = meta?.snapshot;
      return <section key={record.id} className="card p-4 space-y-2">
        <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{snapshot?.customerName || "Simulação"} · {snapshot?.brand}</h2><span>{formatCentsToBRL(snapshot?.valueCents)}</span></div>
        <p className="text-sm text-gray-500">Vendedor: {snapshot?.sellerName || "—"}. Excluída por {record.actor?.name || "Usuário removido"} em {formatDateTime(record.createdAt)}.</p>
        <ul className="text-sm space-y-1">{snapshot?.productsSummary?.products?.map((product, index) => <li key={index}>{product.quantity ?? "—"} × {product.name || product.sku || "Produto"} · SKU: {product.sku || "—"} · Unitário: {formatCentsToBRL(product.unitPriceCents)} · Subtotal: {formatCentsToBRL(product.subtotalCents)}</li>)}</ul>
        {record.entityId && <Link href={`/cotacoes/${record.entityId}`} className="underline text-sm">Ver detalhes e restauração</Link>}
      </section>;
    })}
  </div>;
}
