"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Brand = "MIBRO" | "SINCROFIT";
interface User { id: string; name: string; role: string; functions: string[]; supervisor: string | null }
interface Link { userId: string; brand: Brand; olistSellerId: string; olistSellerName: string; active: boolean; updatedAt: string }
interface Limit { scopeKey: string; brandKey: string; maxDiscountBps: number }
interface OlistSeller { id: string; name: string; code: string | null; situation: string | null }

const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", SUPERVISOR: "Supervisor", VENDEDOR: "Vendedor", REPRESENTANTE: "Representante" };
const LIMIT_SCOPES: Array<[string, string]> = [
  ["ROLE:VENDEDOR", "Vendedor (acima disto exige justificativa)"],
  ["ROLE:REPRESENTANTE", "Representante"],
  ["ROLE:SUPERVISOR", "Supervisor (aprova até)"],
  ["FUNCTION:GERENTE_COMERCIAL", "Gerente comercial (aprova até; vazio = sem teto)"],
];

async function post(body: unknown) {
  const response = await fetch("/api/proposals/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = response ? await response.json().catch(() => ({})) : {};
  return response?.ok ? null : (data.error as string) ?? "Falha na operação.";
}

export function ProposalAdmin({ users, links, limits }: { users: User[]; links: Link[]; limits: Limit[] }) {
  const router = useRouter();
  const [brand, setBrand] = useState<Brand>("MIBRO");
  const [sellers, setSellers] = useState<Record<Brand, OlistSeller[] | null>>({ MIBRO: null, SINCROFIT: null });
  const [pick, setPick] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const commercialUsers = users.filter((u) => u.role !== "ADMIN" || links.some((l) => l.userId === u.id));
  const limitOf = (scope: string, b: string) => limits.find((l) => l.scopeKey === scope && l.brandKey === b)?.maxDiscountBps;

  async function run(body: unknown, ok: string) {
    setBusy(true);
    setMessage(null);
    const error = await post(body);
    setBusy(false);
    setMessage(error ? { ok: false, text: error } : { ok: true, text: ok });
    if (!error) router.refresh();
  }

  async function loadSellers() {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/proposals/admin?brand=${brand}`).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) return setMessage({ ok: false, text: data.error ?? "Não foi possível consultar o Olist." });
    setSellers((s) => ({ ...s, [brand]: data.sellers }));
  }

  return (
    <div className="space-y-4">
      {message && <p className={`text-sm ${message.ok ? "text-green-700" : "text-red-600"}`} role="status">{message.text}</p>}

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Vínculo de vendedores com o Olist</h2>
          <div className="flex gap-2 text-xs">
            {(["MIBRO", "SINCROFIT"] as Brand[]).map((b) => (
              <button key={b} type="button" onClick={() => setBrand(b)} className={`rounded-full border px-3 py-1 ${brand === b ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 text-gray-600"}`}>{b === "MIBRO" ? "Mibro" : "Sincrofit"}</button>
            ))}
            <button type="button" className="btn-secondary" disabled={busy} onClick={loadSellers}>{sellers[brand] ? "Recarregar" : "Carregar"} vendedores do Olist</button>
          </div>
        </div>
        <p className="text-xs text-gray-500">O ID do usuário do CRM não é o ID do vendedor no Olist. O vínculo é conferido na lista oficial do Olist ao salvar; cada vendedor do Olist só pode estar ligado a um usuário.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">Usuário</th>
                <th className="px-3 py-2 font-medium">Cargo / equipe</th>
                <th className="px-3 py-2 font-medium">Vínculo atual</th>
                <th className="px-3 py-2 font-medium">Vendedor no Olist</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {commercialUsers.map((u) => {
                const link = links.find((l) => l.userId === u.id && l.brand === brand);
                return (
                  <tr key={u.id}>
                    <td className="px-3 py-2">{u.name}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{ROLE_LABEL[u.role] ?? u.role}{u.supervisor ? ` · ${u.supervisor}` : ""}</td>
                    <td className="px-3 py-2 text-xs">{link ? `${link.olistSellerName} (id ${link.olistSellerId})${link.active ? "" : " — inativo"}` : <span className="text-gray-400">sem vínculo</span>}</td>
                    <td className="px-3 py-2">
                      {sellers[brand] ? (
                        <select className="input-field" value={pick[`${u.id}:${brand}`] ?? link?.olistSellerId ?? ""} onChange={(e) => setPick((s) => ({ ...s, [`${u.id}:${brand}`]: e.target.value }))}>
                          <option value="">Selecione</option>
                          {sellers[brand]!.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` · ${s.code}` : ""}{s.situation === "I" || s.situation === "E" ? " (inativo)" : ""}</option>)}
                        </select>
                      ) : <span className="text-xs text-gray-400">carregue a lista</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {sellers[brand] && pick[`${u.id}:${brand}`] && pick[`${u.id}:${brand}`] !== link?.olistSellerId && (
                          <button type="button" className="btn-secondary" disabled={busy} onClick={() => run({ op: "link", userId: u.id, brand, olistSellerId: pick[`${u.id}:${brand}`] }, `Vínculo de ${u.name} salvo.`)}>Salvar</button>
                        )}
                        {link?.active && <button type="button" className="text-xs text-red-600 underline" disabled={busy} onClick={() => run({ op: "unlink", userId: u.id, brand }, `Vínculo de ${u.name} desativado.`)}>Desativar</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-gray-700">Alçadas de desconto (%)</h2>
        <p className="text-xs text-gray-500">Sem valor configurado não existe alçada: supervisor só aprova propostas sem desconto e qualquer desconto exige justificativa do vendedor. Gerente sem valor aprova qualquer desconto; acima do teto do gerente, só o administrador.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr><th className="px-3 py-2 font-medium">Escopo</th><th className="px-3 py-2 font-medium">Todas as empresas</th><th className="px-3 py-2 font-medium">Mibro</th><th className="px-3 py-2 font-medium">Sincrofit</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {LIMIT_SCOPES.map(([scope, label]) => (
                <tr key={scope}>
                  <td className="px-3 py-2 text-xs">{label}</td>
                  {["*", "MIBRO", "SINCROFIT"].map((b) => (
                    <td key={b} className="px-3 py-2">
                      <LimitInput initial={limitOf(scope, b)} disabled={busy} onSave={(bps) => run({ op: "limit", scopeKey: scope, brandKey: b, maxDiscountBps: bps }, "Alçada salva.")} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-gray-700">Funções comerciais</h2>
        <p className="text-xs text-gray-500">Somam-se ao cargo. Gerente comercial: vê todas as propostas, aprova descontos excepcionais, transfere e autoriza conversões. Financeiro: vê propostas aprovadas e pedidos, consulta recebimentos e registra conferências; não altera condições comerciais.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-gray-50 text-left text-gray-600"><tr><th className="px-3 py-2 font-medium">Usuário</th><th className="px-3 py-2 font-medium">Cargo</th><th className="px-3 py-2 font-medium">Gerente comercial</th><th className="px-3 py-2 font-medium">Financeiro</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{ROLE_LABEL[u.role] ?? u.role}</td>
                  {(["GERENTE_COMERCIAL", "FINANCEIRO"] as const).map((fn) => (
                    <td key={fn} className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`${fn === "FINANCEIRO" ? "Financeiro" : "Gerente comercial"} — ${u.name}`}
                        className="h-5 w-5"
                        disabled={busy}
                        checked={u.functions.includes(fn)}
                        onChange={(e) => run({ op: "functions", userId: u.id, functions: e.target.checked ? [...u.functions, fn] : u.functions.filter((x) => x !== fn) }, `Funções de ${u.name} atualizadas.`)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function LimitInput({ initial, disabled, onSave }: { initial: number | undefined; disabled: boolean; onSave: (bps: number | null) => void }) {
  const [value, setValue] = useState(initial === undefined ? "" : String(initial / 100).replace(".", ","));
  const parsed = value.trim() === "" ? null : Math.round(Number(value.replace(",", ".")) * 100);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0 && parsed <= 10_000);
  const changed = (initial ?? null) !== parsed;
  return (
    <div className="flex items-center gap-1">
      <input inputMode="decimal" className="input-field w-20" value={value} onChange={(e) => setValue(e.target.value)} placeholder="—" />
      {changed && valid && <button type="button" className="text-xs underline" disabled={disabled} onClick={() => onSave(parsed)}>Salvar</button>}
      {!valid && <span className="text-[11px] text-red-600">0 a 100</span>}
    </div>
  );
}
