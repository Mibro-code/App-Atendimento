// Regras puras da Central de Atividades (sem Prisma): agrupamento, resumo por
// responsável e filtros. Cada atividade continua pertencendo ao sistema de
// origem — aqui só se organiza a visualização.
import { addDaysToKey, toDateKey } from "./agenda-rules";

export type ActivitySource = "CRM_AGENDA" | "CRM_RECOMPRA" | "CENTRAL";
export type ActivityState = "ATRASADO" | "PENDENTE" | "CONCLUIDO";

export const ACTIVITY_SOURCE_LABELS: Record<ActivitySource, string> = {
  CRM_AGENDA: "Agenda do CRM",
  CRM_RECOMPRA: "Recompra (CRM)",
  CENTRAL: "Retorno da Central",
};

export interface ActivityItem {
  key: string;
  source: ActivitySource;
  id: string;
  title: string;
  kind: string;
  at: string;
  /** Original CRM duration; no database column is added. */
  endsAt?: string | null;
  allDay: boolean;
  state: ActivityState;
  priority: "BAIXA" | "NORMAL" | "ALTA" | "URGENTE";
  assignee: { key: string; name: string } | null;
  customer: { id: string; name: string } | null;
  /** Empresa da Central; nulo = cadastro compartilhado do CRM. */
  company: { slug: string; name: string } | null;
  conversationId: string | null;
  note: string | null;
  canEdit: boolean;
  completedAt: string | null;
}

export type ActivityGroup = "ATRASADAS" | "HOJE" | "AMANHA" | "PROXIMOS" | "CONCLUIDAS";
export const ACTIVITY_GROUP_LABELS: Record<ActivityGroup, string> = {
  ATRASADAS: "Atrasadas",
  HOJE: "Hoje",
  AMANHA: "Amanhã",
  PROXIMOS: "Próximos dias",
  CONCLUIDAS: "Concluídas nos últimos 7 dias",
};
export const ACTIVITY_GROUP_ORDER: ActivityGroup[] = ["ATRASADAS", "HOJE", "AMANHA", "PROXIMOS", "CONCLUIDAS"];

export function groupOf(item: Pick<ActivityItem, "state" | "at">, now: Date = new Date()): ActivityGroup {
  if (item.state === "CONCLUIDO") return "CONCLUIDAS";
  if (item.state === "ATRASADO") return "ATRASADAS";
  const today = toDateKey(now);
  const key = toDateKey(item.at);
  if (key <= today) return "HOJE";
  if (key === addDaysToKey(today, 1)) return "AMANHA";
  return "PROXIMOS";
}

const PRIORITY_RANK = { URGENTE: 0, ALTA: 1, NORMAL: 2, BAIXA: 3 } as const;

export function groupActivities(items: ActivityItem[], now: Date = new Date()): Array<{ group: ActivityGroup; items: ActivityItem[] }> {
  const buckets = new Map<ActivityGroup, ActivityItem[]>(ACTIVITY_GROUP_ORDER.map((group) => [group, []]));
  for (const item of items) buckets.get(groupOf(item, now))!.push(item);
  return ACTIVITY_GROUP_ORDER.map((group) => {
    const rows = buckets.get(group)!;
    rows.sort(group === "CONCLUIDAS"
      ? (a, b) => (b.completedAt || b.at).localeCompare(a.completedAt || a.at)
      : (a, b) => a.at.localeCompare(b.at) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.key.localeCompare(b.key));
    return { group, items: rows };
  });
}

export interface AssigneeSummary {
  key: string;
  name: string;
  pending: number;
  overdue: number;
  today: number;
  done: number;
}

/** Visão do supervisor: carga por responsável; sem responsável fica à parte. */
export function summarizeByAssignee(items: ActivityItem[], now: Date = new Date()): { rows: AssigneeSummary[]; unassigned: number } {
  const rows = new Map<string, AssigneeSummary>();
  let unassigned = 0;
  for (const item of items) {
    if (!item.assignee) {
      if (item.state !== "CONCLUIDO") unassigned += 1;
      continue;
    }
    const row = rows.get(item.assignee.key) ?? { key: item.assignee.key, name: item.assignee.name, pending: 0, overdue: 0, today: 0, done: 0 };
    if (item.state === "CONCLUIDO") row.done += 1;
    else {
      row.pending += 1;
      if (item.state === "ATRASADO") row.overdue += 1;
      else if (groupOf(item, now) === "HOJE") row.today += 1;
    }
    rows.set(item.assignee.key, row);
  }
  return {
    rows: [...rows.values()].sort((a, b) => b.overdue - a.overdue || b.pending - a.pending || a.name.localeCompare(b.name, "pt-BR")),
    unassigned,
  };
}

export interface ActivityFilters {
  source?: ActivitySource | "";
  priority?: "ALTA_OU_MAIS" | "";
  q?: string;
}

export function filterActivities(items: ActivityItem[], filters: ActivityFilters): ActivityItem[] {
  const q = (filters.q || "").trim().toLocaleLowerCase("pt-BR");
  return items.filter((item) =>
    (!filters.source || item.source === filters.source) &&
    (filters.priority !== "ALTA_OU_MAIS" || item.priority === "ALTA" || item.priority === "URGENTE") &&
    (!q || [item.title, item.kind, item.customer?.name, item.assignee?.name].some((value) => value?.toLocaleLowerCase("pt-BR").includes(q)))
  );
}
