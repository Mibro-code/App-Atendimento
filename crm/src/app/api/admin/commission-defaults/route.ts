import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, requireSession } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";

const TYPES = ["ATACADO", "VAREJO", "OUTRO"] as const;
const percent = z.number().min(0).max(100).nullable();
const schema = z.object({ ATACADO: percent, VAREJO: percent, OUTRO: percent });

// Comissão padrão por tipo de representante (política comercial). null =
// sem padrão: nenhum percentual é presumido para o tipo.
export async function GET() {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "ADMIN" && user.role !== "SUPERVISOR") return forbidden();
  const rows = await prisma.representativeTypeCommission.findMany();
  return NextResponse.json({ defaults: Object.fromEntries(TYPES.map((type) => [type, rows.find((row) => row.type === type)?.rateBps ?? null])) });
}

export async function PUT(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "ADMIN") return forbidden("Apenas administradores alteram a comissão padrão por tipo.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());

  const before = await prisma.representativeTypeCommission.findMany();
  await prisma.$transaction(TYPES.map((type) => {
    const rateBps = parsed.data[type] === null ? null : Math.round(parsed.data[type]! * 100);
    return prisma.representativeTypeCommission.upsert({
      where: { type },
      update: { rateBps, updatedById: user.id },
      create: { type, rateBps, updatedById: user.id },
    });
  }));
  await logAudit({
    actorId: user.id,
    action: "COMMISSION_TYPE_DEFAULT_UPDATED",
    entityType: "RepresentativeTypeCommission",
    metadata: {
      from: Object.fromEntries(before.map((row) => [row.type, row.rateBps])),
      to: parsed.data,
    },
  });
  return NextResponse.json({ success: true });
}
