"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Botões contextuais. As decisões (permitido/motivo) vêm do servidor; o
// servidor refaz toda a validação no clique — aqui só se exibe e coleta dados.

type Decision = { allowed: boolean; reason?: string };

interface Props {
  proposalId: string;
  brand: "MIBRO" | "SINCROFIT";
  version: number;
  customerEmail: string | null;
  decisions: Record<string, Decision>;
  conversionMode: "api" | "manual";
  olistNumber: string | null;
  transferTargets: Array<{ id: string; name: string }>;
}

type Form =
  | null
  | "submit"
  | "approve"
  | "approve_order"
  | "reject"
  | "request_changes"
  | "send_email"
  | "register_dispatch"
  | "response"
  | "reopen"
  | "deny_conversion"
  | "convert"
  | "reconcile_order"
  | "transfer"
  | "cancel"
  | "finance_review"
  | "resolve_conflict";

/** Etapas principais: mostradas mesmo quando indisponíveis, com o motivo. */
const MAIN_FLOW: Array<[string, string]> = [
  ["submit", "Enviar para aprovação"],
  ["approve", "Aprovar condições da proposta"],
  ["send_email", "Enviar por e-mail"],
  ["register_acceptance", "Registrar aceite"],
  ["request_conversion", "Solicitar conversão"],
  ["convert", "Converter em pedido"],
];

const CHANNELS = [
  ["EMAIL", "E-mail"],
  ["WHATSAPP", "WhatsApp"],
  ["TELEFONE", "Telefone"],
  ["PRESENCIAL", "Presencial"],
  ["OUTRO", "Outro"],
] as const;

