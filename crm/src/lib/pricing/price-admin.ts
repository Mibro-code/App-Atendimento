import "server-only";
import { Prisma, type CommercialBrand, type PriceGroup, type PriceTier } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/authz";
import { PricingError, pickEffectiveTable, publishedKeyFor } from "@/lib/pricing/pricing-rules";
import {
  canManagePriceTables,
  diffEntries,
  validateDraftEntries,
  validatePublish,
  type DraftEntryInput,
} from "@/lib/pricing/price-admin-rules";

// Gestão Comercial de tabelas de preço. Regras:
// - Versões PUBLISHED são imutáveis. Editar = rascunho (DRAFT) novo copiado da
//   versão vigente, depois publicar com motivo e vigência.
// - No máximo um rascunho por marca+grupo (garantido pela versão única).
// - Publicação futura pode ser cancelada antes de entrar em vigor; publicação
//   já vigente nunca é desfeita (cria-se outra versão).
// - Propostas guardam o snapshot em QuoteItem, então nada aqui altera valores
//   de propostas já emitidas.

export class PriceAdminError extends PricingError {}

function assertManager(actor: SessionUser) {
  if (!canManagePriceTables(actor.role)) {
    throw new PriceAdminError("Apenas administradores alteram tabelas de preço.", "FORBIDDEN");
  }
}

const TABLE_SUMMARY_SELECT = {
  id: true,
  brand: true,
  priceGroup: true,
  version: true,
  status: true,
  effectiveFrom: true,
  changeReason: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  publishedBy: { select: { id: true, name: true } },
  entries: { select: { productId: true, tier: true, unitPriceCents: true } },
  _count: { select: { quoteItems: true } },
} satisfies Prisma.PriceTableSelect;

export type PriceTableSummary = Prisma.PriceTableGetPayload<{ select: typeof TABLE_SUMMARY_SELECT }>;

export interface PriceGroupOverview {
  priceGroup: PriceGroup;
  effective: PriceTableSummary | null;
  scheduled: PriceTableSummary[];
  draft: PriceTableSummary | null;
  history: PriceTableSummary[]; // todas as versões, da mais nova para a mais antiga
}

export async function getBrandPriceOverview(brand: CommercialBrand, at: Date = new Date()) {
  const [products, tables] = await Promise.all([
    prisma.product.findMany({
      where: { brand },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, slug: true, category: true, imageUrl: true, active: true, updatedAt: true,
        variants: { orderBy: [{ sortOrder: "asc" }, { sku: "asc" }], select: { id: true, sku: true, colorName: true, active: true } },
      },
    }),
    prisma.priceTable.findMany({ where: { brand }, orderBy: { version: "desc" }, select: TABLE_SUMMARY_SELECT }),
  ]);

  const groups: PriceGroupOverview[] = (["STANDARD", "REPRESENTATIVE"] as const).map((priceGroup) => {
    const history = tables.filter((t) => t.priceGroup === priceGroup);
    const effective = pickEffectiveTable(history, at);
    return {
      priceGroup,
      effective,
      scheduled: history
        .filter((t) => t.status === "PUBLISHED" && t.effectiveFrom.getTime() > at.getTime())
        .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime()),
      draft: history.find((t) => t.status === "DRAFT") ?? null,
      history,
    };
  });

  return { brand, products, groups };
}

/** Cria (ou devolve o existente) rascunho copiado da versão vigente. */
export async function createDraft(actor: SessionUser, brand: CommercialBrand, priceGroup: PriceGroup) {
  assertManager(actor);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.priceTable.findFirst({ where: { brand, priceGroup, status: "DRAFT" }, select: { id: true } });
      if (existing) return { id: existing.id, created: false };

      const all = await tx.priceTable.findMany({
        where: { brand, priceGroup },
        select: { id: true, version: true, status: true, effectiveFrom: true, entries: { select: { productId: true, tier: true, unitPriceCents: true } } },
      });
      // Base: a versão publicada mais recente (inclui agendada), senão a vigente.
      const base =
        all.filter((t) => t.status === "PUBLISHED").sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null;
      const version = all.reduce((max, t) => Math.max(max, t.version), 0) + 1;

      const draft = await tx.priceTable.create({
        data: {
          brand,
          priceGroup,
          version,
          status: "DRAFT",
          effectiveFrom: new Date(),
          createdById: actor.id,
          entries: base ? { create: base.entries } : undefined,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id, action: "PRICE_TABLE_DRAFT_CREATED", entityType: "PriceTable", entityId: draft.id,
          metadata: { brand, priceGroup, version, baseTableId: base?.id ?? null },
        },
      });
      return { id: draft.id, created: true };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new PriceAdminError("Outro rascunho foi criado ao mesmo tempo. Recarregue a página.", "DRAFT_CONFLICT");
    }
    throw error;
  }
}

