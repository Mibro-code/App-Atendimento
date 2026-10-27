"use client";

import { useState } from "react";
import { BRAZIL_STATES } from "@/lib/brazil-states";

export interface RepresentativeProfileValue {
  representativeType: "ATACADO" | "VAREJO" | "OUTRO" | null;
  regions: Array<{ state: string; city: string }>;
}

const TYPE_LABELS = { ATACADO: "Atacado", VAREJO: "Varejo", OUTRO: "Outro" } as const;

export function RepresentativeProfileEditor({ userId, initial }: { userId: string; initial: RepresentativeProfileValue }) {
  const [type, setType] = useState(initial.representativeType);
  const [regions, setRegions] = useState(initial.regions);
  const [state, setState] = useState("SP");
  const [city, setCity] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  function add() {
    const next = { state, city: city.trim() };
    if (regions.some((region) => region.state === next.state && region.city.toLowerCase() === next.city.toLowerCase())) return;
    setRegions([...regions, next].sort((a, b) => a.state.localeCompare(b.state) || a.city.localeCompare(b.city, "pt-BR")));
    setCity("");
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const response = await fetch(`/api/users/${userId}/representative`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ representativeType: type, regions }),
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return setMessage(body.error || "Não foi possível salvar.");
    setRegions(body.regions);
    setDirty(false);
    setMessage("Tipo e regiões salvos.");
  }

  const byState = regions.reduce<Record<string, Array<{ state: string; city: string }>>>((acc, region) => {
    (acc[region.state] ??= []).push(region);
    return acc;
  }, {});

  return (
    <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
      <label className="block text-xs text-gray-600">
        Tipo de representante
        <select className="input-field mt-1" value={type ?? ""} onChange={(event) => { setType((event.target.value || null) as RepresentativeProfileValue["representativeType"]); setDirty(true); }}>
          <option value="">Não definido</option>
          {(Object.keys(TYPE_LABELS) as Array<keyof typeof TYPE_LABELS>).map((value) => <option key={value} value={value}>{TYPE_LABELS[value]}</option>)}
        </select>
      </label>
      <div>
        <p className="text-xs text-gray-600">Regiões de atendimento</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <select aria-label="UF da região" className="input-field w-20" value={state} onChange={(event) => setState(event.target.value)}>
            {BRAZIL_STATES.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
          <input aria-label="Cidade da região" className="input-field min-w-0 flex-1" placeholder="Cidade (vazio = estado inteiro)" value={city}
            onChange={(event) => setCity(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
          <button type="button" className="btn-secondary" onClick={add}>Adicionar</button>
        </div>
        <div className="mt-2 space-y-1">
          {Object.entries(byState).map(([uf, items]) => (
            <div key={uf} className="flex flex-wrap items-center gap-1 text-xs">
              <span className="w-8 font-semibold text-gray-700">{uf}</span>
              {items.map((region) => (
                <span key={`${region.state}|${region.city}`} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                  {region.city || "Todo o estado"}
                  <button type="button" aria-label={`Remover ${region.city || "estado"} ${uf}`} className="text-gray-400 hover:text-red-600"
                    onClick={() => { setRegions(regions.filter((item) => item !== region)); setDirty(true); }}>×</button>
                </span>
              ))}
            </div>
          ))}
          {regions.length === 0 && <p className="text-xs text-gray-400">Nenhuma região cadastrada.</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="btn-secondary" disabled={saving || !dirty} onClick={save}>{saving ? "Salvando..." : "Salvar tipo e regiões"}</button>
        {message && <span className="text-xs text-gray-500">{message}</span>}
      </div>
    </div>
  );
}