export function ProposalActions(props: Props) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({ to: props.customerEmail ?? "", decision: "ACEITA", channel: "WHATSAPP", occurredAt: new Date().toISOString().slice(0, 16) });
  const d = props.decisions;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const brandBtn = props.brand === "MIBRO" ? "btn-brand-mibro" : "btn-brand-sincrofit";

  async function send(body: Record<string, unknown>, ok: string) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setMessage({ tone: "error", text: "Sem conexão. Ações da proposta exigem confirmação do servidor; nada foi enviado." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/proposals/${props.proposalId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response) return setMessage({ tone: "error", text: "Sem conexão com o servidor. Recarregue antes de tentar novamente." });
    if (!response.ok) {
      const fieldErrors = data.fieldErrors ? ` ${Object.values(data.fieldErrors).join(" ")}` : "";
      return setMessage({ tone: "error", text: `${data.error ?? "Falha na operação."}${fieldErrors}` });
    }
    setForm(null);
    if (data.syncError) setMessage({ tone: "warn", text: `${ok} Atenção: ${data.syncError}` });
    else if (Array.isArray(data.problems) && data.problems.length) setMessage({ tone: "warn", text: `${ok} Divergências registradas: ${data.problems.join(" ")}` });
    else setMessage({ tone: "ok", text: ok });
    if (data.proposalId && body.action === "duplicate") router.push(`/propostas/${data.proposalId}`);
    else router.refresh();
  }

  const btn = (action: string, label: string, onClick: () => void, primary = false) =>
    d[action]?.allowed ? (
      <button key={action} type="button" disabled={busy} onClick={onClick} className={`${primary ? brandBtn : "btn-secondary"} w-full`}>
        {label}
      </button>
    ) : null;

  const blocked = MAIN_FLOW.filter(([a]) => !d[a]?.allowed && d[a]?.reason && d[a].reason !== "Você não tem acesso a esta proposta.");
  const reasonField = (k: string, label: string) => (
    <label className="block text-xs text-gray-600">
      {label}
      <textarea className="input-field mt-1" rows={2} value={fields[k] ?? ""} onChange={set(k)} />
    </label>
  );
  const confirm = (label: string, onClick: () => void, disabled = false) => (
    <div className="flex gap-2">
      <button type="button" className={`${brandBtn} flex-1`} disabled={busy || disabled} onClick={onClick}>{busy ? "Processando..." : label}</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => setForm(null)}>Voltar</button>
    </div>
  );

  return (
    <section className="card space-y-3 p-5">
      <h2 className="text-sm font-semibold text-gray-700">Ações</h2>

      {form === null && (
        <div className="space-y-2">
          {btn("sync", "Sincronizar com o Olist", () => send({ action: "sync" }, "Proposta sincronizada com o Olist."))}
          {btn("resolve_conflict", "Resolver conflito (reenviar versão do CRM)", () => setForm("resolve_conflict"))}
          {btn("submit", "Enviar para aprovação", () => setForm("submit"), true)}
          {btn("approve", "Aprovar condições da proposta", () => setForm("approve"), true)}
          {btn("approve_order", "Aprovar pedido · Master", () => setForm("approve_order"), true)}
          {btn("reject", "Reprovar", () => setForm("reject"))}
          {btn("request_changes", "Solicitar ajustes", () => setForm("request_changes"))}
          {btn("send_email", "Enviar por e-mail", () => setForm("send_email"), true)}
          {btn("register_dispatch", "Registrar envio por outro canal", () => setForm("register_dispatch"))}
          {(d.register_acceptance?.allowed || d.register_refusal?.allowed || d.register_change_request?.allowed) && (
            <button type="button" className={`${brandBtn} w-full`} disabled={busy} onClick={() => setForm("response")}>Registrar resposta do cliente</button>
          )}
          {btn("request_conversion", "Solicitar conversão em pedido", () => send({ action: "request_conversion" }, "Conversão solicitada à supervisão."), true)}
          {btn("convert", "Converter em pedido no Olist", () => setForm("convert"), true)}
          {btn("deny_conversion", "Recusar solicitação de conversão", () => setForm("deny_conversion"))}
          {btn("reconcile_order", "Vincular pedido gerado no Olist", () => setForm("reconcile_order"))}
          {btn("refresh_order", "Consultar pedido e recebimento", () => send({ action: "refresh_order" }, "Pedido e recebimento atualizados."))}
          {btn("finance_review", "Registrar conferência financeira", () => setForm("finance_review"))}
          {btn("reopen", "Reabrir negociação", () => setForm("reopen"))}
          {btn("transfer", "Transferir responsável", () => setForm("transfer"))}
          {btn("duplicate", "Duplicar como nova proposta", () => send({ action: "duplicate" }, "Nova proposta criada."))}
          {btn("cancel", "Cancelar proposta", () => setForm("cancel"))}
          {d.view?.allowed && (
            <button type="button" className="w-full text-xs text-gray-500 underline" disabled={busy} onClick={() => send({ action: "refresh" }, "Situação consultada no Olist.")}>Consultar situação no Olist</button>
          )}
        </div>
      )}

      {form === "submit" && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">A supervisão vai aprovar exatamente esta versão (v{props.version}). Desconto acima do seu limite exige justificativa.</p>
          {reasonField("justification", "Justificativa (quando houver desconto)")}
          {confirm("Enviar para aprovação", () => send({ action: "submit", justification: fields.justification || null }, "Proposta enviada para aprovação."))}
        </div>
      )}
      {form === "approve" && (
        <div className="space-y-2">
          {reasonField("reason", "Observação (opcional)")}
          {confirm(`Aprovar versão ${props.version}`, () => send({ action: "approve", reason: fields.reason || null }, "Proposta aprovada."))}
        </div>
      )}
      {form === "approve_order" && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">Aprovar o pedido já criado no Olist e atualizar sua etiqueta para Pedido aprovado. Esta ação não confirma pagamento. A situação será conferida antes e depois da alteração.</p>
          {confirm("Confirmar aprovação do pedido", () => send({ action: "approve_order" }, "Pedido aprovado pelo Master e confirmado no Olist."))}
        </div>
      )}
      {(form === "reject" || form === "request_changes") && (
        <div className="space-y-2">
          {reasonField("reason", "Justificativa (obrigatória)")}
          {confirm(form === "reject" ? "Reprovar" : "Solicitar ajustes", () => send({ action: form, reason: fields.reason }, form === "reject" ? "Proposta reprovada." : "Ajustes solicitados ao vendedor."), !fields.reason?.trim())}
        </div>
      )}
      {form === "send_email" && (
        <div className="space-y-2">
          <label className="block text-xs text-gray-600">E-mail do cliente<input type="email" className="input-field mt-1" value={fields.to} onChange={set("to")} /></label>
          <p className="text-[11px] text-gray-500">Envio pelo serviço de e-mail do CRM (o Olist não envia propostas pela API). Isso não registra aceite.</p>
          {confirm("Enviar", () => send({ action: "send_email", to: fields.to }, `Proposta enviada para ${fields.to}.`), !fields.to)}
        </div>
      )}
      {form === "register_dispatch" && (
        <div className="space-y-2">
          {reasonField("description", "Como foi enviada (ex.: PDF pelo WhatsApp da loja)")}
          <label className="block text-xs text-gray-600">Destinatário (opcional)<input className="input-field mt-1" value={fields.recipient ?? ""} onChange={set("recipient")} /></label>
          {confirm("Registrar envio", () => send({ action: "register_dispatch", description: fields.description, recipient: fields.recipient || null }, "Envio registrado."), !fields.description?.trim())}
        </div>
      )}
      {form === "response" && (
        <div className="space-y-2">
          <label className="block text-xs text-gray-600">Resposta
            <select className="input-field mt-1" value={fields.decision} onChange={set("decision")}>
              {d.register_acceptance?.allowed && <option value="ACEITA">Cliente aceitou a versão {props.version}</option>}
              {d.register_change_request?.allowed && <option value="ALTERACAO_SOLICITADA">Cliente pediu alterações</option>}
              {d.register_refusal?.allowed && <option value="RECUSADA">Cliente recusou</option>}
            </select>
          </label>
          {!d.register_acceptance?.allowed && d.register_acceptance?.reason && <p className="text-[11px] text-amber-700">Aceite indisponível: {d.register_acceptance.reason}</p>}
          <label className="block text-xs text-gray-600">Canal
            <select className="input-field mt-1" value={fields.channel} onChange={set("channel")}>
              {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block text-xs text-gray-600">Quando<input type="datetime-local" className="input-field mt-1" value={fields.occurredAt} onChange={set("occurredAt")} /></label>
          <label className="block text-xs text-gray-600">Quem respondeu (opcional)<input className="input-field mt-1" value={fields.contactName ?? ""} onChange={set("contactName")} /></label>
          {reasonField("evidence", "Evidência ou referência (ex.: mensagem de 30/10 às 10h)")}
          <p className="text-[11px] text-gray-500">Registro manual feito por você. Não é confirmação digital do cliente.</p>
          {confirm("Registrar", () => send({ action: "register_response", decision: fields.decision, channel: fields.channel, evidence: fields.evidence, contactName: fields.contactName || null, occurredAt: new Date(fields.occurredAt).toISOString() }, "Resposta do cliente registrada."), !fields.evidence?.trim())}
        </div>
      )}
      {(form === "reopen" || form === "deny_conversion" || form === "cancel") && (
        <div className="space-y-2">
          {reasonField("reason", "Motivo (obrigatório)")}
          {confirm(form === "reopen" ? "Reabrir negociação" : form === "cancel" ? "Cancelar proposta" : "Recusar solicitação", () => send({ action: form, reason: fields.reason }, form === "cancel" ? "Proposta cancelada." : form === "reopen" ? "Negociação reaberta." : "Solicitação recusada."), !fields.reason?.trim())}
        </div>
      )}
      {form === "convert" && (
        <div className="space-y-2">
          <p className="text-xs text-gray-700">O Olist vai gerar o pedido de venda a partir da proposta {props.olistNumber ? `nº ${props.olistNumber}` : ""} (função nativa “gerar venda”). A situação é conferida no Olist imediatamente antes. Esta operação não é repetida automaticamente.</p>
          {confirm("Confirmar conversão", () => send({ action: "convert" }, "Pedido gerado no Olist e vinculado à proposta."))}
        </div>
      )}
      {form === "reconcile_order" && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">{props.conversionMode === "manual" ? "Gere a venda no Olist a partir da proposta e informe o número do pedido." : "Informe o pedido gerado no Olist."} O CRM confere cliente, vendedor, produtos e quantidades antes de vincular.</p>
          <label className="block text-xs text-gray-600">Número do pedido no Olist<input className="input-field mt-1" value={fields.orderNumber ?? ""} onChange={set("orderNumber")} /></label>
          {reasonField("justification", "Justificativa (obrigatória)")}
          {confirm("Conferir e vincular", () => send({ action: "reconcile_order", orderNumber: fields.orderNumber, justification: fields.justification }, "Pedido conferido e vinculado."), !fields.orderNumber?.trim() || !fields.justification?.trim())}
        </div>
      )}
      {form === "transfer" && (
        <div className="space-y-2">
          <label className="block text-xs text-gray-600">Novo responsável (com vínculo Olist)
            <select className="input-field mt-1" value={fields.sellerId ?? ""} onChange={set("sellerId")}>
              <option value="">Selecione</option>
              {props.transferTargets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {reasonField("reason", "Motivo (obrigatório)")}
          <p className="text-[11px] text-gray-500">Gera nova versão: aprovação e aceite precisam ser refeitos. A carteira do cliente não muda.</p>
          {confirm("Transferir", () => send({ action: "transfer", sellerId: fields.sellerId, reason: fields.reason }, "Responsável transferido."), !fields.sellerId || !fields.reason?.trim())}
        </div>
      )}
      {form === "finance_review" && (
        <div className="space-y-2">
          {reasonField("note", "Conferência realizada (não altera títulos no Olist)")}
          {confirm("Registrar", () => send({ action: "finance_review", note: fields.note }, "Conferência registrada."), !fields.note?.trim())}
        </div>
      )}
      {form === "resolve_conflict" && (
        <div className="space-y-2">
          <p className="text-xs text-red-700">A versão do CRM substituirá o que foi alterado diretamente no Olist. Use somente depois de conferir as alterações feitas lá.</p>
          {confirm("Reenviar versão do CRM", () => send({ action: "resolve_conflict" }, "Versão do CRM reenviada ao Olist."))}
        </div>
      )}

      {message && (
        <p className={`text-xs ${message.tone === "ok" ? "text-green-700" : message.tone === "warn" ? "text-amber-700" : "text-red-600"}`} role="status">
          {message.text}
        </p>
      )}

      {form === null && blocked.length > 0 && (
        <details className="border-t border-gray-100 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-gray-600">Outras etapas e motivos de indisponibilidade</summary>
          <ul className="space-y-1 text-[11px] text-gray-500">
            {blocked.map(([a, label]) => (
              <li key={a}><span className="font-medium text-gray-600">{label}:</span> {d[a].reason}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
