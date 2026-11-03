import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { canDeleteSimulation, canRestoreSimulation, quoteRestoreDeadline } from "./quote-trash-rules";

export class QuoteTrashError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function changeSimulationDeletion(actorId: string, quoteId: string, action: "DELETE" | "RESTORE") {
  return prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, name: true, active: true, deletedAt: true } });
    if (!actor?.active || actor.deletedAt) throw new QuoteTrashError("Acesso negado.", 403);
    if (actor.role !== "ADMIN" && actor.role !== "SUPERVISOR") throw new QuoteTrashError("Acesso negado.", 403);
    const quote = await tx.quote.findUnique({
      where: { id: quoteId },
      include: {
        customer: { select: { id: true, contactName: true, tradeName: true, seller: { select: { id: true, supervisorId: true } } } },
        seller: { select: { name: true } }, olistOrder: { select: { id: true } },
      },
    });
    if (!quote) throw new QuoteTrashError("Proposta não encontrada.", 404);
    const inScope = quote.customer.seller.id === actor.id || quote.customer.seller.supervisorId === actor.id;
    if (!canDeleteSimulation(actor.role, inScope, quote.mode)) throw new QuoteTrashError("Somente simulações da sua equipe podem ser excluídas.", 403);
    const now = new Date();
    if (action === "RESTORE") {
      if (actor.role !== "ADMIN") throw new QuoteTrashError("Somente Admin/Master pode restaurar simulações.", 403);
      if (!quote.deletedAt) throw new QuoteTrashError("A simulação não está excluída.", 409);
      if (!canRestoreSimulation(actor.role, quote.deletedAt, now)) throw new QuoteTrashError("O prazo de 7 dias para restauração terminou. O histórico permanece disponível.", 410);
      const changed = await tx.quote.updateMany({ where: { id: quote.id, deletedAt: quote.deletedAt, updatedAt: quote.updatedAt }, data: { deletedAt: null, deletedById: null } });
      if (changed.count !== 1) throw new QuoteTrashError("A simulação foi alterada. Atualize a página.", 409);
      await tx.auditLog.create({ data: { actorId, action: "SIMULATION_RESTORED", entityType: "Quote", entityId: quote.id,
        metadata: { deletedAt: quote.deletedAt.toISOString(), snapshot: quote.deletedSnapshot } as Prisma.InputJsonValue } });
      return { restored: true, quoteId: quote.id };
    }
    if (quote.deletedAt) throw new QuoteTrashError("A simulação já foi excluída.", 409);
    if (quote.olistOrder) throw new QuoteTrashError("Esta proposta possui pedido Olist e não pode ser excluída como simulação.", 409);
    const snapshot: Prisma.InputJsonValue = JSON.parse(JSON.stringify({
      quoteId: quote.id, customerId: quote.customerId, customerName: quote.customer.tradeName || quote.customer.contactName,
      sellerId: quote.sellerId, sellerName: quote.seller.name, brand: quote.brand, mode: quote.mode,
      status: quote.status, valueCents: quote.totalValueCents, discountCents: quote.discountCents,
      productsSummary: quote.productsSummary, couponCode: quote.couponCode, notes: quote.notes,
      createdAt: quote.createdAt, deletedAt: now, deletedByName: actor.name,
    }));
    const changed = await tx.quote.updateMany({ where: { id: quote.id, deletedAt: null, updatedAt: quote.updatedAt },
      data: { deletedAt: now, deletedById: actorId, deletedSnapshot: snapshot } });
    if (changed.count !== 1) throw new QuoteTrashError("A simulação foi alterada. Atualize a página e tente novamente.", 409);
    await tx.auditLog.create({ data: { actorId, action: "SIMULATION_DELETED", entityType: "Quote", entityId: quote.id,
      metadata: { snapshot, restoreUntil: quoteRestoreDeadline(now).toISOString() } } });
    return { deleted: true, quoteId: quote.id, restoreUntil: quoteRestoreDeadline(now).toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
