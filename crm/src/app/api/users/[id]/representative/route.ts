import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound, requireSession } from "@/lib/api-auth";
import { canSupervisorConfigureSeller } from "@/lib/team-rules";
import { normalizeRegions } from "@/lib/representative-regions";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  representativeType: z.enum(["ATACADO", "VAREJO", "OUTRO"]).nullable(),
  regions: z.array(z.object({ state: z.string().max(2), city: z.string().max(100).optional().nullable() })).max(300),
});

// Tipo (ATACADO/VAREJO/OUTRO) e regiões de atendimento do representante.
// ADMIN edita qualquer representante; SUPERVISOR somente os da própria equipe.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, role: true, supervisorId: true, deletedAt: true, sellerProfile: { select: { representativeType: true } } },
  });
  if (!target || target.deletedAt) return notFound("Usuário não encontrado.");
  if (target.role !== "REPRESENTANTE") return badRequest("Tipo e regiões se aplicam somente a representantes.");
  const allowed = user.role === "ADMIN" || (user.role === "SUPERVISOR" && canSupervisorConfigureSeller(user.id, target));
  if (!allowed) return forbidden("Você só pode configurar representantes da sua equipe.");

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const { regions, invalid } = normalizeRegions(parsed.data.regions);
  if (invalid.length) return badRequest(`UF inválida: ${invalid.join(", ")}.`);

  const current = await prisma.representativeRegion.findMany({ where: { userId: id }, select: { id: true, state: true, city: true } });
  const key = (region: { state: string; city: string }) => `${region.state}|${region.city}`;
  const wanted = new Set(regions.map(key));
  const existing = new Set(current.map(key));
  const removed = current.filter((region) => !wanted.has(key(region)));
  const added = regions.filter((region) => !existing.has(key(region)));

  await prisma.$transaction(async (tx) => {
    await tx.sellerProfile.upsert({
      where: { userId: id },
      update: { representativeType: parsed.data.representativeType },
      create: { userId: id, displayName: target.name, representativeType: parsed.data.representativeType },
    });
    if (removed.length) await tx.representativeRegion.deleteMany({ where: { id: { in: removed.map((region) => region.id) } } });
    if (added.length) await tx.representativeRegion.createMany({ data: added.map((region) => ({ userId: id, ...region })), skipDuplicates: true });
  });

  await logAudit({
    actorId: user.id,
    action: "REPRESENTATIVE_PROFILE_UPDATED",
    entityType: "User",
    entityId: id,
    metadata: {
      representativeType: { from: target.sellerProfile?.representativeType ?? null, to: parsed.data.representativeType },
      regionsAdded: added.map(key),
      regionsRemoved: removed.map(key),
    },
  });

  return NextResponse.json({ representativeType: parsed.data.representativeType, regions });
}
