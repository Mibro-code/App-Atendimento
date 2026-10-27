"use client";

import { useEffect, useState } from "react";
import { formatTime } from "@/lib/format";
import { getBrazilWorkDateKey, TIME_CLOCK_EVENT_LABELS, type TimeClockEventValue } from "@/lib/time-clock";
import { OCCURRENCE_TYPE_LABELS } from "@/lib/labels";
import { DailyTimeClockStatusBadge, OccurrenceStatusBadge } from "@/components/badges";
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

interface RowView {
  userId: string;
  name: string;
  workDate: string;
  entries: EntryView[];
  summary: { status: string; workedMinutes: number; nextAction: string | null };
  earlyDeparture: { reason: string; description: string; expectedAt: string; actualAt: string } | null;
  occurrences: { id: string; type: string; status: string; description: string; documents: { id: string; fileName: string }[] }[];
}

interface CardsView {
  presentesHoje: number;
  aindaNaoEntraram: number;
  atrasados: number;
  saidasAntecipadas: number;
  justificativasPendentes: number;
}

function formatWorkedMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function formatWorkDateKey(workDate: string): string {
  const [year, month, day] = workDate.split("-");
  return `${day}/${month}/${year}`;
}

const CARD_LABELS: [keyof CardsView, string][] = [
  ["presentesHoje", "Presentes hoje"],
  ["aindaNaoEntraram", "Ainda não entraram"],
  ["atrasados", "Atrasados"],
  ["saidasAntecipadas", "Saídas antecipadas"],
  ["justificativasPendentes", "Justificativas pendentes"],
];

type Tab = "hoje" | "historico" | "justificativas";

