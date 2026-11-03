"use client";

import Link from "next/link";
import { useState } from "react";
import {
  APPOINTMENT_PRIORITY_LABELS,
  APPOINTMENT_STATUS_LABELS,
  REMINDER_OPTIONS,
  formatDateKeyBR,
  isOverdue,
  toDateKey,
  type AppointmentDTO,
  type AppointmentPriorityValue,
  type AppointmentStatusValue,
} from "@/lib/agenda-rules";
import { formatDateTimeBR } from "@/lib/format";
import { Modal, OverdueMark, timeRangeLabel, typeLabel } from "./agenda-ui";

export type AppointmentQuickAction = "COMPLETE" | "CANCEL" | "REOPEN";

/** Executa ação rápida na API e devolve o compromisso atualizado. */
export async function runAppointmentAction(id: string, action: AppointmentQuickAction): Promise<AppointmentDTO> {
  const response = await fetch(`/api/agenda/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Não foi possível atualizar o compromisso.");
  return body.appointment;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-gray-400">{label}</dt>
      <dd className="min-w-0 break-words text-gray-800">{children}</dd>
    </div>
  );
}

export function AppointmentDetailModal({
  appointment,
  onClose,
  onEdit,
  onReschedule,
  onChanged,
}: {
  appointment: AppointmentDTO;
  onClose: () => void;
  onEdit: (appointment: AppointmentDTO) => void;
  onReschedule: (appointment: AppointmentDTO) => void;
  onChanged: (appointment: AppointmentDTO) => void;
}) {
  const [busy, setBusy] = useState<AppointmentQuickAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const item = appointment;
  const pending = item.status === "PENDENTE";
  const reminderLabel = REMINDER_OPTIONS.find((option) => option.value === (item.reminderMinutes == null ? "" : String(item.reminderMinutes)))?.label;
  const heading = item.customer ? `${typeLabel(item.type)} — ${item.customer.name}` : typeLabel(item.type);

  async function act(action: AppointmentQuickAction) {
    setBusy(action);
    setError(null);
    try {
      onChanged(await runAppointmentAction(item.id, action));
      setConfirmCancel(false);
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={heading} onClose={onClose}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-1.5 h-3 w-1 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
        <div className="min-w-0">
          <p className={`text-lg font-semibold text-gray-900 ${pending ? "" : "line-through decoration-gray-400"}`}>{item.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-gray-500">
            <span>{APPOINTMENT_STATUS_LABELS[item.status as AppointmentStatusValue] ?? item.status}</span>
            {isOverdue(item) && <OverdueMark />}
          </p>
        </div>
      </div>

      <dl className="mt-4 divide-y divide-gray-100 border-y border-gray-100">
        <Row label="Data">{formatDateKeyBR(toDateKey(item.startsAt))}</Row>
        <Row label="Horário">{timeRangeLabel(item)}</Row>
        <Row label="Responsável">{item.assignedTo.name}</Row>
        {item.participants.length > 0 && (
          <Row label="Participantes">{item.participants.map((participant) => participant.name).join(", ")}</Row>
        )}
        {item.customer && (
          <Row label="Cliente">
            <Link href={`/clientes/${item.customer.id}`} className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-600">
              {item.customer.name}
            </Link>
            {item.customer.company && item.customer.company !== item.customer.name && <span className="block text-xs text-gray-400">{item.customer.company}</span>}
          </Row>
        )}
        {item.priority !== "NORMAL" && <Row label="Prioridade">{APPOINTMENT_PRIORITY_LABELS[item.priority as AppointmentPriorityValue] ?? item.priority}</Row>}
        {item.reminderMinutes != null && <Row label="Lembrete">{reminderLabel}</Row>}
        {item.description && <Row label="Observação"><span className="whitespace-pre-line">{item.description}</span></Row>}
        {item.status === "CONCLUIDO" && item.completedAt && (
          <Row label="Concluído">{formatDateTimeBR(item.completedAt).slice(0, 16)}{item.completedBy ? ` por ${item.completedBy.name}` : ""}</Row>
        )}
        <Row label="Criado por">{item.createdBy.name} · {formatDateTimeBR(item.createdAt).slice(0, 10)}</Row>
      </dl>

      {item.sharedWithMe && (
        <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
          Evento compartilhado por {item.assignedTo.name}. Somente o responsável pode alterar.
        </p>
      )}

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}

      {!item.canEdit ? (
        item.customer && (
          <div className="mt-4">
            <Link href={`/clientes/${item.customer.id}`} className="btn-secondary py-2.5">Ver cliente</Link>
          </div>
        )
      ) : confirmCancel ? (
        <div className="mt-4 rounded-lg border border-gray-200 p-3">
          <p className="text-sm text-gray-700">Cancelar este compromisso? Ele continua no histórico como cancelado.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={!!busy} onClick={() => void act("CANCEL")}>
              {busy === "CANCEL" ? "Cancelando…" : "Sim, cancelar compromisso"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setConfirmCancel(false)}>Voltar</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {pending && (
              <button type="button" className="btn-primary col-span-2 py-2.5 sm:col-span-1" disabled={!!busy} onClick={() => void act("COMPLETE")}>
                {busy === "COMPLETE" ? "Concluindo…" : "✓ Concluir"}
              </button>
          )}
          {item.customer && (
            <Link href={`/clientes/${item.customer.id}`} className="btn-secondary col-span-2 py-2.5 sm:col-span-1">Ver cliente</Link>
          )}
          {pending ? (
            <>
              <button type="button" className="btn-secondary py-2.5" onClick={() => onEdit(item)}>Editar</button>
              <button type="button" className="btn-secondary py-2.5" onClick={() => onReschedule(item)}>Reagendar</button>
              <button type="button" className="col-span-2 rounded-md px-3 py-2.5 text-sm text-gray-500 hover:bg-gray-50 sm:col-span-1" onClick={() => setConfirmCancel(true)}>
                Cancelar compromisso
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-secondary py-2.5" disabled={!!busy} onClick={() => void act("REOPEN")}>
                {busy === "REOPEN" ? "Reabrindo…" : "Reabrir"}
              </button>
              <button type="button" className="btn-secondary py-2.5" onClick={() => onReschedule(item)}>Reagendar</button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
