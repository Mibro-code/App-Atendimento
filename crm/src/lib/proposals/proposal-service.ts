import "server-only";
import { Prisma, type PriceTier, type ProposalCommercialStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { canAccessCustomer, getVisibleSellerIds, type SessionUser } from "@/lib/authz";
import { callOlistBridge } from "@/lib/olist/bridge-client";
import { customerOrderReadiness } from "@/lib/olist/real-order-rules";
import { resolveWholesalePrice } from "@/lib/pricing/pricing";
import { PricingError } from "@/lib/pricing/pricing-rules";
import { buildProductsSummary } from "@/lib/quotes/native-quote-rules";
import { moveCustomerStage } from "@/lib/pipeline";
import { activeSellerLink, contentOf, type LoadedProposal } from "@/lib/proposals/proposal-access";
import { DEFAULT_VALIDITY_DAYS } from "@/lib/proposals/proposal-config";
import { addEvent, assertEnabled, authorize, bridgeFailure, failAttempt, finishAttempt, loadProposal, protocol, startAttempt, transition } from "@/lib/proposals/proposal-core";
import { convertProposal, markInOlist, pushProposalToOlist, pushSituation, reconcileOrder, refreshOrder, refreshProposalFromOlist } from "@/lib/proposals/proposal-olist";
import { isManager } from "@/lib/proposals/proposal-permissions";
import {
  contentHash,
  diffMaterial,
  discountBps,
  effectiveCommercialStatus,
  materialHash,
  needsDiscountJustification,
  ProposalError,
  proposalTotals,
  validUntilFrom,
  type ProposalContent,
} from "@/lib/proposals/proposal-rules";

// Fluxo comercial da proposta. Cada operação: autoriza no servidor → valida
// estado e versão → grava com concorrência otimista → registra histórico.

const STAGES_THAT_ENTER_QUOTE = ["NOVO", "EM_ATENDIMENTO", "FOLLOW_UP"];

export interface ProposalConditionsInput {
  validityDays?: number | null;
  paymentType?: string | null;
  paymentCondition?: string | null;
  paymentText?: string | null;
  freightCents?: number;
  freightResponsibility?: string | null;
  deliveryTerm?: string | null;
  customerNotes?: string | null;
  internalNotes?: string | null;
}

function versionSnapshot(items: LoadedProposal["quote"]["items"] | Array<Record<string, unknown>>, content: ProposalContent, extra: Record<string, unknown> = {}) {
  return JSON.parse(JSON.stringify({ items, conditions: { ...content, items: undefined }, ...extra })) as Prisma.InputJsonValue;
}

/** Sincroniza sem derrubar a operação que já foi gravada: erro vira aviso. */
async function trySync(actorId: string, proposalId: string) {
  try {
    await pushProposalToOlist(actorId, proposalId);
    return null;
  } catch (error) {
    return error instanceof ProposalError ? error.message : bridgeFailure(error).message;
  }
}

// ------------------------------------------------------------ criação

export async function createProposalFromSimulation(user: SessionUser, simulationId: string, conditions: ProposalConditionsInput) {
  assertEnabled();
  const source = await prisma.quote.findUnique({
    where: { id: simulationId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      customer: { select: { id: true, sellerId: true, pipelineStage: true, contactName: true, legalName: true, tradeName: true, cnpjDigits: true, cpfDigits: true, email: true, phoneDigits: true, addressStreet: true, addressNumber: true, addressDistrict: true, addressComplement: true, city: true, state: true, zipDigits: true } },
      commercialProposal: { select: { id: true } },
      convertedQuotes: { where: { mode: "REAL", status: { not: "CANCELADA" }, deletedAt: null }, select: { id: true, commercialProposal: { select: { id: true, commercialStatus: true } } } },
    },
  });
  if (!source || source.deletedAt) throw new ProposalError("Simulação não encontrada.", "NOT_FOUND", 404);
  // Mesmo escopo de carteira do restante do CRM (o Financeiro não tem carteira de terceiros).
  if (!(await canAccessCustomer(user, source.customer.sellerId))) throw new ProposalError("Simulação não encontrada.", "NOT_FOUND", 404);
  if (source.origin !== "CRM" || source.mode !== "SIMULATION") throw new ProposalError("Crie a proposta a partir de uma simulação do CRM.", "NOT_SIMULATION", 422);
  const active = source.convertedQuotes.find((q) => q.commercialProposal && q.commercialProposal.commercialStatus !== "CANCELADA");
  if (active?.commercialProposal) return { proposalId: active.commercialProposal.id, created: false, syncError: null };
  if (source.convertedQuotes.some((q) => !q.commercialProposal)) {
    throw new ProposalError("Esta simulação já gerou um pedido real pelo fluxo antigo.", "LEGACY_ORDER_EXISTS", 409);
  }
  if (source.status !== "CALCULADA" && source.status !== "ENVIADA") throw new ProposalError("Conclua a simulação antes de criar a proposta.", "SIMULATION_NOT_CALCULATED", 422);
  if (source.items.length === 0) throw new ProposalError("A simulação não tem itens.", "EMPTY_PRODUCTS", 422);
  const blocking = customerOrderReadiness(source.customer).filter((m) => m.level === "blocking");
  if (blocking.length > 0) {
    throw new ProposalError(`Complete o cadastro do cliente: ${blocking.map((b) => b.label).join(", ")}.`, "CUSTOMER_INCOMPLETE", 422, { missing: blocking });
  }

  // Responsável = dono da carteira do cliente (nunca escolhido pelo navegador).
  const sellerId = source.customer.sellerId;
  const link = await activeSellerLink(sellerId, source.brand);
  if (!link) {
    throw new ProposalError(
      "O vendedor responsável pelo cliente não está vinculado a um vendedor do Olist desta empresa. Peça ao administrador para vincular em Administração → Propostas.",
      "SELLER_NOT_LINKED",
      422
    );
  }

  const content: ProposalContent = {
    items: source.items.map((i) => ({ sku: i.sku, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
    discountCents: source.discountCents ?? 0,
    freightCents: conditions.freightCents ?? 0,
    freightResponsibility: conditions.freightResponsibility ?? null,
    paymentType: conditions.paymentType ?? "Nenhuma",
    paymentCondition: conditions.paymentCondition ?? null,
    paymentText: conditions.paymentText ?? null,
    validityDays: conditions.validityDays ?? DEFAULT_VALIDITY_DAYS,
    deliveryTerm: conditions.deliveryTerm ?? null,
    olistSellerId: link.olistSellerId,
    customerNotes: conditions.customerNotes ?? source.notes ?? null,
  };
  const totals = proposalTotals(content);
  const now = new Date();

  let proposalId: string;
  try {
    proposalId = await prisma.$transaction(async (tx) => {
      const fresh = await tx.quote.findUnique({ where: { id: source.id }, select: { status: true } });
      if (fresh?.status !== "CALCULADA" && fresh?.status !== "ENVIADA") throw new ProposalError("A simulação mudou. Recarregue a página.", "CONFLICT", 409);
      const real = await tx.quote.create({
        data: {
          customerId: source.customerId, sellerId, brand: source.brand, origin: "CRM", mode: "REAL", status: "CALCULADA",
          sourceQuoteId: source.id, priceGroup: source.priceGroup, quantityRule: source.quantityRule, selectedTier: source.selectedTier,
          subtotalCents: source.subtotalCents, discountCents: source.discountCents, totalValueCents: source.totalValueCents,
          couponCode: source.couponCode, notes: source.notes, productsSummary: source.productsSummary ?? undefined,
          sellerNameSnapshot: source.sellerNameSnapshot, sellerEmailSnapshot: source.sellerEmailSnapshot,
          sellerPhoneSnapshot: source.sellerPhoneSnapshot, sellerJobTitleSnapshot: source.sellerJobTitleSnapshot,
          items: {
            create: source.items.map((i) => ({
              productId: i.productId, variantId: i.variantId, sku: i.sku, productName: i.productName, colorName: i.colorName,
              quantity: i.quantity, priceGroup: i.priceGroup, priceTableId: i.priceTableId, priceTableVersion: i.priceTableVersion,
              automaticTier: i.automaticTier, appliedTier: i.appliedTier, manualTier: i.manualTier,
              unitPriceCents: i.unitPriceCents, lineSubtotalCents: i.lineSubtotalCents, lineDiscountCents: i.lineDiscountCents, sortOrder: i.sortOrder,
            })),
          },
        },
        select: { id: true },
      });
      const proposal = await tx.commercialProposal.create({
        data: {
          quoteId: real.id, sourceQuoteId: source.id, brand: source.brand, customerId: source.customerId, sellerId,
          version: 1, contentHash: contentHash(content),
          validityDays: content.validityDays, validUntil: validUntilFrom(now, content.validityDays),
          paymentType: content.paymentType, paymentCondition: content.paymentCondition, paymentText: content.paymentText,
          freightCents: content.freightCents, freightResponsibility: content.freightResponsibility, deliveryTerm: content.deliveryTerm,
          customerNotes: content.customerNotes, internalNotes: conditions.internalNotes ?? null,
          olistSellerId: link.olistSellerId, syncStatus: "PENDENTE", createdById: user.id,
        },
        select: { id: true },
      });
      await tx.proposalVersion.create({
        data: {
          proposalId: proposal.id, version: 1, contentHash: contentHash(content), createdById: user.id, reason: "Criada a partir da simulação",
          snapshot: versionSnapshot(source.items.map((i) => ({ sku: i.sku, productName: i.productName, colorName: i.colorName, quantity: i.quantity, unitPriceCents: i.unitPriceCents, appliedTier: i.appliedTier, manualTier: i.manualTier })), content),
          subtotalCents: totals.subtotalCents, discountCents: content.discountCents, freightCents: content.freightCents, totalCents: totals.totalCents,
        },
      });
      await tx.quote.update({ where: { id: source.id }, data: { status: "CONVERTIDA", convertedAt: now } });
      await addEvent(tx, proposal.id, "CREATED", { actorId: user.id, version: 1, data: { simulationId: source.id, totalCents: totals.totalCents } });
      return proposal.id;
    });
  } catch (error) {
    // Corrida: outra aba criou a proposta desta simulação (índice único parcial).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.commercialProposal.findFirst({ where: { sourceQuoteId: source.id, commercialStatus: { not: "CANCELADA" } }, select: { id: true } });
      if (existing) return { proposalId: existing.id, created: false, syncError: null };
    }
    throw error;
  }

  await logAudit({ actorId: user.id, action: "PROPOSAL_CREATED", entityType: "CommercialProposal", entityId: proposalId, metadata: { simulationId: source.id, brand: source.brand, totalCents: totals.totalCents } });
  if (STAGES_THAT_ENTER_QUOTE.includes(source.customer.pipelineStage)) {
    await moveCustomerStage(user.id, source.customerId, "COTACAO", { reason: "proposta comercial criada", automatic: true }).catch(() => undefined);
  }
  return { proposalId, created: true, syncError: await trySync(user.id, proposalId) };
}

// ------------------------------------------------------------ edição

export interface ProposalEditInput extends ProposalConditionsInput {
  expectedVersion: number;
  items: Array<{ sku: string; quantity: number }>;
  requestedTier: PriceTier | "AUTO";
  discountCents: number;
  discountJustification?: string | null;
  reason?: string | null;
}

const RESET_ON_MATERIAL: ProposalCommercialStatus[] = ["AGUARDANDO_APROVACAO", "APROVADA_INTERNAMENTE", "REPROVADA_INTERNAMENTE", "ENVIADA", "EM_NEGOCIACAO", "EXPIRADA"];

/** Nova versão. Preços SEMPRE recalculados no servidor com a tabela fixada da proposta. */
export async function updateProposal(user: SessionUser, id: string, input: ProposalEditInput) {
  const { p } = await authorize(user, id, "edit");
  if (input.expectedVersion !== p.version) throw new ProposalError("A proposta foi alterada por outra pessoa. Recarregue a página.", "CONFLICT", 409);

  // Autorização já feita na proposta; o preço é sempre o do grupo do responsável.
  const pricing = await resolveWholesalePrice({
    actor: { id: p.sellerId, role: p.seller.role },
    sellerId: p.sellerId,
    brand: p.brand,
    items: input.items,
    requestedTier: input.requestedTier,
    discountCents: input.discountCents,
    quantityRule: p.quote.quantityRule ?? "MIX",
    quoteId: p.quoteId,
    pinnedPriceTableId: p.quote.items[0]?.priceTableId ?? null,
  }).catch((error) => {
    if (error instanceof PricingError) throw new ProposalError(error.message, error.code, 422, error.details);
    throw error;
  });

  const before = contentOf(p);
  const content: ProposalContent = {
    items: pricing.lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unitPriceCents: l.unitPriceCents })),
    discountCents: pricing.discountCents,
    freightCents: input.freightCents ?? 0,
    freightResponsibility: input.freightResponsibility ?? null,
    paymentType: input.paymentType ?? "Nenhuma",
    paymentCondition: input.paymentCondition ?? null,
    paymentText: input.paymentText ?? null,
    validityDays: input.validityDays ?? null,
    deliveryTerm: input.deliveryTerm ?? null,
    olistSellerId: p.olistSellerId,
    customerNotes: input.customerNotes ?? null,
  };
  const internalChanged = (input.internalNotes ?? null) !== (p.internalNotes ?? null);
  const newHash = contentHash(content);
  if (newHash === p.contentHash && contentHash(before) === p.contentHash) {
    if (internalChanged) {
      await prisma.commercialProposal.update({ where: { id: p.id }, data: { internalNotes: input.internalNotes ?? null } });
      await addEvent(prisma, p.id, "INTERNAL_NOTES_UPDATED", { actorId: user.id, version: p.version });
    }
    return { version: p.version, changed: false, materialChanged: false, syncError: null };
  }

  const changedFields = diffMaterial(before, content);
  const materialChanged = changedFields.length > 0 && materialHash(before) !== materialHash(content);
  const status = effectiveCommercialStatus(p, new Date());
  const resetStatus = materialChanged && RESET_ON_MATERIAL.includes(status);
  const nextVersion = p.version + 1;
  const totals = proposalTotals(content);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.commercialProposal.updateMany({
      where: { id: p.id, version: p.version },
      data: {
        version: nextVersion,
        contentHash: newHash,
        validityDays: content.validityDays,
        validUntil: validUntilFrom(now, content.validityDays),
        paymentType: content.paymentType, paymentCondition: content.paymentCondition, paymentText: content.paymentText,
        freightCents: content.freightCents, freightResponsibility: content.freightResponsibility, deliveryTerm: content.deliveryTerm,
        customerNotes: content.customerNotes, internalNotes: input.internalNotes ?? null,
        discountJustification: input.discountJustification ?? p.discountJustification,
        syncStatus: p.olistProposalId ? "PENDENTE" : p.syncStatus === "NAO_SINCRONIZADA" ? "NAO_SINCRONIZADA" : "PENDENTE",
        ...(resetStatus ? { commercialStatus: "RASCUNHO" as const } : {}),
        ...(materialChanged
          ? {
              approvalStatus: p.approvalStatus === "APROVADA" || p.approvalStatus === "PENDENTE" ? ("INVALIDADA" as const) : p.approvalStatus === "REPROVADA" ? ("REPROVADA" as const) : ("NAO_SOLICITADA" as const),
              acceptanceStatus: "PENDENTE" as const,
            }
          : {}),
      },
    });
    if (claimed.count !== 1) throw new ProposalError("A proposta foi alterada por outra pessoa. Recarregue a página.", "CONFLICT", 409);
    await tx.quoteItem.deleteMany({ where: { quoteId: p.quoteId } });
    await tx.quoteItem.createMany({
      data: pricing.lines.map((l, index) => ({
        quoteId: p.quoteId, productId: l.productId, variantId: l.variantId ?? null, sku: l.sku, productName: l.productName,
        colorName: l.colorName ?? null, quantity: l.quantity, priceGroup: pricing.priceGroup, priceTableId: pricing.priceTableId,
        priceTableVersion: pricing.priceTableVersion, automaticTier: l.automaticTier, appliedTier: l.appliedTier, manualTier: l.manualTier,
        unitPriceCents: l.unitPriceCents, lineSubtotalCents: l.lineSubtotalCents, lineDiscountCents: l.lineDiscountCents, sortOrder: index,
      })),
    });
    await tx.quote.update({
      where: { id: p.quoteId },
      data: {
        selectedTier: input.requestedTier === "AUTO" ? null : input.requestedTier,
        subtotalCents: pricing.subtotalCents, discountCents: pricing.discountCents, totalValueCents: pricing.totalCents,
        notes: content.customerNotes,
        productsSummary: buildProductsSummary(pricing.lines, { priceGroup: pricing.priceGroup, priceTableVersion: pricing.priceTableVersion, selectedTier: input.requestedTier === "AUTO" ? null : input.requestedTier }) as Prisma.InputJsonValue,
      },
    });
    if (materialChanged && p.approvalStatus === "APROVADA") {
      await tx.proposalApproval.updateMany({ where: { proposalId: p.id, invalidatedAt: null }, data: { invalidatedAt: now } });
    }
    await tx.proposalVersion.create({
      data: {
        proposalId: p.id, version: nextVersion, contentHash: newHash, createdById: user.id, reason: input.reason?.trim() || null,
        snapshot: versionSnapshot(pricing.lines.map((l) => ({ sku: l.sku, productName: l.productName, colorName: l.colorName, quantity: l.quantity, unitPriceCents: l.unitPriceCents, appliedTier: l.appliedTier, manualTier: l.manualTier })), content),
        subtotalCents: totals.subtotalCents, discountCents: content.discountCents, freightCents: content.freightCents, totalCents: totals.totalCents,
      },
    });
    await addEvent(tx, p.id, "VERSION_CREATED", {
      actorId: user.id,
      version: nextVersion,
      data: { changedFields, materialChanged, approvalInvalidated: materialChanged && p.approvalStatus === "APROVADA", reason: input.reason ?? null, totalCents: totals.totalCents },
    });
  });

  return { version: nextVersion, changed: true, materialChanged, syncError: await trySync(user.id, p.id) };
}

