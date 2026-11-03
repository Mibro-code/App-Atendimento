"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toDateKey, type AppointmentDTO } from "@/lib/agenda-rules";
import { relativeDayLabel, timeRangeLabel } from "./agenda-ui";

const POLL_MS = 60_000;

/**
 * Lembretes da Agenda exibidos dentro do app (primeira versão — sem push,
 * e-mail ou WhatsApp). Consulta a cada minuto apenas os lembretes ativos do
 * próprio usuário; "Dispensar" grava no banco para não reaparecer em outro
 * dispositivo.
 */
export function AgendaReminders() {
  const pathname = usePathname();
  const [reminders, setReminders] = useState<AppointmentDTO[]>([]);

  const load = useCallback(() => {
    fetch("/api/agenda/reminders")
      .then((response) => (response.ok ? response.json() : { reminders: [] }))
      .then((body) => setReminders(body.reminders ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, pathname]);

  async function dismiss(id: string) {
    setReminders((current) => current.filter((item) => item.id !== id));
    await fetch(`/api/agenda/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "DISMISS_REMINDER" }),
    }).catch(() => undefined);
  }

  if (reminders.length === 0) return null;
  return (
    <div className="fixed left-4 right-4 top-16 z-30 space-y-2 md:bottom-6 md:left-auto md:top-auto md:w-80" aria-live="polite">
      {reminders.map((item) => {
        const dayKey = toDateKey(item.startsAt);
        return (
          <div key={item.id} className="card border-l-4 p-3 shadow-md" style={{ borderLeftColor: "#FF6633" }} role="status">
            <p className="text-xs font-medium text-gray-500">Lembrete · {relativeDayLabel(dayKey)} · {timeRangeLabel(item)}</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-gray-900">{item.title}</p>
            {item.customer && <p className="truncate text-xs text-gray-500">{item.customer.name}</p>}
            <div className="mt-2 flex gap-2">
              <Link href={`/agenda?view=hoje&date=${dayKey}&open=${item.id}`} className="btn-secondary px-3 py-1.5 text-xs">Abrir</Link>
              <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100" onClick={() => void dismiss(item.id)}>Dispensar</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
