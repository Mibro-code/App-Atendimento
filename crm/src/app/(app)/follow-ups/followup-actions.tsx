"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function FollowUpActions({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function complete() {
    setLoading(true);
    await fetch(`/api/followups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "COMPLETE" }),
    });
    setLoading(false);
    router.refresh();
  }

  async function postpone() {
    const days = window.prompt("Adiar por quantos dias?", "7");
    if (!days) return;
    const newDueAt = new Date();
    newDueAt.setDate(newDueAt.getDate() + Number(days));
    setLoading(true);
    await fetch(`/api/followups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "POSTPONE", newDueAt: newDueAt.toISOString() }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="flex gap-2 shrink-0">
      <button className="btn-secondary text-xs" onClick={postpone} disabled={loading}>
        Adiar
      </button>
      <button className="btn-primary text-xs" onClick={complete} disabled={loading}>
        Contato realizado
      </button>
    </div>
  );
}
