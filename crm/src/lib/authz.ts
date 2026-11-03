import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { Prisma, Role } from "@prisma/client";
import { canExportSellerByTeamPolicy, canTransferByTeamPolicy } from "@/lib/team-rules";
export { canExportCustomers } from "@/lib/team-rules";

export interface SessionUser {
  id: string;
  role: Role;
}

/**
 * Função central de escopo de dados por RBAC. TODA query de listagem/detalhe
 * de Customer (e dados relacionados, via customer.sellerId) deve usar o
 * filtro retornado aqui em vez de replicar a lógica de permissão em cada
 * rota.
 *
 * - ADMIN: enxerga tudo (filtro vazio).
 * - SUPERVISOR: enxerga os próprios clientes + os da equipe (User.team,
 *   isto é, vendedores cujo supervisorId aponta para ele).
 * - VENDEDOR: enxerga só os próprios clientes (sellerId === user.id).
 */
export async function getCustomerScopeFilter(
  user: SessionUser
): Promise<Prisma.CustomerWhereInput> {
  if (user.role === "ADMIN") {
    return {};
  }

  if (user.role === "SUPERVISOR") {
    return { sellerId: { in: await supervisorVisibleIds(user.id) } };
  }

  // VENDEDOR
  return { sellerId: user.id };
}

// Memoizado por request (React cache): a mesma renderização chama o escopo
// várias vezes (página, filtros, listagem) e a equipe não muda no meio dela.
const supervisorVisibleIds = cache(async (supervisorId: string): Promise<string[]> => {
  const team = await prisma.user.findMany({
    where: { supervisorId },
    select: { id: true },
  });
  return [supervisorId, ...team.map((t) => t.id)];
});

/** Ids de vendedores visíveis para o usuário (usado para checar acesso pontual). */
export async function getVisibleSellerIds(user: SessionUser): Promise<string[] | null> {
  if (user.role === "ADMIN") return null; // null = sem restrição
  if (user.role === "SUPERVISOR") return supervisorVisibleIds(user.id);
  return [user.id];
}

/** Verifica se o usuário pode acessar um cliente específico (já carregado). */
export async function canAccessCustomer(
  user: SessionUser,
  customerSellerId: string
): Promise<boolean> {
  const visible = await getVisibleSellerIds(user);
  if (visible === null) return true;
  return visible.includes(customerSellerId);
}

/**
 * Atribuicao e transferencia seguem o mesmo limite de visibilidade:
 * admin pode escolher qualquer responsavel; supervisor apenas a si mesmo ou
 * um vendedor diretamente subordinado; vendedor apenas a si mesmo.
 */
export async function canAssignCustomerToSeller(
  user: SessionUser,
  targetSellerId: string
): Promise<boolean> {
  return canAccessCustomer(user, targetSellerId);
}

/** Validação autoritativa do repasse; nunca confia apenas no sellerId da UI. */
export async function canTransferCustomerToSeller(
  user: SessionUser,
  sourceSellerId: string,
  targetSellerId: string
): Promise<boolean> {
  const [actorRecord, source, target] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, role: true, supervisorId: true, canTransferOwnCustomers: true },
    }),
    prisma.user.findUnique({
      where: { id: sourceSellerId },
      select: { id: true, supervisorId: true },
    }),
    prisma.user.findUnique({
      where: { id: targetSellerId },
      select: { id: true, role: true, supervisorId: true, active: true },
    }),
  ]);
  if (!actorRecord || !source || !target) return false;

  const supervisor = actorRecord.supervisorId
    ? await prisma.user.findUnique({
        where: { id: actorRecord.supervisorId },
        select: { allowSellerCustomerTransfer: true },
      })
    : null;

  return canTransferByTeamPolicy({
    actor: actorRecord,
    source,
    target,
    sellerTransfersEnabled: supervisor?.allowSellerCustomerTransfer ?? false,
    sellerTransferIndividuallyEnabled: actorRecord.canTransferOwnCustomers,
  });
}

// Dados exibidos no seletor de responsável (busca por nome, RCA, tipo e região).
const TRANSFER_TARGET_SELECT = {
  id: true,
  name: true,
  rca: true,
  role: true,
  supervisorId: true,
  active: true,
  sellerProfile: { select: { displayName: true, representativeType: true } },
  representativeRegions: { select: { state: true, city: true } },
} satisfies Prisma.UserSelect;

export interface TransferTargetOption {
  id: string;
  name: string;
  rca: string | null;
  role: Role;
  representativeType: string | null;
  regions: Array<{ state: string; city: string }>;
}

function toTargetOption(user: Prisma.UserGetPayload<{ select: typeof TRANSFER_TARGET_SELECT }>): TransferTargetOption {
  return {
    id: user.id,
    name: user.sellerProfile?.displayName || user.name,
    rca: user.rca,
    role: user.role,
    representativeType: user.sellerProfile?.representativeType ?? null,
    regions: user.representativeRegions,
  };
}

