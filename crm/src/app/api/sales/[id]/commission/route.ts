import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/api-auth";
import { canAccessCustomer } from "@/lib/authz";
import { snapshotSaleCommission } from "@/lib/pipeline";
import { commissionCentsFor } from "@/lib/representative-commission";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  // Percentual específico deste pedido (ex.: 7). null = voltar para a regra padrão.
  percent: z.number().min(0).max(100).nullable(),
});

/**
 * Comissão específica por pedido (CUSTOM_ORDER), com prioridade sobre a
 * padrão. Somente supervisor (própria equipe) e admin definem; o
 * representante apenas visualiza a própria.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "ADMIN" && user.role !== "SUPERVISOR") return forbidden("Apenas supervisor ou administrador define a comissão do pedido.");

  const sale = await prisma.sale.findUnique({
    where: { id },
    select: { id: true, valueCents: true, commissionRateBps: true, commissionSource: true, customer: { select: { sellerId: true } }, seller: { select: { role: true } } },
  });
  if (!sale) return notFound("Pedido não encontrado.");
  if (!(await canAccessCustomer(user, sale.customer.sellerId))) return forbidden();
  if (sale.seller.role !== "REPRESENTANTE") return badRequest("Comissão por pedido se aplica a vendas de representantes.");

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    if (parsed.data.percent === null) {
      await tx.sale.update({ where: { id }, data: { commissionSource: null, commissionRateBps: null, commissionCents: null, commissionSetById: user.id, commissionSetAt: now } });
      return snapshotSaleCommission(tx, id);
    }
    const rateBps = Math.round(parsed.data.percent * 100);
    return tx.sale.update({
      where: { id },
      data: {
        commissionSource: "CUSTOM_ORDER",
        commissionRateBps: rateBps,
        commissionCents: commissionCentsFor(sale.valueCents, rateBps),
        commissionSetById: user.id,
        commissionSetAt: now,
      },
    });
  });

  await logAudit({
    actorId: user.id,
    action: "SALE_COMMISSION_UPDATED",
    entityType: "Sale",
    entityId: id,
    metadata: {
      from: { rateBps: sale.commissionRateBps, source: sale.commissionSource },
      to: { rateBps: updated?.commissionRateBps ?? null, source: updated?.commissionSource ?? null },
    },
  });

  return NextResponse.json({
    sale: updated && { id: updated.id, commissionRateBps: updated.commissionRateBps, commissionCents: updated.commissionCents, commissionSource: updated.commissionSource },
  });
}
