"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toDateKey } from "@/lib/agenda-rules";
import { activityActionRequest } from "@/lib/activity-center-actions";
import {
  ACTIVITY_GROUP_LABELS,
  ACTIVITY_SOURCE_LABELS,
  filterActivities,
  groupActivities,
  summarizeByAssignee,
  type ActivityFilters,
  type ActivityItem,
  type ActivitySource,
} from "@/lib/activity-center-rules";

type CentralStatus = "ok" | "unlinked" | "unavailable" | "no-company" | "forbidden";
interface Feed {
  now: string;
  company: string;
  scope: "mine" | "team";
  horizonDays: number;
  items: ActivityItem[];
  crm: { truncated: boolean };
  central: { status: CentralStatus; counts: { overdue: number; today: number } | null; truncated: boolean };
}

const TIME_ZONE = "America/Sao_Paulo";
const whenFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, weekday: "short", day: "2-digit", month: "2-digit" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const REFRESH_ON_FOCUS_MS = 60_000;

const SOURCE_STYLE: Record<ActivitySource, string> = {
  CRM_AGENDA: "border-sky-500/40 text-sky-700 dark:text-sky-300",
  CRM_RECOMPRA: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  CENTRAL: "border-orange-500/40 text-orange-700 dark:text-orange-300",
};

function when(item: ActivityItem) {
  return item.allDay ? `${dayFormat.format(new Date(item.at))} · dia inteiro` : whenFormat.format(new Date(item.at));
}

