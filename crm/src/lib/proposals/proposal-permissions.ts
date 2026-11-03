// Política de acesso das propostas comerciais (pura). O backend chama
// `decide` antes de qualquer gravação ou chamada ao Olist; a interface usa o
// mesmo resultado só para mostrar botões e explicar indisponibilidades.
//
// Cargos reaproveitados: ADMIN, SUPERVISOR, VENDEDOR, REPRESENTANTE.
// Funções extras (User.commercialFunctions): GERENTE_COMERCIAL, FINANCEIRO.

import type {
  CommercialFunction,
  ProposalAcceptanceStatus,
  ProposalApprovalStatus,
  ProposalCommercialStatus,
  ProposalOrderStatus,
  ProposalSyncStatus,
  Role,
} from "@prisma/client";
import {
  effectiveCommercialStatus,
  formatBps,
  LEVEL_LABELS,
  requiredApproverLevel,
  type DiscountLimits,
} from "./proposal-rules";

export interface ProposalActor {
  id: string;
  role: Role;
  functions: readonly CommercialFunction[];
  /** Para SUPERVISOR: ids dos vendedores da equipe (inclui o próprio). */
  teamSellerIds: readonly string[];
}

export interface ProposalFacts {
  sellerId: string;
  commercialStatus: ProposalCommercialStatus;
  approvalStatus: ProposalApprovalStatus;
  acceptanceStatus: ProposalAcceptanceStatus;
  syncStatus: ProposalSyncStatus;
  orderStatus: ProposalOrderStatus;
  version: number;
  syncedVersion: number | null;
  approvedVersion: number | null;
  approvedHash: string | null;
  materialHash: string;
  acceptedVersion: number | null;
  validUntil: Date | null;
  olistProposalId: string | null;
  /** Usuário que registrou a versão atual. */
  lastEditorId: string;
  discountBps: number;
  dispatchedCurrentVersion: boolean;
  sellerLinked: boolean;
  /** Situação no Olist indica proposta concluída sem pedido vinculado no CRM. */
  olistConcluded: boolean;
}

export const PROPOSAL_ACTIONS = [
  "view",
  "view_history",
  "view_financial_values",
  "edit",
  "sync",
  "submit",
  "approve",
  "reject",
  "request_changes",
  "send_email",
  "register_dispatch",
  "register_acceptance",
  "register_refusal",
  "register_change_request",
  "reopen",
  "request_conversion",
  "deny_conversion",
  "convert",
  "reconcile_order",
  "refresh_order",
  "approve_order",
  "prepare_order_update",
  "resolve_conflict",
  "transfer",
  "cancel",
  "duplicate",
  "finance_review",
] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

export interface Decision {
  allowed: boolean;
  reason?: string;
}

export interface DecideOptions {
  now: Date;
  limits: DiscountLimits;
  conversionMode: "api" | "manual";
}

const OK: Decision = { allowed: true };
const no = (reason: string): Decision => ({ allowed: false, reason });

/** Situações que o financeiro acompanha (aprovadas em diante). */
const FINANCE_VISIBLE: readonly ProposalCommercialStatus[] = [
  "APROVADA_INTERNAMENTE",
  "ENVIADA",
  "EM_NEGOCIACAO",
  "ACEITA",
  "CONVERSAO_SOLICITADA",
  "CONVERTIDA",
];

export const isManager = (a: ProposalActor) => a.functions.includes("GERENTE_COMERCIAL");
export const isFinance = (a: ProposalActor) => a.functions.includes("FINANCEIRO");
const isAdmin = (a: ProposalActor) => a.role === "ADMIN";
const isSupervisorOf = (a: ProposalActor, sellerId: string) => a.role === "SUPERVISOR" && a.teamSellerIds.includes(sellerId);

/** Visão de lista: ALL (admin/gerente), TEAM (supervisor), OWN (vendedor) e FINANCE em acréscimo. */
export function proposalScope(a: ProposalActor): { all: boolean; sellerIds: string[]; financeStatuses: ProposalCommercialStatus[] | null } {
  if (isAdmin(a) || isManager(a)) return { all: true, sellerIds: [], financeStatuses: null };
  const sellerIds = a.role === "SUPERVISOR" ? [...a.teamSellerIds] : [a.id];
  return { all: false, sellerIds, financeStatuses: isFinance(a) ? [...FINANCE_VISIBLE] : null };
}

