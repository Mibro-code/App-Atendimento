import Link from "next/link";
import { redirect } from "next/navigation";
import type { PriceTier } from "@prisma/client";
import { auth } from "@/auth";
import { formatCentsToBRL, formatDateBR } from "@/lib/format";
import { getSellerCatalog } from "@/lib/pricing/pricing";

const TIERS: Array<[PriceTier, string, string]> = [
  ["TIER1", "Tabela 1", "1 a 49 un."],
  ["TIER2", "Tabela 2", "50 a 99 un."],
  ["TIER3", "Tabela 3", "100+ un."],
];

const BRANDS = [
  { key: "MIBRO", label: "Mibro", tab: "border-orange-500 text-orange-700", button: "btn-brand-mibro", ring: "ring-orange-200" },
  { key: "SINCROFIT", label: "Sincrofit", tab: "border-teal-600 text-teal-700", button: "btn-brand-sincrofit", ring: "ring-teal-200" },
] as const;

// Consulta somente leitura da tabela exclusiva do representante. Os preços
// vêm do banco (versão vigente do grupo REPRESENTATIVE); a edição é feita na
// Gestão Comercial por administradores.
export default async function MinhaTabelaPage({ searchParams }: { searchParams: Promise<{ marca?: string }> }) {
  const session = await auth();
  // Guarda na própria página: o layout não impede a renderização em paralelo.
  if (!session?.user || session.user.role !== "REPRESENTANTE") redirect("/dashboard");
  const user = { id: session.user.id, role: session.user.role };

  const brand = (await searchParams).marca === "sincrofit" ? "SINCROFIT" : "MIBRO";
  const brandInfo = BRANDS.find((b) => b.key === brand)!;
  const catalog = await getSellerCatalog(user, user.id, brand);
  const updatedAt = catalog.table?.publishedAt ?? catalog.table?.effectiveFrom ?? null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-xl font-semibold text-gray-900">Minha tabela de preços</h1>
          <p className="text-sm text-gray-500">
            Tabela exclusiva de representantes · sem pedido mínimo
            {updatedAt && <> · atualizada em {formatDateBR(updatedAt)}</>}
          </p>
        </div>
        <Link href={`/cotacoes/nova?marca=${brand.toLowerCase()}`} className={brandInfo.button}>
          Iniciar cotação {brandInfo.label}
        </Link>
      </div>

      <nav className="mb-6 flex gap-2" aria-label="Marca">
        {BRANDS.map((b) => (
          <Link key={b.key} href={`/tabela-precos?marca=${b.key.toLowerCase()}`}
            className={`rounded-md border-b-2 px-3 py-2 text-sm font-medium ${b.key === brand ? b.tab : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            {b.label}
          </Link>
        ))}
      </nav>

      {!catalog.table && (
        <div className="card p-6 text-sm text-gray-600">A tabela {brandInfo.label} ainda não foi publicada. Fale com a administração comercial.</div>
      )}

      {catalog.table && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {catalog.products.map((p) => (
            <article key={p.id} className="card flex flex-col p-4">
              <div className="mb-3 flex items-start gap-3">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt={p.name} className={`h-16 w-16 rounded-md object-cover ring-1 ${brandInfo.ring}`} />
                ) : (
                  <div className={`flex h-16 w-16 items-center justify-center rounded-md bg-gray-50 text-xs font-semibold text-gray-400 ring-1 ${brandInfo.ring}`}>
                    {p.name.replace(/^Mibro /, "").slice(0, 8)}
                  </div>
                )}
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">{p.name}</h2>
                  <p className="text-xs text-gray-500">{p.category}</p>
                  <p className="mt-1 text-xs text-gray-600">{p.variants.map((v) => v.colorName).join(" · ")}</p>
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-center">
                {TIERS.map(([tier, label, range]) => (
                  <div key={tier} className="rounded-md bg-gray-50 px-2 py-2">
                    <dt className="text-[11px] text-gray-500">{label}<span className="block">{range}</span></dt>
                    <dd className="mt-1 text-sm font-semibold text-gray-900">
                      {p.prices[tier] ? formatCentsToBRL(p.prices[tier]) : <span className="text-xs font-normal text-gray-400">sob consulta</span>}
                    </dd>
                  </div>
                ))}
              </dl>
              <details className="mt-3 text-xs text-gray-500">
                <summary className="cursor-pointer">SKUs</summary>
                <ul className="mt-1 space-y-0.5 font-mono">
                  {p.variants.map((v) => <li key={v.id}>{v.sku} — {v.colorName}</li>)}
                </ul>
              </details>
            </article>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-gray-500">
        A faixa é escolhida automaticamente pela quantidade do pedido e pode ser ajustada manualmente na cotação.
        Disponibilidade de estoque é confirmada no momento do pedido.
      </p>
    </div>
  );
}
