import Link from "next/link";
import { redirect } from "next/navigation";
import type { PriceTier } from "@prisma/client";
import { auth } from "@/auth";
import { formatCentsToBRL, formatDateTimeBR } from "@/lib/format";
import { canManagePriceTables, canViewPriceTables, diffEntries, percentDiff } from "@/lib/pricing/price-admin-rules";
import { getBrandPriceOverview, tierPricesOf, type PriceTableSummary } from "@/lib/pricing/price-admin";
import { CancelScheduledButton, GROUP_LABELS, PriceDraftEditor } from "./price-draft-editor";
import { ProductAdminList } from "./product-admin-list";

const TIERS: Array<[PriceTier, string]> = [["TIER1", "1–49"], ["TIER2", "50–99"], ["TIER3", "100+"]];
const BRANDS = [
  { key: "MIBRO", label: "Mibro", accent: "border-orange-500 text-orange-700", dot: "bg-orange-500" },
  { key: "SINCROFIT", label: "Sincrofit", accent: "border-teal-600 text-teal-700", dot: "bg-teal-600" },
] as const;

const STATUS_LABEL: Record<string, string> = { DRAFT: "Rascunho", PUBLISHED: "Publicada", ARCHIVED: "Arquivada" };

function money(cents: number | undefined) {
  return cents ? formatCentsToBRL(cents) : <span className="text-gray-400">—</span>;
}