async function loadDraft(tableId: string) {
  const table = await prisma.priceTable.findUnique({
    where: { id: tableId },
    select: { id: true, brand: true, priceGroup: true, version: true, status: true, entries: { select: { productId: true, tier: true, unitPriceCents: true } } },
  });
  if (!table) throw new PriceAdminError("Tabela não encontrada.", "NOT_FOUND");
  if (table.status !== "DRAFT") {
    throw new PriceAdminError("Somente rascunhos podem ser alterados. Versões publicadas são imutáveis.", "NOT_DRAFT");
  }
  return table;
}

/** Substitui os preços do rascunho. Faixa com null = sem preço configurado. */
export async function saveDraftEntries(actor: SessionUser, tableId: string, entries: DraftEntryInput[]) {
  assertManager(actor);
  const table = await loadDraft(tableId);
  const products = await prisma.product.findMany({ where: { brand: table.brand }, select: { id: true } });
  const errors = validateDraftEntries(entries, new Set(products.map((p) => p.id)));
  if (Object.keys(errors).length > 0) {
    throw new PriceAdminError("Revise os valores destacados.", "INVALID_ENTRIES", { fieldErrors: errors });
  }
  const filled = entries.filter((e): e is DraftEntryInput & { unitPriceCents: number } => e.unitPriceCents !== null);

  await prisma.$transaction(async (tx) => {
    // Revalida dentro da transação: o rascunho pode ter sido publicado/descartado.
    const current = await tx.priceTable.findUnique({ where: { id: tableId }, select: { status: true } });
    if (current?.status !== "DRAFT") throw new PriceAdminError("O rascunho não está mais disponível.", "NOT_DRAFT");
    await tx.priceEntry.deleteMany({ where: { priceTableId: tableId } });
    if (filled.length > 0) {
      await tx.priceEntry.createMany({
        data: filled.map((e) => ({ priceTableId: tableId, productId: e.productId, tier: e.tier, unitPriceCents: e.unitPriceCents })),
      });
    }
    await tx.priceTable.update({ where: { id: tableId }, data: { updatedAt: new Date() } });
  });
  return { saved: filled.length };
}