export function ActivityCenter({
  embedded,
  initialCompany,
  canViewTeam,
  attendanceOrigin,
}: {
  embedded: boolean;
  initialCompany: string;
  canViewTeam: boolean;
  /** Origem pública da Central (somente para contas vinculadas). */
  attendanceOrigin?: string;
}) {
  const [company, setCompany] = useState(initialCompany);
  const [companies, setCompanies] = useState<Array<{ slug: string; name: string }>>([]);
  // Sem empresa definida, espera a lista de empresas antes da primeira consulta.
  const [optionsReady, setOptionsReady] = useState(!attendanceOrigin || !!initialCompany);
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const requestKey = `${company}:${scope}`;
  const [snapshot, setSnapshot] = useState<{ key: string; data: Feed } | null>(null);
  // Never expose the previous company/scope, not even before effects run.
  const feed = snapshot?.key === requestKey ? snapshot.data : null;
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const error = failure?.key === requestKey ? failure.message : "";
  const [optionsError, setOptionsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [filters, setFilters] = useState<ActivityFilters>({ source: "", priority: "", q: "" });
  const loadedAt = useRef(0);

  // Empresas do Atendimento permitidas ao usuário (a Central decide).
  useEffect(() => {
    if (!attendanceOrigin) return;
    const controller = new AbortController();
    fetch("/api/attendance-context?options=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível consultar suas empresas. Atualize a página para tentar novamente.");
        const list = ((await response.json()).companies || []) as Array<{ slug: string; name: string }>;
        if (controller.signal.aborted) return;
        setCompanies(list);
        setCompany((current) => current || list[0]?.slug || "");
      })
      .catch((error) => { if (!controller.signal.aborted) setOptionsError((error as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setOptionsReady(true); });
    return () => controller.abort();
  }, [attendanceOrigin]);

  useEffect(() => {
    if (!optionsReady) return;
    const controller = new AbortController();
    setBusy(true);
    setFailure(null);
    fetch("/api/activity-center?" + new URLSearchParams({ company, scope }), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Não foi possível carregar as atividades.");
        if (controller.signal.aborted) return;
        if (body.company !== company || body.scope !== scope || !Array.isArray(body.items)) throw new Error("O contexto de acesso mudou. Atualize a página para consultar as atividades com segurança.");
        setSnapshot({ key: requestKey, data: body as Feed });
        loadedAt.current = Date.now();
      })
      .catch((failure) => { if (!controller.signal.aborted) setFailure({ key: requestKey, message: (failure as Error).message }); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [company, scope, reload, optionsReady, requestKey]);

  // Sem polling: só relê ao voltar para a aba depois de um minuto.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > REFRESH_ON_FOCUS_MS) setReload((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const now = useMemo(() => (feed ? new Date(feed.now) : new Date()), [feed]);
  const visible = useMemo(() => filterActivities(feed?.items || [], filters), [feed, filters]);
  const groups = useMemo(() => groupActivities(visible, now), [visible, now]);
  const team = useMemo(() => (scope === "team" ? summarizeByAssignee(visible, now) : null), [scope, visible, now]);
  const count = (group: string) => groups.find((entry) => entry.group === group)?.items.length || 0;
  const unassigned = useMemo(() => visible.filter((item) => !item.assignee && item.state !== "CONCLUIDO").length, [visible]);

  const links = useMemo(() => linkBuilder(embedded, attendanceOrigin), [embedded, attendanceOrigin]);

  return (
    <div className={embedded ? "crm-app-shell min-h-screen min-w-0 p-4 sm:p-5" : "min-w-0"}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Central de Atividades</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Agenda do CRM, follow-ups de recompra e retornos da Central em um só lugar, nos próximos {feed?.horizonDays ?? 14} dias.
            Cada atividade continua no sistema de origem: concluir ou reagendar aqui altera o registro original, sem cópias.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canViewTeam ? (
            <div className="inline-flex overflow-hidden rounded-lg border border-gray-200" role="group" aria-label="Escopo">
              {(["mine", "team"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setScope(value)} aria-pressed={scope === value}
                  className={`px-3 py-2 text-sm ${scope === value ? "bg-gray-100 font-semibold text-gray-900" : "text-gray-500"}`}>
                  {value === "mine" ? "Minhas" : "Equipe"}
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={refresh} disabled={busy}>{busy ? "Atualizando…" : "Atualizar"}</button>
        </div>
      </header>

      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {attendanceOrigin ? (
          <label className="text-xs text-gray-500">Empresa do Atendimento
            <select className="input-field mt-1 block w-full" value={company} onChange={(event) => setCompany(event.target.value)} disabled={!companies.length}>
              {companies.length ? null : <option value={company}>{optionsReady ? "Nenhuma empresa disponível" : "Carregando…"}</option>}
              {company && companies.length > 0 && !companies.some((item) => item.slug === company) ? <option value={company}>Empresa selecionada — sem acesso</option> : null}
              {companies.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="text-xs text-gray-500">Origem
          <select className="input-field mt-1 block w-full" value={filters.source} onChange={(event) => setFilters((f) => ({ ...f, source: event.target.value as ActivitySource | "" }))}>
            <option value="">Todas</option>
            {(Object.keys(ACTIVITY_SOURCE_LABELS) as ActivitySource[]).map((source) => <option key={source} value={source}>{ACTIVITY_SOURCE_LABELS[source]}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500">Prioridade
          <select className="input-field mt-1 block w-full" value={filters.priority} onChange={(event) => setFilters((f) => ({ ...f, priority: event.target.value as ActivityFilters["priority"] }))}>
            <option value="">Todas</option>
            <option value="ALTA_OU_MAIS">Alta ou urgente</option>
          </select>
        </label>
        <label className="text-xs text-gray-500">Buscar
          <input type="search" className="input-field mt-1 block w-full" maxLength={100} placeholder="Cliente, título ou responsável" value={filters.q} onChange={(event) => setFilters((f) => ({ ...f, q: event.target.value }))} />
        </label>
      </div>

      <CentralNotice status={feed?.central.status} linked={!!attendanceOrigin} />
      {optionsError ? <p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-300">{optionsError}</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {feed?.crm.truncated || feed?.central.truncated ? <p className="mt-3 text-xs text-gray-500">Lista limitada a até 200 pendentes e 30 concluídas por origem. Use a agenda de origem para ver todos os registros.</p> : null}

      <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Resumo">
        <Counter label="Atrasadas" value={count("ATRASADAS")} tone="critical" />
        <Counter label="Hoje" value={count("HOJE")} tone="warning" />
        <Counter label="Próximos dias" value={count("AMANHA") + count("PROXIMOS")} />
        <Counter label="Concluídas (7 dias)" value={count("CONCLUIDAS")} />
        <Counter label="Sem responsável" value={unassigned} tone={unassigned ? "warning" : undefined} />
      </section>

      {team ? <TeamSummary rows={team.rows} /> : null}

      {!feed && (busy || !optionsReady) ? <p className="mt-6 text-sm text-gray-500" role="status">Carregando atividades…</p> : null}
      {feed ? groups.map(({ group, items }) => (
        <section key={group} className="mt-6">
          <h2 className={`mb-2 text-sm font-semibold ${group === "ATRASADAS" && items.length ? "text-red-600" : "text-gray-700"}`}>{ACTIVITY_GROUP_LABELS[group]} ({items.length})</h2>
          {items.length ? (
            <ul className="space-y-2">{items.map((item) => <ActivityRow key={`${requestKey}:${item.key}:${item.at}:${item.completedAt}`} item={item} links={links} onChanged={refresh} disabled={busy} />)}</ul>
          ) : <p className="text-xs text-gray-500">Nada aqui.</p>}
        </section>
      )) : null}
    </div>
  );
}

function CentralNotice({ status, linked }: { status?: CentralStatus; linked: boolean }) {
  if (!status || status === "ok") return null;
  const text = {
    unlinked: linked ? "Não foi possível validar o acesso ao Atendimento. Entre novamente pela Central para ver os retornos de lá." : "Retornos da Central aparecem para contas vinculadas ao Atendimento. As atividades do CRM abaixo estão completas.",
    unavailable: "A Agenda da Central não respondeu agora. As atividades do CRM abaixo estão atualizadas; os retornos da Central não foram omitidos por falta de registros.",
    "no-company": "Escolha a empresa do Atendimento para incluir os retornos da Central.",
    forbidden: "Sua conta não tem acesso a esta empresa no Atendimento. Escolha outra empresa.",
  }[status];
  return <p role="status" className={`mt-3 rounded-lg border px-3 py-2 text-sm ${status === "unavailable" ? "border-amber-400 text-amber-700 dark:text-amber-300" : "border-gray-200 text-gray-500"}`}>{text}</p>;
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: "critical" | "warning" }) {
  const color = tone === "critical" && value ? "text-red-600" : tone === "warning" && value ? "text-amber-600" : "text-gray-900";
  return <div className="card border px-3 py-2"><span className="block text-xs text-gray-500">{label}</span><strong className={`text-lg ${color}`}>{value}</strong></div>;
}

function TeamSummary({ rows }: { rows: ReturnType<typeof summarizeByAssignee>["rows"] }) {
  if (!rows.length) return null;
  return (
    <section className="card mt-4 overflow-x-auto border p-3" aria-label="Carga por responsável">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Carga por responsável</h2>
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead className="text-xs text-gray-500"><tr><th className="py-1 font-medium">Responsável</th><th className="font-medium">Pendentes</th><th className="font-medium">Atrasadas</th><th className="font-medium">Hoje</th><th className="font-medium">Concluídas (7 dias)</th></tr></thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.key}><td className="py-1.5 text-gray-900">{row.name}</td><td>{row.pending}</td><td className={row.overdue ? "font-semibold text-red-600" : ""}>{row.overdue}</td><td>{row.today}</td><td>{row.done}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-500">Para redistribuir, abra a atividade na agenda de origem: lá valem as regras de responsável e de carteira de cada sistema. Delegar uma tarefa não transfere o cliente.</p>
    </section>
  );
}

type Links = ReturnType<typeof linkBuilder>;
function linkBuilder(embedded: boolean, attendance?: string) {
  const target = embedded ? "_top" : "_self";
  const crm = (path: string, shellParams: Record<string, string> | null) =>
    embedded ? (attendance && shellParams ? `${attendance}/crm?${new URLSearchParams({ connect: "1", ...shellParams })}` : null) : path;
  return {
    target,
    customer: (id: string) => crm(`/clientes/${encodeURIComponent(id)}`, { customer: id }),
    appointment: (id: string) => crm(`/agenda?open=${encodeURIComponent(id)}`, { agenda: id }),
    repurchase: () => crm("/follow-ups?tab=atrasados", { followups: "1" }),
    conversation: (id: string) => attendance ? (embedded ? `${attendance}/?conversation=${encodeURIComponent(id)}` : `${attendance}/identity/start?conversation=${encodeURIComponent(id)}`) : null,
    centralAgenda: (id: string) => attendance ? `${attendance}/agenda?followUp=${encodeURIComponent(id)}` : null,
  };
}

function ActivityRow({ item, links, onChanged, disabled }: { item: ActivityItem; links: Links; onChanged: () => void; disabled: boolean }) {
  const [mode, setMode] = useState<"idle" | "complete" | "reschedule">("idle");
  const [date, setDate] = useState(() => toDateKey(item.state === "ATRASADO" ? new Date() : item.at));
  const [time, setTime] = useState(() => (item.allDay ? "09:00" : timeFormat.format(new Date(item.at))));
  const [conflict, setConflict] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function send(action: "COMPLETE" | "RESCHEDULE", confirmConflicts = false) {
    setSaving(true);
    setError("");
    try {
      if (saving || disabled) return;
      const request = activityActionRequest(item, action, date, time, confirmConflicts);
      const response = await fetch(request.url, { method: request.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && body.code === "CONFLICT") { setConflict(body.error || "Há outro compromisso próximo deste horário."); return; }
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar.");
      setMode("idle");
      setConflict("");
      onChanged();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const customerHref = item.customer ? links.customer(item.customer.id) : null;
  const originHref = item.source === "CRM_AGENDA" ? links.appointment(item.id) : item.source === "CENTRAL" ? links.centralAgenda(item.id) : links.repurchase();
  const conversationHref = item.conversationId ? links.conversation(item.conversationId) : null;

  return (
    <li className={`card min-w-0 break-words border p-3 ${item.state === "ATRASADO" ? "border-l-4 border-l-red-500" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full border px-2 py-0.5 ${SOURCE_STYLE[item.source]}`}>{ACTIVITY_SOURCE_LABELS[item.source]}</span>
        <span className="text-gray-500">{item.kind}</span>
        {item.company ? <span className="rounded-full border border-gray-200 px-2 py-0.5 text-gray-500">{item.company.name}</span> : <span className="text-gray-500">· cadastro compartilhado do CRM</span>}
        {item.priority === "ALTA" || item.priority === "URGENTE" ? <span className="rounded-full border border-red-400/50 px-2 py-0.5 text-red-600">{item.priority === "URGENTE" ? "Urgente" : "Alta"}</span> : null}
        <time className={`ml-auto ${item.state === "ATRASADO" ? "font-semibold text-red-600" : "text-gray-500"}`} dateTime={item.at}>
          {item.state === "CONCLUIDO" && item.completedAt ? `Concluída ${whenFormat.format(new Date(item.completedAt))}` : `${item.state === "ATRASADO" ? "Atrasada · " : ""}${when(item)}`}
        </time>
      </div>
      <p className="mt-1 font-medium text-gray-900">{item.title}</p>
      <p className="text-xs text-gray-500">
        {item.customer ? <>Cliente: {item.customer.name} · </> : null}
        Responsável: {item.assignee?.name || <span className="text-amber-600">sem responsável</span>}
      </p>
      {item.note ? <p className="mt-1 line-clamp-2 text-xs text-gray-600">{item.note}</p> : null}

      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {conversationHref ? <a className="btn-secondary px-2 py-1" href={conversationHref} target={links.target}>Abrir conversa</a> : null}
        {customerHref ? <a className="btn-secondary px-2 py-1" href={customerHref} target={links.target}>Abrir cliente</a> : null}
        {originHref ? <a className="btn-secondary px-2 py-1" href={originHref} target={links.target}>Abrir na agenda de origem</a> : null}
        {item.canEdit && mode === "idle" ? (
          <>
            <button type="button" className="btn-secondary px-2 py-1" disabled={disabled} onClick={() => setMode("complete")}>Concluir</button>
            <button type="button" className="btn-secondary px-2 py-1" disabled={disabled} onClick={() => setMode("reschedule")}>Reagendar</button>
          </>
        ) : null}
      </div>

      {mode === "complete" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-600">Confirmar conclusão no sistema de origem?</span>
          <button type="button" className="btn-primary px-2 py-1" disabled={saving} onClick={() => send("COMPLETE")}>{saving ? "Salvando…" : "Confirmar"}</button>
          <button type="button" className="btn-secondary px-2 py-1" disabled={saving} onClick={() => setMode("idle")}>Voltar</button>
        </div>
      ) : null}
      {mode === "reschedule" ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
          <label className="text-gray-500">Data<input type="date" className="input-field mt-1 block" value={date} onChange={(event) => { setDate(event.target.value); setConflict(""); }} /></label>
          {item.allDay ? <span className="py-2 text-gray-500">Dia inteiro — mantido</span> : <label className="text-gray-500">Horário<input type="time" className="input-field mt-1 block" value={time} onChange={(event) => { setTime(event.target.value); setConflict(""); }} /></label>}
          {conflict ? (
            <>
              <span className="basis-full text-amber-600">{conflict}</span>
              <button type="button" className="btn-primary px-2 py-1" disabled={saving} onClick={() => send("RESCHEDULE", true)}>Salvar mesmo assim</button>
            </>
          ) : <button type="button" className="btn-primary px-2 py-1" disabled={saving || !date || !time} onClick={() => send("RESCHEDULE")}>{saving ? "Salvando…" : "Salvar"}</button>}
          <button type="button" className="btn-secondary px-2 py-1" disabled={saving} onClick={() => { setMode("idle"); setConflict(""); }}>Voltar</button>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-xs text-red-600">{error}</p> : null}
    </li>
  );
}
