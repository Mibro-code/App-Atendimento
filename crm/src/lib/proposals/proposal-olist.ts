import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { callOlistBridge } from "@/lib/olist/bridge-client";
import { orderTaxId } from "@/lib/olist/real-order-rules";
import { syncOlistOrderStatus } from "@/lib/olist-order-status";
import { activeSellerLink, contentOf, type LoadedProposal } from "@/lib/proposals/proposal-access";
import { proposalSituationSyncEnabled } from "@/lib/proposals/proposal-config";
import {
  addEvent,
  bridgeFailure,
  failAttempt,
  finishAttempt,
  loadProposal,
  protocol,
  startAttempt,
  withProposalLock,
} from "@/lib/proposals/proposal-core";
import {
  buildBridgeProposalPayload,
  financialFromReceivables,
  isAmbiguousFailure,
  isApprovedOrLater,
  isConcludedSituation,
  materialFromOlist,
  OLIST_SITUATION_FOR,
  orderStatusFromSituation,
  validateOrderForProposal,
  verifyProposalReadback,
  type OlistOrderInspection,
  type OlistProposalSnapshot,
} from "@/lib/proposals/proposal-olist-rules";
import { diffMaterial, MATERIAL_FIELD_LABELS, materialHash, ProposalError, proposalTotals } from "@/lib/proposals/proposal-rules";

// Toda conversa com o Olist passa pela ponte da marca (o token Olist nunca
// chega ao CRM). As permissões já foram verificadas por quem chama.

const hashOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

interface UpsertResponse {
  olist_proposal_id: string;
  proposal_number: string | null;
  contact_id: string | null;
  created: boolean;
  snapshot: OlistProposalSnapshot;
}

/** Última tentativa de criação terminou de forma ambígua? (então procurar antes de criar) */
async function lastCreateWasAmbiguous(quoteId: string): Promise<boolean> {
  const last = await prisma.olistSyncAttempt.findFirst({
    where: { quoteId, action: "PROPOSAL_CREATE" },
    orderBy: { startedAt: "desc" },
    select: { status: true, errorCode: true, response: true },
  });
  if (!last) return false;
  if (last.status === "STARTED") return true;
  if (last.status !== "FAILED") return false;
  const status = (last.response as { bridgeStatus?: number } | null)?.bridgeStatus;
  return isAmbiguousFailure(last.errorCode ?? "", status);
}

async function readSnapshot(p: LoadedProposal): Promise<OlistProposalSnapshot> {
  const res = await callOlistBridge<{ snapshot: OlistProposalSnapshot }>(p.brand, "/internal/crm/proposals/get", {
    brand: p.brand.toLowerCase(),
    olist_proposal_id: p.olistProposalId,
  });
  return res.snapshot;
}

/**
 * Cria ou atualiza a proposta no Olist com a versão atual do CRM.
 * - antes de atualizar, compara o Olist com a última fotografia: se alguém
 *   alterou lá, marca CONFLITO e não sobrescreve (exceto `force`);
 * - criação após timeout procura primeiro pela referência do CRM, para
 *   nunca duplicar a proposta;
 * - confere o que o Olist gravou.
 */
