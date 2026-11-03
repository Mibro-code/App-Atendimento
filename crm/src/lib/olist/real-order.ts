import "server-only";
import { createHash } from "node:crypto";
import type { OlistSyncAction, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { canAccessCustomer, type SessionUser } from "@/lib/authz";
import { PricingError } from "@/lib/pricing/pricing-rules";
import { resolveWholesalePrice } from "@/lib/pricing/pricing";
import { buildProductsSummary } from "@/lib/quotes/native-quote-rules";
import { notifySupervisorOfQuote } from "@/lib/quotes/quote-alerts";
import { moveCustomerStage } from "@/lib/pipeline";
import { OlistBridgeError, callOlistBridge } from "@/lib/olist/bridge-client";
import { legacyDirectOrderAllowed } from "@/lib/proposals/proposal-config";
import {
  buildBridgeOrderPayload,
  customerOrderReadiness,
  orderTaxId,
  verifyOlistOrder,
  type OlistCalculateResponse,
  type OrderItemSnapshot,
} from "@/lib/olist/real-order-rules";

// Pedido real a partir da calculadora do CRM. A simulação NUNCA chama o
// Olist; só uma Quote REAL (criada a partir da simulação, preservando-a)
// cria/atualiza pedido. Toda chamada gera um OlistSyncAttempt rastreável.

const LOCK_MS = 3 * 60 * 1000;
const STAGES_THAT_ENTER_QUOTE = ["NOVO", "EM_ATENDIMENTO", "FOLLOW_UP"];

export class RealOrderError extends PricingError {}

const CUSTOMER_SELECT = {
  id: true, sellerId: true, contactName: true, legalName: true, tradeName: true, cnpjDigits: true, cpfDigits: true,
  email: true, phoneDigits: true, addressStreet: true, addressNumber: true, addressDistrict: true, addressComplement: true,
  city: true, state: true, zipDigits: true, pipelineStage: true,
} satisfies Prisma.CustomerSelect;

async function loadQuote(actor: SessionUser, quoteId: string) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { customer: { select: CUSTOMER_SELECT }, items: { orderBy: { sortOrder: "asc" } }, olistOrder: true, commercialProposal: { select: { id: true } } },
  });
  if (!quote || quote.deletedAt) throw new RealOrderError("Proposta não encontrada.", "NOT_FOUND");
  if (!(await canAccessCustomer(actor, quote.customer.sellerId))) throw new RealOrderError("Você não tem acesso a esta proposta.", "FORBIDDEN");
  if (quote.origin !== "CRM") throw new RealOrderError("Propostas do Shopify seguem o fluxo da página Shopify.", "NOT_CRM_QUOTE", { origin: quote.origin });
  // Cotação de proposta comercial Olist: nunca cria pedido nem envia por este caminho.
  if (quote.commercialProposal) {
    throw new RealOrderError("Esta cotação pertence a uma proposta comercial. Use o fluxo da proposta.", "PROPOSAL_FLOW", { proposalId: quote.commercialProposal.id });
  }
  return quote;
}

function snapshot(items: Array<{ sku: string; productName: string; colorName: string | null; quantity: number; unitPriceCents: number; appliedTier: OrderItemSnapshot["appliedTier"] }>): OrderItemSnapshot[] {
  return items.map((i) => ({ sku: i.sku, productName: i.productName, colorName: i.colorName, quantity: i.quantity, unitPriceCents: i.unitPriceCents, appliedTier: i.appliedTier }));
}

// ------------------------------------------------------------------ trava

async function withQuoteLock<T>(quoteId: string, fn: () => Promise<T>): Promise<T> {
  const now = new Date();
  const locked = await prisma.quote.updateMany({
    where: { id: quoteId, OR: [{ olistLockedAt: null }, { olistLockedAt: { lt: new Date(now.getTime() - LOCK_MS) } }] },
    data: { olistLockedAt: now },
  });
  if (locked.count !== 1) {
    throw new RealOrderError("Esta proposta já está sendo enviada ao Olist. Aguarde alguns segundos.", "OLIST_SYNC_IN_PROGRESS");
  }
  try {
    return await fn();
  } finally {
    await prisma.quote.update({ where: { id: quoteId }, data: { olistLockedAt: null } }).catch(() => undefined);
  }
}

