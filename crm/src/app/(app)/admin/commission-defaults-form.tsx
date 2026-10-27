"use client";

import { useState } from "react";

const TYPES = [["VAREJO", "Varejo"], ["ATACADO", "Atacado"], ["OUTRO", "Outro"]] as const;
type Values = Record<(typeof TYPES)[number][0], string>;

/** Comissão padrão por tipo de representante. Em branco = sem padrão (nada é presumido). */
export function CommissionDefaultsForm({ initial }: { initial: Record<string, number | null> }) {
  const [values, setValues] = useState<Values>(() => Object.fromEntries(
    TYPES.map(([type]) => [type, initial[type] === null || initial[type] === undefined ? "" : String(initial[type]! / 100)])
  ) as Values);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const body = Object.fromEntries(TYPES.map(([type]) => [type, values[type] === "" ? null : Number(values[type])]));
    const response = await fetch("/api/admin/commission-defaults", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    setMessage(response.ok ? "Comissões padrão salvas. Valem para as próximas vendas confirmadas." : data.error || "Não foi possível salvar.");
  }

  return (
    <form onSubmit={save} className="card mb-6 space-y-3 p-5">
      <div>
        <h2 className="text-sm font-semibold text-gray-800">Comissão padrão por tipo de representante</h2>
        <p className="text-xs text-gray-500">Usada quando o representante não tem percentual próprio registrado. A comissão específica do pedido sempre tem prioridade. Em branco = sem padrão definido.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TYPES.map(([type, label]) => (
          <label key={type} className="text-xs text-gray-600">{label}
            <span className="mt-1 flex items-center gap-1">
              <input className="input-field" type="number" min="0" max="100" step="0.01" placeholder="Sem padrão" value={values[type]}
                onChange={(event) => setValues((current) => ({ ...current, [type]: event.target.value }))} />%
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy}>{busy ? "Salvando..." : "Salvar comissões padrão"}</button>
        {message && <span className="text-xs text-gray-600">{message}</span>}
      </div>
    </form>
  );
}
