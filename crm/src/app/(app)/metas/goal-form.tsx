"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type GoalType = "REVENUE" | "SALES_COUNT";
type PeriodPreset = "7" | "15" | "30" | "custom";

export function GoalForm({ sellers }: { sellers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [sellerId, setSellerId] = useState("");
  const [type, setType] = useState<GoalType>("REVENUE");
  const [targetValue, setTargetValue] = useState("");
  const [targetCount, setTargetCount] = useState("");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("30");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!sellerId) {
      setError("Selecione um vendedor.");
      return;
    }

    const body: Record<string, unknown> = { sellerId, type, periodPreset };

    if (type === "REVENUE") {
      const cents = Math.round(Number(targetValue.replace(",", ".")) * 100);
      if (!cents || cents <= 0) {
        setError("Informe um valor de meta válido.");
        return;
      }
      body.targetValueCents = cents;
    } else {
      const count = Number(targetCount);
      if (!count || count <= 0) {
        setError("Informe uma quantidade de vendas válida.");
        return;
      }
      body.targetSalesCount = count;
    }

    if (periodPreset === "custom") {
      if (!startDate || !endDate) {
        setError("Informe data inicial e final.");
        return;
      }
      body.startDate = new Date(`${startDate}T00:00:00`).toISOString();
      body.endDate = new Date(`${endDate}T23:59:59`).toISOString();
    }

    setLoading(true);
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Erro ao criar meta.");
      return;
    }

    setSellerId("");
    setTargetValue("");
    setTargetCount("");
    setStartDate("");
    setEndDate("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <select className="input-field" value={sellerId} onChange={(e) => setSellerId(e.target.value)} required>
        <option value="">Selecione o vendedor</option>
        {sellers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <select className="input-field" value={type} onChange={(e) => setType(e.target.value as GoalType)}>
        <option value="REVENUE">Meta por valor (R$)</option>
        <option value="SALES_COUNT">Meta por quantidade de vendas</option>
      </select>

      {type === "REVENUE" ? (
        <input
          className="input-field"
          placeholder="Valor da meta, ex.: 50000"
          inputMode="decimal"
          value={targetValue}
          onChange={(e) => setTargetValue(e.target.value)}
          required
        />
      ) : (
        <input
          className="input-field"
          placeholder="Quantidade de vendas, ex.: 20"
          type="number"
          min={1}
          value={targetCount}
          onChange={(e) => setTargetCount(e.target.value)}
          required
        />
      )}

      <select
        className="input-field"
        value={periodPreset}
        onChange={(e) => setPeriodPreset(e.target.value as PeriodPreset)}
      >
        <option value="7">7 dias</option>
        <option value="15">15 dias</option>
        <option value="30">30 dias</option>
        <option value="custom">Período personalizado</option>
      </select>

      {periodPreset === "custom" && (
        <>
          <input
            className="input-field"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
          <input
            className="input-field"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </>
      )}

      {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      <button type="submit" className="btn-primary sm:col-span-2" disabled={loading}>
        {loading ? "Criando..." : "Criar meta"}
      </button>
    </form>
  );
}
