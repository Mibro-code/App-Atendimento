"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Comissão específica do pedido (tem prioridade sobre a padrão). */
export function SaleCommissionEditor({ saleId, currentPercent, isCustom }: { saleId: string; currentPercent: number | null; isCustom: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentPercent === null ? "" : String(currentPercent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(percent: number | null) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/sales/${saleId}/commission`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ percent }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(body.error || "Não foi possível salvar.");
    setOpen(false);
    router.refresh();
  }

  if (!open) return <button type="button" className="text-xs text-brand hover:underline" onClick={() => setOpen(true)}>{isCustom ? "Alterar % do pedido" : "Definir % do pedido"}</button>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <input aria-label="Percentual de comissão do pedido" className="input-field w-20 py-1 text-xs" type="number" min="0" max="100" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} />
      <span className="text-xs">%</span>
      <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={busy || value === ""} onClick={() => save(Number(value))}>Salvar</button>
      {isCustom && <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => save(null)}>Usar padrão</button>}
      <button type="button" className="text-xs underline" onClick={() => setOpen(false)}>Cancelar</button>
      {error && <span className="w-full text-xs text-red-600">{error}</span>}
    </div>
  );
}
