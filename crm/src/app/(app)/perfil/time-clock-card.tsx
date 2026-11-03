"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestLocationAttempt, type LocationAttempt } from "@/lib/geolocation-client";
import { formatDateTime, formatTime } from "@/lib/format";
import {
  TIME_CLOCK_EVENT_LABELS,
  computeDailySummary,
  timeClockEventValues,
  type TimeClockEventValue,
} from "@/lib/time-clock";

interface TimeClockEntryView {
  id: string;
  eventType: TimeClockEventValue;
  occurredAt: string;
  locationStatus: string | null;
  latitude: number | null;
  longitude: number | null;
}

type PointVerification = { type: "password"; password: string } | { type: "passkey"; response: unknown };

const EARLY_DEPARTURE_REASON_LABELS: Record<string, string> = {
  COMPROMISSO: "Compromisso",
  EMERGENCIA: "Emergência",
  PROBLEMA_PESSOAL: "Problema pessoal",
  AUTORIZACAO_SUPERVISOR: "Autorização do supervisor",
  OUTRO: "Outro",
};

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Você ainda não iniciou o expediente hoje",
  WORKING: "Você está trabalhando",
  ON_BREAK: "Você está no intervalo",
  FINISHED: "Seu expediente de hoje terminou",
  INCOMPLETE: "Ponto incompleto",
};

const NEXT_ACTION_LABELS: Record<TimeClockEventValue, string> = {
  CLOCK_IN: "Registrar entrada",
  LUNCH_START: "Sair para intervalo",
  LUNCH_END: "Registrar retorno",
  CLOCK_OUT: "Registrar saída",
};

const LOCATION_PROBLEM_LABELS: Record<string, string> = {
  DENIED: "Você negou o acesso à localização.",
  TIMEOUT: "Não foi possível obter a localização a tempo.",
  UNAVAILABLE: "A localização não estava disponível neste dispositivo.",
  NOT_SUPPORTED: "Este navegador não suporta localização.",
};