export function canView(a: ProposalActor, f: Pick<ProposalFacts, "sellerId" | "commercialStatus">): boolean {
  if (isAdmin(a) || isManager(a) || f.sellerId === a.id || isSupervisorOf(a, f.sellerId)) return true;
  return isFinance(a) && FINANCE_VISIBLE.includes(f.commercialStatus);
}

/** Pode agir comercialmente (dono, supervisor da equipe, gerente, admin). Financeiro não. */
function commercial(a: ProposalActor, f: ProposalFacts): boolean {
  return isAdmin(a) || isManager(a) || f.sellerId === a.id || isSupervisorOf(a, f.sellerId);
}

/** Pode autorizar (aprovar, converter, transferir) — nunca o próprio vendedor. */
function authorizer(a: ProposalActor, f: ProposalFacts): boolean {
  return isAdmin(a) || isManager(a) || (isSupervisorOf(a, f.sellerId) && f.sellerId !== a.id);
}

const approvalCurrent = (f: ProposalFacts) =>
  f.approvalStatus === "APROVADA" && f.approvedVersion === f.version && f.approvedHash === f.materialHash;

const syncedCurrent = (f: ProposalFacts) => f.syncStatus === "SINCRONIZADA" && !!f.olistProposalId && f.syncedVersion === f.version;

function approvalProblem(f: ProposalFacts): string | null {
  if (approvalCurrent(f)) return null;
  if (f.approvalStatus === "INVALIDADA" || (f.approvedVersion !== null && f.approvedVersion !== f.version)) {
    return "A proposta foi alterada e precisa de nova aprovação.";
  }
  if (f.approvalStatus === "REPROVADA") return "A proposta foi reprovada internamente.";
  return "Esta proposta precisa de aprovação antes do envio.";
}

function syncProblem(f: ProposalFacts): string | null {
  if (f.syncStatus === "CONFLITO") return "A proposta foi alterada no Olist. Resolva o conflito antes de continuar.";
  if (f.syncStatus === "SINCRONIZANDO") return "Sincronização com o Olist em andamento. Aguarde.";
  if (!syncedCurrent(f)) return "A versão atual ainda não está registrada no Olist. Sincronize antes de continuar.";
  return null;
}

/** Decide todas as ações para o ator. */
export function decideAll(a: ProposalActor, f: ProposalFacts, o: DecideOptions): Record<ProposalAction, Decision> {
  const out = {} as Record<ProposalAction, Decision>;
  for (const action of PROPOSAL_ACTIONS) out[action] = decide(action, a, f, o);
  return out;
}

