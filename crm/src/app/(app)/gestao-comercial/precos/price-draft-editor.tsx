"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PriceGroup, PriceTier } from "@prisma/client";
import { centsToReaisInput, entryKey, parseReaisToCents, tierOrderWarnings } from "@/lib/pricing/price-admin-rules";
import { toDateKey, toTimeKey, zonedDate } from "@/lib/agenda-rules";

const TIERS: Array<[PriceTier, string]> = [["TIER1", "1–49 un."], ["TIER2", "50–99 un."], ["TIER3", "100+ un."]];

export const GROUP_LABELS: Record<PriceGroup, string> = {
  STANDARD: "Vendedores (STANDARD)",
  REPRESENTATIVE: "Representantes (REPRESENTATIVE)",
};

interface Props {
  brand: "MIBRO" | "SINCROFIT";
  priceGroup: PriceGroup;
  draft: { id: string; version: number; entries: Array<{ productId: string; tier: PriceTier; unitPriceCents: number }> } | null;
  /** Preços vigentes, para destacar o que mudou no rascunho. */
  currentPrices: Record<string, Partial<Record<PriceTier, number>>>;
  products: Array<{ id: string; name: string; active: boolean }>;
}

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

/** Rascunho de tabela: editar valores, publicar com motivo/vigência ou descartar. */
export function PriceDraftEditor({ brand, priceGroup, draft, currentPrices, products }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const e of draft?.entries ?? []) initial[entryKey(e.productId, e.tier)] = centsToReaisInput(e.unitPriceCents);
    return initial;
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const now = new Date();
  const [dateKey, setDateKey] = useState("");
  const [timeKey, setTimeKey] = useState("00:00");
  const [busy, setBusy] = useState<null | "open" | "save" | "publish" | "discard">(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const parsed = useMemo(() => {
    const entries: Array<{ productId: string; tier: PriceTier; unitPriceCents: number | null }> = [];
    const errors: Record<string, string> = {};
    for (const p of products) {
      for (const [tier] of TIERS) {
        const key = entryKey(p.id, tier);
        const cents = parseReaisToCents(values[key] ?? "");
        if (Number.isNaN(cents)) errors[key] = "Valor inválido (ex.: 278,00).";
        else if (cents === 0) errors[key] = "Informe um valor maior que zero.";
        entries.push({ productId: p.id, tier, unitPriceCents: Number.isNaN(cents) ? null : cents });
      }
    }
    return { entries, errors };
  }, [values, products]);

  const warnings = useMemo(
    () => tierOrderWarnings(parsed.entries, new Map(products.map((p) => [p.id, p.name]))),
    [parsed.entries, products]
  );

  async function openDraft() {
    setBusy("open");
    const { ok, data } = await send("/api/commercial/price-tables", "POST", { brand, priceGroup });
    setBusy(null);
    if (!ok) return setMessage({ tone: "error", text: data.error || "Não foi possível abrir o rascunho." });
    router.refresh();
  }

  async function save(): Promise<boolean> {
    if (!draft) return false;
    if (Object.keys(parsed.errors).length > 0) {
      setFieldErrors(parsed.errors);
      setMessage({ tone: "error", text: "Revise os valores destacados." });
      return false;
    }
    const { ok, data } = await send(`/api/commercial/price-tables/${draft.id}/entries`, "PUT", { entries: parsed.entries });
    if (!ok) {
      setFieldErrors(data.fieldErrors || {});
      setMessage({ tone: "error", text: data.error || "Não foi possível salvar." });
      return false;
    }
    setFieldErrors({});
    return true;
  }

  async function onSave() {
    setBusy("save");
    setMessage(null);
    const ok = await save();
    setBusy(null);
    if (ok) {
      setMessage({ tone: "ok", text: "Rascunho salvo. Os preços só passam a valer após publicar." });
      router.refresh();
    }
  }

  async function onPublish() {
    if (!draft) return;
    setBusy("publish");
    setMessage(null);
    if (!(await save())) return setBusy(null);
    const effectiveFrom = dateKey ? zonedDate(dateKey, timeKey || "00:00").toISOString() : null;
    const { ok, data } = await send(`/api/commercial/price-tables/${draft.id}/publish`, "POST", { reason, effectiveFrom });
    setBusy(null);
    if (!ok) {
      setFieldErrors(data.fieldErrors || {});
      return setMessage({ tone: "error", text: data.error || "Não foi possível publicar." });
    }
    setMessage({ tone: "ok", text: `Versão ${data.version} publicada (${data.changes} preço(s) alterado(s)).` });
    router.refresh();
  }

  async function onDiscard() {
    if (!draft) return;
    setBusy("discard");
    const { ok, data } = await send(`/api/commercial/price-tables/${draft.id}/archive`, "POST", { reason: "Rascunho descartado" });
    setBusy(null);
    if (!ok) return setMessage({ tone: "error", text: data.error || "Não foi possível descartar." });
    router.refresh();
  }

  if (!draft) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" onClick={openDraft} disabled={busy !== null}>
          {busy === "open" ? "Abrindo..." : "Editar preços"}
        </button>
        <span className="text-xs text-gray-500">Cria um rascunho a partir da versão atual. Nada muda até publicar.</span>
        {message && <span className="text-xs text-red-600">{message.text}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-amber-300 bg-amber-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800">Rascunho — versão {draft.version}</p>
        <span className="badge bg-amber-100 text-amber-800">Não publicado</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="py-1 pr-2 font-medium">Produto</th>
              {TIERS.map(([tier, label]) => <th key={tier} className="py-1 pr-2 font-medium">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t border-gray-200 align-top">
                <td className="py-2 pr-2">
                  <span className={p.active ? "text-gray-800" : "text-gray-400 line-through"}>{p.name}</span>
                </td>
                {TIERS.map(([tier]) => {
                  const key = entryKey(p.id, tier);
                  const current = currentPrices[p.id]?.[tier];
                  const draftCents = parseReaisToCents(values[key] ?? "");
                  const changed = !Number.isNaN(draftCents) && (draftCents ?? undefined) !== current;
                  const error = fieldErrors[key];
                  return (
                    <td key={tier} className="py-2 pr-2">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-400">R$</span>
                        <input
                          aria-label={`${p.name} ${tier}`}
                          inputMode="decimal"
                          className={`input-field w-28 ${error ? "input-field-error" : changed ? "border-amber-500" : ""}`}
                          placeholder="sem preço"
                          value={values[key] ?? ""}
                          onChange={(event) => setValues((v) => ({ ...v, [key]: event.target.value }))}
                        />
                      </div>
                      {error ? (
                        <p className="mt-1 text-xs text-red-600">{error}</p>
                      ) : changed ? (
                        <p className="mt-1 text-xs text-amber-700">antes: {current ? `R$ ${centsToReaisInput(current)}` : "sem preço"}</p>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {warnings.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-amber-700">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="text-xs text-gray-600">
          Motivo da alteração (obrigatório para publicar)
          <input className={`input-field mt-1 ${fieldErrors.reason ? "input-field-error" : ""}`} value={reason} maxLength={500}
            placeholder="Ex.: Reajuste do catálogo de novembro" onChange={(e) => setReason(e.target.value)} />
          {fieldErrors.reason && <span className="mt-1 block text-red-600">{fieldErrors.reason}</span>}
        </label>
        <label className="text-xs text-gray-600">
          Início da vigência (vazio = agora)
          <input type="date" className={`input-field mt-1 ${fieldErrors.effectiveFrom ? "input-field-error" : ""}`} value={dateKey}
            min={toDateKey(now)} onChange={(e) => setDateKey(e.target.value)} />
        </label>
        <label className="text-xs text-gray-600">
          Horário
          <input type="time" className="input-field mt-1" value={timeKey} disabled={!dateKey}
            onChange={(e) => setTimeKey(e.target.value)} placeholder={toTimeKey(now)} />
        </label>
      </div>
      {fieldErrors.effectiveFrom && <p className="text-xs text-red-600">{fieldErrors.effectiveFrom}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={onSave} disabled={busy !== null}>
          {busy === "save" ? "Salvando..." : "Salvar rascunho"}
        </button>
        <button type="button" className="btn-primary" onClick={onPublish} disabled={busy !== null}>
          {busy === "publish" ? "Publicando..." : dateKey ? "Agendar publicação" : "Publicar agora"}
        </button>
        <button type="button" className="text-sm text-red-600 hover:underline disabled:opacity-50" onClick={onDiscard} disabled={busy !== null}>
          Descartar rascunho
        </button>
        {message && <span className={`text-xs ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</span>}
      </div>
      <p className="text-xs text-gray-500">
        Propostas já emitidas mantêm os preços com que foram calculadas. Faixa sem preço fica indisponível na cotação.
      </p>
    </div>
  );
}

/** Cancela uma publicação agendada que ainda não entrou em vigor. */
export function CancelScheduledButton({ tableId }: { tableId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="text-xs text-red-600 hover:underline disabled:opacity-50" disabled={busy}
        onClick={async () => {
          setBusy(true);
          const { ok, data } = await send(`/api/commercial/price-tables/${tableId}/archive`, "POST", { reason: "Agendamento cancelado" });
          setBusy(false);
          if (!ok) return setError(data.error || "Falha ao cancelar.");
          router.refresh();
        }}>
        {busy ? "Cancelando..." : "Cancelar agendamento"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
