import db from "../db.server";
import {
  findOlistOrderSummary,
  getOlistOrder,
} from "./olist-api.server";
import { syncCrmOlistOrderStatus } from "./crm-integration.server";
import {
  extractOlistOrderStatus,
  isApprovedOlistOrderStatus,
} from "./olist-order-status-rules";

const DEFAULT_BATCH_SIZE = 100;

export async function syncApprovedWholesaleOrders({ limit = DEFAULT_BATCH_SIZE } = {}) {
  const quotes = await db.wholesaleQuote.findMany({
    where: {
      status: "READY_FOR_REVIEW",
      olistOrderId: { not: null },
    },
    select: {
      id: true,
      shop: true,
      olistOrderId: true,
      olistOrderNumber: true,
    },
    orderBy: { confirmedAt: "asc" },
    take: Math.min(Math.max(Number(limit) || DEFAULT_BATCH_SIZE, 1), 250),
  });

  const result = {
    checked: 0,
    approved: 0,
    synced: 0,
    failed: 0,
  };

  for (const quote of quotes) {
    result.checked += 1;
    try {
      const details = await getOlistOrder(quote.shop, quote.olistOrderId);
      const summary = await findOlistOrderSummary(
        quote.shop,
        quote.olistOrderNumber,
        quote.olistOrderId,
      ).catch(() => null);
      const status = extractOlistOrderStatus(summary, details);
      if (!isApprovedOlistOrderStatus(status)) continue;

      result.approved += 1;
      await syncCrmOlistOrderStatus({
        olistOrderId: quote.olistOrderId,
        status: "Aprovado",
      });

      const updated = await db.wholesaleQuote.updateMany({
        where: { id: quote.id, status: "READY_FOR_REVIEW" },
        data: { status: "APPROVED" },
      });
      if (updated.count === 1) result.synced += 1;
    } catch (error) {
      result.failed += 1;
      console.error("Falha ao sincronizar aprovação Olist com o CRM", {
        quoteId: quote.id,
        olistOrderId: quote.olistOrderId,
        code: error?.code,
        status: error?.status,
        message: error?.message,
      });
    }
  }

  return result;
}
