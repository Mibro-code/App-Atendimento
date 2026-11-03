import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { canSupervisorDeactivateTeamUser, canTransferByTeamPolicy } from "./team-rules";
import { syncAutomaticFollowUpsForSellerIds } from "./automatic-followups";

export class TeamDeactivationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Desativação e repasse são atômicos: nunca deixa a carteira sem responsável ativo. */
export async function deactivateTeamUserWithTransfer(supervisorId: string, userId: string, transferToId: string) {
  if (!transferToId) throw new TeamDeactivationError(400, "Escolha quem receberá os clientes antes de desativar a conta.");
  const result = await prisma.$transaction(async (tx) => {
    const [actor, source, recipient] = await Promise.all([
      tx.user.findUnique({ where: { id: supervisorId } }),
      tx.user.findUnique({ where: { id: userId } }),
      tx.user.findUnique({ where: { id: transferToId } }),
    ]);
    if (!actor || actor.role !== "SUPERVISOR" || !actor.active || actor.deletedAt) throw new TeamDeactivationError(403, "Supervisor sem acesso.");
    if (!source || source.deletedAt || source.supervisorId !== actor.id || !["VENDEDOR", "REPRESENTANTE"].includes(source.role)) throw new TeamDeactivationError(404, "Integrante não encontrado na sua equipe.");
    if (!canSupervisorDeactivateTeamUser(actor.id, source)) throw new TeamDeactivationError(409, "Esta conta já está desativada.");
    if (!recipient || recipient.deletedAt || !["SUPERVISOR", "VENDEDOR", "REPRESENTANTE"].includes(recipient.role) || !canTransferByTeamPolicy({ actor, source, target: recipient, sellerTransfersEnabled: false })) throw new TeamDeactivationError(403, "Escolha você mesmo ou um integrante ativo da sua equipe.");

    const customers = await tx.customer.findMany({ where: { sellerId: source.id }, select: { id: true } });
    const ids = customers.map((customer) => customer.id);
    const reason = `Repasse na desativação de ${source.name}`;
    const transferred = await tx.customer.updateMany({ where: { sellerId: source.id }, data: { sellerId: recipient.id } });
    if (transferred.count !== ids.length) throw new TeamDeactivationError(409, "A carteira mudou durante o repasse. Tente novamente.");
    if (ids.length) {
      await tx.followUp.updateMany({ where: { customerId: { in: ids }, status: { in: ["PENDENTE", "ADIADO"] } }, data: { sellerId: recipient.id } });
      await tx.customerTransferHistory.createMany({ data: ids.map((customerId) => ({ customerId, fromSellerId: source.id, toSellerId: recipient.id, transferredById: actor.id, reason })) });
      await tx.auditLog.createMany({ data: ids.map((customerId) => ({ actorId: actor.id, action: "CUSTOMER_SELLER_CHANGED" as const, entityType: "Customer", entityId: customerId, metadata: { from: source.id, to: recipient.id, reason } })) });
    }
    await tx.user.update({ where: { id: source.id }, data: { active: false } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "USER_DEACTIVATED", entityType: "User", entityId: source.id, metadata: { from: true, to: false, performedByRole: "SUPERVISOR", transferredCustomers: ids.length, transferToId: recipient.id, transferToName: recipient.name } } });
    return { transferred: ids.length, transferToName: recipient.name };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });

  // Falha de sincronização não desfaz a transferência já concluída. A próxima
  // leitura também sincroniza os avisos com o prazo do novo responsável.
  await syncAutomaticFollowUpsForSellerIds([transferToId]).catch(() => console.error("Não foi possível recalcular os follow-ups após desativação."));
  return result;
}
