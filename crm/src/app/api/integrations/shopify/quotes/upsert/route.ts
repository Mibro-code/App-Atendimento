import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireShopifyBrand } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { notifySupervisorOfQuote } from "@/lib/quotes/quote-alerts";
import { prisma } from "@/lib/prisma";
import {
  quoteStatusForSync,
  shopifyQuoteSyncSchema,
} from "@/lib/shopify-quote-sync";
import { buildLocationCaptureData } from "@/lib/location";
import { syncAutomaticFollowUpsForSellerIds } from "@/lib/automatic-followups";
import { isApprovedOlistStatus, syncOlistOrderStatus } from "@/lib/olist-order-status";
import { moveCustomerStage } from "@/lib/pipeline";

// Cotação ativa leva o cliente para a coluna Cotação, a partir das etapas de
// oportunidade. Reciclagem/Inativos/Vendidos não são movidos por sincronização.
const STAGES_THAT_ENTER_QUOTE = ["NOVO", "EM_ATENDIMENTO", "FOLLOW_UP"];
const ACTIVE_QUOTE_STATUSES = ["CALCULADA", "ENVIADA", "ENVIADA_PARA_ANALISE"];

export async function POST(req: NextRequest) {
  const auth = requireShopifyBrand(req);
  if (!auth.ok) return auth.error;
  const brand = auth.brand;

  const body = await req.json().catch(() => null);
  const parsed = shopifyQuoteSyncSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        code: "INVALID_BODY",
        message: "Dados da cotação inválidos.",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
    include: {
      seller: {
        select: { name: true, email: true, sellerProfile: true },
      },
    },
  });

  if (!customer) {
    return NextResponse.json(
      { success: false, code: "CUSTOMER_NOT_FOUND", message: "Cliente do CRM não encontrado." },
      { status: 404 }
    );
  }
  if (customer.sellerId !== data.sellerId) {
    return NextResponse.json(
      {
        success: false,
        code: "SELLER_MISMATCH",
        message: "O vendedor informado não é o responsável atual pelo cliente.",
      },
      { status: 409 }
    );
  }

  const existingQuote = await prisma.quote.findUnique({
    where: { brand_shopifyQuoteToken: { brand, shopifyQuoteToken: data.quoteToken } },
  });
  if (existingQuote?.deletedAt) {
    return NextResponse.json({ success: false, code: "QUOTE_DELETED", message: "Esta simulação foi excluída. Somente Admin/Master pode restaurá-la em até 7 dias." }, { status: 409 });
  }
  if (
    existingQuote &&
    (existingQuote.customerId !== data.customerId || existingQuote.sellerId !== data.sellerId)
  ) {
    return NextResponse.json(
      {
        success: false,
        code: "QUOTE_IDENTITY_MISMATCH",
        message: "O token da cotação já pertence a outro cliente ou vendedor.",
      },
      { status: 409 }
    );
  }

  // Uma simulação NUNCA gera pedido no Olist — mesmo que, por engano ou bug
  // no app Shopify, o payload traga um `olistOrder`, o CRM ignora esse bloco
  // e nunca cria/atualiza OlistOrder para mode = SIMULATION. Isso é
  // verificação de defesa em profundidade: a decisão "correta" já deveria
  // ter sido tomada no app Shopify a partir do mode devolvido por
  // /api/integrations/shopify/session/resolve.
  const ignoredOlistOrderForSimulation = data.mode === "SIMULATION" && !!data.olistOrder;

  let sourceQuote: { id: string; customerId: string; mode: string; brand: string } | null = null;
  if (data.sourceQuoteId) {
    sourceQuote = await prisma.quote.findUnique({
      where: { id: data.sourceQuoteId, deletedAt: null },
      select: { id: true, customerId: true, mode: true, brand: true },
    });
    // sourceQuoteId só é aceito se apontar para uma simulação do MESMO
    // cliente — nunca aceitar vínculo cruzado de cliente/vendedor.
    if (!sourceQuote || sourceQuote.customerId !== data.customerId || sourceQuote.mode !== "SIMULATION" || sourceQuote.brand !== brand) {
      return NextResponse.json(
        {
          success: false,
          code: "SOURCE_QUOTE_INVALID",
          message: "Proposta de origem (sourceQuoteId) inválida para este cliente.",
        },
        { status: 409 }
      );
    }
  }

  if (data.olistOrder && !ignoredOlistOrderForSimulation) {
    const [byQuote, byExternalId] = await Promise.all([
      existingQuote
        ? prisma.olistOrder.findUnique({ where: { quoteId: existingQuote.id } })
        : Promise.resolve(null),
      prisma.olistOrder.findUnique({
        where: { brand_olistOrderId: { brand, olistOrderId: data.olistOrder.id } },
      }),
    ]);
    if (
      (byQuote && byQuote.olistOrderId !== data.olistOrder.id) ||
      (byExternalId && (!existingQuote || byExternalId.quoteId !== existingQuote.id))
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "OLIST_ORDER_MISMATCH",
          message: "O pedido Olist já está associado a outra cotação.",
        },
        { status: 409 }
      );
    }
  }

  const status = quoteStatusForSync(existingQuote?.status ?? null, data.event);
  const productsSummary = {
    products: data.products,
    totalQuantity: data.totalQuantity,
    shop: data.shop ?? null,
  } satisfies Prisma.InputJsonValue;

  const synced = await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customer.id },
      data: { lastInteractionAt: new Date() },
    });
    const quote = existingQuote
      ? await tx.quote.update({
          where: { id: existingQuote.id, deletedAt: null },
          data: {
            status,
            totalValueCents: data.valueCents,
            discountCents: data.discountCents ?? existingQuote.discountCents,
            couponCode: data.couponCode ?? existingQuote.couponCode,
            notes: data.notes ?? existingQuote.notes,
            productsSummary,
            ...(data.event === "SENT"
              ? { sentAt: new Date(), sentToEmail: data.sentToEmail ?? existingQuote.sentToEmail }
              : {}),
          },
        })
      : await tx.quote.create({
          data: {
            customerId: customer.id,
            sellerId: customer.sellerId,
            brand,
            shopifyQuoteToken: data.quoteToken,
            mode: data.mode,
            status,
            totalValueCents: data.valueCents,
            discountCents: data.discountCents ?? null,
            couponCode: data.couponCode ?? null,
            notes: data.notes ?? null,
            productsSummary,
            sourceQuoteId: sourceQuote?.id ?? null,
            ...(data.event === "SENT"
              ? { sentAt: new Date(), sentToEmail: data.sentToEmail ?? null }
              : {}),
            sellerNameSnapshot:
              customer.seller.sellerProfile?.displayName ?? customer.seller.name,
            sellerEmailSnapshot:
              customer.seller.sellerProfile?.commercialEmail ?? customer.seller.email,
            sellerPhoneSnapshot:
              customer.seller.sellerProfile?.commercialPhone ??
              customer.seller.sellerProfile?.phone ??
              null,
            sellerJobTitleSnapshot: customer.seller.sellerProfile?.jobTitle ?? null,
          },
        });

    // Só a criação (não recálculos seguintes) marca a simulação de origem
    // como convertida — preserva o histórico da simulação original intacto.
    if (!existingQuote && sourceQuote) {
      await tx.quote.update({
        where: { id: sourceQuote.id, deletedAt: null },
        data: { status: "CONVERTIDA", convertedAt: new Date() },
      });
    }

    let olistOrder = null;
    if (data.olistOrder && !ignoredOlistOrderForSimulation) {
      const now = new Date();
      olistOrder = await tx.olistOrder.upsert({
        where: { brand_olistOrderId: { brand, olistOrderId: data.olistOrder.id } },
        create: {
          brand,
          customerId: customer.id,
          quoteId: quote.id,
          olistOrderId: data.olistOrder.id,
          orderNumber: data.olistOrder.number || null,
          valueCents: data.valueCents,
          olistStatusRaw: data.olistOrder.statusRaw || null,
          crmStatus:
            data.event === "READY_FOR_REVIEW" ? "AGUARDANDO_APROVACAO" : "PEDIDO_CRIADO",
          lastSyncedAt: now,
        },
        update: {
          customerId: customer.id,
          quoteId: quote.id,
          orderNumber: data.olistOrder.number || null,
          valueCents: data.valueCents,
          olistStatusRaw: data.olistOrder.statusRaw || null,
          crmStatus:
            data.event === "READY_FOR_REVIEW" ? "AGUARDANDO_APROVACAO" : "PEDIDO_CRIADO",
          lastSyncedAt: now,
        },
      });
    }

    // Localização da proposta (item 10): sellerId/customerId vêm do
    // `customer` já resolvido e validado acima (nunca do payload de
    // `location` em si, que só carrega dado geográfico) — quoteId sempre é
    // o da Quote real desta requisição. Upsert pela constraint
    // (quoteId, locationSource) torna reenvios idempotentes: um recálculo
    // após o envio não duplica nem apaga a localização já capturada no
    // envio original.
    let locationCapture = null;
    if (data.location) {
      locationCapture = await tx.locationCapture.upsert({
        where: { quoteId_locationSource: { quoteId: quote.id, locationSource: "PROPOSAL_SENT" } },
        create: buildLocationCaptureData({
          location: data.location, sellerId: customer.sellerId, customerId: customer.id,
          quoteId: quote.id, locationSource: "PROPOSAL_SENT",
        }),
        update: buildLocationCaptureData({
          location: data.location, sellerId: customer.sellerId, customerId: customer.id,
          quoteId: quote.id, locationSource: "PROPOSAL_SENT",
        }),
      });
    }

    return { quote, olistOrder, locationCapture };
  });

  const approvedOrderSync = data.olistOrder?.statusRaw && isApprovedOlistStatus(data.olistOrder.statusRaw)
    ? await syncOlistOrderStatus({
        brand,
        externalOrderId: data.olistOrder.id,
        statusRaw: data.olistOrder.statusRaw,
      })
    : null;

  if (ACTIVE_QUOTE_STATUSES.includes(synced.quote.status) && STAGES_THAT_ENTER_QUOTE.includes(customer.pipelineStage)) {
    await moveCustomerStage(customer.sellerId, customer.id, "COTACAO", { reason: "cotação sincronizada do Shopify", automatic: true });
  }

  await syncAutomaticFollowUpsForSellerIds([customer.sellerId]);

  await logAudit({
    actorId: null,
    action: data.event === "SENT" ? "PROPOSAL_SENT" : "QUOTE_SYNCED_FROM_SHOPIFY",
    entityType: "Quote",
    entityId: synced.quote.id,
    metadata: {
      event: data.event,
      mode: data.mode,
      brand,
      source: "shopify-app",
      shop: data.shop ?? null,
      customerId: customer.id,
      olistOrderId: data.olistOrder?.id ?? null,
      ignoredOlistOrderForSimulation,
      sourceQuoteId: sourceQuote?.id ?? null,
    },
  });

  if (!existingQuote && sourceQuote) {
    await logAudit({
      actorId: null,
      action: "PROPOSAL_CONVERTED",
      entityType: "Quote",
      entityId: sourceQuote.id,
      metadata: { convertedToQuoteId: synced.quote.id, customerId: customer.id, brand, source: "shopify-app" },
    });
  }

  if (data.location) {
    // Metadata segura (item 21): nunca duplica lat/lng no audit log — isso
    // já fica só no LocationCapture.
    await logAudit({
      actorId: null,
      action: "PROPOSAL_LOCATION_CAPTURED",
      entityType: "Quote",
      entityId: synced.quote.id,
      metadata: {
        locationStatus: data.location.status,
        locationSource: "PROPOSAL_SENT",
        accuracyMeters: data.location.status === "GRANTED" ? data.location.accuracyMeters ?? null : null,
        source: "shopify-app",
      },
    });
  }

  // Aviso ao supervisor (uma vez por proposta; reenvios não duplicam).
  await notifySupervisorOfQuote(synced.quote.id, null);

  return NextResponse.json({
    success: true,
    quote: { id: synced.quote.id, status: synced.quote.status, mode: data.mode, brand },
    olistOrder: synced.olistOrder
      ? { id: synced.olistOrder.id, status: approvedOrderSync?.found ? approvedOrderSync.crmStatus : synced.olistOrder.crmStatus }
      : null,
    ignoredOlistOrderForSimulation,
    locationCaptured: Boolean(synced.locationCapture),
  });
}