export function decide(action: ProposalAction, a: ProposalActor, f: ProposalFacts, o: DecideOptions): Decision {
  if (!canView(a, f)) return no("Você não tem acesso a esta proposta.");
  const status = effectiveCommercialStatus(f, o.now);
  const expired = status === "EXPIRADA";
  const isCommercial = commercial(a, f);
  const notCommercial = no(isFinance(a) ? "O Financeiro não altera condições comerciais." : "Você não pode alterar esta proposta.");
  const hasOrder = f.orderStatus !== "SEM_PEDIDO";

  switch (action) {
    case "view":
    case "view_history":
      return OK;

    case "view_financial_values":
      return isAdmin(a) || isFinance(a) || isManager(a) || a.role === "SUPERVISOR"
        ? OK
        : no("Valores recebidos são visíveis ao Financeiro, supervisão e gerência.");

    case "edit": {
      if (!isCommercial) return notCommercial;
      if (hasOrder) return no("A proposta já tem pedido vinculado e não pode ser alterada.");
      if (status === "ACEITA" || status === "CONVERSAO_SOLICITADA") {
        return no("O cliente aceitou esta versão. Reabra a negociação antes de alterar.");
      }
      if (!["RASCUNHO", "AGUARDANDO_APROVACAO", "REPROVADA_INTERNAMENTE", "APROVADA_INTERNAMENTE", "ENVIADA", "EM_NEGOCIACAO", "EXPIRADA"].includes(status)) {
        return no("Esta proposta está encerrada.");
      }
      if (f.syncStatus === "CONFLITO") return no("A proposta foi alterada no Olist. Resolva o conflito antes de editar.");
      if (f.syncStatus === "SINCRONIZANDO") return no("Sincronização com o Olist em andamento. Aguarde.");
      return OK;
    }

    case "sync":
      if (!isCommercial) return notCommercial;
      if (["CANCELADA", "RECUSADA"].includes(status)) return no("Esta proposta está encerrada.");
      // Depois do pedido a proposta no Olist não é mais alterada pelo CRM.
      if (hasOrder || status === "CONVERTIDA") return no("A conversão já foi realizada; a proposta não é mais enviada ao Olist.");
      if (f.syncStatus === "SINCRONIZANDO") return no("Sincronização com o Olist em andamento. Aguarde.");
      if (!f.sellerLinked) return no("O vendedor responsável não tem vínculo válido com o Olist desta empresa.");
      return OK;

    case "submit": {
      if (!isCommercial) return notCommercial;
      if (status !== "RASCUNHO" && status !== "REPROVADA_INTERNAMENTE") {
        return no(expired ? "A proposta expirou. Atualize a validade antes de reenviar." : "Somente rascunhos ou propostas reprovadas podem ir para aprovação.");
      }
      if (!f.sellerLinked) return no("O vendedor responsável não tem vínculo válido com o Olist desta empresa.");
      return syncProblem(f) ? no(syncProblem(f)!) : OK;
    }

    case "approve":
    case "reject":
    case "request_changes": {
      if (status !== "AGUARDANDO_APROVACAO") {
        return no(expired ? "A proposta expirou." : "A proposta não está aguardando aprovação.");
      }
      if (f.sellerId === a.id || f.lastEditorId === a.id) return no("Você não pode aprovar sua própria proposta.");
      if (!authorizer(a, f)) return no("Somente o supervisor da equipe, o gerente comercial ou o administrador pode aprovar esta proposta.");
      if (action === "approve") {
        const level = requiredApproverLevel(f.discountBps, o.limits);
        if (level === "ADMIN" && !isAdmin(a)) {
          return no(`Desconto de ${formatBps(f.discountBps)} acima da alçada do gerente comercial. Necessária aprovação do administrador.`);
        }
        if (level === "GERENTE_COMERCIAL" && !isAdmin(a) && !isManager(a)) {
          return no(`Desconto de ${formatBps(f.discountBps)} acima da alçada do supervisor. Necessária aprovação do ${LEVEL_LABELS[level]}.`);
        }
        const sp = syncProblem(f);
        if (sp) return no(sp);
      }
      return OK;
    }

    case "send_email":
    case "register_dispatch": {
      if (!isCommercial) return notCommercial;
      if (!["APROVADA_INTERNAMENTE", "ENVIADA", "EM_NEGOCIACAO"].includes(status)) {
        return no(
          expired
            ? "A proposta expirou e não pode ser enviada."
            : status === "AGUARDANDO_APROVACAO" || status === "RASCUNHO" || status === "REPROVADA_INTERNAMENTE"
              ? "Esta proposta precisa de aprovação antes do envio."
              : "Esta proposta não pode mais ser enviada."
        );
      }
      const ap = approvalProblem(f);
      if (ap) return no(ap);
      const sp = syncProblem(f);
      return sp ? no(sp) : OK;
    }

    case "register_acceptance":
    case "register_refusal":
    case "register_change_request": {
      if (!isCommercial) return notCommercial;
      if (status !== "ENVIADA" && status !== "EM_NEGOCIACAO") {
        return no(expired ? "A proposta expirou. Atualize a validade e envie novamente." : "Registre a resposta somente depois de enviar a proposta.");
      }
      if (action === "register_acceptance") {
        const ap = approvalProblem(f);
        if (ap) return no(ap);
        if (!f.dispatchedCurrentVersion) return no("Registre o envio desta versão ao cliente antes do aceite.");
      }
      return OK;
    }

    case "reopen":
      if (!isCommercial) return notCommercial;
      if (hasOrder) return no("A conversão já foi realizada.");
      return status === "ACEITA" || status === "CONVERSAO_SOLICITADA" ? OK : no("Somente propostas aceitas podem voltar para negociação.");

    case "request_conversion":
    case "convert": {
      if (hasOrder) return no(f.orderStatus === "CONVERSAO_INCERTA" ? "Conversão sem confirmação: vincule o pedido gerado no Olist." : "A conversão já foi realizada.");
      if (action === "request_conversion" && !isCommercial) return notCommercial;
      if (action === "convert" && !authorizer(a, f)) return no("Somente supervisor da equipe, gerente comercial ou administrador pode converter em pedido.");
      if (expired) return no("A proposta expirou e precisa ser revalidada antes da conversão.");
      if (action === "request_conversion" && status !== "ACEITA") {
        return no(status === "CONVERSAO_SOLICITADA" ? "A conversão já foi solicitada." : "O cliente ainda não aceitou a versão atual.");
      }
      if (action === "convert" && status !== "ACEITA" && status !== "CONVERSAO_SOLICITADA") return no("O cliente ainda não aceitou a versão atual.");
      if (f.acceptanceStatus !== "ACEITA" || f.acceptedVersion !== f.version) return no("O cliente ainda não aceitou a versão atual.");
      const ap = approvalProblem(f);
      if (ap) return no(ap);
      if (!f.sellerLinked) return no("O vendedor responsável não tem vínculo válido com o Olist desta empresa.");
      const sp = syncProblem(f);
      if (sp) return no(sp);
      if (f.olistConcluded) return no("O Olist indica a proposta como concluída. Vincule o pedido existente em vez de converter de novo.");
      if (action === "convert" && o.conversionMode !== "api") {
        return no("A conversão automática está desativada: gere a venda no Olist e vincule o pedido.");
      }
      return OK;
    }

    case "deny_conversion":
      if (!authorizer(a, f)) return no("Somente supervisor da equipe, gerente comercial ou administrador pode recusar a solicitação.");
      return status === "CONVERSAO_SOLICITADA" ? OK : no("Não há solicitação de conversão pendente.");

    case "reconcile_order":
      if (!authorizer(a, f)) return no("Somente supervisor da equipe, gerente comercial ou administrador pode vincular pedidos.");
      if (f.orderStatus === "CONVERSAO_INCERTA") return OK;
      if (hasOrder) return no("A conversão já foi realizada.");
      if (!f.olistProposalId) return no("A proposta ainda não está registrada no Olist.");
      return status === "ACEITA" || status === "CONVERSAO_SOLICITADA" || f.olistConcluded
        ? OK
        : no("O cliente ainda não aceitou a versão atual.");

    case "approve_order":
      if (!isAdmin(a)) return no("Somente o Master pode aprovar pedidos.");
      return f.commercialStatus === "CONVERTIDA" && f.orderStatus === "PEDIDO_CRIADO"
        ? OK : no("A aprovação exige um pedido já criado e ainda não aprovado.");

    case "prepare_order_update":
      if (!isCommercial) return notCommercial;
      return f.commercialStatus === "CONVERTIDA" && !["SEM_PEDIDO", "CONVERSAO_EM_ANDAMENTO", "CONVERSAO_INCERTA"].includes(f.orderStatus)
        ? OK : no("Não há pedido confirmado para compartilhar.");

    case "refresh_order":
      return hasOrder && f.orderStatus !== "CONVERSAO_EM_ANDAMENTO" && f.orderStatus !== "CONVERSAO_INCERTA"
        ? OK
        : no("Não há pedido vinculado para consultar.");

    case "resolve_conflict":
      if (f.syncStatus !== "CONFLITO") return no("Não há conflito com o Olist.");
      if (hasOrder) return no("A conversão já foi realizada; a proposta não é mais enviada ao Olist.");
      return authorizer(a, f) ? OK : no("Somente supervisor da equipe, gerente comercial ou administrador resolve conflitos com o Olist.");

    case "transfer":
      if (!(isAdmin(a) || isManager(a) || isSupervisorOf(a, f.sellerId))) return no("Somente supervisor da equipe, gerente comercial ou administrador pode transferir o responsável.");
      if (hasOrder || ["CONVERTIDA", "CANCELADA", "RECUSADA"].includes(status)) return no("Esta proposta não pode mais ser transferida.");
      return OK;

    case "cancel":
      if (!isCommercial) return notCommercial;
      if (hasOrder || ["CONVERTIDA", "CANCELADA", "RECUSADA"].includes(f.commercialStatus)) return no("Esta proposta não pode mais ser cancelada.");
      if (!authorizer(a, f) && ["ACEITA", "CONVERSAO_SOLICITADA"].includes(status)) {
        return no("Proposta aceita pelo cliente: o cancelamento deve ser feito pela supervisão.");
      }
      return OK;

    case "duplicate":
      return isCommercial ? OK : notCommercial;

    case "finance_review":
      if (!(isAdmin(a) || isFinance(a))) return no("Somente o Financeiro ou o administrador registra conferência de recebimento.");
      return hasOrder && f.orderStatus !== "CONVERSAO_INCERTA" ? OK : no("Não há pedido vinculado para conferir.");
  }
}
