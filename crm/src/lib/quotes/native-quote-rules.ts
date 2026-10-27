// Regras puras da cotação nativa do CRM (calculadora /cotacoes/nova).

import type { PriceTier, QuoteStatus } from "@prisma/client";

/** Cotação nativa só é editável enquanto rascunho (ABERTA) ou simulação calculada. */
export const EDITABLE_NATIVE_STATUSES: readonly QuoteStatus[] = ["ABERTA", "CALCULADA"];

// Pedido real (mode REAL) não é editável na calculadora: só o cálculo no Olist
// regrava os itens. Para mudar condições, gera-se nova simulação.
export function isEditableNativeQuote(quote: { origin: string; mode: string; status: QuoteStatus; deletedAt: Date | null }): boolean {
  return quote.origin === "CRM" && quote.mode === "SIMULATION" && quote.deletedAt === null && EDITABLE_NATIVE_STATUSES.includes(quote.status);
}

/**
 * Status após salvar: concluir → CALCULADA; autosave mantém CALCULADA só se o
 * cálculo continua válido; caso contrário volta a rascunho (ABERTA).
 */
export function nextNativeQuoteStatus(input: {
  previous: QuoteStatus | null;
  finalize: boolean;
  pricingValid: boolean;
}): QuoteStatus {
  if (input.finalize) return "CALCULADA";
  if (input.previous === "CALCULADA" && input.pricingValid) return "CALCULADA";
  return "ABERTA";
}

/** Etapas do assistente (o usuário pode voltar a qualquer uma). */
export const QUOTE_STEPS = ["Cliente", "Marca", "Produtos", "Condições", "Resumo"] as const;

export interface NativeDraftState {
  step: number;
  /** sku -> quantidade (inclusive 0, para preservar o que foi digitado). */
  quantities: Record<string, number>;
  requestedTier: PriceTier | "AUTO";
  search?: string;
}

export interface SummaryLine {
  sku: string;
  productName: string;
  colorName?: string | null;
  quantity: number;
  unitPriceCents: number;
  lineSubtotalCents: number;
  appliedTier: PriceTier;
  automaticTier: PriceTier;
  manualTier: boolean;
}

/**
 * productsSummary no mesmo formato que o app Shopify envia (products[].sku,
 * name, variant, quantity, unitPriceCents, subtotalCents), para a tela de
 * detalhe e relatórios existentes funcionarem sem mudança.
 */
export function buildProductsSummary(
  lines: SummaryLine[],
  meta: { priceGroup: string; priceTableVersion: number; selectedTier: PriceTier | null }
) {
  return {
    origin: "CRM",
    priceGroup: meta.priceGroup,
    priceTableVersion: meta.priceTableVersion,
    selectedTier: meta.selectedTier,
    totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    products: lines.map((l) => ({
      sku: l.sku,
      name: l.productName,
      variant: l.colorName ?? null,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      subtotalCents: l.lineSubtotalCents,
      priceTier: l.appliedTier,
      automaticTier: l.automaticTier,
      manualTier: l.manualTier,
    })),
  };
}

/** Itens com quantidade > 0 a partir do estado do assistente. */
export function itemsFromQuantities(quantities: Record<string, number>): Array<{ sku: string; quantity: number }> {
  return Object.entries(quantities)
    .filter(([, qty]) => Number.isInteger(qty) && qty > 0)
    .map(([sku, quantity]) => ({ sku, quantity }));
}
