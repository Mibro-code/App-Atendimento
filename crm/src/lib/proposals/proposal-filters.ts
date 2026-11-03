import type { Prisma, ProposalCommercialStatus } from "@prisma/client";
import { COMMERCIAL_LABELS } from "./proposal-labels";

// Filtros da listagem de propostas. O resultado é sempre combinado (AND) com
// o escopo do ator — nunca o substitui.

export interface ProposalFilters {
  q?: string;
  brand?: "MIBRO" | "SINCROFIT";
  status?: ProposalCommercialStatus;
  sellerId?: string;
  supervisorId?: string;
  from?: string;
  to?: string;
  minCents?: number;
  maxCents?: number;
  view?: "pendentes" | "minha_aprovacao" | "vencidas" | "erro_sync" | "conversao";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9]{20,40}$/i;
const EXPIRABLE: ProposalCommercialStatus[] = ["RASCUNHO", "AGUARDANDO_APROVACAO", "APROVADA_INTERNAMENTE", "REPROVADA_INTERNAMENTE", "ENVIADA", "EM_NEGOCIACAO", "ACEITA", "CONVERSAO_SOLICITADA"];

function money(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
}

export function parseProposalFilters(params: Record<string, string | undefined>): ProposalFilters {
  const status = params.status && params.status in COMMERCIAL_LABELS ? (params.status as ProposalCommercialStatus) : undefined;
  const view = ["pendentes", "minha_aprovacao", "vencidas", "erro_sync", "conversao"].includes(params.view ?? "") ? (params.view as ProposalFilters["view"]) : undefined;
  return {
    q: params.q?.trim().slice(0, 100) || undefined,
    brand: params.brand === "MIBRO" || params.brand === "SINCROFIT" ? params.brand : undefined,
    status,
    sellerId: params.sellerId && ID_RE.test(params.sellerId) ? params.sellerId : undefined,
    supervisorId: params.supervisorId && ID_RE.test(params.supervisorId) ? params.supervisorId : undefined,
    from: params.de && DATE_RE.test(params.de) ? params.de : undefined,
    to: params.ate && DATE_RE.test(params.ate) ? params.ate : undefined,
    minCents: money(params.min),
    maxCents: money(params.max),
    view,
  };
}

export function buildProposalFilterWhere(f: ProposalFilters, ctx: { actorId: string; now: Date }): Prisma.CommercialProposalWhereInput {
  const and: Prisma.CommercialProposalWhereInput[] = [];
  if (f.q) {
    const digits = f.q.replace(/\D/g, "");
    and.push({
      OR: [
        { customer: { contactName: { contains: f.q, mode: "insensitive" } } },
        { customer: { tradeName: { contains: f.q, mode: "insensitive" } } },
        { customer: { legalName: { contains: f.q, mode: "insensitive" } } },
        { olistProposalNumber: f.q },
        { olistOrderNumber: f.q },
        ...(digits.length >= 3 ? [{ customer: { cnpjDigits: { contains: digits } } }, { customer: { cpfDigits: { contains: digits } } }] : []),
      ],
    });
  }
  if (f.brand) and.push({ brand: f.brand });
  if (f.status) and.push({ commercialStatus: f.status });
  if (f.sellerId) and.push({ sellerId: f.sellerId });
  if (f.supervisorId) and.push({ seller: { supervisorId: f.supervisorId } });
  if (f.from) and.push({ createdAt: { gte: new Date(`${f.from}T00:00:00-03:00`) } });
  if (f.to) and.push({ createdAt: { lte: new Date(`${f.to}T23:59:59.999-03:00`) } });
  if (f.minCents !== undefined) and.push({ quote: { totalValueCents: { gte: f.minCents } } });
  if (f.maxCents !== undefined) and.push({ quote: { totalValueCents: { lte: f.maxCents } } });
  switch (f.view) {
    case "pendentes":
      and.push({ commercialStatus: "AGUARDANDO_APROVACAO" });
      break;
    case "minha_aprovacao":
      // A decisão final (alçada, autoria) é refeita na proposta.
      and.push({ commercialStatus: "AGUARDANDO_APROVACAO", sellerId: { not: ctx.actorId } });
      break;
    case "vencidas":
      and.push({ validUntil: { lt: ctx.now }, commercialStatus: { in: EXPIRABLE } });
      break;
    case "erro_sync":
      and.push({ OR: [{ syncStatus: { in: ["ERRO", "CONFLITO"] } }, { orderStatus: "CONVERSAO_INCERTA" }] });
      break;
    case "conversao":
      and.push({ commercialStatus: { in: ["ACEITA", "CONVERSAO_SOLICITADA"] } });
      break;
  }
  return and.length ? { AND: and } : {};
}

export function proposalFiltersToQuery(f: ProposalFilters, overrides: Record<string, string | undefined> = {}): string {
  const base: Record<string, string | undefined> = {
    q: f.q, brand: f.brand, status: f.status, sellerId: f.sellerId, supervisorId: f.supervisorId, de: f.from, ate: f.to,
    min: f.minCents !== undefined ? String(f.minCents / 100) : undefined, max: f.maxCents !== undefined ? String(f.maxCents / 100) : undefined, view: f.view,
  };
  const merged = { ...base, ...overrides };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v && v !== "ALL") qs.set(k, v);
  return qs.toString();
}
