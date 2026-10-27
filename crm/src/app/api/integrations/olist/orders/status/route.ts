import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireShopifyBrand } from "@/lib/api-auth";
import { syncOlistOrderStatus } from "@/lib/olist-order-status";

const schema = z.object({
  olistOrderId: z.string().trim().min(1).max(100),
  status: z.string().trim().min(1).max(200),
  approvedAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  const auth = requireShopifyBrand(req);
  if (!auth.ok) return auth.error;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, code: "INVALID_BODY", message: "Status do pedido inválido.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await syncOlistOrderStatus({
    brand: auth.brand,
    externalOrderId: parsed.data.olistOrderId,
    statusRaw: parsed.data.status,
    approvedAt: parsed.data.approvedAt ? new Date(parsed.data.approvedAt) : undefined,
  });
  if (!result.found) {
    return NextResponse.json(
      { success: false, code: "OLIST_ORDER_NOT_FOUND", message: "Pedido Olist ainda não registrado no CRM." },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, ...result });
}
