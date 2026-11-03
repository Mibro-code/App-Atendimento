import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { forbidden, requireSession, validationFailed } from "@/lib/api-auth";
import { canManagePriceTables } from "@/lib/pricing/price-admin-rules";
import { publishDraft } from "@/lib/pricing/price-admin";
import { pricingErrorResponse } from "@/lib/pricing/api-errors";

const schema = z.object({
  reason: z.string().max(500),
  // ISO (UTC) calculado pela tela a partir do horário de São Paulo; ausente = agora.
  effectiveFrom: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (!canManagePriceTables(user.role)) return forbidden("Apenas administradores publicam tabelas de preço.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationFailed({ effectiveFrom: "Data de vigência inválida." });
  const now = new Date();
  try {
    const result = await publishDraft(
      user,
      (await params).id,
      { reason: parsed.data.reason, effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : now },
      now
    );
    return NextResponse.json(result);
  } catch (e) {
    return pricingErrorResponse(e);
  }
}
