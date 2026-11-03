import type { Role } from "@prisma/client";

export interface TeamRuleUser {
  id: string;
  role: Role;
  supervisorId: string | null;
  active?: boolean;
}

/** Regra pura compartilhada pela API e pelos testes de RBAC. */
export function canTransferByTeamPolicy({
  actor,
  source,
  target,
  sellerTransfersEnabled,
  sellerTransferIndividuallyEnabled = false,
}: {
  actor: TeamRuleUser;
  source: Pick<TeamRuleUser, "id" | "supervisorId">;
  target: TeamRuleUser;
  sellerTransfersEnabled: boolean;
  sellerTransferIndividuallyEnabled?: boolean;
}): boolean {
  if (target.active === false || target.id === source.id) return false;
  if (actor.role === "ADMIN") return true;

  if (actor.role === "SUPERVISOR") {
    const sourceInsideTeam = source.id === actor.id || source.supervisorId === actor.id;
    const targetInsideTeam = target.id === actor.id || target.supervisorId === actor.id;
    return sourceInsideTeam && targetInsideTeam;
  }

  return (
    source.id === actor.id &&
    sellerTransfersEnabled &&
    sellerTransferIndividuallyEnabled &&
    !!actor.supervisorId &&
    (target.role === "VENDEDOR" || target.role === "REPRESENTANTE") &&
    target.supervisorId === actor.supervisorId
  );
}

export function canExportSellerByTeamPolicy(
  actor: TeamRuleUser,
  target: Pick<TeamRuleUser, "id" | "supervisorId">
): boolean {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "SUPERVISOR") {
    return target.id === actor.id || target.supervisorId === actor.id;
  }
  return target.id === actor.id;
}

/**
 * Exportação geral de clientes: somente SUPERVISOR (própria equipe) e ADMIN.
 * Vendedor e representante nunca exportam — validado no backend (403).
 */
export function canExportCustomers(role: Role): boolean {
  return role === "ADMIN" || role === "SUPERVISOR";
}

export function canSupervisorConfigureSeller(
  supervisorId: string,
  seller: Pick<TeamRuleUser, "role" | "supervisorId">
): boolean {
  return (seller.role === "VENDEDOR" || seller.role === "REPRESENTANTE") && seller.supervisorId === supervisorId;
}

export function canSupervisorCreateTeamUser(
  supervisor: Pick<TeamRuleUser, "role" | "active"> & { canCreateTeamUsers: boolean },
  targetRole: Role
): boolean {
  return supervisor.role === "SUPERVISOR" && supervisor.active !== false && supervisor.canCreateTeamUsers &&
    (targetRole === "VENDEDOR" || targetRole === "REPRESENTANTE");
}

export function canSupervisorDeactivateTeamUser(
  supervisorId: string,
  target: Pick<TeamRuleUser, "role" | "supervisorId" | "active">
): boolean {
  return target.active !== false && target.supervisorId === supervisorId &&
    (target.role === "VENDEDOR" || target.role === "REPRESENTANTE");
}

export function canAdminDeleteUser(
  actor: Pick<TeamRuleUser, "id" | "role">,
  targetId: string,
  directReports: number
): boolean {
  return actor.role === "ADMIN" && actor.id !== targetId && directReports === 0;
}
