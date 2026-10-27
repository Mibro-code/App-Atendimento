import "server-only";
import type { BusinessType, CustomerInterestedBrand, CustomerInterest, CustomerStatus, PipelineStage, Prisma, RepresentativeType, Temperature } from "@prisma/client";
import { BUSINESS_TYPE_VALUES, CUSTOMER_INTEREST_VALUES, INTERESTED_BRAND_VALUES } from "@/lib/customer-fields";
import { canExportSeller, getCustomerScopeFilter, type SessionUser } from "@/lib/authz";
import { normalizeEmail, searchDigits } from "@/lib/format";
import { followUpBucketRange, isPipelineStage, type FollowUpBucket } from "@/lib/pipeline-rules";
import { normalizeRca, rcaFromQuery } from "@/lib/rca";

const FOLLOW_UP_BUCKETS: FollowUpBucket[] = ["OVERDUE", "TODAY", "TOMORROW", "WEEK", "FUTURE", "NONE"];
const REPRESENTATIVE_TYPES: RepresentativeType[] = ["ATACADO", "VAREJO", "OUTRO"];
const ACTIVE_FOLLOW_UP = { in: ["PENDENTE", "ADIADO"] as Array<"PENDENTE" | "ADIADO"> };

const CUSTOMER_STATUSES: CustomerStatus[] = [
  "NOVO", "CONTATO_REALIZADO", "EM_NEGOCIACAO", "COTACAO_ENVIADA", "AGUARDANDO_RETORNO",
  "AGUARDANDO_PAGAMENTO", "CLIENTE_ATIVO", "SEM_INTERESSE", "VENDA_PERDIDA", "INATIVO",
];
const TEMPERATURES: Temperature[] = ["QUENTE", "MORNO", "FRIO", "SEM_CLASSIFICACAO"];

export interface CustomerListFilters {
  q?: string;
  sellerId?: string;
  status?: CustomerStatus;
  temperature?: Temperature;
  state?: string;
  spRegion?: string;
  city?: string;
  leadOrigin?: string;
  createdFrom?: string;
  createdTo?: string;
  businessType?: BusinessType;
  industrySegment?: string;
  worksWithSmartwatch?: boolean;
  interest?: CustomerInterest;
  interestedBrand?: CustomerInterestedBrand;
  stage?: PipelineStage;
  /** 0, 1, 2 ou 3 (3 = três ou mais tentativas no ciclo atual). */
  attempts?: number;
  address?: "com" | "sem";
  followUp?: FollowUpBucket;
  repurchase?: boolean;
  representativeType?: RepresentativeType;
  sellerRca?: string;
  /** Período da última mudança de etapa (ex.: quando ficou inativo). */
  stageChangedFrom?: string;
  stageChangedTo?: string;
}

export class CustomerFilterForbiddenError extends Error {}