export async function syncProposal(user: SessionUser, id: string, force = false) {
  const { p } = await authorize(user, id, force ? "resolve_conflict" : "sync");
  if (force) await addEvent(prisma, p.id, "CONFLICT_OVERWRITTEN", { actorId: user.id, version: p.version });
  return pushProposalToOlist(user.id, p.id, { force });
}

// ------------------------------------------------------------ aprovação

export async function submitForApproval(user: SessionUser, id: string, justification: string | null) {
  const { p, facts, limits } = await authorize(user, id, "submit");
  if (needsDiscountJustification(facts.discountBps, limits) && !(justification ?? p.discountJustification ?? "").trim()) {
    throw new ProposalError("Desconto acima do seu limite: informe a justificativa.", "JUSTIFICATION_REQUIRED", 422, { fieldErrors: { justification: "Obrigatória para este desconto." } });
  }
  await prisma.$transaction(async (tx) => {
    await transition(tx, p, "AGUARDANDO_APROVACAO", {
      approvalStatus: "PENDENTE",
      submittedAt: new Date(),
      ...(justification?.trim() ? { discountJustification: justification.trim() } : {}),
    });
    await addEvent(tx, p.id, "SUBMITTED_FOR_APPROVAL", { actorId: user.id, version: p.version, data: { discountBps: facts.discountBps, justification: justification ?? null } });
  });
}

