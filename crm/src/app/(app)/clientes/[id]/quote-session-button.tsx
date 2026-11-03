"use client";

import { useState } from "react";
import type { CommercialBrand, ProposalMode } from "@prisma/client";
import { requestLocationAttempt, LOCATION_CONSENT_TEXT, type LocationAttempt } from "@/lib/geolocation-client";

interface Props {
  customerId: string;
  // Quando informado, o botão vira "Transformar em cotação real" / "Abrir
  // novamente na calculadora" para uma proposta específica, em vez do
  // seletor genérico SIMULATION/REAL.
  resumeQuoteId?: string;
  forcedMode?: ProposalMode;
  label?: string;
  brand: CommercialBrand;
}

async function openProposalSession(
  customerId: string,
  mode: ProposalMode,
  brand: CommercialBrand,
  resumeQuoteId: string | undefined,
  location: LocationAttempt | undefined,
  onDone: (msg: { type: "success" | "error"; text: string; url?: string }) => void
) {
  // A aba precisa ser criada durante o clique (mesmo clique que dispara a
  // captura de localização, que já é assíncrona e pode levar até ~10s pelo
  // timeout da Geolocation API). Se ela for aberta só depois do await,
  // navegadores com bloqueio de popup podem recusá-la.
  const quoteWindow = window.open("about:blank", "_blank");
  if (quoteWindow) {
    quoteWindow.opener = null;
    quoteWindow.document.title = "Preparando proposta...";
    quoteWindow.document.body.textContent = "Preparando sua proposta...";
  }

  try {
    const res = await fetch(`/api/customers/${customerId}/quote-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand, mode, resumeQuoteId, ...(location ? { location } : {}) }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.url || body.brand !== brand) {
      quoteWindow?.close();
      onDone({ type: "error", text: body?.error || "Não foi possível criar a proposta." });
      return;
    }

    if (quoteWindow && !quoteWindow.closed) {
      quoteWindow.location.replace(body.url);
    }

    const ttl = body.ttlMinutes ?? "alguns";
    onDone({
      type: "success",
      text: quoteWindow
        ? `Proposta aberta em nova aba. Válida por ${ttl} minuto(s).`
        : `O navegador bloqueou a nova aba. Use o link abaixo em até ${ttl} minuto(s).`,
      url: quoteWindow ? undefined : body.url,
    });
  } catch {
    quoteWindow?.close();
    onDone({ type: "error", text: "Erro de conexão ao criar a proposta." });
  }
}

function ResultMessage({
  message,
}: {
  message: { type: "success" | "error"; text: string; url?: string } | null;
}) {
  if (!message) return null;
  return (
    <div className={`text-xs ${message.type === "success" ? "text-green-600" : "text-red-600"}`}>
      <p>{message.text}</p>
      {message.url && (
        <a className="font-semibold underline" href={message.url} target="_blank" rel="noreferrer">
          Abrir proposta
        </a>
      )}
    </div>
  );
}

/** Botão simples para uma proposta já existente: reabrir ou converter. */
export function ResumeProposalButton({ customerId, resumeQuoteId, forcedMode, label, brand }: Props) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string; url?: string } | null>(
    null
  );

  return (
    <div className="space-y-2">
      <button
        className={`${brand === "MIBRO" ? "btn-brand-mibro" : "btn-brand-sincrofit"} w-full`}
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setMessage(null);
          await openProposalSession(customerId, forcedMode ?? "REAL", brand, resumeQuoteId, undefined, setMessage);
          setLoading(false);
        }}
      >
        {loading ? "Preparando..." : label ?? "Abrir novamente na calculadora"}
      </button>
      <ResultMessage message={message} />
    </div>
  );
}

/**
 * Seletor "Criar proposta" no perfil do cliente: Simulação ou Cotação real,
 * seguido de um passo de consentimento de localização (item 2 do pedido) —
 * nunca solicita a permissão do navegador sem antes mostrar essa mensagem
 * própria do CRM. "Continuar sem localização" segue em frente sem nem
 * chamar a Geolocation API (nenhuma tentativa = nenhum LocationCapture).
 */
export function CreateProposalPanel({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<ProposalMode | null>(null);
  const [pendingBrand, setPendingBrand] = useState<CommercialBrand | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string; url?: string } | null>(
    null
  );

  async function confirm(mode: ProposalMode, withLocation: boolean) {
    const selectedBrand = pendingBrand;
    if (!selectedBrand) {
      setMessage({ type: "error", text: "Escolha a empresa da proposta." });
      return;
    }
    setLoading(true);
    setMessage(null);
    const location = withLocation ? await requestLocationAttempt() : undefined;
    await openProposalSession(customerId, mode, selectedBrand, undefined, location, setMessage);
    setLoading(false);
    setPendingMode(null);
    setPendingBrand(null);
  }

  if (!open) {
    return (
      <button className="btn-primary w-full" onClick={() => setOpen(true)}>
        Criar proposta
      </button>
    );
  }

  if (pendingMode) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold">Empresa: {pendingBrand === "SINCROFIT" ? "Sincrofit" : "Mibro"}</p>
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm text-gray-700">{LOCATION_CONSENT_TEXT}</p>
        </div>
        <div className="flex gap-2">
          <button className={`${pendingBrand === "SINCROFIT" ? "btn-brand-sincrofit" : "btn-brand-mibro"} flex-1`} disabled={loading} onClick={() => confirm(pendingMode, true)}>
            {loading ? "Preparando..." : "Permitir localização"}
          </button>
          <button className="btn-secondary flex-1" disabled={loading} onClick={() => confirm(pendingMode, false)}>
            Continuar sem localização
          </button>
        </div>
        <ResultMessage message={message} />
        {!loading && (
          <button className="text-xs text-gray-400 underline" onClick={() => setPendingMode(null)}>
            Voltar
          </button>
        )}
      </div>
    );
  }

  if (!pendingBrand) return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-gray-800">Escolha a empresa</p>
      <button className="btn-brand-mibro w-full" onClick={() => setPendingBrand("MIBRO")}>Proposta Mibro</button>
      <button className="btn-brand-sincrofit w-full" onClick={() => setPendingBrand("SINCROFIT")}>Proposta Sincrofit</button>
      <button className="text-xs text-gray-400 underline" onClick={() => setOpen(false)}>Cancelar</button>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className={`rounded-md px-3 py-2 text-sm font-semibold text-white ${pendingBrand === "MIBRO" ? "bg-orange-500" : "bg-teal-600"}`}>
        Empresa: {pendingBrand === "MIBRO" ? "Mibro" : "Sincrofit"}
      </div>
      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-sm font-semibold text-gray-800">Simulação comercial</p>
        <p className="text-xs text-gray-500 mb-2">
          Calcule valores e envie uma proposta ao cliente sem criar pedido no Olist.
        </p>
        <button className="btn-secondary w-full" onClick={() => setPendingMode("SIMULATION")}>
          Fazer simulação
        </button>
      </div>
      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-sm font-semibold text-gray-800">Cotação real</p>
        <p className="text-xs text-gray-500 mb-2">
          Calcule os valores e siga com o fluxo real de pedido e aprovação.
        </p>
        <button className={`${pendingBrand === "MIBRO" ? "btn-brand-mibro" : "btn-brand-sincrofit"} w-full`} onClick={() => setPendingMode("REAL")}>
          Criar cotação real
        </button>
      </div>
      <button className="text-xs text-gray-400 underline" onClick={() => setPendingBrand(null)}>
        Trocar empresa
      </button>
    </div>
  );
}
