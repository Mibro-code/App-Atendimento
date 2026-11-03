import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, badRequest, forbidden, notFound } from "@/lib/api-auth";
import { getVisibleSellerIds } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().trim().max(1000).optional(),
});

// Supervisor aprova/rejeita ocorrência — só de alguém da própria equipe,
// nunca de outra equipe (reconferido aqui, nunca só confiado no menu).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "SUPERVISOR") return forbidden("Disponível somente para supervisores.");

  const { id } = await params;
  const occurrence = await prisma.occurrence.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!occurrence) return notFound("Ocorrência não encontrada.");

  const scopeUserIds = await getVisibleSellerIds(user);
  if (!scopeUserIds?.includes(occurrence.userId)) {
    return forbidden("Você só pode analisar ocorrências da sua própria equipe.");
  }

  const parsed = reviewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Revisão inválida.", parsed.error.flatten());

  const updated = await prisma.occurrence.update({
    where: { id: occurrence.id },
    data: {
      status: parsed.data.status,
      reviewedById: user.id,
      reviewedAt: new Date(),
      reviewNote: parsed.data.reviewNote ?? null,
    },
    select: { id: true, status: true, reviewNote: true, reviewedAt: true },
  });

  await logAudit({
    actorId: user.id,
    action: "TIME_CLOCK_OCCURRENCE_REVIEWED",
    entityType: "Occurrence",
    entityId: occurrence.id,
    metadata: { status: parsed.data.status },
  });

  return NextResponse.json({ occurrence: updated });
}
