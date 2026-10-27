"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCentsToBRL } from "@/lib/format";

interface Attempt {
  id: string;
  action: "CALCULATE" | "CONFIRM" | "EMAIL";
  status: "STARTED" | "SUCCEEDED" | "FAILED";
  errorCode: string | null;
  errorMessage: string | null;
  orderNumber: string | null;
  startedAt: string;
}

interface Props {
  quoteId: string;
  customerId: string;
  brand: "MIBRO" | "SINCROFIT";
  mode: "SIMULATION" | "REAL";
  status: string;
  customerEmail: string | null;
  sentToEmail: string | null;
  realQuoteId: string | null;
  olistOrder: { olistOrderId: string; orderNumber: string | null; crmStatus: string; valueCents: number } | null;
  olistConfirmedTotalCents: number | null;
  missing: Array<{ label: string; level: "blocking" | "warning" }>;
  attempts: Attempt[];
}

const ACTION_LABEL = { CALCULATE: "Cálculo no Olist", CONFIRM: "Envio para análise", EMAIL: "E-mail" } as const;

async function post(url: string, body?: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }).catch(() => null);
  const data = response ? await response.json().catch(() => ({})) : {};
  return { ok: !!response?.ok, data, offline: !response };
}

export function RealOrderPanel(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "convert" | "calculate" | "confirm" | "email">(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [emailTo, setEmailTo] = useState(props.sentToEmail || props.customerEmail || "");
  const [confirmCalc, setConfirmCalc] = useState(false);
  const brandBtn = props.brand === "MIBRO" ? "btn-brand-mibro" : "btn-brand-sincrofit";
  const blocking = props.missing.filter((m) => m.level === "blocking");
  const warnings = props.missing.filter((m) => m.level === "warning");

  async function run(kind: NonNullable<typeof busy>, url: string, body?: unknown, onOk?: (data: Record<string, unknown>) => void) {
    setBusy(kind);
    setMessage(null);
    const { ok, data, offline } = await post(url, body);
    setBusy(null);
    if (!ok) return setMessage({ tone: "error", text: offline ? "Sem conexão. Nada foi duplicado; tente novamente." : data.error || "Falha na operação." });
    onOk?.(data);
    router.refresh();
  }

  const simulationReady = props.mode === "SIMULATION" && ["CALCULADA", "ENVIADA"].includes(props.status);
  const canEmail = ["CALCULADA", "ENVIADA", "ENVIADA_PARA_ANALISE"].includes(props.status);

  return (
    <div className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold text-gray-700">Envio e pedido</h2>

      {canEmail && (
        <div className="space-y-2">
          <label className="block text-xs text-gray-600">
            Enviar proposta por e-mail
            <input className="input-field mt-1" type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="cliente@empresa.com.br" />
          </label>
          <button type="button" className="btn-secondary w-full" disabled={busy !== null || !emailTo}
            onClick={() => run("email", `/api/quotes/${props.quoteId}/email`, { to: emailTo }, () => setMessage({ tone: "ok", text: `Proposta enviada para ${emailTo}.` }))}>
            {busy === "email" ? "Enviando..." : "Enviar por e-mail"}
          </button>
          {props.sentToEmail && <p className="text-[11px] text-gray-500">Último envio para {props.sentToEmail}.</p>}
        </div>
      )}

      {props.mode === "SIMULATION" && props.realQuoteId && (
        <Link href={`/cotacoes/${props.realQuoteId}`} className={`${brandBtn} w-full`}>Abrir pedido real</Link>
      )}

      {simulationReady && !props.realQuoteId && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          <p className="text-xs text-gray-500">A simulação não cria pedido no Olist. Para seguir com a venda, gere o pedido real (a simulação fica preservada).</p>
          <button type="button" className={`${brandBtn} w-full`} disabled={busy !== null}
            onClick={() => run("convert", `/api/quotes/${props.quoteId}/real-order`, undefined, (d) => router.push(`/cotacoes/${d.quoteId}`))}>
            {busy === "convert" ? "Gerando..." : "Gerar pedido real"}
          </button>
        </div>
      )}

      {props.mode === "REAL" && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
          {props.olistOrder ? (
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-gray-500">Pedido Olist</dt><dd className="font-medium text-gray-900">{props.olistOrder.orderNumber || props.olistOrder.olistOrderId}</dd></div>
              <div><dt className="text-gray-500">Situação</dt><dd className={props.olistOrder.crmStatus === "DIVERGENCIA_OLIST" ? "font-medium text-red-700" : "text-gray-900"}>{
                { PEDIDO_CRIADO: "Em aberto (calculado)", AGUARDANDO_APROVACAO: "Aguardando aprovação", DIVERGENCIA_OLIST: "Divergência de valores" }[props.olistOrder.crmStatus] ?? props.olistOrder.crmStatus
              }</dd></div>
              <div><dt className="text-gray-500">Total comercial</dt><dd>{formatCentsToBRL(props.olistOrder.valueCents)}</dd></div>
              <div><dt className="text-gray-500">Total no Olist (com tributos)</dt><dd>{props.olistConfirmedTotalCents ? formatCentsToBRL(props.olistConfirmedTotalCents) : "—"}</dd></div>
            </dl>
          ) : (
            <p className="text-xs text-gray-500">Ainda não enviado ao Olist.</p>
          )}

          {blocking.length > 0 && (
            <div className="rounded-md bg-red-50 p-3 text-xs text-red-800">
              Para gerar o pedido, complete no cadastro: {blocking.map((m) => m.label).join(", ")}.{" "}
              <Link href={`/clientes/${props.customerId}`} className="underline">Abrir cliente</Link>
            </div>
          )}
          {blocking.length === 0 && warnings.length > 0 && props.status === "CALCULADA" && (
            <p className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-800">
              Endereço incompleto ({warnings.map((m) => m.label).join(", ")}). Só é necessário se o cliente ainda não existir no Olist.
            </p>
          )}

          {props.status === "CALCULADA" && blocking.length === 0 && (
            confirmCalc || props.olistOrder ? (
              <button type="button" className="btn-secondary w-full" disabled={busy !== null}
                onClick={() => run("calculate", `/api/quotes/${props.quoteId}/olist/calculate`, undefined, (d) =>
                  setMessage({ tone: "ok", text: `Pedido ${d.orderNumber || d.olistOrderId} conferido no Olist.${d.repriced ? " Cliente recorrente: preços recalculados por modelo." : ""}` }))}>
                {busy === "calculate" ? "Calculando no Olist..." : props.olistOrder ? "Recalcular no Olist" : "Confirmar: criar pedido em aberto"}
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-600">Isto cria um pedido <strong>em aberto</strong> no Olist da {props.brand === "MIBRO" ? "Mibro" : "Sincrofit"} para calcular tributos. Repetir não duplica o pedido.</p>
                <button type="button" className="btn-secondary w-full" onClick={() => setConfirmCalc(true)}>Calcular no Olist</button>
              </div>
            )
          )}

          {props.status === "CALCULADA" && props.olistOrder?.crmStatus === "PEDIDO_CRIADO" && (
            <button type="button" className={`${brandBtn} w-full`} disabled={busy !== null}
              onClick={() => run("confirm", `/api/quotes/${props.quoteId}/olist/confirm`, undefined, () => setMessage({ tone: "ok", text: "Pedido enviado para análise." }))}>
              {busy === "confirm" ? "Enviando..." : "Enviar para aprovação"}
            </button>
          )}
          {props.status === "ENVIADA_PARA_ANALISE" && (
            <p className="rounded-md bg-blue-50 p-2 text-xs text-blue-900">Pedido em análise no Olist (marcador PARA ANÁLISE). A aprovação volta automaticamente para o CRM.</p>
          )}
        </div>
      )}

      {message && <p className={`text-xs ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>}

      {props.attempts.length > 0 && (
        <details className="border-t border-gray-100 pt-3 text-xs">
          <summary className="cursor-pointer text-gray-600">Histórico de sincronização ({props.attempts.length})</summary>
          <ul className="mt-2 space-y-1">
            {props.attempts.map((a) => (
              <li key={a.id} className={a.status === "FAILED" ? "text-red-700" : "text-gray-600"}>
                {ACTION_LABEL[a.action]} · {a.status === "SUCCEEDED" ? "ok" : a.status === "FAILED" ? "falhou" : "em andamento"}
                {a.orderNumber && ` · pedido ${a.orderNumber}`} · {new Date(a.startedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                {a.status === "FAILED" && <span className="block text-[11px]">{a.errorCode}: {a.errorMessage} (protocolo {a.id.slice(-8).toUpperCase()})</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
