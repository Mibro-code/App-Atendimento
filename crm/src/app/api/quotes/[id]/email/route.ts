import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, validationFailed } from "@/lib/api-auth";
import { pricingErrorResponse } from "@/lib/pricing/api-errors";
import { emailProposal } from "@/lib/olist/real-order";

const schema = z.object({ to: z.string().trim().max(200).nullable().optional() });

/** Envia a proposta por e-mail ao cliente (cópia para o comercial). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationFailed({ to: "E-mail inválido." });
  try {
    return NextResponse.json(await emailProposal(user, (await params).id, parsed.data.to ?? null));
  } catch (e) {
    return pricingErrorResponse(e);
  }
}
