import "server-only";
import type { CommercialBrand, PriceGroup, PriceTier, PricingQuantityRule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getVisibleSellerIds, type SessionUser } from "@/lib/authz";
import {
  PricingError,
  isPriceTier,
  pickEffectiveTable,
  priceGroupForRole,
  priceQuote,
  type LoadedPriceTable,
  type PricingResult,
} from "@/lib/pricing/pricing-rules";

// Serviço central de precificação de atacado. Fonte oficial de preços do CRM:
// o grupo comercial vem do cargo do vendedor responsável (banco), a tabela
// vem da versão PUBLISHED vigente (banco) e o preço do navegador nunca é
// usado — só auditado quando diverge.

const BRANDS: readonly CommercialBrand[] = ["MIBRO", "SINCROFIT"];

export function isCommercialBrand(value: unknown): value is CommercialBrand {
  return typeof value === "string" && (BRANDS as readonly string[]).includes(value);
}

/** Carrega a versão PUBLISHED vigente da marca + grupo no instante `at`. */
export async function loadEffectivePriceTable(
  brand: CommercialBrand,
  priceGroup: PriceGroup,
  at: Date = new Date()
): Promise<LoadedPriceTable & { effectiveFrom: Date }> {
  const candidates = await prisma.priceTable.findMany({
    where: { brand, priceGroup, status: "PUBLISHED", effectiveFrom: { lte: at } },
    orderBy: { effectiveFrom: "desc" },
    take: 1,
    include: { entries: { select: { productId: true, tier: true, unitPriceCents: true } } },
  });
  const table = pickEffectiveTable(candidates, at);
  if (!table) {
    throw new PricingError(
      "Não há tabela de preços publicada para esta marca e grupo comercial.",
      "PRICE_TABLE_NOT_CONFIGURED",
      { brand, priceGroup }
    );
  }

  const prices = new Map<string, Partial<Record<PriceTier, number>>>();
  for (const entry of table.entries) {
    const current = prices.get(entry.productId) ?? {};
    current[entry.tier] = entry.unitPriceCents;
    prices.set(entry.productId, current);
  }
  return { id: table.id, version: table.version, priceGroup, prices, effectiveFrom: table.effectiveFrom };
}

/**
 * Carrega uma versão específica (proposta retomada mantém a tabela com que
 * foi calculada). Rascunhos nunca precificam; marca e grupo precisam bater.
 */
export async function loadPriceTableById(
  id: string,
  brand: CommercialBrand,
  priceGroup: PriceGroup
): Promise<(LoadedPriceTable & { effectiveFrom: Date }) | null> {
  const table = await prisma.priceTable.findUnique({
    where: { id },
    include: { entries: { select: { productId: true, tier: true, unitPriceCents: true } } },
  });
  if (!table || table.status === "DRAFT" || table.brand !== brand || table.priceGroup !== priceGroup) return null;
  const prices = new Map<string, Partial<Record<PriceTier, number>>>();
  for (const entry of table.entries) {
    const current = prices.get(entry.productId) ?? {};
    current[entry.tier] = entry.unitPriceCents;
    prices.set(entry.productId, current);
  }
  return { id: table.id, version: table.version, priceGroup, prices, effectiveFrom: table.effectiveFrom };
}

export interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  imageUrl: string | null;
  variants: Array<{ id: string; sku: string; colorName: string }>;
  prices: Partial<Record<PriceTier, number>>;
}

export interface SellerCatalog {
  brand: CommercialBrand;
  priceGroup: PriceGroup;
  table: { id: string; version: number; effectiveFrom: string; publishedAt: string | null } | null;
  /** Versão vigente agora (difere de table.version quando a proposta fixou uma versão antiga). */
  effectiveVersion: number | null;
  products: CatalogProduct[];
}

/**
 * Catálogo ativo da marca com os preços do grupo do vendedor responsável.
 * Mesma autorização de resolveWholesalePrice; nunca expõe o outro grupo.
 */
export async function getSellerCatalog(
  actor: SessionUser,
  sellerId: string,
  brand: CommercialBrand,
  options: { pinnedPriceTableId?: string | null; at?: Date } = {}
): Promise<SellerCatalog> {
  const { priceGroup } = await resolvePriceGroupForSeller(actor, sellerId);
  const pinned = options.pinnedPriceTableId ? await loadPriceTableById(options.pinnedPriceTableId, brand, priceGroup) : null;
  let effective: (LoadedPriceTable & { effectiveFrom: Date }) | null = null;
  try {
    effective = await loadEffectivePriceTable(brand, priceGroup, options.at);
  } catch (error) {
    if (!(error instanceof PricingError)) throw error;
  }
  const table = pinned ?? effective;
  const [meta, products] = await Promise.all([
    table ? prisma.priceTable.findUnique({ where: { id: table.id }, select: { publishedAt: true } }) : null,
    prisma.product.findMany({
      where: { brand, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, category: true, imageUrl: true,
        variants: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { sku: "asc" }], select: { id: true, sku: true, colorName: true } },
      },
    }),
  ]);

  return {
    brand,
    priceGroup,
    table: table
      ? { id: table.id, version: table.version, effectiveFrom: table.effectiveFrom.toISOString(), publishedAt: meta?.publishedAt?.toISOString() ?? null }
      : null,
    effectiveVersion: effective?.version ?? null,
    products: products
      .filter((p) => p.variants.length > 0)
      .map((p) => ({ ...p, prices: table?.prices.get(p.id) ?? {} })),
  };
}

