import Link from "next/link";
import type { PriceTier, Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCustomerScopeFilter, getVisibleSellerIds } from "@/lib/authz";
import { formatCentsToBRL, formatDateTime } from "@/lib/format";
import { CommercialBrandBadge, QuoteStatusBadge, ProposalModeBadge } from "@/components/badges";
import { buildQuoteFilterWhere, parseQuoteFilters, quoteFiltersToQuery } from "@/lib/quotes/quote-filters";
import { QuoteTrashButton } from "./quote-trash-button";

const BRAND_FILTERS = [
  { value: "ALL", label: "Todas as empresas" },
  { value: "MIBRO", label: "Mibro" },
  { value: "SINCROFIT", label: "Sincrofit" },
] as const;

const MODE_FILTERS = [
  { value: "ALL", label: "Todas" },
  { value: "SIMULATION", label: "Simulações" },
  { value: "REAL", label: "Reais" },
] as const;

const STATUS_FILTERS = [
  { value: "ALL", label: "Todos os status" },
  { value: "ABERTA", label: "Rascunhos" },
  { value: "CALCULADA", label: "Calculadas" },
  { value: "ENVIADA", label: "Enviadas" },
  { value: "ENVIADA_PARA_ANALISE", label: "Aguardando aprovação" },
  { value: "CONVERTIDA", label: "Convertidas" },
  { value: "CANCELADA", label: "Canceladas" },
] as const;

const SHORT_TIER: Record<PriceTier, string> = { TIER1: "T1", TIER2: "T2", TIER3: "T3" };

