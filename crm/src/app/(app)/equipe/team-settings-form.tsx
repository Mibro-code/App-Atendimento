"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TIME_CLOCK_EVENT_LABELS, type TimeClockEventValue } from "@/lib/time-clock";
import { RepresentativeProfileEditor, type RepresentativeProfileValue } from "@/components/representative-profile-editor";

interface SellerSetting {
  id: string;
  name: string;
  displayName: string | null;
  role: string;
  followUpAfterDays: number;
  canTransferOwnCustomers: boolean;
  active: boolean;
  timeClockReminderEnabled:boolean;
  timeClockRequiredEvents:TimeClockEventValue[];
  timeClockWorkingDays:number[];
  timeClockStartMinutes:number;
  timeClockLunchStartMinutes:number;
  timeClockLunchEndMinutes:number;
  timeClockEndMinutes:number;
  timeClockReminderIntervalMinutes:number;
  // null = sem percentual registrado (nenhuma comissão é presumida).
  commissionPercent:number|null;
  commissionMibroPercent:number|null;
  commissionSincrofitPercent:number|null;
  rca:string|null;
  representativeProfile:RepresentativeProfileValue|null;
}

const minutesToTime = (minutes:number) => `${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`;
const timeToMinutes = (value:string) => { const [hour,minute]=value.split(":").map(Number); return hour*60+minute; };

