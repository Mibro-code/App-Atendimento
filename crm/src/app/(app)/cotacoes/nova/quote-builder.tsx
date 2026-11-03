"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CommercialBrand, PriceGroup, PriceTier, QuoteStatus } from "@prisma/client";
import { CustomerAutocomplete, type CustomerOption } from "@/components/agenda/customer-autocomplete";
import { formatCentsToBRL } from "@/lib/format";
import { PricingError, TIER_LABELS, priceQuote, tierForQuantity, type LoadedPriceTable } from "@/lib/pricing/pricing-rules";
import { parseReaisToCents } from "@/lib/pricing/price-admin-rules";
import { QUOTE_STEPS, type NativeDraftState } from "@/lib/quotes/native-quote-rules";
import { QuickCustomerForm } from "./quick-customer-form";
import { withProposalOrigin } from '@/lib/proposal-origin';

// Calculadora nativa. O cálculo local é só para resposta instantânea na tela;
// os valores oficiais são os devolvidos pelo servidor a cada salvamento
// (o servidor reprecifica a partir do banco e ignora preços do navegador).

export interface QuoteBuilderInitial {
  quoteId: string | null;
  status: QuoteStatus | null;
  customer: CustomerOption | null;
  brand: CommercialBrand | null;
  draft: NativeDraftState;
  discountText: string;
  couponCode: string;
  notes: string;
}

interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  imageUrl: string | null;
  variants: Array<{ id: string; sku: string; colorName: string }>;
  prices: Partial<Record<PriceTier, number>>;
}

interface Catalog {
  brand: CommercialBrand;
  priceGroup: PriceGroup;
  table: { id: string; version: number; effectiveFrom: string; publishedAt: string | null } | null;
  effectiveVersion: number | null;
  products: CatalogProduct[];
}

interface DisplayLine {
  sku: string;
  productId: string;
  productName: string;
  colorName?: string | null;
  quantity: number;
  automaticTier: PriceTier;
  appliedTier: PriceTier;
  manualTier: boolean;
  unitPriceCents: number;
  lineSubtotalCents: number;
}