export default async function CotacoesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const session = await auth();
  const user = { id: session!.user.id, role: session!.user.role };
  const canSeeSeller = user.role !== "VENDEDOR" && user.role !== "REPRESENTANTE";
  const scope = await getCustomerScopeFilter(user);
  const filters = parseQuoteFilters(params);

  const where: Prisma.QuoteWhereInput = {
    deletedAt: null,
    customer: scope,
    ...buildQuoteFilterWhere(filters, { canFilterSeller: canSeeSeller }),
  };

  const visibleSellerIds = canSeeSeller ? await getVisibleSellerIds(user) : null;
  const [quotes, sellers] = await Promise.all([
    prisma.quote.findMany({
      where,
      select: {
        id: true, origin: true, brand: true, mode: true, priceGroup: true, status: true,
        totalValueCents: true, createdAt: true,
        customer: { select: { contactName: true, tradeName: true } },
        seller: { select: { name: true, role: true } },
        items: { select: { appliedTier: true, manualTier: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    canSeeSeller
      ? prisma.user.findMany({
          where: {
            deletedAt: null,
            role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] },
            ...(visibleSellerIds ? { id: { in: visibleSellerIds } } : {}),
          },
          select: { id: true, name: true, role: true, active: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const link = (overrides: Parameters<typeof quoteFiltersToQuery>[1]) => {
    const qs = quoteFiltersToQuery(filters, overrides);
    return qs ? `/cotacoes?${qs}` : "/cotacoes";
  };
  const advancedActive = !!(filters.origin || filters.priceGroup || filters.tier || filters.manual !== undefined || filters.from || filters.to || filters.sellerId);

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Propostas</h1>
        <Link href="/cotacoes/nova" className="btn-primary">Nova cotação</Link>
      </div>
      {user.role === "ADMIN" && <Link href="/cotacoes/excluidas" className="mb-3 inline-block text-sm underline">Histórico de simulações excluídas</Link>}
      <p className="mb-4 text-sm text-gray-500">
        Cotações feitas no CRM e simulações/cotações calculadas na Shopify aparecem aqui.
      </p>
      {filters.open && <div className="mb-4 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><span>Exibindo somente cotações em aberto.</span><Link className="font-medium underline" href="/cotacoes">Remover filtro</Link></div>}

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {BRAND_FILTERS.map((b) => (
          <Link key={b.value} href={link({ brand: b.value })} className={`rounded-full border px-3 py-1 ${(filters.brand ?? "ALL") === b.value ? (b.value === "MIBRO" ? "border-orange-500 bg-orange-500 text-white" : b.value === "SINCROFIT" ? "border-teal-600 bg-teal-600 text-white" : "border-slate-800 bg-slate-800 text-white") : "border-gray-200 text-gray-600"}`}>
            {b.label}
          </Link>
        ))}
        <span className="mx-1 text-gray-300">|</span>
        {MODE_FILTERS.map((m) => (
          <Link key={m.value} href={link({ mode: m.value })}
            className={`rounded-full border px-3 py-1 ${(filters.mode ?? "ALL") === m.value ? "border-brand-500 bg-brand-500 text-white" : "border-gray-200 text-gray-600"}`}>
            {m.label}
          </Link>
        ))}
        <span className="mx-1 text-gray-300">|</span>
        {STATUS_FILTERS.map((s) => (
          <Link key={s.value} href={link({ status: s.value })}
            className={`rounded-full border px-3 py-1 ${(filters.status ?? "ALL") === s.value ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 text-gray-600"}`}>
            {s.label}
          </Link>
        ))}
      </div>

      <details className="card mb-4 p-4" open={advancedActive}>
        <summary className="cursor-pointer text-sm font-medium text-gray-700">Filtros comerciais{advancedActive && " (ativos)"}</summary>
        <form method="get" className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {filters.brand && <input type="hidden" name="brand" value={filters.brand} />}
          {filters.mode && <input type="hidden" name="mode" value={filters.mode} />}
          {filters.status && <input type="hidden" name="status" value={filters.status} />}
          {canSeeSeller && (
            <label className="text-gray-600">Vendedor/representante
              <select name="sellerId" defaultValue={filters.sellerId ?? ""} className="input-field mt-1">
                <option value="">Todos</option>
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.role === "REPRESENTANTE" ? " (representante)" : ""}{s.active ? "" : " — inativo"}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-gray-600">Grupo comercial
            <select name="grupo" defaultValue={filters.priceGroup ?? ""} className="input-field mt-1">
              <option value="">Todos</option>
              <option value="STANDARD">Vendedores (STANDARD)</option>
              <option value="REPRESENTATIVE">Representantes (REPRESENTATIVE)</option>
            </select>
          </label>
          <label className="text-gray-600">Faixa aplicada
            <select name="faixa" defaultValue={filters.tier ?? ""} className="input-field mt-1">
              <option value="">Todas</option>
              <option value="TIER1">Tabela 1 (1–49)</option>
              <option value="TIER2">Tabela 2 (50–99)</option>
              <option value="TIER3">Tabela 3 (100+)</option>
            </select>
          </label>
          <label className="text-gray-600">Condição
            <select name="manual" defaultValue={filters.manual === undefined ? "" : filters.manual ? "1" : "0"} className="input-field mt-1">
              <option value="">Todas</option>
              <option value="1">Faixa manual</option>
              <option value="0">Faixa automática</option>
            </select>
          </label>
          <label className="text-gray-600">Origem
            <select name="origem" defaultValue={filters.origin ?? ""} className="input-field mt-1">
              <option value="">Todas</option>
              <option value="CRM">Calculadora do CRM</option>
              <option value="SHOPIFY">Shopify</option>
            </select>
          </label>
          <label className="text-gray-600">De
            <input type="date" name="de" defaultValue={filters.from ?? ""} className="input-field mt-1" />
          </label>
          <label className="text-gray-600">Até
            <input type="date" name="ate" defaultValue={filters.to ?? ""} className="input-field mt-1" />
          </label>
          <div className="flex items-end gap-2">
            <button className="btn-primary">Filtrar</button>
            <Link href="/cotacoes" className="btn-secondary">Limpar</Link>
          </div>
        </form>
        <p className="mt-2 text-[11px] text-gray-500">Grupo, faixa e condição existem nas cotações feitas pela calculadora do CRM.</p>
      </details>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2 font-medium">Cliente</th>
              {canSeeSeller && <th className="px-4 py-2 font-medium">Vendedor</th>}
              <th className="px-4 py-2 font-medium">Empresa</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
              <th className="px-4 py-2 font-medium">Condição</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Valor</th>
              <th className="px-4 py-2 font-medium">Criada em</th>
              {canSeeSeller && <th className="px-4 py-2 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {quotes.map((q) => {
              const tiers = [...new Set(q.items.map((i) => i.appliedTier))];
              const manual = q.items.some((i) => i.manualTier);
              return (
                <tr key={q.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/cotacoes/${q.id}`} className="underline">{q.customer.tradeName || q.customer.contactName}</Link>
                    {q.origin === "CRM" && <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">CRM</span>}
                  </td>
                  {canSeeSeller && (
                    <td className="px-4 py-3 text-gray-600">{q.seller.name}{q.seller.role === "REPRESENTANTE" && <span className="block text-[11px] text-gray-400">representante</span>}</td>
                  )}
                  <td className="px-4 py-3"><CommercialBrandBadge brand={q.brand} /></td>
                  <td className="px-4 py-3"><ProposalModeBadge mode={q.mode} /></td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {q.priceGroup ? (q.priceGroup === "REPRESENTATIVE" ? "Representante" : "Vendedor") : "—"}
                    {tiers.length > 0 && <> · {tiers.map((t) => SHORT_TIER[t]).join("/")}</>}
                    {manual && <span className="badge ml-1 bg-amber-100 text-amber-800">manual</span>}
                  </td>
                  <td className="px-4 py-3"><QuoteStatusBadge status={q.status} /></td>
                  <td className="px-4 py-3">{q.totalValueCents ? formatCentsToBRL(q.totalValueCents) : "-"}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDateTime(q.createdAt)}</td>
                  {canSeeSeller && <td className="px-4 py-3">{q.mode === "SIMULATION" && <QuoteTrashButton id={q.id} />}</td>}
                </tr>
              );
            })}
            {quotes.length === 0 && (
              <tr>
                <td colSpan={canSeeSeller ? 9 : 7} className="px-4 py-8 text-center text-gray-400">
                  Nenhuma proposta encontrada para este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
