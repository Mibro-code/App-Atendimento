// Regras puras da Agenda (sem Prisma/servidor): usadas pela API, pelas telas
// client e pelos testes.
//
// Fuso: igual ao resto do projeto, o banco guarda instantes em UTC e toda
// interpretação de "dia"/"hora" é feita em America/Sao_Paulo. O Brasil não
// tem horário de verão desde 2019, então o offset fixo -03:00 é seguro (mesma
// decisão de lib/time-clock.ts e lib/customer-list.ts). Datas de calendário
// circulam como chave "YYYY-MM-DD" e a aritmética de dias é feita em UTC
// puro sobre essa chave — nunca com o fuso do navegador/processo, para um
// compromisso das 14:30 nunca "andar" algumas horas após recarregar.

import { BRAZIL_TIME_ZONE } from "./format";

export const BRAZIL_OFFSET = "-03:00";
/** Duração assumida quando o compromisso não tem horário final. */
export const DEFAULT_DURATION_MINUTES = 30;
/** Maior intervalo aceito numa listagem por período (mês = 6 semanas). */
export const MAX_RANGE_DAYS = 62;

export const APPOINTMENT_TYPES = [
  "FOLLOW_UP", "LIGACAO", "WHATSAPP", "REUNIAO", "VISITA",
  "PROPOSTA", "COBRANCA", "EVENTO", "TAREFA", "OUTRO",
] as const;
export type AppointmentTypeValue = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentTypeValue, string> = {
  FOLLOW_UP: "Follow-up",
  LIGACAO: "Ligação",
  WHATSAPP: "WhatsApp",
  REUNIAO: "Reunião",
  VISITA: "Visita",
  PROPOSTA: "Proposta",
  COBRANCA: "Cobrança",
  EVENTO: "Evento",
  TAREFA: "Tarefa",
  OUTRO: "Outro",
};

export const APPOINTMENT_STATUSES = ["PENDENTE", "CONCLUIDO", "CANCELADO"] as const;
export type AppointmentStatusValue = (typeof APPOINTMENT_STATUSES)[number];
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatusValue, string> = {
  PENDENTE: "Pendente",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado",
};

export const APPOINTMENT_PRIORITIES = ["BAIXA", "NORMAL", "ALTA"] as const;
export type AppointmentPriorityValue = (typeof APPOINTMENT_PRIORITIES)[number];
export const APPOINTMENT_PRIORITY_LABELS: Record<AppointmentPriorityValue, string> = {
  BAIXA: "Baixa",
  NORMAL: "Normal",
  ALTA: "Alta",
};

/** Opções de lembrete: valor = minutos antes; "" = sem lembrete. */
export const REMINDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Sem lembrete" },
  { value: "0", label: "Na hora" },
  { value: "15", label: "15 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "1440", label: "1 dia antes" },
];
export const REMINDER_MINUTES_VALUES = [0, 15, 30, 60, 1440];

export type AgendaView = "hoje" | "semana" | "mes" | "lista";
export const AGENDA_VIEWS: AgendaView[] = ["hoje", "semana", "mes", "lista"];

