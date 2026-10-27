import { redirect } from "next/navigation";
import type { CommercialBrand } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessCustomer } from "@/lib/authz";
import { formatCnpjOrCpf } from "@/lib/format";
import { PricingError } from "@/lib/pricing/pricing-rules";
import { loadEditableNativeQuote } from "@/lib/quotes/native-quote";
import { centsToReaisInput } from "@/lib/pricing/price-admin-rules";
import { isEditableNativeQuote, type NativeDraftState } from "@/lib/quotes/native-quote-rules";
import { QuoteBuilder, type QuoteBuilderInitial } from "./quote-builder";

function customerOption(c: { id: string; contactName: string; tradeName: string | null; cnpjDigits: string | null; cpfDigits: string | null }) {
  return {
    id: c.id,
    name: c.tradeName || c.contactName,
    detail: [c.tradeName && c.tradeName !== c.contactName ? c.contactName : null, formatCnpjOrCpf(c.cnpjDigits || c.cpfDigits) || null]
      .filter(Boolean)
      .join(" · "),
  };
}

export default async function NovaCotacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; cliente?: string; marca?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = { id: session.user.id, role: session.user.role };
  const { id, cliente, marca } = await searchParams;

  let initial: QuoteBuilderInitial = {
    quoteId: null,
    status: null,
    customer: null,
    brand: marca === "sincrofit" ? "SINCROFIT" : marca === "mibro" ? "MIBRO" : null,
    draft: { step: 0, quantities: {}, requestedTier: "AUTO" },
    discountText: "",
    couponCode: "",
    notes: "",
  };

  if (id) {
    let quote;
    try {
      quote = await loadEditableNativeQuote(user, id);
    } catch (error) {
      if (error instanceof PricingError) redirect("/cotacoes");
      throw error;
    }
    if (!isEditableNativeQuote(quote)) redirect(`/cotacoes/${quote.id}`);
    const draft = (quote.draftState ?? {}) as Partial<NativeDraftState>;
    initial = {
      quoteId: quote.id,
      status: quote.status,
      customer: customerOption(quote.customer),
      brand: quote.brand as CommercialBrand,
      draft: {
        step: typeof draft.step === "number" ? draft.step : 2,
        quantities: draft.quantities ?? Object.fromEntries(quote.items.map((i) => [i.sku, i.quantity])),
        requestedTier: draft.requestedTier ?? quote.selectedTier ?? "AUTO",
      },
      discountText: quote.discountCents ? centsToReaisInput(quote.discountCents) : "",
      couponCode: quote.couponCode ?? "",
      notes: quote.notes ?? "",
    };
  } else if (cliente) {
    const customer = await prisma.customer.findUnique({
      where: { id: cliente },
      select: { id: true, contactName: true, tradeName: true, cnpjDigits: true, cpfDigits: true, sellerId: true },
    });
    if (customer && (await canAccessCustomer(user, customer.sellerId))) {
      initial = { ...initial, customer: customerOption(customer), draft: { ...initial.draft, step: initial.brand ? 2 : 1 } };
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">{initial.quoteId ? "Continuar cotação" : "Nova cotação"}</h1>
      <p className="mb-5 text-sm text-gray-500">
        Os preços vêm da tabela do vendedor responsável pelo cliente. O rascunho é salvo automaticamente.
      </p>
      <QuoteBuilder initial={initial} />
    </div>
  );
}
