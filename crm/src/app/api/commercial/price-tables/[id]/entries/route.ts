import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/api-auth";
import { canManagePriceTables } from "@/lib/pricing/price-admin-rules";
import { saveDraftEntries } from "@/lib/pricing/price-admin";
import { pricingErrorResponse } from "@/lib/pricing/api-errors";

const schema = z.object({
  entries: z
    .array(
      z.object({
        productId: z.string().min(1),
        tier: z.enum(["TIER1", "TIER2", "TIER3"]),
        // Centavos inteiros; null = faixa sem preço.
        unitPriceCents: z.number().int().nullable(),
      })
    )
    .max(1000),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (!canManagePriceTables(user.role)) return forbidden("Apenas administradores alteram tabelas de preço.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  try {
    return NextResponse.json(await saveDraftEntries(user, (await params).id, parsed.data.entries));
  } catch (e) {
    return pricingErrorResponse(e);
  }
}
