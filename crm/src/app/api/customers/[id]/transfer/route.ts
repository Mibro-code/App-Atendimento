import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, requireSession } from "@/lib/api-auth";
import { transferCustomer } from "@/lib/customer-transfer";

const schema = z.object({
  targetSellerId: z.string().min(1),
  reason: z.string().trim().max(500).optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Dados de repasse inválidos.", parsed.error.flatten());

  const result = await transferCustomer({
    actor: user,
    customerId: id,
    targetSellerId: parsed.data.targetSellerId,
    reason: parsed.data.reason,
  });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json({ transfer: result });
}
