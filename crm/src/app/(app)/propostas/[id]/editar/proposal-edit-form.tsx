"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FREIGHT_LABELS } from "./freight-labels";
import { withProposalOrigin } from "@/lib/proposal-origin";

type Tier = "AUTO" | "TIER1" | "TIER2" | "TIER3";

interface Option {
  sku: string;
  label: string;
  prices: Partial<Record<"TIER1" | "TIER2" | "TIER3", number>>;
}

interface Initial {
  items: Array<{ sku: string; quantity: number }>;
  requestedTier: Tier;
  discountCents: number;
  freightCents: number;
  freightResponsibility: string | null;
  paymentType: string;
  paymentCondition: string | null;
  paymentText: string | null;
  validityDays: number | null;
  deliveryTerm: string | null;
  customerNotes: string | null;
  internalNotes: string | null;
  discountJustification: string | null;
}

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const toCents = (value: string) => {
  const n = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};
const fromCents = (cents: number) => (cents ? (cents / 100).toFixed(2).replace(".", ",") : "");

/** Prévia aproximada: o valor oficial é sempre recalculado no servidor. */
function autoTier(total: number): "TIER1" | "TIER2" | "TIER3" {
  return total >= 100 ? "TIER3" : total >= 50 ? "TIER2" : "TIER1";
}