export async function pushProposalToOlist(actorId: string, proposalId: string, opts: { force?: boolean } = {}) {
  return withProposalLock(proposalId, async () => {
    const p = await loadProposal(proposalId);
    const link = await activeSellerLink(p.sellerId, p.brand);
    if (!link || link.olistSellerId !== p.olistSellerId) {
      await prisma.commercialProposal.update({
        where: { id: p.id },
        data: { syncStatus: "ERRO", lastSyncErrorCode: "SELLER_NOT_LINKED", lastSyncError: "Vendedor sem vínculo válido com o Olist." },
      });
      throw new ProposalError("O vendedor responsável não tem vínculo válido com o Olist desta empresa.", "SELLER_NOT_LINKED", 422);
    }

    if (p.olistProposalId && p.olistSnapshotHash && !opts.force) {
      const current = await readSnapshot(p).catch((error) => {
        throw new ProposalError(`Não foi possível conferir a proposta no Olist antes de atualizar: ${bridgeFailure(error).message}`, "OLIST_READ_FAILED", 502);
      });
      if (materialHash(materialFromOlist(current)) !== p.olistSnapshotHash) {
        await markExternalChange(p, current);
        throw new ProposalError("A proposta foi alterada diretamente no Olist. Resolva o conflito antes de reenviar.", "OLIST_CONFLICT", 409);
      }
    }

    let olistProposalId = p.olistProposalId;
    if (!olistProposalId && (await lastCreateWasAmbiguous(p.quoteId))) {
      const found = await callOlistBridge<{ found: boolean; olist_proposal_id?: string }>(p.brand, "/internal/crm/proposals/find", {
        brand: p.brand.toLowerCase(),
        crm_proposal_id: p.id,
        tax_id: orderTaxId(p.customer),
        seller_olist_id: p.olistSellerId,
        since: p.createdAt.toISOString().slice(0, 10),
      });
      if (found.found && found.olist_proposal_id) {
        olistProposalId = found.olist_proposal_id;
        await addEvent(prisma, p.id, "OLIST_RECOVERED", { actorId, version: p.version, origin: "SISTEMA", data: { olistProposalId } });
      } else {
        // Uma busca negativa não comprova que o POST anterior falhou: o ERP
        // pode ainda estar indexando. Nunca criar novamente por tentativa.
        await prisma.commercialProposal.update({ where: { id: p.id }, data: { syncStatus: "ERRO", lastSyncErrorCode: "OLIST_CREATE_UNCERTAIN", lastSyncError: "Criação sem confirmação. Consulte novamente ou vincule o orçamento existente; nenhum novo orçamento foi criado." } });
        throw new ProposalError("Criação sem confirmação: a referência ainda não foi localizada. Nenhum novo orçamento foi criado. Consulte novamente após a atualização do Olist.", "OLIST_CREATE_UNCERTAIN", 409);
      }
    }

    const content = contentOf(p);
    const payload = buildBridgeProposalPayload({
      proposalId: p.id,
      version: p.version,
      brand: p.brand,
      customer: p.customer,
      content,
      itemNames: Object.fromEntries(p.quote.items.map((i) => [i.sku, [i.productName, i.colorName].filter(Boolean).join(" — ")])),
      olistProposalId,
      natureId: null,
    });
    const action = olistProposalId ? "PROPOSAL_UPDATE" : "PROPOSAL_CREATE";
    await prisma.commercialProposal.update({ where: { id: p.id }, data: { syncStatus: "SINCRONIZANDO" } });
    const attempt = await startAttempt(p, action, actorId, hashOf(payload));

    let res: UpsertResponse;
    try {
      res = await callOlistBridge<UpsertResponse>(p.brand, "/internal/crm/proposals/upsert", payload);
    } catch (error) {
      const f = await failAttempt(attempt.id, error);
      await prisma.commercialProposal.update({
        where: { id: p.id },
        data: { syncStatus: "ERRO", lastSyncErrorCode: f.code.slice(0, 80), lastSyncError: f.message.slice(0, 500) },
      });
      await addEvent(prisma, p.id, "OLIST_SYNC_ERROR", { actorId, version: p.version, data: { code: f.code, attemptId: attempt.id } });
      const ambiguous = isAmbiguousFailure(f.code, f.status);
      throw new ProposalError(
        `${f.message}${ambiguous ? " Nada será repetido às cegas: a próxima tentativa confere antes no Olist." : ""} (protocolo ${protocol(attempt.id)})`,
        f.code,
        ambiguous ? 502 : 422
      );
    }

    const problems = verifyProposalReadback(content, res.snapshot);
    const snapshotHash = materialHash(materialFromOlist(res.snapshot));
    try {
      await prisma.commercialProposal.update({
        where: { id: p.id },
        data: {
          olistProposalId: res.olist_proposal_id,
          olistProposalNumber: res.proposal_number ?? res.snapshot.number,
          olistContactId: res.contact_id ?? res.snapshot.contact_id,
          olistSituation: res.snapshot.situation,
          olistSubtotalCents: res.snapshot.subtotal_cents,
          olistTotalCents: res.snapshot.total_cents,
          olistSnapshotHash: snapshotHash,
          syncedVersion: problems.length === 0 ? p.version : p.syncedVersion,
          syncStatus: problems.length === 0 ? "SINCRONIZADA" : "CONFLITO",
          lastSyncedAt: new Date(),
          lastSyncErrorCode: problems.length === 0 ? null : "OLIST_VERIFICATION_FAILED",
          lastSyncError: problems.length === 0 ? null : `O Olist gravou valores diferentes: ${problems.join(", ")}.`,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        await failAttempt(attempt.id, new ProposalError("Proposta Olist já vinculada a outra proposta do CRM.", "OLIST_PROPOSAL_OWNERSHIP"));
        throw new ProposalError("A proposta retornada pelo Olist já pertence a outra proposta do CRM.", "OLIST_PROPOSAL_OWNERSHIP", 409);
      }
      throw error;
    }
    await finishAttempt(attempt.id, {
      status: problems.length === 0 ? "SUCCEEDED" : "FAILED",
      errorCode: problems.length === 0 ? null : "OLIST_VERIFICATION_FAILED",
      mismatch: problems.length === 0 ? undefined : problems,
      response: JSON.parse(JSON.stringify({ olist_proposal_id: res.olist_proposal_id, number: res.proposal_number, created: res.created, total_cents: res.snapshot.total_cents })),
    });
    await addEvent(prisma, p.id, problems.length === 0 ? (res.created ? "OLIST_CREATED" : "OLIST_UPDATED") : "OLIST_DIVERGENCE", {
      actorId,
      version: p.version,
      data: { olistProposalId: res.olist_proposal_id, number: res.proposal_number, problems },
    });
    return { olistProposalId: res.olist_proposal_id, number: res.proposal_number, problems };
  });
}

/** Alteração material feita no Olist: conflito e invalidação da aprovação. */
async function markExternalChange(p: LoadedProposal, current: OlistProposalSnapshot) {
  const fields = diffMaterial(contentOf(p), materialFromOlist(current));
  await prisma.$transaction(async (tx) => {
    await tx.commercialProposal.update({
      where: { id: p.id },
      data: {
        syncStatus: "CONFLITO",
        olistSituation: current.situation,
        olistTotalCents: current.total_cents,
        lastSyncedAt: new Date(),
        lastSyncErrorCode: "OLIST_EXTERNAL_CHANGE",
        lastSyncError: `Alterado no Olist: ${fields.map((f) => MATERIAL_FIELD_LABELS[f]).join(", ") || "dados da proposta"}.`,
        ...(p.approvalStatus === "APROVADA" || p.approvalStatus === "PENDENTE" ? { approvalStatus: "INVALIDADA" } : {}),
      },
    });
    if (p.approvalStatus === "APROVADA") {
      await tx.proposalApproval.updateMany({ where: { proposalId: p.id, version: p.version, invalidatedAt: null }, data: { invalidatedAt: new Date() } });
    }
    await addEvent(tx, p.id, "OLIST_EXTERNAL_CHANGE", { origin: "OLIST", version: p.version, data: { fields } });
  });
}

/** Leitura do Olist: detecta alterações externas, situação e conclusão sem pedido. */
export async function refreshProposalFromOlist(actorId: string | null, proposalId: string) {
  const p = await loadProposal(proposalId);
  if (!p.olistProposalId) return { changed: false, conflict: false };
  const attempt = await startAttempt(p, "PROPOSAL_READ", actorId);
  let snapshot: OlistProposalSnapshot;
  try {
    snapshot = await readSnapshot(p);
  } catch (error) {
    const f = await failAttempt(attempt.id, error);
    await prisma.commercialProposal.update({ where: { id: p.id }, data: { lastSyncErrorCode: f.code.slice(0, 80), lastSyncError: f.message.slice(0, 500) } });
    throw new ProposalError(`${f.message} (protocolo ${protocol(attempt.id)})`, f.code, 502);
  }
  await finishAttempt(attempt.id, { status: "SUCCEEDED", response: { situation: snapshot.situation, total_cents: snapshot.total_cents } });

  const conflict = !!p.olistSnapshotHash && materialHash(materialFromOlist(snapshot)) !== p.olistSnapshotHash;
  if (conflict && p.syncStatus !== "CONFLITO") await markExternalChange(p, snapshot);
  const situationChanged = (snapshot.situation ?? null) !== (p.olistSituation ?? null);
  if (!conflict) {
    await prisma.commercialProposal.update({
      where: { id: p.id },
      data: { olistSituation: snapshot.situation, olistTotalCents: snapshot.total_cents, olistSubtotalCents: snapshot.subtotal_cents, lastSyncedAt: new Date() },
    });
  }
  if (situationChanged) {
    await addEvent(prisma, p.id, "OLIST_SITUATION_CHANGED", { origin: "OLIST", data: { from: p.olistSituation, to: snapshot.situation } });
    if (p.orderStatus === "SEM_PEDIDO" && isConcludedSituation(snapshot.situation)) {
      await addEvent(prisma, p.id, "OLIST_CONCLUDED_WITHOUT_ORDER", { origin: "OLIST", data: { situation: snapshot.situation } });
    }
  }
  return { changed: situationChanged || conflict, conflict };
}

/** Atualização opcional da situação no Olist (OLIST_PROPOSAL_SITUATION_SYNC=1). Nunca bloqueia o CRM. */
export async function pushSituation(actorId: string, proposalId: string, commercialStatus: string) {
  const situation = OLIST_SITUATION_FOR[commercialStatus];
  if (!proposalSituationSyncEnabled() || !situation) return;
  const p = await loadProposal(proposalId);
  if (!p.olistProposalId) return;
  const attempt = await startAttempt(p, "PROPOSAL_SITUATION", actorId);
  try {
    await callOlistBridge(p.brand, "/internal/crm/proposals/situation", { brand: p.brand.toLowerCase(), olist_proposal_id: p.olistProposalId, situation });
    await finishAttempt(attempt.id, { status: "SUCCEEDED", response: { situation } });
    await prisma.commercialProposal.update({ where: { id: p.id }, data: { olistSituation: situation } });
    await addEvent(prisma, p.id, "OLIST_SITUATION_PUSHED", { actorId, data: { situation } });
  } catch (error) {
    const f = await failAttempt(attempt.id, error);
    await addEvent(prisma, p.id, "OLIST_SITUATION_ERROR", { actorId, data: { situation, code: f.code } });
  }
}

/** Marcador informativo no Olist (ex.: cancelada no CRM). Melhor esforço. */
export async function markInOlist(actorId: string, p: LoadedProposal, marker: string) {
  if (!p.olistProposalId) return;
  try {
    await callOlistBridge(p.brand, "/internal/crm/proposals/mark", { brand: p.brand.toLowerCase(), olist_proposal_id: p.olistProposalId, marker });
  } catch (error) {
    await addEvent(prisma, p.id, "OLIST_MARK_ERROR", { actorId, data: { marker, code: bridgeFailure(error).code } });
  }
}

// ------------------------------------------------------------ conversão

interface ConvertResponse {
  olist_order_id: string;
  order_number: string | null;
  order: OlistOrderInspection | null;
}

async function linkOrder(
  p: LoadedProposal,
  actorId: string,
  order: { id: string; number: string | null; situationCode: number | null; situationLabel: string | null },
  eventType: string,
  data: Record<string, unknown>
) {
  const { totalCents } = proposalTotals(contentOf(p));
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.commercialProposal.updateMany({
      where: { id: p.id, olistOrderId: null, orderStatus: { in: ["SEM_PEDIDO", "CONVERSAO_EM_ANDAMENTO", "CONVERSAO_INCERTA"] } },
      data: {
        commercialStatus: "CONVERTIDA",
        orderStatus: orderStatusFromSituation(order.situationCode, "PEDIDO_CRIADO"),
        financialStatus: "SEM_COBRANCA",
        convertedAt: new Date(),
        convertedById: actorId,
        olistOrderId: order.id,
        olistOrderNumber: order.number,
        olistOrderSituation: order.situationLabel,
        orderLastSyncedAt: new Date(),
      },
    });
    if (claimed.count !== 1) throw new ProposalError("A conversão já foi realizada.", "ALREADY_CONVERTED", 409);
    // Mesmo registro de pedido usado pelo fluxo existente (status, venda, comissão).
    await tx.olistOrder.create({
      data: {
        brand: p.brand, customerId: p.customerId, quoteId: p.quoteId, olistOrderId: order.id, orderNumber: order.number,
        valueCents: totalCents, crmStatus: "PEDIDO_CRIADO", olistStatusRaw: order.situationLabel, lastSyncedAt: new Date(),
      },
    });
    await addEvent(tx, p.id, eventType, { actorId, version: p.version, data: { olistOrderId: order.id, orderNumber: order.number, ...data } as Prisma.InputJsonValue });
  });
  await logAudit({
    actorId, action: "PROPOSAL_ORDER_LINKED", entityType: "CommercialProposal", entityId: p.id,
    metadata: { olistOrderId: order.id, orderNumber: order.number, via: eventType, brand: p.brand } as Prisma.InputJsonValue,
  });
}

