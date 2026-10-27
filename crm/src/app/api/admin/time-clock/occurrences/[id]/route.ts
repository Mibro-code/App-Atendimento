import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, badRequest, forbidden, notFound } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().trim().max(1000).optional(),
});

// Mesma ação de .../team/time-clock/occurrences/[id], mas sem restrição de
// equipe (ADMIN only).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "ADMIN") return forbidden("Disponível somente para administradores.");

  const { id } = await params;
  const occurrence = await prisma.occurrence.findUnique({ where: { id }, select: { id: true } });
  if (!occurrence) return notFound("Ocorrência não encontrada.");

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
