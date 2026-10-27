import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireShopifyBrand } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { resolveQuoteSessionToken, ResolveQuoteSessionError } from "@/lib/crm-session";

// Fase 2 — Integração CRM → Shopify (lado CRM).
//
// Endpoint service-to-service: será chamado pelo app Shopify (fora deste
// repositório, fora de escopo agora) para trocar o token recebido via
// "?crm_session=<token>" pelos dados de cliente/vendedor que pré-preenchem a
// calculadora de atacado. Autenticado por segredo compartilhado (Bearer),
// nunca por sessão de usuário do CRM.
const bodySchema = z.object({
  token: z.string().min(1, "token é obrigatório."),
});

const ERROR_STATUS: Record<string, number> = {
  INVALID_TOKEN: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_ALREADY_USED: 409,
  TOKEN_NOT_FOUND: 401,
  CUSTOMER_OR_SELLER_NOT_FOUND: 404,
  BRAND_MISMATCH: 403,
};

export async function POST(req: NextRequest) {
  const auth = requireShopifyBrand(req);
  if (!auth.ok) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, code: "INVALID_BODY", message: "Corpo da requisição inválido: informe { token }." },
      { status: 400 }
    );
  }

  try {
    const resolved = await resolveQuoteSessionToken(parsed.data.token, auth.brand);

    // Ator externo (app Shopify), não um User do CRM: actorId null, origem
    // registrada em metadata (AuditLog.actorId é opcional na Fase 1).
    await logAudit({
      actorId: null,
      action: "QUOTE_SESSION_RESOLVED",
      entityType: "Customer",
      entityId: resolved.customer.id,
      metadata: { sellerId: resolved.seller.id, brand: resolved.brand, source: "shopify-app" },
    });

    return NextResponse.json({
      success: true,
      mode: resolved.mode,
      brand: resolved.brand,
      customer: resolved.customer,
      seller: resolved.seller,
      resumeQuote: resolved.resumeQuote,
    });
  } catch (err) {
    if (err instanceof ResolveQuoteSessionError) {
      const status = ERROR_STATUS[err.code] ?? 400;
      return NextResponse.json({ success: false, code: err.code, message: err.message }, { status });
    }
    throw err;
  }
}
