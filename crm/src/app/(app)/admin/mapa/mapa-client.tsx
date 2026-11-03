"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { formatCentsToBRL } from "@/lib/format";
import { QUOTE_STATUS_LABELS, PROPOSAL_MODE_LABELS } from "@/lib/labels";
import type { LocationCapturesResponse, SellerOption } from "./types";

const LOCATION_SOURCE_OPTIONS = [
  { value: "PROPOSAL_STARTED", label: "Início de proposta" },
  { value: "PROPOSAL_SENT", label: "Envio de proposta" },
  { value: "CUSTOMER_VISIT", label: "Visita presencial" },
] as const;

const MapView = dynamic(() => import("./map-view"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-sm text-gray-400">Carregando mapa...</div>
  ),
});

type PeriodPreset = "hoje" | "semana" | "mes" | "personalizado";

function computePeriod(preset: PeriodPreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  if (preset === "hoje") {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  if (preset === "semana") {
    const from = new Date(now);
    from.setDate(now.getDate() - 6);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  if (preset === "personalizado" && customFrom && customTo) {
    const from = new Date(customFrom);
    const to = new Date(customTo);
    to.setHours(23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  // mês corrente (padrão)
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function MapaClient() {
  const [preset, setPreset] = useState<PeriodPreset>("mes");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [q, setQ] = useState("");
  const [quoteStatus, setQuoteStatus] = useState("");
  const [saleConfirmed, setSaleConfirmed] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [mode, setMode] = useState("");
  const [locationSource, setLocationSource] = useState("");

  const [data, setData] = useState<LocationCapturesResponse | null>(null);
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const period = useMemo(() => computePeriod(preset, customFrom, customTo), [preset, customFrom, customTo]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set("from", period.from);
      params.set("to", period.to);
      if (sellerId) params.set("sellerId", sellerId);
      if (q.trim()) params.set("q", q.trim());
      if (quoteStatus) params.set("quoteStatus", quoteStatus);
      if (saleConfirmed) params.set("saleConfirmed", saleConfirmed);
      if (minValue) params.set("minValueCents", String(Math.round(parseFloat(minValue) * 100)));
      if (maxValue) params.set("maxValueCents", String(Math.round(parseFloat(maxValue) * 100)));
      if (mode) params.set("mode", mode);
      if (locationSource) params.set("locationSource", locationSource);

      try {
        const res = await fetch(`/api/admin/location-captures?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setError("Não foi possível carregar os dados do mapa.");
          setLoading(false);
          return;
        }
        const body: LocationCapturesResponse = await res.json();
        setData(body);
        setSellers(body.sellers);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Erro de conexão ao carregar o mapa.");
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [period.from, period.to, sellerId, q, quoteStatus, saleConfirmed, minValue, maxValue, mode, locationSource]);

  const metrics = data?.metrics;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Mapa comercial</h1>
        <p className="text-sm text-gray-500">
          Visitas e interações registradas em campo pela equipe, com localização aproximada.
        </p>
      </div>

      {/* Filtros */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(["hoje", "semana", "mes", "personalizado"] as PeriodPreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                preset === p ? "bg-brand text-white border-brand" : "bg-white text-gray-600 border-gray-200"
              }`}
            >
              {{ hoje: "Hoje", semana: "Últimos 7 dias", mes: "Mês atual", personalizado: "Personalizado" }[p]}
            </button>
          ))}
        </div>

        {preset === "personalizado" && (
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="label-field">De</label>
              <input
                type="date"
                className="input-field"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="label-field">Até</label>
              <input
                type="date"
                className="input-field"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label-field">Vendedor</label>
            <select className="input-field" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
              <option value="">Todos</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field">Cliente</label>
            <input
              className="input-field"
              placeholder="Buscar por nome..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div>
            <label className="label-field">Status da proposta</label>
            <select className="input-field" value={quoteStatus} onChange={(e) => setQuoteStatus(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(QUOTE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field">Venda</label>
            <select
              className="input-field"
              value={saleConfirmed}
              onChange={(e) => setSaleConfirmed(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="true">Venda realizada</option>
              <option value="false">Sem venda confirmada</option>
            </select>
          </div>
          <div>
            <label className="label-field">Tipo da proposta</label>
            <select className="input-field" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(PROPOSAL_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field">Origem da localização</label>
            <select
              className="input-field"
              value={locationSource}
              onChange={(e) => setLocationSource(e.target.value)}
            >
              <option value="">Todas</option>
              {LOCATION_SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-field">Valor mínimo (R$)</label>
            <input
              type="number"
              min="0"
              className="input-field"
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
            />
          </div>
          <div>
            <label className="label-field">Valor máximo (R$)</label>
            <input
              type="number"
              min="0"
              className="input-field"
              value={maxValue}
              onChange={(e) => setMaxValue(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500">Visitas presenciais no período</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{metrics?.presencialCount ?? "-"}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Vendedores com atividade registrada</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{metrics?.activeSellersCount ?? "-"}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Cidades atendidas</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{metrics?.citiesAttended ?? "-"}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">Valor proposto por região (UF)</p>
          <ul className="space-y-1 text-sm">
            {(metrics?.proposedByState ?? []).slice(0, 8).map((r) => (
              <li key={r.state} className="flex justify-between text-gray-700">
                <span>{r.state}</span>
                <span className="font-medium">{formatCentsToBRL(r.valueCents)}</span>
              </li>
            ))}
            {metrics && metrics.proposedByState.length === 0 && (
              <li className="text-gray-400">Nenhuma proposta no período.</li>
            )}
          </ul>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">Valor vendido por região (UF)</p>
          <ul className="space-y-1 text-sm">
            {(metrics?.soldByState ?? []).slice(0, 8).map((r) => (
              <li key={r.state} className="flex justify-between text-gray-700">
                <span>{r.state}</span>
                <span className="font-medium">{formatCentsToBRL(r.valueCents)}</span>
              </li>
            ))}
            {metrics && metrics.soldByState.length === 0 && (
              <li className="text-gray-400">Nenhuma venda confirmada no período.</li>
            )}
          </ul>
        </div>
      </div>

      {/* Mapa */}
      <div className="card p-2 h-[480px]">
        {error ? (
          <p className="p-4 text-sm text-red-600">{error}</p>
        ) : loading && !data ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">Carregando...</div>
        ) : (
          <MapView points={data?.points ?? []} />
        )}
      </div>

      <p className="text-xs text-gray-400">
        As localizações mostradas aqui são o local onde o vendedor registrou a visita ou interação pelo
        aplicativo (com o celular/navegador dele) — não é o endereço confirmado da loja do cliente.
        &ldquo;Cidade atendida&rdquo; usa a cidade cadastrada no cadastro do cliente, não a coordenada exata do
        marcador.
      </p>
    </div>
  );
}