/**
 * Resolve o grupo comercial que o ATOR pode usar ao cotar para `sellerId`.
 * O ator precisa enxergar o vendedor responsável (mesmo escopo do RBAC de
 * clientes): representante/vendedor só a si mesmo, supervisor a própria
 * equipe, admin todos. O grupo é sempre o do responsável — nunca do payload.
 */
export async function resolvePriceGroupForSeller(
  actor: SessionUser,
  sellerId: string
): Promise<{ priceGroup: PriceGroup; sellerId: string }> {
  const visible = await getVisibleSellerIds(actor);
  if (visible !== null && !visible.includes(sellerId)) {
    throw new PricingError("Você não tem acesso às condições comerciais deste vendedor.", "SELLER_FORBIDDEN");
  }
  const seller = await prisma.user.findFirst({
    where: { id: sellerId, active: true, deletedAt: null },
    select: { id: true, role: true },
  });
  if (!seller) {
    throw new PricingError("Vendedor responsável inativo ou inexistente.", "SELLER_NOT_FOUND");
  }
  return { priceGroup: priceGroupForRole(seller.role), sellerId: seller.id };
}

export interface ResolveWholesalePriceInput {
  actor: SessionUser;
  /** Vendedor responsável pela cotação (normalmente customer.sellerId). */
  sellerId: string;
  brand: unknown;
  items: Array<{ sku: unknown; quantity: unknown; clientUnitPriceCents?: unknown }>;
  /** null/"AUTO" = automático. */
  requestedTier?: unknown;
  discountCents?: unknown;
  /**
   * Decidida no servidor (histórico de pedidos aprovados no Olist — fase E).
   * Nunca repassar um valor vindo do navegador.
   */
  quantityRule?: PricingQuantityRule;
  /** Contexto para auditoria de divergências. */
  quoteId?: string | null;
  /**
   * Versão fixada da proposta (retomada). Ignorada se não pertencer à mesma
   * marca + grupo — nesse caso usa-se a vigente.
   */
  pinnedPriceTableId?: string | null;
  at?: Date;
}

export interface ResolvedWholesalePrice extends PricingResult {
  brand: CommercialBrand;
  sellerId: string;
  priceTableEffectiveFrom: Date;
}

function toInteger(value: unknown): number {
  return typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
}

/**
 * Ponto único de cálculo de preço de atacado no CRM:
 * autentica (actor vem de requireSession) → cargo do responsável → grupo →
 * marca → SKUs ativos → faixa automática/manual → tabela vigente → desconto
 * → subtotais → auditoria de divergência.
 */
export async function resolveWholesalePrice(input: ResolveWholesalePriceInput): Promise<ResolvedWholesalePrice> {
  if (!isCommercialBrand(input.brand)) {
    throw new PricingError("Marca inválida.", "INVALID_BRAND");
  }
  const brand = input.brand;

  const rawTier = input.requestedTier ?? null;
  const requestedTier = rawTier === null || rawTier === "AUTO" ? null : rawTier;
  if (requestedTier !== null && !isPriceTier(requestedTier)) {
    throw new PricingError("A faixa manual informada é inválida.", "INVALID_PRICE_TIER");
  }

  const discountCents = input.discountCents === undefined || input.discountCents === null ? 0 : toInteger(input.discountCents);

  const { priceGroup, sellerId } = await resolvePriceGroupForSeller(input.actor, input.sellerId);

  const items = input.items.map((item) => ({
    sku: String(item.sku ?? "").trim().toUpperCase(),
    quantity: toInteger(item.quantity),
    clientUnitPriceCents:
      item.clientUnitPriceCents === undefined || item.clientUnitPriceCents === null
        ? null
        : toInteger(item.clientUnitPriceCents),
  }));

  const variants = await prisma.productVariant.findMany({
    where: { brand, sku: { in: items.map((i) => i.sku) } },
    select: {
      id: true,
      sku: true,
      colorName: true,
      active: true,
      product: { select: { id: true, name: true, active: true } },
    },
  });
  const bySku = new Map(variants.map((v) => [v.sku, v]));

  const lines = items.map((item) => {
    const variant = bySku.get(item.sku);
    if (!variant || !variant.active || !variant.product.active) {
      throw new PricingError(
        `O SKU ${item.sku || "informado"} não está disponível no catálogo ${brand === "MIBRO" ? "Mibro" : "Sincrofit"}.`,
        "SKU_NOT_CONFIGURED",
        { sku: item.sku, brand }
      );
    }
    return {
      sku: variant.sku,
      variantId: variant.id,
      colorName: variant.colorName,
      productId: variant.product.id,
      productName: variant.product.name,
      quantity: item.quantity,
      clientUnitPriceCents: item.clientUnitPriceCents,
    };
  });

  const at = input.at ?? new Date();
  const pinned = input.pinnedPriceTableId ? await loadPriceTableById(input.pinnedPriceTableId, brand, priceGroup) : null;
  const table = pinned ?? (await loadEffectivePriceTable(brand, priceGroup, at));

  const result = priceQuote({
    priceGroup,
    table,
    lines,
    requestedTier,
    quantityRule: input.quantityRule ?? "MIX",
    discountCents,
  });

  if (result.mismatches.length > 0) {
    await logAudit({
      actorId: input.actor.id,
      action: "PRICE_MISMATCH_DETECTED",
      entityType: input.quoteId ? "Quote" : "PriceTable",
      entityId: input.quoteId ?? table.id,
      metadata: {
        brand,
        priceGroup,
        sellerId,
        priceTableId: table.id,
        priceTableVersion: table.version,
        selectedTier: requestedTier,
        mismatches: result.mismatches.map((m) => ({ ...m })),
      },
    });
  }

  return { ...result, brand, sellerId, priceTableEffectiveFrom: table.effectiveFrom };
}
