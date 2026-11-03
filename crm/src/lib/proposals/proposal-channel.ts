import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { authorize } from "./proposal-core";

/** Legacy channels must obey the same commercial policy as the new screen. */
export async function commercialForQuote(user: SessionUser, quoteId: string, action: "view" | "register_dispatch" | "prepare_order_update") {
  const linked = await prisma.commercialProposal.findUnique({ where: { quoteId }, select: { id: true } });
  return linked ? (await authorize(user, linked.id, action)).p : null;
}
