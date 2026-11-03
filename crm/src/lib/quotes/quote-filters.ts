// Filtros da lista de propostas (/cotacoes). Puros: a rota sempre combina o
// resultado com o escopo de RBAC (getCustomerScopeFilter) — filtro nunca
// amplia o que o usuário pode ver.

import type { CommercialBrand, PriceGroup, PriceTier, Prisma, ProposalMode, QuoteOrigin, QuoteStatus } from "@prisma/client";
import { zonedDate } from "../agenda-rules";

export const OPEN_STATUSES: QuoteStatus[] = ["ABERTA", "CALCULADA", "ENVIADA", "ENVIADA_PARA_ANALISE"];

const BRANDS: CommercialBrand[] = ["MIBRO", "SINCROFIT"];
const MODES: ProposalMode[] = ["SIMULATION", "REAL"];
const STATUSES: QuoteStatus[] = ["ABERTA", "CALCULADA", "ENVIADA", "ENVIADA_PARA_ANALISE", "CONVERTIDA", "CANCELADA", "EXPIRADA"];
const ORIGINS: QuoteOrigin[] = ["SHOPIFY", "CRM"];
const GROUPS: PriceGroup[] = ["STANDARD", "REPRESENTATIVE"];
const TIERS: PriceTier[] = ["TIER1", "TIER2", "TIER3"];

export interface QuoteFilters {
  brand?: CommercialBrand;
  mode?: ProposalMode;
  status?: QuoteStatus;
  open?: boolean;
  sellerId?: string;
  origin?: QuoteOrigin;
  priceGroup?: PriceGroup;
  tier?: PriceTier;
  manual?: boolean;
  from?: string; // YYYY-MM-DD (São Paulo)
  to?: string;
}

const pick = <T extends string>(list: readonly T[], value: string | undefined): T | undefined =>
  list.find((item) => item === value);
const dateKey = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);

export function parseQuoteFilters(params: Record<string, string | undefined>): QuoteFilters {
  return {
    brand: pick(BRANDS, params.brand),
    mode: pick(MODES, params.mode),
    status: pick(STATUSES, params.status),
    open: params.open === "1",
    sellerId: params.sellerId?.trim() || undefined,
    origin: pick(ORIGINS, params.origem),
    priceGroup: pick(GROUPS, params.grupo),
    tier: pick(TIERS, params.faixa),
    manual: params.manual === "1" ? true : params.manual === "0" ? false : undefined,
    from: dateKey(params.de),
    to: dateKey(params.ate),
  };
}

/** Converte os filtros em where do Prisma (sem escopo de RBAC). */
export function buildQuoteFilterWhere(f: QuoteFilters, options: { canFilterSeller: boolean }): Prisma.QuoteWhereInput {
  const and: Prisma.QuoteWhereInput[] = [];
  if (f.brand) and.push({ brand: f.brand });
  if (f.mode) and.push({ mode: f.mode });
  if (f.open) and.push({ status: { in: OPEN_STATUSES } });
  else if (f.status) and.push({ status: f.status });
  if (f.sellerId && options.canFilterSeller) and.push({ sellerId: f.sellerId });
  if (f.origin) and.push({ origin: f.origin });
  if (f.priceGroup) and.push({ priceGroup: f.priceGroup });
  if (f.tier) and.push({ items: { some: { appliedTier: f.tier } } });
  if (f.manual === true) and.push({ items: { some: { manualTier: true } } });
  if (f.manual === false) and.push({ items: { none: { manualTier: true } } });
  if (f.from || f.to) {
    and.push({
      createdAt: {
        ...(f.from ? { gte: zonedDate(f.from) } : {}),
        // "até" inclui o dia inteiro em São Paulo.
        ...(f.to ? { lt: new Date(zonedDate(f.to).getTime() + 86_400_000) } : {}),
      },
    });
  }
  return and.length ? { AND: and } : {};
}

/** Querystring canônica (para links de filtro que preservam os demais). */
export function quoteFiltersToQuery(f: QuoteFilters, overrides: Partial<Record<keyof QuoteFilters, string | undefined>> = {}): string {
  const entries: Array<[string, string | undefined]> = [
    ["brand", "brand" in overrides ? overrides.brand : f.brand],
    ["mode", "mode" in overrides ? overrides.mode : f.mode],
    ["status", "status" in overrides ? overrides.status : f.status],
    ["sellerId", "sellerId" in overrides ? overrides.sellerId : f.sellerId],
    ["origem", "origin" in overrides ? overrides.origin : f.origin],
    ["grupo", "priceGroup" in overrides ? overrides.priceGroup : f.priceGroup],
    ["faixa", "tier" in overrides ? overrides.tier : f.tier],
    ["manual", "manual" in overrides ? overrides.manual : f.manual === undefined ? undefined : f.manual ? "1" : "0"],
    ["de", "from" in overrides ? overrides.from : f.from],
    ["ate", "to" in overrides ? overrides.to : f.to],
  ];
  const params = new URLSearchParams();
  for (const [key, value] of entries) if (value && value !== "ALL") params.set(key, value);
  return params.toString();
}
