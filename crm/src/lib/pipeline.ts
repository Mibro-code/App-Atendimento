import "server-only";
import type { ActivityType, PipelineStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  PAUSED_PIPELINE_STAGES,
  PIPELINE_STAGE_META,
  soldReturnDueAt,
  startsNewCycle,
  statusAfterStageMove,
  validateStageMove,
} from "@/lib/pipeline-rules";
import { resolveSaleCommission, commissionCentsFor } from "@/lib/representative-commission";

type Tx = Prisma.TransactionClient;

export class PipelineError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const CUSTOMER_PIPELINE_SELECT = {
  id: true,
  sellerId: true,
  status: true,
  pipelineStage: true,
  commercialCycle: true,
  cycleContactAttempts: true,
  lastSaleAt: true,
} satisfies Prisma.CustomerSelect;

type PipelineCustomer = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_PIPELINE_SELECT }>;

export interface StageChangeOptions {
  reason?: string | null;
  returnAt?: Date | null;
  returnTo?: PipelineStage | null;
  followUpAt?: Date | null;
  followUpNote?: string | null;
  /** Mudança feita pelo sistema (retorno agendado, sincronização). */
  automatic?: boolean;
  /** O chamador já grava o status (editor de status legado). */
  skipStatusSync?: boolean;
}

async function actorRca(tx: Tx, actorId: string): Promise<string | null> {
  return (await tx.user.findUnique({ where: { id: actorId }, select: { rca: true } }))?.rca ?? null;
}

/**
 * Único ponto que muda a etapa do funil. Sempre grava histórico (nunca apaga
 * o anterior), mantém o status legado coerente (INATIVO real no backend) e
 * tira o cliente das filas ativas quando ele é pausado.
 */
export async function applyStageChange(
  tx: Tx,
  customer: PipelineCustomer,
  actorId: string,
  to: PipelineStage,
  options: StageChangeOptions = {}
) {
  const from = customer.pipelineStage;
  if (to === "VENDIDO" && !options.automatic) {
    throw new PipelineError("Somente a aprovação do pedido na Olist pode marcar o cliente como vendido.", 403);
  }
  const now = new Date();
  const error = validateStageMove(from, { to, reason: options.reason, returnAt: options.returnAt, returnTo: options.returnTo }, now);
  if (error) throw new PipelineError(error);

  const newCycle = startsNewCycle(from, to);
  const cycle = newCycle ? customer.commercialCycle + 1 : customer.commercialCycle;
  const newStatus = options.skipStatusSync ? null : statusAfterStageMove(customer.status, to);
  const reason = options.reason?.trim() || null;
  const returnAt = options.returnAt ?? null;
  const keepsReturn = to === "RECICLAGEM" && returnAt;

  const updated = await tx.customer.update({
    where: { id: customer.id },
    data: {
      pipelineStage: to,
      pipelineStageChangedAt: now,
      stageReason: to === "INATIVO" || to === "RECICLAGEM" ? reason : null,
      stageReturnAt: keepsReturn ? returnAt : null,
      stageReturnTo: keepsReturn ? options.returnTo ?? "EM_ATENDIMENTO" : null,
      ...(newCycle ? { commercialCycle: cycle, cycleContactAttempts: 0 } : {}),
      ...(newStatus ? { status: newStatus } : {}),
    },
    select: { ...CUSTOMER_PIPELINE_SELECT, stageReturnAt: true, stageReturnTo: true, stageReason: true, pipelineStageChangedAt: true },
  });

  const rca = await actorRca(tx, actorId);
  await tx.customerStatusHistory.create({
    data: {
      customerId: customer.id,
      field: "PIPELINE_STAGE",
      oldValue: from,
      newValue: to,
      changedById: actorId,
      changedByRca: rca,
      reason: options.automatic ? `Automático: ${reason ?? "retorno agendado"}` : reason,
      commercialCycle: cycle,
    },
  });
  if (newStatus) {
    await tx.customerStatusHistory.create({
      data: {
        customerId: customer.id,
        field: "STATUS",
        oldValue: customer.status,
        newValue: newStatus,
        changedById: actorId,
        changedByRca: rca,
        reason: `Etapa alterada para ${PIPELINE_STAGE_META[to].label}`,
        commercialCycle: cycle,
      },
    });
  }

  // Pausado (Reciclagem/Inativo) sai imediatamente das filas ativas.
  if (PAUSED_PIPELINE_STAGES.includes(to)) {
    await tx.followUp.updateMany({
      where: { customerId: customer.id, status: { in: ["PENDENTE", "ADIADO"] } },
      data: { status: "CONCLUIDO", completedAt: now },
    });
  }

  if (to === "FOLLOW_UP" && options.followUpAt) {
    await tx.followUp.create({
      data: {
        customerId: customer.id,
        sellerId: customer.sellerId,
        dueAt: options.followUpAt,
        source: "MANUAL",
        note: options.followUpNote?.trim() || "Follow-up do funil",
      },
    });
    await tx.customer.update({ where: { id: customer.id }, data: { nextInteractionAt: options.followUpAt } });
  }

  return { from, to, newCycle, cycle, customer: updated };
}