/**
 * Conversão nativa: POST /orcamentos/{id}/venda. Claim atômico impede dupla
 * execução; falha ambígua NÃO é repetida (vira CONVERSAO_INCERTA e exige
 * conciliação manual). Nunca cria pedido por outro caminho.
 */
export async function convertProposal(actorId: string, proposalId: string) {
  const before = await loadProposal(proposalId);
  // Confere a última situação no Olist imediatamente antes.
  const fresh = await refreshProposalFromOlist(actorId, proposalId);
  if (fresh.conflict) throw new ProposalError("A proposta foi alterada no Olist. Resolva o conflito antes de converter.", "OLIST_CONFLICT", 409);
  const p = await loadProposal(proposalId);
  if (isConcludedSituation(p.olistSituation)) {
    throw new ProposalError("O Olist indica a proposta como concluída. Vincule o pedido existente em vez de converter de novo.", "OLIST_ALREADY_CONCLUDED", 409);
  }

  const claim = await prisma.commercialProposal.updateMany({
    where: { id: p.id, version: before.version, orderStatus: "SEM_PEDIDO", olistOrderId: null, commercialStatus: { in: ["ACEITA", "CONVERSAO_SOLICITADA"] } },
    data: { orderStatus: "CONVERSAO_EM_ANDAMENTO" },
  });
  if (claim.count !== 1) throw new ProposalError("A conversão já está em andamento ou foi realizada.", "CONVERSION_IN_PROGRESS", 409);

  const attempt = await startAttempt(p, "PROPOSAL_CONVERT", actorId);
  let res: ConvertResponse;
  try {
    res = await callOlistBridge<ConvertResponse>(p.brand, "/internal/crm/proposals/convert", {
      brand: p.brand.toLowerCase(),
      crm_proposal_id: p.id,
      olist_proposal_id: p.olistProposalId,
    });
  } catch (error) {
    const f = await failAttempt(attempt.id, error);
    const ambiguous = isAmbiguousFailure(f.code, f.status);
    await prisma.commercialProposal.update({ where: { id: p.id }, data: { orderStatus: ambiguous ? "CONVERSAO_INCERTA" : "SEM_PEDIDO" } });
    await addEvent(prisma, p.id, ambiguous ? "CONVERSION_UNCERTAIN" : "CONVERSION_FAILED", { actorId, version: p.version, data: { code: f.code, attemptId: attempt.id } });
    if (ambiguous) {
      await logAudit({ actorId, action: "PROPOSAL_CONVERSION_UNCERTAIN", entityType: "CommercialProposal", entityId: p.id, metadata: { attemptId: attempt.id, code: f.code } });
      throw new ProposalError(
        `Não foi possível confirmar se o Olist gerou o pedido. A conversão NÃO será repetida automaticamente: confira no Olist e vincule o pedido (protocolo ${protocol(attempt.id)}).`,
        "CONVERSION_UNCERTAIN",
        502
      );
    }
    throw new ProposalError(`O Olist recusou a conversão: ${f.message} (protocolo ${protocol(attempt.id)})`, f.code, 422);
  }

  await finishAttempt(attempt.id, { status: "SUCCEEDED", olistOrderId: String(res.olist_order_id), orderNumber: res.order_number, response: { olist_order_id: res.olist_order_id, order_number: res.order_number } });
  const problems = res.order
    ? validateOrderForProposal(res.order, { taxId: orderTaxId(p.customer), olistSellerId: p.olistSellerId, items: contentOf(p).items })
    : ["O Olist não devolveu os dados do pedido para conferência."];
  await linkOrder(
    p,
    actorId,
    { id: String(res.olist_order_id), number: res.order_number, situationCode: res.order?.situation_code ?? null, situationLabel: res.order?.situation_label ?? null },
    "CONVERTED",
    { attemptId: attempt.id, problems }
  );
  return { olistOrderId: String(res.olist_order_id), orderNumber: res.order_number, problems };
}

