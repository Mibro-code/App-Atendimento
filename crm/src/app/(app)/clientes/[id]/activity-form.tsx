"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACTIVITY_TYPE_LABELS } from "@/lib/labels";
import { requestLocationAttempt, type LocationAttempt } from "@/lib/geolocation-client";

const REGISTERABLE_TYPES = ["WHATSAPP", "TELEFONE", "EMAIL", "VISITA", "REUNIAO", "ANOTACAO"];

const LOCATION_STATUS_MESSAGES: Record<LocationAttempt["status"], string> = {
  GRANTED: "Localização capturada.",
  DENIED: "Permissão de localização negada.",
  TIMEOUT: "Tempo esgotado ao tentar obter a localização.",
  UNAVAILABLE: "Localização indisponível no momento.",
  NOT_SUPPORTED: "Geolocalização não suportada neste navegador.",
};

export function ActivityForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [type, setType] = useState("WHATSAPP");
  const [description, setDescription] = useState("");
  const [locationAttempt, setLocationAttempt] = useState<LocationAttempt | null>(null);
  const [locationStatusMessage, setLocationStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Só dispara ao clique explícito do botão "Registrar localização da
  // visita" — nunca automaticamente. O resultado (inclusive negação/erro) é
  // sempre registrado como um LocationCapture no backend, junto com a
  // atividade: "vendedor tentou e negou" é um dado diferente de "nunca
  // tentou".
  async function captureLocation() {
    setLocationStatusMessage("Solicitando permissão...");
    const attempt = await requestLocationAttempt();
    setLocationAttempt(attempt);
    setLocationStatusMessage(LOCATION_STATUS_MESSAGES[attempt.status]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch(`/api/customers/${customerId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        description,
        ...(type === "VISITA" && locationAttempt ? { locationAttempt } : {}),
      }),
    });
    setLoading(false);
    setDescription("");
    setLocationAttempt(null);
    setLocationStatusMessage(null);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <select className="input-field sm:w-48" value={type} onChange={(e) => setType(e.target.value)}>
          {REGISTERABLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACTIVITY_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          className="input-field flex-1"
          placeholder="Descreva o contato..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>
      {type === "VISITA" && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={captureLocation} className="btn-secondary text-xs">
            Registrar localização da visita
          </button>
          {locationStatusMessage && <span className="text-xs text-gray-500">{locationStatusMessage}</span>}
        </div>
      )}
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? "Registrando..." : "Registrar atividade"}
      </button>
    </form>
  );
}