async function startAttempt(quoteId: string, brand: "MIBRO" | "SINCROFIT", action: OlistSyncAction, actorId: string, requestHash?: string) {
  return prisma.olistSyncAttempt.create({ data: { quoteId, brand, action, actorId, requestHash }, select: { id: true } });
}

async function failAttempt(attemptId: string, error: unknown, extra: Partial<Prisma.OlistSyncAttemptUpdateInput> = {}) {
  const code = error instanceof OlistBridgeError || error instanceof PricingError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof Error ? error.message : "Erro desconhecido.";
  const details = error instanceof OlistBridgeError ? error.details : error instanceof PricingError ? error.details : undefined;
  await prisma.olistSyncAttempt.update({
    where: { id: attemptId },
    data: {
      status: "FAILED",
      errorCode: code.slice(0, 80),
      errorMessage: message.slice(0, 500),
      ...(details ? { response: JSON.parse(JSON.stringify(details)) } : {}),
      finishedAt: new Date(),
      ...extra,
    },
  });
  return { code, message };
}

/** Erro rastreável: inclui o id da tentativa para suporte. */
function traceable(error: unknown, attemptId: string, code: string, message: string): never {
  const status = error instanceof OlistBridgeError ? error.status : undefined;
  throw new RealOrderError(`${message} (protocolo ${attemptId.slice(-8).toUpperCase()})`, code, { attemptId, bridgeStatus: status });
}

// ------------------------------------------------------- simulação -> real

/** Cria a Quote REAL a partir da simulação concluída (idempotente). */
export async function convertToRealOrder(actor: SessionUser, simulationId: string) {
  if (!legacyDirectOrderAllowed(actor.role)) {
    throw new RealOrderError("O pedido direto foi substituído pela proposta comercial. Crie uma proposta a partir da simulação.", "LEGACY_DISABLED");
  }
  const source = await loadQuote(actor, simulationId);
  if (source.mode !== "SIMULATION") throw new RealOrderError("Esta proposta já é um pedido real.", "ALREADY_REAL");
  const existing = await prisma.quote.findFirst({
    where: { sourceQuoteId: source.id, mode: "REAL", deletedAt: null, status: { not: "CANCELADA" } },
    select: { id: true },
  });
  if (existing) return { quoteId: existing.id, created: false };
  if (source.status !== "CALCULADA" && source.status !== "ENVIADA") {
    throw new RealOrderError("Conclua a simulação antes de gerar o pedido real.", "SIMULATION_NOT_CALCULATED");
  }
  if (source.items.length === 0) throw new RealOrderError("A simulação não tem itens.", "EMPTY_PRODUCTS");

  const created = await prisma.$transaction(async (tx) => {
    const fresh = await tx.quote.findUnique({ where: { id: source.id }, select: { status: true } });
    if (fresh?.status !== "CALCULADA" && fresh?.status !== "ENVIADA") {
      throw new RealOrderError("A simulação mudou enquanto você gerava o pedido. Recarregue a página.", "CONFLICT");
    }
    const real = await tx.quote.create({
      data: {
        customerId: source.customerId,
        sellerId: source.sellerId,
        brand: source.brand,
        origin: "CRM",
        mode: "REAL",
        status: "CALCULADA",
        sourceQuoteId: source.id,
        priceGroup: source.priceGroup,
        quantityRule: source.quantityRule,
        selectedTier: source.selectedTier,
        subtotalCents: source.subtotalCents,
        discountCents: source.discountCents,
        totalValueCents: source.totalValueCents,
        couponCode: source.couponCode,
        notes: source.notes,
        productsSummary: source.productsSummary ?? undefined,
        sellerNameSnapshot: source.sellerNameSnapshot,
        sellerEmailSnapshot: source.sellerEmailSnapshot,
        sellerPhoneSnapshot: source.sellerPhoneSnapshot,
        sellerJobTitleSnapshot: source.sellerJobTitleSnapshot,
        items: {
          create: source.items.map((i) => ({
            productId: i.productId, variantId: i.variantId, sku: i.sku, productName: i.productName, colorName: i.colorName,
            quantity: i.quantity, priceGroup: i.priceGroup, priceTableId: i.priceTableId, priceTableVersion: i.priceTableVersion,
            automaticTier: i.automaticTier, appliedTier: i.appliedTier, manualTier: i.manualTier,
            unitPriceCents: i.unitPriceCents, lineSubtotalCents: i.lineSubtotalCents, lineDiscountCents: i.lineDiscountCents, sortOrder: i.sortOrder,
          })),
        },
      },
      select: { id: true },
    });
    await tx.quote.update({ where: { id: source.id }, data: { status: "CONVERTIDA", convertedAt: new Date() } });
    return real;
  });

  await logAudit({
    actorId: actor.id, action: "PROPOSAL_CONVERTED", entityType: "Quote", entityId: source.id,
    metadata: { convertedToQuoteId: created.id, origin: "CRM", brand: source.brand },
  });
  await notifySupervisorOfQuote(created.id, actor.id);
  return { quoteId: created.id, created: true };
}

