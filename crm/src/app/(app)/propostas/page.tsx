import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { formatCentsToBRL, formatDateBR, formatDateTime } from "@/lib/format";
import { CommercialBrandBadge } from "@/components/badges";
import { ProposalApprovalBadge, ProposalOrderBadge, ProposalStatusBadge, ProposalSyncBadge } from "@/components/proposal-badges";
import { loadProposalActor, proposalWhereForActor } from "@/lib/proposals/proposal-access";
import { proposalsEnabled } from "@/lib/proposals/proposal-config";
import { buildProposalFilterWhere, parseProposalFilters, proposalFiltersToQuery } from "@/lib/proposals/proposal-filters";
import { COMMERCIAL_LABELS } from "@/lib/proposals/proposal-labels";
import { effectiveCommercialStatus } from "@/lib/proposals/proposal-rules";
import { isManager } from "@/lib/proposals/proposal-permissions";

const VIEWS = [
  { value: undefined, label: "Todas" },
  { value: "pendentes", label: "Pendentes de aprovação" },
  { value: "minha_aprovacao", label: "Aguardando minha decisão" },
  { value: "conversao", label: "Prontas para conversão" },
  { value: "vencidas", label: "Vencidas" },
  { value: "erro_sync", label: "Erros com o Olist" },
] as const;

