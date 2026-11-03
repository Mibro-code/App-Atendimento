"use client";

import { useEffect } from "react";
import {
  isOverdue,
  toTimeKey,
  typeLabel,
  type AppointmentDTO,
} from "@/lib/agenda-rules";

// Helpers puros ficam em lib/agenda-rules (usáveis também em Server
// Components); reexportados aqui por conveniência dos componentes client.
export { relativeDayLabel, timeRangeLabel, typeLabel } from "@/lib/agenda-rules";

export const MIBRO_ORANGE = "#FF6633";

export function OverdueMark() {
  return <span className="text-xs font-medium text-amber-700 dark:text-amber-400">⚠ Atrasado</span>;
}

export function StatusMark({ item }: { item: AppointmentDTO }) {
  if (item.status === "CONCLUIDO") return <span className="text-xs text-emerald-700 dark:text-emerald-400">✓ Concluído</span>;
  if (item.status === "CANCELADO") return <span className="text-xs text-gray-400">Cancelado</span>;
  if (isOverdue(item)) return <OverdueMark />;
  return null;
}

export function itemToneClass(item: AppointmentDTO): string {
  if (item.status === "CANCELADO") return "opacity-50";
  if (item.status === "CONCLUIDO") return "opacity-60";
  return "";
}

export function titleToneClass(item: AppointmentDTO): string {
  return item.status === "PENDENTE" ? "" : "line-through decoration-gray-400";
}

/**
 * Linha padrão de compromisso (Hoje, Lista, dia do mês, semana no celular).
 * Marcador lateral fino na cor do responsável — nunca o card inteiro pintado.
 */
export function AppointmentRow({
  item,
  onOpen,
  onComplete,
  showAssignee,
  timeLabel,
  dateLabel,
}: {
  item: AppointmentDTO;
  onOpen: (item: AppointmentDTO) => void;
  onComplete?: (item: AppointmentDTO) => void;
  showAssignee?: boolean;
  timeLabel?: string;
  dateLabel?: string;
}) {
  return (
    <li className={`flex items-stretch gap-3 ${itemToneClass(item)}`}>
      <div className="w-14 shrink-0 pt-3 text-right text-sm font-medium tabular-nums text-gray-700">
        {timeLabel ?? (item.allDay ? "Dia" : toTimeKey(item.startsAt))}
      </div>
      <div className="relative flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white py-2.5 pl-4 pr-2">
        <span aria-hidden className="absolute inset-y-2 left-1.5 w-1 rounded-full" style={{ backgroundColor: item.color }} />
        <button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left">
          <p className={`truncate text-sm font-medium text-gray-900 ${titleToneClass(item)}`}>{item.title}</p>
          <p className="truncate text-xs text-gray-500">
            {[dateLabel, typeLabel(item.type), item.customer?.name, showAssignee ? item.assignedTo.name : null].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
            <StatusMark item={item} />
            {item.priority === "ALTA" && item.status === "PENDENTE" && <span className="text-xs text-gray-500">Prioridade alta</span>}
            {item.sharedWithMe && <span className="text-xs text-gray-500">Compartilhado por {item.assignedTo.name}</span>}
            {!item.sharedWithMe && item.participants.length > 0 && <span className="text-xs text-gray-400">+{item.participants.length} participante{item.participants.length > 1 ? "s" : ""}</span>}
          </div>
        </button>
        {onComplete && item.canEdit && item.status === "PENDENTE" && (
          <button
            type="button"
            onClick={() => onComplete(item)}
            className="shrink-0 rounded-md border border-gray-200 px-2.5 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
            aria-label={`Concluir ${item.title}`}
            title="Marcar como concluído"
          >
            ✓ <span className="hidden sm:inline">Concluir</span>
          </button>
        )}
      </div>
    </li>
  );
}

export function Modal({
  title,
  onClose,
  children,
  size = "md",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "md" | "lg";
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-xl ${size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
          <h2 className="truncate text-base font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100" aria-label="Fechar">
            Fechar
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function AgendaSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Carregando agenda">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-3">
          <div className="h-4 w-14 animate-pulse rounded bg-gray-100" />
          <div className="h-14 flex-1 animate-pulse rounded-lg bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

export function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </svg>
  );
}