// --------------------------------------------------------------- cálculo

/**
 * Cria/atualiza o pedido em aberto no Olist com os preços do CRM.
 * 1) regra de quantidade pelo histórico do Olist (mix x por modelo);
 * 2) reprecifica no servidor com a MESMA versão de tabela da proposta;
 * 3) envia; 4) confere de forma independente o que o Olist gravou.
 */
export async function calculateRealOrder(actor: SessionUser, quoteId: string) {
  const quote = await loadQuote(actor, quoteId);
  if (quote.mode !== "REAL") throw new RealOrderError("Simulações não criam pedido no Olist.", "SIMULATION_OLIST_BLOCKED");
  if (quote.status !== "CALCULADA") throw new RealOrderError("Este pedido já foi enviado para análise.", "ALREADY_SENT");
  if (quote.items.length === 0) throw new RealOrderError("O pedido não tem itens.", "EMPTY_PRODUCTS");
  const blocking = customerOrderReadiness(quote.customer).filter((m) => m.level === "blocking");
  if (blocking.length > 0) {
    throw new RealOrderError(`Complete o cadastro do cliente: ${blocking.map((b) => b.label).join(", ")}.`, "CUSTOMER_INCOMPLETE", { missing: blocking });
  }

  return withQuoteLock(quote.id, async () => {
    const attempt = await startAttempt(quote.id, quote.brand, "CALCULATE", actor.id);
    try {
      // 1. Regra de quantidade (cliente recorrente = faixa por modelo).
      const profile = await callOlistBridge<{ pricing_mode: string }>(quote.brand, "/internal/crm/pricing-profile", { tax_id: orderTaxId(quote.customer) });
      const quantityRule = profile.pricing_mode === "per_model" ? "PER_MODEL" : "MIX";

      // 2. Reprecificação oficial com a versão de tabela fixada na proposta.
      const pricing = await resolveWholesalePrice({
        actor,
        sellerId: quote.customer.sellerId,
        brand: quote.brand,
        items: quote.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
        requestedTier: quote.selectedTier,
        discountCents: quote.discountCents ?? 0,
        quantityRule,
        quoteId: quote.id,
        pinnedPriceTableId: quote.items[0].priceTableId,
      });
      const repriced = pricing.lines.some((l) => quote.items.find((i) => i.sku === l.sku)?.unitPriceCents !== l.unitPriceCents);
      const items: OrderItemSnapshot[] = pricing.lines.map((l) => ({
        sku: l.sku, productName: l.productName, colorName: l.colorName ?? null, quantity: l.quantity, unitPriceCents: l.unitPriceCents, appliedTier: l.appliedTier,
      }));

      if (repriced || quote.quantityRule !== quantityRule) {
        await prisma.$transaction([
          prisma.quoteItem.deleteMany({ where: { quoteId: quote.id } }),
          prisma.quoteItem.createMany({
            data: pricing.lines.map((l, index) => ({
              quoteId: quote.id, productId: l.productId, variantId: l.variantId ?? null, sku: l.sku, productName: l.productName,
              colorName: l.colorName ?? null, quantity: l.quantity, priceGroup: pricing.priceGroup, priceTableId: pricing.priceTableId,
              priceTableVersion: pricing.priceTableVersion, automaticTier: l.automaticTier, appliedTier: l.appliedTier, manualTier: l.manualTier,
              unitPriceCents: l.unitPriceCents, lineSubtotalCents: l.lineSubtotalCents, lineDiscountCents: l.lineDiscountCents, sortOrder: index,
            })),
          }),
          prisma.quote.update({
            where: { id: quote.id },
            data: {
              quantityRule,
              subtotalCents: pricing.subtotalCents,
              totalValueCents: pricing.totalCents,
              productsSummary: buildProductsSummary(pricing.lines, {
                priceGroup: pricing.priceGroup, priceTableVersion: pricing.priceTableVersion, selectedTier: quote.selectedTier,
              }) as Prisma.InputJsonValue,
            },
          }),
        ]);
        if (repriced) {
          await logAudit({
            actorId: actor.id, action: "QUOTE_REPRICED", entityType: "Quote", entityId: quote.id,
            metadata: { reason: "Cliente recorrente no Olist: faixa por modelo", quantityRule, totalCents: pricing.totalCents },
          });
        }
      }

      // 3. Envio ao Olist (idempotente pela cotação: nunca duplica o pedido).
      const payload = buildBridgeOrderPayload({
        quoteId: quote.id,
        brand: quote.brand,
        customer: quote.customer,
        sellerName: quote.sellerNameSnapshot,
        notes: quote.notes,
        priceGroup: pricing.priceGroup,
        selectedTier: quote.selectedTier,
        quantityRule,
        discountCents: pricing.discountCents,
        items,
      });
      const requestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
      await prisma.olistSyncAttempt.update({ where: { id: attempt.id }, data: { requestHash } });
      const response = await callOlistBridge<OlistCalculateResponse>(quote.brand, "/internal/crm/orders/calculate", payload);

      // 4. Conferência independente do que o Olist gravou.
      const verification = verifyOlistOrder(items, pricing.discountCents, response);
      const olistOrderId = String(response.olist_order_id);
      const orderNumber = response.order_number ? String(response.order_number) : null;

      if (quote.olistOrder && quote.olistOrder.olistOrderId !== olistOrderId) {
        throw new RealOrderError("O Olist devolveu um pedido diferente do já vinculado a esta proposta.", "ORDER_ID_CHANGED", {
          linked: quote.olistOrder.olistOrderId, returned: olistOrderId,
        });
      }

      const linkedOrder = await prisma.olistOrder.findUnique({
        where: { brand_olistOrderId: { brand: quote.brand, olistOrderId } },
        select: { quoteId: true, customerId: true },
      });
      if (linkedOrder && (linkedOrder.quoteId !== quote.id || linkedOrder.customerId !== quote.customerId)) {
        throw new RealOrderError("O pedido retornado já pertence a outra proposta ou cliente.", "ORDER_OWNERSHIP_MISMATCH");
      }

      await prisma.olistOrder.upsert({
        where: { brand_olistOrderId: { brand: quote.brand, olistOrderId } },
        create: {
          brand: quote.brand, customerId: quote.customerId, quoteId: quote.id, olistOrderId, orderNumber,
          valueCents: pricing.totalCents, crmStatus: verification.verified ? "PEDIDO_CRIADO" : "DIVERGENCIA_OLIST", lastSyncedAt: new Date(),
        },
        update: {
          orderNumber, valueCents: pricing.totalCents,
          crmStatus: verification.verified ? "PEDIDO_CRIADO" : "DIVERGENCIA_OLIST", lastSyncedAt: new Date(),
        },
      });

      await prisma.olistSyncAttempt.update({
        where: { id: attempt.id },
        data: {
          status: verification.verified ? "SUCCEEDED" : "FAILED",
          olistOrderId, orderNumber,
          errorCode: verification.verified ? null : "OLIST_VERIFICATION_FAILED",
          errorMessage: verification.verified ? null : "O pedido gravado no Olist não confere com o CRM.",
          mismatch: verification.verified ? undefined : (verification.problems as unknown as Prisma.InputJsonValue),
          response: JSON.parse(JSON.stringify({ values: response.values, items_confirmed: response.items_confirmed, purchase_number: response.purchase_number })),
          finishedAt: new Date(),
        },
      });
      await logAudit({
        actorId: actor.id, action: verification.verified ? "OLIST_ORDER_CALCULATED" : "OLIST_SYNC_FAILED", entityType: "Quote", entityId: quote.id,
        metadata: {
          attemptId: attempt.id, olistOrderId, orderNumber, quantityRule, repriced,
          totalCents: pricing.totalCents, totalConfirmedByOlistCents: response.values?.total_confirmed_by_olist ?? null,
          ...(verification.verified ? {} : { problems: verification.problems as unknown as Prisma.InputJsonValue }),
        },
      });

      if (!verification.verified) {
        throw new RealOrderError(
          `O pedido ${orderNumber || olistOrderId} foi criado no Olist, mas os valores gravados não conferem com o CRM. Ele não pode ser enviado para análise (protocolo ${attempt.id.slice(-8).toUpperCase()}).`,
          "OLIST_VERIFICATION_FAILED",
          { attemptId: attempt.id, problems: verification.problems }
        );
      }

      return {
        attemptId: attempt.id,
        olistOrderId,
        orderNumber,
        repriced,
        quantityRule,
        totalCents: pricing.totalCents,
        totalConfirmedByOlistCents: response.values?.total_confirmed_by_olist ?? null,
      };
    } catch (error) {
      if (error instanceof RealOrderError && error.code === "OLIST_VERIFICATION_FAILED") throw error;
      const { code, message } = await failAttempt(attempt.id, error);
      await logAudit({ actorId: actor.id, action: "OLIST_SYNC_FAILED", entityType: "Quote", entityId: quote.id, metadata: { attemptId: attempt.id, action: "CALCULATE", code } });
      traceable(error, attempt.id, code, message);
    }
  });
}