export function parseCustomerListFilters(input: {
  q?: string | null;
  sellerId?: string | null;
  status?: string | null;
  temperature?: string | null;
  state?: string | null;
  spRegion?: string | null;
  city?: string | null;
  leadOrigin?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  businessType?: string | null;
  industrySegment?: string | null;
  worksWithSmartwatch?: string | null;
  interest?: string | null;
  interestedBrand?: string | null;
  stage?: string | null;
  attempts?: string | null;
  address?: string | null;
  followUp?: string | null;
  repurchase?: string | null;
  representativeType?: string | null;
  sellerRca?: string | null;
  stageChangedFrom?: string | null;
  stageChangedTo?: string | null;
}): CustomerListFilters {
  const state = input.state?.trim().toUpperCase();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  return {
    q: input.q?.trim() || undefined,
    sellerId: input.sellerId?.trim() || undefined,
    status: CUSTOMER_STATUSES.includes(input.status as CustomerStatus) ? (input.status as CustomerStatus) : undefined,
    temperature: TEMPERATURES.includes(input.temperature as Temperature)
      ? (input.temperature as Temperature)
      : undefined,
    state: state && /^[A-Z]{2}$/.test(state) ? state : undefined,
    spRegion: input.spRegion?.trim().slice(0, 100) || undefined,
    city: input.city?.trim().slice(0, 100) || undefined,
    leadOrigin: input.leadOrigin?.trim().slice(0, 100) || undefined,
    createdFrom: input.createdFrom && datePattern.test(input.createdFrom) ? input.createdFrom : undefined,
    createdTo: input.createdTo && datePattern.test(input.createdTo) ? input.createdTo : undefined,
    businessType: BUSINESS_TYPE_VALUES.includes(input.businessType as BusinessType) ? input.businessType as BusinessType : undefined,
    industrySegment: input.industrySegment?.trim().slice(0, 200) || undefined,
    worksWithSmartwatch: input.worksWithSmartwatch === "true" ? true : input.worksWithSmartwatch === "false" ? false : undefined,
    interest: CUSTOMER_INTEREST_VALUES.includes(input.interest as CustomerInterest) ? input.interest as CustomerInterest : undefined,
    interestedBrand: INTERESTED_BRAND_VALUES.includes(input.interestedBrand as CustomerInterestedBrand) ? input.interestedBrand as CustomerInterestedBrand : undefined,
    stage: isPipelineStage(input.stage) ? input.stage : undefined,
    attempts: input.attempts && /^[0-3]$/.test(input.attempts) ? Number(input.attempts) : undefined,
    address: input.address === "com" || input.address === "sem" ? input.address : undefined,
    followUp: FOLLOW_UP_BUCKETS.includes(input.followUp as FollowUpBucket) ? input.followUp as FollowUpBucket : undefined,
    repurchase: input.repurchase === "1" ? true : undefined,
    representativeType: REPRESENTATIVE_TYPES.includes(input.representativeType as RepresentativeType) ? input.representativeType as RepresentativeType : undefined,
    sellerRca: normalizeRca(input.sellerRca) ?? undefined,
    stageChangedFrom: input.stageChangedFrom && datePattern.test(input.stageChangedFrom) ? input.stageChangedFrom : undefined,
    stageChangedTo: input.stageChangedTo && datePattern.test(input.stageChangedTo) ? input.stageChangedTo : undefined,
  };
}

function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00.000-03:00`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000-03:00`).getTime() + 86_400_000) } : {}),
  };
}