export default async function PropostasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!proposalsEnabled()) {
    return <div className="card p-6 text-sm text-gray-600">O módulo de propostas comerciais Olist não está ativo. Use <Link className="underline" href="/cotacoes">Cotações e simulações</Link>.</div>;
  }
  const session = await auth();
  const user = { id: session!.user.id, role: session!.user.role };
  const actor = await loadProposalActor(user);
  const filters = parseProposalFilters(await searchParams);
  const now = new Date();
  const scope = proposalWhereForActor(actor);
  const where: Prisma.CommercialProposalWhereInput = { AND: [scope, buildProposalFilterWhere(filters, { actorId: user.id, now })] };
  const canSeeTeam = actor.role !== "VENDEDOR" && actor.role !== "REPRESENTANTE" || isManager(actor) || actor.functions.includes("FINANCEIRO");

  const [proposals, counts, sellers, supervisors] = await Promise.all([
    prisma.commercialProposal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true, brand: true, olistProposalNumber: true, commercialStatus: true, approvalStatus: true, syncStatus: true, orderStatus: true,
        validUntil: true, createdAt: true, freightCents: true, olistOrderNumber: true, version: true,
        quote: { select: { totalValueCents: true } },
        customer: { select: { id: true, contactName: true, tradeName: true } },
        seller: { select: { name: true, supervisor: { select: { name: true } } } },
      },
    }),
    prisma.commercialProposal.groupBy({ by: ["commercialStatus"], where: scope, _count: { _all: true } }),
    canSeeTeam
      ? prisma.user.findMany({ where: { deletedAt: null, role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] }, ...(actor.role === "SUPERVISOR" && !isManager(actor) ? { id: { in: actor.teamSellerIds as string[] } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    canSeeTeam && (actor.role === "ADMIN" || isManager(actor) || actor.functions.includes("FINANCEIRO"))
      ? prisma.user.findMany({ where: { deletedAt: null, role: "SUPERVISOR" }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);
  const count = (s: string) => counts.find((c) => c.commercialStatus === s)?._count._all ?? 0;
  const link = (o: Record<string, string | undefined>) => {
    const qs = proposalFiltersToQuery(filters, o);
    return qs ? `/propostas?${qs}` : "/propostas";
  };
  const total = (p: (typeof proposals)[number]) => (p.quote.totalValueCents ?? 0) + p.freightCents;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Propostas comerciais</h1>
          <p className="text-sm text-gray-500">Documento oficial da negociação no Olist. Crie a partir de uma simulação concluída.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actor.role === "ADMIN" && <Link href="/propostas/pendencias" className="btn-secondary">Pendências do Master</Link>}
          <Link href="/propostas/relatorio" className="btn-secondary">Indicadores</Link>
          <Link href="/cotacoes/nova" className="btn-primary">Nova simulação</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Aguardando aprovação", count("AGUARDANDO_APROVACAO"), "pendentes"],
          ["Aprovadas", count("APROVADA_INTERNAMENTE"), undefined],
          ["Enviadas", count("ENVIADA") + count("EM_NEGOCIACAO"), undefined],
          ["Aceitas", count("ACEITA") + count("CONVERSAO_SOLICITADA"), "conversao"],
          ["Convertidas", count("CONVERTIDA"), undefined],
          ["Recusadas", count("RECUSADA"), undefined],
        ].map(([label, value, view]) => (
          view ? (
            <Link key={label as string} href={link({ view: view as string })} className="card p-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-lg font-semibold text-gray-900">{value}</p>
            </Link>
          ) : (
            <div key={label as string} className="card p-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-lg font-semibold text-gray-900">{value}</p>
            </div>
          )
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {VIEWS.map((v) => (
          <Link key={v.label} href={link({ view: v.value })} className={`rounded-full border px-3 py-1 ${filters.view === v.value ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 text-gray-600"}`}>
            {v.label}
          </Link>
        ))}
      </div>

      <details className="card p-4" open={!!(filters.q || filters.status || filters.sellerId || filters.supervisorId || filters.from || filters.to || filters.minCents || filters.maxCents || filters.brand)}>
        <summary className="cursor-pointer text-sm font-medium text-gray-700">Filtros</summary>
        <form method="get" className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {filters.view && <input type="hidden" name="view" value={filters.view} />}
          <label className="text-gray-600">Cliente, CPF/CNPJ ou número
            <input name="q" defaultValue={filters.q ?? ""} className="input-field mt-1" placeholder="Nome, documento, nº proposta/pedido" />
          </label>
          <label className="text-gray-600">Empresa
            <select name="brand" defaultValue={filters.brand ?? ""} className="input-field mt-1">
              <option value="">Todas</option>
              <option value="MIBRO">Mibro</option>
              <option value="SINCROFIT">Sincrofit</option>
            </select>
          </label>
          <label className="text-gray-600">Situação
            <select name="status" defaultValue={filters.status ?? ""} className="input-field mt-1">
              <option value="">Todas</option>
              {Object.entries(COMMERCIAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {sellers.length > 0 && (
            <label className="text-gray-600">Vendedor
              <select name="sellerId" defaultValue={filters.sellerId ?? ""} className="input-field mt-1">
                <option value="">Todos</option>
                {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
          {supervisors.length > 0 && (
            <label className="text-gray-600">Supervisor / equipe
              <select name="supervisorId" defaultValue={filters.supervisorId ?? ""} className="input-field mt-1">
                <option value="">Todas as equipes</option>
                {supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
          <label className="text-gray-600">De<input type="date" name="de" defaultValue={filters.from ?? ""} className="input-field mt-1" /></label>
          <label className="text-gray-600">Até<input type="date" name="ate" defaultValue={filters.to ?? ""} className="input-field mt-1" /></label>
          <label className="text-gray-600">Valor mínimo (R$)<input inputMode="decimal" name="min" defaultValue={filters.minCents !== undefined ? String(filters.minCents / 100) : ""} className="input-field mt-1" /></label>
          <label className="text-gray-600">Valor máximo (R$)<input inputMode="decimal" name="max" defaultValue={filters.maxCents !== undefined ? String(filters.maxCents / 100) : ""} className="input-field mt-1" /></label>
          <div className="flex items-end gap-2">
            <button className="btn-primary">Filtrar</button>
            <Link href="/propostas" className="btn-secondary">Limpar</Link>
          </div>
        </form>
      </details>

      {/* Celular: cartões */}
      <div className="space-y-3 md:hidden">
        {proposals.map((p) => (
          <Link key={p.id} href={`/propostas/${p.id}`} className="card block space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-gray-900">{p.customer.tradeName || p.customer.contactName}</p>
                <p className="text-xs text-gray-500">{p.olistProposalNumber ? `Olist nº ${p.olistProposalNumber}` : `CRM ${p.id.slice(-6).toUpperCase()}`} · v{p.version}</p>
              </div>
              <CommercialBrandBadge brand={p.brand} />
            </div>
            <div className="flex flex-wrap gap-1">
              <ProposalStatusBadge status={effectiveCommercialStatus(p, now)} />
              <ProposalApprovalBadge status={p.approvalStatus} />
              <ProposalSyncBadge status={p.syncStatus} />
              {p.orderStatus !== "SEM_PEDIDO" && <ProposalOrderBadge status={p.orderStatus} />}
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-semibold">{formatCentsToBRL(total(p))}</span>
              <span className="text-xs text-gray-500">{p.validUntil ? `válida até ${formatDateBR(p.validUntil)}` : "sem validade"}</span>
            </div>
            <p className="text-xs text-gray-500">{p.seller.name}{p.seller.supervisor ? ` · equipe ${p.seller.supervisor.name}` : ""}</p>
          </Link>
        ))}
        {proposals.length === 0 && <p className="card p-6 text-center text-sm text-gray-400">Nenhuma proposta encontrada.</p>}
      </div>

      {/* Desktop/tablet: tabela */}
      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">Número</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Empresa</th>
              <th className="px-3 py-2 font-medium">Vendedor</th>
              <th className="px-3 py-2 font-medium">Supervisor</th>
              <th className="px-3 py-2 font-medium">Criada</th>
              <th className="px-3 py-2 font-medium">Validade</th>
              <th className="px-3 py-2 font-medium text-right">Valor</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 font-medium">Aprovação</th>
              <th className="px-3 py-2 font-medium">Olist</th>
              <th className="px-3 py-2 font-medium">Pedido</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {proposals.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link href={`/propostas/${p.id}`} className="font-medium underline">{p.olistProposalNumber ?? `CRM ${p.id.slice(-6).toUpperCase()}`}</Link>
                  <span className="block text-[11px] text-gray-400">versão {p.version}</span>
                </td>
                <td className="px-3 py-2"><Link href={`/clientes/${p.customer.id}`} className="underline">{p.customer.tradeName || p.customer.contactName}</Link></td>
                <td className="px-3 py-2"><CommercialBrandBadge brand={p.brand} /></td>
                <td className="px-3 py-2 text-gray-600">{p.seller.name}</td>
                <td className="px-3 py-2 text-gray-600">{p.seller.supervisor?.name ?? "—"}</td>
                <td className="px-3 py-2 text-gray-500">{formatDateTime(p.createdAt)}</td>
                <td className="px-3 py-2 text-gray-500">{p.validUntil ? formatDateBR(p.validUntil) : "—"}</td>
                <td className="px-3 py-2 text-right">{formatCentsToBRL(total(p))}</td>
                <td className="px-3 py-2"><ProposalStatusBadge status={effectiveCommercialStatus(p, now)} /></td>
                <td className="px-3 py-2"><ProposalApprovalBadge status={p.approvalStatus} /></td>
                <td className="px-3 py-2"><ProposalSyncBadge status={p.syncStatus} /></td>
                <td className="px-3 py-2">{p.olistOrderNumber && <span className="mb-1 block text-xs">nº {p.olistOrderNumber}</span>}{p.orderStatus !== "SEM_PEDIDO" ? <ProposalOrderBadge status={p.orderStatus} /> : "—"}</td>
              </tr>
            ))}
            {proposals.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-400">Nenhuma proposta encontrada para este filtro.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {proposals.length === 200 && <p className="text-xs text-gray-500">Mostrando as 200 mais recentes. Refine os filtros para ver as demais.</p>}
    </div>
  );
}
