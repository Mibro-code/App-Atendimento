"use client";

import { useState } from "react";
import { formatTime } from "@/lib/format";
import { TIME_CLOCK_EVENT_LABELS, type TimeClockEventValue } from "@/lib/time-clock";
import { DailyTimeClockStatusBadge } from "@/components/badges";
import { TimeClockLocationMapDynamic } from "@/components/time-clock-location-map-dynamic";

interface EntryView {
  id: string;
  eventType: TimeClockEventValue;
  occurredAt: string;
  locationStatus: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
}

interface DayView {
  workDate: string;
  summary: {
    status: string;
    workedMinutes: number;
    clockIn: string | null;
    lunchStart: string | null;
    lunchEnd: string | null;
    clockOut: string | null;
  };
  entries: EntryView[];
  earlyDeparture: { reason: string; description: string; expectedAt: string; actualAt: string } | null;
}

const EARLY_DEPARTURE_REASON_LABELS: Record<string, string> = {
  COMPROMISSO: "Compromisso",
  EMERGENCIA: "Emergência",
  PROBLEMA_PESSOAL: "Problema pessoal",
  AUTORIZACAO_SUPERVISOR: "Autorização do supervisor",
  OUTRO: "Outro",
};

// workDate é sempre "YYYY-MM-DD" representando a data civil de São Paulo
// (meia-noite UTC, ver getBrazilWorkDate) — formatar direto da string, nunca
// via formatDateBR (que reaplicaria o fuso e voltaria um dia).
function formatWorkDateKey(workDate: string): string {
  const [year, month, day] = workDate.split("-");
  return `${day}/${month}/${year}`;
}

function formatWorkedMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

export function PontoHistory({ days }: { days: DayView[] }) {
  const [expandedDay, setExpandedDay] = useState<string | null>(days[0]?.workDate ?? null);
  const [mapEntryId, setMapEntryId] = useState<string | null>(null);

  return (
    <div className="card divide-y divide-gray-100">
      <div className="p-4">
        <h2 className="text-sm font-semibold text-gray-700">Histórico do mês</h2>
      </div>
      {days.length === 0 && <p className="p-4 text-sm text-gray-500">Nenhum ponto registrado neste mês.</p>}
      {days.map((day) => {
        const isOpen = expandedDay === day.workDate;
        return (
          <div key={day.workDate}>
            <button
              type="button"
              className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50"
              onClick={() => setExpandedDay(isOpen ? null : day.workDate)}
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{formatWorkDateKey(day.workDate)}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {formatTime(day.summary.clockIn)} · {formatTime(day.summary.lunchStart)} · {formatTime(day.summary.lunchEnd)} · {formatTime(day.summary.clockOut)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">{formatWorkedMinutes(day.summary.workedMinutes)}</span>
                <DailyTimeClockStatusBadge status={day.summary.status} />
              </div>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 space-y-3">
                {day.earlyDeparture && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-medium">Saída antecipada — {EARLY_DEPARTURE_REASON_LABELS[day.earlyDeparture.reason] ?? day.earlyDeparture.reason}</p>
                    <p className="mt-1">{day.earlyDeparture.description}</p>
                    <p className="mt-1 text-xs">
                      Previsto: {formatTime(day.earlyDeparture.expectedAt)} · Realizado: {formatTime(day.earlyDeparture.actualAt)}
                    </p>
                  </div>
                )}
                <ul className="space-y-2">
                  {day.entries.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-3 text-sm border border-gray-100 rounded-md p-2">
                      <div>
                        <span className="font-medium text-gray-800">{TIME_CLOCK_EVENT_LABELS[entry.eventType]}</span>
                        <span className="block text-xs text-gray-500">{formatTime(entry.occurredAt)}</span>
                      </div>
                      {entry.locationStatus === "GRANTED" && entry.latitude != null && entry.longitude != null ? (
                        <button
                          type="button"
                          className="text-xs text-brand hover:underline"
                          onClick={() => setMapEntryId(mapEntryId === entry.id ? null : entry.id)}
                        >
                          {mapEntryId === entry.id ? "Ocultar mapa" : "Ver no mapa"}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">
                          {entry.locationStatus ? "Localização não registrada" : "Sem tentativa de localização"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {day.entries.map((entry) =>
                  mapEntryId === entry.id && entry.latitude != null && entry.longitude != null ? (
                    <TimeClockLocationMapDynamic
                      key={`map-${entry.id}`}
                      latitude={entry.latitude}
                      longitude={entry.longitude}
                      accuracyMeters={entry.accuracyMeters}
                      label={`${TIME_CLOCK_EVENT_LABELS[entry.eventType]} — ${formatTime(entry.occurredAt)}`}
                    />
                  ) : null
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
