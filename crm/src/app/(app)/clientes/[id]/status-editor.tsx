"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STATUS_LABELS, TEMPERATURE_LABELS } from "@/lib/labels";

export function StatusTemperatureEditor({
  customerId,
  currentStatus,
  currentTemperature,
}: {
  customerId: string;
  currentStatus: string;
  currentTemperature: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [temperature, setTemperature] = useState(currentTemperature);
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    await fetch(`/api/customers/${customerId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, temperature }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        className="input-field"
        value={temperature}
        onChange={(e) => setTemperature(e.target.value)}
      >
        {Object.entries(TEMPERATURE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button className="btn-primary w-full" onClick={save} disabled={loading}>
        {loading ? "Salvando..." : "Salvar alteração"}
      </button>
    </div>
  );
}
