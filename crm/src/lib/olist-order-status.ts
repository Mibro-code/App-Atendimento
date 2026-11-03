import "server-only";
import type { CommercialBrand } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { isApprovedOlistStatus } from "@/lib/olist-status-rules";
import { moveToSoldAfterConfirmedSale, snapshotSaleCommission } from "@/lib/pipeline";
export { isApprovedOlistStatus } from "@/lib/olist-status-rules";

export async function syncOlistOrderStatus(input: {
  brand: CommercialBrand;
  externalOrderId: string;
  statusRaw: string;
  approvedAt?: Date;
}) {
  const order = await prisma.olistOrder.findUnique({
    where: {
      brand_olistOrderId: {
        brand: input.brand,
        olistOrderId: input.externalOrderId,
      },
    },
    select: {
      id: true,
      customerId: true,
      quoteId: true,
      valueCents: true,
      crmStatus: true,
      olistStatusRaw: true,
      customer: { select: { sellerId: true } },
      sale: { select: { id: true, stage: true, confirmedAt: true } },
    },
  });
  if (!order) return { found: false as const };

  const approved = isApprovedOlistStatus(input.statusRaw);
  const confirmedAt = order.sale?.confirmedAt ?? input.approvedAt ?? new Date();
  const result = await prisma.$transaction(async (tx) => {
    let firstConfirmation = false;
    if (approved) {
      const transition = await tx.olistOrder.updateMany({
        where: { id: order.id, crmStatus: { not: "PAGAMENTO_CONFIRMADO" } },
        data: {
          crmStatus: "PAGAMENTO_CONFIRMADO",
          olistStatusRaw: input.statusRaw,
          lastSyncedAt: new Date(),
          followUpStatus: "RESOLVED",
          followUpResolvedAt: new Date(),
        },
      });
      firstConfirmation = transition.count === 1;
      if (!firstConfirmation) {
        await tx.olistOrder.update({
          where: { id: order.id },
          data: { olistStatusRaw: input.statusRaw, lastSyncedAt: new Date() },
        });
      }

      const sale = await tx.sale.upsert({
        where: { olistOrderId: order.id },
        create: {
          customerId: order.customerId,
          sellerId: order.customer.sellerId,
          olistOrderId: order.id,
          stage: "PAGAMENTO_CONFIRMADO",
          valueCents: order.valueCents,
          confirmedAt,
        },
        update: {
          sellerId: order.customer.sellerId,
          stage: "PAGAMENTO_CONFIRMADO",
          valueCents: order.valueCents,
          confirmedAt: order.sale?.confirmedAt ?? confirmedAt,
          cancelledAt: null,
        },
      });

      await tx.customer.update({
        where: { id: order.customerId },
        data: {
          status: "CLIENTE_ATIVO",
          lastSaleAt: confirmedAt,
          ...(firstConfirmation ? { totalSoldCents: { increment: order.valueCents } } : {}),
        },
      });
      await tx.followUp.updateMany({
        where: {
          customerId: order.customerId,
          source: { in: ["AUTOMATICO_30_DIAS", "AUTOMATICO_INATIVIDADE"] },
          status: { in: ["PENDENTE", "ADIADO"] },
        },
        data: { status: "CONCLUIDO", completedAt: confirmedAt },
      });
      if (order.quoteId) {
        await tx.quote.update({
          where: { id: order.quoteId },
          data: { status: "CONVERTIDA", convertedAt: confirmedAt },
        });
      }
      if (firstConfirmation) {
        await snapshotSaleCommission(tx, sale.id);
        await moveToSoldAfterConfirmedSale(tx, order.customerId, order.customer.sellerId, "pedido aprovado no Olist");
      }
    } else if (order.crmStatus !== "PAGAMENTO_CONFIRMADO") {
      await tx.olistOrder.update({
        where: { id: order.id },
        data: { olistStatusRaw: input.statusRaw, lastSyncedAt: new Date() },
      });
    }

    if (order.olistStatusRaw !== input.statusRaw || firstConfirmation) {
      await tx.olistStatusHistory.create({
        data: {
          olistOrderId: order.id,
          olistStatusRaw: input.statusRaw,
          crmStatus: approved ? "PAGAMENTO_CONFIRMADO" : order.crmStatus,
        },
      });
    }
    return { firstConfirmation };
  });

  await logAudit({
    actorId: null,
    action: approved ? "OLIST_ORDER_APPROVED" : "OLIST_ORDER_STATUS_SYNCED",
    entityType: "OlistOrder",
    entityId: order.id,
    metadata: {
      brand: input.brand,
      externalOrderId: input.externalOrderId,
      statusRaw: input.statusRaw,
      approved,
      firstConfirmation: result.firstConfirmation,
    },
  });

  return {
    found: true as const,
    approved,
    firstConfirmation: result.firstConfirmation,
    orderId: order.id,
    crmStatus: approved ? "PAGAMENTO_CONFIRMADO" : order.crmStatus,
  };
}
