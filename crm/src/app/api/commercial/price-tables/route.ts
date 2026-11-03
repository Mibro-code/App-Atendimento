import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/api-auth";
import { canManagePriceTables, canViewPriceTables } from "@/lib/pricing/price-admin-rules";
import { createDraft, getBrandPriceOverview } from "@/lib/pricing/price-admin";
import { pricingErrorResponse } from "@/lib/pricing/api-errors";

const brandSchema = z.enum(["MIBRO", "SINCROFIT"]);

// Consulta das tabelas da marca (vigente, agendadas, rascunho, histórico).
export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (!canViewPriceTables(user.role)) return forbidden();
  const brand = brandSchema.safeParse(req.nextUrl.searchParams.get("brand"));
  if (!brand.success) return badRequest("Marca inválida.");
  return NextResponse.json(await getBrandPriceOverview(brand.data));
}

const createSchema = z.object({ brand: brandSchema, priceGroup: z.enum(["STANDARD", "REPRESENTATIVE"]) });

// Abre (ou reaproveita) o rascunho de edição da marca + grupo.
export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (!canManagePriceTables(user.role)) return forbidden("Apenas administradores alteram tabelas de preço.");
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  try {
    return NextResponse.json(await createDraft(user, parsed.data.brand, parsed.data.priceGroup));
  } catch (e) {
    return pricingErrorResponse(e);
  }
}