// --------------------------------------------------------------- análise

/** Envia para aprovação: pedido segue aberto no Olist com o marcador PARA ANÁLISE. */
export async function confirmRealOrder(actor: SessionUser, quoteId: string) {
  const quote = await loadQuote(actor, quoteId);
  if (quote.mode !== "REAL") throw new RealOrderError("Simulações não criam pedido no Olist.", "SIMULATION_OLIST_BLOCKED");
  if (quote.status === "ENVIADA_PARA_ANALISE") return { alreadySent: true, olistOrderId: quote.olistOrder?.olistOrderId ?? null };
  if (!quote.olistOrder) throw new RealOrderError("Calcule o pedido no Olist antes de enviar para análise.", "ORDER_NOT_CALCULATED");

  const lastCalc = await prisma.olistSyncAttempt.findFirst({
    where: { quoteId: quote.id, action: "CALCULATE", status: { not: "STARTED" } },
    orderBy: { startedAt: "desc" },
  });
  if (!lastCalc || lastCalc.status !== "SUCCEEDED" || lastCalc.olistOrderId !== quote.olistOrder.olistOrderId || quote.olistOrder.crmStatus !== "PEDIDO_CRIADO") {
    throw new RealOrderError("O último cálculo no Olist não foi confirmado. Recalcule antes de enviar para análise.", "ORDER_NOT_VERIFIED");
  }

  return withQuoteLock(quote.id, async () => {
    const attempt = await startAttempt(quote.id, quote.brand, "CONFIRM", actor.id);
    try {
      const response = await callOlistBridge<{ olist_order_id: string; already_confirmed?: boolean }>(quote.brand, "/internal/crm/orders/confirm", {
        crm_quote_id: quote.id,
        olist_order_id: quote.olistOrder!.olistOrderId,
      });
      await prisma.$transaction([
        prisma.quote.update({ where: { id: quote.id }, data: { status: "ENVIADA_PARA_ANALISE" } }),
        prisma.olistOrder.update({ where: { id: quote.olistOrder!.id }, data: { crmStatus: "AGUARDANDO_APROVACAO", lastSyncedAt: new Date() } }),
        prisma.olistStatusHistory.create({ data: { olistOrderId: quote.olistOrder!.id, crmStatus: "AGUARDANDO_APROVACAO", olistStatusRaw: "PARA ANÁLISE" } }),
        prisma.olistSyncAttempt.update({
          where: { id: attempt.id },
          data: { status: "SUCCEEDED", olistOrderId: response.olist_order_id, finishedAt: new Date(), response: JSON.parse(JSON.stringify(response)) },
        }),
      ]);
      await logAudit({
        actorId: actor.id, action: "OLIST_ORDER_SENT_FOR_REVIEW", entityType: "Quote", entityId: quote.id,
        metadata: { attemptId: attempt.id, olistOrderId: response.olist_order_id },
      });
      if (STAGES_THAT_ENTER_QUOTE.includes(quote.customer.pipelineStage)) {
        await moveCustomerStage(quote.customer.sellerId, quote.customerId, "COTACAO", { reason: "pedido enviado para análise no Olist", automatic: true });
      }
      return { alreadySent: !!response.already_confirmed, olistOrderId: response.olist_order_id };
    } catch (error) {
      const { code, message } = await failAttempt(attempt.id, error);
      await logAudit({ actorId: actor.id, action: "OLIST_SYNC_FAILED", entityType: "Quote", entityId: quote.id, metadata: { attemptId: attempt.id, action: "CONFIRM", code } });
      traceable(error, attempt.id, code, message);
    }
  });
}