export async function decideApproval(user: SessionUser, id: string, decision: "approve" | "reject" | "request_changes", reason: string | null) {
  const { p, actor, facts } = await authorize(user, id, decision);
  if (decision !== "approve" && !(reason ?? "").trim()) {
    throw new ProposalError("Informe a justificativa.", "REASON_REQUIRED", 422, { fieldErrors: { reason: "Obrigatória." } });
  }
  const content = contentOf(p);
  const totals = proposalTotals(content);
  const roleLabel = [actor.role, ...actor.functions].join("+");
  await prisma.$transaction(async (tx) => {
    if (decision === "approve") {
      await transition(tx, p, "APROVADA_INTERNAMENTE", { approvalStatus: "APROVADA", approvedVersion: p.version, approvedHash: facts.materialHash, approvedAt: new Date() });
    } else if (decision === "reject") {
      await transition(tx, p, "REPROVADA_INTERNAMENTE", { approvalStatus: "REPROVADA" });
    } else {
      await transition(tx, p, "RASCUNHO", { approvalStatus: "REPROVADA" });
    }
    await tx.proposalApproval.create({
      data: {
        proposalId: p.id, version: p.version, contentHash: facts.materialHash,
        decision: decision === "approve" ? "APROVADA" : decision === "reject" ? "REPROVADA" : "AJUSTE_SOLICITADO",
        actorId: user.id, actorRole: roleLabel, totalCents: totals.totalCents, discountCents: content.discountCents,
        discountBps: discountBps(content.discountCents, totals.subtotalCents), reason: reason?.trim() || null,
      },
    });
    await addEvent(tx, p.id, decision === "approve" ? "APPROVED" : decision === "reject" ? "REJECTED" : "CHANGES_REQUESTED", { actorId: user.id, version: p.version, data: { reason } });
  });
  await logAudit({ actorId: user.id, action: "PROPOSAL_APPROVAL_DECIDED", entityType: "CommercialProposal", entityId: p.id, metadata: { decision, version: p.version, totalCents: totals.totalCents, discountBps: facts.discountBps } });
}

