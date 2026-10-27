import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, badRequest, forbidden, notFound } from "@/lib/api-auth";
import { getVisibleSellerIds } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getBrazilWorkDateKey } from "@/lib/time-clock";

const correctionSchema = z.object({
  occurredAt: z.string().datetime(),
  reason: z.string().trim().min(1).max(1000),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "SUPERVISOR") return forbidden("Correção disponível somente para supervisores.");

  const { id } = await params;
  const entry = await prisma.timeClockEntry.findUnique({
    where: { id },
    select: { id: true, userId: true, occurredAt: true, workDate: true },
  });
  if (!entry) return notFound("Registro de ponto não encontrado.");

  const visibleSellerIds = await getVisibleSellerIds(user);
  if (!visibleSellerIds?.includes(entry.userId)) {
    return forbidden("Este registro não pertence à sua equipe.");
  }

  const parsed = correctionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Correção inválida.", parsed.error.flatten());

  const newOccurredAt = new Date(parsed.data.occurredAt);
  if (Number.isNaN(newOccurredAt.getTime())) return badRequest("Horário inválido.");
  if (getBrazilWorkDateKey(newOccurredAt) !== entry.workDate.toISOString().slice(0, 10)) {
    return badRequest("A correção deve permanecer na mesma data do registro original.");
  }

  const oldValue = entry.occurredAt.toISOString();
  const newValue = newOccurredAt.toISOString();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.timeClockEntry.update({
      where: { id: entry.id },
      data: { occurredAt: newOccurredAt },
      select: { id: true, eventType: true, occurredAt: true },
    });
    await tx.timeClockCorrection.create({
      data: {
        entryId: entry.id,
        changedById: user.id,
        fieldChanged: "occurredAt",
        oldValue,
        newValue,
        reason: parsed.data.reason,
      },
    });
    return result;
  });

  await logAudit({
    actorId: user.id,
    action: "TIME_CLOCK_CORRECTED",
    entityType: "TimeClockEntry",
    entityId: entry.id,
    metadata: {
      targetUserId: entry.userId,
      fieldChanged: "occurredAt",
      oldValue,
      newValue,
      reason: parsed.data.reason,
    },
  });

  return NextResponse.json({ entry: updated });
}
