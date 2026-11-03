// Regras puras das propostas comerciais (sem banco, sem rede): estados,
// transições, versão material, alçadas de desconto e rótulos. Usadas pelo
// backend (autoridade) e pela interface (somente para explicar).

import { createHash } from "node:crypto";
import type { ProposalCommercialStatus } from "@prisma/client";

export class ProposalError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 422,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ProposalError";
  }
}

// ------------------------------------------------------------------ estados

export * from "./proposal-labels";
import { COMMERCIAL_LABELS } from "./proposal-labels";

export const FINAL_COMMERCIAL: readonly ProposalCommercialStatus[] = ["CONVERTIDA", "CANCELADA", "RECUSADA"];

/** Estados que expiram quando a validade passa (sem gravação: avaliado na leitura). */
const EXPIRABLE: readonly ProposalCommercialStatus[] = [
  "RASCUNHO",
  "AGUARDANDO_APROVACAO",
  "APROVADA_INTERNAMENTE",
  "REPROVADA_INTERNAMENTE",
  "ENVIADA",
  "EM_NEGOCIACAO",
  "ACEITA",
  "CONVERSAO_SOLICITADA",
];

const TRANSITIONS: Record<ProposalCommercialStatus, readonly ProposalCommercialStatus[]> = {
  RASCUNHO: ["AGUARDANDO_APROVACAO", "CANCELADA"],
  AGUARDANDO_APROVACAO: ["APROVADA_INTERNAMENTE", "REPROVADA_INTERNAMENTE", "RASCUNHO", "CANCELADA"],
  REPROVADA_INTERNAMENTE: ["RASCUNHO", "AGUARDANDO_APROVACAO", "CANCELADA"],
  APROVADA_INTERNAMENTE: ["ENVIADA", "RASCUNHO", "CANCELADA"],
  ENVIADA: ["ENVIADA", "EM_NEGOCIACAO", "ACEITA", "RECUSADA", "RASCUNHO", "CANCELADA"],
  EM_NEGOCIACAO: ["RASCUNHO", "ACEITA", "RECUSADA", "ENVIADA", "CANCELADA"],
  ACEITA: ["CONVERSAO_SOLICITADA", "CONVERTIDA", "EM_NEGOCIACAO", "CANCELADA"],
  CONVERSAO_SOLICITADA: ["CONVERTIDA", "ACEITA", "EM_NEGOCIACAO", "CANCELADA"],
  EXPIRADA: ["RASCUNHO", "CANCELADA"],
  CONVERTIDA: [],
  RECUSADA: [],
  CANCELADA: [],
};

export function canTransition(from: ProposalCommercialStatus, to: ProposalCommercialStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ProposalCommercialStatus, to: ProposalCommercialStatus): void {
  if (!canTransition(from, to)) {
    throw new ProposalError(
      `Transição não permitida: ${COMMERCIAL_LABELS[from]} → ${COMMERCIAL_LABELS[to]}.`,
      "INVALID_TRANSITION",
      409,
      { from, to }
    );
  }
}

export function isExpired(p: { commercialStatus: ProposalCommercialStatus; validUntil: Date | null }, now: Date): boolean {
  return !!p.validUntil && p.validUntil.getTime() < now.getTime() && EXPIRABLE.includes(p.commercialStatus);
}

/** Estado exibido/usado nas decisões: considera a validade vencida. */
export function effectiveCommercialStatus(
  p: { commercialStatus: ProposalCommercialStatus; validUntil: Date | null },
  now: Date
): ProposalCommercialStatus {
  return isExpired(p, now) ? "EXPIRADA" : p.commercialStatus;
}

/** Validade contada a partir do dia em que a versão foi registrada. */
export function validUntilFrom(base: Date, validityDays: number | null): Date | null {
  if (!validityDays) return null;
  const end = new Date(base.getTime());
  end.setUTCDate(end.getUTCDate() + validityDays);
  // Fim do dia em Brasília (UTC-3): 02:59:59.999 UTC do dia seguinte.
  end.setUTCHours(26, 59, 59, 999);
  return end;
}

// --------------------------------------------------------------- conteúdo

export interface ProposalContentItem {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

/** Tudo o que define a proposta perante o cliente. */
export interface ProposalContent {
  items: ProposalContentItem[];
  discountCents: number;
  freightCents: number;
  freightResponsibility: string | null;
  paymentType: string | null;
  paymentCondition: string | null;
  paymentText: string | null;
  validityDays: number | null;
  deliveryTerm: string | null;
  olistSellerId: string | null;
  customerNotes: string | null;
}

const MATERIAL_KEYS = [
  "items",
  "discountCents",
  "freightCents",
  "paymentType",
  "paymentCondition",
  "paymentText",
  "validityDays",
  "deliveryTerm",
  "olistSellerId",
] as const;
export type MaterialField = (typeof MATERIAL_KEYS)[number];

export type MaterialContent = Pick<ProposalContent, MaterialField>;

const blank = (v: string | null | undefined) => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
};

