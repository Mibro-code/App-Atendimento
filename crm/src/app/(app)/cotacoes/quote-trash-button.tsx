"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function QuoteTrashButton({ id, restore = false }: { id: string; restore?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!window.confirm(restore ? "Restaurar esta simulação?" : "Excluir esta simulação? Admin/Master manterá o histórico e poderá restaurá-la em até 7 dias.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/quotes/${id}`, {
        method: restore ? "PATCH" : "DELETE", headers: { "Content-Type": "application/json" },
        ...(restore ? { body: JSON.stringify({ action: "RESTORE" }) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar.");
      if (!restore) router.push("/cotacoes");
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Falha ao salvar."); }
    finally { setBusy(false); }
  }
  return <div><button type="button" className="btn-secondary text-xs" disabled={busy} onClick={submit}>{busy ? "Salvando…" : restore ? "Restaurar simulação" : "Excluir simulação"}</button>{error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}</div>;
}
