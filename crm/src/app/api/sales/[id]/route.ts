import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest, forbidden, notFound } from "@/lib/api-auth";
import { canAccessCustomer } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

// Nenhuma venda é "criada" apenas pelo frontend dizendo que sim: toda
// transição de Sale.stage para um estado de confirmação/cancelamento passa
// por validação de servidor aqui, nunca é aceita direto do cliente sem
// checagem de transição e de permissão.

const schema = z.object({
  action: z.enum(["CONFIRM", "CANCEL"]),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  const sale = await prisma.sale.findUnique({ where: { id }, include: { customer: true } });
  if (!sale) return notFound("Venda não encontrada.");
  if (!(await canAccessCustomer(user, sale.customer.sellerId))) return forbidden();

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());

  if (parsed.data.action === "CONFIRM") {
    return forbidden("A confirmação de venda/pagamento é exclusiva da integração Olist após aprovação do pedido.");
  }

  if (sale.stage === "CANCELADO") {
    return badRequest("Venda já está cancelada.");
  }
  const updated = await prisma.sale.update({
    where: { id },
    data: { stage: "CANCELADO", cancelledAt: new Date() },
  });
  await logAudit({
    actorId: user.id,
    action: "SALE_CANCELLED",
    entityType: "Sale",
    entityId: id,
  });
  return NextResponse.json({ sale: updated });
}
