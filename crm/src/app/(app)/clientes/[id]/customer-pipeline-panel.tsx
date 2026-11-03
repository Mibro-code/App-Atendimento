"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PipelineStage } from "@prisma/client";
import type { PipelineCardDto } from "@/lib/pipeline-board";
import { needsAttemptDecision, PIPELINE_STAGES, PIPELINE_STAGE_META } from "@/lib/pipeline-rules";
import { ActionModal, Stars, type Modal } from "../pipeline-board";

const NEEDS_DETAILS: PipelineStage[] = ["INATIVO", "RECICLAGEM", "VENDIDO", "FOLLOW_UP", "NOVO"];
const shortDate = (iso: string | null) => iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso)) : "—";

/** Etapa do funil no perfil do cliente: mesmas ações do Kanban. Abrir o cliente não move nada. */
export function CustomerPipelinePanel({ card }: { card: PipelineCardDto }) {
  const router = useRouter();
  const [modal, setModal] = useState<Modal | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const meta = PIPELINE_STAGE_META[card.stage];
  const paused = card.stage === "RECICLAGEM" || card.stage === "INATIVO";
  const decide = needsAttemptDecision(card.attempts, card.stage);
  const availableStages = PIPELINE_STAGES.filter((stage) =>
    stage !== card.stage
    && stage !== "VENDIDO"
    && (card.stage !== "RECICLAGEM" || stage === "EM_ATENDIMENTO" || stage === "INATIVO")
    && (!decide || stage === "RECICLAGEM" || stage === "INATIVO")
  );

  async function post(url: string, body: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage({ text: data.error || "Não foi possível salvar.", error: true });
      return false;
    }
    setMessage({ text: "Alteração salva." });
    router.refresh();
    return true;
  }

  function move(to: PipelineStage) {
    if (to === card.stage) return;
    if (NEEDS_DETAILS.includes(to)) setModal({ kind: "move", card, to });
    else void post(`/api/customers/${card.id}/stage`, { action: "MOVE", to });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-900"><span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />{meta.label}</span>
        {card.repurchase && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">RECOMPRA</span>}
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <Stars attempts={card.attempts} />
        <span>Ciclo comercial {card.cycle}</span>
      </div>
      {card.repurchase && <p className="text-xs text-purple-700">Cliente já comprou anteriormente.</p>}
      {card.stageReason && <p className="text-xs text-gray-600">Motivo: {card.stageReason}</p>}
      {card.returnAt && <p className="text-xs text-indigo-700">Volta para {PIPELINE_STAGE_META[card.returnTo ?? "NOVO"].label} em {shortDate(card.returnAt)}</p>}
      {card.nextActionAt && <p className="text-xs text-gray-500">Próxima ação: {shortDate(card.nextActionAt)}</p>}
      {decide && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">3 tentativas sem sucesso: envie para Reciclagem ou Inativos.</p>
      )}
      {!paused && (
        <button type="button" className="btn-primary w-full" onClick={() => setModal({ kind: "contact", card })}>Registrar contato</button>
      )}
      <label className="block text-xs text-gray-600">Mover para
        <select className="input-field mt-1" value="" onChange={(event) => move(event.target.value as PipelineStage)}>
          <option value="">Escolha a etapa…</option>
          {availableStages.map((stage) => (
            <option key={stage} value={stage}>{stage === "INATIVO" ? "Marcar como Inativo" : stage === "VENDIDO" ? "Marcar como Vendido" : PIPELINE_STAGE_META[stage].label}</option>
          ))}
        </select>
      </label>
      {!decide && card.stage !== "RECICLAGEM" && (
        <button type="button" className="btn-secondary w-full" onClick={() => setModal({ kind: "schedule", card })}>
          {card.returnAt ? "Alterar/cancelar retorno" : "Agendar mudança de etapa"}
        </button>
      )}
      {message && <p className={`text-xs ${message.error ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p>}
      {modal && (
        <ActionModal
          modal={modal}
          onClose={() => setModal(null)}
          onSubmit={async (url, body) => { if (await post(url, body)) setModal(null); }}
        />
      )}
    </div>
  );
}
