import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, forbidden, notFound, badRequest } from "@/lib/api-auth";
import { canAccessCustomer } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { createQuoteSessionToken } from "@/lib/crm-session";
import { getShopifyWholesaleUrl, QUOTE_SESSION_TTL_MINUTES } from "@/lib/config";
import { locationInputSchema, buildLocationCaptureData } from "@/lib/location";

// Fase 2 — Integração CRM → Shopify (lado CRM).
//
// Autenticado pela sessão normal do CRM (NextAuth) — NÃO pelo segredo
// compartilhado, que é usado apenas pelo endpoint service-to-service em
// /api/integrations/shopify/session/resolve. RBAC reaproveita
// canAccessCustomer (mesma política de escopo já usada nas outras rotas de
// cliente: vendedor só o próprio cliente, supervisor a equipe, admin tudo).
//
// "mode" (SIMULATION/REAL) e "resumeQuoteId" (reabrir uma proposta existente
// ou transformar uma simulação em cotação real) são decididos aqui, no
// servidor, a partir do corpo desta requisição autenticada — nunca lidos de
// query params da página Shopify, que são editáveis pelo navegador.
//
// Localização (item 1 do plano de localização da proposta): opcional,
// enviada só quando o vendedor clicou "Permitir localização" no consentimento
// próprio do CRM (CreateProposalPanel) — nunca solicitada sem essa ação.
// sellerId/customerId do LocationCapture vêm da SESSÃO autenticada e do
// Customer já validado por canAccessCustomer logo abaixo, nunca do corpo da
// requisição — "location" aqui só carrega dado geográfico, nunca ids.
const bodySchema = z.object({
  // Empresa explícita: clientes antigos/incompletos não podem cair na Mibro.
  brand: z.enum(["MIBRO", "SINCROFIT"]),
  mode: z.enum(["SIMULATION", "REAL"]).default("REAL"),
  resumeQuoteId: z.string().min(1).optional(),
  location: locationInputSchema.optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return badRequest("Dados inválidos.", parsed.error.flatten());
  }
  const { brand, mode, resumeQuoteId, location } = parsed.data;

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, sellerId: true },
  });
  if (!customer) return notFound("Cliente não encontrado.");
  if (!(await canAccessCustomer(user, customer.sellerId))) return forbidden();

  if (resumeQuoteId) {
    const resumeQuote = await prisma.quote.findUnique({
      where: { id: resumeQuoteId, deletedAt: null },
      select: { id: true, customerId: true, brand: true },
    });
    // Nunca confiar no resumeQuoteId enviado pelo cliente sem checar que a
    // proposta pertence a este mesmo cliente.
    if (!resumeQuote || resumeQuote.customerId !== customer.id || resumeQuote.brand !== brand) {
      return badRequest("Proposta informada não pertence a este cliente.");
    }
  }

  const shopifyWholesaleUrl = getShopifyWholesaleUrl(brand);
  if (!shopifyWholesaleUrl) {
    return NextResponse.json(
      { error: `A calculadora da empresa ${brand === "MIBRO" ? "Mibro" : "Sincrofit"} não está configurada neste ambiente.` },
      { status: 500 }
    );
  }

  // Captura de localização no início da proposta (PROPOSAL_STARTED, item 1).
  // Ainda não existe Quote neste momento (só nasce quando o Shopify
  // sincroniza o cálculo) — quoteId fica nulo de propósito; a captura de
  // localização "oficial" da proposta é a do envio (PROPOSAL_SENT, item 10),
  // vinculada à Quote real via api/integrations/shopify/quotes/upsert.
  if (location) {
    await prisma.locationCapture.create({
      data: buildLocationCaptureData({
        location, sellerId: user.id, customerId: customer.id, locationSource: "PROPOSAL_STARTED",
      }),
    });
    // Metadata segura (item 21): nunca duplica lat/lng aqui — isso já fica
    // só no LocationCapture; o audit log guarda só o status/precisão/origem.
    await logAudit({
      actorId: user.id,
      action: "PROPOSAL_LOCATION_CAPTURED",
      entityType: "Customer",
      entityId: customer.id,
      metadata: {
        locationStatus: location.status,
        locationSource: "PROPOSAL_STARTED",
        accuracyMeters: location.status === "GRANTED" ? location.accuracyMeters ?? null : null,
      },
    });
  }

  const { token, expiresAt } = await createQuoteSessionToken({
    brand,
    customerId: customer.id,
    sellerId: customer.sellerId,
    createdById: user.id,
    mode,
    resumeQuoteId: resumeQuoteId ?? null,
  });

  await logAudit({
    actorId: user.id,
    action: "QUOTE_SESSION_CREATED",
    entityType: "Customer",
    entityId: customer.id,
    metadata: {
      sellerId: customer.sellerId,
      expiresAt: expiresAt.toISOString(),
      mode,
      brand,
      resumeQuoteId: resumeQuoteId ?? null,
    },
  });

  const url = `${shopifyWholesaleUrl}${shopifyWholesaleUrl.includes("?") ? "&" : "?"}crm_session=${encodeURIComponent(
    token
  )}`;

  return NextResponse.json({
    url,
    expiresAt: expiresAt.toISOString(),
    ttlMinutes: QUOTE_SESSION_TTL_MINUTES,
    mode,
    brand,
  });
}
