import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/api-auth";
import { canManagePriceTables } from "@/lib/pricing/price-admin-rules";
import { updateProduct } from "@/lib/pricing/price-admin";
import { pricingErrorResponse } from "@/lib/pricing/api-errors";

// SKU não é editável: é a chave da integração Olist.
const schema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  category: z.string().trim().min(2).max(60).optional(),
  imageUrl: z.string().trim().url().max(1000).refine((u) => u.startsWith("https://"), "Use uma URL https.").nullable().optional(),
  active: z.boolean().optional(),
  variants: z
    .array(z.object({ id: z.string().min(1), colorName: z.string().trim().min(1).max(60).optional(), active: z.boolean().optional() }))
    .max(50)
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (!canManagePriceTables(user.role)) return forbidden("Apenas administradores alteram produtos.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  try {
    await updateProduct(user, (await params).id, parsed.data);
    return NextResponse.json({ success: true });
  } catch (e) {
    return pricingErrorResponse(e);
  }
}
