import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { pricingErrorResponse } from "@/lib/pricing/api-errors";
import { calculateRealOrder } from "@/lib/olist/real-order";

/** Cria/atualiza o pedido em aberto no Olist com os preços validados pelo CRM. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  try {
    return NextResponse.json(await calculateRealOrder(user, (await params).id));
  } catch (e) {
    return pricingErrorResponse(e);
  }
}