export function TimeClockTeamView({
  apiBase,
  occurrenceApiBase,
  showSupervisorFilter,
  canCorrectEntries,
  correctionApiBase = "/api/admin/time-clock/entries",
}: {
  apiBase: string;
  occurrenceApiBase: string;
  showSupervisorFilter?: boolean;
  canCorrectEntries?: boolean;
  correctionApiBase?: string;
}) {
  const [tab, setTab] = useState<Tab>("hoje");
  const [rows, setRows] = useState<RowView[]>([]);
  const [cards, setCards] = useState<CardsView | null>(null);
  const [supervisors, setSupervisors] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [mapEntryId, setMapEntryId] = useState<string | null>(null);
  const [correction, setCorrection] = useState<{
    entryId: string;
    workDate: string;
    label: string;
  } | null>(null);
  const [correctionTime, setCorrectionTime] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [reloadRevision, setReloadRevision] = useState(0);

  const [supervisorId, setSupervisorId] = useState("");
  const [late, setLate] = useState(false);
  const [earlyDeparture, setEarlyDeparture] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [withDocuments, setWithDocuments] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (tab === "hoje") {
      const today = getBrazilWorkDateKey();
      params.set("from", today);
      params.set("to", today);
    }
    if (supervisorId) params.set("supervisorId", supervisorId);
    if (late) params.set("late", "true");
    if (earlyDeparture) params.set("earlyDeparture", "true");
    if (incomplete) params.set("incomplete", "true");
    if (withDocuments) params.set("withDocuments", "true");
    if (tab === "justificativas") params.set("withJustification", "true");

    setLoading(true);
    fetch(`${apiBase}?${params.toString()}`)
      .then((res) => res.json())
      .then((body) => {
        setRows(body.rows ?? []);
        setCards(body.cards ?? null);
        if (body.supervisors) setSupervisors(body.supervisors);
      })
      .finally(() => setLoading(false));
  }, [apiBase, tab, supervisorId, late, earlyDeparture, incomplete, withDocuments, reloadRevision]);

  async function reviewOccurrence(id: string, status: "APPROVED" | "REJECTED") {
    const reviewNote = status === "REJECTED" ? window.prompt("Observação (opcional):") ?? undefined : undefined;
    const res = await fetch(`${occurrenceApiBase}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, reviewNote }),
    });
    if (res.ok) {
      setRows((prev) =>
        prev.map((row) => ({
          ...row,
          occurrences: row.occurrences.map((o) => (o.id === id ? { ...o, status } : o)),
        }))
      );
    }
  }

  function openCorrection(entry: EntryView, workDate: string, name: string) {
    setCorrection({
      entryId: entry.id,
      workDate,
      label: `${name} — ${TIME_CLOCK_EVENT_LABELS[entry.eventType]}`,
    });
    setCorrectionTime(formatTime(entry.occurredAt));
    setCorrectionReason("");
    setCorrectionError(null);
  }

  async function submitCorrection(e: React.FormEvent) {
    e.preventDefault();
    if (!correction) return;
    setCorrecting(true);
    setCorrectionError(null);
    try {
      const occurredAt = new Date(
        `${correction.workDate}T${correctionTime}:00.000-03:00`
      ).toISOString();
      const response = await fetch(`${correctionApiBase}/${correction.entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occurredAt, reason: correctionReason }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Não foi possível corrigir o horário.");

      setRows((current) =>
        current.map((row) => ({
          ...row,
          entries: row.entries.map((entry) =>
            entry.id === correction.entryId
              ? { ...entry, occurredAt: body.entry.occurredAt }
              : entry
          ),
        }))
      );
      setCorrection(null);
      // Reconsulta o backend para recalcular horas trabalhadas e cards a
      // partir do horário corrigido, sem depender de cálculo duplicado na UI.
      setReloadRevision((value) => value + 1);
    } catch (error) {
      setCorrectionError(error instanceof Error ? error.message : "Não foi possível corrigir o horário.");
    } finally {
      setCorrecting(false);
    }
  }

  return (
    <div className="space-y-5">
      {cards && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {CARD_LABELS.map(([key, label]) => (
            <div key={key} className="card p-4">
              <p className="text-2xl font-semibold text-gray-900">{cards[key]}</p>
              <p className="text-xs text-gray-500 mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(["hoje", "historico", "justificativas"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={t === tab ? "btn-primary text-sm" : "btn-secondary text-sm"}
            onClick={() => setTab(t)}
          >
            {t === "hoje" ? "Hoje" : t === "historico" ? "Histórico" : "Justificativas/Atestados"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {showSupervisorFilter && (
          <select className="input-field w-auto" value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
            <option value="">Todas as equipes</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1"><input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} /> Atrasos</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={earlyDeparture} onChange={(e) => setEarlyDeparture(e.target.checked)} /> Saídas antecipadas</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={incomplete} onChange={(e) => setIncomplete(e.target.checked)} /> Incompletos</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={withDocuments} onChange={(e) => setWithDocuments(e.target.checked)} /> Com documentos</label>
      </div>

      {loading && <p className="text-sm text-gray-500">Carregando...</p>}

      {tab !== "justificativas" ? (
        <div className="card divide-y divide-gray-100">
          {rows.length === 0 && !loading && <p className="p-4 text-sm text-gray-500">Nenhum registro encontrado.</p>}
          {rows.map((row) => {
            const rowKey = `${row.userId}-${row.workDate}`;
            const isOpen = expandedRow === rowKey;
            return (
              <div key={rowKey}>
                <button
                  type="button"
                  className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-gray-50"
                  onClick={() => setExpandedRow(isOpen ? null : rowKey)}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{row.name}</p>
                    <p className="text-xs text-gray-500">{formatWorkDateKey(row.workDate)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600">{formatWorkedMinutes(row.summary.workedMinutes)}</span>
                    <DailyTimeClockStatusBadge status={row.summary.status} />
                    {row.occurrences.length > 0 && (
                      <span className="badge bg-amber-100 text-amber-700">{row.occurrences.length} ocorrência(s)</span>
                    )}
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 space-y-2">
                    {row.entries.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between gap-3 text-sm border border-gray-100 rounded-md p-2">
                        <div>
                          <span className="font-medium text-gray-800">{TIME_CLOCK_EVENT_LABELS[entry.eventType]}</span>
                          <span className="block text-xs text-gray-500">{formatTime(entry.occurredAt)}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {entry.locationStatus === "GRANTED" && entry.latitude != null && entry.longitude != null ? (
                            <button type="button" className="text-xs text-brand hover:underline" onClick={() => setMapEntryId(mapEntryId === entry.id ? null : entry.id)}>
                              {mapEntryId === entry.id ? "Ocultar mapa" : "Ver no mapa"}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">Sem localização</span>
                          )}
                          {canCorrectEntries && (
                            <button
                              type="button"
                              className="text-xs text-brand hover:underline"
                              onClick={() => openCorrection(entry, row.workDate, row.name)}
                            >
                              Corrigir horário
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {row.entries.map((entry) =>
                      mapEntryId === entry.id && entry.latitude != null && entry.longitude != null ? (
                        <TimeClockLocationMapDynamic
                          key={`map-${entry.id}`}
                          latitude={entry.latitude}
                          longitude={entry.longitude}
                          accuracyMeters={entry.accuracyMeters}
                          label={`${row.name} — ${TIME_CLOCK_EVENT_LABELS[entry.eventType]} — ${formatTime(entry.occurredAt)}`}
                        />
                      ) : null
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {rows.flatMap((row) => row.occurrences.map((occ) => ({ ...occ, name: row.name, workDate: row.workDate }))).length === 0 && !loading && (
            <p className="p-4 text-sm text-gray-500">Nenhuma ocorrência no período.</p>
          )}
          {rows
            .flatMap((row) => row.occurrences.map((occ) => ({ ...occ, name: row.name, workDate: row.workDate })))
            .map((occ) => (
              <div key={occ.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{occ.name} — {OCCURRENCE_TYPE_LABELS[occ.type] ?? occ.type}</p>
                    <p className="text-xs text-gray-500">{formatWorkDateKey(occ.workDate)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <OccurrenceStatusBadge status={occ.status} />
                    {occ.status === "PENDING" && (
                      <>
                        <button type="button" className="btn-secondary text-xs" onClick={() => reviewOccurrence(occ.id, "APPROVED")}>Aprovar</button>
                        <button type="button" className="btn-secondary text-xs" onClick={() => reviewOccurrence(occ.id, "REJECTED")}>Rejeitar</button>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-sm text-gray-600">{occ.description}</p>
                {occ.documents.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {occ.documents.map((doc) => (
                      <a
                        key={doc.id}
                        href={`/api/attendance-documents/${doc.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-brand hover:underline"
                      >
                        {doc.fileName}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      {correction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submitCorrection} className="card w-full max-w-md p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Corrigir horário</h2>
              <p className="mt-1 text-sm text-gray-500">{correction.label}</p>
              <p className="text-xs text-gray-400">{formatWorkDateKey(correction.workDate)}</p>
            </div>
            <div>
              <label className="label-field">Novo horário</label>
              <input
                type="time"
                className="input-field"
                value={correctionTime}
                onChange={(e) => setCorrectionTime(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label-field">Motivo da correção</label>
              <textarea
                className="input-field"
                rows={3}
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                maxLength={1000}
                required
              />
            </div>
            {correctionError && <p className="text-sm text-red-600">{correctionError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setCorrection(null)} disabled={correcting}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={correcting}>
                {correcting ? "Salvando..." : "Salvar correção"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
