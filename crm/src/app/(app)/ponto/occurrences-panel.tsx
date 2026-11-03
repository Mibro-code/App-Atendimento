"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { OCCURRENCE_TYPE_LABELS } from "@/lib/labels";
import { OccurrenceStatusBadge } from "@/components/badges";
import { getBrazilWorkDateKey } from "@/lib/time-clock";

interface DocumentView {
  id: string;
  fileName: string;
  mimeType: string;
  uploadedAt: string;
}

interface OccurrenceView {
  id: string;
  type: string;
  occurrenceDate: string;
  description: string;
  status: string;
  reviewNote: string | null;
  createdAt: string;
  documents: DocumentView[];
}

const TODAY_KEY = () => getBrazilWorkDateKey();

export function OccurrencesPanel({
  occurrences,
  initialType,
}: {
  occurrences: OccurrenceView[];
  initialType?: string;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(Boolean(initialType));
  const [type, setType] = useState(initialType && initialType in OCCURRENCE_TYPE_LABELS ? initialType : "OUTRO");
  const [occurrenceDate, setOccurrenceDate] = useState(TODAY_KEY());
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/profile/time-clock/occurrences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, occurrenceDate, description }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Não foi possível registrar a ocorrência.");

      if (file) {
        const form = new FormData();
        form.append("file", file);
        const uploadRes = await fetch(`/api/profile/time-clock/occurrences/${body.occurrence.id}/documents`, {
          method: "POST",
          body: form,
        });
        if (!uploadRes.ok) {
          const uploadBody = await uploadRes.json().catch(() => ({}));
          throw new Error(uploadBody.error || "Ocorrência criada, mas o documento não pôde ser enviado.");
        }
      }

      setShowForm(false);
      setDescription("");
      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar a ocorrência.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Ocorrências e justificativas</h2>
        {!showForm && (
          <button type="button" className="btn-primary text-sm" onClick={() => setShowForm(true)}>
            Justificar ocorrência
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={submit} className="space-y-3 border border-gray-100 rounded-md p-4">
          <div>
            <label className="label-field">Tipo</label>
            <select className="input-field" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(OCCURRENCE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field">Data</label>
            <input type="date" className="input-field" value={occurrenceDate} onChange={(e) => setOccurrenceDate(e.target.value)} required />
          </div>
          <div>
            <label className="label-field">Motivo</label>
            <textarea className="input-field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={2000} />
          </div>
          <div>
            <label className="label-field">Documento (opcional)</label>
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              capture="environment"
              className="block w-full text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="mt-1 text-xs text-gray-500">JPG, PNG ou PDF, até 10 MB.</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Enviando..." : "Enviar justificativa"}
            </button>
          </div>
        </form>
      )}

      <ul className="divide-y divide-gray-100">
        {occurrences.length === 0 && <p className="text-sm text-gray-500 py-2">Nenhuma ocorrência registrada.</p>}
        {occurrences.map((occ) => (
          <li key={occ.id} className="py-3 space-y-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="font-medium text-gray-800 text-sm">{OCCURRENCE_TYPE_LABELS[occ.type] ?? occ.type}</span>
                <span className="block text-xs text-gray-500">{formatDateTime(occ.createdAt)}</span>
              </div>
              <OccurrenceStatusBadge status={occ.status} />
            </div>
            <p className="text-sm text-gray-600">{occ.description}</p>
            {occ.reviewNote && <p className="text-xs text-gray-500">Observação da análise: {occ.reviewNote}</p>}
            {occ.documents.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
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
          </li>
        ))}
      </ul>
    </div>
  );
}
