// Regras puras da precificação de atacado (sem banco, sem sessão). Portadas
// do app Shopify (wholesale-pricing / wholesale-order-values) para que a
// calculadora nativa do CRM produza exatamente os mesmos valores enviados ao
// Olist. A camada server (lib/pricing/pricing.ts) carrega a tabela vigente e
// o cargo do vendedor do banco e chama estas funções.

import type { PriceGroup, PriceTier, PricingQuantityRule, Role } from "@prisma/client";

export const PRICE_TIERS: readonly PriceTier[] = ["TIER1", "TIER2", "TIER3"];

/** Limite de sanidade por linha, só para barrar payloads absurdos. */
export const MAX_LINE_QUANTITY = 100_000;

export const TIER_LABELS: Record<PriceTier, string> = {
  TIER1: "Tabela 1 — 1 a 49 unidades",
  TIER2: "Tabela 2 — 50 a 99 unidades",
  TIER3: "Tabela 3 — 100+ unidades",
};

export class PricingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PricingError";
  }
}

/** Sem pedido mínimo: 1–49 TIER1, 50–99 TIER2, 100+ TIER3. */
export function tierForQuantity(quantity: number): PriceTier | null {
  if (!Number.isInteger(quantity) || quantity < 1) return null;
  if (quantity >= 100) return "TIER3";
  if (quantity >= 50) return "TIER2";
  return "TIER1";
}

/**
 * Grupo comercial pelo cargo do VENDEDOR RESPONSÁVEL pela cotação. Nunca é
 * aceito do navegador: representante sempre usa REPRESENTATIVE; vendedor,
 * supervisor e admin vendendo diretamente usam STANDARD.
 */
export function priceGroupForRole(role: Role): PriceGroup {
  return role === "REPRESENTANTE" ? "REPRESENTATIVE" : "STANDARD";
}

export function isPriceTier(value: unknown): value is PriceTier {
  return typeof value === "string" && (PRICE_TIERS as readonly string[]).includes(value);
}

/** Preços de um modelo por faixa, em centavos (faixa ausente = não configurada). */
export type TierPrices = Partial<Record<PriceTier, number>>;

export interface LoadedPriceTable {
  id: string;
  version: number;
  priceGroup: PriceGroup;
  /** productId -> preços por faixa */
  prices: Map<string, TierPrices>;
}

export interface PricingLineInput {
  sku: string;
  productId: string;
  productName: string;
  colorName?: string | null;
  variantId?: string | null;
  quantity: number;
  /** Preço que o navegador exibiu. Nunca é usado; só auditado. */
  clientUnitPriceCents?: number | null;
}

export interface PricingInput {
  priceGroup: PriceGroup;
  table: LoadedPriceTable;
  lines: PricingLineInput[];
  /** Faixa escolhida manualmente; null = automática. */
  requestedTier: PriceTier | null;
  quantityRule: PricingQuantityRule;
  discountCents: number;
}

export interface PricedLine extends PricingLineInput {
  automaticTier: PriceTier;
  appliedTier: PriceTier;
  manualTier: boolean;
  unitPriceCents: number;
  lineSubtotalCents: number;
  lineDiscountCents: number;
  /** Valor unitário enviado ao Olist (com desconto rateado), 6 casas como no app Shopify. */
  olistUnitPrice: number;
}

export interface PriceMismatch {
  sku: string;
  expectedUnitPriceCents: number;
  receivedUnitPriceCents: number;
}

export interface PricingResult {
  priceGroup: PriceGroup;
  priceTableId: string;
  priceTableVersion: number;
  quantityRule: PricingQuantityRule;
  selectedTier: PriceTier | null;
  /** Faixa automática do pedido inteiro (pela soma total). */
  orderAutomaticTier: PriceTier;
  totalQuantity: number;
  lines: PricedLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  mismatches: PriceMismatch[];
}

function assertLines(lines: PricingLineInput[]) {
  if (lines.length === 0) {
    throw new PricingError("Adicione ao menos um produto.", "EMPTY_QUOTE");
  }
  const seen = new Set<string>();
  for (const line of lines) {
    const sku = line.sku.trim().toUpperCase();
    if (seen.has(sku)) {
      throw new PricingError(`O SKU ${sku} aparece mais de uma vez.`, "DUPLICATE_SKU", { sku });
    }
    seen.add(sku);
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) {
      throw new PricingError(`Quantidade inválida para ${sku}.`, "INVALID_QUANTITY", {
        sku,
        quantity: line.quantity,
      });
    }
  }
}

/**
 * Rateio do desconto nos itens — mesma regra do app Shopify
 * (allocateCommercialItemPrices): proporcional ao subtotal da linha, com os
 * centavos restantes distribuídos pelos maiores restos (desempate pela ordem).
 */
