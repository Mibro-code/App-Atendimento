import "server-only";
import type { PipelineStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PIPELINE_STAGES, isRepurchase } from "@/lib/pipeline-rules";

export const PIPELINE_PAGE_SIZE = 25;

const ACTIVE_QUOTE_STATUSES = ["ABERTA", "CALCULADA", "ENVIADA", "ENVIADA_PARA_ANALISE"] as const;

// Somente o necessário para o card — nada de timeline/histórico completo.
const CARD_SELECT = {
  id: true,
  contactName: true,
  tradeName: true,
  legalName: true,
  phoneDigits: true,
  email: true,
  leadOrigin: true,
  city: true,
  state: true,
  createdAt: true,
  temperature: true,
  status: true,
  pipelineStage: true,
  pipelineStageChangedAt: true,
  commercialCycle: true,
  cycleContactAttempts: true,
  lastInteractionAt: true,
  lastContactAttemptAt: true,
  nextInteractionAt: true,
  stageReason: true,
  stageReturnAt: true,
  stageReturnTo: true,
  lastSaleAt: true,
  totalSoldCents: true,
  seller: { select: { id: true, name: true, rca: true, sellerProfile: { select: { displayName: true, representativeType: true } } } },
  quotes: {
    where: { deletedAt: null, status: { in: [...ACTIVE_QUOTE_STATUSES] } },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, status: true, totalValueCents: true, createdAt: true, brand: true, mode: true },
  },
  sales: {
    where: { stage: { not: "CANCELADO" } },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true, valueCents: true, confirmedAt: true, commissionRateBps: true, commissionCents: true, commissionSource: true,
      olistOrder: { select: { orderNumber: true, olistOrderId: true } },
    },
  },
  followUps: {
    where: { status: { in: ["PENDENTE", "ADIADO"] } },
    orderBy: { dueAt: "asc" },
    take: 1,
    select: { dueAt: true },
  },
} satisfies Prisma.CustomerSelect;

type CardRow = Prisma.CustomerGetPayload<{ select: typeof CARD_SELECT }>;

export interface PipelineCardDto {
  id: string;
  name: string;
  company: string | null;
  phoneDigits: string | null;
  email: string | null;
  origin: string | null;
  location: string | null;
  createdAt: string;
  temperature: string;
  stage: PipelineStage;
  stageChangedAt: string;
  cycle: number;
  attempts: number;
  lastInteractionAt: string | null;
  nextActionAt: string | null;
  stageReason: string | null;
  returnAt: string | null;
  returnTo: PipelineStage | null;
  repurchase: boolean;
  lastSaleAt: string | null;
  totalSoldCents: number;
  seller: { id: string; name: string; rca: string | null; representativeType: string | null };
  quote: { id: string; status: string; valueCents: number | null; createdAt: string; brand: string; mode: string } | null;
  sale: { id: string; valueCents: number; confirmedAt: string | null; orderNumber: string | null; commissionRateBps: number | null; commissionCents: number | null; commissionSource: string | null } | null;
}

function toDto(row: CardRow): PipelineCardDto {
  const quote = row.quotes[0];
  const sale = row.sales[0];
  const nextFollowUp = row.followUps[0]?.dueAt ?? row.nextInteractionAt;
  return {
    id: row.id,
    name: row.tradeName || row.contactName,
    company: row.legalName && row.legalName !== row.tradeName ? row.legalName : row.tradeName ? row.contactName : null,
    phoneDigits: row.phoneDigits,
    email: row.email,
    origin: row.leadOrigin,
    location: [row.city, row.state].filter(Boolean).join("/") || null,
    createdAt: row.createdAt.toISOString(),
    temperature: row.temperature,
    stage: row.pipelineStage,
    stageChangedAt: row.pipelineStageChangedAt.toISOString(),
    cycle: row.commercialCycle,
    attempts: row.cycleContactAttempts,
    lastInteractionAt: row.lastInteractionAt?.toISOString() ?? null,
    nextActionAt: nextFollowUp?.toISOString() ?? null,
    stageReason: row.stageReason,
    returnAt: row.stageReturnAt?.toISOString() ?? null,
    returnTo: row.stageReturnTo,
    repurchase: isRepurchase(row.lastSaleAt, row.pipelineStage),
    lastSaleAt: row.lastSaleAt?.toISOString() ?? null,
    totalSoldCents: row.totalSoldCents,
    seller: {
      id: row.seller.id,
      name: row.seller.sellerProfile?.displayName || row.seller.name,
      rca: row.seller.rca,
      representativeType: row.seller.sellerProfile?.representativeType ?? null,
    },
    quote: quote ? { id: quote.id, status: quote.status, valueCents: quote.totalValueCents, createdAt: quote.createdAt.toISOString(), brand: quote.brand, mode: quote.mode } : null,
    sale: sale ? {
      id: sale.id, valueCents: sale.valueCents, confirmedAt: sale.confirmedAt?.toISOString() ?? null,
      orderNumber: sale.olistOrder?.orderNumber || sale.olistOrder?.olistOrderId || null,
      commissionRateBps: sale.commissionRateBps, commissionCents: sale.commissionCents, commissionSource: sale.commissionSource,
    } : null,
  };
}

function orderFor(stage: PipelineStage): Prisma.CustomerOrderByWithRelationInput[] {
  if (stage === "FOLLOW_UP") return [{ nextInteractionAt: { sort: "asc", nulls: "last" } }, { id: "asc" }];
  if (stage === "RECICLAGEM") return [{ stageReturnAt: { sort: "asc", nulls: "last" } }, { id: "asc" }];
  return [{ pipelineStageChangedAt: "desc" }, { id: "asc" }];
}

export async function loadPipelineCards(where: Prisma.CustomerWhereInput, stage: PipelineStage, skip = 0, take = PIPELINE_PAGE_SIZE) {
  const rows = await prisma.customer.findMany({
    where: { AND: [where, { pipelineStage: stage }] },
    select: CARD_SELECT,
    orderBy: orderFor(stage),
    skip,
    take,
  });
  return rows.map(toDto);
}

export interface PipelineColumnDto {
  stage: PipelineStage;
  count: number;
  cards: PipelineCardDto[];
}

/** Contagem por etapa (1 query agrupada) + a primeira página de cada coluna. */
export async function loadPipelineBoard(where: Prisma.CustomerWhereInput): Promise<PipelineColumnDto[]> {
  const [counts, ...pages] = await Promise.all([
    prisma.customer.groupBy({ by: ["pipelineStage"], where, _count: { _all: true } }),
    ...PIPELINE_STAGES.map((stage) => loadPipelineCards(where, stage)),
  ]);
  const countByStage = new Map(counts.map((row) => [row.pipelineStage, row._count._all]));
  return PIPELINE_STAGES.map((stage, index) => ({ stage, count: countByStage.get(stage) ?? 0, cards: pages[index] }));
}

export async function loadPipelineCardById(customerId: string): Promise<PipelineCardDto | null> {
  const row = await prisma.customer.findUnique({ where: { id: customerId }, select: CARD_SELECT });
  return row ? toDto(row) : null;
}