export function ProposalEditForm(props: { proposalId: string; brand: "MIBRO" | "SINCROFIT"; expectedVersion: number; options: Option[]; initial: Initial; originConversationId?: string }) {
  const router = useRouter();
  const i = props.initial;
  const [items, setItems] = useState(i.items.map((x) => ({ ...x, quantity: String(x.quantity) })));
  const [tier, setTier] = useState<Tier>(i.requestedTier);
  const [discount, setDiscount] = useState(fromCents(i.discountCents));
  const [freight, setFreight] = useState(fromCents(i.freightCents));
  const [f, setF] = useState({
    freightResponsibility: i.freightResponsibility ?? "",
    paymentType: i.paymentType,
    paymentCondition: i.paymentCondition ?? "",
    paymentText: i.paymentText ?? "",
    validityDays: i.validityDays ? String(i.validityDays) : "7",
    deliveryTerm: i.deliveryTerm ?? "",
    customerNotes: i.customerNotes ?? "",
    internalNotes: i.internalNotes ?? "",
    discountJustification: i.discountJustification ?? "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const bySku = useMemo(() => new Map(props.options.map((o) => [o.sku, o])), [props.options]);
  const brandBtn = props.brand === "MIBRO" ? "btn-brand-mibro" : "btn-brand-sincrofit";

  const totalQty = items.reduce((t, x) => t + (Number(x.quantity) || 0), 0);
  const effectiveTier = tier === "AUTO" ? autoTier(totalQty) : tier;
  const estimate = items.reduce((t, x) => t + (bySku.get(x.sku)?.prices[effectiveTier] ?? 0) * (Number(x.quantity) || 0), 0);

  async function submit() {
    if (typeof navigator !== "undefined" && !navigator.onLine) return setError("Sem conexão. A nova versão só é registrada com confirmação do servidor.");
    const discountCents = discount ? toCents(discount) : 0;
    const freightCents = freight ? toCents(freight) : 0;
    if (Number.isNaN(discountCents) || Number.isNaN(freightCents)) return setError("Valores inválidos em desconto ou frete.");
    const parsedItems = items.filter((x) => x.sku).map((x) => ({ sku: x.sku, quantity: Number(x.quantity) }));
    if (parsedItems.length === 0 || parsedItems.some((x) => !Number.isInteger(x.quantity) || x.quantity < 1)) return setError("Revise produtos e quantidades.");
    if (new Set(parsedItems.map((x) => x.sku)).size !== parsedItems.length) return setError("Há produtos repetidos.");
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const response = await fetch(`/api/proposals/${props.proposalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: props.expectedVersion,
        items: parsedItems,
        requestedTier: tier,
        discountCents,
        freightCents,
        freightResponsibility: f.freightResponsibility || null,
        paymentType: f.paymentType,
        paymentCondition: f.paymentType === "Parcelas" ? f.paymentCondition || null : null,
        paymentText: f.paymentType === "Texto livre" ? f.paymentText || null : null,
        validityDays: f.validityDays ? Number(f.validityDays) : null,
        deliveryTerm: f.deliveryTerm || null,
        customerNotes: f.customerNotes || null,
        internalNotes: f.internalNotes || null,
        discountJustification: f.discountJustification || null,
        reason: f.reason || null,
      }),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response) return setError("Sem conexão com o servidor. Nada foi alterado.");
    if (!response.ok) {
      setFieldErrors(data.fieldErrors ?? {});
      return setError(data.error ?? "Não foi possível salvar.");
    }
    const query = data.syncError ? `?aviso=${encodeURIComponent(data.syncError)}` : "";
    router.push(withProposalOrigin(`/propostas/${props.proposalId}${query}`,props.originConversationId));
    router.refresh();
  }

  const err = (k: string) => (fieldErrors[k] ? <span className="block text-[11px] text-red-600">{fieldErrors[k]}</span> : null);

  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-gray-700">Produtos</h2>
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-[1fr_90px_auto] items-end gap-2">
            <label className="text-xs text-gray-600">Produto
              <select className="input-field mt-1" value={item.sku} onChange={(e) => setItems((s) => s.map((x, j) => (j === index ? { ...x, sku: e.target.value } : x)))}>
                <option value="">Selecione</option>
                {props.options.map((o) => <option key={o.sku} value={o.sku}>{o.label} ({o.sku})</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">Qtd.
              <input inputMode="numeric" className="input-field mt-1" value={item.quantity} onChange={(e) => setItems((s) => s.map((x, j) => (j === index ? { ...x, quantity: e.target.value.replace(/\D/g, "") } : x)))} />
            </label>
            <button type="button" className="btn-secondary" aria-label="Remover produto" disabled={items.length === 1} onClick={() => setItems((s) => s.filter((_, j) => j !== index))}>Remover</button>
          </div>
        ))}
        {err("items")}
        <button type="button" className="btn-secondary" onClick={() => setItems((s) => [...s, { sku: "", quantity: "1" }])}>Adicionar produto</button>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs text-gray-600">Faixa de preço
            <select className="input-field mt-1" value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
              <option value="AUTO">Automática pela quantidade</option>
              <option value="TIER1">Tabela 1 (manual)</option>
              <option value="TIER2">Tabela 2 (manual)</option>
              <option value="TIER3">Tabela 3 (manual)</option>
            </select>
          </label>
          <label className="text-xs text-gray-600">Desconto (R$)<input inputMode="decimal" className="input-field mt-1" value={discount} onChange={(e) => setDiscount(e.target.value)} />{err("discountCents")}</label>
          <div className="text-xs text-gray-600">Prévia do subtotal<p className="mt-2 text-sm font-semibold text-gray-900">{estimate ? brl(estimate) : "—"}</p><p className="text-[11px] text-gray-500">Estimativa; o servidor recalcula.</p></div>
        </div>
        <label className="block text-xs text-gray-600">Justificativa do desconto (obrigatória acima do seu limite)
          <textarea className="input-field mt-1" rows={2} value={f.discountJustification} onChange={set("discountJustification")} />
        </label>
      </section>

      <section className="card grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
        <h2 className="text-sm font-semibold text-gray-700 sm:col-span-2">Condições comerciais</h2>
        <label className="text-xs text-gray-600">Pagamento
          <select className="input-field mt-1" value={f.paymentType} onChange={set("paymentType")}>
            <option value="Nenhuma">Não informar</option>
            <option value="Parcelas">Parcelas</option>
            <option value="Texto livre">Texto livre</option>
          </select>
        </label>
        {f.paymentType === "Parcelas" && <label className="text-xs text-gray-600">Condição (ex.: 30 60 90, 3x, 30+2x)<input className="input-field mt-1" value={f.paymentCondition} onChange={set("paymentCondition")} />{err("paymentCondition")}</label>}
        {f.paymentType === "Texto livre" && <label className="text-xs text-gray-600">Condição de pagamento<input className="input-field mt-1" value={f.paymentText} onChange={set("paymentText")} /></label>}
        <label className="text-xs text-gray-600">Frete (R$)<input inputMode="decimal" className="input-field mt-1" value={freight} onChange={(e) => setFreight(e.target.value)} /></label>
        <label className="text-xs text-gray-600">Frete por conta
          <select className="input-field mt-1" value={f.freightResponsibility} onChange={set("freightResponsibility")}>
            <option value="">Não informar</option>
            {Object.entries(FREIGHT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">Prazo de entrega<input className="input-field mt-1" value={f.deliveryTerm} onChange={set("deliveryTerm")} /></label>
        <label className="text-xs text-gray-600">Validade (dias)<input inputMode="numeric" className="input-field mt-1" value={f.validityDays} onChange={(e) => setF((s) => ({ ...s, validityDays: e.target.value.replace(/\D/g, "") }))} />{err("validityDays")}</label>
        <label className="text-xs text-gray-600 sm:col-span-2">Observações visíveis ao cliente<textarea className="input-field mt-1" rows={2} value={f.customerNotes} onChange={set("customerNotes")} /></label>
        <label className="text-xs text-gray-600 sm:col-span-2">Observações internas (não vão ao Olist)<textarea className="input-field mt-1" rows={2} value={f.internalNotes} onChange={set("internalNotes")} /></label>
        <label className="text-xs text-gray-600 sm:col-span-2">Motivo da alteração<input className="input-field mt-1" value={f.reason} onChange={set("reason")} placeholder="Ex.: cliente pediu mais 10 unidades" /></label>
      </section>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={brandBtn} disabled={busy} onClick={submit}>{busy ? "Salvando e sincronizando..." : "Salvar nova versão"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => router.back()}>Cancelar</button>
      </div>
    </div>
  );
}