async function loadCustomer(tx: Tx, customerId: string): Promise<PipelineCustomer> {
  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: CUSTOMER_PIPELINE_SELECT });
  if (!customer) throw new PipelineError("Cliente não encontrado.", 404);
  return customer;
}

export async function moveCustomerStage(actorId: string, customerId: string, to: PipelineStage, options: StageChangeOptions = {}) {
  const result = await prisma.$transaction(async (tx) => applyStageChange(tx, await loadCustomer(tx, customerId), actorId, to, options));
  await logAudit({
    actorId: options.automatic ? null : actorId,
    action: "CUSTOMER_STAGE_CHANGED",
    entityType: "Customer",
    entityId: customerId,
    metadata: { from: result.from, to: result.to, reason: options.reason ?? null, newCycle: result.newCycle, cycle: result.cycle },
  });
  return result;
}

/** "Voltar em": agenda o retorno sem mover a etapa agora. */
export async function scheduleStageReturn(actorId: string, customerId: string, returnAt: Date | null, returnTo: PipelineStage | null) {
  if (returnAt && returnAt <= new Date()) throw new PipelineError("A data de retorno deve ser futura.");
  if (returnTo && returnTo !== "NOVO" && returnTo !== "FOLLOW_UP" && returnTo !== "EM_ATENDIMENTO") throw new PipelineError("Destino de retorno inválido.");
  const customer = await prisma.$transaction(async (tx) => {
    const current = await loadCustomer(tx, customerId);
    const updated = await tx.customer.update({
      where: { id: customerId },
      data: { stageReturnAt: returnAt, stageReturnTo: returnAt ? returnTo ?? "NOVO" : null },
      select: { ...CUSTOMER_PIPELINE_SELECT, stageReturnAt: true, stageReturnTo: true },
    });
    await tx.customerActivity.create({
      data: {
        customerId,
        sellerId: actorId,
        type: "FOLLOW_UP",
        description: returnAt
          ? `Retorno agendado para ${PIPELINE_STAGE_META[returnTo ?? "NOVO"].label} em ${returnAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`
          : "Retorno agendado cancelado.",
        commercialCycle: current.commercialCycle,
        pipelineStage: current.pipelineStage,
      },
    });
    return updated;
  });
  await logAudit({
    actorId,
    action: "CUSTOMER_RETURN_SCHEDULED",
    entityType: "Customer",
    entityId: customerId,
    metadata: { returnAt: returnAt?.toISOString() ?? null, returnTo },
  });
  return customer;
}

const CONTACT_CHANNELS: ActivityType[] = ["WHATSAPP", "TELEFONE", "EMAIL", "VISITA", "REUNIAO"];
export function isContactChannel(value: unknown): value is ActivityType {
  return typeof value === "string" && (CONTACT_CHANNELS as string[]).includes(value);
}

/**
 * "Registrar contato": uma tentativa de contato comercial do ciclo atual.
 * A primeira tentativa em Novos leva o cliente para Em atendimento (ação
 * real — abrir o cliente não move nada).
 */
export async function registerContactAttempt(actorId: string, customerId: string, input: { channel: ActivityType; note?: string | null }) {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const customer = await loadCustomer(tx, customerId);
    if (PAUSED_PIPELINE_STAGES.includes(customer.pipelineStage)) {
      throw new PipelineError("Reative o cliente antes de registrar um novo contato.", 409);
    }
    const attempt = customer.cycleContactAttempts + 1;
    const activity = await tx.customerActivity.create({
      data: {
        customerId,
        sellerId: actorId,
        type: input.channel,
        description: input.note?.trim() || `Tentativa de contato ${attempt}`,
        isContactAttempt: true,
        commercialCycle: customer.commercialCycle,
        pipelineStage: customer.pipelineStage,
        createdAt: now,
      },
    });
    await tx.customer.update({
      where: { id: customerId },
      data: { cycleContactAttempts: attempt, lastContactAttemptAt: now, lastInteractionAt: now },
    });
    // Contato registrado cumpre o aviso automático de inatividade pendente.
    await tx.followUp.updateMany({
      where: { customerId, source: { in: ["AUTOMATICO_30_DIAS", "AUTOMATICO_INATIVIDADE"] }, status: { in: ["PENDENTE", "ADIADO"] } },
      data: { status: "CONCLUIDO", completedAt: now },
    });
    const moved = customer.pipelineStage === "NOVO"
      ? await applyStageChange(tx, { ...customer, cycleContactAttempts: attempt }, actorId, "EM_ATENDIMENTO", { reason: "Primeiro contato registrado" })
      : null;
    return { activity, attempts: attempt, stage: moved?.to ?? customer.pipelineStage, cycle: customer.commercialCycle };
  });
  await logAudit({
    actorId,
    action: "CONTACT_ATTEMPT_REGISTERED",
    entityType: "Customer",
    entityId: customerId,
    metadata: { channel: input.channel, attempt: result.attempts, cycle: result.cycle, stage: result.stage },
  });
  return result;
}

