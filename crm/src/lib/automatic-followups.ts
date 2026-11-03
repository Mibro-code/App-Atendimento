import "server-only";
import { prisma } from "@/lib/prisma";
import { getCustomerScopeFilter, type SessionUser } from "@/lib/authz";
import { getAutomaticFollowUpSchedule, shouldMaterializeAutomaticFollowUp } from "@/lib/followup-rules";
import type { PipelineStage, Prisma } from "@prisma/client";
import { PAUSED_PIPELINE_STAGES } from "@/lib/pipeline-rules";

const AUTOMATIC_SOURCES = ["AUTOMATICO_30_DIAS", "AUTOMATICO_INATIVIDADE"] as const;

const SYNC_CUSTOMER_SELECT = {
  id: true,
  sellerId: true,
  createdAt: true,
  lastInteractionAt: true,
  lastSaleAt: true,
  pipelineStage: true,
  seller: { select: { followUpAfterDays: true } },
} satisfies Prisma.CustomerSelect;

// A varredura completa da carteira é cara (lê todos os clientes do escopo e
// seus follow-ups). As ações que mudam o prazo de um cliente (atividade,
// contato, cotação, venda, repasse) já sincronizam aquele cliente na hora;
// a varredura por escopo só precisa capturar prazos que venceram com o
// passar do tempo, então roda no máximo uma vez a cada intervalo por usuário.
const SCOPE_SYNC_INTERVAL_MS = 5 * 60_000;
const lastScopeSync = new Map<string, { at: number; staleCount: number }>();

export async function syncAutomaticFollowUpsForScope(user: SessionUser, options: { force?: boolean } = {}) {
  const key = `${user.role}:${user.id}`;
  const cached = lastScopeSync.get(key);
  if (!options.force && cached && Date.now() - cached.at < SCOPE_SYNC_INTERVAL_MS) {
    return { staleCount: cached.staleCount };
  }
  const scope = await getCustomerScopeFilter(user);
  const customers = await prisma.customer.findMany({ where: scope, select: SYNC_CUSTOMER_SELECT });
  const result = await syncAutomaticFollowUps(customers);
  lastScopeSync.set(key, { at: Date.now(), staleCount: result.staleCount });
  return result;
}

export async function syncAutomaticFollowUpsForCustomerIds(customerIds: string[]) {
  if (customerIds.length === 0) return { staleCount: 0 };
  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: SYNC_CUSTOMER_SELECT });
  return syncAutomaticFollowUps(customers);
}

export async function syncAutomaticFollowUpsForSellerIds(sellerIds: string[]) {
  if (sellerIds.length === 0) return { staleCount: 0 };
  const customers = await prisma.customer.findMany({
    where: { sellerId: { in: sellerIds } },
    select: SYNC_CUSTOMER_SELECT,
  });
  return syncAutomaticFollowUps(customers);
}

