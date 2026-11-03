"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCombobox, type UserOption } from "@/components/user-combobox";

export function CustomerTransferForm({
  customerId,
  targets,
}: {
  customerId: string;
  targets: UserOption[];
}) {
  const router = useRouter();
  const [targetSellerId, setTargetSellerId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function transfer() {
    if (!targetSellerId) return;
    setLoading(true);
    setMessage(null);
    const response = await fetch(`/api/customers/${customerId}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetSellerId, reason: reason || null }),
    });
    const body = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setMessage(body.error || "Não foi possível repassar o cliente.");
      return;
    }
    setMessage("Cliente repassado com sucesso.");
    setTargetSellerId("");
    setReason("");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <UserCombobox options={targets} value={targetSellerId} onChange={(id) => setTargetSellerId(id)} placeholder="Novo responsável (nome, RCA ou região)" ariaLabel="Novo responsável" />
      {targets.some((target) => target.regionScore) && <p className="text-xs text-gray-500">Quem atende a cidade/UF do cliente aparece primeiro.</p>}
      <input
        className="input-field"
        maxLength={500}
        placeholder="Motivo do repasse (opcional)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {message && <p className="text-xs text-gray-500">{message}</p>}
      <button className="btn-secondary w-full" onClick={transfer} disabled={loading || !targetSellerId}>
        {loading ? "Repassando..." : "Repassar cliente"}
      </button>
    </div>
  );
}