/** Formato serializado devolvido pela API da Agenda (instantes em ISO/UTC). */
export interface AppointmentDTO {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  priority: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  reminderMinutes: number | null;
  reminderDismissedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  assignedTo: { id: string; name: string; role: string; color: string };
  createdBy: { id: string; name: string };
  completedBy: { id: string; name: string } | null;
  customer: { id: string; name: string; company: string | null } | null;
  /** Cor exibida: a escolhida no compromisso ou, sem escolha, a do responsável. */
  color: string;
  /** Cor escolhida explicitamente (nula = padrão do responsável). */
  customColor: string | null;
  participants: Array<{ id: string; name: string }>;
  /** O usuário atual pode editar/concluir/reagendar (escopo do responsável). */
  canEdit: boolean;
  /** Visível ao usuário só por ser participante (evento compartilhado). */
  sharedWithMe: boolean;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_KEY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isTimeKey(value: unknown): value is string {
  return typeof value === "string" && TIME_KEY.test(value);
}

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BRAZIL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
const timeKeyFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BRAZIL_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Dia de calendário em São Paulo ("YYYY-MM-DD") de um instante. */
export function toDateKey(date: Date | string): string {
  return dateKeyFormatter.format(typeof date === "string" ? new Date(date) : date);
}

/** Hora local de São Paulo ("HH:mm") de um instante. */
export function toTimeKey(date: Date | string): string {
  return timeKeyFormatter.format(typeof date === "string" ? new Date(date) : date);
}

/** Instante UTC correspondente a "dia + hora" no horário de São Paulo. */
export function zonedDate(dateKey: string, time = "00:00"): Date {
  return new Date(`${dateKey}T${time}:00.000${BRAZIL_OFFSET}`);
}

export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function addMonthsToKey(dateKey: string, months: number): string {
  const [y, m] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}

/** 0 = domingo ... 6 = sábado (dia de calendário, independente de fuso). */
export function weekdayOfKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Semana começa na segunda-feira (padrão comercial brasileiro). */
export function startOfWeekKey(dateKey: string): string {
  return addDaysToKey(dateKey, -((weekdayOfKey(dateKey) + 6) % 7));
}

export function startOfMonthKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

/** Dias exibidos no calendário mensal: semanas completas de seg a dom. */
export function monthGridKeys(dateKey: string): string[] {
  const first = startOfMonthKey(dateKey);
  const last = addDaysToKey(addMonthsToKey(first, 1), -1);
  const start = startOfWeekKey(first);
  const end = addDaysToKey(startOfWeekKey(last), 6);
  const keys: string[] = [];
  for (let key = start; key <= end; key = addDaysToKey(key, 1)) keys.push(key);
  return keys;
}

export function weekKeys(dateKey: string): string[] {
  const start = startOfWeekKey(dateKey);
  return Array.from({ length: 7 }, (_, index) => addDaysToKey(start, index));
}

/** Intervalo [from, to) de dias que cada visualização precisa buscar. */
export function viewRangeKeys(view: Exclude<AgendaView, "lista">, dateKey: string): { fromKey: string; toKey: string } {
  if (view === "hoje") return { fromKey: dateKey, toKey: addDaysToKey(dateKey, 1) };
  if (view === "semana") {
    const fromKey = startOfWeekKey(dateKey);
    return { fromKey, toKey: addDaysToKey(fromKey, 7) };
  }
  const grid = monthGridKeys(dateKey);
  return { fromKey: grid[0], toKey: addDaysToKey(grid[grid.length - 1], 1) };
}

/** Navegação "anterior/próximo" de cada visualização. */
export function shiftViewDate(view: AgendaView, dateKey: string, direction: -1 | 1): string {
  if (view === "mes") return addMonthsToKey(dateKey, direction);
  if (view === "semana") return addDaysToKey(dateKey, 7 * direction);
  return addDaysToKey(dateKey, direction);
}

export interface AppointmentTiming {
  startsAt: Date | string;
  endsAt?: Date | string | null;
  allDay: boolean;
}

function asDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value;
}

/** Fim efetivo: endsAt, ou fim do dia (dia inteiro), ou início + duração padrão. */
export function effectiveEnd(item: AppointmentTiming): Date {
  if (item.endsAt) return asDate(item.endsAt);
  const start = asDate(item.startsAt);
  if (item.allDay) return zonedDate(addDaysToKey(toDateKey(start), 1));
  return new Date(start.getTime() + DEFAULT_DURATION_MINUTES * 60_000);
}

/**
 * "Atrasado" = ainda pendente e o horário já passou. Dia inteiro só fica
 * atrasado depois que o dia termina. Nunca altera status (nada é cancelado
 * automaticamente) — é só uma marcação visual calculada.
 */
export function isOverdue(item: AppointmentTiming & { status: string }, now: Date = new Date()): boolean {
  if (item.status !== "PENDENTE") return false;
  if (item.allDay) return effectiveEnd(item) <= now;
  return asDate(item.startsAt) < now;
}