export async function getCustomerTransferTargets(
  user: SessionUser,
  sourceSellerId: string
): Promise<TransferTargetOption[]> {
  // Carrega ator, origem e política uma única vez e avalia cada candidato em
  // memória com a mesma regra pura do backend (antes: ~4 queries por candidato).
  const [actorRecord, source] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, role: true, supervisorId: true, canTransferOwnCustomers: true },
    }),
    prisma.user.findUnique({ where: { id: sourceSellerId }, select: { id: true, supervisorId: true } }),
  ]);
  if (!actorRecord || !source) return [];
  const supervisor = actorRecord.supervisorId
    ? await prisma.user.findUnique({ where: { id: actorRecord.supervisorId }, select: { allowSellerCustomerTransfer: true } })
    : null;

  const candidates = await prisma.user.findMany({
    where:
      user.role === "ADMIN"
        ? { active: true, role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] }, id: { not: sourceSellerId } }
        : user.role === "SUPERVISOR"
          ? {
              active: true,
              role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] },
              id: { not: sourceSellerId },
              OR: [{ id: user.id }, { supervisorId: user.id }],
            }
          : {
              active: true,
              role: { in: ["VENDEDOR", "REPRESENTANTE"] },
              id: { not: sourceSellerId },
              supervisorId: actorRecord.supervisorId ?? "__sem_equipe__",
            },
    select: TRANSFER_TARGET_SELECT,
    orderBy: { name: "asc" },
  });

  return candidates
    .filter((candidate) => canTransferByTeamPolicy({
      actor: actorRecord,
      source,
      target: candidate,
      sellerTransfersEnabled: supervisor?.allowSellerCustomerTransfer ?? false,
      sellerTransferIndividuallyEnabled: actorRecord.canTransferOwnCustomers,
    }))
    .map(toTargetOption);
}

/** Destinos exibidos no repasse em massa. A autorização de cada cliente
 * continua sendo refeita no backend no momento da transferência. */
export async function getBulkCustomerTransferTargets(
  user: SessionUser
): Promise<TransferTargetOption[]> {
  const actor = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, role: true, supervisorId: true, canTransferOwnCustomers: true },
  });
  if (!actor) return [];

  if (actor.role === "ADMIN") {
    return (await prisma.user.findMany({
      where: { active: true, role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] } },
      select: TRANSFER_TARGET_SELECT,
      orderBy: { name: "asc" },
    })).map(toTargetOption);
  }
  if (actor.role === "SUPERVISOR") {
    return (await prisma.user.findMany({
      where: {
        active: true,
        role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] },
        OR: [{ id: actor.id }, { supervisorId: actor.id }],
      },
      select: TRANSFER_TARGET_SELECT,
      orderBy: { name: "asc" },
    })).map(toTargetOption);
  }
  if (!actor.supervisorId || !actor.canTransferOwnCustomers) return [];
  const supervisor = await prisma.user.findUnique({
    where: { id: actor.supervisorId },
    select: { allowSellerCustomerTransfer: true },
  });
  if (!supervisor?.allowSellerCustomerTransfer) return [];
  return (await prisma.user.findMany({
    where: {
      active: true,
      id: { not: actor.id },
      supervisorId: actor.supervisorId,
      role: { in: ["VENDEDOR", "REPRESENTANTE"] },
    },
    select: TRANSFER_TARGET_SELECT,
    orderBy: { name: "asc" },
  })).map(toTargetOption);
}

export async function canExportSeller(user: SessionUser, targetSellerId: string): Promise<boolean> {
  const [actor, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { id: true, role: true, supervisorId: true } }),
    prisma.user.findUnique({ where: { id: targetSellerId }, select: { id: true, supervisorId: true } }),
  ]);
  return !!actor && !!target && canExportSellerByTeamPolicy(actor, target);
}

/**
 * Mesmo padrão de escopo de getCustomerScopeFilter, aplicado ao ponto
 * (TimeClockEntry.userId em vez de Customer.sellerId). ADMIN vê tudo,
 * SUPERVISOR só a própria equipe (User.team), VENDEDOR só a si mesmo. Um
 * filtro adicional vindo do cliente (ex.: ?userId=) deve ser sempre
 * "AND"-ado com este, nunca usado no lugar dele.
 */
export async function getTimeClockScopeFilter(
  user: SessionUser
): Promise<Prisma.TimeClockEntryWhereInput> {
  const visibleIds = await getVisibleSellerIds(user);
  if (visibleIds === null) return {};
  return { userId: { in: visibleIds } };
}

/** Mesmo escopo acima, mas para Occurrence.userId. */
export async function getOccurrenceScopeFilter(
  user: SessionUser
): Promise<Prisma.OccurrenceWhereInput> {
  const visibleIds = await getVisibleSellerIds(user);
  if (visibleIds === null) return {};
  return { userId: { in: visibleIds } };
}

/**
 * Metas seguem o mesmo escopo de visibilidade de vendedores usado no resto
 * do RBAC (getVisibleSellerIds): ADMIN gerencia qualquer um, SUPERVISOR só a
 * própria equipe (nunca vendedor de outra equipe), VENDEDOR nunca
 * cria/edita meta — nem a própria.
 */
export async function canManageGoalForSeller(
  user: SessionUser,
  targetSellerId: string
): Promise<boolean> {
  if (user.role === "VENDEDOR" || user.role === "REPRESENTANTE") return false;
  const visible = await getVisibleSellerIds(user);
  if (visible === null) return true;
  return visible.includes(targetSellerId);
}

export function isAdmin(user: SessionUser): boolean {
  return user.role === "ADMIN";
}

export function requireAdmin(user: SessionUser | null | undefined): user is SessionUser {
  return !!user && user.role === "ADMIN";
}
