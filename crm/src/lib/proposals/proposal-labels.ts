// Rótulos das propostas (sem dependências de servidor: usáveis no navegador).

import type {
  ProposalAcceptanceStatus,
  ProposalApprovalStatus,
  ProposalCommercialStatus,
  ProposalFinancialStatus,
  ProposalOrderStatus,
  ProposalSyncStatus,
} from "@prisma/client";

export const COMMERCIAL_LABELS: Record<ProposalCommercialStatus, string> = {
  RASCUNHO: "Rascunho",
  AGUARDANDO_APROVACAO: "Aguardando aprovação",
  APROVADA_INTERNAMENTE: "Aprovada internamente",
  REPROVADA_INTERNAMENTE: "Reprovada internamente",
  ENVIADA: "Enviada ao cliente",
  EM_NEGOCIACAO: "Em negociação",
  ACEITA: "Aceita pelo cliente",
  RECUSADA: "Recusada pelo cliente",
  EXPIRADA: "Expirada",
  CONVERSAO_SOLICITADA: "Conversão solicitada",
  CONVERTIDA: "Convertida em pedido",
  CANCELADA: "Cancelada",
};

export const APPROVAL_LABELS: Record<ProposalApprovalStatus, string> = {
  NAO_SOLICITADA: "Não solicitada",
  PENDENTE: "Pendente",
  APROVADA: "Condições aprovadas",
  REPROVADA: "Reprovada",
  INVALIDADA: "Invalidada por alteração",
};

export const ACCEPTANCE_LABELS: Record<ProposalAcceptanceStatus, string> = {
  PENDENTE: "Sem resposta",
  ACEITA: "Aceita",
  RECUSADA: "Recusada",
  ALTERACAO_SOLICITADA: "Alteração solicitada",
};

export const SYNC_LABELS: Record<ProposalSyncStatus, string> = {
  NAO_SINCRONIZADA: "Não enviada ao Olist",
  PENDENTE: "Aguardando envio",
  SINCRONIZANDO: "Sincronizando",
  SINCRONIZADA: "Sincronizada",
  ERRO: "Erro de sincronização",
  CONFLITO: "Conflito com o Olist",
};

export const ORDER_LABELS: Record<ProposalOrderStatus, string> = {
  SEM_PEDIDO: "Sem pedido",
  CONVERSAO_EM_ANDAMENTO: "Conversão em andamento",
  CONVERSAO_INCERTA: "Conversão sem confirmação",
  PEDIDO_CRIADO: "Pedido criado",
  PEDIDO_APROVADO: "Pedido aprovado",
  FATURADO: "Faturado",
  ENVIADO: "Enviado",
  ENTREGUE: "Entregue",
  NAO_ENTREGUE: "Não entregue",
  EM_DEVOLUCAO: "Em devolução",
  CANCELADO: "Pedido cancelado",
};

export const FINANCIAL_LABELS: Record<ProposalFinancialStatus, string> = {
  NAO_APLICAVEL: "—",
  SEM_COBRANCA: "Cobrança ainda não gerada",
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  PAGAMENTO_PARCIAL: "Pagamento parcial",
  PAGAMENTO_CONFIRMADO: "Pagamento confirmado",
  CANCELADO: "Cobrança cancelada",
};
