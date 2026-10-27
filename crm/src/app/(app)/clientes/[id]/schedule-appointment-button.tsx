"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppointmentFormModal, type AgendaCurrentUser } from "@/components/agenda/appointment-form";
import { CalendarIcon, timeRangeLabel } from "@/components/agenda/agenda-ui";
import { formatDateKeyBR, toDateKey, type AppointmentDTO } from "@/lib/agenda-rules";

/**
 * "+ Agendar" na ficha do cliente: abre o formulário da Agenda já com o
 * cliente preenchido e tipo Follow-up, sem sair da ficha.
 */
export function ScheduleAppointmentButton({
  customer,
  currentUser,
}: {
  customer: { id: string; name: string };
  currentUser: AgendaCurrentUser;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<AppointmentDTO | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn-secondary gap-1.5" onClick={() => { setSaved(null); setOpen(true); }}>
        <CalendarIcon className="h-4 w-4 opacity-70" /> Agendar
      </button>
      {saved && (
        <p className="text-xs text-gray-500" role="status">
          Agendado para {formatDateKeyBR(toDateKey(saved.startsAt))} · {timeRangeLabel(saved)}.{" "}
          <Link className="underline" href={`/agenda?view=hoje&date=${toDateKey(saved.startsAt)}&open=${saved.id}`}>Ver na agenda</Link>
        </p>
      )}
      {open && (
        <AppointmentFormModal
          currentUser={currentUser}
          defaults={{ customer, type: "FOLLOW_UP" }}
          onClose={() => setOpen(false)}
          onSaved={(appointment) => {
            setOpen(false);
            setSaved(appointment);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