export function TeamSettingsForm({ supervisor, initialAllowTransfer, initialOrderFollowUpAssigneeId, assigneeOptions, initialSellers }: {
  supervisor: { id: string; name: string };
  initialAllowTransfer: boolean;
  initialOrderFollowUpAssigneeId:string|null;
  assigneeOptions:Array<{id:string;name:string;role:string}>;
  initialSellers: SellerSetting[];
}) {
  const [allowTransfer, setAllowTransfer] = useState(initialAllowTransfer);
  const [sellers, setSellers] = useState(initialSellers);
  const [orderFollowUpAssigneeId,setOrderFollowUpAssigneeId]=useState(initialOrderFollowUpAssigneeId??"");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [deactivationSeller, setDeactivationSeller] = useState<SellerSetting | null>(null);
  const [transferToId, setTransferToId] = useState("");
  const router = useRouter();

  async function deactivate(seller: SellerSetting) {
    if (!transferToId) { setMessage("Escolha quem receberá os clientes."); return; }
    setLoading(true);
    setMessage(null);
    try {
    const response = await fetch(`/api/team/users/${seller.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false, transferToId }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? `Conta desativada. ${body.transferred} cliente(s) transferido(s) para ${body.transferToName}. Histórico preservado.` : body.error || "Não foi possível desativar.");
    if (response.ok) {
      setSellers((current) => current.map((item) => item.id === seller.id ? { ...item, active: false } : item));
      setDeactivationSeller(null); setTransferToId(""); router.refresh();
    }
    } catch { setMessage("Não foi possível confirmar a desativação. Atualize a página antes de tentar novamente."); }
    finally { setLoading(false); }
  }

  async function save() {
    setLoading(true);
    setMessage(null);
    const response = await fetch("/api/team/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowSellerCustomerTransfer: allowTransfer,
        orderFollowUpAssigneeId:orderFollowUpAssigneeId||null,
        sellers: sellers.map(({ id, followUpAfterDays, canTransferOwnCustomers,timeClockReminderEnabled,timeClockRequiredEvents,timeClockWorkingDays,timeClockStartMinutes,timeClockLunchStartMinutes,timeClockLunchEndMinutes,timeClockEndMinutes,timeClockReminderIntervalMinutes,commissionPercent,commissionMibroPercent,commissionSincrofitPercent }) => ({ id, followUpAfterDays, canTransferOwnCustomers,timeClockReminderEnabled,timeClockRequiredEvents,timeClockWorkingDays,timeClockStartMinutes,timeClockLunchStartMinutes,timeClockLunchEndMinutes,timeClockEndMinutes,timeClockReminderIntervalMinutes,commissionPercent,commissionMibroPercent,commissionSincrofitPercent })),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setLoading(false);
    if (response.ok) {
      setDirty(false);
      setMessage("Configurações salvas.");
    } else {
      setMessage(body.error || "Não foi possível salvar.");
    }
  }

  return (
    <div className="space-y-6">
      {deactivationSeller && <section className="card space-y-3 p-5" aria-labelledby="deactivation-title">
        <h2 id="deactivation-title" className="font-semibold">Desativar {deactivationSeller.displayName || deactivationSeller.name}</h2>
        <p className="text-sm text-gray-500">Quem receberá todos os clientes deste integrante? Os contatos e follow-ups pendentes serão repassados junto com a desativação. Propostas, vendas e histórico serão preservados.</p>
        <label className="label-field">Novo responsável
          <select className="input-field" value={transferToId} disabled={loading} onChange={(event) => setTransferToId(event.target.value)}>
            <option value="">Selecione o destino dos clientes</option>
            <option value={supervisor.id}>{supervisor.name} (Eu, supervisor)</option>
            {sellers.filter((item) => item.active && item.id !== deactivationSeller.id).map((item) => <option key={item.id} value={item.id}>{item.displayName || item.name}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary" disabled={loading || !transferToId} onClick={() => deactivate(deactivationSeller)}>{loading ? "Transferindo e desativando..." : "Transferir clientes e desativar"}</button><button type="button" className="btn-secondary" disabled={loading} onClick={() => { setDeactivationSeller(null); setTransferToId(""); }}>Cancelar</button></div>
      </section>}
      <div className="card p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Permissão geral da equipe</p>
        <p className="mb-4 mt-1 text-xs text-gray-500">O repasse só funciona quando a regra geral e a autorização individual abaixo estão habilitadas.</p>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={allowTransfer} onChange={(event) => { setAllowTransfer(event.target.checked); setDirty(true); }} />
          <span>
            <span className="block text-sm font-medium text-gray-800">Permitir repasse entre integrantes da minha equipe</span>
            <span className="mt-1 block text-xs text-gray-500">Nunca permite transferência para outra equipe. A autorização de cada pessoa continua obrigatória.</span>
          </span>
        </label>
        <div className="mt-5 border-t border-gray-100 pt-5">
          <label className="label-field">Responsável pelo acompanhamento dos pedidos</label>
          <select className="input-field max-w-md" value={orderFollowUpAssigneeId} onChange={(event)=>{setOrderFollowUpAssigneeId(event.target.value);setDirty(true);}}>
            <option value="">Não configurado</option>
            {assigneeOptions.map((option)=><option key={option.id} value={option.id}>{option.name} · {option.role}</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-500">O sistema avisa o supervisor; a comunicação com esta pessoa será feita externamente.</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700">Configuração de cada integrante</h2>
          <p className="mt-1 text-xs text-gray-500">Defina o prazo do follow-up e a autorização individual de repasse.</p>
        </div>
        <div className="divide-y divide-gray-100">
          {sellers.map((seller, index) => (
            <div key={seller.id} className="space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{seller.displayName || seller.name}</p>
                  {seller.displayName && <p className="text-xs text-gray-400">{seller.name}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge bg-gray-100 text-gray-700">{seller.role === "REPRESENTANTE" ? "Representante" : "Vendedor"}</span>
                  <span className={`badge ${seller.active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{seller.active ? "Ativo" : "Desativado"}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <label className="rounded-lg border border-gray-200 p-4">
                  <span className="block text-sm font-medium text-gray-800">Prazo do follow-up automático</span>
                  <span className="mt-1 block text-xs text-gray-500">Após estes dias sem interação ou venda, o cliente entra nos avisos.</span>
                  <span className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                    <input type="number" min={1} max={365} disabled={!seller.active} className="input-field w-24" value={seller.followUpAfterDays} onChange={(event) => {
                      const value = Number(event.target.value);
                      setDirty(true);
                      setSellers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, followUpAfterDays: value } : item));
                    }} /> dias
                  </span>
                </label>

                <label className="rounded-lg border border-gray-200 p-4">
                  <span className="block text-sm font-medium text-gray-800">Repasse de clientes próprios</span>
                  <span className="mt-1 block text-xs text-gray-500">Permite transferir somente para outro integrante desta mesma equipe.</span>
                  <span className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" disabled={!seller.active} checked={seller.canTransferOwnCustomers} onChange={(event) => {
                      const checked = event.target.checked;
                      setDirty(true);
                      setSellers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, canTransferOwnCustomers: checked } : item));
                    }} />
                    {seller.canTransferOwnCustomers && allowTransfer ? "Repasse liberado" : seller.canTransferOwnCustomers ? "Aguardando a permissão geral" : "Repasse bloqueado"}
                  </span>
                </label>

                {seller.role === "REPRESENTANTE" && <div className="rounded-lg border border-gray-200 p-4 lg:col-span-2">
                  <span className="block text-sm font-medium text-gray-800">Comissão editável</span>
                  <span className="mt-1 block text-xs text-gray-500">A taxa geral vale como padrão; Mibro e Sincrofit podem ter percentuais diferentes. Em branco = sem percentual registrado (usa o padrão do tipo, se houver). Mudanças preservam o histórico.</span>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {([['commissionPercent','Geral'],['commissionMibroPercent','Mibro'],['commissionSincrofitPercent','Sincrofit']] as const).map(([field,label])=><label key={field} className="text-xs text-gray-600">{label}<span className="mt-1 flex items-center gap-1"><input className="input-field" type="number" min="0" max="100" step="0.01" placeholder="Sem registro" value={seller[field] ?? ""} onChange={(event)=>{const value=event.target.value===""?null:Number(event.target.value);setDirty(true);setSellers((current)=>current.map((item,itemIndex)=>itemIndex===index?{...item,[field]:value}:item));}}/>%</span></label>)}
                  </div>
                  {seller.representativeProfile && <RepresentativeProfileEditor userId={seller.id} initial={seller.representativeProfile} />}
                </div>}

                {seller.role === "VENDEDOR" && <div className="rounded-lg border border-gray-200 p-4 lg:col-span-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-800"><input type="checkbox" checked={seller.timeClockReminderEnabled} onChange={(event)=>{setDirty(true);setSellers((current)=>current.map((item,itemIndex)=>itemIndex===index?{...item,timeClockReminderEnabled:event.target.checked}:item));}}/>Avisos de ponto no painel</label>
                  <div className="mt-3 flex flex-wrap gap-3">{(["CLOCK_IN","LUNCH_START","LUNCH_END","CLOCK_OUT"] as TimeClockEventValue[]).map((eventType)=><label key={eventType} className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={seller.timeClockRequiredEvents.includes(eventType)} onChange={(event)=>{const required=event.target.checked?[...seller.timeClockRequiredEvents,eventType]:seller.timeClockRequiredEvents.filter((item)=>item!==eventType);setDirty(true);setSellers((current)=>current.map((item,itemIndex)=>itemIndex===index?{...item,timeClockRequiredEvents:required}:item));}}/>{TIME_CLOCK_EVENT_LABELS[eventType]}</label>)}</div>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                    {([['timeClockStartMinutes','Entrada'],['timeClockLunchStartMinutes','Almoço'],['timeClockLunchEndMinutes','Retorno'],['timeClockEndMinutes','Saída']] as const).map(([field,label])=><label key={field} className="text-xs text-gray-600">{label}<input className="input-field mt-1" type="time" value={minutesToTime(seller[field])} onChange={(event)=>{setDirty(true);setSellers((current)=>current.map((item,itemIndex)=>itemIndex===index?{...item,[field]:timeToMinutes(event.target.value)}:item));}}/></label>)}
                    <label className="text-xs text-gray-600">Repetir a cada<input className="input-field mt-1" type="number" min="5" max="180" value={seller.timeClockReminderIntervalMinutes} onChange={(event)=>{setDirty(true);setSellers((current)=>current.map((item,itemIndex)=>itemIndex===index?{...item,timeClockReminderIntervalMinutes:Number(event.target.value)}:item));}}/></label>
                  </div>
                </div>}
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className={`badge ${seller.role === "VENDEDOR" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>Meta: {seller.role === "VENDEDOR" ? "habilitada" : "não se aplica"}</span>
                <span className={`badge ${seller.role === "VENDEDOR" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>Ponto: {seller.role === "VENDEDOR" ? "habilitado" : "não se aplica"}</span>
                {seller.role === "REPRESENTANTE" && <span className="badge bg-blue-100 text-blue-700">Comissão variável visível ao supervisor</span>}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                <Link className="btn-secondary" href={`/contas/${seller.id}/historico`}>Ver histórico da conta</Link>
                {seller.active && <button type="button" className="btn-secondary text-red-700" disabled={loading} onClick={() => { setDeactivationSeller(seller); setTransferToId(""); setMessage(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Desativar acesso</button>}
              </div>
            </div>
          ))}
          {sellers.length === 0 && <p className="p-6 text-sm text-gray-400">Nenhum vendedor ou representante vinculado.</p>}
        </div>
      </div>

      {message && <p className="text-sm text-gray-600">{message}</p>}
      <button className="btn-primary" onClick={save} disabled={loading || !dirty}>{loading ? "Salvando..." : "Salvar configurações"}</button>

      {dirty && (
        <div className="fixed bottom-14 left-3 right-3 z-30 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-xl md:bottom-4 md:left-auto md:right-6 md:w-auto">
          <span className="text-sm font-medium text-gray-700">Configurações não salvas.</span>
          <button className="btn-primary shrink-0" onClick={save} disabled={loading}>{loading ? "Salvando..." : "Salvar configurações"}</button>
        </div>
      )}
    </div>
  );
}
