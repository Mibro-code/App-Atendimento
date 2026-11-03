"use client";
import { useRef, useState } from "react";
import type { OrderDocuments, OrderFinance, OrderStock } from "@/lib/proposals/proposal-operations";

const money = (n: number | null) => n === null ? "Não informado" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n / 100);
const date = (s: string | null) => s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split("-").reverse().join("/") : "Não informado";
type Preflight = OrderStock & { problems: string[]; conditions: { freightCents: number; payment: string; delivery: string; totalCents: number } };
export function ProposalOrderConsult({ id, hasOrder, financial }: { id: string; hasOrder: boolean; financial: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  const [data, setData] = useState<{ kind: string; value: OrderDocuments & OrderFinance & Preflight } | null>(null);
  async function consult(kind: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setData(null);
    try {
      const res = await fetch(`/api/proposals/${id}/consult`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }), cache: "no-store" });
      const value = await res.json();
      if (!res.ok) throw new Error(value.error || "Consulta indisponível.");
      setData({ kind, value });
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível consultar. Tente novamente."); }
    finally { lock.current = false; setBusy(false); }
  }
  const safe = (value: string | null) => { try { return value && new URL(value).protocol === "https:" ? value : null; } catch { return null; } };
  return <section className="card space-y-4 p-5"><div><h2 className="text-sm font-semibold">Conferência e pós-venda</h2><p className="text-xs text-gray-500">Consultas sob demanda. Não reservam estoque, emitem nota ou dão baixa em pagamentos.</p></div>
    <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={busy} onClick={() => consult("preflight")}>Conferir cadastro e estoque</button>{hasOrder && <><button type="button" className="btn-secondary" disabled={busy} onClick={() => consult("documents")}>Nota e rastreamento</button>{financial && <button type="button" className="btn-secondary" disabled={busy} onClick={() => consult("financial")}>Parcelas e recebimentos</button>}</>}</div>
    {busy && <p role="status" className="text-sm text-gray-500">Consultando Olist…</p>}{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {data && <div className="space-y-3 text-sm" aria-live="polite"><p className="text-xs text-gray-500">Consulta: {new Date(data.value.checked_at).toLocaleString("pt-BR")}</p>
      {data.kind === "preflight" && <><p>Frete: {money(data.value.conditions.freightCents)} · Total: {money(data.value.conditions.totalCents)}</p><p>Pagamento: {data.value.conditions.payment} · Prazo: {data.value.conditions.delivery}</p>{data.value.problems.length ? <ul className="list-disc pl-5 text-amber-700">{data.value.problems.map((p, i) => <li key={i}>{p}</li>)}</ul> : <p>Cadastro, vendedor, sincronização e estoque conferidos nesta consulta.</p>}<ul>{data.value.stock.map((s) => <li key={s.sku}>{s.sku} · disponível: {s.available ?? "não informado"} · reservado: {s.reserved ?? "não informado"}</li>)}</ul><p className="text-xs text-gray-500">O estoque pode mudar até a geração do pedido.</p></>}
      {data.kind === "financial" && <>{data.value.installments.length === 0 && <p>Nenhuma cobrança encontrada para este pedido.</p>}{data.value.installments.map((r) => <div key={r.id} className="rounded-lg border border-gray-200 p-3"><p>Vencimento: {date(r.due_date)} · {r.situation ?? "situação não informada"}</p><p>Valor: {money(r.amount_cents)} · Saldo: {money(r.balance_cents)}</p>{r.payments.map((p, i) => <p key={i} className="text-xs text-gray-500">Recebido {money(p.amount_cents)} em {date(p.date)}</p>)}</div>)}</>}
      {data.kind === "documents" && <><p>Nota fiscal: {data.value.invoice_number || data.value.invoice_id || "Ainda não vinculada"}</p>{safe(data.value.invoice_link) && <a className="btn-secondary inline-block" target="_blank" rel="noopener noreferrer" href={safe(data.value.invoice_link)!}>Abrir documento fiscal</a>}<p>Rastreamento: {data.value.tracking_code || "Ainda não informado"}</p>{safe(data.value.tracking_link) && <a className="underline" target="_blank" rel="noopener noreferrer" href={safe(data.value.tracking_link)!}>Acompanhar entrega</a>}<p className="text-xs text-gray-500">Os documentos exibidos pertencem ao pedido vinculado no Olist.</p></>}
    </div>}
  </section>;
}
