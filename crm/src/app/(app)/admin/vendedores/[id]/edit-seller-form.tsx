"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface UserData {
  id: string;
  name: string;
  rca: string | null;
  role: string;
  active: boolean;
  supervisorId: string | null;
  followUpAfterDays: number;
  allowSellerCustomerTransfer: boolean;
  canTransferOwnCustomers: boolean;
  canCreateTeamUsers: boolean;
  timeClockReminderEnabled:boolean;
  timeClockRequiredEvents:Array<"CLOCK_IN"|"LUNCH_START"|"LUNCH_END"|"CLOCK_OUT">;
  timeClockWorkingDays:number[];
  timeClockStartMinutes:number;
  timeClockLunchStartMinutes:number;
  timeClockLunchEndMinutes:number;
  timeClockEndMinutes:number;
  timeClockReminderIntervalMinutes:number;
  sellerProfile: {
    displayName: string;
    phone: string | null;
    whatsapp: string | null;
    jobTitle: string | null;
    region: string | null;
    monthlyGoalCents: number | null;
    internalNotes: string | null;
  } | null;
}

export function EditSellerForm({
  user,
  supervisors,
}: {
  user: UserData;
  supervisors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [rca, setRca] = useState(user.rca ?? "");
  const [role, setRole] = useState(user.role);
  const [active, setActive] = useState(user.active);
  const [supervisorId, setSupervisorId] = useState(user.supervisorId ?? "");
  const [followUpAfterDays, setFollowUpAfterDays] = useState(user.followUpAfterDays);
  const [allowSellerCustomerTransfer, setAllowSellerCustomerTransfer] = useState(
    user.allowSellerCustomerTransfer
  );
  const [canTransferOwnCustomers, setCanTransferOwnCustomers] = useState(user.canTransferOwnCustomers);
  const [canCreateTeamUsers, setCanCreateTeamUsers] = useState(user.canCreateTeamUsers);
  const [timeClockReminderEnabled,setTimeClockReminderEnabled]=useState(user.timeClockReminderEnabled);
  const [timeClockRequiredEvents,setTimeClockRequiredEvents]=useState(user.timeClockRequiredEvents);
  const [timeClockStartMinutes,setTimeClockStartMinutes]=useState(user.timeClockStartMinutes);
  const [timeClockLunchStartMinutes,setTimeClockLunchStartMinutes]=useState(user.timeClockLunchStartMinutes);
  const [timeClockLunchEndMinutes,setTimeClockLunchEndMinutes]=useState(user.timeClockLunchEndMinutes);
  const [timeClockEndMinutes,setTimeClockEndMinutes]=useState(user.timeClockEndMinutes);
  const [timeClockReminderIntervalMinutes,setTimeClockReminderIntervalMinutes]=useState(user.timeClockReminderIntervalMinutes);

  // Campos comerciais (SellerProfile) — o usuário pode ainda não ter um
  // registro (ex.: um ADMIN puramente administrativo); a API cria um sob
  // demanda ao salvar.
  const [displayName, setDisplayName] = useState(user.sellerProfile?.displayName ?? user.name);
  const [phone, setPhone] = useState(user.sellerProfile?.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(user.sellerProfile?.whatsapp ?? "");
  const [jobTitle, setJobTitle] = useState(user.sellerProfile?.jobTitle ?? "");
  const [region, setRegion] = useState(user.sellerProfile?.region ?? "");
  const [monthlyGoalCents, setMonthlyGoalCents] = useState(
    user.sellerProfile?.monthlyGoalCents != null ? String(user.sellerProfile.monthlyGoalCents / 100) : ""
  );
  const [internalNotes, setInternalNotes] = useState(user.sellerProfile?.internalNotes ?? "");

  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  async function save(extra?: Record<string, unknown>) {
    setLoading(true);
    setMessage(null);
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        ...(rca.trim() && rca.trim() !== user.rca ? { rca: rca.trim() } : {}),
        role,
        active,
        supervisorId: supervisorId || null,
        followUpAfterDays,
        allowSellerCustomerTransfer,
        canTransferOwnCustomers,
        canCreateTeamUsers,
        timeClockReminderEnabled,timeClockRequiredEvents,timeClockWorkingDays:user.timeClockWorkingDays,timeClockStartMinutes,timeClockLunchStartMinutes,timeClockLunchEndMinutes,timeClockEndMinutes,timeClockReminderIntervalMinutes,
        displayName,
        phone,
        whatsapp,
        jobTitle,
        region,
        monthlyGoalCents: role === "REPRESENTANTE" ? null : monthlyGoalCents ? Math.round(parseFloat(monthlyGoalCents) * 100) : null,
        internalNotes,
        ...extra,
      }),
    });
    setLoading(false);
    if (res.ok) {
      setMessage("Salvo com sucesso.");
      setNewPassword("");
      setDirty(false);
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setMessage(body.error || "Erro ao salvar.");
    }
  }

  return (
    <div
      className="space-y-6"
      onChange={(event) => {
        if (!(event.target as HTMLElement).hasAttribute("data-ignore-dirty")) setDirty(true);
      }}
    >
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Acesso</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label-field">Nome</label>
            <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label-field">RCA (código do usuário)</label>
            <input className="input-field" inputMode="numeric" maxLength={6} value={rca} onChange={(e) => setRca(e.target.value)} placeholder="Ex.: 027" />
            <p className="mt-1 text-xs text-gray-400">Único e pesquisável. Gerado automaticamente; altere só se necessário.</p>
          </div>
          <div>
            <label className="label-field">Papel</label>
            <select className="input-field" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="VENDEDOR">Vendedor</option>
              <option value="REPRESENTANTE">Representante</option>
              <option value="SUPERVISOR">Supervisor</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </div>
          <div>
            <label className="label-field">Supervisor</label>
            <select className="input-field" value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
              <option value="">Sem supervisor</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              id="active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <label htmlFor="active" className="text-sm text-gray-700">
              Usuário ativo
            </label>
          </div>
          <div>
            <label className="label-field">Aviso sem interação/venda (dias)</label>
            <input
              className="input-field"
              type="number"
              min={1}
              max={365}
              value={followUpAfterDays}
              onChange={(e) => setFollowUpAfterDays(Number(e.target.value))}
            />
          </div>
          {role === "SUPERVISOR" && (
            <div className="space-y-3 pt-6">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={allowSellerCustomerTransfer} onChange={(e) => setAllowSellerCustomerTransfer(e.target.checked)} />
                Permitir repasse entre vendedores da equipe
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={canCreateTeamUsers} onChange={(e) => setCanCreateTeamUsers(e.target.checked)} />
                Pode criar vendedores e representantes da própria equipe
              </label>
            </div>
          )}
          {(role === "VENDEDOR" || role === "REPRESENTANTE") && (
            <label className="flex items-center gap-2 pt-6 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={canTransferOwnCustomers}
                onChange={(e) => setCanTransferOwnCustomers(e.target.checked)}
              />
              Pode repassar clientes da própria carteira
            </label>
          )}
          {(role === "VENDEDOR" || role === "SUPERVISOR") && <div className="sm:col-span-2 rounded-lg border border-gray-200 p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-800"><input type="checkbox" checked={timeClockReminderEnabled} onChange={(event)=>setTimeClockReminderEnabled(event.target.checked)}/>Avisos de ponto no painel</label>
            <div className="mt-3 flex flex-wrap gap-3">{([['CLOCK_IN','Entrada'],['LUNCH_START','Almoço'],['LUNCH_END','Retorno'],['CLOCK_OUT','Saída']] as const).map(([eventType,label])=><label key={eventType} className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={timeClockRequiredEvents.includes(eventType)} onChange={(event)=>setTimeClockRequiredEvents((current)=>event.target.checked?[...current,eventType]:current.filter((item)=>item!==eventType))}/>{label}</label>)}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{([[timeClockStartMinutes,setTimeClockStartMinutes,'Entrada'],[timeClockLunchStartMinutes,setTimeClockLunchStartMinutes,'Almoço'],[timeClockLunchEndMinutes,setTimeClockLunchEndMinutes,'Retorno'],[timeClockEndMinutes,setTimeClockEndMinutes,'Saída']] as const).map(([value,setValue,label])=><label key={label} className="text-xs text-gray-600">{label}<input className="input-field mt-1" type="time" value={`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`} onChange={(event)=>{const [hour,minute]=event.target.value.split(':').map(Number);setValue(hour*60+minute);}}/></label>)}<label className="text-xs text-gray-600">Repetição (min.)<input className="input-field mt-1" type="number" min="5" max="180" value={timeClockReminderIntervalMinutes} onChange={(event)=>setTimeClockReminderIntervalMinutes(Number(event.target.value))}/></label></div>
          </div>}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn-primary" onClick={() => save()} disabled={loading || !dirty}>
            {loading ? "Salvando..." : "Salvar opções de acesso"}
          </button>
          {!dirty && <span className="text-xs text-gray-400">Nenhuma alteração pendente.</span>}
        </div>
        {message && <p className="mt-3 text-sm text-gray-600">{message}</p>}
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">
          Perfil comercial
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label-field">Nome de exibição</label>
            <input className="input-field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <label className="label-field">Cargo</label>
            <input className="input-field" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </div>
          <div>
            <label className="label-field">Telefone</label>
            <input className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label-field">WhatsApp</label>
            <input className="input-field" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </div>
          <div>
            <label className="label-field">Região</label>
            <input className="input-field" value={region} onChange={(e) => setRegion(e.target.value)} />
          </div>
          {role !== "REPRESENTANTE" && <div>
            <label className="label-field">Meta mensal (R$)</label>
            <input
              className="input-field"
              type="number"
              min="0"
              step="0.01"
              value={monthlyGoalCents}
              onChange={(e) => setMonthlyGoalCents(e.target.value)}
            />
          </div>}
        </div>
        <div className="mt-3">
          <label className="label-field">Observações internas</label>
          <textarea
            className="input-field"
            rows={3}
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
          />
        </div>
      </div>

      <button className="btn-primary" onClick={() => save()} disabled={loading}>
        {loading ? "Salvando..." : "Salvar alterações"}
      </button>

      <div className="pt-4 border-t border-gray-100">
        <label className="label-field">Redefinir senha</label>
        <div className="flex gap-3">
          <input
            className="input-field"
            type="password"
            placeholder="Nova senha (mín. 8 caracteres)"
            minLength={8}
            data-ignore-dirty
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <button
            className="btn-secondary shrink-0"
            onClick={() => newPassword && save({ newPassword })}
            disabled={loading || newPassword.length < 8}
          >
            Redefinir
          </button>
        </div>
      </div>

      {dirty && (
        <div className="fixed bottom-14 left-3 right-3 z-30 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-xl md:bottom-4 md:left-auto md:right-6 md:w-auto">
          <span className="text-sm font-medium text-gray-700">Há alterações não salvas.</span>
          <button className="btn-primary shrink-0" onClick={() => save()} disabled={loading}>
            {loading ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      )}
    </div>
  );
}