interface DisplayPricing {
  priceGroup: PriceGroup;
  priceTableVersion: number;
  orderAutomaticTier: PriceTier;
  totalQuantity: number;
  lines: DisplayLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

const TIERS: PriceTier[] = ["TIER1", "TIER2", "TIER3"];
const SHORT_TIER: Record<PriceTier, string> = { TIER1: "Tabela 1", TIER2: "Tabela 2", TIER3: "Tabela 3" };
const GROUP_LABEL: Record<PriceGroup, string> = {
  STANDARD: "Tabela de vendedores",
  REPRESENTATIVE: "Tabela de representantes",
};

function brandButton(brand: CommercialBrand | null) {
  return brand === "SINCROFIT" ? "btn-brand-sincrofit" : "btn-brand-mibro";
}

export function QuoteBuilder({ initial, originConversationId }: { initial: QuoteBuilderInitial; originConversationId?: string }) {
  const router = useRouter();

  const [customer, setCustomer] = useState<CustomerOption | null>(initial.customer);
  const [brand, setBrand] = useState<CommercialBrand | null>(initial.brand);
  const [step, setStep] = useState(initial.customer ? initial.draft.step : 0);
  const [quantities, setQuantities] = useState<Record<string, number>>(initial.draft.quantities);
  const [requestedTier, setRequestedTier] = useState<PriceTier | "AUTO">(initial.draft.requestedTier);
  const [discountText, setDiscountText] = useState(initial.discountText);
  const [couponCode, setCouponCode] = useState(initial.couponCode);
  const [notes, setNotes] = useState(initial.notes);
  const [search, setSearch] = useState("");
  const [quickRegister, setQuickRegister] = useState(false);
  const [category, setCategory] = useState("");

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogKey, setCatalogKey] = useState(0);

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverPricing, setServerPricing] = useState<DisplayPricing | null>(null);
  const [serverPricingError, setServerPricingError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const quoteIdRef = useRef<string | null>(initial.quoteId);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const revisionRef = useRef(0);
  const firstRunRef = useRef(true);

  // ---------------------------------------------------------------- catálogo
  useEffect(() => {
    if (!brand) {
      setCatalog(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ brand });
    if (customer) params.set("customerId", customer.id);
    if (quoteIdRef.current) params.set("quoteId", quoteIdRef.current);
    setCatalogLoading(true);
    setCatalogError(null);
    fetch(`/api/pricing/catalog?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Não foi possível carregar os produtos.");
        setCatalog(body as Catalog);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setCatalogError(error.message);
      })
      .finally(() => setCatalogLoading(false));
    return () => controller.abort();
  }, [brand, customer, catalogKey]);

  // ---------------------------------------------------------- cálculo local
  const discount = useMemo(() => {
    const cents = parseReaisToCents(discountText);
    return { cents: cents === null || Number.isNaN(cents) ? 0 : cents, invalid: Number.isNaN(cents) };
  }, [discountText]);

  const local = useMemo((): { pricing: DisplayPricing | null; error: string | null; discountError: string | null } => {
    if (!catalog?.table) return { pricing: null, error: null, discountError: null };
    const bySku = new Map(catalog.products.flatMap((p) => p.variants.map((v) => [v.sku, { p, v }] as const)));
    const lines = Object.entries(quantities)
      .filter(([sku, qty]) => qty > 0 && bySku.has(sku))
      .map(([sku, quantity]) => {
        const { p, v } = bySku.get(sku)!;
        return { sku, productId: p.id, productName: p.name, colorName: v.colorName, variantId: v.id, quantity };
      });
    if (lines.length === 0) return { pricing: null, error: null, discountError: null };
    const table: LoadedPriceTable = {
      id: catalog.table.id,
      version: catalog.table.version,
      priceGroup: catalog.priceGroup,
      prices: new Map(catalog.products.map((p) => [p.id, p.prices])),
    };
    const run = (discountCents: number) =>
      priceQuote({
        priceGroup: catalog.priceGroup,
        table,
        lines,
        requestedTier: requestedTier === "AUTO" ? null : requestedTier,
        quantityRule: "MIX",
        discountCents,
      });
    try {
      return { pricing: run(discount.cents), error: null, discountError: null };
    } catch (error) {
      if (error instanceof PricingError && error.code === "INVALID_DISCOUNT") {
        try {
          return { pricing: run(0), error: null, discountError: "O desconto precisa ser menor que o subtotal." };
        } catch (inner) {
          return { pricing: null, error: inner instanceof Error ? inner.message : "Erro no cálculo.", discountError: null };
        }
      }
      return { pricing: null, error: error instanceof Error ? error.message : "Erro no cálculo.", discountError: null };
    }
  }, [catalog, quantities, requestedTier, discount.cents]);

  const discountError = discount.invalid ? "Valor inválido (ex.: 150,00)." : local.discountError ?? fieldErrors.discountCents ?? null;
  const upToDate = saveState === "saved";
  const display = upToDate && serverPricing ? serverPricing : local.pricing;
  const pricingError = upToDate ? serverPricingError : local.error;

  // ------------------------------------------------------------- salvamento
  const buildPayload = useCallback(
    (extra: { finalize?: boolean; useCurrentTable?: boolean } = {}) => ({
      quoteId: quoteIdRef.current,
      customerId: customer?.id ?? "",
      brand,
      draft: { step, quantities, requestedTier, search: search || undefined },
      discountCents: discount.cents,
      couponCode: couponCode || null,
      notes: notes || null,
      ...extra,
    }),
    [customer, brand, step, quantities, requestedTier, search, discount.cents, couponCode, notes]
  );

  const save = useCallback(
    (extra: { finalize?: boolean; useCurrentTable?: boolean } = {}) => {
      const revision = revisionRef.current;
      const payload = buildPayload(extra);
      // Fila: garante uma única criação e ordem dos salvamentos.
      const task = queueRef.current.then(async () => {
        payload.quoteId = quoteIdRef.current;
        setSaveState("saving");
        const response = await fetch("/api/quotes/native", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch(() => null);
        const body = response ? await response.json().catch(() => ({})) : {};
        if (!response || !response.ok) {
          setSaveState("error");
          setSaveError(response ? body.error || "Não foi possível salvar." : "Sem conexão. Tentaremos de novo na próxima alteração.");
          setFieldErrors(body.fieldErrors || {});
          return { ok: false as const, body };
        }
        if (!quoteIdRef.current) {
          quoteIdRef.current = body.quote.id;
          window.history.replaceState(null, "", withProposalOrigin(`/cotacoes/nova?id=${body.quote.id}`,originConversationId));
        }
        if (revision === revisionRef.current) {
          setServerPricing(body.pricing);
          setServerPricingError(body.pricingError?.message ?? null);
          setSaveState("saved");
          setSaveError(null);
          setFieldErrors({});
          setSavedAt(new Date());
        }
        return { ok: true as const, body };
      });
      queueRef.current = task.catch(() => undefined);
      return task;
    },
    [buildPayload,originConversationId]
  );

  // Autosave com espera curta após cada alteração.
  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    revisionRef.current += 1;
    if (!customer || !brand || discount.invalid) {
      setSaveState("idle");
      return;
    }
    setSaveState("pending");
    const timer = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer, brand, step, quantities, requestedTier, discountText, couponCode, notes]);

  async function finalize() {
    if (!customer || !brand) return;
    setFinalizing(true);
    revisionRef.current += 1;
    const result = await save({ finalize: true });
    setFinalizing(false);
    if (result.ok) router.push(withProposalOrigin(`/cotacoes/${result.body.quote.id}`,originConversationId));
  }

  async function useCurrentTable() {
    revisionRef.current += 1;
    const result = await save({ useCurrentTable: true });
    if (result.ok) setCatalogKey((k) => k + 1);
  }

  // ------------------------------------------------------------- navegação
  const maxStep = !customer ? 0 : !brand ? 1 : QUOTE_STEPS.length - 1;
  const goTo = (target: number) => setStep(Math.max(0, Math.min(target, maxStep)));

  function chooseBrand(next: CommercialBrand) {
    if (next !== brand) {
      // SKUs são por marca: trocar de marca limpa os itens.
      setQuantities({});
      setRequestedTier("AUTO");
      setBrand(next);
    }
    setStep(2);
  }

  const setQty = (sku: string, value: number) =>
    setQuantities((current) => ({ ...current, [sku]: Math.max(0, Math.min(100_000, Math.floor(value) || 0)) }));

  const totalQuantity = Object.values(quantities).reduce((sum, q) => sum + (q > 0 ? q : 0), 0);
  const autoTier = tierForQuantity(totalQuantity);
  const appliedByProduct = new Map((display?.lines ?? []).map((l) => [l.productId, l.appliedTier]));

  const categories = useMemo(() => [...new Set((catalog?.products ?? []).map((p) => p.category))], [catalog]);
  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (catalog?.products ?? []).filter(
      (p) =>
        (!category || p.category === category) &&
        (!q || p.name.toLowerCase().includes(q) || p.variants.some((v) => v.colorName.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q)))
    );
  }, [catalog, search, category]);

  // ----------------------------------------------------------------- render
  const summary = (
    <SummaryPanel
      brand={brand}
      customer={customer}
      catalog={catalog}
      display={display}
      pricingError={pricingError}
      requestedTier={requestedTier}
      saveState={saveState}
      savedAt={savedAt}
      saveError={saveError}
      onFinalize={finalize}
      finalizing={finalizing}
      canFinalize={!!customer && !!brand && !!display && !pricingError && !discountError && saveState !== "error"}
      onUseCurrentTable={initial.quoteId ? useCurrentTable : undefined}
    />
  );

  return (
    <div className="grid grid-cols-1 gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_340px] lg:pb-0">
      <div className="min-w-0 space-y-4">
        {/* Etapas */}
        <ol className="flex gap-1 overflow-x-auto text-xs" aria-label="Etapas da cotação">
          {QUOTE_STEPS.map((label, index) => (
            <li key={label} className="shrink-0">
              <button
                type="button"
                onClick={() => goTo(index)}
                disabled={index > maxStep}
                aria-current={index === step ? "step" : undefined}
                className={`rounded-full border px-3 py-1.5 ${
                  index === step
                    ? "border-slate-900 bg-slate-900 text-white"
                    : index <= maxStep
                      ? "border-gray-300 text-gray-700 hover:bg-gray-50"
                      : "border-gray-200 text-gray-300"
                }`}
              >
                {index + 1}. {label}
              </button>
            </li>
          ))}
        </ol>

        {/* 1. Cliente */}
        {step === 0 && (
          <section className="card space-y-3 p-5">
            <h2 className="text-sm font-semibold text-gray-800">Cliente</h2>
            <CustomerAutocomplete value={customer} onChange={setCustomer} invalid={!!fieldErrors.customerId} inputId="quote-customer" />
            {fieldErrors.customerId && <p className="text-xs text-red-600">{fieldErrors.customerId}</p>}
            {quickRegister ? (
              <QuickCustomerForm
                onCreated={(created) => { setCustomer(created); setQuickRegister(false); }}
                onCancel={() => setQuickRegister(false)}
              />
            ) : (
              <p className="text-xs text-gray-500">
                Cliente novo?{" "}
                <button type="button" className="underline" onClick={() => setQuickRegister(true)}>Cadastro rápido</button>
                {" "}ou <Link href="/clientes/novo" className="underline">cadastro completo</Link>.
              </p>
            )}
            <div className="flex justify-end">
              <button type="button" className="btn-primary" disabled={!customer} onClick={() => goTo(brand ? 2 : 1)}>Continuar</button>
            </div>
          </section>
        )}

        {/* 2. Marca */}
        {step === 1 && (
          <section className="card space-y-3 p-5">
            <h2 className="text-sm font-semibold text-gray-800">Marca</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["MIBRO", "SINCROFIT"] as const).map((b) => (
                <button key={b} type="button" onClick={() => chooseBrand(b)}
                  className={`${brandButton(b)} py-4 text-base ${brand === b ? "ring-2 ring-offset-2 ring-slate-400" : ""}`}>
                  {b === "MIBRO" ? "Mibro" : "Sincrofit"}
                </button>
              ))}
            </div>
            {brand && totalQuantity > 0 && <p className="text-xs text-amber-700">Trocar de marca limpa os produtos escolhidos.</p>}
            <div className="flex justify-between">
              <button type="button" className="btn-secondary" onClick={() => goTo(0)}>Voltar</button>
            </div>
          </section>
        )}

        {/* 3. Produtos */}
        {step === 2 && (
          <section className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-800">Produtos {brand === "MIBRO" ? "Mibro" : "Sincrofit"}</h2>
              {catalog && <span className="text-xs text-gray-500">{GROUP_LABEL[catalog.priceGroup]}</span>}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className="input-field" placeholder="Buscar produto, cor ou SKU" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar produto" />
              {categories.length > 1 && (
                <select className="input-field sm:w-48" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">
                  <option value="">Todas as categorias</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>

            {catalogLoading && <p className="text-sm text-gray-500">Carregando produtos...</p>}
            {catalogError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                {catalogError} <button type="button" className="underline" onClick={() => setCatalogKey((k) => k + 1)}>Tentar novamente</button>
              </div>
            )}
            {catalog && !catalog.table && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Não há tabela publicada para esta marca.</p>}

            <div className="space-y-3">
              {visibleProducts.map((p) => {
                const productQty = p.variants.reduce((sum, v) => sum + (quantities[v.sku] ?? 0), 0);
                const applied = appliedByProduct.get(p.id);
                return (
                  <article key={p.id} className={`rounded-lg border p-3 ${productQty > 0 ? "border-slate-400" : "border-gray-200"}`}>
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{p.name}</h3>
                        <p className="text-xs text-gray-500">{p.category}{productQty > 0 && ` · ${productQty} un.`}</p>
                      </div>
                      <div className="flex gap-1" aria-label="Preço por faixa">
                        {TIERS.map((t) => (
                          <span key={t} title={TIER_LABELS[t]}
                            className={`rounded px-2 py-1 text-[11px] ${applied === t ? "bg-slate-900 text-white" : "bg-gray-100 text-gray-600"}`}>
                            {SHORT_TIER[t].replace("Tabela ", "T")}: {p.prices[t] ? formatCentsToBRL(p.prices[t]) : "—"}
                          </span>
                        ))}
                      </div>
                    </div>
                    <ul className="divide-y divide-gray-100">
                      {p.variants.map((v) => (
                        <li key={v.sku} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <span className="text-sm text-gray-700">
                            {v.colorName} <span className="font-mono text-[11px] text-gray-400">{v.sku}</span>
                          </span>
                          <QtyControl value={quantities[v.sku] ?? 0} onChange={(n) => setQty(v.sku, n)} label={`${p.name} ${v.colorName}`} />
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
              {catalog && visibleProducts.length === 0 && <p className="text-sm text-gray-500">Nenhum produto encontrado.</p>}
            </div>
            {pricingError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{pricingError}</p>}
            <div className="flex justify-between">
              <button type="button" className="btn-secondary" onClick={() => goTo(1)}>Voltar</button>
              <button type="button" className="btn-primary" disabled={totalQuantity === 0} onClick={() => goTo(3)}>Continuar</button>
            </div>
          </section>
        )}

        {/* 4. Condições */}
        {step === 3 && (
          <section className="card space-y-4 p-5">
            <h2 className="text-sm font-semibold text-gray-800">Condições comerciais</h2>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-gray-600">Faixa de preço</legend>
              <label className="flex items-start gap-2 rounded-md border border-gray-200 p-3 text-sm">
                <input type="radio" name="tier" checked={requestedTier === "AUTO"} onChange={() => setRequestedTier("AUTO")} />
                <span>
                  <span className="font-medium">Automático</span>
                  <span className="block text-xs text-gray-500">
                    Pela quantidade ({totalQuantity} un.): {autoTier ? TIER_LABELS[autoTier] : "adicione produtos"}
                  </span>
                </span>
              </label>
              {TIERS.map((t) => (
                <label key={t} className="flex items-start gap-2 rounded-md border border-gray-200 p-3 text-sm">
                  <input type="radio" name="tier" checked={requestedTier === t} onChange={() => setRequestedTier(t)} />
                  <span>
                    <span className="font-medium">{TIER_LABELS[t]}</span>
                    <span className="block text-xs text-gray-500">Seleção manual — mantém a {catalog ? GROUP_LABEL[catalog.priceGroup].toLowerCase() : "tabela do vendedor"}.</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {requestedTier !== "AUTO" && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                Faixa manual: {TIER_LABELS[requestedTier]} aplicada a {totalQuantity} un.
                {autoTier && autoTier !== requestedTier && <> (a automática seria {SHORT_TIER[autoTier]})</>}. Fica registrada na proposta.
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs text-gray-600">
                Desconto adicional (R$)
                <input className={`input-field mt-1 ${discountError ? "input-field-error" : ""}`} inputMode="decimal" placeholder="0,00"
                  value={discountText} onChange={(e) => setDiscountText(e.target.value)} />
                {discountError && <span className="mt-1 block text-red-600">{discountError}</span>}
              </label>
              <label className="text-xs text-gray-600">
                Cupom (opcional)
                <input className={`input-field mt-1 ${fieldErrors.couponCode ? "input-field-error" : ""}`} maxLength={40}
                  value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} />
                {fieldErrors.couponCode && <span className="mt-1 block text-red-600">{fieldErrors.couponCode}</span>}
              </label>
            </div>
            <label className="block text-xs text-gray-600">
              Observações
              <textarea className="input-field mt-1" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {pricingError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{pricingError}</p>}
            <div className="flex justify-between">
              <button type="button" className="btn-secondary" onClick={() => goTo(2)}>Voltar</button>
              <button type="button" className="btn-primary" onClick={() => goTo(4)}>Ver resumo</button>
            </div>
          </section>
        )}

        {/* 5. Resumo */}
        {step === 4 && (
          <section className="card space-y-4 p-5">
            <h2 className="text-sm font-semibold text-gray-800">Resumo da cotação</h2>
            {!display && <p className="text-sm text-gray-500">Adicione produtos para ver o resumo.</p>}
            {display && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-xs text-gray-500">
                    <tr>
                      <th className="py-1 font-medium">Produto</th>
                      <th className="py-1 font-medium">Qtd.</th>
                      <th className="py-1 font-medium">Faixa</th>
                      <th className="py-1 text-right font-medium">Unitário</th>
                      <th className="py-1 text-right font-medium">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {display.lines.map((l) => (
                      <tr key={l.sku}>
                        <td className="py-2">{l.productName}<span className="block text-xs text-gray-500">{l.colorName} · {l.sku}</span></td>
                        <td className="py-2">{l.quantity}</td>
                        <td className="py-2 text-xs">{SHORT_TIER[l.appliedTier]}{l.manualTier && <span className="ml-1 text-amber-700">(manual)</span>}</td>
                        <td className="py-2 text-right">{formatCentsToBRL(l.unitPriceCents)}</td>
                        <td className="py-2 text-right">{formatCentsToBRL(l.lineSubtotalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pricingError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{pricingError}</p>}
            <div className="flex justify-between">
              <button type="button" className="btn-secondary" onClick={() => goTo(3)}>Voltar</button>
            </div>
          </section>
        )}
      </div>

      {/* Resumo fixo (desktop) */}
      <aside className="hidden lg:block">
        <div className="sticky top-4">{summary}</div>
      </aside>

      {/* Barra de resumo (celular/tablet) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white px-4 py-3 shadow-lg lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-gray-500">
              {totalQuantity} un. · {display ? (requestedTier === "AUTO" ? SHORT_TIER[display.orderAutomaticTier] : `${SHORT_TIER[requestedTier]} (manual)`) : "sem itens"}
              {" · "}<SaveIndicator state={saveState} savedAt={savedAt} compact />
            </p>
            <p className="text-lg font-semibold text-gray-900">{formatCentsToBRL(display?.totalCents ?? 0)}</p>
          </div>
          {step === 4 ? (
            <button type="button" className={brandButton(brand)} disabled={finalizing || !(!!customer && !!brand && !!display && !pricingError && !discountError)} onClick={finalize}>
              {finalizing ? "Concluindo..." : "Concluir"}
            </button>
          ) : (
            <button type="button" className="btn-secondary" disabled={maxStep < 4} onClick={() => goTo(4)}>Resumo</button>
          )}
        </div>
      </div>
    </div>
  );
}

function QtyControl({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="h-8 w-8 rounded-md border border-gray-300 text-gray-700 disabled:opacity-40" aria-label={`Diminuir ${label}`}
        disabled={value <= 0} onClick={() => onChange(value - 1)}>−</button>
      <input
        className="input-field h-8 w-16 px-2 text-center"
        inputMode="numeric"
        aria-label={`Quantidade ${label}`}
        value={value === 0 ? "" : String(value)}
        placeholder="0"
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")))}
      />
      <button type="button" className="h-8 w-8 rounded-md border border-gray-300 text-gray-700" aria-label={`Aumentar ${label}`} onClick={() => onChange(value + 1)}>+</button>
      <button type="button" className="h-8 rounded-md border border-gray-300 px-2 text-xs text-gray-600" aria-label={`Mais 10 ${label}`} onClick={() => onChange(value + 10)}>+10</button>
    </div>
  );
}

function SaveIndicator({ state, savedAt, compact }: { state: SaveState; savedAt: Date | null; compact?: boolean }) {
  const time = savedAt ? savedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "";
  const text =
    state === "saving" || state === "pending" ? "salvando…" :
    state === "saved" ? (compact ? "salvo" : `Rascunho salvo às ${time}`) :
    state === "error" ? "erro ao salvar" : compact ? "não salvo" : "Escolha cliente e marca para salvar";
  return <span className={state === "error" ? "text-red-600" : state === "saved" ? "text-green-700" : "text-gray-500"}>{text}</span>;
}

function SummaryPanel(props: {
  brand: CommercialBrand | null;
  customer: CustomerOption | null;
  catalog: Catalog | null;
  display: DisplayPricing | null;
  pricingError: string | null;
  requestedTier: PriceTier | "AUTO";
  saveState: SaveState;
  savedAt: Date | null;
  saveError: string | null;
  onFinalize: () => void;
  finalizing: boolean;
  canFinalize: boolean;
  onUseCurrentTable?: () => void;
}) {
  const { brand, customer, catalog, display, requestedTier } = props;
  const accent = brand === "SINCROFIT" ? "border-t-teal-600" : brand === "MIBRO" ? "border-t-orange-500" : "border-t-gray-300";
  const tableVersion = display?.priceTableVersion ?? catalog?.table?.version ?? null;
  // Proposta retomada mantém a versão com que foi calculada; o usuário pode optar pela vigente.
  const pinnedOutdated =
    !!props.onUseCurrentTable && !!catalog?.table && catalog.effectiveVersion !== null && catalog.table.version !== catalog.effectiveVersion;

  return (
    <div className={`card space-y-3 border-t-4 p-4 ${accent}`}>
      <div>
        <p className="text-xs text-gray-500">Cliente</p>
        <p className="text-sm font-medium text-gray-900">{customer?.name ?? "—"}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-500">Marca</p>
          <p className="font-medium text-gray-800">{brand === "MIBRO" ? "Mibro" : brand === "SINCROFIT" ? "Sincrofit" : "—"}</p>
        </div>
        <div>
          <p className="text-gray-500">Tabela comercial</p>
          <p className="font-medium text-gray-800">
            {catalog ? GROUP_LABEL[catalog.priceGroup] : "—"}
            {tableVersion && <span className="font-normal text-gray-500"> · v{tableVersion}</span>}
          </p>
        </div>
        <div>
          <p className="text-gray-500">Faixa aplicada</p>
          <p className="font-medium text-gray-800">
            {display ? (requestedTier === "AUTO" ? `${SHORT_TIER[display.orderAutomaticTier]} (automática)` : `${SHORT_TIER[requestedTier]} (manual)`) : "—"}
          </p>
        </div>
        <div>
          <p className="text-gray-500">Unidades</p>
          <p className="font-medium text-gray-800">{display?.totalQuantity ?? 0}</p>
        </div>
      </div>
      {requestedTier !== "AUTO" && display && (
        <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">Faixa selecionada manualmente.</p>
      )}
      <dl className="space-y-1 border-t border-gray-100 pt-3 text-sm">
        <div className="flex justify-between"><dt className="text-gray-500">Subtotal</dt><dd>{formatCentsToBRL(display?.subtotalCents ?? 0)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">Desconto</dt><dd>− {formatCentsToBRL(display?.discountCents ?? 0)}</dd></div>
        <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{formatCentsToBRL(display?.totalCents ?? 0)}</dd></div>
      </dl>
      <p className="text-[11px] text-gray-500">Tributos e frete são calculados pelo Olist no pedido real.</p>
      {props.pricingError && <p className="text-xs text-red-600">{props.pricingError}</p>}
      {props.saveError && <p className="text-xs text-red-600">{props.saveError}</p>}
      <p className="text-xs"><SaveIndicator state={props.saveState} savedAt={props.savedAt} /></p>
      {pinnedOutdated && (
        <div className="rounded bg-blue-50 px-2 py-2 text-xs text-blue-900">
          Esta proposta usa a tabela v{catalog!.table!.version}; a vigente é a v{catalog!.effectiveVersion}.{" "}
          <button type="button" className="underline" onClick={props.onUseCurrentTable}>Atualizar para a tabela vigente</button>
        </div>
      )}
      <button type="button" className={`${brandButton(brand)} w-full`} disabled={!props.canFinalize || props.finalizing} onClick={props.onFinalize}>
        {props.finalizing ? "Concluindo..." : "Concluir simulação"}
      </button>
      <p className="text-[11px] text-gray-500">A simulação não cria pedido no Olist.</p>
    </div>
  );
}