/**
 * Conflito = mesmo responsável com outro compromisso pendente cujo intervalo
 * se sobrepõe ao novo (fim nulo usa a duração padrão). Compromissos de dia
 * inteiro não conflitam com nada: são lembretes de dia, não blocos de tempo.
 * Serve apenas para AVISAR — salvar continua permitido.
 */
export function overlaps(a: AppointmentTiming, b: AppointmentTiming): boolean {
  if (a.allDay || b.allDay) return false;
  return asDate(a.startsAt) < effectiveEnd(b) && asDate(b.startsAt) < effectiveEnd(a);
}

export type ListGroup = "ATRASADOS" | "HOJE" | "AMANHA" | "ESTA_SEMANA" | "PROXIMOS" | "ANTERIORES";
export const LIST_GROUP_LABELS: Record<ListGroup, string> = {
  ATRASADOS: "Atrasados",
  HOJE: "Hoje",
  AMANHA: "Amanhã",
  ESTA_SEMANA: "Esta semana",
  PROXIMOS: "Próximos",
  ANTERIORES: "Anteriores",
};
export const LIST_GROUP_ORDER: ListGroup[] = ["ATRASADOS", "HOJE", "AMANHA", "ESTA_SEMANA", "PROXIMOS", "ANTERIORES"];

/** Grupo da visão em lista, relativo ao "hoje" de São Paulo. */
export function listGroupOf(item: AppointmentTiming & { status: string }, now: Date = new Date()): ListGroup {
  const todayKey = toDateKey(now);
  const key = toDateKey(asDate(item.startsAt));
  if (key < todayKey) return isOverdue(item, now) ? "ATRASADOS" : "ANTERIORES";
  if (key === todayKey) return "HOJE";
  if (key === addDaysToKey(todayKey, 1)) return "AMANHA";
  if (key <= addDaysToKey(startOfWeekKey(todayKey), 6)) return "ESTA_SEMANA";
  return "PROXIMOS";
}

/**
 * Momento em que o lembrete deve aparecer. Para dia inteiro a referência é
 * 08:00 do dia (lembrar "na hora" à meia-noite não ajuda ninguém).
 */
export function reminderDueAt(item: AppointmentTiming & { reminderMinutes: number | null }): Date | null {
  if (item.reminderMinutes === null || item.reminderMinutes === undefined) return null;
  const reference = item.allDay ? zonedDate(toDateKey(asDate(item.startsAt)), "08:00") : asDate(item.startsAt);
  return new Date(reference.getTime() - item.reminderMinutes * 60_000);
}

/** Lembrete visível no app: pendente, não dispensado, entre o aviso e o fim. */
export function isReminderActive(
  item: AppointmentTiming & { status: string; reminderMinutes: number | null; reminderDismissedAt?: Date | string | null },
  now: Date = new Date()
): boolean {
  if (item.status !== "PENDENTE" || item.reminderDismissedAt) return false;
  const due = reminderDueAt(item);
  return !!due && due <= now && now < effectiveEnd(item);
}

// Paleta discreta (tons médios, boa leitura em fundo claro e escuro), usada
// só como marcador fino — nunca para pintar o compromisso inteiro. Serve
// para a cor escolhida no compromisso e, quando não há escolha, para a cor
// derivada do responsável (estável pelo id: a mesma pessoa sempre aparece
// com a mesma cor). O backend só aceita valores desta lista.
export const APPOINTMENT_COLORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "#FF6633", label: "Laranja Mibro" },
  { value: "#E5484D", label: "Vermelho" },
  { value: "#D6409F", label: "Rosa" },
  { value: "#8E4EC6", label: "Roxo" },
  { value: "#3E63DD", label: "Azul" },
  { value: "#0091FF", label: "Azul-claro" },
  { value: "#12A594", label: "Turquesa" },
  { value: "#30A46C", label: "Verde" },
  { value: "#7C9A2E", label: "Oliva" },
  { value: "#F5A524", label: "Amarelo" },
  { value: "#A1695A", label: "Marrom" },
  { value: "#687076", label: "Cinza" },
];
const COLOR_VALUES = APPOINTMENT_COLORS.map((color) => color.value);

