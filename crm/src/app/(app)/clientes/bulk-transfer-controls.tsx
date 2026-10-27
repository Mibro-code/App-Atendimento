"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserCombobox, type UserOption } from "@/components/user-combobox";

export function BulkTransferControls({
  targets,
  filters,
  visibleCount,
  totalCount,
}: {
  targets: UserOption[];
  filters: Record<string, string>;
  visibleCount: number;
  totalCount: number;
}) {
  const router = useRouter();
  const [selectedCount, setSelectedCount] = useState(0);
  const [allFiltered, setAllFiltered] = useState(false);
  const [targetSellerId, setTargetSellerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  function boxes() {
    return Array.from(document.querySelectorAll<HTMLInputElement>(".customer-bulk-checkbox"));
  }
  function refreshCount() {
    setSelectedCount(boxes().filter((box) => box.checked).length);
  }
  useEffect(() => {
    const handler = () => setSelectedCount(
      Array.from(document.querySelectorAll<HTMLInputElement>(".customer-bulk-checkbox")).filter((box) => box.checked).length
    );
    document.addEventListener("change", handler);
    return () => document.removeEventListener("change", handler);
  }, []);

  function selectVisible(checked: boolean) {
    boxes().forEach((box) => { box.checked = checked; });
    setAllFiltered(false);
    refreshCount();
  }

  async function submit() {
    const customerIds = boxes().filter((box) => box.checked).map((box) => box.value);
    if (!allFiltered && customerIds.length === 0) return setMessage("Selecione ao menos um cliente.");
    if (!targetSellerId) return setMessage("Escolha o vendedor de destino.");
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/customers/bulk-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: allFiltered ? "filtered" : "selected", customerIds, filters, targetSellerId, reason: "Repasse em massa pela carteira" }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) return setMessage(data.error ?? "Não foi possível realizar o repasse.");
    setMessage(`${data.transferred} cliente(s) transferido(s)${data.skipped ? `; ${data.skipped} já estavam com esse vendedor` : ""}.`);
    selectVisible(false);
    router.refresh();
  }

  if (targets.length === 0 || totalCount === 0) return null;
  return (
    <div className="card mb-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => selectVisible(true)}>Selecionar visíveis ({visibleCount})</button>
        <button type="button" className="btn-secondary" onClick={() => selectVisible(false)}>Limpar seleção</button>
        <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <input type="checkbox" checked={allFiltered} onChange={(event) => setAllFiltered(event.target.checked)} />
          Todos do filtro ({totalCount})
        </label>
        <div className="min-w-52 flex-1">
          <UserCombobox options={targets} value={targetSellerId} onChange={(id) => setTargetSellerId(id)} placeholder="Enviar para... (nome, RCA ou região)" ariaLabel="Vendedor de destino" />
        </div>
        <button type="button" className="btn-primary" disabled={loading || (!allFiltered && selectedCount === 0)} onClick={submit}>
          {loading ? "Transferindo..." : `Repassar ${allFiltered ? totalCount : selectedCount} cliente(s)`}
        </button>
      </div>
      {message && <p className="mt-2 text-sm text-gray-600">{message}</p>}
    </div>
  );
}
