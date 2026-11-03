import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { callOlistBridge } from "@/lib/olist/bridge-client";
import { orderTaxId, customerOrderReadiness } from "@/lib/olist/real-order-rules";
import { contentOf, activeSellerLink } from "./proposal-access";
import { addEvent, authorize, failAttempt, finishAttempt, startAttempt, withProposalLock } from "./proposal-core";
import { proposalTotals, ProposalError } from "./proposal-rules";
import { type OlistOrderInspection, validateOrderForProposal } from "./proposal-olist-rules";

export type ConsultationKind = "stock" | "financial" | "documents";
export interface OrderDocuments {
  invoice_id: string | null; invoice_number: string | null; invoice_link: string | null;
  tracking_code: string | null; tracking_link: string | null; checked_at: string;
}
export interface OrderFinance {
  installments: Array<{ id: string; due_date: string | null; situation: string | null; amount_cents: number | null; balance_cents: number | null; payments: Array<{ date: string; amount_cents: number | null }> }>;
  checked_at: string;
}
export interface OrderStock { stock: Array<{ sku: string; available: number | null; reserved: number | null }>; checked_at: string }

/** Approval is a separate, Master-only command on an existing order. It never
 * calls the legacy payment/commission adapter or performs financial posting. */
export async function approveExistingOrder(user: SessionUser, id: string) {
  await authorize(user, id, "approve_order");
  return withProposalLock(id, async () => {
    const { p } = await authorize(user, id, "approve_order");
    if (!p.olistOrderId) throw new ProposalError("Pedido ainda não criado.", "NO_ORDER", 409);
    const current = await callOlistBridge<{ order: OlistOrderInspection }>(p.brand, "/internal/crm/orders/inspect", { brand: p.brand.toLowerCase(), olist_order_id: p.olistOrderId, include_receivables: false });
    const problems = validateOrderForProposal(current.order, { taxId: orderTaxId(p.customer), olistSellerId: p.olistSellerId, items: p.quote.items });
    if (current.order.id !== p.olistOrderId || problems.length || ![0, 3].includes(current.order.situation_code ?? -1)) {
      throw new ProposalError("O pedido diverge da proposta ou não está em aberto. Consulte o pedido antes de aprovar.", "ORDER_APPROVAL_CONFLICT", 409);
    }
    if (p.olistTotalCents !== null && current.order.total_cents !== p.olistTotalCents) throw new ProposalError("O total do pedido difere da proposta conferida no Olist.", "ORDER_TOTAL_CONFLICT", 409);
    if (current.order.seller_id !== p.olistSellerId || current.order.items.some((i) => !p.quote.items.some((q) => q.sku.toUpperCase() === i.sku.toUpperCase() && q.unitPriceCents === i.unit_price_cents))) throw new ProposalError("Vendedor ou preços divergentes. Confira o pedido no Olist.", "ORDER_APPROVAL_CONFLICT", 409);
    const attempt = await startAttempt(p, "ORDER_STATUS", user.id, "APPROVE_EXISTING_ORDER");
    let result: { order: OlistOrderInspection; already_approved: boolean };
    try {
      result = await callOlistBridge(p.brand, "/internal/crm/orders/approve", {
        brand: p.brand.toLowerCase(), olist_order_id: p.olistOrderId,
        expected_order: current.order,
      });
      if (result.order.id !== p.olistOrderId || result.order.situation_code !== 3) throw new ProposalError("Aprovação sem confirmação. Consulte o pedido.", "ORDER_APPROVAL_UNCONFIRMED", 409);
      await finishAttempt(attempt.id, { status: "SUCCEEDED", response: { operation: "APPROVE_ORDER", orderId: result.order.id, alreadyApproved: result.already_approved } });
    } catch (error) {
      const failure = await failAttempt(attempt.id, error);
      await addEvent(prisma, p.id, "ORDER_APPROVAL_UNCERTAIN", { actorId: user.id, data: { code: failure.code, attemptId: attempt.id } });
      throw new ProposalError("Não foi possível confirmar a aprovação. Consulte o pedido antes de tentar novamente; nenhum novo pedido será criado.", "ORDER_APPROVAL_UNCERTAIN", 409);
    }
    await prisma.$transaction(async (tx) => {
      await tx.commercialProposal.update({ where: { id: p.id }, data: { orderStatus: "PEDIDO_APROVADO", olistOrderSituation: "Aprovada", orderLastSyncedAt: new Date() } });
      await addEvent(tx, p.id, "ORDER_APPROVED_BY_MASTER", { actorId: user.id, version: p.version, data: { orderId: p.olistOrderId, alreadyApproved: result.already_approved, paymentChanged: false } });
    });
    return { ok: true, orderStatus: "PEDIDO_APROVADO" };
  });
}

/** On-demand reads. Permissions are checked on every request; no public cache. */
export async function consultProposal(user: SessionUser, id: string, kind: ConsultationKind) {
  const { p } = await authorize(user, id, kind === "financial" ? "view_financial_values" : "view");
  if (kind !== "stock" && !p.olistOrderId) throw new ProposalError("Não há pedido vinculado.", "NO_ORDER", 409);
  return callOlistBridge<OrderDocuments & OrderFinance & OrderStock>(p.brand, "/internal/crm/orders/consult", {
    brand: p.brand.toLowerCase(), kind, olist_order_id: p.olistOrderId,
    ...(kind === "stock" ? { skus: p.quote.items.map((i) => i.sku) } : {}),
  });
}

/** Local validation plus a fresh stock snapshot. Does not reserve stock or create orders. */
export async function preflightProposal(user: SessionUser, id: string) {
  const { p } = await authorize(user, id, "view");
  const problems = customerOrderReadiness(p.customer).map((issue) => `Confira o cadastro: ${issue.label}.`);
  const link = await activeSellerLink(p.sellerId, p.brand);
  if (!link || link.olistSellerId !== p.olistSellerId) problems.push("Vendedor sem vínculo válido com o Olist desta empresa.");
  if (p.syncStatus !== "SINCRONIZADA" || p.syncedVersion !== p.version) problems.push("Sincronize a versão atual antes de converter.");
  if (p.validUntil && p.validUntil < new Date()) problems.push("Validade vencida.");
  const content = contentOf(p);
  const totals = proposalTotals(content);
  const conditions = { freightCents: content.freightCents, payment: [content.paymentText, content.paymentCondition].filter(Boolean).join(" · ") || "Não informado", delivery: content.deliveryTerm || "Não informado", totalCents: totals.totalCents };
  const stock = await consultProposal(user, id, "stock");
  for (const item of p.quote.items) {
    const available = stock.stock.find((s) => s.sku.toUpperCase() === item.sku.toUpperCase())?.available;
    if (available === null || available === undefined) problems.push(`${item.sku}: estoque não informado.`);
    else if (available < item.quantity) problems.push(`${item.sku}: disponível ${available}, solicitado ${item.quantity}.`);
  }
  return { problems, conditions, stock: stock.stock, checked_at: stock.checked_at };
}
