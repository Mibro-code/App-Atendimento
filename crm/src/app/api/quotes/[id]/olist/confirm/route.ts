import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { pricingErrorResponse } from "@/lib/pricing/api-errors";
import { confirmRealOrder } from "@/lib/olist/real-order";

/** Envia o pedido para aprovação (marcador PARA ANÁLISE no Olist). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireSession();
  if (error) return error;
  try {
    return NextResponse.json(await confirmRealOrder(user, (await params).id));
  } catch (e) {
    return pricingErrorResponse(e);
  }
}
