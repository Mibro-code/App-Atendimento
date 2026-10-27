"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const POLL_MS = 60_000;
const VISIBLE = 3;

interface QuoteAlert {
  id: string;
  title: string;
  message: string;
  quoteId: string | null;
  createdAt: string;
}

/**
 * Aviso ao supervisor a cada cotação feita pela equipe (CRM ou Shopify).
 * Mesmo padrão dos lembretes da Agenda: consulta periódica, e "Dispensar"
 * grava a leitura no banco para não reaparecer em outro dispositivo.
 */
export function QuoteAlerts() {
  const pathname = usePathname();
  const [alerts, setAlerts] = useState<QuoteAlert[]>([]);

  const load = useCallback(() => {
    fetch("/api/notifications?unread=1&type=QUOTE_CREATED")
      .then((response) => (response.ok ? response.json() : { notifications: [] }))
      .then((body) => setAlerts(body.notifications ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, pathname]);

  async function dismiss(ids: string[]) {
    setAlerts((current) => current.filter((a) => !ids.includes(a.id)));
    await Promise.all(ids.map((id) => fetch(`/api/notifications/${id}`, { method: "PATCH" }).catch(() => undefined)));
  }

  if (alerts.length === 0) return null;
  const extra = alerts.length - VISIBLE;
  return (
    <div className="fixed bottom-24 left-4 right-4 z-30 space-y-2 md:bottom-auto md:left-auto md:right-6 md:top-6 md:w-80" aria-live="polite">
      {alerts.slice(0, VISIBLE).map((alert) => (
        <div key={alert.id} className="card border-l-4 border-l-slate-800 p-3 shadow-md" role="status">
          <p className="text-xs font-medium text-gray-500">Nova cotação da equipe</p>
          <p className="mt-0.5 text-sm font-semibold text-gray-900">{alert.title}</p>
          <p className="text-xs text-gray-600">{alert.message}</p>
          <div className="mt-2 flex gap-2">
            {alert.quoteId && (
              <Link href={`/cotacoes/${alert.quoteId}`} className="btn-secondary px-3 py-1.5 text-xs" onClick={() => void dismiss([alert.id])}>
                Ver proposta
              </Link>
            )}
            <button type="button" className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100" onClick={() => void dismiss([alert.id])}>
              Dispensar
            </button>
          </div>
        </div>
      ))}
      {extra > 0 && (
        <div className="card flex items-center justify-between p-2 text-xs text-gray-600 shadow-md">
          <span>+{extra} cotação(ões)</span>
          <button type="button" className="underline" onClick={() => void dismiss(alerts.map((a) => a.id))}>Dispensar todas</button>
        </div>
      )}
    </div>
  );
}
