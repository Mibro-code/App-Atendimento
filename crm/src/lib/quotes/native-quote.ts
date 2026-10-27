import "server-only";
import { Prisma, type CommercialBrand, type PriceTier, type QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { notifySupervisorOfQuote } from "@/lib/quotes/quote-alerts";
import { moveCustomerStage } from "@/lib/pipeline";
import { canAccessCustomer, type SessionUser } from "@/lib/authz";
import { PricingError } from "@/lib/pricing/pricing-rules";
import { resolvePriceGroupForSeller, resolveWholesalePrice, type ResolvedWholesalePrice } from "@/lib/pricing/pricing";
import {
  buildProductsSummary,
  isEditableNativeQuote,
  itemsFromQuantities,
  nextNativeQuoteStatus,
  type NativeDraftState,
} from "@/lib/quotes/native-quote-rules";

// Cotação nativa do CRM (origin=CRM). Toda gravação reprecifica no servidor:
// o navegador manda só SKU + quantidade + faixa desejada + desconto; preços,
// grupo comercial e tabela vêm do banco. QuoteItem guarda o snapshot.

export interface SaveNativeQuoteInput {
  quoteId?: string | null;
  customerId: string;
  brand: CommercialBrand;
  draft: NativeDraftState;
  discountCents: number;
  couponCode?: string | null;
  notes?: string | null;
  finalize?: boolean;
  /** Reprecificar com a tabela vigente em vez da versão fixada na proposta. */
  useCurrentTable?: boolean;
}

export interface SaveNativeQuoteResult {
  quote: { id: string; status: QuoteStatus; updatedAt: string };
  pricing: ResolvedWholesalePrice | null;
  pricingError: { code: string; message: string; details?: unknown } | null;
}

export async function loadEditableNativeQuote(actor: SessionUser, quoteId: string) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      customer: { select: { id: true, sellerId: true, contactName: true, tradeName: true, cnpjDigits: true, cpfDigits: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!quote) throw new PricingError("Proposta não encontrada.", "NOT_FOUND");
  if (!(await canAccessCustomer(actor, quote.customer.sellerId))) {
    throw new PricingError("Você não tem acesso a esta proposta.", "FORBIDDEN");
  }
  return quote;
}

export async function saveNativeQuote(actor: SessionUser, input: SaveNativeQuoteInput): Promise<SaveNativeQuoteResult> {
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, sellerId: true, pipelineStage: true },
  });
  if (!customer) throw new PricingError("Cliente não encontrado.", "NOT_FOUND");
  if (!(await canAccessCustomer(actor, customer.sellerId))) {
    throw new PricingError("Você não tem acesso a este cliente.", "FORBIDDEN");
  }

  const existing = input.quoteId ? await loadEditableNativeQuote(actor, input.quoteId) : null;
  if (existing && !isEditableNativeQuote(existing)) {
    throw new PricingError("Esta proposta não pode mais ser editada.", "NOT_EDITABLE");
  }

  // Grupo comercial do responsável pelo cliente (também valida o acesso ao vendedor).
  const { priceGroup } = await resolvePriceGroupForSeller(actor, customer.sellerId);
  const requestedTier: PriceTier | null = input.draft.requestedTier === "AUTO" ? null : input.draft.requestedTier;
  const items = itemsFromQuantities(input.draft.quantities);
  const pinnedPriceTableId = existing && !input.useCurrentTable ? existing.items[0]?.priceTableId ?? null : null;

  let pricing: ResolvedWholesalePrice | null = null;
  let pricingError: SaveNativeQuoteResult["pricingError"] = null;
  if (items.length > 0) {
    try {
      pricing = await resolveWholesalePrice({
        actor,
        sellerId: customer.sellerId,
        brand: input.brand,
        items,
        requestedTier,
        discountCents: input.discountCents,
        quoteId: existing?.id ?? null,
        pinnedPriceTableId,
      });
    } catch (error) {
      if (!(error instanceof PricingError) || error.code === "SELLER_FORBIDDEN") throw error;
      pricingError = { code: error.code, message: error.message, details: error.details };
    }
  }

  if (input.finalize && !pricing) {
    throw new PricingError(
      pricingError?.message ?? "Adicione ao menos um produto antes de concluir.",
      pricingError?.code ?? "QUOTE_INCOMPLETE",
      pricingError?.details as Record<string, unknown> | undefined
    );
  }

  const status = nextNativeQuoteStatus({ previous: existing?.status ?? null, finalize: !!input.finalize, pricingValid: !!pricing });

  const seller = await prisma.user.findUniqueOrThrow({
    where: { id: customer.sellerId },
    select: { name: true, email: true, sellerProfile: true },
  });

  const data = {
    customerId: customer.id,
    sellerId: customer.sellerId,
    brand: input.brand,
    origin: "CRM" as const,
    mode: "SIMULATION" as const,
    status,
    priceGroup,
    quantityRule: pricing?.quantityRule ?? "MIX",
    selectedTier: requestedTier,
    subtotalCents: pricing?.subtotalCents ?? null,
    discountCents: pricing ? pricing.discountCents : input.discountCents || null,
    totalValueCents: pricing?.totalCents ?? null,
    couponCode: input.couponCode?.trim() || null,
    notes: input.notes?.trim() || null,
    draftState: input.draft as unknown as Prisma.InputJsonValue,
    productsSummary: pricing
      ? (buildProductsSummary(pricing.lines, {
          priceGroup: pricing.priceGroup,
          priceTableVersion: pricing.priceTableVersion,
          selectedTier: requestedTier,
        }) as Prisma.InputJsonValue)
      : Prisma.DbNull,
    sellerNameSnapshot: seller.sellerProfile?.displayName ?? seller.name,
    sellerEmailSnapshot: seller.sellerProfile?.commercialEmail ?? seller.email,
    sellerPhoneSnapshot: seller.sellerProfile?.commercialPhone ?? seller.sellerProfile?.phone ?? null,
    sellerJobTitleSnapshot: seller.sellerProfile?.jobTitle ?? null,
  } satisfies Prisma.QuoteUncheckedCreateInput;

  const saved = await prisma.$transaction(async (tx) => {
    if (existing) {
      // Revalida dentro da transação: outra aba pode ter concluído/cancelado.
      const fresh = await tx.quote.findUnique({ where: { id: existing.id }, select: { status: true, deletedAt: true, origin: true, mode: true } });
      if (!fresh || !isEditableNativeQuote(fresh)) throw new PricingError("Esta proposta não pode mais ser editada.", "NOT_EDITABLE");
    }
    const quote = existing
      ? await tx.quote.update({ where: { id: existing.id }, data })
      : await tx.quote.create({ data });

    await tx.quoteItem.deleteMany({ where: { quoteId: quote.id } });
    if (pricing) {
      await tx.quoteItem.createMany({
        data: pricing.lines.map((l, index) => ({
          quoteId: quote.id,
          productId: l.productId,
          variantId: l.variantId ?? null,
          sku: l.sku,
          productName: l.productName,
          colorName: l.colorName ?? null,
          quantity: l.quantity,
          priceGroup: pricing!.priceGroup,
          priceTableId: pricing!.priceTableId,
          priceTableVersion: pricing!.priceTableVersion,
          automaticTier: l.automaticTier,
          appliedTier: l.appliedTier,
          manualTier: l.manualTier,
          unitPriceCents: l.unitPriceCents,
          lineSubtotalCents: l.lineSubtotalCents,
          lineDiscountCents: l.lineDiscountCents,
          sortOrder: index,
        })),
      });
    }
    if (input.finalize) {
      await tx.customer.update({ where: { id: customer.id }, data: { lastInteractionAt: new Date() } });
    }
    return quote;
  });

  if (!existing) {
    await logAudit({
      actorId: actor.id, action: "QUOTE_CREATED", entityType: "Quote", entityId: saved.id,
      metadata: { origin: "CRM", brand: input.brand, priceGroup, customerId: customer.id, sellerId: customer.sellerId },
    });
  }
  if (input.finalize && pricing) {
    await logAudit({
      actorId: actor.id, action: "QUOTE_CALCULATED", entityType: "Quote", entityId: saved.id,
      metadata: {
        origin: "CRM", brand: input.brand, priceGroup: pricing.priceGroup,
        priceTableId: pricing.priceTableId, priceTableVersion: pricing.priceTableVersion,
        selectedTier: requestedTier, orderAutomaticTier: pricing.orderAutomaticTier,
        subtotalCents: pricing.subtotalCents, discountCents: pricing.discountCents, totalCents: pricing.totalCents,
      },
    });
  }

  if (input.finalize && pricing) {
    await notifySupervisorOfQuote(saved.id, actor.id);
    // Mesma regra da sincronização Shopify: cotação ativa leva o cliente à etapa Cotação.
    if (["NOVO", "EM_ATENDIMENTO", "FOLLOW_UP"].includes(customer.pipelineStage)) {
      await moveCustomerStage(customer.sellerId, customer.id, "COTACAO", { reason: "cotação concluída no CRM", automatic: true });
    }
  }

  return {
    quote: { id: saved.id, status: saved.status, updatedAt: saved.updatedAt.toISOString() },
    pricing,
    pricingError,
  };
}
