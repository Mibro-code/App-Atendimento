import {
  ACCEPTANCE_LABELS,
  APPROVAL_LABELS,
  COMMERCIAL_LABELS,
  FINANCIAL_LABELS,
  ORDER_LABELS,
  SYNC_LABELS,
} from "@/lib/proposals/proposal-labels";

// Um selo por dimensão: estado comercial, aprovação, aceite, Olist, pedido e
// financeiro nunca são resumidos num único status.

const tone = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-100 text-blue-800",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-700",
  violet: "bg-violet-100 text-violet-800",
} as const;

const COMMERCIAL_TONE: Record<string, keyof typeof tone> = {
  RASCUNHO: "gray", AGUARDANDO_APROVACAO: "amber", APROVADA_INTERNAMENTE: "blue", REPROVADA_INTERNAMENTE: "red",
  ENVIADA: "violet", EM_NEGOCIACAO: "amber", ACEITA: "green", RECUSADA: "red", EXPIRADA: "gray",
  CONVERSAO_SOLICITADA: "violet", CONVERTIDA: "green", CANCELADA: "gray",
};
const APPROVAL_TONE: Record<string, keyof typeof tone> = { NAO_SOLICITADA: "gray", PENDENTE: "amber", APROVADA: "green", REPROVADA: "red", INVALIDADA: "red" };
const SYNC_TONE: Record<string, keyof typeof tone> = { NAO_SINCRONIZADA: "gray", PENDENTE: "amber", SINCRONIZANDO: "blue", SINCRONIZADA: "green", ERRO: "red", CONFLITO: "red" };
const ORDER_TONE: Record<string, keyof typeof tone> = {
  SEM_PEDIDO: "gray", CONVERSAO_EM_ANDAMENTO: "blue", CONVERSAO_INCERTA: "red", PEDIDO_CRIADO: "blue", PEDIDO_APROVADO: "violet",
  FATURADO: "green", ENVIADO: "green", ENTREGUE: "green", NAO_ENTREGUE: "red", EM_DEVOLUCAO: "amber", CANCELADO: "red",
};
const FINANCIAL_TONE: Record<string, keyof typeof tone> = {
  NAO_APLICAVEL: "gray", SEM_COBRANCA: "gray", AGUARDANDO_PAGAMENTO: "amber", PAGAMENTO_PARCIAL: "amber", PAGAMENTO_CONFIRMADO: "green", CANCELADO: "red",
};
const ACCEPTANCE_TONE: Record<string, keyof typeof tone> = { PENDENTE: "gray", ACEITA: "green", RECUSADA: "red", ALTERACAO_SOLICITADA: "amber" };

function Badge({ label, color, title }: { label: string; color: keyof typeof tone; title?: string }) {
  return (
    <span className={`badge ${tone[color]}`} title={title}>
      {label}
    </span>
  );
}

export function ProposalStatusBadge({ status }: { status: string }) {
  return <Badge label={COMMERCIAL_LABELS[status as keyof typeof COMMERCIAL_LABELS] ?? status} color={COMMERCIAL_TONE[status] ?? "gray"} />;
}
export function ProposalApprovalBadge({ status }: { status: string }) {
  return <Badge label={APPROVAL_LABELS[status as keyof typeof APPROVAL_LABELS] ?? status} color={APPROVAL_TONE[status] ?? "gray"} title="Aprovação interna" />;
}
export function ProposalAcceptanceBadge({ status }: { status: string }) {
  return <Badge label={ACCEPTANCE_LABELS[status as keyof typeof ACCEPTANCE_LABELS] ?? status} color={ACCEPTANCE_TONE[status] ?? "gray"} title="Resposta do cliente" />;
}
export function ProposalSyncBadge({ status }: { status: string }) {
  return <Badge label={SYNC_LABELS[status as keyof typeof SYNC_LABELS] ?? status} color={SYNC_TONE[status] ?? "gray"} title="Sincronização com o Olist" />;
}
export function ProposalOrderBadge({ status }: { status: string }) {
  return <Badge label={ORDER_LABELS[status as keyof typeof ORDER_LABELS] ?? status} color={ORDER_TONE[status] ?? "gray"} title="Pedido de venda" />;
}
export function ProposalFinancialBadge({ status }: { status: string }) {
  return <Badge label={FINANCIAL_LABELS[status as keyof typeof FINANCIAL_LABELS] ?? status} color={FINANCIAL_TONE[status] ?? "gray"} title="Situação financeira (contas a receber do Olist)" />;
}