// ------------------------------------------------------------ envio

export async function sendProposalEmail(user: SessionUser, id: string, to: string | null) {
  const { p } = await authorize(user, id, "send_email");
  const recipient = (to || p.customer.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new ProposalError("Informe um e-mail válido para o cliente.", "INVALID_EMAIL", 422, { fieldErrors: { to: "E-mail inválido." } });
  }
  const attempt = await startAttempt(p, "EMAIL", user.id);
  let emailId: string | null = null;
  try {
    // Serviço de e-mail já existente da ponte (a API Olist não envia propostas).
    const result = await callOlistBridge<{ email_id: string }>(p.brand, "/internal/crm/proposals/email", {
      brand: p.brand.toLowerCase(),
      crm_quote_id: p.quoteId,
      to: recipient,
      customer_name: p.customer.tradeName || p.customer.legalName || p.customer.contactName,
      seller_name: p.quote.sellerNameSnapshot,
      seller_email: p.quote.sellerEmailSnapshot,
      notes: [p.customerNotes, p.olistProposalNumber ? `Proposta Olist nº ${p.olistProposalNumber} (versão ${p.version}).` : null].filter(Boolean).join("\n"),
      discount_cents: p.quote.discountCents ?? 0,
      freight_cents: p.freightCents,
      commercial_version: p.version,
      payment_text: [p.paymentText, p.paymentCondition].filter(Boolean).join(" · "),
      delivery_term: p.deliveryTerm,
      valid_until: p.validUntil?.toISOString().slice(0, 10) ?? null,
      items: p.quote.items.map((i) => ({ sku: i.sku, name: i.productName, color: i.colorName, quantity: i.quantity, unit_price_cents: i.unitPriceCents })),
    });
    emailId = result.email_id;
    await finishAttempt(attempt.id, { status: "SUCCEEDED", response: { email_id: result.email_id, to: recipient } });
  } catch (error) {
    const f = await failAttempt(attempt.id, error);
    await prisma.proposalDispatch.create({ data: { proposalId: p.id, version: p.version, channel: "EMAIL", recipient, succeeded: false, errorCode: f.code.slice(0, 80), errorMessage: f.message.slice(0, 500), actorId: user.id } });
    await addEvent(prisma, p.id, "DISPATCH_FAILED", { actorId: user.id, version: p.version, data: { to: recipient, code: f.code } });
    throw new ProposalError(`${f.message} (protocolo ${protocol(attempt.id)})`, f.code, 502);
  }
  await recordDispatch(user, p, { channel: "EMAIL", recipient, description: null, providerRef: emailId });
  return { sentTo: recipient };
}

