// Regras puras do funil comercial (sem acesso a banco). Usadas pela camada de
// serviço (lib/pipeline.ts), pelas rotas e pelos componentes do Kanban.
import type { CustomerStatus, PipelineStage } from "@prisma/client";

export const PIPELINE_STAGES: PipelineStage[] = [
  "NOVO", "EM_ATENDIMENTO", "FOLLOW_UP", "COTACAO", "VENDIDO", "RECICLAGEM", "INATIVO",
];

export const PIPELINE_STAGE_META: Record<PipelineStage, { label: string; description: string; column: string; dot: string }> = {
  NOVO: { label: "Novos", description: "Sem atendimento comercial efetivo neste ciclo", column: "border-amber-300 bg-amber-50", dot: "bg-amber-400" },
  EM_ATENDIMENTO: { label: "Em atendimento", description: "Primeiro contato feito, em processo comercial", column: "border-blue-300 bg-blue-50", dot: "bg-blue-500" },
  FOLLOW_UP: { label: "Follow-up", description: "Retomar contato após atendimento; controle de tentativas pelas estrelas", column: "border-indigo-300 bg-indigo-50", dot: "bg-indigo-500" },
  COTACAO: { label: "Cotação", description: "Cotação recebida ou proposta ativa", column: "border-orange-300 bg-orange-50", dot: "bg-orange-500" },
  VENDIDO: { label: "Vendidos", description: "Pedido aprovado na Olist", column: "border-emerald-300 bg-emerald-50", dot: "bg-emerald-500" },
  RECICLAGEM: { label: "Reciclagem", description: "Será retomado em outro ciclo", column: "border-purple-300 bg-purple-50", dot: "bg-purple-500" },
  INATIVO: { label: "Inativos", description: "Descartado comercialmente (pode ser reativado)", column: "border-gray-300 bg-gray-100", dot: "bg-gray-400" },
};

/** Etapas que formam as filas ativas de trabalho do vendedor. */
export const ACTIVE_PIPELINE_STAGES: PipelineStage[] = ["NOVO", "EM_ATENDIMENTO", "FOLLOW_UP", "COTACAO"];
/** Etapas pausadas: não geram follow-up automático nem aparecem nas filas ativas. */
export const PAUSED_PIPELINE_STAGES: PipelineStage[] = ["RECICLAGEM", "INATIVO"];

export const MAX_VISUAL_ATTEMPTS = 3;

export const INACTIVE_REASONS = [
  "Sem interesse", "Sem retorno", "Contato incorreto", "Empresa encerrada", "Duplicado", "Outro",
] as const;

export const RECYCLE_REASONS = [
  "Sem orçamento no momento", "Pediu contato futuro", "Demanda sazonal", "Aguardando estoque",
  "Aguardando decisão interna", "3 tentativas sem resposta", "Outro",
] as const;

export const RECYCLE_RETURN_TARGETS: PipelineStage[] = ["EM_ATENDIMENTO"];

export const RETURN_OPTIONS = [
  { key: "1", days: 1, label: "Amanhã" },
  { key: "3", days: 3, label: "3 dias" },
  { key: "7", days: 7, label: "7 dias" },
  { key: "15", days: 15, label: "15 dias" },
  { key: "30", days: 30, label: "30 dias" },
  { key: "custom", days: null, label: "Data personalizada" },
] as const;

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && (PIPELINE_STAGES as string[]).includes(value);
}

export function attemptStars(attempts: number): { filled: number; total: number; extra: number } {
  const safe = Math.max(0, Math.floor(attempts || 0));
  return { filled: Math.min(safe, MAX_VISUAL_ATTEMPTS), total: MAX_VISUAL_ATTEMPTS, extra: Math.max(0, safe - MAX_VISUAL_ATTEMPTS) };
}

/** Após 3 tentativas no ciclo, o vendedor decide o destino (nunca automático). */
export function needsAttemptDecision(attempts: number, stage: PipelineStage): boolean {
  return attempts >= MAX_VISUAL_ATTEMPTS && stage === "FOLLOW_UP";
}

