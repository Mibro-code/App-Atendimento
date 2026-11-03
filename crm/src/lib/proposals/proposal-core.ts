import "server-only";
import type { OlistSyncAction, Prisma, ProposalCommercialStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import { OlistBridgeError } from "@/lib/olist/bridge-client";
import { proposalsEnabled, proposalConversionMode } from "@/lib/proposals/proposal-config";
import {
  loadDiscountLimits,
  loadProposalActor,
  PROPOSAL_INCLUDE,
  proposalFacts,
  type LoadedProposal,
} from "@/lib/proposals/proposal-access";
import { canView, decide, decideAll, type ProposalAction } from "@/lib/proposals/proposal-permissions";
import { assertTransition, ProposalError } from "@/lib/proposals/proposal-rules";

type Db = Prisma.TransactionClient | typeof prisma;

export function assertEnabled() {
  if (!proposalsEnabled()) throw new ProposalError("Módulo de propostas comerciais desativado.", "FEATURE_DISABLED", 404);
}

export async function loadProposal(id: string, db: Db = prisma): Promise<LoadedProposal> {
  if (!/^[a-z0-9]{20,40}$/i.test(id)) throw new ProposalError("Proposta não encontrada.", "NOT_FOUND", 404);
  const p = await db.commercialProposal.findUnique({ where: { id }, include: PROPOSAL_INCLUDE });
  if (!p) throw new ProposalError("Proposta não encontrada.", "NOT_FOUND", 404);
  return p;
}

/**
 * Ponto único de autorização: carrega ator, proposta e fatos do banco e
 * decide. Sem visibilidade responde 404 (não revela a existência).
 */
export async function authorize(user: SessionUser, id: string, action: ProposalAction) {
  assertEnabled();
  const [actor, p] = await Promise.all([loadProposalActor(user), loadProposal(id)]);
  if (!canView(actor, p)) throw new ProposalError("Proposta não encontrada.", "NOT_FOUND", 404);
  const facts = await proposalFacts(p);
  const limits = await loadDiscountLimits(p.brand, p.sellerId, p.seller.role);
  const options = { now: new Date(), limits, conversionMode: proposalConversionMode() };
  const decision = decide(action, actor, facts, options);
  if (!decision.allowed) throw new ProposalError(decision.reason ?? "Ação não permitida.", "ACTION_NOT_ALLOWED", 403);
  return { actor, p, facts, limits, options };
}

/** Dados completos para a tela (decisões para todos os botões). */
export async function proposalView(user: SessionUser, id: string) {
  assertEnabled();
  const [actor, p] = await Promise.all([loadProposalActor(user), loadProposal(id)]);
  if (!canView(actor, p)) return null;
  const facts = await proposalFacts(p);
  const limits = await loadDiscountLimits(p.brand, p.sellerId, p.seller.role);
  const options = { now: new Date(), limits, conversionMode: proposalConversionMode() };
  return { actor, p, facts, limits, decisions: decideAll(actor, facts, options), options };
}

export async function addEvent(
  db: Db,
  proposalId: string,
  type: string,
  input: { actorId?: string | null; version?: number | null; origin?: "CRM" | "OLIST" | "SISTEMA"; data?: Prisma.InputJsonValue } = {}
) {
  await db.proposalEvent.create({
    data: { proposalId, type, actorId: input.actorId ?? null, version: input.version ?? null, origin: input.origin ?? "CRM", data: input.data },
  });
}

/**
 * Transição com concorrência otimista: só grava se o estado e a versão
 * ainda forem os lidos (duplo clique / duas abas não aplicam duas vezes).
 */
export async function transition(
  db: Db,
  p: { id: string; version: number; commercialStatus: ProposalCommercialStatus },
  to: ProposalCommercialStatus,
  data: Prisma.CommercialProposalUpdateManyMutationInput = {}
) {
  assertTransition(p.commercialStatus, to);
  const result = await db.commercialProposal.updateMany({
    where: { id: p.id, version: p.version, commercialStatus: p.commercialStatus },
    data: { ...data, commercialStatus: to },
  });
  if (result.count !== 1) {
    throw new ProposalError("A proposta foi alterada por outra pessoa. Recarregue a página.", "CONFLICT", 409);
  }
}

// ----------------------------------------------------------- trava Olist

const LOCK_MS = 3 * 60 * 1000;

export async function withProposalLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const now = new Date();
  const locked = await prisma.commercialProposal.updateMany({
    where: { id, OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - LOCK_MS) } }] },
    data: { lockedAt: now },
  });
  if (locked.count !== 1) {
    throw new ProposalError("Esta proposta já está sendo processada com o Olist. Aguarde alguns segundos.", "OLIST_SYNC_IN_PROGRESS", 409);
  }
  try {
    return await fn();
  } finally {
    // A operação antiga não pode soltar uma trava adquirida por outra após o TTL.
    await prisma.commercialProposal.updateMany({ where: { id, lockedAt: now }, data: { lockedAt: null } }).catch(() => undefined);
  }
}

// ----------------------------------------------------------- tentativas

export async function startAttempt(p: { quoteId: string; brand: "MIBRO" | "SINCROFIT" }, action: OlistSyncAction, actorId: string | null, requestHash?: string) {
  return prisma.olistSyncAttempt.create({ data: { quoteId: p.quoteId, brand: p.brand, action, actorId, requestHash }, select: { id: true } });
}

export async function finishAttempt(id: string, data: Prisma.OlistSyncAttemptUpdateInput) {
  await prisma.olistSyncAttempt.update({ where: { id }, data: { finishedAt: new Date(), ...data } });
}

export function bridgeFailure(error: unknown): { code: string; message: string; status: number | undefined } {
  if (error instanceof OlistBridgeError) return { code: error.code, message: error.message, status: error.status };
  if (error instanceof ProposalError) return { code: error.code, message: error.message, status: error.status };
  return { code: "INTERNAL_ERROR", message: "Falha inesperada na integração com o Olist.", status: undefined };
}

export async function failAttempt(id: string, error: unknown) {
  const f = bridgeFailure(error);
  const details = error instanceof OlistBridgeError ? error.details : undefined;
  await finishAttempt(id, {
    status: "FAILED",
    errorCode: f.code.slice(0, 80),
    errorMessage: f.message.slice(0, 500),
    // bridgeStatus distingue recusa definitiva (4xx) de falha ambígua (rede/5xx).
    response: JSON.parse(JSON.stringify({ bridgeStatus: f.status ?? 0, ...(details ? { details } : {}) })),
  });
  return f;
}

export const protocol = (attemptId: string) => attemptId.slice(-8).toUpperCase();