/** Grava o percentual/valor de comissão vigente na venda (apenas representantes). */
export async function snapshotSaleCommission(tx: Tx, saleId: string) {
  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true, valueCents: true, confirmedAt: true, createdAt: true, commissionSource: true, commissionRateBps: true,
      olistOrder: { select: { brand: true } },
      seller: { select: { id: true, role: true, sellerProfile: { select: { representativeType: true } } } },
    },
  });
  if (!sale) return null;
  if (sale.commissionSource === "CUSTOM_ORDER") {
    return tx.sale.update({ where: { id: saleId }, data: { commissionCents: commissionCentsFor(sale.valueCents, sale.commissionRateBps) } });
  }
  if (sale.seller.role !== "REPRESENTANTE") return null;
  const type = sale.seller.sellerProfile?.representativeType ?? null;
  const [plans, typeDefault] = await Promise.all([
    tx.commissionPlan.findMany({ where: { representativeId: sale.seller.id } }),
    type ? tx.representativeTypeCommission.findUnique({ where: { type } }) : Promise.resolve(null),
  ]);
  const resolved = resolveSaleCommission({
    plans, typeDefaultBps: typeDefault?.rateBps ?? null, brand: sale.olistOrder?.brand ?? null, at: sale.confirmedAt ?? sale.createdAt,
  });
  return tx.sale.update({
    where: { id: saleId },
    data: {
      commissionRateBps: resolved.rateBps,
      commissionCents: commissionCentsFor(sale.valueCents, resolved.rateBps),
      commissionSource: resolved.source,
    },
  });
}

/** Leva o cliente para Vendidos após aprovação recebida pela integração Olist. */
export async function moveToSoldAfterConfirmedSale(tx: Tx, customerId: string, actorId: string, reason: string) {
  const customer = await loadCustomer(tx, customerId);
  if (customer.pipelineStage === "VENDIDO") {
    await tx.customer.update({ where: { id: customerId }, data: { pipelineStageChangedAt: new Date() } });
    return null;
  }
  return applyStageChange(tx, customer, actorId, "VENDIDO", { reason, automatic: true });
}


/**
 * Aplica retornos vencidos dentro do escopo: "Voltar em" / Reciclagem com
 * data e Vendidos que completaram o prazo de recompra (padrão 30 dias).
 * Usa só consultas indexadas e limitadas — nunca varre a carteira inteira.
 */
export async function applyDueStageReturns(scope: Prisma.CustomerWhereInput, now: Date = new Date()) {
  const [scheduled, sold] = await Promise.all([
    prisma.customer.findMany({
      where: { AND: [scope, { stageReturnAt: { lte: now }, stageReturnTo: { not: null } }] },
      select: { ...CUSTOMER_PIPELINE_SELECT, stageReturnTo: true },
      take: 200,
    }),
    prisma.customer.findMany({
      where: { AND: [scope, { pipelineStage: "VENDIDO", pipelineStageChangedAt: { lte: new Date(now.getTime() - 86_400_000) } }] },
      select: { ...CUSTOMER_PIPELINE_SELECT, pipelineStageChangedAt: true, seller: { select: { followUpAfterDays: true } } },
      take: 500,
    }),
  ]);
  let moved = 0;
  for (const customer of scheduled) {
    const target = customer.stageReturnTo!;
    await prisma.$transaction(async (tx) => {
      if (customer.pipelineStage === target) {
        await tx.customer.update({ where: { id: customer.id }, data: { stageReturnAt: null, stageReturnTo: null } });
        return;
      }
      await applyStageChange(tx, customer, customer.sellerId, target, { reason: "retorno agendado", automatic: true });
    });
    moved += 1;
  }
  for (const customer of sold) {
    if (soldReturnDueAt(customer.pipelineStageChangedAt, customer.seller.followUpAfterDays) > now) continue;
    await prisma.$transaction((tx) =>
      applyStageChange(tx, customer, customer.sellerId, "FOLLOW_UP", {
        reason: "oportunidade de recompra após o prazo da venda",
        automatic: true,
        followUpAt: now,
        followUpNote: "Follow-up de recompra",
      })
    );
    moved += 1;
  }
  return { moved };
}
