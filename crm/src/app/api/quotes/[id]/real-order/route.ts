import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { pricingErrorResponse } from "@/lib/pricing/api-errors";
import { convertToRealOrder } from "@/lib/olist/real-order";

/** Gera o pedido real a partir da simulação concluída (a simulação é preservada). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  try {
    return NextResponse.json(await convertToRealOrder(user, (await params).id));
  } catch (e) {
    return pricingErrorResponse(e);
  }
}