async function syncAutomaticFollowUps(
  customers: Array<{
    id: string;
    sellerId: string;
    createdAt: Date;
    lastInteractionAt: Date | null;
    lastSaleAt: Date | null;
    pipelineStage: PipelineStage;
    seller: { followUpAfterDays: number };
  }>
) {
  if (customers.length === 0) return { staleCount: 0 };

  const schedules = customers.map((customer) => ({
    customer,
    schedule: getAutomaticFollowUpSchedule(
      {
        customerId: customer.id,
        createdAt: customer.createdAt,
        lastInteractionAt: customer.lastInteractionAt,
        lastSaleAt: customer.lastSaleAt,
      },
      customer.seller.followUpAfterDays
    ),
  }));
  const keys = schedules.map(({ schedule }) => schedule.dedupeKey);
  const existing = await prisma.followUp.findMany({
    where: {
      customerId: { in: customers.map((customer) => customer.id) },
      OR: [
        // Só os automáticos ainda ativos (os concluídos do ciclo atual chegam
        // pelo dedupeKey) — evita reler todo o histórico a cada sincronização.
        { source: { in: [...AUTOMATIC_SOURCES] }, status: { in: ["PENDENTE", "ADIADO"] } },
        { dedupeKey: { in: keys } },
        { source: "MANUAL", status: { in: ["PENDENTE", "ADIADO"] } },
      ],
    },
    select: { id: true, customerId: true, sellerId: true, status: true, source: true, dedupeKey: true },
  });

  const byCustomer = new Map<string, typeof existing>();
  for (const followUp of existing) {
    const list = byCustomer.get(followUp.customerId);
    if (list) list.push(followUp);
    else byCustomer.set(followUp.customerId, [followUp]);
  }

  const operations: Prisma.PrismaPromise<unknown>[] = [];
  for (const { customer, schedule } of schedules) {
    const customerFollowUps = byCustomer.get(customer.id) ?? [];
    const manualActive = customerFollowUps.some(
      (followUp) =>
        followUp.source === "MANUAL" && (followUp.status === "PENDENTE" || followUp.status === "ADIADO")
    );
    const customerAutomatic = customerFollowUps.filter((followUp) => followUp.source !== "MANUAL");

    // Reciclagem/Inativo: fora das filas ativas — nenhum aviso automático é
    // criado e os pendentes são encerrados (o histórico é preservado).
    if (PAUSED_PIPELINE_STAGES.includes(customer.pipelineStage)) {
      const activeIds = customerFollowUps
        .filter((followUp) => followUp.status === "PENDENTE" || followUp.status === "ADIADO")
        .map((followUp) => followUp.id);
      if (activeIds.length > 0) {
        operations.push(
          prisma.followUp.updateMany({
            where: { id: { in: activeIds } },
            data: { status: "CONCLUIDO", completedAt: new Date() },
          })
        );
      }
      continue;
    }
    const sameCycle = customerAutomatic.find((followUp) => followUp.dedupeKey === schedule.dedupeKey);
    const activeOtherIds = customerAutomatic
      .filter(
        (followUp) =>
          followUp.dedupeKey !== schedule.dedupeKey &&
          (followUp.status === "PENDENTE" || followUp.status === "ADIADO")
      )
      .map((followUp) => followUp.id);

    if (manualActive) {
      const activeAutomaticIds = customerAutomatic
        .filter((followUp) => followUp.status === "PENDENTE" || followUp.status === "ADIADO")
        .map((followUp) => followUp.id);
      if (activeAutomaticIds.length > 0) {
        operations.push(
          prisma.followUp.updateMany({
            where: { id: { in: activeAutomaticIds } },
            data: { status: "CONCLUIDO", completedAt: new Date() },
          })
        );
      }
      continue;
    }

    if (activeOtherIds.length > 0) {
      operations.push(
        prisma.followUp.updateMany({
          where: { id: { in: activeOtherIds } },
          data: { status: "CONCLUIDO", completedAt: new Date() },
        })
      );
    }

    if (
      sameCycle &&
      sameCycle.sellerId !== customer.sellerId &&
      (sameCycle.status === "PENDENTE" || sameCycle.status === "ADIADO")
    ) {
      operations.push(
        prisma.followUp.update({ where: { id: sameCycle.id }, data: { sellerId: customer.sellerId } })
      );
    }

    // Um cliente recém-cadastrado, sem qualquer contato/venda, não ganha
    // follow-up automaticamente. A partir da primeira interação (incluindo
    // proposta), o próximo acompanhamento já aparece imediatamente na área
    // de follow-ups, mesmo que a data ainda esteja no futuro.
    if (shouldMaterializeAutomaticFollowUp(customer, schedule.isDue) && !sameCycle) {
      operations.push(
        prisma.followUp.upsert({
          where: { dedupeKey: schedule.dedupeKey },
          update: {},
          create: {
            customerId: customer.id,
            sellerId: customer.sellerId,
            dueAt: schedule.dueAt,
            source: "AUTOMATICO_INATIVIDADE",
            dedupeKey: schedule.dedupeKey,
            note: `Sem interação ou venda há ${schedule.days} dias.`,
          },
        })
      );
    } else if (!schedule.isDue && sameCycle && (sameCycle.status === "PENDENTE" || sameCycle.status === "ADIADO")) {
      operations.push(
        prisma.followUp.update({
          where: { id: sameCycle.id },
          data: { status: "CONCLUIDO", completedAt: new Date() },
        })
      );
    }
  }

  if (operations.length > 0) await prisma.$transaction(operations);
  return {
    staleCount: schedules.filter(
      ({ customer, schedule }) => schedule.isDue && !PAUSED_PIPELINE_STAGES.includes(customer.pipelineStage)
    ).length,
  };
}
