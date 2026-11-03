import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/api-auth";
import { canManagePriceTables } from "@/lib/pricing/price-admin-rules";
import { archiveTable } from "@/lib/pricing/price-admin";
import { pricingErrorResponse } from "@/lib/pricing/api-errors";

const schema = z.object({ reason: z.string().max(500).optional().default("") });

// Descarta rascunho ou cancela publicação agendada que ainda não entrou em vigor.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  if (!canManagePriceTables(user.role)) return forbidden("Apenas administradores alteram tabelas de preço.");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest("Dados inválidos.");
  try {
    return NextResponse.json(await archiveTable(user, (await params).id, parsed.data.reason));
  } catch (e) {
    return pricingErrorResponse(e);
  }
}