// ---------------------------------------------------------------- e-mail

export async function emailProposal(actor: SessionUser, quoteId: string, to: string | null) {
  const quote = await loadQuote(actor, quoteId);
  if (!["CALCULADA", "ENVIADA", "ENVIADA_PARA_ANALISE"].includes(quote.status) || quote.items.length === 0) {
    throw new RealOrderError("Conclua a cotação antes de enviá-la por e-mail.", "QUOTE_NOT_CALCULATED");
  }
  const recipient = (to || quote.customer.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new RealOrderError("Informe um e-mail válido para o cliente.", "INVALID_EMAIL", { fieldErrors: { to: "E-mail inválido." } });
  }
  const attempt = await startAttempt(quote.id, quote.brand, "EMAIL", actor.id);
  try {
    const result = await callOlistBridge<{ email_id: string }>(quote.brand, "/internal/crm/proposals/email", {
      brand: quote.brand.toLowerCase(),
      crm_quote_id: quote.id,
      to: recipient,
      customer_name: quote.customer.tradeName || quote.customer.legalName || quote.customer.contactName,
      seller_name: quote.sellerNameSnapshot,
      seller_email: quote.sellerEmailSnapshot,
      notes: quote.notes,
      discount_cents: quote.discountCents ?? 0,
      items: quote.items.map((i) => ({ sku: i.sku, name: i.productName, color: i.colorName, quantity: i.quantity, unit_price_cents: i.unitPriceCents })),
    });
    await prisma.$transaction([
      prisma.quote.update({
        where: { id: quote.id },
        data: { sentAt: new Date(), sentToEmail: recipient, ...(quote.mode === "SIMULATION" && quote.status === "CALCULADA" ? { status: "ENVIADA" } : {}) },
      }),
      prisma.olistSyncAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), response: { email_id: result.email_id, to: recipient } } }),
    ]);
    await logAudit({ actorId: actor.id, action: "PROPOSAL_SENT", entityType: "Quote", entityId: quote.id, metadata: { attemptId: attempt.id, to: recipient, origin: "CRM" } });
    return { sentTo: recipient };
  } catch (error) {
    const { code, message } = await failAttempt(attempt.id, error);
    traceable(error, attempt.id, code, message);
  }
}
