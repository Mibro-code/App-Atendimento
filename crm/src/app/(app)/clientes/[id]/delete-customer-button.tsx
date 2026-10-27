"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteCustomerButton({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteCustomer() {
    const confirmed = window.confirm(
      `Excluir definitivamente o cliente "${customerName}"?\n\n` +
        "Atividades, follow-ups, cotações, pedidos e vendas vinculados também serão removidos do CRM. Esta ação não pode ser desfeita."
    );
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/customers/${customerId}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error || "Não foi possível excluir o cliente.");
        return;
      }

      router.push("/clientes");
      router.refresh();
    } catch {
      setError("Erro de conexão ao excluir o cliente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="w-full rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={deleteCustomer}
        disabled={loading}
      >
        {loading ? "Excluindo..." : "Excluir cliente"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
