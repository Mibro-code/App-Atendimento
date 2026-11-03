import type { ProposalMode, Role } from "@prisma/client";

export const QUOTE_RESTORE_DAYS = 7;
export function quoteRestoreDeadline(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + QUOTE_RESTORE_DAYS * 86_400_000);
}
export function canRestoreSimulation(role: Role, deletedAt: Date | null, now = new Date()): boolean {
  return role === "ADMIN" && !!deletedAt && now.getTime() <= quoteRestoreDeadline(deletedAt).getTime();
}
export function canDeleteSimulation(role: Role, inScope: boolean, mode: ProposalMode): boolean {
  return mode === "SIMULATION" && (role === "ADMIN" || (role === "SUPERVISOR" && inScope));
}