async function inspectOrder(p: LoadedProposal, query: { olist_order_id?: string; order_number?: string }) {
  const res = await callOlistBridge<{ order: OlistOrderInspection }>(p.brand, "/internal/crm/orders/inspect", { brand: p.brand.toLowerCase(), ...query });
  return res.order;
}

/** Vínculo manual supervisionado de um pedido gerado no Olist. */
export async function reconcileOrder(actorId: string, proposalId: string, orderNumber: string, justification: string) {
  const p = await loadProposal(proposalId);
  let order: OlistOrderInspection;
  try {
    order = await inspectOrder(p, { order_number: orderNumber });
  } catch (error) {
    const f = bridgeFailure(error);
    throw new ProposalError(f.code === "OLIST_ORDER_NOT_FOUND" ? `Pedido ${orderNumber} não encontrado no Olist.` : f.message, f.code, f.status && f.status < 500 ? 422 : 502);
  }
  const problems = validateOrderForProposal(order, { taxId: orderTaxId(p.customer), olistSellerId: p.olistSellerId, items: contentOf(p).items });
  if (problems.length > 0) throw new ProposalError(`O pedido não confere com a proposta: ${problems.join(" ")}`, "ORDER_MISMATCH", 422, { problems });
  const taken = await prisma.olistOrder.findUnique({ where: { brand_olistOrderId: { brand: p.brand, olistOrderId: order.id } }, select: { quoteId: true } });
  if (taken) throw new ProposalError("Este pedido já está vinculado a outra proposta ou cotação.", "ORDER_ALREADY_LINKED", 409);
  await linkOrder(p, actorId, { id: order.id, number: order.number, situationCode: order.situation_code, situationLabel: order.situation_label }, "ORDER_LINKED_MANUALLY", { justification });
  return refreshOrder(actorId, proposalId);
}