export function isAppointmentColor(value: unknown): value is string {
  return typeof value === "string" && COLOR_VALUES.includes(value.toUpperCase());
}

export function colorForUser(userId: string): string {
  let hash = 0;
  for (let index = 0; index < userId.length; index++) hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  return COLOR_VALUES[hash % COLOR_VALUES.length];
}

/** Cor aleatória da paleta, evitando repetir a atual quando possível. */
export function randomAppointmentColor(current?: string | null, random: () => number = Math.random): string {
  const options = COLOR_VALUES.filter((value) => value !== current?.toUpperCase());
  return options[Math.floor(random() * options.length)] ?? COLOR_VALUES[0];
}

/**
 * Novo horário ao arrastar um compromisso: mantém a duração, encaixa em
 * passos de 15 min e nunca passa de 23:45. Sem `time` (soltar num dia do
 * mês) mantém o horário original.
 */
export function droppedTiming(
  item: { startsAt: string; endsAt: string | null; allDay: boolean },
  dateKey: string,
  time?: string
): { date: string; allDay: boolean; startTime: string | null; endTime: string | null } {
  if (item.allDay && !time) return { date: dateKey, allDay: true, startTime: null, endTime: null };
  const start = time ?? toTimeKey(item.startsAt);
  const [h, m] = start.split(":").map(Number);
  const startMin = Math.min(23 * 60 + 45, Math.round((h * 60 + m) / 15) * 15);
  const fmt = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  if (!item.endsAt || item.allDay) return { date: dateKey, allDay: false, startTime: fmt(startMin), endTime: null };
  const duration = Math.round((new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60_000);
  const endMin = startMin + Math.max(15, duration);
  return { date: dateKey, allDay: false, startTime: fmt(startMin), endTime: endMin < 24 * 60 ? fmt(endMin) : null };
}

/** "Outubro 2026" */
export function formatMonthTitle(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" })
    .format(new Date(Date.UTC(y, m - 1, 15)));
  return label.charAt(0).toUpperCase() + label.slice(1).replace(" de ", " ");
}

/** "08 de outubro" (com dia da semana opcional: "quinta, 08 de outubro"). */
export function formatDayTitle(dateKey: string, withWeekday = false): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC", day: "2-digit", month: "long", ...(withWeekday ? { weekday: "long" } : {}),
  }).format(new Date(Date.UTC(y, m - 1, d))).replace("-feira", "");
}

/** "05/10/2026" a partir da chave. */
export function formatDateKeyBR(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}/${m}/${y}`;
}

export function typeLabel(type: string): string {
  return APPOINTMENT_TYPE_LABELS[type as AppointmentTypeValue] ?? type;
}

/** "14:30", "14:30–15:00" ou "Dia inteiro". */
export function timeRangeLabel(item: { startsAt: Date | string; endsAt?: Date | string | null; allDay: boolean }): string {
  if (item.allDay) return "Dia inteiro";
  const start = toTimeKey(item.startsAt);
  return item.endsAt ? `${start}–${toTimeKey(item.endsAt)}` : start;
}

/** "Hoje", "Amanhã", "Ontem" ou "qui, 08/10". */
export function relativeDayLabel(dateKey: string, now: Date = new Date()): string {
  const today = toDateKey(now);
  if (dateKey === today) return "Hoje";
  if (dateKey === addDaysToKey(today, 1)) return "Amanhã";
  if (dateKey === addDaysToKey(today, -1)) return "Ontem";
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" })
    .format(new Date(Date.UTC(y, m - 1, d))).replace(".", "");
  return `${weekday}, ${formatDateKeyBR(dateKey).slice(0, 5)}`;
}

export const WEEKDAY_SHORT_LABELS =["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** Ordenação cronológica com dia inteiro primeiro dentro do mesmo dia. */
export function compareAppointments(a: AppointmentTiming, b: AppointmentTiming): number {
  const dayA = toDateKey(asDate(a.startsAt));
  const dayB = toDateKey(asDate(b.startsAt));
  if (dayA !== dayB) return dayA < dayB ? -1 : 1;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return asDate(a.startsAt).getTime() - asDate(b.startsAt).getTime();
}
