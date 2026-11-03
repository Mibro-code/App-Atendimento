import "server-only";
import { Prisma } from "@prisma/client";
import { nextRca } from "@/lib/rca";

/** Próximo RCA livre (sequencial). Colisões concorrentes são barradas pelo índice único. */
export async function generateNextRca(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.user.findMany({ where: { rca: { not: null } }, select: { rca: true } });
  return nextRca(rows.map((row) => row.rca));
}

export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (!field) return true;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? "").includes(field);
}