/**
 * Situação do pedido e do recebimento. A aprovação do pedido segue a regra
 * EXISTENTE de venda/comissão (syncOlistOrderStatus); o estado financeiro da
 * proposta vem só do contas a receber.
 */
export async function refreshOrder(actorId: string | null, proposalId: string) {
  const p = await loadProposal(proposalId);
  if (!p.olistOrderId) throw new ProposalError("Não há pedido vinculado.", "NO_ORDER", 409);
  const attempt = await startAttempt(p, "ORDER_STATUS", actorId);
  let order: OlistOrderInspection;
  try {
    order = await inspectOrder(p, { olist_order_id: p.olistOrderId });
  } catch (error) {
    const f = await failAttempt(attempt.id, error);
    throw new ProposalError(`${f.message} (protocolo ${protocol(attempt.id)})`, f.code, 502);
  }
  await finishAttempt(attempt.id, { status: "SUCCEEDED", olistOrderId: order.id, orderNumber: order.number, response: { situation: order.situation_code, receivables: order.receivables.length } });

  const orderStatus = orderStatusFromSituation(order.situation_code, p.orderStatus);
  const fin = financialFromReceivables(order.receivables);
  const changed = orderStatus !== p.orderStatus || fin.status !== p.financialStatus || fin.paidCents !== (p.financialPaidCents ?? 0);
  await prisma.commercialProposal.update({
    where: { id: p.id },
    data: {
      orderStatus,
      olistOrderSituation: order.situation_label,
      financialStatus: fin.status,
      financialDueCents: fin.dueCents,
      financialPaidCents: fin.paidCents,
      financialOpenCents: fin.openCents,
      orderLastSyncedAt: new Date(),
    },
  });
  if (changed) {
    await addEvent(prisma, p.id, "ORDER_STATUS_CHANGED", {
      origin: "OLIST",
      data: { orderStatus, financialStatus: fin.status, situation: order.situation_label, paidCents: fin.paidCents, dueCents: fin.dueCents },
    });
  }
  // Regra de contabilização já existente (Sale/comissão/funil) — sem alterá-la.
  if (isApprovedOrLater(order.situation_code) && p.quote.olistOrder?.crmStatus !== "PAGAMENTO_CONFIRMADO") {
    await syncOlistOrderStatus({ brand: p.brand, externalOrderId: order.id, statusRaw: "Aprovada" });
  } else if (order.situation_code === 2 && p.orderStatus !== "CANCELADO") {
    await syncOlistOrderStatus({ brand: p.brand, externalOrderId: order.id, statusRaw: "Cancelada" });
  }
  return { orderStatus, financial: fin };
}
