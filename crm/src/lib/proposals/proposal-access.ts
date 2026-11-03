import "server-only";
import type { CommercialBrand, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { proposalScope, type ProposalActor, type ProposalFacts } from "@/lib/proposals/proposal-permissions";
import { discountBps, materialHash, proposalTotals, type DiscountLimits, type ProposalContent } from "@/lib/proposals/proposal-rules";
import { isConcludedSituation } from "@/lib/proposals/proposal-olist-rules";
import { ProposalError } from "@/lib/proposals/proposal-rules";

// Carregamento autoritativo do ator, do escopo e dos fatos de uma proposta.
// Nada aqui confia em dados vindos do navegador.

export async function loadProposalActor(user: SessionUser): Promise<ProposalActor> {
  const record = await prisma.user.findFirst({
    where: { id: user.id, active: true, deletedAt: null },
    select: { role: true, commercialFunctions: true },
  });
  if (!record) throw new ProposalError("Conta indisponível.", "UNAUTHORIZED", 401);
  const role = record.role;
  const team =
    role === "SUPERVISOR"
      ? await prisma.user.findMany({ where: { supervisorId: user.id }, select: { id: true } })
      : [];
  return {
    id: user.id,
    role,
    functions: record?.commercialFunctions ?? [],
    teamSellerIds: role === "SUPERVISOR" ? [user.id, ...team.map((t) => t.id)] : [],
  };
}

/** Filtro de listagem: aplicado em TODA consulta de propostas. */
export function proposalWhereForActor(actor: ProposalActor): Prisma.CommercialProposalWhereInput {
  const scope = proposalScope(actor);
  if (scope.all) return {};
  const or: Prisma.CommercialProposalWhereInput[] = [{ sellerId: { in: scope.sellerIds } }];
  if (scope.financeStatuses) or.push({ commercialStatus: { in: scope.financeStatuses } });
  return { OR: or };
}

/** Alçadas por marca: registro específico da marca vence o genérico ("*"). */
export async function loadDiscountLimits(brand: CommercialBrand, sellerId: string, sellerRole: Role): Promise<DiscountLimits> {
  const keys = [`USER:${sellerId}`, `ROLE:${sellerRole}`, "ROLE:SUPERVISOR", "FUNCTION:GERENTE_COMERCIAL"];
  const rows = await prisma.proposalDiscountLimit.findMany({
    where: { active: true, scopeKey: { in: keys }, brandKey: { in: [brand, "*"] } },
    select: { scopeKey: true, brandKey: true, maxDiscountBps: true },
  });
  const pick = (key: string) =>
    rows.find((r) => r.scopeKey === key && r.brandKey === brand)?.maxDiscountBps ??
    rows.find((r) => r.scopeKey === key && r.brandKey === "*")?.maxDiscountBps ??
    null;
  return {
    seller: pick(`USER:${sellerId}`) ?? pick(`ROLE:${sellerRole}`),
    supervisor: pick("ROLE:SUPERVISOR"),
    manager: pick("FUNCTION:GERENTE_COMERCIAL"),
  };
}

export async function activeSellerLink(sellerId: string, brand: CommercialBrand) {
  return prisma.sellerOlistLink.findFirst({ where: { userId: sellerId, brand, active: true } });
}

export const PROPOSAL_CUSTOMER_SELECT = {
  id: true, sellerId: true, contactName: true, legalName: true, tradeName: true, cnpjDigits: true, cpfDigits: true,
  email: true, phoneDigits: true, addressStreet: true, addressNumber: true, addressDistrict: true, addressComplement: true,
  city: true, state: true, zipDigits: true, pipelineStage: true,
} satisfies Prisma.CustomerSelect;

export const PROPOSAL_INCLUDE = {
  quote: { include: { items: { orderBy: { sortOrder: "asc" } }, olistOrder: true } },
  customer: { select: PROPOSAL_CUSTOMER_SELECT },
  seller: { select: { id: true, name: true, role: true, supervisorId: true, sellerProfile: { select: { displayName: true } } } },
} satisfies Prisma.CommercialProposalInclude;

export type LoadedProposal = Prisma.CommercialProposalGetPayload<{ include: typeof PROPOSAL_INCLUDE }>;

export function contentOf(p: LoadedProposal): ProposalContent {
  return {
    items: p.quote.items.map((i) => ({ sku: i.sku, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
    discountCents: p.quote.discountCents ?? 0,
    freightCents: p.freightCents,
    freightResponsibility: p.freightResponsibility,
    paymentType: p.paymentType,
    paymentCondition: p.paymentCondition,
    paymentText: p.paymentText,
    validityDays: p.validityDays,
    deliveryTerm: p.deliveryTerm,
    olistSellerId: p.olistSellerId,
    customerNotes: p.customerNotes,
  };
}

export async function proposalFacts(p: LoadedProposal): Promise<ProposalFacts> {
  const content = contentOf(p);
  const { subtotalCents } = proposalTotals(content);
  const [lastVersion, dispatch, link] = await Promise.all([
    prisma.proposalVersion.findFirst({ where: { proposalId: p.id, version: p.version }, select: { createdById: true } }),
    prisma.proposalDispatch.findFirst({ where: { proposalId: p.id, version: p.version, succeeded: true }, select: { id: true } }),
    activeSellerLink(p.sellerId, p.brand),
  ]);
  return {
    sellerId: p.sellerId,
    commercialStatus: p.commercialStatus,
    approvalStatus: p.approvalStatus,
    acceptanceStatus: p.acceptanceStatus,
    syncStatus: p.syncStatus,
    orderStatus: p.orderStatus,
    version: p.version,
    syncedVersion: p.syncedVersion,
    approvedVersion: p.approvedVersion,
    approvedHash: p.approvedHash,
    materialHash: materialHash(content),
    acceptedVersion: p.acceptedVersion,
    validUntil: p.validUntil,
    olistProposalId: p.olistProposalId,
    lastEditorId: lastVersion?.createdById ?? p.createdById,
    discountBps: discountBps(content.discountCents, subtotalCents),
    dispatchedCurrentVersion: !!dispatch,
    sellerLinked: !!link && (!p.olistSellerId || link.olistSellerId === p.olistSellerId),
    olistConcluded: p.orderStatus === "SEM_PEDIDO" && isConcludedSituation(p.olistSituation),
  };
}
