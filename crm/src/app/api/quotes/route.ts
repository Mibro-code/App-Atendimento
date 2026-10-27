import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { getCustomerScopeFilter } from "@/lib/authz";

// Propostas (simulações e cotações reais) só chegam ao CRM via o fluxo
// CRM -> crm_session -> Shopify -> POST /api/integrations/shopify/quotes/upsert
// (autenticado por segredo compartilhado, ver essa rota e
// docs/SHOPIFY-PROPOSAL-INTEGRATION.md). Não existe (e não deve existir)
// criação de proposta diretamente pelo frontend do CRM — isso pularia o
// cálculo real de preços/impostos feito na calculadora Shopify.

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const scope = await getCustomerScopeFilter(user);

  const quotes = await prisma.quote.findMany({
    where: { deletedAt: null, customer: scope },
    include: { customer: { select: { id: true, contactName: true, tradeName: true } }, seller: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ quotes });
}
