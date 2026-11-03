"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GoalRowActions({ id, type }: { id: string; type: "REVENUE" | "SALES_COUNT" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function editTarget() {
    const label = type === "REVENUE" ? "Novo valor da meta (R$)" : "Nova quantidade de vendas";
    const raw = window.prompt(label);
    if (!raw) return;

    const body: Record<string, unknown> = {};
    if (type === "REVENUE") {
      const cents = Math.round(Number(raw.replace(",", ".")) * 100);
      if (!cents || cents <= 0) return;
      body.targetValueCents = cents;
    } else {
      const count = Number(raw);
      if (!count || count <= 0) return;
      body.targetSalesCount = count;
    }

    setLoading(true);
    await fetch(`/api/goals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setLoading(false);
    router.refresh();
  }

  async function cancelGoal() {
    if (!window.confirm("Cancelar esta meta?")) return;
    setLoading(true);
    await fetch(`/api/goals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="flex gap-2 shrink-0">
      <button className="btn-secondary text-xs" onClick={editTarget} disabled={loading}>
        Editar
      </button>
      <button className="text-xs text-red-600 hover:underline" onClick={cancelGoal} disabled={loading}>
        Cancelar
      </button>
    </div>
  );
}
