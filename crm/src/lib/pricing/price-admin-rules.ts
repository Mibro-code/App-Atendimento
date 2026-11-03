// Regras puras da Gestão Comercial de preços (sem banco). Usadas pelas rotas
// /api/commercial/* e pela tela /gestao-comercial/precos.

import type { PriceTier, Role } from "@prisma/client";
import { PRICE_TIERS } from "./pricing-rules";

export const MIN_CHANGE_REASON_LENGTH = 5;
export const MAX_UNIT_PRICE_CENTS = 100_000_00; // R$ 100.000,00 — trava de digitação
/** Tolerância para "publicar agora" (relógio do navegador x servidor). */
export const PUBLISH_PAST_TOLERANCE_MS = 5 * 60 * 1000;

/** Consulta: admin e supervisor. Edição/publicação: somente admin. */
export function canViewPriceTables(role: Role): boolean {
  return role === "ADMIN" || role === "SUPERVISOR";
}

export function canManagePriceTables(role: Role): boolean {
  return role === "ADMIN";
}

/**
 * Converte o texto digitado em reais para centavos inteiros, sem ponto
 * flutuante. Aceita "278", "278,5", "278,50", "1.278,50", "278.50".
 * Retorna null para vazio e NaN para inválido.
 */
export function parseReaisToCents(input: string): number | null {
  const text = input.trim().replace(/^R\$\s*/i, "");
  if (text === "") return null;
  let normalized: string;
  if (text.includes(",")) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(text)) return NaN;
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else {
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return NaN;
    normalized = text;
  }
  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Centavos → texto editável "278,50" (sem símbolo). */
export function centsToReaisInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole},${fraction}`;
}

export interface DraftEntryInput {
  productId: string;
  tier: PriceTier;
  /** null = faixa sem preço (não configurada). */
  unitPriceCents: number | null;
}

export type EntryErrors = Record<string, string>; // `${productId}:${tier}` -> mensagem

export function entryKey(productId: string, tier: PriceTier): string {
  return `${productId}:${tier}`;
}

/** Valida as linhas de um rascunho. `validProductIds` = produtos da marca. */
export function validateDraftEntries(entries: DraftEntryInput[], validProductIds: Set<string>): EntryErrors {
  const errors: EntryErrors = {};
  const seen = new Set<string>();
  for (const e of entries) {
    const key = entryKey(e.productId, e.tier);
    if (!validProductIds.has(e.productId)) {
      errors[key] = "Produto não pertence a esta marca.";
      continue;
    }
    if (!(PRICE_TIERS as readonly string[]).includes(e.tier)) {
      errors[key] = "Faixa inválida.";
      continue;
    }
    if (seen.has(key)) {
      errors[key] = "Preço repetido para a mesma faixa.";
      continue;
    }
    seen.add(key);
    if (e.unitPriceCents === null) continue;
    if (!Number.isSafeInteger(e.unitPriceCents) || e.unitPriceCents <= 0) {
      errors[key] = "Informe um valor maior que zero.";
    } else if (e.unitPriceCents > MAX_UNIT_PRICE_CENTS) {
      errors[key] = "Valor acima do limite permitido.";
    }
  }
  return errors;
}

/**
 * Avisos não bloqueantes: faixa maior não deveria custar mais que a menor.
 * Retorna mensagens por produto.
 */
export function tierOrderWarnings(
  entries: DraftEntryInput[],
  productNames: Map<string, string>
): string[] {
  const byProduct = new Map<string, Partial<Record<PriceTier, number>>>();
  for (const e of entries) {
    if (e.unitPriceCents === null) continue;
    const prices = byProduct.get(e.productId) ?? {};
    prices[e.tier] = e.unitPriceCents;
    byProduct.set(e.productId, prices);
  }
  const warnings: string[] = [];
  for (const [productId, p] of byProduct) {
    const pairs: Array<[PriceTier, PriceTier]> = [["TIER1", "TIER2"], ["TIER2", "TIER3"], ["TIER1", "TIER3"]];
    for (const [low, high] of pairs) {
      if (p[low] !== undefined && p[high] !== undefined && p[high]! > p[low]!) {
        warnings.push(`${productNames.get(productId) ?? productId}: ${high} está mais cara que ${low}.`);
        break;
      }
    }
  }
  return warnings;
}

export interface PublishInput {
  reason: string;
  effectiveFrom: Date;
  entryCount: number;
}

/** Validação da publicação: motivo obrigatório, sem vigência retroativa, tabela não vazia. */
export function validatePublish(input: PublishInput, now: Date = new Date()): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.reason.trim().length < MIN_CHANGE_REASON_LENGTH) {
    errors.reason = `Descreva o motivo da alteração (mínimo ${MIN_CHANGE_REASON_LENGTH} caracteres).`;
  }
  if (Number.isNaN(input.effectiveFrom.getTime())) {
    errors.effectiveFrom = "Data de vigência inválida.";
  } else if (input.effectiveFrom.getTime() < now.getTime() - PUBLISH_PAST_TOLERANCE_MS) {
    errors.effectiveFrom = "A vigência não pode começar no passado (não alteramos condições retroativamente).";
  }
  if (input.entryCount === 0) {
    errors.entries = "A tabela precisa ter ao menos um preço.";
  }
  return errors;
}

export type EntryChange = {
  productId: string;
  tier: PriceTier;
  before: number | null;
  after: number | null;
};

/** Diferenças entre duas versões (para auditoria e histórico). */
export function diffEntries(
  before: Array<{ productId: string; tier: PriceTier; unitPriceCents: number }>,
  after: Array<{ productId: string; tier: PriceTier; unitPriceCents: number }>
): EntryChange[] {
  const map = new Map<string, EntryChange>();
  for (const e of before) {
    map.set(entryKey(e.productId, e.tier), { productId: e.productId, tier: e.tier, before: e.unitPriceCents, after: null });
  }
  for (const e of after) {
    const key = entryKey(e.productId, e.tier);
    const current = map.get(key);
    if (current) current.after = e.unitPriceCents;
    else map.set(key, { productId: e.productId, tier: e.tier, before: null, after: e.unitPriceCents });
  }
  return [...map.values()].filter((c) => c.before !== c.after);
}

/** Diferença percentual de B em relação a A (ex.: representante x standard). */
export function percentDiff(base: number | null | undefined, other: number | null | undefined): number | null {
  if (!base || !other) return null;
  return Math.round(((other - base) / base) * 1000) / 10;
}
