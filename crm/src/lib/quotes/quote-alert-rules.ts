// Texto do aviso ao supervisor quando alguém da equipe faz uma cotação.

import type { CommercialBrand, PriceGroup, PriceTier, ProposalMode, QuoteOrigin } from "@prisma/client";

const BRAND: Record<CommercialBrand, string> = { MIBRO: "Mibro", SINCROFIT: "Sincrofit" };
const TIER: Record<PriceTier, string> = { TIER1: "Tabela 1", TIER2: "Tabela 2", TIER3: "Tabela 3" };

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export interface QuoteAlertInput {
  sellerName: string;
  customerName: string;
  brand: CommercialBrand;
  mode: ProposalMode;
  origin: QuoteOrigin;
  totalValueCents: number | null;
  priceGroup: PriceGroup | null;
  selectedTier: PriceTier | null;
}

export function quoteAlertText(q: QuoteAlertInput): { title: string; message: string } {
  const kind = q.mode === "REAL" ? "Cotação real" : "Simulação";
  const conditions = [
    q.priceGroup === "REPRESENTATIVE" ? "tabela de representantes" : q.priceGroup === "STANDARD" ? "tabela de vendedores" : null,
    q.selectedTier ? `${TIER[q.selectedTier]} manual` : null,
    q.origin === "SHOPIFY" ? "via Shopify" : null,
  ].filter(Boolean);
  return {
    title: `${kind} ${BRAND[q.brand]} de ${q.sellerName}`,
    message:
      `${q.customerName}` +
      (q.totalValueCents ? ` · ${brl(q.totalValueCents)}` : "") +
      (conditions.length ? ` · ${conditions.join(" · ")}` : ""),
  };
}

/** Uma notificação por proposta, mesmo que seja recalculada ou sincronizada de novo. */
export function quoteAlertDedupeKey(quoteId: string): string {
  return `quote-created:${quoteId}`;
}