/** Publica o rascunho com motivo e vigência (agora ou futura). */
export async function publishDraft(
  actor: SessionUser,
  tableId: string,
  input: { reason: string; effectiveFrom: Date },
  now: Date = new Date()
) {
  assertManager(actor);
  const table = await loadDraft(tableId);
  const effectiveFrom = input.effectiveFrom.getTime() < now.getTime() ? now : input.effectiveFrom;
  const errors = validatePublish({ reason: input.reason, effectiveFrom: input.effectiveFrom, entryCount: table.entries.length }, now);
  if (Object.keys(errors).length > 0) {
    throw new PriceAdminError("Revise os campos destacados.", "INVALID_PUBLISH", { fieldErrors: errors });
  }

  const previous = await prisma.priceTable.findMany({
    where: { brand: table.brand, priceGroup: table.priceGroup, status: "PUBLISHED" },
    select: { id: true, version: true, status: true, effectiveFrom: true, entries: { select: { productId: true, tier: true, unitPriceCents: true } } },
  });
  const base = pickEffectiveTable(previous, effectiveFrom);
  const changes = diffEntries(base?.entries ?? [], table.entries);

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.priceTable.updateMany({
        where: { id: tableId, status: "DRAFT" },
        data: {
          status: "PUBLISHED",
          effectiveFrom,
          changeReason: input.reason.trim(),
          publishedAt: now,
          publishedById: actor.id,
          publishedKey: publishedKeyFor(table.brand, table.priceGroup, effectiveFrom),
        },
      });
      if (updated.count !== 1) throw new PriceAdminError("O rascunho não está mais disponível.", "NOT_DRAFT");
      await tx.auditLog.create({
        data: {
          actorId: actor.id, action: "PRICE_TABLE_PUBLISHED", entityType: "PriceTable", entityId: tableId,
          metadata: {
            brand: table.brand, priceGroup: table.priceGroup, version: table.version,
            effectiveFrom: effectiveFrom.toISOString(), reason: input.reason.trim(),
            previousTableId: base?.id ?? null, previousVersion: base?.version ?? null,
            changes: changes.map((c) => ({ ...c })),
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new PriceAdminError("Já existe uma versão publicada com essa mesma vigência.", "EFFECTIVE_CONFLICT", {
        fieldErrors: { effectiveFrom: "Escolha outro horário de vigência." },
      });
    }
    throw error;
  }
  return { version: table.version, effectiveFrom, changes: changes.length };
}

/** Descarta rascunho ou cancela publicação agendada (ainda não vigente). */
export async function archiveTable(actor: SessionUser, tableId: string, reason: string, now: Date = new Date()) {
  assertManager(actor);
  const table = await prisma.priceTable.findUnique({
    where: { id: tableId },
    select: { id: true, brand: true, priceGroup: true, version: true, status: true, effectiveFrom: true },
  });
  if (!table) throw new PriceAdminError("Tabela não encontrada.", "NOT_FOUND");
  const isScheduled = table.status === "PUBLISHED" && table.effectiveFrom.getTime() > now.getTime();
  if (table.status !== "DRAFT" && !isScheduled) {
    throw new PriceAdminError(
      "Versões já vigentes não podem ser removidas. Publique uma nova versão para alterar os preços.",
      "NOT_ARCHIVABLE"
    );
  }
  const updated = await prisma.priceTable.updateMany({
    where: { id: tableId, status: table.status, effectiveFrom: table.effectiveFrom },
    data: { status: "ARCHIVED", publishedKey: null },
  });
  if (updated.count !== 1) throw new PriceAdminError("A tabela mudou enquanto você editava. Recarregue a página.", "CONFLICT");
  await logAudit({
    actorId: actor.id, action: "PRICE_TABLE_ARCHIVED", entityType: "PriceTable", entityId: tableId,
    metadata: { brand: table.brand, priceGroup: table.priceGroup, version: table.version, previousStatus: table.status, reason: reason.trim() || null },
  });
  return { archived: true };
}

export interface ProductPatch {
  name?: string;
  category?: string;
  imageUrl?: string | null;
  active?: boolean;
  variants?: Array<{ id: string; colorName?: string; active?: boolean }>;
}

/** Ativa/desativa e renomeia produtos e variações (SKU nunca é editável aqui). */
export async function updateProduct(actor: SessionUser, productId: string, patch: ProductPatch) {
  assertManager(actor);
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, brand: true, name: true, category: true, imageUrl: true, active: true, variants: { select: { id: true, colorName: true, active: true } } },
  });
  if (!product) throw new PriceAdminError("Produto não encontrado.", "NOT_FOUND");
  const variantIds = new Set(product.variants.map((v) => v.id));
  for (const v of patch.variants ?? []) {
    if (!variantIds.has(v.id)) throw new PriceAdminError("Variação não pertence a este produto.", "INVALID_VARIANT");
  }

  await prisma.$transaction([
    prisma.product.update({
      where: { id: productId },
      data: { name: patch.name, category: patch.category, imageUrl: patch.imageUrl, active: patch.active },
    }),
    ...(patch.variants ?? []).map((v) =>
      prisma.productVariant.update({ where: { id: v.id }, data: { colorName: v.colorName, active: v.active } })
    ),
  ]);
  await logAudit({
    actorId: actor.id, action: "PRODUCT_UPDATED", entityType: "Product", entityId: productId,
    metadata: {
      brand: product.brand,
      before: { name: product.name, category: product.category, imageUrl: product.imageUrl, active: product.active, variants: product.variants },
      patch: JSON.parse(JSON.stringify(patch)),
    },
  });
}

export function tierPricesOf(table: { entries: Array<{ productId: string; tier: PriceTier; unitPriceCents: number }> } | null) {
  const map = new Map<string, Partial<Record<PriceTier, number>>>();
  for (const e of table?.entries ?? []) {
    const current = map.get(e.productId) ?? {};
    current[e.tier] = e.unitPriceCents;
    map.set(e.productId, current);
  }
  return map;
}
