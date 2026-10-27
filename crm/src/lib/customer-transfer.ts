import "server-only";
import { prisma } from "@/lib/prisma";
import {
  canAccessCustomer,
  canTransferCustomerToSeller,
  type SessionUser,
} from "@/lib/authz";
import { syncAutomaticFollowUpsForSellerIds } from "@/lib/automatic-followups";
import { logAudit } from "@/lib/audit";
import { canTransferByTeamPolicy } from "@/lib/team-rules";

export type CustomerTransferResult =
  | { ok: true; customerId: string; fromSellerId: string; toSellerId: string }
  | { ok: false; status: 400 | 403 | 404; message: string };

export async function transferCustomer({
  actor,
  customerId,
  targetSellerId,
  reason,
}: {
  actor: SessionUser;
  customerId: string;
  targetSellerId: string;
  reason?: string | null;
}): Promise<CustomerTransferResult> {
  const existing = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, sellerId: true },
  });
  if (!existing) return { ok: false, status: 404, message: "Cliente não encontrado." };
  if (!(await canAccessCustomer(actor, existing.sellerId))) {
    return { ok: false, status: 403, message: "Você não pode acessar este cliente." };
  }
  if (existing.sellerId === targetSellerId) {
    return { ok: false, status: 400, message: "O cliente já pertence a esse vendedor." };
  }
  if (!(await canTransferCustomerToSeller(actor, existing.sellerId, targetSellerId))) {
    return { ok: false, status: 403, message: "Repasse não permitido para esse vendedor." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: customerId }, data: { sellerId: targetSellerId } });
    await tx.followUp.updateMany({
      where: { customerId, status: { in: ["PENDENTE", "ADIADO"] } },
      data: { sellerId: targetSellerId },
    });
    await tx.customerTransferHistory.create({
      data: {
        customerId,
        fromSellerId: existing.sellerId,
        toSellerId: targetSellerId,
        transferredById: actor.id,
        reason: reason?.trim() || null,
      },
    });
  });

  // Recalcula o aviso com o prazo individual do novo responsável. Propostas
  // e vendas históricas não são reatribuídas.
  await syncAutomaticFollowUpsForSellerIds([targetSellerId]);
  await logAudit({
    actorId: actor.id,
    action: "CUSTOMER_SELLER_CHANGED",
    entityType: "Customer",
    entityId: customerId,
    metadata: { from: existing.sellerId, to: targetSellerId, reason: reason?.trim() || null },
  });

  return { ok: true, customerId, fromSellerId: existing.sellerId, toSellerId: targetSellerId };
}

export async function transferCustomersBulk({
  actor,
  customerIds,
  targetSellerId,
  reason,
}: {
  actor: SessionUser;
  customerIds: string[];
  targetSellerId: string;
  reason?: string | null;
}): Promise<
  | { ok: true; transferred: number; skipped: number }
  | { ok: false; status: 400 | 403 | 404; message: string }
> {
  const uniqueIds = [...new Set(customerIds)];
  if (uniqueIds.length === 0) return { ok: false, status: 400, message: "Selecione ao menos um cliente." };

  const scope = await (await import("@/lib/authz")).getCustomerScopeFilter(actor);
  const [customers, actorRecord, target] = await Promise.all([
    prisma.customer.findMany({
      where: { AND: [scope, { id: { in: uniqueIds } }] },
      select: { id: true, sellerId: true },
    }),
    prisma.user.findUnique({
      where: { id: actor.id },
      select: { id: true, role: true, supervisorId: true, canTransferOwnCustomers: true },
    }),
    prisma.user.findUnique({
      where: { id: targetSellerId },
      select: { id: true, role: true, supervisorId: true, active: true },
    }),
  ]);
  if (customers.length !== uniqueIds.length) {
    return { ok: false, status: 403, message: "Há clientes fora do seu escopo de acesso." };
  }
  if (!actorRecord || !target) return { ok: false, status: 404, message: "Vendedor de destino não encontrado." };

  const supervisor = actorRecord.supervisorId
    ? await prisma.user.findUnique({
        where: { id: actorRecord.supervisorId },
        select: { allowSellerCustomerTransfer: true },
      })
    : null;
  const movable = customers.filter((customer) => customer.sellerId !== targetSellerId);
  const forbiddenTransfer = movable.some((customer) => !canTransferByTeamPolicy({
    actor: actorRecord,
    source: { id: customer.sellerId, supervisorId: customer.sellerId === actorRecord.id ? actorRecord.supervisorId : actorRecord.role === "SUPERVISOR" ? actorRecord.id : null },
    target,
    sellerTransfersEnabled: supervisor?.allowSellerCustomerTransfer ?? false,
    sellerTransferIndividuallyEnabled: actorRecord.canTransferOwnCustomers,
  }));
  // Para supervisor/admin, buscar o supervisor real da origem evita inferir
  // equipe a partir do payload ou da seleção feita na tela.
  if (actorRecord.role !== "ADMIN") {
    const sources = await prisma.user.findMany({
      where: { id: { in: [...new Set(movable.map((item) => item.sellerId))] } },
      select: { id: true, supervisorId: true },
    });
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    if (movable.some((customer) => {
      const source = sourceById.get(customer.sellerId);
      return !source || !canTransferByTeamPolicy({
        actor: actorRecord,
        source,
        target,
        sellerTransfersEnabled: supervisor?.allowSellerCustomerTransfer ?? false,
        sellerTransferIndividuallyEnabled: actorRecord.canTransferOwnCustomers,
      });
    })) return { ok: false, status: 403, message: "Um ou mais repasses não são permitidos." };
  } else if (forbiddenTransfer) {
    return { ok: false, status: 403, message: "Um ou mais repasses não são permitidos." };
  }

  const transferReason = reason?.trim() || "Repasse em massa";
  await prisma.$transaction(async (tx) => {
    for (const customer of movable) {
      const updated = await tx.customer.updateMany({
        where: { id: customer.id, sellerId: customer.sellerId },
        data: { sellerId: targetSellerId },
      });
      if (updated.count !== 1) throw new Error("Cliente alterado durante o repasse em massa.");
    }
    await tx.followUp.updateMany({
      where: { customerId: { in: movable.map((item) => item.id) }, status: { in: ["PENDENTE", "ADIADO"] } },
      data: { sellerId: targetSellerId },
    });
    if (movable.length > 0) {
      await tx.customerTransferHistory.createMany({
        data: movable.map((customer) => ({
          customerId: customer.id,
          fromSellerId: customer.sellerId,
          toSellerId: targetSellerId,
          transferredById: actor.id,
          reason: transferReason,
        })),
      });
    }
  });

  if (movable.length > 0) {
    await syncAutomaticFollowUpsForSellerIds([targetSellerId]);
    await logAudit({
      actorId: actor.id,
      action: "CUSTOMER_SELLER_CHANGED",
      entityType: "CustomerBulkTransfer",
      metadata: { count: movable.length, targetSellerId, reason: transferReason },
    });
  }
  return { ok: true, transferred: movable.length, skipped: customers.length - movable.length };
}
