import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, badRequest, forbidden } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { canUseTimeClock } from "@/lib/time-clock";

const occurrenceTypeValues = [
  "ATRASO",
  "SAIDA_ANTECIPADA",
  "FALTA",
  "PROBLEMA_NO_PONTO",
  "ESQUECIMENTO",
  "ATESTADO",
  "OUTRO",
] as const;

const createSchema = z.object({
  type: z.enum(occurrenceTypeValues),
  occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  description: z.string().trim().min(1).max(2000),
});

const occurrenceSelect = {
  id: true,
  type: true,
  occurrenceDate: true,
  description: true,
  status: true,
  reviewedById: true,
  reviewedAt: true,
  reviewNote: true,
  createdAt: true,
  documents: {
    select: { id: true, fileName: true, mimeType: true, fileSize: true, uploadedAt: true },
  },
} as const;

// Lista/cria ocorrências do PRÓPRIO usuário — userId sempre vem da sessão,
// nunca do corpo da requisição. Visão de equipe/todos fica em
// /api/team/time-clock/occurrences e /api/admin/time-clock/occurrences.
export async function GET() {
  const { user, error } = await requireSession();
  if (error) return error;
  if (!canUseTimeClock(user.role)) return forbidden("Disponível somente para vendedores e supervisores.");

  const occurrences = await prisma.occurrence.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: occurrenceSelect,
  });

  return NextResponse.json({ occurrences });
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (!canUseTimeClock(user.role)) return forbidden("Disponível somente para vendedores e supervisores.");

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Ocorrência inválida.", parsed.error.flatten());

  const { type, occurrenceDate, description } = parsed.data;

  const occurrence = await prisma.occurrence.create({
    data: {
      userId: user.id,
      type,
      occurrenceDate: new Date(`${occurrenceDate}T00:00:00.000Z`),
      description,
    },
    select: occurrenceSelect,
  });

  await logAudit({
    actorId: user.id,
    action: "TIME_CLOCK_OCCURRENCE_CREATED",
    entityType: "Occurrence",
    entityId: occurrence.id,
    metadata: { type, occurrenceDate },
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ occurrence }, { status: 201 });
}
