import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest, forbidden, notFound } from "@/lib/api-auth";
import { canAccessCustomer } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  action: z.enum(["COMPLETE", "POSTPONE"]),
  newDueAt: z.string().datetime().optional(),
  note: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  const followUp = await prisma.followUp.findUnique({ where: { id }, include: { customer: true } });
  if (!followUp) return notFound("Follow-up não encontrado.");
  if (!(await canAccessCustomer(user, followUp.customer.sellerId))) return forbidden();

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const data = parsed.data;

  if (data.action === "COMPLETE") {
    const updated = await prisma.followUp.update({
      where: { id },
      data: { status: "CONCLUIDO", completedAt: new Date() },
    });
    await prisma.customer.update({
      where: { id: followUp.customerId },
      data: { lastInteractionAt: new Date() },
    });
    await logAudit({
      actorId: user.id,
      action: "FOLLOWUP_COMPLETED",
      entityType: "FollowUp",
      entityId: id,
    });
    return NextResponse.json({ followUp: updated });
  }

  // POSTPONE ("Adiar"): mantemos status PENDENTE e apenas atualizamos dueAt.
  // O enum FollowUpStatus.ADIADO existe no schema para uso futuro (ex.:
  // relatórios que queiram diferenciar "nunca adiado" de "adiado"), mas na
  // Fase 1 optamos por manter o follow-up simplesmente PENDENTE com a nova
  // data — decisão documentada no README.
  if (!data.newDueAt) return badRequest("Informe a nova data (newDueAt) para adiar.");

  const updated = await prisma.followUp.update({
    where: { id },
    data: {
      dueAt: new Date(data.newDueAt),
      status: "PENDENTE",
      note: data.note ?? followUp.note,
    },
  });

  await logAudit({
    actorId: user.id,
    action: "FOLLOWUP_POSTPONED",
    entityType: "FollowUp",
    entityId: id,
    metadata: { newDueAt: data.newDueAt },
  });

  return NextResponse.json({ followUp: updated });
}
