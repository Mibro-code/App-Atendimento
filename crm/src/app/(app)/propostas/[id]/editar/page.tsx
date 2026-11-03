import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getSellerCatalog } from "@/lib/pricing/pricing";
import { contentOf } from "@/lib/proposals/proposal-access";
import { proposalView } from "@/lib/proposals/proposal-core";
import { ProposalEditForm } from "./proposal-edit-form";
import { proposalOriginId, withProposalOrigin } from "@/lib/proposal-origin";

export default async function EditProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ atendimento?: string }> }) {
  const { id } = await params;
  const originConversationId = proposalOriginId((await searchParams).atendimento);
  const session = await auth();
  const view = await proposalView({ id: session!.user.id, role: session!.user.role }, id).catch(() => null);
  if (!view) notFound();
  const { p, decisions } = view;
  if (!decisions.edit.allowed) {
    return (
      <div className="card max-w-xl space-y-3 p-6 text-sm">
        <p className="text-gray-700">{decisions.edit.reason}</p>
        <Link href={withProposalOrigin(`/propostas/${p.id}`,originConversationId)} className="btn-secondary inline-block">Voltar à proposta</Link>
      </div>
    );
  }
  // Catálogo e preços do grupo do responsável, na versão de tabela fixada da proposta.
  const catalog = await getSellerCatalog({ id: p.sellerId, role: p.seller.role }, p.sellerId, p.brand, { pinnedPriceTableId: p.quote.items[0]?.priceTableId ?? null });
  const content = contentOf(p);
  const options = catalog.products.flatMap((product) =>
    product.variants.map((v) => ({ sku: v.sku, label: `${product.name} — ${v.colorName}`, prices: product.prices }))
  );
  // SKUs já na proposta continuam selecionáveis mesmo que saiam do catálogo.
  for (const item of p.quote.items) {
    if (!options.some((o) => o.sku === item.sku)) options.push({ sku: item.sku, label: `${item.productName}${item.colorName ? ` — ${item.colorName}` : ""} (fora do catálogo)`, prices: {} });
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <p className="text-xs text-gray-500"><Link href={withProposalOrigin(`/propostas/${p.id}`,originConversationId)} className="underline">Voltar à proposta</Link></p>
        <h1 className="text-xl font-semibold text-gray-900">Editar proposta {p.olistProposalNumber ? `nº ${p.olistProposalNumber}` : ""} — nova versão {p.version + 1}</h1>
        <p className="text-sm text-gray-500">
          Alterar produtos, quantidades, preços, desconto, frete, pagamento, prazo ou validade invalida a aprovação e exige novo aceite. Tabela de preços versão {catalog.table?.version ?? "—"}.
        </p>
      </div>
      <ProposalEditForm
        originConversationId={originConversationId}
        proposalId={p.id}
        brand={p.brand}
        expectedVersion={p.version}
        options={options}
        initial={{
          items: content.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
          requestedTier: p.quote.selectedTier ?? "AUTO",
          discountCents: content.discountCents,
          freightCents: content.freightCents,
          freightResponsibility: content.freightResponsibility,
          paymentType: content.paymentType ?? "Nenhuma",
          paymentCondition: content.paymentCondition,
          paymentText: content.paymentText,
          validityDays: content.validityDays,
          deliveryTerm: content.deliveryTerm,
          customerNotes: content.customerNotes,
          internalNotes: p.internalNotes,
          discountJustification: p.discountJustification,
        }}
      />
    </div>
  );
}