export async function buildCustomerListWhere(
  user: SessionUser,
  filters: CustomerListFilters
): Promise<Prisma.CustomerWhereInput> {
  const scope = await getCustomerScopeFilter(user);
  if (filters.sellerId && !(await canExportSeller(user, filters.sellerId))) {
    throw new CustomerFilterForbiddenError("Vendedor fora do seu escopo.");
  }

  const digits = searchDigits(filters.q);
  const queryRca = rcaFromQuery(filters.q);
  const search: Prisma.CustomerWhereInput[] = filters.q
    ? [
        { contactName: { contains: filters.q, mode: "insensitive" } },
        { legalName: { contains: filters.q, mode: "insensitive" } },
        { tradeName: { contains: filters.q, mode: "insensitive" } },
        { email: { contains: normalizeEmail(filters.q), mode: "insensitive" } },
        { city: { contains: filters.q, mode: "insensitive" } },
        { state: { equals: filters.q.toUpperCase(), mode: "insensitive" } },
        { spRegion: { contains: filters.q, mode: "insensitive" } },
        { addressStreet: { contains: filters.q, mode: "insensitive" } },
        ...(queryRca ? [{ seller: { rca: queryRca } }] : []),
        ...(digits
          ? [
              { cnpjDigits: { contains: digits } },
              { cpfDigits: { contains: digits } },
              { phoneDigits: { contains: digits } },
            ]
          : []),
      ]
    : [];

  const createdAt = dateRange(filters.createdFrom, filters.createdTo);
  const stageChangedAt = dateRange(filters.stageChangedFrom, filters.stageChangedTo);

  // Condições que também usam OR/AND vão em uma lista própria para nunca
  // colidir com a busca textual (que usa OR no nível raiz).
  const extra: Prisma.CustomerWhereInput[] = [];
  if (filters.address === "com") extra.push({ addressStreet: { not: null } }, { NOT: { addressStreet: "" } });
  if (filters.address === "sem") extra.push({ OR: [{ addressStreet: null }, { addressStreet: "" }] });
  if (filters.followUp === "NONE") extra.push({ followUps: { none: { status: ACTIVE_FOLLOW_UP } } });
  else if (filters.followUp) extra.push({ followUps: { some: { status: ACTIVE_FOLLOW_UP, dueAt: followUpBucketRange(filters.followUp) } } });
  if (filters.representativeType) extra.push({ seller: { sellerProfile: { representativeType: filters.representativeType } } });
  if (filters.sellerRca) extra.push({ seller: { rca: filters.sellerRca } });

  return {
    ...scope,
    ...(filters.stage ? { pipelineStage: filters.stage } : {}),
    ...(filters.attempts !== undefined ? { cycleContactAttempts: filters.attempts === 3 ? { gte: 3 } : filters.attempts } : {}),
    ...(filters.repurchase ? { lastSaleAt: { not: null } } : {}),
    ...(stageChangedAt ? { pipelineStageChangedAt: stageChangedAt } : {}),
    ...(extra.length > 0 ? { AND: extra } : {}),
    ...(filters.sellerId ? { sellerId: filters.sellerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.temperature ? { temperature: filters.temperature } : {}),
    ...(filters.state ? { state: { equals: filters.state, mode: "insensitive" } } : {}),
    ...(filters.spRegion ? { spRegion: { equals: filters.spRegion, mode: "insensitive" } } : {}),
    ...(filters.city ? { city: { equals: filters.city, mode: "insensitive" } } : {}),
    ...(filters.leadOrigin ? { leadOrigin: { equals: filters.leadOrigin, mode: "insensitive" } } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(filters.businessType ? { businessType: filters.businessType } : {}),
    ...(filters.industrySegment ? { industrySegment: { equals: filters.industrySegment, mode: "insensitive" } } : {}),
    ...(filters.worksWithSmartwatch !== undefined ? { worksWithSmartwatch: filters.worksWithSmartwatch } : {}),
    ...(filters.interest ? { interests: { has: filters.interest } } : {}),
    ...(filters.interestedBrand ? { interestedBrand: filters.interestedBrand } : {}),
    ...(search.length > 0 ? { OR: search } : {}),
  };
}

export function customerFiltersToSearchParams(filters: CustomerListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.sellerId) params.set("sellerId", filters.sellerId);
  if (filters.status) params.set("status", filters.status);
  if (filters.temperature) params.set("temperature", filters.temperature);
  if (filters.state) params.set("state", filters.state);
  if (filters.spRegion) params.set("spRegion", filters.spRegion);
  if (filters.city) params.set("city", filters.city);
  if (filters.leadOrigin) params.set("leadOrigin", filters.leadOrigin);
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", filters.createdTo);
  if (filters.businessType) params.set("businessType", filters.businessType);
  if (filters.industrySegment) params.set("industrySegment", filters.industrySegment);
  if (filters.worksWithSmartwatch !== undefined) params.set("worksWithSmartwatch", String(filters.worksWithSmartwatch));
  if (filters.interest) params.set("interest", filters.interest);
  if (filters.interestedBrand) params.set("interestedBrand", filters.interestedBrand);
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.attempts !== undefined) params.set("attempts", String(filters.attempts));
  if (filters.address) params.set("address", filters.address);
  if (filters.followUp) params.set("followUp", filters.followUp);
  if (filters.repurchase) params.set("repurchase", "1");
  if (filters.representativeType) params.set("representativeType", filters.representativeType);
  if (filters.sellerRca) params.set("sellerRca", filters.sellerRca);
  if (filters.stageChangedFrom) params.set("stageChangedFrom", filters.stageChangedFrom);
  if (filters.stageChangedTo) params.set("stageChangedTo", filters.stageChangedTo);
  return params;
}