/** Forma canônica (ordem estável) usada nos hashes e nas comparações com o Olist. */
export function canonicalMaterial(c: MaterialContent): MaterialContent {
  return {
    items: [...c.items]
      .map((i) => ({ sku: i.sku.trim().toUpperCase(), quantity: i.quantity, unitPriceCents: i.unitPriceCents }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
    discountCents: c.discountCents || 0,
    freightCents: c.freightCents || 0,
    paymentType: blank(c.paymentType),
    paymentCondition: blank(c.paymentCondition),
    paymentText: blank(c.paymentText),
    validityDays: c.validityDays ?? null,
    deliveryTerm: blank(c.deliveryTerm),
    olistSellerId: blank(c.olistSellerId),
  };
}

function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);
}

/** Mudou algo que exige nova aprovação (produtos, quantidades, preços, desconto, frete, pagamento, prazo, validade, vendedor). */
export function materialHash(c: MaterialContent): string {
  return sha(canonicalMaterial(c));
}

/** Qualquer mudança (inclui observações ao cliente): gera nova versão. */
export function contentHash(c: ProposalContent): string {
  return sha({ ...canonicalMaterial(c), freightResponsibility: blank(c.freightResponsibility), customerNotes: blank(c.customerNotes) });
}

export function diffMaterial(a: MaterialContent, b: MaterialContent): MaterialField[] {
  const x = canonicalMaterial(a);
  const y = canonicalMaterial(b);
  return MATERIAL_KEYS.filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
}

export const MATERIAL_FIELD_LABELS: Record<MaterialField, string> = {
  items: "produtos, quantidades ou preços",
  discountCents: "desconto",
  freightCents: "frete",
  paymentType: "tipo de condição de pagamento",
  paymentCondition: "condição de pagamento",
  paymentText: "texto da condição de pagamento",
  validityDays: "validade",
  deliveryTerm: "prazo de entrega",
  olistSellerId: "vendedor no Olist",
};

export function proposalTotals(c: Pick<ProposalContent, "items" | "discountCents" | "freightCents">) {
  const subtotalCents = c.items.reduce((t, i) => t + i.quantity * i.unitPriceCents, 0);
  return { subtotalCents, totalCents: subtotalCents - (c.discountCents || 0) + (c.freightCents || 0) };
}

export function discountBps(discountCents: number, subtotalCents: number): number {
  if (!discountCents || subtotalCents <= 0) return 0;
  return Math.ceil((discountCents * 10_000) / subtotalCents);
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

// ---------------------------------------------------------------- alçadas

/** Limites configurados (bps). null = não configurado. */
export interface DiscountLimits {
  seller: number | null;
  supervisor: number | null;
  manager: number | null;
}

export type ApproverLevel = "SUPERVISOR" | "GERENTE_COMERCIAL" | "ADMIN";

/**
 * Quem pode aprovar. Sem configuração administrativa não há percentual
 * presumido: supervisor sem alçada configurada só aprova propostas sem
 * desconto; gerente sem limite configurado aprova qualquer desconto
 * (descontos excepcionais); ADMIN sempre pode.
 */
export function requiredApproverLevel(bps: number, limits: DiscountLimits): ApproverLevel {
  if (bps <= (limits.supervisor ?? 0)) return "SUPERVISOR";
  if (limits.manager === null || bps <= limits.manager) return "GERENTE_COMERCIAL";
  return "ADMIN";
}

/** Acima do limite individual do vendedor a solicitação exige justificativa. */
export function needsDiscountJustification(bps: number, limits: DiscountLimits): boolean {
  return bps > (limits.seller ?? 0);
}

export const LEVEL_LABELS: Record<ApproverLevel, string> = {
  SUPERVISOR: "supervisor",
  GERENTE_COMERCIAL: "gerente comercial",
  ADMIN: "administrador",
};

// --------------------------------------------------------------- vocabulário Olist

export const PAYMENT_TYPES = ["Nenhuma", "Parcelas", "Texto livre"] as const;
export const FREIGHT_RESPONSIBILITY: Record<string, string> = {
  R: "Remetente (CIF)",
  D: "Destinatário (FOB)",
  T: "Terceiros",
  "3": "Próprio remetente",
  "4": "Próprio destinatário",
  S: "Sem transporte",
};