export async function registerDispatch(user: SessionUser, id: string, input: { description: string; recipient: string | null }) {
  const { p } = await authorize(user, id, "register_dispatch");
  if (input.description.trim().length < 5) throw new ProposalError("Descreva como a proposta foi enviada.", "DESCRIPTION_REQUIRED", 422, { fieldErrors: { description: "Obrigatório." } });
  await recordDispatch(user, p, { channel: "OUTRO_CANAL", recipient: input.recipient, description: input.description.trim(), providerRef: null });
}

async function recordDispatch(user: SessionUser, p: LoadedProposal, d: { channel: "EMAIL" | "OUTRO_CANAL"; recipient: string | null; description: string | null; providerRef: string | null }) {
  await prisma.$transaction(async (tx) => {
    await tx.proposalDispatch.create({ data: { proposalId: p.id, version: p.version, channel: d.channel, recipient: d.recipient, description: d.description, succeeded: true, providerRef: d.providerRef, actorId: user.id } });
    if (p.commercialStatus !== "ENVIADA") await transition(tx, p, "ENVIADA");
    if (d.channel === "EMAIL") await tx.quote.update({ where: { id: p.quoteId }, data: { sentAt: new Date(), sentToEmail: d.recipient } });
    await addEvent(tx, p.id, "SENT", { actorId: user.id, version: p.version, data: { channel: d.channel, recipient: d.recipient, description: d.description } });
  });
  await pushSituation(user.id, p.id, "ENVIADA");
}

// ------------------------------------------------------------ resposta do cliente

export const RESPONSE_CHANNELS = ["EMAIL", "WHATSAPP", "TELEFONE", "PRESENCIAL", "OUTRO"] as const;

