"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteUserButton({ userId, userName }: { userId: string; userName: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm(`Excluir a conta de ${userName}? O acesso será removido, mas o histórico comercial e administrativo será preservado.`)) return;
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/users/${userId}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) return setError(body.error || "Não foi possível excluir a conta.");
    router.push("/admin/vendedores");
    router.refresh();
  }

  return <div className="space-y-2">
    <button type="button" className="btn-secondary border-red-200 text-red-700" disabled={loading} onClick={remove}>{loading ? "Excluindo..." : "Excluir conta"}</button>
    {error && <p className="text-sm text-red-600">{error}</p>}
  </div>;
}