export function TimeClockCard({
  todayEntries,
  recentEntries,
  passkeyCount,
}: {
  todayEntries: TimeClockEntryView[];
  recentEntries: TimeClockEntryView[];
  passkeyCount: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);
  const [pendingEarlyDeparture, setPendingEarlyDeparture] = useState<{
    eventType: TimeClockEventValue;
    location: LocationAttempt;
    verification: PointVerification;
  } | null>(null);
  const [pendingAuthentication, setPendingAuthentication] = useState<TimeClockEventValue | null>(null);
  const [password, setPassword] = useState("");
  const [earlyReason, setEarlyReason] = useState("");
  const [earlyDescription, setEarlyDescription] = useState("");

  const summary = computeDailySummary(
    todayEntries.map((e) => ({ eventType: e.eventType, occurredAt: e.occurredAt }))
  );
  const registeredEventTypes = new Set(todayEntries.map((entry) => entry.eventType));
  const availableActions = registeredEventTypes.has("CLOCK_OUT")
    ? []
    : timeClockEventValues.filter((eventType) => !registeredEventTypes.has(eventType));

  async function register(
    eventType: TimeClockEventValue,
    earlyDeparture: { reason: string; description: string } | undefined,
    verification: PointVerification,
    previousLocation?: LocationAttempt
  ) {
    setLoading(true);
    setMessage("Obtendo a localização deste momento...");
    setLocationProblem(null);

    const location = previousLocation ?? await requestLocationAttempt();
    setMessage("Registrando o ponto...");

    try {
      const response = await fetch("/api/profile/time-clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType, location, earlyDeparture, verification }),
      });
      const body = await response.json().catch(() => ({}));

      if (response.status === 422 && body.code === "EARLY_DEPARTURE_JUSTIFICATION_REQUIRED") {
        setPendingEarlyDeparture({ eventType, location, verification });
        setMessage(null);
        setLoading(false);
        return;
      }
      if (!response.ok) throw new Error(body.error || "Não foi possível registrar o ponto.");

      if (location.status !== "GRANTED") {
        setLocationProblem(location.status);
        setMessage(`${TIME_CLOCK_EVENT_LABELS[eventType]} registrada. A localização não estava disponível.`);
      } else {
        setMessage(`${TIME_CLOCK_EVENT_LABELS[eventType]} registrada com localização.`);
      }
      setPendingEarlyDeparture(null);
      setEarlyReason("");
      setEarlyDescription("");
      setPassword("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível registrar o ponto.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmWithPasskey() {
    if (!pendingAuthentication) return;
    setLoading(true);
    setMessage("Confirme sua identidade no aparelho...");
    try {
      const optionsResponse = await fetch("/api/profile/time-clock/auth/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: pendingAuthentication }),
      });
      const options = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(options.error || "Não foi possível iniciar a confirmação.");
      const response = await startAuthentication(options);
      const eventType = pendingAuthentication;
      setPendingAuthentication(null);
      await register(eventType, undefined, { type: "passkey", response });
    } catch (error) {
      setMessage(error instanceof Error && error.name !== "NotAllowedError" ? error.message : "Confirmação cancelada no aparelho.");
      setLoading(false);
    }
  }

  function confirmWithPassword() {
    if (!pendingAuthentication || !password) return;
    const eventType = pendingAuthentication;
    const currentPassword = password;
    setPendingAuthentication(null);
    register(eventType, undefined, { type: "password", password: currentPassword });
  }

  function confirmEarlyDeparture() {
    if (!pendingEarlyDeparture || !earlyReason || !earlyDescription.trim()) return;
    register(
      pendingEarlyDeparture.eventType,
      { reason: earlyReason, description: earlyDescription.trim() },
      pendingEarlyDeparture.verification,
      pendingEarlyDeparture.location
    );
  }

  return (
    <div className="card p-6 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Meu ponto</h2>
        <p className="mt-1 text-sm text-gray-500">
          O horário vem do servidor; a localização é pedida a cada registro (nunca rastreamento contínuo).
        </p>
      </div>

      {/* Estado do dia bem visível — botão principal grande (mobile-first, item 13). */}
      <div className="rounded-lg bg-gray-50 border border-gray-100 p-5 text-center space-y-4">
        <div>
          {summary.clockIn && (
            <p className="text-2xl font-semibold text-gray-900">{formatTime(summary.clockIn)}</p>
          )}
          <p className="text-sm text-gray-600">{STATUS_LABELS[summary.status]}</p>
        </div>

        {availableActions.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Selecione a marcação necessária. A entrada feita no relógio do escritório não é obrigatória para registrar as etapas seguintes pelo app.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {availableActions.map((eventType) => (
                <button
                  key={eventType}
                  type="button"
                  className={eventType === summary.nextAction ? "btn-primary min-h-12" : "btn-secondary min-h-12"}
                  disabled={loading}
                  onClick={() => { setPendingAuthentication(eventType); setPassword(""); setMessage(null); }}
                >
                  {loading ? "Aguarde..." : NEXT_ACTION_LABELS[eventType]}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Nenhuma ação pendente no momento.</p>
        )}
      </div>

      {message && <p className="text-sm text-gray-600" role="status">{message}</p>}

      {locationProblem && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p>{LOCATION_PROBLEM_LABELS[locationProblem] || "Não foi possível registrar a localização."}</p>
          <Link href="/ponto?ocorrencia=PROBLEMA_NO_PONTO" className="mt-1 inline-block font-medium text-amber-900 hover:underline">
            Registrar ocorrência sobre isso
          </Link>
        </div>
      )}

      {pendingAuthentication && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="card w-full max-w-md space-y-4 p-5">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Confirme sua identidade</h3>
              <p className="mt-1 text-sm text-gray-500">O horário será registrado automaticamente pelo servidor. Você não poderá escolher ou alterar a hora.</p>
            </div>
            {passkeyCount > 0 && <button type="button" className="btn-primary w-full min-h-12" disabled={loading} onClick={confirmWithPasskey}>Usar digital, rosto ou passkey</button>}
            <div className="space-y-2">
              <label className="label-field">Ou confirme com a senha da conta</label>
              <input className="input-field" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") confirmWithPassword(); }} />
              <button type="button" className="btn-secondary w-full" disabled={loading || !password} onClick={confirmWithPassword}>Confirmar com senha</button>
            </div>
            {passkeyCount === 0 && <p className="text-xs text-gray-500">Você ainda não cadastrou uma digital/passkey. Faça isso abaixo, nesta página, se o aparelho oferecer suporte.</p>}
            <button type="button" className="text-sm text-gray-500 hover:underline" disabled={loading} onClick={() => setPendingAuthentication(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Modal simples de justificativa (item 5) — só aparece quando o servidor sinaliza saída antecipada. */}
      {pendingEarlyDeparture && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="card w-full max-w-md p-5 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                Você está encerrando seu expediente antes do horário previsto.
              </h3>
              <p className="mt-1 text-sm text-gray-500">Informe o motivo para registrar a saída.</p>
            </div>
            <div>
              <label className="label-field">Justificativa</label>
              <select className="input-field" value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)}>
                <option value="">Selecione...</option>
                {Object.entries(EARLY_DEPARTURE_REASON_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-field">Descreva o motivo</label>
              <textarea
                className="input-field"
                rows={3}
                value={earlyDescription}
                onChange={(e) => setEarlyDescription(e.target.value)}
                maxLength={1000}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setPendingEarlyDeparture(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!earlyReason || !earlyDescription.trim() || loading}
                onClick={confirmEarlyDeparture}
              >
                Confirmar saída
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">Hoje</h3>
          <Link href="/ponto" className="text-sm text-brand hover:underline">Ver histórico completo</Link>
        </div>
        {todayEntries.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum ponto registrado hoje.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {todayEntries.map((entry) => (
              <li key={entry.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-gray-800">{TIME_CLOCK_EVENT_LABELS[entry.eventType]}</span>
                <span className="text-xs text-gray-500">{formatDateTime(entry.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Últimos registros</h3>
        {recentEntries.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum ponto registrado ainda.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recentEntries.slice(0, 8).map((entry) => (
              <li key={entry.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div>
                  <span className="font-medium text-gray-800">{TIME_CLOCK_EVENT_LABELS[entry.eventType]}</span>
                  <span className="block text-xs text-gray-500">{formatDateTime(entry.occurredAt)}</span>
                </div>
                {entry.locationStatus === "GRANTED" && entry.latitude != null && entry.longitude != null ? (
                  <span className="text-xs text-emerald-700">Localização registrada</span>
                ) : (
                  <span className="text-xs text-gray-400">Sem localização</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