// Datas em calendário de São Paulo (UTC-3, sem horário de verão desde 2019).
const BRAZIL_OFFSET = "-03:00";
export function brazilDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function brazilDayStart(key: string): Date {
  return new Date(`${key}T00:00:00${BRAZIL_OFFSET}`);
}
function addDaysKey(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "Voltar em": retorna o início do dia (horário de Brasília) escolhido. */
export function resolveReturnDate(option: string, customDate: string | null | undefined, now: Date = new Date()): Date | null {
  if (option === "custom") {
    if (!customDate || !/^\d{4}-\d{2}-\d{2}$/.test(customDate)) return null;
    const date = brazilDayStart(customDate);
    return date > now ? date : null;
  }
  const preset = RETURN_OPTIONS.find((item) => item.key === option);
  if (!preset || preset.days === null) return null;
  return brazilDayStart(addDaysKey(brazilDateKey(now), preset.days));
}

export interface StageMoveInput {
  to: PipelineStage;
  reason?: string | null;
  returnAt?: Date | null;
  returnTo?: PipelineStage | null;
}

/** Valida uma mudança explícita de etapa. Retorna a mensagem de erro ou null. */
export function validateStageMove(from: PipelineStage, input: StageMoveInput, now: Date = new Date()): string | null {
  if (from === input.to) return "O cliente já está nesta etapa.";
  if (from === "RECICLAGEM" && input.to !== "EM_ATENDIMENTO" && input.to !== "INATIVO") {
    return "Clientes em Reciclagem só podem voltar para Em atendimento ou ir para Inativos.";
  }
  const reason = input.reason?.trim();
  if (input.to === "INATIVO" && !reason) return "Informe o motivo para marcar como inativo.";
  if (input.to === "RECICLAGEM") {
    if (!reason) return "Informe o motivo da reciclagem.";
    if (input.returnTo && !RECYCLE_RETURN_TARGETS.includes(input.returnTo)) return "O retorno da Reciclagem deve ir para Em atendimento.";
  }
  if (input.returnAt && input.returnAt <= now) return "A data de retorno deve ser futura.";
  return null;
}

/**
 * Novo ciclo comercial: ao voltar para Novos vindo de outra etapa, ou ao sair
 * de Reciclagem/Inativos para uma etapa ativa. Inativo <-> Reciclagem não
 * inicia ciclo (o cliente continua pausado). Vendido -> Follow-up é a
 * recompra: nova oportunidade, então também abre um ciclo (estrelas zeradas).
 */
export function startsNewCycle(from: PipelineStage, to: PipelineStage): boolean {
  if (from === to) return false;
  if (to === "NOVO") return true;
  if (from === "VENDIDO" && to === "FOLLOW_UP") return true;
  return PAUSED_PIPELINE_STAGES.includes(from) && !PAUSED_PIPELINE_STAGES.includes(to);
}

const INACTIVE_STATUSES: CustomerStatus[] = ["INATIVO", "SEM_INTERESSE"];

/**
 * Status (legado) que acompanha a mudança de etapa, para que INATIVO seja
 * real em todas as telas que ainda leem `status`. null = manter o atual.
 */
export function statusAfterStageMove(current: CustomerStatus, to: PipelineStage): CustomerStatus | null {
  if (to === "INATIVO") return current === "INATIVO" ? null : "INATIVO";
  const wasInactive = INACTIVE_STATUSES.includes(current);
  if (to === "RECICLAGEM") return wasInactive ? "AGUARDANDO_RETORNO" : null;
  if (to === "NOVO") return wasInactive || current === "VENDA_PERDIDA" ? "NOVO" : null;
  if (to === "VENDIDO") return null; // o fluxo de venda define CLIENTE_ATIVO
  return wasInactive || current === "VENDA_PERDIDA" ? "CONTATO_REALIZADO" : null;
}

/** Etapa que acompanha uma troca de status feita pelo editor de status legado. */
export function stageAfterStatusChange(status: CustomerStatus, currentStage: PipelineStage): PipelineStage | null {
  if (INACTIVE_STATUSES.includes(status)) return currentStage === "INATIVO" ? null : "INATIVO";
  if (status === "VENDA_PERDIDA") return PAUSED_PIPELINE_STAGES.includes(currentStage) ? null : "RECICLAGEM";
  if (currentStage === "INATIVO") return status === "NOVO" ? "NOVO" : "EM_ATENDIMENTO";
  return null;
}

/** Cliente que já comprou e voltou a uma etapa de oportunidade = recompra. */
export function isRepurchase(lastSaleAt: Date | null | undefined, stage: PipelineStage): boolean {
  return !!lastSaleAt && ACTIVE_PIPELINE_STAGES.includes(stage);
}

export function normalizeRepurchaseDays(days: number | null | undefined): number {
  return Number.isInteger(days) && days! >= 1 && days! <= 365 ? days! : 30;
}

/** Vendido volta como oportunidade de recompra após o prazo do responsável (padrão 30 dias). */
export function soldReturnDueAt(soldAt: Date, followUpAfterDays: number | null | undefined): Date {
  return new Date(soldAt.getTime() + normalizeRepurchaseDays(followUpAfterDays) * 86_400_000);
}

export type FollowUpBucket = "OVERDUE" | "TODAY" | "TOMORROW" | "WEEK" | "FUTURE" | "NONE";

export const FOLLOW_UP_BUCKET_LABELS: Record<FollowUpBucket, string> = {
  OVERDUE: "Vencido", TODAY: "Hoje", TOMORROW: "Amanhã", WEEK: "Esta semana", FUTURE: "Futuro", NONE: "Sem data",
};

/** Intervalo [gte, lt) de cada filtro de follow-up, em calendário de Brasília. */
export function followUpBucketRange(bucket: Exclude<FollowUpBucket, "NONE">, now: Date = new Date()): { gte?: Date; lt?: Date } {
  const today = brazilDateKey(now);
  const todayStart = brazilDayStart(today);
  const tomorrowStart = brazilDayStart(addDaysKey(today, 1));
  if (bucket === "OVERDUE") return { lt: todayStart };
  if (bucket === "TODAY") return { gte: todayStart, lt: tomorrowStart };
  if (bucket === "TOMORROW") return { gte: tomorrowStart, lt: brazilDayStart(addDaysKey(today, 2)) };
  if (bucket === "FUTURE") return { gte: tomorrowStart };
  // Esta semana: de hoje até domingo (inclusive).
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const daysToSunday = weekday === 0 ? 0 : 7 - weekday;
  return { gte: todayStart, lt: brazilDayStart(addDaysKey(today, daysToSunday + 1)) };
}

export function followUpBucket(dueAt: Date | null | undefined, now: Date = new Date()): FollowUpBucket {
  if (!dueAt) return "NONE";
  const inRange = (range: { gte?: Date; lt?: Date }) => (!range.gte || dueAt >= range.gte) && (!range.lt || dueAt < range.lt);
  if (inRange(followUpBucketRange("OVERDUE", now))) return "OVERDUE";
  if (inRange(followUpBucketRange("TODAY", now))) return "TODAY";
  if (inRange(followUpBucketRange("TOMORROW", now))) return "TOMORROW";
  if (inRange(followUpBucketRange("WEEK", now))) return "WEEK";
  return "FUTURE";
}

// Estado visual das colunas recolhidas (mantido durante a sessão do navegador).
export const COLLAPSED_COLUMNS_STORAGE_KEY = "crm:pipeline:collapsed";

export function parseCollapsedColumns(raw: string | null | undefined): PipelineStage[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? PIPELINE_STAGES.filter((stage) => parsed.includes(stage)) : [];
  } catch {
    return [];
  }
}

export function toggleCollapsedColumn(collapsed: PipelineStage[], stage: PipelineStage): PipelineStage[] {
  return collapsed.includes(stage) ? collapsed.filter((item) => item !== stage) : PIPELINE_STAGES.filter((item) => item === stage || collapsed.includes(item));
}