export default async function PrecosPage({ searchParams }: { searchParams: Promise<{ marca?: string }> }) {
  const session = await auth();
  // Guarda na própria página (antes de qualquer consulta): o redirect do
  // layout não impede a página de renderizar em paralelo.
  if (!session?.user || !canViewPriceTables(session.user.role)) redirect("/dashboard");
  const user = { id: session.user.id, role: session.user.role };
  const canManage = canManagePriceTables(user.role);
  const brand = (await searchParams).marca === "sincrofit" ? "SINCROFIT" : "MIBRO";
  const brandInfo = BRANDS.find((b) => b.key === brand)!;

  const now = new Date();
  const { products, groups } = await getBrandPriceOverview(brand, now);
  const standard = groups.find((g) => g.priceGroup === "STANDARD")!;
  const representative = groups.find((g) => g.priceGroup === "REPRESENTATIVE")!;
  const stdPrices = tierPricesOf(standard.effective);
  const repPrices = tierPricesOf(representative.effective);
  const productNames = new Map(products.map((p) => [p.id, p.name]));

  function versionLine(table: PriceTableSummary | null) {
    if (!table) return <span className="text-red-600">Sem tabela publicada</span>;
    return <>v{table.version} · vigente desde {formatDateTimeBR(table.effectiveFrom)}</>;
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Gestão comercial — tabelas de preço</h1>
      <p className="mb-5 text-sm text-gray-500">
        Preços de atacado por marca e grupo comercial. Vendedores usam STANDARD; representantes usam REPRESENTATIVE.
        {!canManage && " Consulta somente leitura: a edição é exclusiva de administradores."}
      </p>

      <nav className="mb-6 flex gap-2" aria-label="Marca">
        {BRANDS.map((b) => (
          <Link key={b.key} href={`/gestao-comercial/precos?marca=${b.key.toLowerCase()}`}
            className={`flex items-center gap-2 rounded-md border-b-2 px-3 py-2 text-sm font-medium ${b.key === brand ? b.accent : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            <span className={`h-2 w-2 rounded-full ${b.dot}`} />{b.label}
          </Link>
        ))}
      </nav>

      {/* Comparação das versões vigentes */}
      <section className="card mb-6 overflow-hidden">
        <div className="border-b border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-800">Preços vigentes — {brandInfo.label}</h2>
          <p className="mt-1 text-xs text-gray-500">
            STANDARD: {versionLine(standard.effective)} · REPRESENTATIVE: {versionLine(representative.effective)}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-600">
              <tr>
                <th rowSpan={2} className="px-3 py-2 font-medium">Produto</th>
                <th colSpan={3} className="border-l border-gray-200 px-3 pt-2 font-medium">Vendedores (STANDARD)</th>
                <th colSpan={3} className="border-l border-gray-200 px-3 pt-2 font-medium">Representantes</th>
                <th colSpan={3} className="border-l border-gray-200 px-3 pt-2 font-medium">Diferença</th>
              </tr>
              <tr>
                {[0, 1, 2].flatMap((g) => TIERS.map(([tier, label], i) => (
                  <th key={`${g}-${tier}`} className={`px-3 pb-2 font-normal ${i === 0 ? "border-l border-gray-200" : ""}`}>{label}</th>
                )))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {products.map((p) => (
                <tr key={p.id} className={p.active ? "" : "text-gray-400"}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{p.name}</span>
                    {!p.active && <span className="badge ml-2 bg-gray-200 text-gray-600">Inativo</span>}
                    <span className="block text-xs text-gray-500">{p.variants.map((v) => v.colorName).join(" · ")}</span>
                  </td>
                  {TIERS.map(([tier], i) => <td key={`s-${tier}`} className={`px-3 py-2 ${i === 0 ? "border-l border-gray-100" : ""}`}>{money(stdPrices.get(p.id)?.[tier])}</td>)}
                  {TIERS.map(([tier], i) => <td key={`r-${tier}`} className={`px-3 py-2 ${i === 0 ? "border-l border-gray-100" : ""}`}>{money(repPrices.get(p.id)?.[tier])}</td>)}
                  {TIERS.map(([tier], i) => {
                    const pct = percentDiff(stdPrices.get(p.id)?.[tier], repPrices.get(p.id)?.[tier]);
                    return (
                      <td key={`d-${tier}`} className={`px-3 py-2 text-xs ${i === 0 ? "border-l border-gray-100" : ""}`}>
                        {pct === null ? <span className="text-gray-400">—</span> : <span className={pct > 0 ? "text-amber-700" : pct < 0 ? "text-green-700" : "text-gray-600"}>{pct > 0 ? "+" : ""}{pct.toLocaleString("pt-BR")}%</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="p-3 text-xs text-gray-500">Diferença = preço do representante em relação ao STANDARD. “—” = faixa sem preço configurado (indisponível na cotação).</p>
      </section>

      {/* Edição por grupo */}
      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {groups.map((g) => (
          <section key={g.priceGroup} className="card space-y-3 p-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">{GROUP_LABELS[g.priceGroup]}</h2>
              <p className="text-xs text-gray-500">{versionLine(g.effective)}</p>
            </div>
            {g.scheduled.length > 0 && (
              <ul className="space-y-1 rounded-md bg-blue-50 p-3 text-xs text-blue-900">
                {g.scheduled.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                    Versão {t.version} agendada para {formatDateTimeBR(t.effectiveFrom)} — {t.changeReason}
                    {canManage && <CancelScheduledButton tableId={t.id} />}
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <PriceDraftEditor
                key={g.draft?.id ?? "none"}
                brand={brand}
                priceGroup={g.priceGroup}
                draft={g.draft ? { id: g.draft.id, version: g.draft.version, entries: g.draft.entries } : null}
                currentPrices={Object.fromEntries(tierPricesOf(g.effective))}
                products={products.map((p) => ({ id: p.id, name: p.name, active: p.active }))}
              />
            )}
          </section>
        ))}
      </div>

      {canManage && (
        <section className="card mb-6 p-4">
          <h2 className="text-sm font-semibold text-gray-800">Produtos e cores — {brandInfo.label}</h2>
          <p className="mb-2 text-xs text-gray-500">Produto ou cor inativo deixa de aparecer na cotação. SKU é a chave do Olist e não é editável.</p>
          <ProductAdminList products={products.map((p) => ({ id: p.id, name: p.name, category: p.category, imageUrl: p.imageUrl, active: p.active, variants: p.variants }))} />
        </section>
      )}

      {/* Histórico de versões */}
      <section className="card p-4">
        <h2 className="text-sm font-semibold text-gray-800">Histórico de preços — {brandInfo.label}</h2>
        <p className="mb-3 text-xs text-gray-500">Versões anteriores ficam preservadas. Propostas usam sempre o preço gravado no momento do cálculo.</p>
        {groups.map((g) => {
          const published = g.history.filter((t) => t.status !== "DRAFT");
          return (
            <div key={g.priceGroup} className="mb-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{GROUP_LABELS[g.priceGroup]}</h3>
              {published.length === 0 && <p className="text-xs text-gray-500">Nenhuma versão publicada.</p>}
              <ul className="divide-y divide-gray-100">
                {published.map((t) => {
                  const previous = published
                    .filter((x) => x.status === "PUBLISHED" && x.effectiveFrom.getTime() < t.effectiveFrom.getTime())
                    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
                  const changes = diffEntries(previous?.entries ?? [], t.entries);
                  const prices = tierPricesOf(t);
                  const isCurrent = g.effective?.id === t.id;
                  return (
                    <li key={t.id} className="py-2">
                      <details>
                        <summary className="cursor-pointer text-sm text-gray-800">
                          <span className="font-medium">Versão {t.version}</span>
                          {isCurrent && <span className="badge ml-2 bg-green-100 text-green-800">Vigente</span>}
                          {t.status === "ARCHIVED" && <span className="badge ml-2 bg-gray-200 text-gray-600">{STATUS_LABEL.ARCHIVED}</span>}
                          <span className="ml-2 text-xs text-gray-500">
                            {t.status === "PUBLISHED" ? `vigência ${formatDateTimeBR(t.effectiveFrom)}` : "não publicada"}
                            {t.publishedBy && ` · por ${t.publishedBy.name} em ${formatDateTimeBR(t.publishedAt)}`}
                            {` · usada em ${t._count.quoteItems} item(ns) de proposta`}
                          </span>
                        </summary>
                        <div className="mt-2 space-y-2 pl-3 text-xs text-gray-600">
                          {t.changeReason && <p><span className="font-medium">Motivo:</span> {t.changeReason}</p>}
                          {previous && changes.length > 0 && (
                            <ul className="list-disc pl-5">
                              {changes.map((c) => (
                                <li key={`${c.productId}-${c.tier}`}>
                                  {productNames.get(c.productId)} {c.tier}: {c.before ? formatCentsToBRL(c.before) : "sem preço"} → {c.after ? formatCentsToBRL(c.after) : "sem preço"}
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="overflow-x-auto">
                            <table className="min-w-[420px] text-xs">
                              <thead><tr className="text-left text-gray-500"><th className="pr-4 font-medium">Produto</th>{TIERS.map(([tier, l]) => <th key={tier} className="pr-4 font-medium">{l}</th>)}</tr></thead>
                              <tbody>
                                {products.map((p) => (
                                  <tr key={p.id}><td className="pr-4">{p.name}</td>{TIERS.map(([tier]) => <td key={tier} className="pr-4">{money(prices.get(p.id)?.[tier])}</td>)}</tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}