export async function registerCustomerResponse(
  user: SessionUser,
  id: string,
  input: { decision: "ACEITA" | "RECUSADA" | "ALTERACAO_SOLICITADA"; channel: (typeof RESPONSE_CHANNELS)[number]; evidence: string; contactName: string | null; occurredAt: Date }
) {
  const action = input.decision === "ACEITA" ? "register_acceptance" : input.decision === "RECUSADA" ? "register_refusal" : "register_change_request";
  const { p } = await authorize(user, id, action);
  if (input.evidence.trim().length < 5) throw new ProposalError("Informe a evidência ou referência da resposta do cliente.", "EVIDENCE_REQUIRED", 422, { fieldErrors: { evidence: "Obrigatória." } });
  if (input.occurredAt.getTime() > Date.now() + 5 * 60_000) throw new ProposalError("A data da resposta não pode estar no futuro.", "INVALID_DATE", 422, { fieldErrors: { occurredAt: "Data futura." } });
  const to: ProposalCommercialStatus = input.decision === "ACEITA" ? "ACEITA" : input.decision === "RECUSADA" ? "RECUSADA" : "EM_NEGOCIACAO";
  await prisma.$transaction(async (tx) => {
    await transition(tx, p, to, {
      acceptanceStatus: input.decision,
      ...(input.decision === "ACEITA" ? { acceptedVersion: p.version, acceptedAt: input.occurredAt } : {}),
    });
    await tx.proposalAcceptance.create({
      data: { proposalId: p.id, version: p.version, decision: input.decision, channel: input.channel, evidence: input.evidence.trim(), contactName: input.contactName?.trim() || null, occurredAt: input.occurredAt, actorId: user.id },
    });
    await addEvent(tx, p.id, input.decision === "ACEITA" ? "ACCEPTED" : input.decision === "RECUSADA" ? "REFUSED" : "CHANGE_REQUESTED_BY_CUSTOMER", {
      actorId: user.id, version: p.version, data: { channel: input.channel, source: "REGISTRO_MANUAL" },
    });
  });
  await pushSituation(user.id, p.id, to);
}

export async function reopenNegotiation(user: SessionUser, id: string, reason: string) {
  const { p } = await authorize(user, id, "reopen");
  if (!reason.trim()) throw new ProposalError("Informe o motivo.", "REASON_REQUIRED", 422, { fieldErrors: { reason: "Obrigatório." } });
  await prisma.$transaction(async (tx) => {
    await transition(tx, p, "EM_NEGOCIACAO", { acceptanceStatus: "ALTERACAO_SOLICITADA", conversionRequestedAt: null, conversionRequestedById: null });
    await addEvent(tx, p.id, "REOPENED", { actorId: user.id, version: p.version, data: { reason } });
  });
}

// ------------------------------------------------------------ conversão (solicitação)

export async function requestConversion(user: SessionUser, id: string) {
  const { p } = await authorize(user, id, "request_conversion");
  await prisma.$transaction(async (tx) => {
    await transition(tx, p, "CONVERSAO_SOLICITADA", { conversionRequestedAt: new Date(), conversionRequestedById: user.id });
    await addEvent(tx, p.id, "CONVERSION_REQUESTED", { actorId: user.id, version: p.version });
  });
}

export async function denyConversion(user: SessionUser, id: string, reason: string) {
  const { p } = await authorize(user, id, "deny_conversion");
  if (!reason.trim()) throw new ProposalError("Informe o motivo.", "REASON_REQUIRED", 422, { fieldErrors: { reason: "Obrigatório." } });
  await prisma.$transaction(async (tx) => {
    await transition(tx, p, "ACEITA", { conversionRequestedAt: null, conversionRequestedById: null });
    await addEvent(tx, p.id, "CONVERSION_DENIED", { actorId: user.id, version: p.version, data: { reason } });
  });
}

// ------------------------------------------------------------ cancelamento, transferência, cópia

export async function cancelProposal(user: SessionUser, id: string, reason: string) {
  const { p } = await authorize(user, id, "cancel");
  if (!reason.trim()) throw new ProposalError("Informe o motivo do cancelamento.", "REASON_REQUIRED", 422, { fieldErrors: { reason: "Obrigatório." } });
  await prisma.$transaction(async (tx) => {
    await transition(tx, p, "CANCELADA", { cancelledAt: new Date(), cancelReason: reason.trim() });
    await addEvent(tx, p.id, "CANCELLED", { actorId: user.id, version: p.version, data: { reason } });
  });
  await logAudit({ actorId: user.id, action: "PROPOSAL_CANCELLED", entityType: "CommercialProposal", entityId: p.id, metadata: { reason } });
  // O CRM não exclui registros do ERP: só marca a proposta no Olist.
  await markInOlist(user.id, p, "CANCELADA NO CRM");
}