export function allocateDiscount(
  lines: Array<{ quantity: number; unitPriceCents: number }>,
  discountCents: number
): Array<{ lineTotalCents: number; lineDiscountCents: number; unitPrice: number }> {
  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
  const total = subtotal - discountCents;

  const allocations = lines.map((line, index) => {
    const lineSubtotal = line.quantity * line.unitPriceCents;
    const exact = subtotal > 0 ? (lineSubtotal * total) / subtotal : lineSubtotal;
    const floor = Math.floor(exact);
    return { index, quantity: line.quantity, lineSubtotal, lineTotalCents: floor, remainder: exact - floor };
  });

  let remaining = total - allocations.reduce((sum, a) => sum + a.lineTotalCents, 0);
  [...allocations]
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach((a) => {
      if (remaining <= 0) return;
      a.lineTotalCents += 1;
      remaining -= 1;
    });

  return allocations.map((a) => ({
    lineTotalCents: a.lineTotalCents,
    lineDiscountCents: a.lineSubtotal - a.lineTotalCents,
    unitPrice: Number((a.lineTotalCents / a.quantity / 100).toFixed(6)),
  }));
}

/**
 * Calcula a cotação inteira a partir da tabela vigente já carregada.
 * - Faixa automática: pela soma do pedido (MIX) ou por modelo (PER_MODEL).
 * - Faixa manual: substitui a automática para todas as linhas, sempre dentro
 *   do MESMO grupo comercial (a tabela já vem do grupo do vendedor).
 * - Preço do navegador nunca é usado; divergências são devolvidas em
 *   `mismatches` para auditoria.
 */
export function priceQuote(input: PricingInput): PricingResult {
  const { table, lines, requestedTier, quantityRule } = input;

  if (table.priceGroup !== input.priceGroup) {
    // Defesa em profundidade: a camada server nunca deve misturar grupos.
    throw new PricingError("Tabela de preços incompatível com o grupo comercial.", "PRICE_GROUP_MISMATCH");
  }
  if (requestedTier !== null && !isPriceTier(requestedTier)) {
    throw new PricingError("A faixa manual informada é inválida.", "INVALID_PRICE_TIER");
  }
  assertLines(lines);

  const totalQuantity = lines.reduce((sum, l) => sum + l.quantity, 0);
  const orderAutomaticTier = tierForQuantity(totalQuantity)!;

  const perModelQuantity = new Map<string, number>();
  for (const line of lines) {
    perModelQuantity.set(line.productId, (perModelQuantity.get(line.productId) ?? 0) + line.quantity);
  }

  const priced = lines.map((line) => {
    const automaticQuantity = quantityRule === "PER_MODEL" ? perModelQuantity.get(line.productId)! : totalQuantity;
    const automaticTier = tierForQuantity(automaticQuantity)!;
    const appliedTier = requestedTier ?? automaticTier;
    const unitPriceCents = table.prices.get(line.productId)?.[appliedTier];

    if (!unitPriceCents || !Number.isInteger(unitPriceCents) || unitPriceCents <= 0) {
      throw new PricingError(
        `A ${TIER_LABELS[appliedTier]} não está configurada para ${line.productName}.`,
        "PRICE_TIER_NOT_CONFIGURED",
        { sku: line.sku, productId: line.productId, tier: appliedTier, priceGroup: input.priceGroup }
      );
    }

    return {
      ...line,
      automaticTier,
      appliedTier,
      manualTier: requestedTier !== null,
      unitPriceCents,
      lineSubtotalCents: line.quantity * unitPriceCents,
    };
  });

  const subtotalCents = priced.reduce((sum, l) => sum + l.lineSubtotalCents, 0);
  const discountCents = input.discountCents;
  if (!Number.isSafeInteger(discountCents) || discountCents < 0 || discountCents >= subtotalCents) {
    throw new PricingError("O desconto deve ser maior ou igual a zero e menor que o subtotal.", "INVALID_DISCOUNT", {
      discountCents,
      subtotalCents,
    });
  }

  const allocations = allocateDiscount(priced, discountCents);
  const pricedLines: PricedLine[] = priced.map((line, i) => ({
    ...line,
    lineDiscountCents: allocations[i].lineDiscountCents,
    olistUnitPrice: allocations[i].unitPrice,
  }));

  const mismatches: PriceMismatch[] = pricedLines
    .filter(
      (l) =>
        l.clientUnitPriceCents !== undefined &&
        l.clientUnitPriceCents !== null &&
        l.clientUnitPriceCents !== l.unitPriceCents
    )
    .map((l) => ({
      sku: l.sku,
      expectedUnitPriceCents: l.unitPriceCents,
      receivedUnitPriceCents: Number(l.clientUnitPriceCents),
    }));

  return {
    priceGroup: input.priceGroup,
    priceTableId: table.id,
    priceTableVersion: table.version,
    quantityRule,
    selectedTier: requestedTier,
    orderAutomaticTier,
    totalQuantity,
    lines: pricedLines,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    mismatches,
  };
}

/** Chave de unicidade de versão publicada (ver PriceTable.publishedKey). */
export function publishedKeyFor(brand: string, priceGroup: PriceGroup, effectiveFrom: Date): string {
  return `${brand}:${priceGroup}:${effectiveFrom.toISOString()}`;
}

/**
 * Escolhe a versão vigente num instante: a PUBLISHED de maior effectiveFrom
 * que já começou. A vigência termina implicitamente quando a próxima começa.
 */
export function pickEffectiveTable<T extends { status: string; effectiveFrom: Date }>(
  tables: T[],
  at: Date
): T | null {
  return (
    tables
      .filter((t) => t.status === "PUBLISHED" && t.effectiveFrom.getTime() <= at.getTime())
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null
  );
}
