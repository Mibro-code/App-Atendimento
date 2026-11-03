import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertEnabled } from "@/lib/proposals/proposal-core";
import { loadProposalActor } from "@/lib/proposals/proposal-access";
import { ProposalOrderBadge, ProposalStatusBadge, ProposalSyncBadge } from "@/components/proposal-badges";
import { formatDateTime } from "@/lib/format";

const FILTERS = { todas: "Todas as pendências", pedido: "Pedidos aguardando Master", conversao: "Conversão solicitada", sincronizacao: "Falhas e divergências", proposta: "Condições aguardando aprovação" } as const;
export default async function MasterQueue({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  assertEnabled();
  const session = await auth();
  if (!session?.user) notFound();
  const actor = await loadProposalActor({ id: session.user.id, role: session.user.role });
  if (actor.role !== "ADMIN") notFound();
  const params = await searchParams;
  const filter = params.tipo && params.tipo in FILTERS ? params.tipo as keyof typeof FILTERS : "todas";
  const brand = params.empresa === "MIBRO" || params.empresa === "SINCROFIT" ? params.empresa : undefined;
  const page = Math.min(200, Math.max(1, Number.parseInt(params.pagina ?? "1", 10) || 1));
  const issues: Record<Exclude<keyof typeof FILTERS, "todas">, Prisma.CommercialProposalWhereInput> = {
    pedido: { commercialStatus: "CONVERTIDA", orderStatus: "PEDIDO_CRIADO" },
    conversao: { commercialStatus: "CONVERSAO_SOLICITADA" },
    sincronizacao: { OR: [{ syncStatus: { in: ["ERRO", "CONFLITO"] } }, { orderStatus: "CONVERSAO_INCERTA" }] },
    proposta: { commercialStatus: "AGUARDANDO_APROVACAO" },
  };
  const where: Prisma.CommercialProposalWhereInput = { ...(brand ? { brand } : {}), AND: [filter === "todas" ? { OR: Object.values(issues) } : issues[filter]] };
  const [rows, total] = await Promise.all([
    prisma.commercialProposal.findMany({ where, take: 50, skip: (page - 1) * 50, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], select: { id: true, brand: true, commercialStatus: true, orderStatus: true, syncStatus: true, olistProposalNumber: true, olistOrderNumber: true, updatedAt: true, lastSyncError: true, customer: { select: { contactName: true, tradeName: true } }, seller: { select: { name: true } } } }),
    prisma.commercialProposal.count({ where }),
  ]);
  const href = (n: number) => `/propostas/pendencias?tipo=${filter}&empresa=${brand ?? ""}&pagina=${n}`;
  return <div className="space-y-5 max-w-6xl">
    <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-xl font-semibold">Pendências do Master</h1><p className="text-sm text-gray-500">{total} pendências · nenhuma operação é executada ao abrir esta tela.</p></div><Link href="/propostas" className="btn-secondary">Todas as propostas</Link></div>
    <form className="card flex flex-wrap gap-3 p-4"><label className="text-sm">Etapa<select className="input-field" name="tipo" defaultValue={filter}>{Object.entries(FILTERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label className="text-sm">Empresa do pedido<select className="input-field" name="empresa" defaultValue={brand ?? ""}><option value="">Todas</option><option value="MIBRO">Mibro Brasil</option><option value="SINCROFIT">Sincrofit</option></select></label><button className="btn-secondary self-end">Filtrar</button></form>
    <div className="space-y-3">{rows.length === 0 && <p className="card p-6 text-sm">Nenhuma pendência neste filtro.</p>}{rows.map((p) => <Link key={p.id} href={`/propostas/${p.id}`} className="card block space-y-2 p-4 hover:border-gray-500"><div className="flex flex-wrap justify-between gap-2"><strong>{p.customer.tradeName || p.customer.contactName}</strong><span className="text-xs text-gray-500">{p.brand} · {p.seller.name}</span></div><div className="flex flex-wrap gap-2"><ProposalStatusBadge status={p.commercialStatus}/><ProposalOrderBadge status={p.orderStatus}/><ProposalSyncBadge status={p.syncStatus}/></div><p className="text-xs text-gray-500">Proposta {p.olistProposalNumber ?? "a sincronizar"} · Pedido {p.olistOrderNumber ?? "a criar"} · Atualizada {formatDateTime(p.updatedAt)}</p>{p.lastSyncError && <p className="text-xs text-amber-700">{p.lastSyncError}</p>}</Link>)}</div>
    <div className="flex items-center gap-4 text-sm">{page > 1 && <Link href={href(page - 1)} className="btn-secondary">Anterior</Link>}<span>Página {page}</span>{page * 50 < total && <Link href={href(page + 1)} className="btn-secondary">Próxima</Link>}</div>
  </div>;
}
