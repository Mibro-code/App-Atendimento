import {
  STATUS_LABELS, TEMPERATURE_LABELS, QUOTE_STATUS_LABELS, PROPOSAL_MODE_LABELS,
  OCCURRENCE_STATUS_LABELS, DAILY_TIME_CLOCK_STATUS_LABELS, GOAL_RISK_LABELS,
  COMMERCIAL_BRAND_LABELS,
} from "@/lib/labels";

const STATUS_COLORS: Record<string, string> = {
  NOVO: "bg-gray-100 text-gray-700",
  CONTATO_REALIZADO: "bg-blue-100 text-blue-700",
  EM_NEGOCIACAO: "bg-amber-100 text-amber-700",
  COTACAO_ENVIADA: "bg-amber-100 text-amber-700",
  AGUARDANDO_RETORNO: "bg-amber-100 text-amber-700",
  AGUARDANDO_PAGAMENTO: "bg-amber-100 text-amber-700",
  CLIENTE_ATIVO: "bg-green-100 text-green-700",
  SEM_INTERESSE: "bg-gray-100 text-gray-500",
  VENDA_PERDIDA: "bg-red-100 text-red-700",
  INATIVO: "bg-gray-100 text-gray-400",
};

const TEMPERATURE_COLORS: Record<string, string> = {
  QUENTE: "bg-red-100 text-red-700",
  MORNO: "bg-amber-100 text-amber-700",
  FRIO: "bg-blue-100 text-blue-700",
  SEM_CLASSIFICACAO: "bg-gray-100 text-gray-500",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function TemperatureBadge({ temperature }: { temperature: string }) {
  return (
    <span className={`badge ${TEMPERATURE_COLORS[temperature] ?? "bg-gray-100 text-gray-600"}`}>
      {TEMPERATURE_LABELS[temperature] ?? temperature}
    </span>
  );
}

const QUOTE_STATUS_COLORS: Record<string, string> = {
  ABERTA: "bg-gray-100 text-gray-600",
  CALCULADA: "bg-blue-100 text-blue-700",
  ENVIADA: "bg-amber-100 text-amber-700",
  ENVIADA_PARA_ANALISE: "bg-amber-100 text-amber-700",
  CONVERTIDA: "bg-green-100 text-green-700",
  CANCELADA: "bg-red-100 text-red-700",
  EXPIRADA: "bg-gray-100 text-gray-400",
};

export function QuoteStatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${QUOTE_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {QUOTE_STATUS_LABELS[status] ?? status}
    </span>
  );
}

const PROPOSAL_MODE_COLORS: Record<string, string> = {
  SIMULATION: "bg-purple-100 text-purple-700",
  REAL: "bg-brand-100 text-brand-700",
};

export function ProposalModeBadge({ mode }: { mode: string }) {
  return (
    <span className={`badge ${PROPOSAL_MODE_COLORS[mode] ?? "bg-gray-100 text-gray-600"}`}>
      {PROPOSAL_MODE_LABELS[mode] ?? mode}
    </span>
  );
}

export function CommercialBrandBadge({ brand }: { brand: string }) {
  const color = brand === "SINCROFIT"
    ? "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200"
    : "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200";
  return <span className={`badge ${color}`}>{COMMERCIAL_BRAND_LABELS[brand] ?? brand}</span>;
}

const OCCURRENCE_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
};

export function OccurrenceStatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${OCCURRENCE_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {OCCURRENCE_STATUS_LABELS[status] ?? status}
    </span>
  );
}

const DAILY_TIME_CLOCK_STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-500",
  WORKING: "bg-green-100 text-green-700",
  ON_BREAK: "bg-amber-100 text-amber-700",
  FINISHED: "bg-blue-100 text-blue-700",
  INCOMPLETE: "bg-red-100 text-red-700",
};

const GOAL_RISK_COLORS: Record<string, string> = {
  EM_ANDAMENTO: "bg-blue-100 text-blue-700",
  PROXIMO_DA_META: "bg-amber-100 text-amber-700",
  ATENCAO: "bg-orange-100 text-orange-700",
  ATINGIDA: "bg-green-100 text-green-700",
  EXPIRADA: "bg-red-100 text-red-700",
};

export function GoalRiskBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${GOAL_RISK_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {GOAL_RISK_LABELS[status] ?? status}
    </span>
  );
}

export function DailyTimeClockStatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${DAILY_TIME_CLOCK_STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {DAILY_TIME_CLOCK_STATUS_LABELS[status] ?? status}
    </span>
  );
}