export async function transferProposal(user: SessionUser, id: string, targetSellerId: string, reason: string) {
  const { p, actor } = await authorize(user, id, "transfer");
  if (!reason.trim()) throw new ProposalError("Informe o motivo da transferência.", "REASON_REQUIRED", 422, { fieldErrors: { reason: "Obrigatório." } });
  if (targetSellerId === p.sellerId) throw new ProposalError("Escolha outro responsável.", "SAME_SELLER", 422);
  const target = await prisma.user.findFirst({ where: { id: targetSellerId, active: true, deletedAt: null, role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] } }, select: { id: true, name: true } });
  if (!target) throw new ProposalError("Responsável inválido ou inativo.", "SELLER_NOT_FOUND", 422);
  const visible = actor.role === "ADMIN" || isManager(actor) ? null : await getVisibleSellerIds(user);
  if (visible && !visible.includes(target.id)) throw new ProposalError("Você só pode transferir dentro da sua equipe.", "ACTION_NOT_ALLOWED", 403);
  const link = await activeSellerLink(target.id, p.brand);
  if (!link) throw new ProposalError(`${target.name} não tem vínculo com o Olist desta empresa.`, "SELLER_NOT_LINKED", 422);

  const content = { ...contentOf(p), olistSellerId: link.olistSellerId };
  const totals = proposalTotals(content);
  const nextVersion = p.version + 1;
  const status = effectiveCommercialStatus(p, new Date());
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.commercialProposal.updateMany({
      where: { id: p.id, version: p.version },
      data: {
        sellerId: target.id, olistSellerId: link.olistSellerId, version: nextVersion, contentHash: contentHash(content), syncStatus: "PENDENTE",
        // Vendedor é condição material: aprovação e aceite precisam ser refeitos.
        ...(RESET_ON_MATERIAL.includes(status) || status === "ACEITA" || status === "CONVERSAO_SOLICITADA"
          ? { commercialStatus: "RASCUNHO" as const, approvalStatus: p.approvalStatus === "NAO_SOLICITADA" ? ("NAO_SOLICITADA" as const) : ("INVALIDADA" as const), acceptanceStatus: "PENDENTE" as const }
          : {}),
      },
    });
    if (claimed.count !== 1) throw new ProposalError("A proposta foi alterada por outra pessoa. Recarregue a página.", "CONFLICT", 409);
    await tx.quote.update({ where: { id: p.quoteId }, data: { sellerId: target.id } });
    await tx.proposalApproval.updateMany({ where: { proposalId: p.id, invalidatedAt: null }, data: { invalidatedAt: new Date() } });
    await tx.proposalVersion.create({
      data: {
        proposalId: p.id, version: nextVersion, contentHash: contentHash(content), createdById: user.id, reason: `Transferência: ${reason.trim()}`,
        snapshot: versionSnapshot(p.quote.items.map((i) => ({ sku: i.sku, productName: i.productName, colorName: i.colorName, quantity: i.quantity, unitPriceCents: i.unitPriceCents, appliedTier: i.appliedTier, manualTier: i.manualTier })), content),
        subtotalCents: totals.subtotalCents, discountCents: content.discountCents, freightCents: content.freightCents, totalCents: totals.totalCents,
      },
    });
    await addEvent(tx, p.id, "TRANSFERRED", { actorId: user.id, version: nextVersion, data: { from: p.sellerId, to: target.id, reason } });
  });
  await logAudit({ actorId: user.id, action: "PROPOSAL_TRANSFERRED", entityType: "CommercialProposal", entityId: p.id, metadata: { from: p.sellerId, to: target.id, reason } });
  return { syncError: await trySync(user.id, p.id) };
}

/** Nova proposta com os mesmos itens e condições, precificada pela tabela vigente. */
export async function duplicateProposal(user: SessionUser, id: string) {
  const { p } = await authorize(user, id, "duplicate");
  const link = await activeSellerLink(p.sellerId, p.brand);
  if (!link) throw new ProposalError("O vendedor responsável não tem vínculo com o Olist desta empresa.", "SELLER_NOT_LINKED", 422);
  const pricing = await resolveWholesalePrice({
    actor: { id: p.sellerId, role: p.seller.role }, sellerId: p.sellerId, brand: p.brand, items: p.quote.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
    requestedTier: p.quote.selectedTier, discountCents: p.quote.discountCents ?? 0, quantityRule: p.quote.quantityRule ?? "MIX",
  }).catch((error) => {
    if (error instanceof PricingError) throw new ProposalError(error.message, error.code, 422, error.details);
    throw error;
  });
  const content: ProposalContent = {
    ...contentOf(p),
    items: pricing.lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unitPriceCents: l.unitPriceCents })),
    discountCents: pricing.discountCents,
    olistSellerId: link.olistSellerId,
  };
  const totals = proposalTotals(content);
  const now = new Date();
  const newId = await prisma.$transaction(async (tx) => {
    const quote = await tx.quote.create({
      data: {
        customerId: p.customerId, sellerId: p.sellerId, brand: p.brand, origin: "CRM", mode: "REAL", status: "CALCULADA",
        priceGroup: pricing.priceGroup, quantityRule: p.quote.quantityRule, selectedTier: p.quote.selectedTier,
        subtotalCents: pricing.subtotalCents, discountCents: pricing.discountCents, totalValueCents: pricing.totalCents, notes: content.customerNotes,
        sellerNameSnapshot: p.quote.sellerNameSnapshot, sellerEmailSnapshot: p.quote.sellerEmailSnapshot, sellerPhoneSnapshot: p.quote.sellerPhoneSnapshot, sellerJobTitleSnapshot: p.quote.sellerJobTitleSnapshot,
        productsSummary: buildProductsSummary(pricing.lines, { priceGroup: pricing.priceGroup, priceTableVersion: pricing.priceTableVersion, selectedTier: p.quote.selectedTier }) as Prisma.InputJsonValue,
        items: {
          create: pricing.lines.map((l, index) => ({
            productId: l.productId, variantId: l.variantId ?? null, sku: l.sku, productName: l.productName, colorName: l.colorName ?? null,
            quantity: l.quantity, priceGroup: pricing.priceGroup, priceTableId: pricing.priceTableId, priceTableVersion: pricing.priceTableVersion,
            automaticTier: l.automaticTier, appliedTier: l.appliedTier, manualTier: l.manualTier,
            unitPriceCents: l.unitPriceCents, lineSubtotalCents: l.lineSubtotalCents, lineDiscountCents: l.lineDiscountCents, sortOrder: index,
          })),
        },
      },
      select: { id: true },
    });
    const created = await tx.commercialProposal.create({
      data: {
        quoteId: quote.id, brand: p.brand, customerId: p.customerId, sellerId: p.sellerId, version: 1, contentHash: contentHash(content),
        validityDays: content.validityDays, validUntil: validUntilFrom(now, content.validityDays),
        paymentType: content.paymentType, paymentCondition: content.paymentCondition, paymentText: content.paymentText,
        freightCents: content.freightCents, freightResponsibility: content.freightResponsibility, deliveryTerm: content.deliveryTerm,
        customerNotes: content.customerNotes, internalNotes: p.internalNotes, olistSellerId: link.olistSellerId, syncStatus: "PENDENTE", createdById: user.id,
      },
      select: { id: true },
    });
    await tx.proposalVersion.create({
      data: {
        proposalId: created.id, version: 1, contentHash: contentHash(content), createdById: user.id, reason: `Cópia da proposta ${p.olistProposalNumber ?? p.id.slice(-6).toUpperCase()}`,
        snapshot: versionSnapshot(pricing.lines.map((l) => ({ sku: l.sku, productName: l.productName, colorName: l.colorName, quantity: l.quantity, unitPriceCents: l.unitPriceCents })), content),
        subtotalCents: totals.subtotalCents, discountCents: content.discountCents, freightCents: content.freightCents, totalCents: totals.totalCents,
      },
    });
    await addEvent(tx, created.id, "CREATED", { actorId: user.id, version: 1, data: { duplicatedFrom: p.id } });
    await addEvent(tx, p.id, "DUPLICATED", { actorId: user.id, version: p.version, data: { newProposalId: created.id } });
    return created.id;
  });
  await logAudit({ actorId: user.id, action: "PROPOSAL_CREATED", entityType: "CommercialProposal", entityId: newId, metadata: { duplicatedFrom: p.id } });
  return { proposalId: newId, syncError: await trySync(user.id, newId) };
}

