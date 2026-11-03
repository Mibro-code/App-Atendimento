import "server-only";
import { Prisma, type CommercialBrand, type CommercialFunction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/authz";
import { callOlistBridge } from "@/lib/olist/bridge-client";
import { assertEnabled, bridgeFailure } from "@/lib/proposals/proposal-core";
import { ProposalError } from "@/lib/proposals/proposal-rules";

// Configurações administrativas do módulo (permissions.manage = somente ADMIN).

export interface OlistSeller {
  id: string;
  name: string;
  code: string | null;
  situation: string | null;
  email: string | null;
}

function requireAdminActor(user: SessionUser) {
  assertEnabled();
  if (user.role !== "ADMIN") throw new ProposalError("Somente o administrador gerencia as configurações de propostas.", "ACTION_NOT_ALLOWED", 403);
}

/** Vendedores cadastrados no Olist da marca (GET /vendedores, via ponte). */
export async function listOlistSellers(user: SessionUser, brand: CommercialBrand): Promise<OlistSeller[]> {
  requireAdminActor(user);
  try {
    const res = await callOlistBridge<{ sellers: OlistSeller[] }>(brand, "/internal/crm/sellers/list", { brand: brand.toLowerCase() });
    return res.sellers;
  } catch (error) {
    const f = bridgeFailure(error);
    throw new ProposalError(`Não foi possível consultar os vendedores do Olist: ${f.message}`, f.code, 502);
  }
}

/**
 * Vincula um usuário do CRM a um vendedor do Olist. O id é conferido na
 * lista oficial do Olist no momento do vínculo (nunca digitado livremente).
 */
export async function setSellerLink(user: SessionUser, input: { userId: string; brand: CommercialBrand; olistSellerId: string }) {
  requireAdminActor(user);
  const crmUser = await prisma.user.findFirst({ where: { id: input.userId, deletedAt: null, role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR", "ADMIN"] } }, select: { id: true, name: true } });
  if (!crmUser) throw new ProposalError("Usuário do CRM não encontrado.", "USER_NOT_FOUND", 404);
  const sellers = await listOlistSellers(user, input.brand);
  const seller = sellers.find((s) => s.id === input.olistSellerId);
  if (!seller) throw new ProposalError("Vendedor não encontrado no Olist desta empresa.", "OLIST_SELLER_NOT_FOUND", 422);
  if (seller.situation && !["A", "B"].includes(seller.situation)) {
    throw new ProposalError("O vendedor está inativo ou excluído no Olist.", "OLIST_SELLER_INACTIVE", 422);
  }
  try {
    const link = await prisma.sellerOlistLink.upsert({
      where: { userId_brand: { userId: crmUser.id, brand: input.brand } },
      create: {
        userId: crmUser.id, brand: input.brand, olistSellerId: seller.id, olistSellerName: seller.name, olistSellerCode: seller.code,
        olistSituation: seller.situation, active: true, lastSyncedAt: new Date(), updatedById: user.id,
      },
      update: { olistSellerId: seller.id, olistSellerName: seller.name, olistSellerCode: seller.code, olistSituation: seller.situation, active: true, lastSyncedAt: new Date(), updatedById: user.id },
    });
    await logAudit({ actorId: user.id, action: "SELLER_OLIST_LINK_UPDATED", entityType: "User", entityId: crmUser.id, metadata: { brand: input.brand, olistSellerId: seller.id, olistSellerName: seller.name } });
    return link;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ProposalError("Este vendedor do Olist já está vinculado a outro usuário do CRM.", "OLIST_SELLER_TAKEN", 409);
    }
    throw error;
  }
}

export async function deactivateSellerLink(user: SessionUser, input: { userId: string; brand: CommercialBrand }) {
  requireAdminActor(user);
  const result = await prisma.sellerOlistLink.updateMany({ where: { userId: input.userId, brand: input.brand }, data: { active: false, updatedById: user.id } });
  if (result.count === 0) throw new ProposalError("Vínculo não encontrado.", "NOT_FOUND", 404);
  await logAudit({ actorId: user.id, action: "SELLER_OLIST_LINK_UPDATED", entityType: "User", entityId: input.userId, metadata: { brand: input.brand, active: false } });
}

const SCOPE_RE = /^(ROLE:(VENDEDOR|REPRESENTANTE|SUPERVISOR)|FUNCTION:GERENTE_COMERCIAL|USER:[a-z0-9]{20,40})$/i;

export async function setDiscountLimit(user: SessionUser, input: { scopeKey: string; brandKey: string; maxDiscountBps: number | null }) {
  requireAdminActor(user);
  if (!SCOPE_RE.test(input.scopeKey)) throw new ProposalError("Escopo de alçada inválido.", "INVALID_SCOPE", 422);
  if (!["*", "MIBRO", "SINCROFIT"].includes(input.brandKey)) throw new ProposalError("Empresa inválida.", "INVALID_BRAND", 422);
  if (input.maxDiscountBps === null) {
    await prisma.proposalDiscountLimit.updateMany({ where: { scopeKey: input.scopeKey, brandKey: input.brandKey }, data: { active: false, updatedById: user.id } });
  } else {
    if (!Number.isInteger(input.maxDiscountBps) || input.maxDiscountBps < 0 || input.maxDiscountBps > 10_000) {
      throw new ProposalError("Informe um percentual entre 0 e 100.", "INVALID_LIMIT", 422, { fieldErrors: { maxDiscount: "Entre 0 e 100." } });
    }
    await prisma.proposalDiscountLimit.upsert({
      where: { scopeKey_brandKey: { scopeKey: input.scopeKey, brandKey: input.brandKey } },
      create: { scopeKey: input.scopeKey, brandKey: input.brandKey, maxDiscountBps: input.maxDiscountBps, updatedById: user.id },
      update: { maxDiscountBps: input.maxDiscountBps, active: true, updatedById: user.id },
    });
  }
  await logAudit({ actorId: user.id, action: "PROPOSAL_SETTINGS_UPDATED", entityType: "ProposalDiscountLimit", entityId: `${input.scopeKey}@${input.brandKey}`, metadata: { maxDiscountBps: input.maxDiscountBps } });
}

export async function setCommercialFunctions(user: SessionUser, input: { userId: string; functions: CommercialFunction[] }) {
  requireAdminActor(user);
  const target = await prisma.user.findFirst({ where: { id: input.userId, deletedAt: null }, select: { id: true, commercialFunctions: true } });
  if (!target) throw new ProposalError("Usuário não encontrado.", "USER_NOT_FOUND", 404);
  const functions = [...new Set(input.functions)];
  await prisma.user.update({ where: { id: target.id }, data: { commercialFunctions: functions } });
  await logAudit({ actorId: user.id, action: "USER_PERMISSIONS_UPDATED", entityType: "User", entityId: target.id, metadata: { commercialFunctions: { from: target.commercialFunctions, to: functions } } });
}
