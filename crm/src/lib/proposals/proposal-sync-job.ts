import "server-only";
import { prisma } from "@/lib/prisma";
import { refreshOrder, refreshProposalFromOlist } from "@/lib/proposals/proposal-olist";
import { addEvent, bridgeFailure } from "@/lib/proposals/proposal-core";

// Sincronização periódica (não há webhook de propostas no Olist). Somente
// LEITURA: detecta alterações/conclusões feitas no Olist e atualiza pedido e
// recebimento. Nunca cria, atualiza ou converte nada no Olist sozinha.
// Lotes pequenos e sequenciais: o limite de requisições é por conta Olist e
// compartilhado com os demais aplicativos.

const MAX_BATCH = 50;

export async function runProposalSyncBatch(limit = 20) {
  const take = Math.min(Math.max(1, limit), MAX_BATCH);
  const proposals = await prisma.commercialProposal.findMany({
    where: {
      olistProposalId: { not: null },
      commercialStatus: { notIn: ["CANCELADA", "RECUSADA", "CONVERTIDA"] },
      syncStatus: { notIn: ["SINCRONIZANDO"] },
      lockedAt: null,
      events: { none: { type: "PROPOSAL_POLL_FAILED", createdAt: { gte: new Date(Date.now() - 5 * 60_000) } } },
    },
    orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }],
    take,
    select: { id: true },
  });
  const orders = await prisma.commercialProposal.findMany({
    where: {
      olistOrderId: { not: null },
      events: { none: { type: "ORDER_POLL_FAILED", createdAt: { gte: new Date(Date.now() - 5 * 60_000) } } },
      OR: [
        { orderStatus: { notIn: ["ENTREGUE", "CANCELADO"] } },
        { financialStatus: { notIn: ["PAGAMENTO_CONFIRMADO", "CANCELADO"] } },
      ],
    },
    orderBy: [{ orderLastSyncedAt: { sort: "asc", nulls: "first" } }],
    take,
    select: { id: true },
  });

  const result = { proposals: 0, orders: 0, failed: 0, errors: [] as Array<{ id: string; code: string }> };
  for (const { id } of proposals) {
    try {
      await refreshProposalFromOlist(null, id);
      result.proposals += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({ id, code: bridgeFailure(error).code });
      await addEvent(prisma, id, "PROPOSAL_POLL_FAILED", { origin: "SISTEMA", data: { code: bridgeFailure(error).code } });
    }
  }
  for (const { id } of orders) {
    try {
      await refreshOrder(null, id);
      result.orders += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({ id, code: bridgeFailure(error).code });
      await addEvent(prisma, id, "ORDER_POLL_FAILED", { origin: "SISTEMA", data: { code: bridgeFailure(error).code } });
    }
  }
  return result;
}