export async function financeReview(user: SessionUser, id: string, note: string) {
  const { p } = await authorize(user, id, "finance_review");
  if (note.trim().length < 5) throw new ProposalError("Descreva a conferência realizada.", "NOTE_REQUIRED", 422, { fieldErrors: { note: "Obrigatória." } });
  // Registro de conferência: não baixa títulos nem altera o Olist.
  await addEvent(prisma, p.id, "FINANCE_REVIEW", {
    actorId: user.id,
    data: { note: note.trim(), financialStatus: p.financialStatus, paidCents: p.financialPaidCents, dueCents: p.financialDueCents },
  });
  await logAudit({ actorId: user.id, action: "PROPOSAL_FINANCE_REVIEWED", entityType: "CommercialProposal", entityId: p.id, metadata: { financialStatus: p.financialStatus } });
}

// ------------------------------------------------------------ Olist (entradas autorizadas)

export async function convertToOrder(user: SessionUser, id: string) {
  const { p } = await authorize(user, id, "convert");
  const { preflightProposal } = await import("./proposal-operations");
  const check = await preflightProposal(user, id);
  if (check.problems.length) throw new ProposalError("Confira as pendências antes de gerar o pedido: " + check.problems.join(" "), "CONVERSION_PREFLIGHT_FAILED", 409);
  const latest = await authorize(user, id, "convert");
  if (latest.p.version !== p.version) throw new ProposalError("A proposta mudou durante a conferência. Confira novamente.", "CONFLICT", 409);
  return convertProposal(user.id, p.id);
}

export async function reconcileWithOrder(user: SessionUser, id: string, orderNumber: string, justification: string) {
  const { p } = await authorize(user, id, "reconcile_order");
  const number = orderNumber.trim();
  if (!/^[0-9A-Za-z-]{1,30}$/.test(number)) throw new ProposalError("Informe o número do pedido no Olist.", "INVALID_ORDER_NUMBER", 422, { fieldErrors: { orderNumber: "Número inválido." } });
  if (justification.trim().length < 5) throw new ProposalError("Explique por que o pedido está sendo vinculado manualmente.", "REASON_REQUIRED", 422, { fieldErrors: { justification: "Obrigatória." } });
  return reconcileOrder(user.id, p.id, number, justification.trim());
}

export async function refreshOrderStatus(user: SessionUser, id: string) {
  const { p } = await authorize(user, id, "refresh_order");
  return refreshOrder(user.id, p.id);
}

/** Leitura do Olist (somente consulta). Ignora cliques repetidos em menos de 15 s. */
export async function refreshFromOlist(user: SessionUser, id: string) {
  const { p } = await authorize(user, id, "view");
  if (!p.olistProposalId) throw new ProposalError("A proposta ainda não está registrada no Olist.", "NOT_SYNCED", 409);
  if (p.lastSyncedAt && Date.now() - p.lastSyncedAt.getTime() < 15_000) return { changed: false, conflict: p.syncStatus === "CONFLITO", skipped: true };
  return refreshProposalFromOlist(user.id, p.id);
}

